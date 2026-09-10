// Settlement verification tests against a local mock Nimiq RPC.
// Matrix: settle->pending, verify->verified (match), verify->rejected
// (wrong recipient / wrong amount / failed execution), not-found stays
// pending, scheduled pass flips pending->verified, replay of stored
// verdicts, settle response carries settlement state.
// The worker must be started with NIMIQ_RPC_URL=http://127.0.0.1:8899
// (scripts/test-settle.sh does this; .dev.vars default is overridden by
// passing --var NIMIQ_RPC_URL=... to wrangler dev).
// Run with wrangler dev on 8799 (see README dev commands):
//   node --test test/settle-verify.test.js
import { test } from "node:test";
import "./fixtures.js";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { KeyPair } from "@nimiq/core";
import {
  encodeNimiqSignedMessage,
  normalizeNimiqAddress
} from "../worker/auth.js";
import {
  SETTLE_STATE,
  verifySettlement
} from "../worker/settle-verify.js";

const BASE = process.env.WRANGLER_URL || "http://127.0.0.1:8799";
const MOCK_RPC_PORT = 8899;
const RUN = String(Date.now());

// ---- mock Nimiq JSON-RPC ----

function startMockRpc() {
  const chain = new Map(); // txHash -> tx response data
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      requests.push(payload);
      if (payload.method !== "getTransactionByHash") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "Method not found" } }));
        return;
      }
      const hash = payload.params[0];
      const tx = chain.get(hash);
      res.writeHead(200, { "content-type": "application/json" });
      if (!tx) {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          error: { code: -32603, message: "Internal error", data: `Transaction not found: ${hash}` }
        }));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { data: tx, metadata: null } }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(MOCK_RPC_PORT, "127.0.0.1", () => resolve({
      server,
      chain,
      requests,
      url: `http://127.0.0.1:${MOCK_RPC_PORT}`
    }));
  });
}

function mockTx({ recipient, value, executionResult = true, hash = "ab".repeat(32), lotId = "unit-lot" }) {
  return {
    hash,
    blockNumber: 1234,
    timestamp: Date.now(),
    confirmations: 120,
    networkId: 5,
    recipientData: Buffer.from(`Nimgavel:${lotId}`).toString("hex"),
    from: "NQ02 31N6 3KM5 T6G5 22TN EPF5 5XPY RLHK RMB3",
    fromType: 0,
    to: recipient,
    toType: 0,
    value,
    fee: 138,
    executionResult
  };
}

// ---- REST helpers ----

async function requestJson(path, options) {
  const response = await fetch(`${BASE}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function signMessage(keyPair, message) {
  const { Hash } = globalThis.__nimiqCore || {};
  const hash = Hash.computeSha256(encodeNimiqSignedMessage(message));
  return keyPair.sign(hash).toHex();
}

async function createAndStartLot() {
  const keyPair = KeyPair.generate();
  const hostAddress = keyPair.toAddress().toUserFriendlyAddress();
  const deviceId = `sv-host-${RUN}-${Math.random().toString(36).slice(2, 8)}`;
  const paddle = await requestJson(`/api/paddle?deviceId=${encodeURIComponent(deviceId)}`);
  assert.equal(paddle.response.status, 200);

  const challenge = await requestJson("/api/host/challenge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hostAddress })
  });
  assert.equal(challenge.response.status, 201);

  const lot = await requestJson("/api/lots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challengeId: challenge.body.challenge.id,
      hostAddress,
      publicKey: keyPair.publicKey.toHex(),
      signature: signMessage(keyPair, challenge.body.challenge.message),
      title: "Settlement verification lot",
      description: "matrix",
      hostPaddle: paddle.body.paddle,
      paddleToken: paddle.body.paddleToken,
      startPriceLunas: 100000,
      minIncrementLunas: 100000,
      durationSec: 5
    })
  });
  assert.equal(lot.response.status, 201, JSON.stringify(lot.body));

  const started = await requestJson(`/api/lots/${encodeURIComponent(lot.body.lot.id)}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hostToken: lot.body.hostToken })
  });
  assert.equal(started.response.status, 200, JSON.stringify(started.body));

  return { lotId: lot.body.lot.id, hostAddress, keyPair };
}

async function auctionToSold(hostAddress) {
  const { lotId } = await createAndStartLot();
  const bidderDevice = `sv-bidder-${RUN}-${Math.random().toString(36).slice(2, 8)}`;
  const bidder = await requestJson(`/api/paddle?deviceId=${encodeURIComponent(bidderDevice)}`);
  assert.equal(bidder.response.status, 200);

  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws/${encodeURIComponent(lotId)}?paddle=${bidder.body.paddle}&alias=${encodeURIComponent(bidder.body.alias)}`);
  const messages = [];
  ws.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  await waitFor(messages, (m) => m.type === "state");
  ws.send(JSON.stringify({ type: "join", paddleToken: bidder.body.paddleToken }));
  await waitFor(messages, (m) => m.type === "joined");
  ws.send(JSON.stringify({ type: "bid", amountLunas: 100000 }));
  await waitFor(messages, (m) => m.type === "sold", 40_000);
  ws.close();

  return { lotId, bidder };
}

async function waitFor(messages, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const index = messages.findIndex(predicate);
    if (index >= 0) return messages[index];
    if (Date.now() >= deadline) throw new Error(`timeout waiting; seen: ${JSON.stringify(messages).slice(0, 200)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// lazily load Hash without a top-level await cycle in signMessage
{
  const Nimiq = await import("@nimiq/core");
  globalThis.__nimiqCore = Nimiq;
}

test("settlement verification matrix against mock Nimiq RPC", async () => {
  const mock = await startMockRpc();

  // -- unit level: verifySettlement outcomes --
  const host = "NQ49 A9A5 9UFL SDTQ 8HPU 5U43 1V4T EYMS EPT0";
  const goodHash = "11".repeat(32);

  // not found -> pending
  const unknown = await verifySettlement({ txHash: "ff".repeat(32), hostAddress: host, lotId: "unit-lot", network: "testnet", amountLunas: 100000, rpcUrl: mock.url });
  assert.equal(unknown.status, SETTLE_STATE.PENDING);

  // exact match -> verified
  mock.chain.set(goodHash, mockTx({ recipient: host, value: 100000, hash: goodHash }));
  const good = await verifySettlement({ txHash: goodHash, hostAddress: host, lotId: "unit-lot", network: "testnet", amountLunas: 100000, rpcUrl: mock.url });
  assert.equal(good.status, SETTLE_STATE.VERIFIED);
  assert.equal(good.confirmations, 120);

  // wrong recipient -> rejected
  mock.chain.set("22".repeat(32), mockTx({ recipient: "NQ07 0000 0000 0000 0000 0000 0000 0000 0000", value: 100000, hash: "22".repeat(32) }));
  const wrongHost = await verifySettlement({ txHash: "22".repeat(32), hostAddress: host, lotId: "unit-lot", network: "testnet", amountLunas: 100000, rpcUrl: mock.url });
  assert.equal(wrongHost.status, SETTLE_STATE.REJECTED);

  // wrong amount -> rejected
  mock.chain.set("33".repeat(32), mockTx({ recipient: host, value: 200000, hash: "33".repeat(32) }));
  const wrongAmount = await verifySettlement({ txHash: "33".repeat(32), hostAddress: host, lotId: "unit-lot", network: "testnet", amountLunas: 100000, rpcUrl: mock.url });
  assert.equal(wrongAmount.status, SETTLE_STATE.REJECTED);

  // failed execution -> rejected
  mock.chain.set("44".repeat(32), mockTx({ recipient: host, value: 100000, executionResult: false, hash: "44".repeat(32) }));
  const failed = await verifySettlement({ txHash: "44".repeat(32), hostAddress: host, lotId: "unit-lot", network: "testnet", amountLunas: 100000, rpcUrl: mock.url });
  assert.equal(failed.status, SETTLE_STATE.REJECTED);

  // compact address format matches spaced host format
  mock.chain.set("55".repeat(32), mockTx({ recipient: host.replace(/ /g, ""), value: 100000, hash: "55".repeat(32) }));
  const compact = await verifySettlement({ txHash: "55".repeat(32), hostAddress: host, lotId: "unit-lot", network: "testnet", amountLunas: 100000, rpcUrl: mock.url });
  assert.equal(compact.status, SETTLE_STATE.VERIFIED);

  // -- integration: settle records pending; verify flips to verified --
  const { lotId, bidder } = await auctionToSold();
  const txHash = "66".repeat(32);

  const settled = await requestJson(`/api/lots/${encodeURIComponent(lotId)}/settle`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bidder.body.paddleToken}` },
    body: JSON.stringify({ txHash })
  });
  assert.equal(settled.response.status, 201, JSON.stringify(settled.body));
  assert.equal(settled.body.receipt.settlement.state, SETTLE_STATE.PENDING);

  // lot detail exposes pending state
  const detailPending = await requestJson(`/api/lots/${encodeURIComponent(lotId)}`);
  assert.equal(detailPending.body.lot.settlement.state, SETTLE_STATE.PENDING);

  // before the chain knows it: verify stays pending
  const stillPending = await requestJson(`/api/lots/${encodeURIComponent(lotId)}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bidder.body.paddleToken}` },
    body: "{}"
  });
  assert.equal(stillPending.response.status, 200);
  assert.equal(stillPending.body.settlement.state, SETTLE_STATE.PENDING);

  // chain sees the payment: verify flips to verified and persists
  const detailForHost = await requestJson(`/api/lots/${encodeURIComponent(lotId)}`);
  const hostAddress = detailForHost.body.lot.hostAddress;
  mock.chain.set(txHash, mockTx({ recipient: hostAddress, value: 100000, hash: txHash, lotId }));

  const verified = await requestJson(`/api/lots/${encodeURIComponent(lotId)}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bidder.body.paddleToken}` },
    body: "{}"
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.settlement.state, SETTLE_STATE.VERIFIED);

  // replay without a re-check: stored verdict returned, no extra RPC call
  const rpcCallsBefore = mock.requests.length;
  const replay = await requestJson(`/api/lots/${encodeURIComponent(lotId)}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bidder.body.paddleToken}` },
    body: "{}"
  });
  assert.equal(replay.body.settlement.state, SETTLE_STATE.VERIFIED);
  assert.equal(mock.requests.length, rpcCallsBefore, "verified replay must not hit the RPC again");

  // lot detail now shows verified
  const detailVerified = await requestJson(`/api/lots/${encodeURIComponent(lotId)}`);
  assert.equal(detailVerified.body.lot.settlement.state, SETTLE_STATE.VERIFIED);

  // settle replay carries the verified state
  const settledReplay = await requestJson(`/api/lots/${encodeURIComponent(lotId)}/settle`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bidder.body.paddleToken}` },
    body: JSON.stringify({ txHash })
  });
  assert.equal(settledReplay.response.status, 200);
  assert.equal(settledReplay.body.receipt.settlement.state, SETTLE_STATE.VERIFIED);

  // -- integration: scheduled pass flips a pending settlement --
  const second = await auctionToSold();
  const secondHash = "77".repeat(32);
  const secondSettled = await requestJson(`/api/lots/${encodeURIComponent(second.lotId)}/settle`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${second.bidder.body.paddleToken}` },
    body: JSON.stringify({ txHash: secondHash })
  });
  assert.equal(secondSettled.body.receipt.settlement.state, SETTLE_STATE.PENDING);

  const secondDetail = await requestJson(`/api/lots/${encodeURIComponent(second.lotId)}`);
  mock.chain.set(secondHash, mockTx({ recipient: secondDetail.body.lot.hostAddress, value: 100000, hash: secondHash, lotId: second.lotId }));

  // Trigger the worker's scheduled handler: wrangler exposes it at
  // /cdn-cgi/local/scheduled when --test-scheduled is enabled.
  const scheduled = await fetch(`${BASE}/cdn-cgi/local/scheduled`, { method: "POST" });
  assert.ok(scheduled.ok, `scheduled endpoint failed: ${scheduled.status}`);

  const afterCron = await requestJson(`/api/lots/${encodeURIComponent(second.lotId)}`);
  assert.equal(afterCron.body.lot.settlement.state, SETTLE_STATE.VERIFIED, "cron pass must flip pending to verified");

  // -- integration: wrong payment rejected and verdict persisted --
  const third = await auctionToSold();
  const thirdHash = "88".repeat(32);
  await requestJson(`/api/lots/${encodeURIComponent(third.lotId)}/settle`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${third.bidder.body.paddleToken}` },
    body: JSON.stringify({ txHash: thirdHash })
  });
  // payment went to a different address than the host
  mock.chain.set(thirdHash, mockTx({ recipient: "NQ07 0000 0000 0000 0000 0000 0000 0000 0000", value: 100000, hash: thirdHash, lotId: third.lotId }));
  const rejected = await requestJson(`/api/lots/${encodeURIComponent(third.lotId)}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${third.bidder.body.paddleToken}` },
    body: "{}"
  });
  assert.equal(rejected.body.settlement.state, SETTLE_STATE.REJECTED);
  assert.match(rejected.body.settlement.reason, /recipient/i);

  const afterReject = await requestJson(`/api/lots/${encodeURIComponent(third.lotId)}`);
  assert.equal(afterReject.body.lot.settlement.state, SETTLE_STATE.REJECTED);

  mock.server.close();
});

test("verifySettlement keeps pending when the RPC node is unreachable", async () => {
  const result = await verifySettlement({
    txHash: "99".repeat(32),
    hostAddress: "NQ49 A9A5 9UFL SDTQ 8HPU 5U43 1V4T EYMS EPT0",
    amountLunas: 100000,
    rpcUrl: "http://127.0.0.1:1/"
  });
  assert.equal(result.status, SETTLE_STATE.PENDING);
  assert.ok(result.reason);
});

test("normalizeNimiqAddress accepts live-RPC address formats", () => {
  const spaced = "NQ02 31N6 3KM5 T6G5 22TN EPF5 5XPY RLHK RMB3";
  const normalized = normalizeNimiqAddress(spaced.replace(/ /g, ""));
  assert.equal(normalized, spaced);
  assert.equal(normalizeNimiqAddress(spaced), spaced);
});
