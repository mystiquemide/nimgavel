// AuctionRoom Durable Object: the authoritative state machine for one lot.
// All bid validation and ordering happens here. Single writer, no races.

import { verifyToken } from "./auth.js";
import { bidKey, highestActiveBid } from "../lib/bids.js";

const SOFT_CLOSE_MS = 30_000; // bids inside the final 30s extend by 30s
const GOING_ONCE_MS = 30_000; // final-call window begins
const GOING_TWICE_MS = 15_000; // urgency window
const BID_COOLDOWN_MS = 500; // per-paddle rate limit
const MAX_BID_LUNAS = 1e12;
const FEED_SIZE = 100;
// Per-connection flood guard: valid bids are already limited to 2/s per
// paddle, so anything beyond this rate is junk, close the connection.
const MSG_CAP_WINDOW_MS = 10_000;
const MSG_CAP_MAX = 100;

const PHASES = ["created", "live", "going_once", "going_twice", "sold", "passed"];

export class AuctionRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // webSocket -> { paddle, alias, lastBidAt }
    this.loaded = false;
    this.finalized = false;
    this.pendingRemovals = [];
    this.revision = 0;
  }

  // ---------- persistence ----------

  async load() {
    if (this.loaded) return;
    const stored = await this.state.storage.get("snapshot");
    if (stored) {
      this.lot = stored.lot;
      this.phase = stored.phase;
      this.endsAt = stored.endsAt;
      this.currentBid = stored.currentBid;
      this.leading = stored.leading; // { paddle, alias } | null
      this.bidLog = stored.bidLog || [];
      this.pendingRemovals = stored.pendingRemovals || [];
      this.revision = stored.revision || 0;
      this.startedAt = stored.startedAt;
      this.finalized = Boolean(stored.finalized);
    } else {
      this.lot = null;
      this.phase = "created";
      this.endsAt = 0;
      this.currentBid = 0;
      this.leading = null;
      this.bidLog = [];
      this.startedAt = null;
      this.finalized = false;
    }
    this.loaded = true;
  }

  async save() {
    await this.state.storage.put("snapshot", {
      lot: this.lot,
      phase: this.phase,
      endsAt: this.endsAt,
      currentBid: this.currentBid,
      leading: this.leading,
      bidLog: this.bidLog,
      startedAt: this.startedAt,
      finalized: this.finalized,
      pendingRemovals: this.pendingRemovals,
      revision: this.revision,
    });
  }

  // ---------- lot lifecycle ----------

  async ensureLot(lot) {
    await this.load();
    if (!this.lot) {
      this.lot = lot;
      this.phase = "created";
      await this.save();
    }
    return this.lot;
  }

  async start(now = Date.now()) {
    await this.load();
    if (!this.lot) throw new Error("no lot");
    if (this.phase !== "created") throw new Error("already started");
    this.phase = "live";
    this.startedAt = now;
    this.endsAt = now + this.lot.durationSec * 1000;
    this.revision += 1;
    await this.save();
    await this.armAlarm(now);
    await this.persistToD1({ status: "live", startedAt: now });
    this.broadcast(this.stateMessage());
    return this.stateMessage();
  }

  phaseFor(remaining) {
    if (remaining > GOING_ONCE_MS) return "live";
    if (remaining > GOING_TWICE_MS) return "going_once";
    if (remaining > 0) return "going_twice";
    return this.currentBid > 0 ? "sold" : "passed";
  }

  async tick(now = Date.now()) {
    await this.load();
    if (!this.lot || !["live", "going_once", "going_twice"].includes(this.phase)) return;
    const remaining = this.endsAt - now;
    const next = this.phaseFor(remaining);
    if (next !== this.phase) {
      this.phase = next;
      const revision = ++this.revision;
      await this.save();
      if (next === "sold") await this.close(now);
      else if (next === "passed") await this.close(now);
      else {
        await this.armAlarm(now);
        this.broadcast({ type: "phase", revision, phase: next, endsAt: this.endsAt, serverNow: now });
      }
    }
  }

  async close(now) {
    await this.state.storage.setAlarm(now + 1);
  }

  async alarm() {
    await this.load();
    const now = Date.now();
    if (!this.lot) return;
    if (this.pendingRemovals.length) {
      await this.state.storage.setAlarm(now + 5000);
      await this.persistRemovals();
    }

    if (this.phase === "sold" || this.phase === "passed") {
      // Finalization path: persist idempotent D1 writes before the flag,
      // so a crash or D1 outage leaves the result retryable.
      if (!this.finalized) {
        await this.state.storage.setAlarm(now + 5000);
        await this.persistToD1({
          status: this.phase,
          endedAt: this.endsAt,
          winningPaddle: this.phase === "sold" ? this.leading?.paddle ?? null : null,
          winningBidLunas: this.phase === "sold" ? this.currentBid : null,
        });
        this.finalized = true;
        await this.save();
        this.broadcast(
          this.phase === "sold"
            ? { type: "sold", winningPaddle: this.leading.paddle, alias: this.leading.alias, amountLunas: this.currentBid, hostAddress: this.lot.hostAddress }
            : { type: "passed", reason: "no bids" }
        );
      }
      return;
    }

    // Phase transition check
    if (this.startedAt) await this.persistToD1({ status: "live", startedAt: this.startedAt });
    await this.tick(now);

    // Re-arm for the next boundary if still running
    if (["live", "going_once", "going_twice"].includes(this.phase)) {
      await this.armAlarm(now);
    }
  }

  async armAlarm(now) {
    const remaining = this.endsAt - now;
    let nextBoundary;
    if (remaining > GOING_ONCE_MS) nextBoundary = this.endsAt - GOING_ONCE_MS;
    else if (remaining > GOING_TWICE_MS) nextBoundary = this.endsAt - GOING_TWICE_MS;
    else nextBoundary = this.endsAt;
    if (this.pendingRemovals.length) nextBoundary = Math.min(nextBoundary, now + 5000);
    await this.state.storage.setAlarm(Math.max(nextBoundary, now + 50));
  }

  // ---------- bidding ----------

  minNextBidLunas() {
    if (!this.currentBid) return this.lot.startPriceLunas;
    return this.currentBid + this.lot.minIncrementLunas;
  }

  async placeBid(paddle, alias, amountLunas, now = Date.now()) {
    await this.load();
    if (!this.lot || now >= this.endsAt) throw new RoomError("not_live", "The gavel already fell.");
    if (!["live", "going_once", "going_twice"].includes(this.phase)) {
      throw new RoomError("not_live", "The gavel already fell.");
    }
    if (paddle === this.lot.hostPaddle) {
      throw new RoomError("host_cannot_bid", "Hosts watch, bidders win.");
    }
    const min = this.minNextBidLunas();
    if (!Number.isInteger(amountLunas) || amountLunas < min) {
      throw new RoomError("outbid_increment", `Bid at least ${min} Lunas.`);
    }
    if (amountLunas > MAX_BID_LUNAS) {
      throw new RoomError("outbid_increment", "Bid too large.");
    }
    const session = [...this.sessions.values()].find((s) => s.paddle === paddle);
    const lastBid = this.bidLog.findLast((bid) => bid.paddle === paddle);
    if (lastBid && now - lastBid.ts < BID_COOLDOWN_MS) {
      throw new RoomError("rate_limited", "Easy, auctioneer.");
    }

    const prevPhase = this.phase;
    const revision = ++this.revision;
    this.currentBid = amountLunas;
    this.leading = { paddle, alias };
    // Full bid history: the WS feed slices to FEED_SIZE for clients, but
    // the DO log and D1 archive keep every bid of the war.
    const bid = { paddle, alias, amountLunas, ts: now };
    this.bidLog.push(bid);

    // Soft close: any valid bid inside the final 30s extends by 30s
    if (this.endsAt - now <= SOFT_CLOSE_MS) {
      this.endsAt = now + SOFT_CLOSE_MS;
    }
    const remaining = this.endsAt - now;
    this.phase = this.phaseFor(remaining);
    await this.save();
    await this.armAlarm(now);
    if (session) session.lastBidAt = now;

    this.broadcast({ type: "bid", revision, id: bidKey(bid), paddle, alias, amountLunas, ts: now, endsAt: this.endsAt, serverNow: now });
    if (this.phase !== prevPhase && this.phase !== "sold") {
      this.broadcast({ type: "phase", revision, phase: this.phase, endsAt: this.endsAt, serverNow: now });
    }
    return { ok: true, currentBid: this.currentBid, endsAt: this.endsAt };
  }

  async removeBid({ bidId, actor, reason }, now = Date.now()) {
    await this.load();
    const bid = this.bidLog.find(entry => bidKey(entry) === bidId);
    if (!this.lot || !bid) throw new RoomError("bid_not_found", "Bid not found.");
    if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 280) {
      throw new RoomError("invalid_reason", "Give a reason between 1 and 280 characters.");
    }
    const ownsBid = actor?.role === "bidder" && Number.isSafeInteger(actor.paddle) && actor.paddle > 0 && actor.paddle === bid.paddle;
    const isHost = actor?.role === "host" && actor.hostAddress === this.lot.hostAddress;
    if (!ownsBid && !isHost) throw new RoomError("forbidden", "Only this bidder or the host can remove the bid.");
    if (bid.removal) return this.stateMessage(now);
    const running = ["live", "going_once", "going_twice"].includes(this.phase);
    const live = running && now < this.endsAt;
    const previousLeader = highestActiveBid(this.bidLog);
    if (!live && bid === previousLeader) throw new RoomError("winning_bid_locked", "The winning bid is locked after the auction closes.");
    const removedBy = isHost ? this.lot.hostAddress : String(actor.paddle);
    const last = this.bidLog.filter(entry => entry.removal?.removedBy === removedBy).reduce((time, entry) => Math.max(time, entry.removal.removedAt), 0);
    if (last && now - last < 1000) throw new RoomError("rate_limited", "Wait a moment before removing another bid.");
    this.revision += 1;
    bid.removal = { removedAt: now, removedBy, role: actor.role, reason: reason.trim() };
    this.pendingRemovals.push(bidId);
    if (live) {
      const leader = highestActiveBid(this.bidLog);
      this.currentBid = leader?.amountLunas || 0;
      this.leading = leader ? { paddle: leader.paddle, alias: leader.alias } : null;
      if (previousLeader === bid) this.endsAt = Math.max(this.endsAt, now + SOFT_CLOSE_MS);
      this.phase = this.phaseFor(this.endsAt - now);
    } else if (running) {
      this.phase = this.phaseFor(this.endsAt - now);
    }
    await this.save();
    if (live) await this.armAlarm(now);
    else await this.state.storage.setAlarm(now + 1);
    const state = this.stateMessage(now);
    this.broadcast(state);
    return state;
  }

  async persistRemovals() {
    if (!this.env.DB || !this.pendingRemovals.length) return;
    const pending = new Set(this.pendingRemovals);
    const bids = this.bidLog.filter(bid => pending.has(bidKey(bid)) && bid.removal);
    const stmt = this.env.DB.prepare(`INSERT OR IGNORE INTO bid_removals
      (lot_id, bid_id, paddle, amount_lunas, bid_created_at, removed_at, removed_by, role, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let offset = 0; offset < bids.length; offset += 100) {
      await this.env.DB.batch(bids.slice(offset, offset + 100).map(bid => stmt.bind(
        this.lot.id, bidKey(bid), bid.paddle, bid.amountLunas, bid.ts,
        bid.removal.removedAt, bid.removal.removedBy, bid.removal.role, bid.removal.reason
      )));
    }
    const acknowledged = new Set(bids.map(bidKey));
    this.pendingRemovals = this.pendingRemovals.filter(id => !acknowledged.has(id));
    await this.save();
  }

  async handleRemoveBid(request) {
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ error: "Invalid removal request." }, { status: 400 }); }
    try {
      await this.removeBid(body);
      await this.persistRemovals();
      return Response.json({ ok: true, state: this.stateMessage() });
    } catch (error) {
      const statuses = { forbidden: 403, bid_not_found: 404, invalid_reason: 400, winning_bid_locked: 409, rate_limited: 429 };
      return Response.json({ error: error instanceof RoomError ? error.message : "Bid removal could not be fully synchronized. Refresh and retry." }, { status: statuses[error.code] || 503 });
    }
  }

  // ---------- websocket ----------

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);

    if (url.pathname.endsWith("/start")) {
      return this.handleStart(request);
    }
    if (url.pathname.endsWith("/state")) {
      return Response.json(this.stateMessage());
    }
    if (url.pathname.endsWith("/seed")) {
      return this.handleSeed(request);
    }
    if (url.pathname.endsWith("/remove-bid") && request.method === "POST") {
      return this.handleRemoveBid(request);
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({ error: "websocket required" }, { status: 426 });
    }
    return this.handleWs(request);
  }

  async handleSeed(request) {
    // Dev/QA helper: install a lot definition directly into this DO.
    const lot = await request.json();
    await this.ensureLot(lot);
    return Response.json(this.stateMessage());
  }

  async handleStart(request) {
    try {
      await this.load();
      if (["live", "going_once", "going_twice"].includes(this.phase)) {
        await this.persistToD1({ status: "live", startedAt: this.startedAt });
        return Response.json(this.stateMessage());
      }
      const msg = await this.start();
      return Response.json(msg);
    } catch (e) {
      return Response.json({ error: e.message }, { status: 409 });
    }
  }

  async handleWs(request) {
    if (!this.lot) return Response.json({ error: "Lot not found." }, { status: 404 });
    if (this.state.getWebSockets().length >= 200) return Response.json({ error: "Room is full." }, { status: 503 });
    const paddle = 0;
    const alias = "Spectator";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ paddle, alias });
    this.sessions.set(server, { paddle, alias, lastBidAt: 0, msgCount: 0, msgWindowStart: 0 });

    // Initial state to the new connection
    server.send(JSON.stringify(this.stateMessage()));
    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation handlers: messages arrive here, surviving DO eviction.
  async webSocketMessage(server, data) {
    await this.load();

    if (!this.withinMessageCap(server)) return;
    if (typeof data !== "string" || new TextEncoder().encode(data).length > 4096) {
      server.close(1009, "Message too large.");
      return;
    }

    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      server.send(JSON.stringify({ type: "error", code: "bad_json", message: "Bad message." }));
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "join") {
      try { await this.join(server, msg.paddleToken); }
      catch { server.send(JSON.stringify({ type: "error", code: "invalid_token", message: "Paddle authentication is unavailable. Reconnect your wallet." })); }
      return;
    }
    if (msg.type !== "bid") return;

    const session = this.sessionFor(server);
    try {
      if (!session.exp || session.exp <= Date.now() / 1000 || !Number.isSafeInteger(session.paddle) || session.paddle < 1) {
        throw new RoomError("invalid_token", "Authenticate your paddle before bidding.");
      }
      await this.placeBid(session.paddle, session.alias, msg.amountLunas);
      // Confirmation is the bid broadcast (own paddle); no separate ack.
    } catch (e) {
      const code = e instanceof RoomError ? e.code : "internal";
      const message = e instanceof RoomError ? e.message : "Something went wrong.";
      server.send(JSON.stringify({ type: "error", code, message }));
    }
  }

  async join(server, token) {
    const secret = this.env.NIMGAVEL_SECRET || this.env.PADDLE_SECRET || this.env.WORKER_SECRET;
    const result = typeof secret === "string" && secret.length >= 32
      ? await verifyToken(token, secret, { type: "paddle" }) : { ok: false };
    const paddle = result.payload?.paddle;
    const record = result.ok && Number.isSafeInteger(paddle) && paddle > 0
      ? await this.env.DB.prepare("SELECT alias FROM paddles WHERE paddle = ? AND device_hash = ?").bind(paddle, result.payload.deviceHash).first() : null;
    if (!record) {
      server.send(JSON.stringify({ type: "error", code: "invalid_token", message: "Paddle authorization is invalid or expired." }));
      return;
    }
    const session = this.sessionFor(server);
    if (session.exp && session.paddle !== paddle) {
      server.send(JSON.stringify({ type: "error", code: "invalid_token", message: "Reconnect to change paddles." }));
      return;
    }
    Object.assign(session, { paddle, alias: record.alias, exp: result.payload.exp });
    server.serializeAttachment(session);
    server.send(JSON.stringify({ type: "joined", paddle, alias: record.alias }));
  }

  async webSocketClose(server) {
    this.sessions.delete(server);
  }

  // Flood guard: counts every inbound frame per connection in a rolling
  // window. Over the cap the connection is closed with 1008. Counters are
  // stored in socket attachments to survive Durable Object hibernation.
  withinMessageCap(server) {
    const session = this.sessionFor(server);
    const now = Date.now();
    if (!session.msgWindowStart || now - session.msgWindowStart >= MSG_CAP_WINDOW_MS) {
      session.msgWindowStart = now;
      session.msgCount = 0;
    }
    session.msgCount = (session.msgCount || 0) + 1;
    if (session.msgCount > MSG_CAP_MAX) {
      this.sessions.delete(server);
      try { server.close(1008, "Message cap exceeded."); } catch {}
      return false;
    }
    server.serializeAttachment(session);
    return true;
  }

  sessionFor(ws) {
    if (!this.sessions.has(ws)) {
      let att = {};
      try {
        att = ws.deserializeAttachment() || {};
      } catch {}
      this.sessions.set(ws, {
        paddle: att.paddle ?? 0,
        alias: att.alias || "Paddle",
        exp: att.exp,
        lastBidAt: 0,
        msgCount: att.msgCount || 0,
        msgWindowStart: att.msgWindowStart || 0,
      });
    }
    return this.sessions.get(ws);
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }

  stateMessage(now = Date.now()) {
    const active = this.bidLog.filter(bid => !bid.removal);
    const removed = this.bidLog.filter(bid => bid.removal);
    const leader = highestActiveBid(active);
    return {
      type: "state",
      revision: this.revision,
      lot: this.lot
        ? {
            id: this.lot.id,
            title: this.lot.title,
            description: this.lot.description,
            imageUrl: this.lot.imageUrl,
            hostPaddle: this.lot.hostPaddle,
            startPriceLunas: this.lot.startPriceLunas,
            minIncrementLunas: this.lot.minIncrementLunas,
            durationSec: this.lot.durationSec,
          }
        : null,
      phase: this.phase,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      serverNow: now,
      currentBidLunas: this.currentBid,
      leadingPaddle: this.leading,
      minNextBidLunas: this.minNextBidLunasSafe(),
      bids: active.slice(-FEED_SIZE).map(bid => ({ ...bid, id: bidKey(bid) })),
      removedBids: removed.slice(-FEED_SIZE).map(bid => ({ ...bid, id: bidKey(bid) })),
      bidCount: active.length,
      removedBidCount: removed.length,
      leadingBidId: leader ? bidKey(leader) : null,
      archivePending: this.pendingRemovals.length > 0,
      connections: this.state.getWebSockets().length,
    };
  }

  minNextBidLunasSafe() {
    return this.lot ? this.minNextBidLunas() : 0;
  }

  // ---------- D1 persistence ----------

  async persistToD1(patch) {
    if (!this.env.DB || !this.lot) return;
    const sets = [];
    const args = [];
    if (patch.status !== undefined) { sets.push("status = ?"); args.push(patch.status); }
    if (patch.startedAt !== undefined) { sets.push("started_at = ?"); args.push(patch.startedAt); }
    if (patch.endedAt !== undefined) { sets.push("ended_at = ?"); args.push(patch.endedAt); }
    if (patch.winningPaddle !== undefined) { sets.push("winning_paddle = ?"); args.push(patch.winningPaddle); }
    if (patch.winningBidLunas !== undefined) { sets.push("winning_bid_lunas = ?"); args.push(patch.winningBidLunas); }
    if (!sets.length) return;
    args.push(this.lot.id);
    await this.env.DB.prepare(`UPDATE lots SET ${sets.join(", ")} WHERE id = ? AND status != 'settled'`).bind(...args).run();

    if (patch.status === "sold" || patch.status === "passed") {
      // Idempotent: re-finalization after a crash must not duplicate rows.
      // The full log, not the feed slice: the archive must hold every bid.
      const rows = this.bidLog.map((b) => [this.lot.id, b.paddle, b.amountLunas, b.ts]);
      if (rows.length) {
        const stmt = this.env.DB.prepare("INSERT OR IGNORE INTO bids (lot_id, paddle, amount_lunas, created_at) VALUES (?, ?, ?, ?)");
        await this.env.DB.batch(rows.map((r) => stmt.bind(...r)));
      }
    }
  }
}

export class RoomError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export { PHASES };
