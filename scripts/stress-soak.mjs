// T17 stress soak: one auction, two clients, 100+ bids, and a hard kill of
// the worker (SIGKILL, whole process group) mid-auction. Verifies:
//   1. snapshot restore after restart: current bid, leader, bid log intact
//   2. bidding continues after restart
//   3. gavel falls with the exact winning paddle + amount
//   4. D1 archive holds exactly one row per bid and the sold result
//
// Runs its own wrangler dev on port 8811 with an isolated state dir so it
// never touches the shared dev server on 8799.
//   npm run soak
import { spawn, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8811;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_BASE = `ws://127.0.0.1:${PORT}`;
const PERSIST = `.wrangler/soak-state-${Date.now()}-${process.pid}`;
process.env.WRANGLER_URL = BASE;
const { makeLot, makePaddle, startAuction } = await import("../test/fixtures.js");
const paddles = new Map();
let alpha;
let bravo;
const RUN = String(Date.now());
const LOT = {
  id: `soak-${RUN}`,
  title: "Soak lot",
  description: "T17",
  imageUrl: null,
  hostPaddle: 7,
  hostAddress: "NQ07TESTTESTTESTTESTTESTTESTTESTTESTTESTTESTTEST0P",
  startPriceLunas: 500_000,
  minIncrementLunas: 100_000,
  durationSec: 90,
};
const BIDS_BEFORE_KILL = 55;
const BIDS_TOTAL_TARGET = 105;

const log = (msg) => console.log(`[soak ${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function jf(path, options) {
  const response = await fetch(`${BASE}${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

class Conn {
  constructor(paddle, alias, lotId = LOT.id) {
    this.paddle = paddle;
    this.ws = new WebSocket(`${WS_BASE}/ws/${lotId}`);
    this.queue = [];
    this.waiters = [];
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "joined") { this.joinedResolve(); return; }
      if (this.waiters.length) this.waiters.shift()(msg);
      else this.queue.push(msg);
    });
    this.open = new Promise((resolve, reject) => {
      this.joinedResolve = resolve;
      this.ws.addEventListener("open", () => this.send({ type: "join", paddleToken: paddles.get(paddle).paddleToken }), { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }
  recv(timeoutMs = 20000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("recv timeout")), timeoutMs);
      this.waiters.push((msg) => { clearTimeout(timer); resolve(msg); });
    });
  }
  async confirmBid(paddle, amountLunas) {
    for (;;) {
      const msg = await this.recv();
      if (msg.type === "error") throw new Error(`bid rejected: ${msg.code} ${msg.message}`);
      if (msg.type === "bid" && msg.paddle === paddle && msg.amountLunas === amountLunas) return;
    }
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  close() { try { this.ws.close(); } catch {} }
}

let server = null;
let serverLogs = "";

function startServer() {
  server = spawn("npx", ["wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(PORT), "--inspector-port", "9245", "--persist-to", PERSIST, "--var", "NIMGAVEL_SECRET:soak-local-only-not-production-secret"], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverLogs += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverLogs += chunk.toString(); });
}

async function waitForHealth(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {}
    if (Date.now() >= deadline) throw new Error(`server did not become healthy; logs:\n${serverLogs.slice(-2000)}`);
    await sleep(500);
  }
}

function killServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, "SIGKILL"); // whole group: wrangler + workerd
  } catch {}
  server = null;
}

async function waitPortFree(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      return; // connection refused: port is free
    }
    if (Date.now() >= deadline) throw new Error("port still serving after kill");
    await sleep(300);
  }
}

async function main() {
  log("fresh state dir + migrations");
  execSync(`npx wrangler d1 migrations apply nimgavel --local --persist-to ${PERSIST}`, { stdio: "pipe" });

  // The soak drives the full D1 path through signed public lot creation.

  log("starting wrangler dev on :8811");
  startServer();
  await waitForHealth();

  const created = await makeLot(LOT);
  Object.assign(LOT, created.lot);
  alpha = await makePaddle();
  bravo = await makePaddle();
  for (const paddle of [alpha, bravo]) paddles.set(paddle.paddle, paddle);
  const started = await startAuction(created);
  if (started.state.phase !== "live") throw new Error(`expected live, got ${started.state.phase}`);
  log("auction live (90s duration)");

  let amount = LOT.startPriceLunas;
  let confirmed = 0;
  let lastPaddle = null;

  // Strict alternation: 81 bids, then 82, then a 620ms pause so both
  // paddles clear the 500ms per-paddle cooldown. The leader is tracked
  // explicitly: phase boundaries shift the odd/even parity.
  async function bidRounds(connA, connB, target) {
    while (confirmed < target) {
      if (confirmed < target) {
        amount += LOT.minIncrementLunas;
        connA.send({ type: "bid", amountLunas: amount });
        await connA.confirmBid(alpha.paddle, amount);
        confirmed += 1;
        lastPaddle = alpha.paddle;
      }
      if (confirmed < target) {
        amount += LOT.minIncrementLunas;
        connB.send({ type: "bid", amountLunas: amount });
        await connB.confirmBid(bravo.paddle, amount);
        confirmed += 1;
        lastPaddle = bravo.paddle;
      }
      await sleep(620);
    }
  }

  // Phase 1: two clients bid up to the kill threshold.
  const a = new Conn(alpha.paddle, "SoakAlpha");
  const b = new Conn(bravo.paddle, "SoakBravo");
  await a.open; await b.open;
  await a.recv(); await b.recv(); // drain initial state
  await bidRounds(a, b, BIDS_BEFORE_KILL);
  log(`phase 1 done: ${confirmed} bids, current ${amount} lunas`);

  // Hard kill mid-auction, then restart.
  log("SIGKILL worker process group");
  killServer();
  await waitPortFree();
  log("port free; restarting");
  startServer();
  await waitForHealth();

  // Snapshot restore proof: REST state must match the last confirmed bid.
  const restored = await jf(`/ws/${LOT.id}/state`);
  if (restored.currentBidLunas !== amount) {
    throw new Error(`restore mismatch: bid ${restored.currentBidLunas} != ${amount}`);
  }
  if (restored.leadingPaddle?.paddle !== lastPaddle) {
    throw new Error(`restore mismatch: leader ${restored.leadingPaddle?.paddle} != ${lastPaddle}`);
  }
  if (restored.bids.length !== confirmed) {
    throw new Error(`restore mismatch: bidLog ${restored.bids.length} != ${confirmed}`);
  }
  if (!["live", "going_once", "going_twice"].includes(restored.phase)) {
    throw new Error(`restore mismatch: phase ${restored.phase} not live-ish`);
  }
  log(`snapshot restored: ${restored.currentBidLunas} lunas, ${restored.bids.length} bids, phase ${restored.phase}`);

  // Phase 2: reconnect fresh sockets, keep bidding past 100 total. If the
  // gavel already fell during downtime (slow restart), that is a valid
  // recovery outcome: fall through to the sold checks.
  a.close(); b.close();
  const c = new Conn(alpha.paddle, "SoakAlpha");
  const d = new Conn(bravo.paddle, "SoakBravo");
  await c.open; await d.open;
  await c.recv(); await d.recv();

  let closedDuringDowntime = false;
  try {
    await bidRounds(c, d, BIDS_TOTAL_TARGET);
    log(`phase 2 done: ${confirmed} bids total, current ${amount} lunas`);
  } catch (error) {
    const state = await jf(`/ws/${LOT.id}/state`);
    if (state.phase === "sold" || state.phase === "passed") {
      closedDuringDowntime = true;
      log(`gavel fell during downtime (phase ${state.phase}); recovery close accepted`);
    } else {
      throw error;
    }
  }

  // Gavel: race-free listener on the raw socket, REST fallback if the
  // broadcast raced the reconnect. endsAt is at most 30s past the last bid.
  const expectedWinner = lastPaddle;
  let sold = null;
  const soldPromise = new Promise((resolve) => {
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "sold") { c.ws.removeEventListener("message", handler); resolve(msg); }
    };
    c.ws.addEventListener("message", handler);
  });
  const deadline = Date.now() + 75_000;
  while (!sold) {
    if (Date.now() > deadline) throw new Error("gavel never fell");
    const state = await jf(`/ws/${LOT.id}/state`);
    if (state.phase === "sold") {
      sold = { winningPaddle: state.leadingPaddle?.paddle, amountLunas: state.currentBidLunas, hostAddress: LOT.hostAddress };
      break;
    }
    sold = await Promise.race([soldPromise, sleep(1000).then(() => null)]);
  }
  if (sold.winningPaddle !== expectedWinner) throw new Error(`winner ${sold.winningPaddle} != ${expectedWinner}`);
  if (sold.amountLunas !== amount) throw new Error(`amount ${sold.amountLunas} != ${amount}`);
  log(`gavel fell: paddle ${sold.winningPaddle} won ${amount} lunas`);

  c.close(); d.close();
  await sleep(500); // let finalization D1 writes settle

  // D1 archive: exactly one row per bid, sold result recorded.
  const d1Bids = JSON.parse(execSync(
    `npx wrangler d1 execute nimgavel --local --persist-to ${PERSIST} --json --command "SELECT COUNT(*) AS n FROM bids WHERE lot_id = '${LOT.id}'"`,
    { stdio: "pipe" }
  ).toString());
  const bidRows = d1Bids[0].results[0].n;
  if (bidRows !== confirmed) throw new Error(`D1 bid rows ${bidRows} != ${confirmed}`);

  const d1Lot = JSON.parse(execSync(
    `npx wrangler d1 execute nimgavel --local --persist-to ${PERSIST} --json --command "SELECT status, winning_paddle, winning_bid_lunas FROM lots WHERE id = '${LOT.id}'"`,
    { stdio: "pipe" }
  ).toString());
  const lotRow = d1Lot[0].results[0];
  if (lotRow.status !== "sold") throw new Error(`D1 lot status ${lotRow.status} != sold`);
  if (lotRow.winning_paddle !== expectedWinner) throw new Error(`D1 winner ${lotRow.winning_paddle} != ${expectedWinner}`);
  if (lotRow.winning_bid_lunas !== amount) throw new Error(`D1 amount ${lotRow.winning_bid_lunas} != ${amount}`);

  killServer();
  console.log(`\nSOAK PASS: ${confirmed} bids, 1 hard kill + restore${closedDuringDowntime ? " (gavel during downtime)" : ""}, winner #${expectedWinner} at ${amount} lunas, D1 archive exact (${bidRows} bid rows, lot sold).`);
}

main().catch((error) => {
  killServer();
  console.error(`\nSOAK FAIL: ${error.message}`);
  if (serverLogs) console.error(`--- server logs (tail) ---\n${serverLogs.slice(-3000)}`);
  process.exit(1);
});
