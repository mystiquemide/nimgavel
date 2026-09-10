import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { AuctionRoom } from "../worker/auction-room.js";
import { verifySettlement } from "../worker/settle-verify.js";
import { nimToLunas, readWalletPayment } from "../lib/nimiq.js";
import { Transaction, KeyPair, Hash } from "@nimiq/core";
import { issueToken, verifyToken, encodeNimiqSignedMessage } from "../worker/auth.js";

const host = "NQ49 A9A5 9UFL SDTQ 8HPU 5U43 1V4T EYMS EPT0";
const lot = { id: "regression-lot", title: "Test", hostPaddle: 7, hostAddress: host, startPriceLunas: 100000, minIncrementLunas: 100000, durationSec: 60 };
function makeRoom() {
  const data = new Map();
  const state = {
    storage: {
      get: async (key) => structuredClone(data.get(key)),
      put: async (key, value) => data.set(key, structuredClone(value)),
      setAlarm: async (value) => data.set("alarm", value)
    },
    getWebSockets: () => []
  };
  return { room: new AuctionRoom(state, {}), state, data };
}

test("room initialization failure does not strand a committed lot without host control", async () => {
  const key = KeyPair.generate();
  const address = key.toAddress().toUserFriendlyAddress();
  const secret = crypto.randomUUID();
  const challenge = { id: "challenge-fixture", message: "One-time fixture", host_address: address, expires_at: Date.now() + 60000, used_at: null };
  let inserted = false;
  const DB = { prepare(sql) { return { bind() { return this; }, first: async () => challenge, run: async () => { if (sql.includes("INSERT INTO lots")) inserted = true; return { meta: { changes: 1 } }; } }; } };
  const env = { DB, NIMGAVEL_SECRET: secret, ROOM: { idFromName: id => id, get: () => ({ fetch: async () => { throw new Error("injected room outage"); } }) } };
  const paddleToken = await issueToken({ type: "paddle", paddle: 7, deviceHash: "fixture" }, secret);
  const body = { ...lot, hostAddress: address, challengeId: challenge.id, paddleToken, publicKey: key.publicKey.toHex(), signature: key.sign(Hash.computeSha256(encodeNimiqSignedMessage(challenge.message))).toHex() };
  const response = await worker.fetch(new Request("http://localhost/api/lots", { method: "POST", body: JSON.stringify(body) }), env);
  assert.equal(inserted, true);
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.roomReady, false);
  assert.equal((await verifyToken(created.hostToken, secret, { type: "host", lotId: created.lot.id })).ok, true);
});

test("public DO control paths never reach the room", async () => {
  let forwarded = 0;
  const env = { ROOM: { idFromName: x => x, get: () => ({ fetch: async () => { forwarded++; return Response.json({ ok: true }); } }) } };
  for (const action of ["seed", "start"]) {
    const result = await worker.fetch(new Request(`http://localhost/ws/lot/${action}`, { method: "POST", body: "{}" }), env);
    assert.equal(result.status, 404);
  }
  assert.equal(forwarded, 0);
});

test("a socket cannot bid before authenticating", async () => {
  const { room } = makeRoom();
  await room.ensureLot(lot);
  await room.start();
  const messages = [];
  const socket = { send: text => messages.push(JSON.parse(text)), deserializeAttachment: () => ({ paddle: 9, alias: "Forged" }), serializeAttachment: () => {} };
  await room.webSocketMessage(socket, JSON.stringify({ type: "bid", amountLunas: 100000 }));
  assert.equal(room.currentBid, 0);
  assert.equal(messages.at(-1).code, "invalid_token");
});

test("a delayed alarm cannot let a bid reopen an expired auction", async () => {
  const { room } = makeRoom();
  await room.ensureLot(lot);
  await room.start(1000);
  await assert.rejects(room.placeBid(9, "Bidder", 100000, 61000), /gavel/i);
  assert.equal(room.currentBid, 0);
});

test("retrying a partially persisted start repairs D1 without resetting the auction", async () => {
  const { room } = makeRoom();
  await room.ensureLot(lot);
  room.persistToD1 = async () => { throw new Error("injected start outage"); };
  await assert.rejects(room.start(1000), /start outage/);
  let patch;
  room.persistToD1 = async value => { patch = value; };
  const response = await room.handleStart(new Request("http://localhost/start", { method: "POST" }));
  assert.equal(response.status, 200);
  assert.deepEqual(patch, { status: "live", startedAt: 1000 });
  assert.equal(room.endsAt, 61000);
});

test("D1 finalization failure is retryable across object restoration", async () => {
  const { room, state } = makeRoom();
  await room.ensureLot(lot);
  room.phase = "sold";
  room.leading = { paddle: 9, alias: "Bidder" };
  room.currentBid = 100000;
  await room.save();
  room.persistToD1 = async () => { throw new Error("injected D1 outage"); };
  await assert.rejects(room.alarm(), /D1 outage/);
  const restored = new AuctionRoom(state, {});
  let writes = 0;
  restored.persistToD1 = async () => { writes++; };
  await restored.alarm();
  assert.equal(writes, 1);
  assert.equal(restored.finalized, true);
});

test("every soft-close bid broadcasts the revised deadline", async () => {
  const { room } = makeRoom();
  await room.ensureLot(lot);
  await room.start(1000);
  room.phase = "going_once";
  const messages = [];
  room.broadcast = message => messages.push(message);
  await room.placeBid(9, "Bidder", 100000, 40000);
  assert.equal(messages.find(m => m.type === "bid").endsAt, 70000);
});

test("all five-decimal NIM values convert exactly", () => {
  for (let lunas = 1; lunas < 10000; lunas++) assert.equal(nimToLunas((lunas / 100000).toFixed(5)), lunas);
});

test("wallet results accept hashes and reference-bearing serialized transactions", () => {
  const key = KeyPair.generate();
  const target = KeyPair.generate().toAddress();
  for (const network of [24, 5]) {
    const tx = new Transaction(key.toAddress(), 0, new Uint8Array(), target, 0, new TextEncoder().encode("Nimgavel:test"), 7n, 0n, 0, 100, network);
    tx.sign(key);
    assert.equal(readWalletPayment(tx.toHex(), Transaction).txHash, tx.hash());
    assert.equal(readWalletPayment(tx.hash(), Transaction).txHash, tx.hash());
  }
  assert.throws(() => readWalletPayment({}, Transaction), /unknown payment/);
});

test("join derives identity and preserves expiry in the socket attachment", async () => {
  const { room } = makeRoom();
  const secret = crypto.randomUUID();
  room.env = { NIMGAVEL_SECRET: secret, DB: { prepare: () => ({ bind: () => ({ first: async () => ({ alias: "Server Alias" }) }) }) } };
  let attachment = {};
  const messages = [];
  const ws = { deserializeAttachment: () => attachment, serializeAttachment: value => { attachment = structuredClone(value); }, send: data => messages.push(JSON.parse(data)) };
  const token = await issueToken({ type: "paddle", paddle: 9, deviceHash: "fixture" }, secret);
  await room.join(ws, token);
  assert.equal(attachment.paddle, 9);
  assert.equal(attachment.alias, "Server Alias");
  assert.ok(attachment.exp > Date.now() / 1000);
  room.sessions.clear();
  assert.equal(room.sessionFor(ws).exp, attachment.exp);
  const expired = await issueToken({ type: "paddle", paddle: 10, exp: 1 }, secret);
  await room.join(ws, expired);
  assert.equal(messages.at(-1).code, "invalid_token");
  assert.equal(room.sessionFor(ws).paddle, 9);
});

test("streamed request bodies are limited without trusting Content-Length", async () => {
  const oversized = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(321 * 1024)); controller.close(); } });
  const result = await worker.fetch(new Request("http://localhost/api/host/challenge", { method: "POST", body: oversized, duplex: "half" }), {});
  assert.equal(result.status, 413);
});

test("settlement fails closed on mismatched or incomplete RPC evidence", async (t) => {
  const hash = "11".repeat(32);
  const good = { hash, to: host, value: 100000, executionResult: true, confirmations: 120, blockNumber: 100, networkId: 24, recipientData: Buffer.from("Nimgavel:regression-lot").toString("hex") };
  const input = { txHash: hash, hostAddress: host, amountLunas: 100000, lotId: lot.id, network: "mainnet", rpcUrl: "http://localhost" };
  for (const patch of [{ hash: "ff".repeat(32) }, { executionResult: undefined }, { confirmations: 0 }, { recipientData: "" }, { networkId: 5 }]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ result: { data: { ...good, ...patch } } }));
    assert.notEqual((await verifySettlement(input)).status, "verified", JSON.stringify(patch));
    t.mock.restoreAll();
  }
});
