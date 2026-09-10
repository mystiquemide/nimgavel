// Demo floor seeder — real flow end to end: real host keypairs sign real
// challenges, real paddles fight real WS bid wars, the gavel really falls,
// winners settle with tx hashes, and verification runs against the local
// mock Nimiq RPC (the QA path; production verifies on mainnet RPC).
//
// Leaves behind: settled+verified results, live rooms mid-war, one upcoming
// lot. Run with the worker on 8799 (npm run dev:worker) and .dev.vars
// pointing NIMIQ_RPC_URL at 127.0.0.1:8899.
//
//   node scripts/demo-data.mjs
import { createServer } from "node:http";
import { KeyPair } from "@nimiq/core";
import { encodeNimiqSignedMessage } from "../worker/auth.js";

const BASE = process.env.WRANGLER_URL || "http://127.0.0.1:8799";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(BASE).hostname)) throw new Error("Demo data is local-only and must never be seeded into production.");
const WS_BASE = BASE.replace(/^http/, "ws");
const MOCK_RPC_PORT = 8899;
const RUN = String(Date.now()).slice(-6);

const img = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=800&q=80`;

// The floor: settled history first (oldest), then the live war, then upcoming.
const SOLD_LOTS = [
  {
    title: "1968 Omega Seamaster Automatic",
    description: "Serviced vintage timepiece with original steel bracelet and caliber 565 movement. Waterproof case, acrylic crystal in excellent collector condition.",
    image: img("photo-1524805444758-089113d48a6d"),
    startPriceLunas: 500000, minIncrementLunas: 50000, durationSec: 10,
    bids: 11
  },
  {
    title: "Leica M3 Rangefinder + 50mm f2 Summicron",
    description: "Classic double-stroke rangefinder in immaculate collector condition with original lens and leather strap.",
    image: img("photo-1516035069371-29a1b244cc32"),
    startPriceLunas: 1000000, minIncrementLunas: 100000, durationSec: 10,
    bids: 12
  },
  {
    title: "Pro-Ject Debut Carbon EVO Turntable",
    description: "Audiophile belt-drive turntable with carbon tonearm and 2M Red cartridge. High-gloss walnut finish.",
    image: img("photo-1539185441755-769473a23570"),
    startPriceLunas: 800000, minIncrementLunas: 50000, durationSec: 10,
    bids: 10
  },
  {
    title: "GMK Botanical Custom 65% Keyboard",
    description: "Custom brass weight chassis, lubed Holy Panda switches, and authentic PBT keycaps.",
    image: img("photo-1587829741301-dc798b83add3"),
    startPriceLunas: 350000, minIncrementLunas: 25000, durationSec: 10,
    bids: 9
  }
];

const LIVE_LOTS = [
  {
    title: "Rolleiflex 2.8F TLR Film Camera",
    description: "Legendary twin-lens reflex with Planar 80mm f2.8. Fully serviced, includes original case and WL finder.",
    image: img("photo-1505226755626-21044548b8aa"),
    startPriceLunas: 800000, minIncrementLunas: 100000, durationSec: 3600,
    bids: 8
  },
  {
    title: "Artisan Wood-Fired Ceramic Kyusu Tea Set",
    description: "Hand-thrown side-handle teapot with four cups, fired in a climbing kiln. One of a kind.",
    image: img("photo-1578749556568-bc2c40e68b61"),
    startPriceLunas: 300000, minIncrementLunas: 25000, durationSec: 3600,
    bids: 7
  }
];

const UPCOMING_LOTS = [
  {
    title: "Horween Chromexcel Full-Grain Leather Duffel",
    description: "Hand-stitched weekend duffel in natural Chromexcel from the Chicago tannery. Brass hardware, waxed canvas lining.",
    image: img("photo-1548036328-c9fa89d128fa"),
    startPriceLunas: 900000, minIncrementLunas: 50000,
    scheduledInMin: 120
  }
];

// ---- mock Nimiq JSON-RPC (same contract as test/settle-verify.test.js) ----

function startMockRpc() {
  const chain = new Map();
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      if (payload.method !== "getTransactionByHash") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "Method not found" } }));
        return;
      }
      const tx = chain.get(payload.params[0]);
      res.writeHead(200, { "content-type": "application/json" });
      if (!tx) {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { code: -32603, message: "Internal error", data: `Transaction not found: ${payload.params[0]}` } }));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { data: tx, metadata: null } }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(MOCK_RPC_PORT, "127.0.0.1", () => resolve({ server, chain }));
  });
}

function mockTx({ recipient, value, hash, lotId }) {
  return {
    hash, blockNumber: 1234, timestamp: Date.now(), confirmations: 120, networkId: 5,
    recipientData: Buffer.from(`Nimgavel:${lotId}`).toString("hex"),
    from: "NQ02 31N6 3KM5 T6G5 22TN EPF5 5XPY RLHK RMB3", fromType: 0,
    to: recipient, toType: 0, value, fee: 138, executionResult: true
  };
}

// ---- REST helpers ----

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function getPaddle(role) {
  return api(`/api/paddle?deviceId=${encodeURIComponent(`demo-${role}-${RUN}-${Math.random().toString(36).slice(2, 8)}`)}`);
}

function signMessage(keyPair, message) {
  const { Hash } = globalThis.__nimiqCore;
  const hash = Hash.computeSha256(encodeNimiqSignedMessage(message));
  return keyPair.sign(hash).toHex();
}

async function createSignedLot(spec) {
  const keyPair = KeyPair.generate();
  const hostAddress = keyPair.toAddress().toUserFriendlyAddress();
  const hostPaddle = await getPaddle("host");

  const challenge = await api("/api/host/challenge", {
    method: "POST", body: JSON.stringify({ hostAddress })
  });

  const created = await api("/api/lots", {
    method: "POST",
    body: JSON.stringify({
      challengeId: challenge.challenge.id,
      hostAddress,
      publicKey: keyPair.publicKey.toHex(),
      signature: signMessage(keyPair, challenge.challenge.message),
      title: `Demo: ${spec.title}`,
      description: `Synthetic local fixture, not an item for sale. ${spec.description}`,
      imageUrl: spec.image,
      hostPaddle: hostPaddle.paddle,
      paddleToken: hostPaddle.paddleToken,
      startPriceLunas: spec.startPriceLunas,
      minIncrementLunas: spec.minIncrementLunas,
      durationSec: spec.durationSec || 180,
      ...(spec.scheduledAt ? { scheduledAt: spec.scheduledAt } : {})
    })
  });

  return { lot: created.lot, hostToken: created.hostToken, hostAddress, keyPair };
}

// ---- WS bidder ----

class Bidder {
  constructor(lotId, paddle) {
    this.paddle = paddle.paddle;
    this.alias = paddle.alias;
    this.paddleToken = paddle.paddleToken;
    this.messages = [];
    this.ws = new WebSocket(`${WS_BASE}/ws/${encodeURIComponent(lotId)}?paddle=${this.paddle}&alias=${encodeURIComponent(this.alias)}`);
    this.ws.addEventListener("message", (event) => this.messages.push(JSON.parse(event.data)));
    this.open = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }
  async waitFor(predicate, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(predicate);
      if (found) return found;
      if (Date.now() >= deadline) throw new Error(`timeout waiting; seen: ${JSON.stringify(this.messages.slice(-4))}`);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Run one auction to SOLD: bidders alternate, riding the soft close.
async function runWar(spec, { holdOpen = false } = {}) {
  const { lot, hostToken, hostAddress } = await createSignedLot(spec);
  await api(`/api/lots/${encodeURIComponent(lot.id)}/start`, {
    method: "POST", body: JSON.stringify({ hostToken })
  });

  const bidders = [];
  for (let i = 0; i < 3; i += 1) {
    const bidder = new Bidder(lot.id, await getPaddle("bidder"));
    await bidder.open;
    await bidder.waitFor((m) => m.type === "state");
    bidder.send({ type: "join", paddleToken: bidder.paddleToken });
    await bidder.waitFor((m) => m.type === "joined");
    bidders.push(bidder);
  }
  const watcher = bidders[0];

  let current = spec.startPriceLunas - spec.minIncrementLunas;
  for (let i = 0; i < spec.bids; i += 1) {
    const bidder = bidders[i % bidders.length];
    const amount = current + spec.minIncrementLunas;
    bidder.send({ type: "bid", amountLunas: amount });
    const confirmed = await watcher.waitFor((m) => m.type === "bid" && m.amountLunas === amount, 15000);
    current = confirmed.amountLunas;
    await sleep(320 + Math.floor(Math.random() * 260));
  }

  if (holdOpen) {
    // Live room: leave the war mid-flight; the room stays open for the demo.
    bidders.forEach((b) => b.close());
    return { lot, current, hostAddress };
  }

  // Sold room: wait for the gavel, then the winner settles and verifies.
  const sold = await watcher.waitFor((m) => m.type === "sold", 90000);
  const winningPaddle = sold.winningPaddle;
  const amountLunas = sold.amountLunas;
  const winner = bidders.find((b) => b.paddle === winningPaddle);
  bidders.forEach((b) => b.close());

  const txHash = Array.from({ length: 64 }, (_, i) =>
    ((RUN.charCodeAt(i % RUN.length) + i * 7 + winningPaddle) % 16).toString(16)
  ).join("");
  // Feed the chain mock the matching payment, then settle + verify.
  // mock.chain.set happens at the caller (chain access lives there).
  return { lot, current, hostAddress, winningPaddle, amountLunas, winner, txHash };
}

// ---- main ----

const Nimiq = await import("@nimiq/core");
globalThis.__nimiqCore = Nimiq;

console.log("starting mock RPC on", MOCK_RPC_PORT);
const mock = await startMockRpc();

// Settled history: 4 parallel wars, each ends sold -> settled -> verified.
const settled = await Promise.all(SOLD_LOTS.map(async (spec) => {
  const result = await runWar(spec);
  mock.chain.set(result.txHash, mockTx({ recipient: result.hostAddress, value: result.amountLunas, hash: result.txHash, lotId: result.lot.id }));

  const settledRes = await api(`/api/lots/${encodeURIComponent(result.lot.id)}/settle`, {
    method: "POST",
    headers: { authorization: `Bearer ${result.winner.paddleToken}` },
    body: JSON.stringify({ txHash: result.txHash })
  });

  const verified = await api(`/api/lots/${encodeURIComponent(result.lot.id)}/verify`, {
    method: "POST",
    headers: { authorization: `Bearer ${result.winner.paddleToken}` },
    body: "{}"
  });

  console.log(
    `SETTLED  ${spec.title} — ${result.amountLunas / 100000} NIM to paddle #${result.winningPaddle} — settlement: ${verified.settlement.state}`
  );
  return { title: spec.title, lotId: result.lot.id, state: verified.settlement.state, txHash: result.txHash };
}));

// Live rooms: wars left mid-flight, rooms open for the demo.
const live = [];
for (const spec of LIVE_LOTS) {
  const result = await runWar(spec, { holdOpen: true });
  live.push(result.lot.id);
  console.log(`LIVE     ${spec.title} — room open, ${spec.bids} bids on the board (${result.current / 100000} NIM)`);
}

// Upcoming: scheduled lots appear in the lobby as "starts soon".
for (const spec of UPCOMING_LOTS) {
  const { lot } = await createSignedLot({ ...spec, durationSec: 600, scheduledAt: Date.now() + spec.scheduledInMin * 60000 });
  console.log(`UPCOMING ${spec.title} — scheduled in ${spec.scheduledInMin} min (lot ${lot.id})`);
}

const listing = await api("/api/lots");
console.log("\nfloor state: live=" + listing.live.length, "upcoming=" + listing.upcoming.length, "results=" + listing.results.length);
console.log("live room ids:", live.join(", "));

mock.server.close();
console.log("done.");
