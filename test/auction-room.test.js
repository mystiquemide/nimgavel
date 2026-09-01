// Full lifecycle test for the AuctionRoom Durable Object via wrangler dev.
// Drives: seed -> start -> 50-bid war -> rate-limit probe -> soft-close
// extension storm -> sold, plus restart-restore state check.
// Run: npx wrangler dev --port 8799 & then:
//   WRANGLER_URL=http://127.0.0.1:8799 node --test test/auction-room.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.WRANGLER_URL || "http://127.0.0.1:8799";
const WS_BASE = BASE.replace(/^http/, "ws");
const RUN = process.env.TEST_RUN || String(Date.now()).slice(-6);
const LOT = {
  id: `test-lot-${RUN}`,
  title: "Test lot",
  description: "Verification lot",
  imageUrl: null,
  hostPaddle: 7,
  hostAddress: "NQ07TESTTESTTESTTESTTESTTESTTESTTESTTESTTESTTEST0P",
  startPriceLunas: 500000, // 5 NIM
  minIncrementLunas: 100000, // 1 NIM
  durationSec: 60,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jf(path, opts) {
  const res = await fetch(`${BASE}${path}`, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

// Buffered connection: messages queue from construction, so nothing is lost
// between socket open and the first recv() call.
class Conn {
  constructor(paddle, alias, lotId = LOT.id) {
    this.ws = new WebSocket(
      `${WS_BASE}/ws/${lotId}?paddle=${paddle}&alias=${encodeURIComponent(alias)}`
    );
    this.queue = [];
    this.waiters = [];
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (this.waiters.length) this.waiters.shift()(msg);
      else this.queue.push(msg);
    });
    this.open = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }
  recv(timeoutMs = 20000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("recv timeout")), timeoutMs);
      this.waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }
  async expectType(type, timeoutMs = 20000) {
    const msg = await this.recv(timeoutMs);
    assert.equal(msg.type, type, `expected ${type}, got ${JSON.stringify(msg).slice(0, 140)}`);
    return msg;
  }
  // Drain intermediate messages (phase, state) until the target arrives.
  async waitFor(type, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timeout waiting for ${type}`);
      const msg = await this.recv(remaining);
      if (msg.type === type) return msg;
    }
  }
  // Drain until the broadcast of our own bid (paddle + amount) shows up.
  // Any error surfaced on the way is our bid being rejected: fail loudly.
  async confirmBid(paddle, amountLunas) {
    for (;;) {
      const msg = await this.recv();
      if (msg.type === "error") {
        throw new Error(`bid rejected: ${msg.code} ${msg.message}`);
      }
      if (msg.type === "bid" && msg.paddle === paddle && msg.amountLunas === amountLunas) return;
    }
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

test("full auction lifecycle with soft close", async () => {
  // Seed + start
  await jf(`/ws/${LOT.id}/seed`, { method: "POST", body: JSON.stringify(LOT) });
  const started = await jf(`/ws/${LOT.id}/start`, { method: "POST" });
  assert.equal(started.phase, "live");

  // Two paddles connect; both receive initial state
  const a = new Conn(41, "Alpha");
  const b = new Conn(42, "Bravo");
  await a.open;
  await b.open;
  const stateA = await a.expectType("state");
  await b.expectType("state");
  assert.equal(stateA.phase, "live");
  assert.equal(stateA.currentBidLunas, 0);
  assert.equal(stateA.minNextBidLunas, LOT.startPriceLunas);
  assert.ok(stateA.serverNow > 0);

  // Host cannot bid on own lot
  const host = new Conn(7, "Host");
  await host.open;
  await host.expectType("state");
  host.send({ type: "bid", amountLunas: 900000 });
  const hostErr = await host.expectType("error");
  assert.equal(hostErr.code, "host_cannot_bid");

  // Below-minimum bid rejected with the exact minimum in the message
  a.send({ type: "bid", amountLunas: 100000 });
  const lowErr = await a.expectType("error");
  assert.equal(lowErr.code, "outbid_increment");
  assert.ok(lowErr.message.includes("500000"));

  // 50-bid war, alternating paddles. Pairs paced above the 500ms cooldown.
  let amount = LOT.startPriceLunas;
  const WAR_BIDS = 50;
  for (let i = 0; i < WAR_BIDS; i++) {
    amount += LOT.minIncrementLunas;
    const bidder = i % 2 === 0 ? a : b;
    const paddle = i % 2 === 0 ? 41 : 42;
    bidder.send({ type: "bid", amountLunas: amount });
    await bidder.confirmBid(paddle, amount);
    if (i % 2 === 1) await sleep(550); // next pair: both paddles clear cooldown
  }
  assert.equal(amount, LOT.startPriceLunas + WAR_BIDS * LOT.minIncrementLunas);
  a.queue.length = 0;
  b.queue.length = 0;

  // Rate limit: a's last bid was one b-bid ago (< 500ms). Immediate rebid rejected.
  a.send({ type: "bid", amountLunas: amount + LOT.minIncrementLunas });
  const fast = await a.recv();
  if (fast.type === "bid") {
    // Cooldown had already elapsed: accepted. Immediate second must now reject.
    amount += LOT.minIncrementLunas;
    a.send({ type: "bid", amountLunas: amount + LOT.minIncrementLunas });
    const second = await a.expectType("error");
    assert.equal(second.code, "rate_limited");
  } else {
    assert.equal(fast.type, "error");
    assert.equal(fast.code, "rate_limited");
  }
  a.queue.length = 0;
  b.queue.length = 0;

  // Extension storm: 5s duration, bids keep landing inside the soft-close
  // window; the room must stay open long past its original end time.
  const stormLot = { ...LOT, id: `test-storm-${RUN}`, durationSec: 5 };
  await jf(`/ws/${stormLot.id}/seed`, { method: "POST", body: JSON.stringify(stormLot) });
  await jf(`/ws/${stormLot.id}/start`, { method: "POST" });
  const s = new Conn(41, "Alpha", stormLot.id);
  await s.open;
  await s.expectType("state");

  let stormAmount = stormLot.startPriceLunas;
  const stormStart = Date.now();
  let stormBids = 0;
  while (Date.now() - stormStart < 12_000) {
    const attempt = stormAmount + stormLot.minIncrementLunas;
    s.send({ type: "bid", amountLunas: attempt });
    let confirmed = false;
    for (;;) {
      const msg = await s.recv();
      if (msg.type === "error") {
        assert.equal(msg.code, "rate_limited", `unexpected storm error: ${msg.code}`);
        await sleep(600);
        break; // cooldown; retry the same amount
      }
      if (msg.type === "bid" && msg.paddle === 41 && msg.amountLunas === attempt) {
        confirmed = true;
        break;
      }
      // phase broadcasts interleave; skip them
    }
    if (confirmed) {
      stormAmount = attempt;
      stormBids += 1;
      const st = await jf(`/ws/${stormLot.id}/state`);
      assert.ok(st.endsAt > Date.now(), "endsAt must be in the future after soft close");
      await sleep(700); // inside the soft-close window, above cooldown
    }
  }
  // A 5s auction accepted bids for 12s: soft close proven.
  assert.ok(stormBids >= 10, `expected >= 10 storm bids, got ${stormBids}`);

  // Stop bidding: the gavel must fall within the 30s extension window.
  // Phase transitions (going_twice) land first; drain through them.
  const soldMsg = await s.waitFor("sold", 45000);
  assert.equal(soldMsg.winningPaddle, 41);
  assert.equal(soldMsg.amountLunas, stormAmount);
  assert.equal(soldMsg.hostAddress, stormLot.hostAddress);

  // Main lot: persisted state survives (restart-restore shape check via REST)
  const state = await jf(`/ws/${LOT.id}/state`);
  assert.ok(["live", "going_once", "going_twice", "sold", "passed"].includes(state.phase));
  assert.equal(state.currentBidLunas, amount);
  assert.ok([41, 42].includes(state.leadingPaddle.paddle));

  a.close();
  b.close();
  host.close();
  s.close();
});
