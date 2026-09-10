// T14 hardening tests: per-IP paddle throttle and per-connection WS
// message cap. Run with wrangler dev on 8799 (local dev has no
// CF-Connecting-IP, so the throttle tests inject the header explicitly).
//   node --test test/hardening.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLot, startAuction } from "./fixtures.js";

const BASE = process.env.WRANGLER_URL || "http://127.0.0.1:8799";
const WS_BASE = BASE.replace(/^http/, "ws");
const RUN = String(Date.now());

async function paddleFor(deviceId, ip) {
  const headers = ip ? { "cf-connecting-ip": ip } : {};
  const response = await fetch(
    `${BASE}/api/paddle?deviceId=${encodeURIComponent(deviceId)}`,
    { headers }
  );
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test("paddle creation is throttled per IP beyond 10 per hour", async () => {
  const ip = `198.51.100.${Number(RUN.slice(-2)) % 200 + 1}`;

  let okCount = 0;
  let throttled = null;
  for (let i = 0; i < 13; i += 1) {
    const { response, body } = await paddleFor(`t14-${RUN}-${i}`, ip);
    if (response.status === 200) okCount += 1;
    else throttled = { status: response.status, body };
    if (response.status === 429 && i < 10) {
      throw new Error(`throttled too early at request ${i}: ${JSON.stringify(body)}`);
    }
  }

  assert.equal(okCount, 10, `expected exactly 10 paddle successes, got ${okCount}`);
  assert.ok(throttled, "expected a 429 among the requests past the limit");
  assert.equal(throttled.status, 429);
  assert.match(throttled.body.error, /Too many paddles/i);
});

test("a different IP is not affected by another IP's throttle bucket", async () => {
  const ipA = `198.51.100.${Number(RUN.slice(-2)) % 200 + 1}`;
  const ipB = `203.0.113.${Number(RUN.slice(-2)) % 200 + 1}`;

  // ipA is already exhausted from the previous test (same derived IP).
  const exhausted = await paddleFor(`t14-other-${RUN}`, ipA);
  assert.equal(exhausted.response.status, 429);

  const fresh = await paddleFor(`t14-other-${RUN}-b`, ipB);
  assert.equal(fresh.response.status, 200);
  assert.ok(fresh.body.paddle);
});

test("paddle requests without a client IP skip the throttle", async () => {
  // Local dev / curl: no CF-Connecting-IP header -> no bucket.
  for (let i = 0; i < 12; i += 1) {
    const { response } = await paddleFor(`t14-noip-${RUN}-${i}`);
    assert.equal(response.status, 200, `request ${i} should not be throttled`);
  }
});

test("a flooding WebSocket connection is closed after the message cap", async () => {
  const created = await makeLot({ title: "Flood guard lot", durationSec: 300 });
  const lotId = created.lot.id;
  await startAuction(created);

  const ws = new WebSocket(`${WS_BASE}/ws/${lotId}?paddle=501&alias=FloodTest`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const closed = new Promise((resolve) => {
    ws.addEventListener("close", (event) => resolve(event));
  });

  // Flood 130 junk frames fast: non-bid frames are ignored by the protocol,
  // but the cap counts every inbound frame.
  for (let i = 0; i < 130; i += 1) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "junk", n: i }));
    }
  }

  const closeEvent = await Promise.race([
    closed,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("connection was not closed after flood")), 30_000)
    )
  ]);
  assert.equal(closeEvent.code, 1008, "expected policy-violation close code");

  // A fresh connection still works: the cap closed only the flooder.
  const ws2 = new WebSocket(`${WS_BASE}/ws/${lotId}?paddle=502&alias=AfterFlood`);
  await new Promise((resolve, reject) => {
    ws2.addEventListener("open", resolve, { once: true });
    ws2.addEventListener("error", reject, { once: true });
  });
  const state = await new Promise((resolve, reject) => {
    ws2.addEventListener("message", (event) => resolve(JSON.parse(event.data)), { once: true });
    setTimeout(() => reject(new Error("no state message")), 10_000);
  });
  assert.equal(state.type, "state");
  ws2.close();
});
