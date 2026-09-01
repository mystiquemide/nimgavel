// AuctionRoom Durable Object: the authoritative state machine for one lot.
// All bid validation and ordering happens here. Single writer, no races.

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
      this.startedAt = stored.startedAt;
    } else {
      this.lot = null;
      this.phase = "created";
      this.endsAt = 0;
      this.currentBid = 0;
      this.leading = null;
      this.bidLog = [];
      this.startedAt = null;
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
      await this.save();
      if (next === "sold") await this.close(now);
      else if (next === "passed") await this.close(now);
      else {
        await this.armAlarm(now);
        this.broadcast({ type: "phase", phase: next, endsAt: this.endsAt, serverNow: now });
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

    if (this.phase === "sold" || this.phase === "passed") {
      // Finalization path: persist result once, then stop.
      if (!this.finalized) {
        this.finalized = true;
        await this.persistToD1({
          status: this.phase,
          endedAt: now,
          winningPaddle: this.phase === "sold" ? this.leading?.paddle ?? null : null,
          winningBidLunas: this.phase === "sold" ? this.currentBid : null,
        });
        this.broadcast(
          this.phase === "sold"
            ? { type: "sold", winningPaddle: this.leading.paddle, alias: this.leading.alias, amountLunas: this.currentBid, hostAddress: this.lot.hostAddress }
            : { type: "passed", reason: "no bids" }
        );
        await this.save();
      }
      return;
    }

    // Phase transition check
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
    await this.state.storage.setAlarm(Math.max(nextBoundary, now + 50));
  }

  // ---------- bidding ----------

  minNextBidLunas() {
    if (!this.currentBid) return this.lot.startPriceLunas;
    return this.currentBid + this.lot.minIncrementLunas;
  }

  async placeBid(paddle, alias, amountLunas, now = Date.now()) {
    await this.load();
    if (!this.lot) throw new RoomError("not_live", "The gavel already fell.");
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
    if (session && now - session.lastBidAt < BID_COOLDOWN_MS) {
      throw new RoomError("rate_limited", "Easy, auctioneer.");
    }

    const prevPhase = this.phase;
    this.currentBid = amountLunas;
    this.leading = { paddle, alias };
    this.bidLog.push({ paddle, alias, amountLunas, ts: now });
    if (this.bidLog.length > FEED_SIZE) this.bidLog.shift();

    // Soft close: any valid bid inside the final 30s extends by 30s
    if (this.endsAt - now <= SOFT_CLOSE_MS) {
      this.endsAt = now + SOFT_CLOSE_MS;
    }
    const remaining = this.endsAt - now;
    this.phase = this.phaseFor(remaining);
    await this.save();
    await this.armAlarm(now);
    if (session) session.lastBidAt = now;

    this.broadcast({ type: "bid", paddle, alias, amountLunas, ts: now });
    if (this.phase !== prevPhase && this.phase !== "sold") {
      this.broadcast({ type: "phase", phase: this.phase, endsAt: this.endsAt, serverNow: now });
    }
    return { ok: true, currentBid: this.currentBid, endsAt: this.endsAt };
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
      const msg = await this.start();
      return Response.json(msg);
    } catch (e) {
      return Response.json({ error: e.message }, { status: 409 });
    }
  }

  async handleWs(request) {
    const url = new URL(request.url);
    const paddle = Number(url.searchParams.get("paddle"));
    const alias = url.searchParams.get("alias") || "Paddle";

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

    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      server.send(JSON.stringify({ type: "error", code: "bad_json", message: "Bad message." }));
      return;
    }
    if (msg.type !== "bid") return;

    const session = this.sessionFor(server);
    try {
      await this.placeBid(session.paddle, session.alias, msg.amountLunas);
      // Confirmation is the bid broadcast (own paddle); no separate ack.
    } catch (e) {
      const code = e instanceof RoomError ? e.code : "internal";
      const message = e instanceof RoomError ? e.message : "Something went wrong.";
      server.send(JSON.stringify({ type: "error", code, message }));
    }
  }

  async webSocketClose(server) {
    this.sessions.delete(server);
  }

  // Flood guard: counts every inbound frame per connection in a rolling
  // window. Over the cap the connection is closed with 1008. Counters are
  // in-memory; DO hibernation resets them, which only relaxes the guard.
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
        lastBidAt: 0,
        msgCount: 0,
        msgWindowStart: 0,
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
    return {
      type: "state",
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
      endsAt: this.endsAt,
      serverNow: now,
      currentBidLunas: this.currentBid,
      leadingPaddle: this.leading,
      minNextBidLunas: this.minNextBidLunasSafe(),
      bids: this.bidLog.slice(-FEED_SIZE),
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
    await this.env.DB.prepare(`UPDATE lots SET ${sets.join(", ")} WHERE id = ?`).bind(...args).run();

    if (patch.status === "sold" || patch.status === "passed") {
      // Best effort bid log persistence
      const rows = this.bidLog.slice(-FEED_SIZE).map((b) => [this.lot.id, b.paddle, b.amountLunas, b.ts]);
      if (rows.length) {
        const stmt = this.env.DB.prepare("INSERT INTO bids (lot_id, paddle, amount_lunas, created_at) VALUES (?, ?, ?, ?)");
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
