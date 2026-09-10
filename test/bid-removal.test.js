import { test } from "node:test";
import assert from "node:assert/strict";
import { AuctionRoom } from "../worker/auction-room.js";

const hostAddress = "NQ49 A9A5 9UFL SDTQ 8HPU 5U43 1V4T EYMS EPT0";
const now = 1_000_000;
const keyFor = bid => `${bid.paddle}-${bid.amountLunas}-${bid.ts}`;
const bidder = paddle => ({ role: "bidder", paddle });
const host = { role: "host", hostAddress };

async function fixture() {
  const values = new Map();
  const state = { storage: {
    get: async key => structuredClone(values.get(key)),
    put: async (key, value) => values.set(key, structuredClone(value)),
    setAlarm: async value => values.set("alarm", value)
  }, getWebSockets: () => [] };
  const room = new AuctionRoom(state, {});
  await room.ensureLot({ id: "removal-fixture", title: "Removal fixture", hostPaddle: 7, hostAddress, startPriceLunas: 100000, minIncrementLunas: 100000, durationSec: 60 });
  await room.start(now);
  await room.placeBid(11, "Alpha", 100000, now + 1000);
  await room.placeBid(12, "Bravo", 200000, now + 2000);
  return { room, state, values };
}

function remove(room, index, actor, timestamp = now + 4000, reason = "Entered the wrong amount") {
  return room.removeBid({ bidId: keyFor(room.bidLog[index]), actor, reason }, timestamp);
}

test("bidder withdrawal recomputes leader and retains a removal record", async () => {
  const { room } = await fixture();
  await remove(room, 1, bidder(12), now + 55000);
  const state = room.stateMessage(now + 55000);
  assert.equal(state.currentBidLunas, 100000);
  assert.equal(state.leadingPaddle.paddle, 11);
  assert.equal(state.minNextBidLunas, 200000);
  assert.equal(state.endsAt, now + 85000);
  assert.equal(state.bids.length, 1);
  assert.equal(state.removedBids.length, 1);
  assert.equal(state.removedBids[0].removal.role, "bidder");
  assert.equal(room.bidLog.length, 2);
});

test("a bidder cannot remove another bidder's bid", async () => {
  const { room } = await fixture();
  await assert.rejects(remove(room, 1, bidder(11)), error => error.code === "forbidden");
  assert.equal(room.currentBid, 200000);
});

test("only the host wallet may moderate other paddles", async () => {
  const { room } = await fixture();
  await assert.rejects(remove(room, 1, { role: "host", hostAddress: "wrong-wallet" }), error => error.code === "forbidden");
  await remove(room, 1, host);
  assert.equal(room.currentBid, 100000);
  assert.equal(room.bidLog[1].removal.removedBy, hostAddress);
});

test("removing a losing bid leaves the leader and deadline unchanged", async () => {
  const { room } = await fixture();
  const deadline = room.endsAt;
  await remove(room, 0, bidder(11), now + 55000);
  assert.equal(room.currentBid, 200000);
  assert.equal(room.leading.paddle, 12);
  assert.equal(room.endsAt, deadline);
});

test("all bids withdrawn restores the opening price and passes without a winner", async () => {
  const { room } = await fixture();
  await remove(room, 0, bidder(11));
  await remove(room, 1, bidder(12), now + 5000);
  assert.equal(room.currentBid, 0);
  assert.equal(room.leading, null);
  assert.equal(room.minNextBidLunas(), 100000);
  await room.tick(room.endsAt);
  assert.equal(room.phase, "passed");
});

test("winning bid is protected at the deadline, including delayed alarms", async () => {
  const { room } = await fixture();
  const deadline = room.endsAt;
  for (const actor of [bidder(12), host]) {
    await assert.rejects(remove(room, 1, actor, deadline), error => error.code === "winning_bid_locked");
  }
  await remove(room, 0, bidder(11), deadline);
  assert.equal(room.currentBid, 200000);
  assert.equal(room.leading.paddle, 12);
  assert.equal(room.endsAt, deadline);
});

test("post-close cleanup and retries preserve the final outcome and first reason", async () => {
  const { room } = await fixture();
  await room.tick(room.endsAt);
  room.finalized = true;
  await remove(room, 0, host, room.endsAt + 1000, "Duplicate entry");
  await remove(room, 0, host, room.endsAt + 2000, "Changed reason");
  assert.equal(room.phase, "sold");
  assert.equal(room.currentBid, 200000);
  assert.equal(room.leading.paddle, 12);
  assert.equal(room.bidLog[0].removal.reason, "Duplicate entry");
  assert.equal(room.pendingRemovals.length, 1);
});

test("removal and pending archive synchronization survive object restoration", async () => {
  const { room, state } = await fixture();
  await remove(room, 1, bidder(12));
  const restored = new AuctionRoom(state, {});
  await restored.load();
  assert.equal(restored.currentBid, 100000);
  assert.equal(restored.stateMessage().removedBids.length, 1);
  assert.equal(restored.pendingRemovals.length, 1);
});

test("concurrent withdrawal and a higher bid preserve both operations", async () => {
  const { room, state } = await fixture();
  await Promise.all([remove(room, 1, bidder(12)), room.placeBid(13, "Charlie", 300000, now + 4001)]);
  const restored = new AuctionRoom(state, {});
  await restored.load();
  assert.equal(restored.currentBid, 300000);
  assert.equal(restored.leading.paddle, 13);
  assert.equal(restored.stateMessage().removedBids.length, 1);
  assert.equal(restored.stateMessage().bids.length, 2);
});

test("archive synchronization only acknowledges captured removals", async () => {
  const { room } = await fixture();
  await remove(room, 1, bidder(12));
  let release;
  room.env.DB = { prepare: () => ({ bind: (...args) => args }), batch: () => new Promise(resolve => { release = resolve; }) };
  const flushing = room.persistRemovals();
  await remove(room, 0, bidder(11), now + 6000);
  release();
  await flushing;
  assert.deepEqual(room.pendingRemovals, [keyFor(room.bidLog[0])]);
});

test("a failed archive write remains retryable after restart", async () => {
  const { room, state } = await fixture();
  await remove(room, 1, bidder(12));
  room.env.DB = { prepare: () => ({ bind: (...args) => args }), batch: async () => { throw new Error("D1 unavailable"); } };
  await assert.rejects(room.persistRemovals(), /D1 unavailable/);
  const writes = [];
  const restored = new AuctionRoom(state, { DB: { prepare: () => ({ bind: (...args) => args }), batch: async rows => { writes.push(...rows); } } });
  await restored.load();
  await restored.persistRemovals();
  assert.equal(writes.length, 1);
  assert.equal(restored.pendingRemovals.length, 0);
  assert.equal(restored.stateMessage().removedBids.length, 1);
});

test("removal requires a bounded reason and a recognized actor", async () => {
  const { room } = await fixture();
  await assert.rejects(remove(room, 1, bidder(12), now + 4000, ""), error => error.code === "invalid_reason");
  await assert.rejects(remove(room, 1, bidder(12), now + 4000, "x".repeat(281)), error => error.code === "invalid_reason");
  await assert.rejects(remove(room, 1, { role: "admin", paddle: 12 }), error => error.code === "forbidden");
});
