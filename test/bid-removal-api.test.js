import { test } from "node:test";
import assert from "node:assert/strict";
import { Hash, KeyPair } from "@nimiq/core";
import { encodeNimiqSignedMessage } from "../worker/auth.js";
import { BASE, api, makeLot, makePaddle, startAuction } from "./fixtures.js";

async function post(path, body, token) {
  const response = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function connect(lotId, paddle) {
  const socket = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws/${lotId}`);
  const messages = [];
  socket.addEventListener("message", event => messages.push(JSON.parse(event.data)));
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const wait = async predicate => {
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error("Timed out waiting for room event");
  };
  socket.send(JSON.stringify({ type: "join", paddleToken: paddle.paddleToken }));
  await wait(message => message.type === "joined");
  return { socket, wait, bid: async amountLunas => { socket.send(JSON.stringify({ type: "bid", amountLunas })); return wait(message => message.type === "bid" && message.paddle === paddle.paddle && message.amountLunas === amountLunas); } };
}

test("authenticated bid removal works live and after settlement without rewriting the winner", async t => {
  const created = await makeLot({ title: "Synthetic bid-removal integration", durationSec: 5 });
  const second = await makeLot();
  const a = await makePaddle();
  const b = await makePaddle();
  const c = await makePaddle();
  await startAuction(created);
  const connections = await Promise.all([a, b, c].map(paddle => connect(created.lot.id, paddle)));
  t.after(() => connections.forEach(connection => connection.socket.close()));
  const first = await connections[0].bid(100000);
  const middle = await connections[1].bid(200000);
  const top = await connections[2].bid(300000);
  const path = bid => `/api/lots/${created.lot.id}/bids/${bid.id}/remove`;
  const reason = "Accidental amount";
  assert.equal((await post(path(top), { reason })).status, 401);
  assert.equal((await post(path(top), { reason }, a.paddleToken)).status, 403);
  assert.equal((await post(path(top), { role: "host", reason }, second.hostToken)).status, 401);
  assert.equal((await post(path(top), { role: "host", reason }, c.paddleToken)).status, 401);
  assert.equal((await post(`/ws/${created.lot.id}/remove-bid`, { bidId: top.id, actor: { role: "host", hostAddress: created.lot.hostAddress }, reason })).status, 404);
  const removedMiddle = await post(path(middle), { reason }, b.paddleToken);
  assert.equal(removedMiddle.status, 200);
  assert.equal(removedMiddle.body.state.currentBidLunas, 300000);
  const moderated = await post(path(top), { role: "host", reason: "Invalid entry" }, created.hostToken);
  assert.equal(moderated.status, 200);
  assert.equal(moderated.body.state.currentBidLunas, 100000);
  assert.equal(moderated.body.state.leadingPaddle.paddle, a.paddle);
  assert.ok(moderated.body.state.endsAt >= moderated.body.state.serverNow + 29000);
  const replay = await post(path(top), { role: "host", reason: "Changed" }, created.hostToken);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.state.removedBids.find(bid => bid.id === top.id).removal.reason, "Invalid entry");
  await new Promise(resolve => setTimeout(resolve, 600));
  const winning = await connections[1].bid(200000);
  assert.notEqual(winning.id, middle.id);
  await connections[1].wait(message => message.type === "sold");
  const txHash = "ab".repeat(32);
  assert.equal((await post(`/api/lots/${created.lot.id}/settle`, { txHash }, b.paddleToken)).status, 201);
  for (const [role, token] of [["bidder", b.paddleToken], ["host", created.hostToken]]) {
    assert.equal((await post(path(winning), { role, reason }, token)).status, 409);
  }
  assert.equal((await post(path(first), { reason: "Remove my losing entry" }, a.paddleToken)).status, 200);
  const detail = await api(`/api/lots/${created.lot.id}`);
  assert.equal(detail.lot.status, "settled");
  assert.equal(detail.lot.txHash, txHash);
  assert.equal(detail.lot.winningPaddle, b.paddle);
  assert.equal(detail.lot.winningBidLunas, 200000);
  assert.equal(detail.bids.length, 1);
  assert.equal(detail.bids[0].id, winning.id);
  assert.equal(detail.removedBids.length, 3);
});

test("fresh host authorization is wallet-signed, lot-bound, purpose-bound and single-use", async () => {
  const created = await makeLot();
  const other = await makeLot({}, created.host, created.keyPair);
  const foreignAddress = KeyPair.generate().toAddress().toUserFriendlyAddress();
  const hostAddress = created.lot.hostAddress;
  const generic = await api("/api/host/challenge", { method: "POST", body: JSON.stringify({ hostAddress }) });
  const sign = challenge => ({ challengeId: challenge.id, publicKey: created.keyPair.publicKey.toHex(), signature: created.keyPair.sign(Hash.computeSha256(encodeNimiqSignedMessage(challenge.message))).toHex() });
  assert.equal((await post(`/api/lots/${created.lot.id}/authorize`, sign(generic.challenge))).status, 401);
  const scoped = await api("/api/host/challenge", { method: "POST", body: JSON.stringify({ hostAddress, lotId: created.lot.id }) });
  const proof = sign(scoped.challenge);
  assert.equal((await post(`/api/lots/${other.lot.id}/authorize`, proof)).status, 401);
  assert.equal((await post("/api/lots", { ...proof, hostAddress, hostPaddle: created.host.paddle, paddleToken: created.host.paddleToken, title: "Cross-purpose attempt", startPriceLunas: 100000, minIncrementLunas: 100000, durationSec: 60 })).status, 400);
  assert.equal((await post(`/api/lots/${created.lot.id}/authorize`, { ...proof, signature: "00".repeat(64) })).status, 401);
  const renewed = await post(`/api/lots/${created.lot.id}/authorize`, proof);
  assert.equal(renewed.status, 200);
  assert.ok(renewed.body.hostToken);
  assert.equal((await post(`/api/lots/${created.lot.id}/authorize`, proof)).status, 400);
  assert.equal((await post("/api/host/challenge", { hostAddress: foreignAddress, lotId: created.lot.id })).status, 403);
});
