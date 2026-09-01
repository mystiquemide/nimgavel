// T4 API smoke test. Run with wrangler dev and a configured auth secret:
//   npx wrangler dev --port 8799 & then:
//   node --test test/worker-api.test.js
// Requires .dev.vars with NIMGAVEL_SECRET (>= 16 chars).

import assert from "node:assert/strict";
import { test } from "node:test";
import { Hash, KeyPair } from "@nimiq/core";
import {
  encodeNimiqSignedMessage,
  sha256Hex
} from "../worker/auth.js";

const BASE = process.env.WRANGLER_URL || "http://127.0.0.1:8799";
const WS_BASE = BASE.replace(/^http/, "ws");
const RUN = String(Date.now());

async function requestJson(path, options) {
  const response = await fetch(`${BASE}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function signMessage(keyPair, message) {
  const hash = Hash.computeSha256(encodeNimiqSignedMessage(message));
  return keyPair.sign(hash).toHex();
}

test("T4 REST API completes the host, room, and settlement path", async () => {
  const health = await requestJson("/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.db, true);

  const deviceId = `t4-host-device-${RUN}`;
  const paddle = await requestJson(`/api/paddle?deviceId=${encodeURIComponent(deviceId)}`);
  assert.equal(paddle.response.status, 200);
  assert.ok(paddle.body.paddleToken);
  assert.match(paddle.body.alias, /^[A-Za-z]+ [A-Za-z]+$/);

  const samePaddle = await requestJson(`/api/paddle?deviceId=${encodeURIComponent(deviceId)}`);
  assert.equal(samePaddle.response.status, 200);
  assert.equal(samePaddle.body.paddle, paddle.body.paddle);
  assert.equal(samePaddle.body.alias, paddle.body.alias);

  const keyPair = KeyPair.generate();
  const hostAddress = keyPair.toAddress().toUserFriendlyAddress();
  const challengeResult = await requestJson("/api/host/challenge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hostAddress })
  });
  assert.equal(challengeResult.response.status, 201);
  const challenge = challengeResult.body.challenge;
  assert.ok(challenge.id);
  assert.match(challenge.message, /Nimgavel host authorization/);

  const lotResult = await requestJson("/api/lots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challengeId: challenge.id,
      hostAddress,
      publicKey: keyPair.publicKey.toHex(),
      signature: signMessage(keyPair, challenge.message),
      title: "T4 verification lot",
      description: "REST API verification",
      hostPaddle: paddle.body.paddle,
      startPriceLunas: 100000,
      minIncrementLunas: 100000,
      durationSec: 5
    })
  });
  assert.equal(lotResult.response.status, 201, JSON.stringify(lotResult.body));
  assert.ok(lotResult.body.hostToken);
  const lot = lotResult.body.lot;
  assert.equal(lot.status, "created");

  const listed = await requestJson("/api/lots");
  assert.equal(listed.response.status, 200);
  assert.ok(listed.body.upcoming.some((entry) => entry.id === lot.id));

  const detail = await requestJson(`/api/lots/${encodeURIComponent(lot.id)}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.lot.id, lot.id);
  assert.deepEqual(detail.body.bids, []);

  const started = await requestJson(`/api/lots/${encodeURIComponent(lot.id)}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hostToken: lotResult.body.hostToken })
  });
  assert.equal(started.response.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.ok, true);
  assert.equal(started.body.lot.status, "live");

  const roomState = await requestJson(`/api/rooms/${encodeURIComponent(lot.id)}/state`);
  assert.equal(roomState.response.status, 200);
  assert.equal(roomState.body.phase, "live");

  const bidderDevice = `t4-bidder-device-${RUN}`;
  const bidder = await requestJson(`/api/paddle?deviceId=${encodeURIComponent(bidderDevice)}`);
  assert.equal(bidder.response.status, 200);

  const ws = new WebSocket(
    `${WS_BASE}/ws/${encodeURIComponent(lot.id)}?paddle=${bidder.body.paddle}&alias=${encodeURIComponent(bidder.body.alias)}`
  );
  const messages = [];
  ws.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  await waitForMessage(messages, (message) => message.type === "state");
  ws.send(JSON.stringify({ type: "bid", amountLunas: 100000 }));
  await waitForMessage(messages, (message) => message.type === "bid" && message.amountLunas === 100000);
  await waitForMessage(messages, (message) => message.type === "sold", 40_000);

  const afterSale = await requestJson(`/api/lots/${encodeURIComponent(lot.id)}`);
  assert.equal(afterSale.response.status, 200);
  assert.equal(afterSale.body.lot.status, "sold");
  assert.equal(afterSale.body.lot.winningPaddle, bidder.body.paddle);
  assert.equal(afterSale.body.bids.length, 1);

  const txHash = (await sha256Hex(`t4-tx-${RUN}`)).padEnd(64, "0").slice(0, 64);
  const settled = await requestJson(`/api/lots/${encodeURIComponent(lot.id)}/settle`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bidder.body.paddleToken}`
    },
    body: JSON.stringify({ txHash })
  });
  assert.equal(settled.response.status, 201, JSON.stringify(settled.body));
  assert.equal(settled.body.lot.status, "settled");
  assert.equal(settled.body.receipt.txHash, txHash);
  assert.match(settled.body.receipt.explorerUrl, new RegExp(`${txHash}$`));

  const replay = await requestJson(`/api/lots/${encodeURIComponent(lot.id)}/settle`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bidder.body.paddleToken}`
    },
    body: JSON.stringify({ txHash })
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.receipt.txHash, txHash);

  ws.close();
});

async function waitForMessage(messages, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const match = messages.findIndex(predicate);
    if (match >= 0) return messages.splice(0, match + 1).at(-1);
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for a WebSocket message. Seen: ${JSON.stringify(messages)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
