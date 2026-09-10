// Nimgavel Worker: REST router and WebSocket forwarding to AuctionRoom.
import {
  HOST_TOKEN_TTL_MS,
  PADDLE_TOKEN_TTL_MS,
  issueToken,
  normalizeNimiqAddress,
  sha256Hex,
  verifyNimiqSignedMessage,
  verifyToken
} from "./auth.js";
import { AuctionRoom } from "./auction-room.js";
import { bidKey } from "../lib/bids.js";
import {
  SETTLE_STATE,
  rpcUrlForEnv,
  verifyPendingSettlements,
  verifySettlement
} from "./settle-verify.js";

export { AuctionRoom };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store"
};
const MAX_BODY_BYTES = 320 * 1024;
const MAX_BID_LUNAS = 1e12;
const MAX_PADDLE = 2_000_000_000;
const MAX_LOT_LIMIT = 100;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_START_PRICE_LUNAS = 500_000;
const DEFAULT_MIN_INCREMENT_LUNAS = 100_000;
const DEFAULT_DURATION_SEC = 180;

const ADJECTIVES = [
  "Quiet", "Daring", "Bright", "Copper", "Swift", "Lucky", "Brave", "Merry",
  "Keen", "Golden", "Witty", "Bold", "Calm", "Electric", "Fierce", "Gentle"
];
const ANIMALS = [
  "Otter", "Falcon", "Badger", "Fox", "Heron", "Panda", "Raven", "Lynx",
  "Koala", "Hare", "Tiger", "Seal", "Moth", "Wolf", "Finch", "Ibex"
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      const response = await routeRequest(request, env, url);
      return withCors(response, request, url);
    } catch (error) {
      const response = error instanceof ApiError
        ? json({ error: error.message }, error.status, error.headers)
        : json({ error: "Unexpected server error." }, 500);
      return withCors(response, request, url);
    }
  },

  // Scheduled pass: retry pending settlement verifications against the
  // public Nimiq RPC. Wired via wrangler.jsonc triggers.crons.
  async scheduled(event, env) {
    return verifyPendingSettlements(env, { now: Date.now() });
  }
};

async function routeRequest(request, env, url) {
  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(request, url)) {
      return json({ error: "Origin not allowed." }, 403);
    }
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (request.method === "POST" && !isAllowedOrigin(request, url)) {
    return json({ error: "Origin not allowed." }, 403);
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return health(env);
  }

  if (url.pathname.startsWith("/ws/")) {
    return forwardWebSocket(request, env, url);
  }

  if (!url.pathname.startsWith("/api/")) {
    return new Response("not found", { status: 404 });
  }

  if (request.method === "GET" && url.pathname === "/api/paddle") {
    return getOrCreatePaddle(request, env, url);
  }

  if (request.method === "POST" && url.pathname === "/api/host/challenge") {
    return createHostChallenge(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/lots") {
    return createLot(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/lots") {
    return listLots(env, url);
  }

  if (request.method === "GET" && url.pathname === "/api/leaderboard") {
    return leaderboard(env);
  }

  const bidRemovalMatch = url.pathname.match(/^\/api\/lots\/([^/]+)\/bids\/([^/]+)\/remove$/);
  if (bidRemovalMatch) {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
    const lotId = decodeLotId(bidRemovalMatch[1]);
    const bidId = decodeLotId(bidRemovalMatch[2]);
    if (!/^\d{1,10}-\d{1,13}-\d{1,16}$/.test(bidId)) throw new ApiError(400, "Invalid bid id.");
    return removeLotBid(request, env, lotId, bidId);
  }

  const lotActionMatch = url.pathname.match(/^\/api\/lots\/([^/]+)\/(start|settle|verify|authorize)$/);
  if (lotActionMatch) {
    const lotId = decodeLotId(lotActionMatch[1]);
    if (request.method === "POST" && lotActionMatch[2] === "authorize") {
      return authorizeLotHost(request, env, lotId);
    }
    if (request.method === "POST" && lotActionMatch[2] === "start") {
      return startLot(request, env, lotId);
    }
    if (request.method === "POST" && lotActionMatch[2] === "settle") {
      return settleLot(request, env, lotId);
    }
    if (request.method === "POST" && lotActionMatch[2] === "verify") {
      return verifyLotSettlement(request, env, lotId);
    }
    return json({ error: "Method not allowed." }, 405, {
      allow: "POST"
    });
  }

  const lotMatch = url.pathname.match(/^\/api\/lots\/([^/]+)$/);
  if (lotMatch) {
    const lotId = decodeLotId(lotMatch[1]);
    if (request.method === "GET") return getLot(env, lotId);
    return json({ error: "Method not allowed." }, 405, {
      allow: "GET"
    });
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/state$/);
  if (roomMatch && request.method === "GET") {
    return getRoomState(request, env, decodeLotId(roomMatch[1]));
  }

  if (roomMatch) {
    return json({ error: "Method not allowed." }, 405, {
      allow: "GET"
    });
  }

  return json({ error: "Route not found." }, 404);
}

async function health(env) {
  let dbOk = false;
  if (env.DB) {
    try {
      const result = await env.DB.prepare("SELECT 1 AS ok").first();
      dbOk = Number(result?.ok) === 1;
    } catch {
      dbOk = false;
    }
  }

  return json({
    ok: dbOk,
    app: "nimgavel",
    buildId: env.BUILD_ID || "local",
    db: dbOk,
    network: env.NIMIQ_NETWORK || "testnet",
    ts: Date.now()
  }, dbOk ? 200 : 503);
}

async function forwardWebSocket(request, env, url) {
  const pieces = url.pathname.split("/");
  const lotId = pieces[2] ? decodeLotId(pieces[2]) : "";
  if (!lotId) throw new ApiError(400, "Lot id required.");
  const suffix = pieces[3] || "";
  if (pieces.length > 4 || (suffix && suffix !== "state") || request.method !== "GET") {
    throw new ApiError(404, "Route not found.");
  }
  if (!suffix && request.headers.get("Upgrade") !== "websocket") {
    return json({ error: "Websocket upgrade required." }, 426);
  }
  if (!isAllowedOrigin(request, url)) throw new ApiError(403, "Origin not allowed.");
  if (!env.ROOM) throw new ApiError(503, "Auction rooms are not configured.");
  if (!await selectLot(requireDb(env), lotId)) throw new ApiError(404, "Lot not found.");

  const stub = env.ROOM.get(env.ROOM.idFromName(lotId));
  return stub.fetch(request);
}

async function getOrCreatePaddle(request, env, url) {
  const deviceId = url.searchParams.get("deviceId");
  if (typeof deviceId !== "string" || deviceId.trim().length < 8 || deviceId.length > 512) {
    throw new ApiError(400, "A valid device id is required.");
  }

  const database = requireDb(env);
  const secret = requireSecret(env);
  const ip = requestIp(request);
  const deviceHash = await sha256Hex(deviceId.trim());
  const existing = await database.prepare("SELECT paddle FROM paddles WHERE device_hash = ?").bind(deviceHash).first();
  if (ip && !existing) await throttlePaddleIp(database, ip);
  const now = Date.now();
  const paddleRecord = await findOrCreatePaddle(database, deviceHash, now);
  const paddleToken = await issueToken({
    type: "paddle",
    paddle: paddleRecord.paddle,
    deviceHash
  }, secret, now);

  return json({
    ok: true,
    paddle: paddleRecord.paddle,
    alias: paddleRecord.alias,
    paddleToken,
    expiresAt: new Date(now + PADDLE_TOKEN_TTL_MS).toISOString()
  });
}

const PADDLE_IP_WINDOW_MS = 60 * 60 * 1000;
const PADDLE_IP_MAX = 10;
const PADDLE_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;

// Cloudflare sets CF-Connecting-IP on every production request and strips
// client-supplied copies, so it cannot be spoofed there. Loopback and
// private ranges only occur in local dev (wrangler injects 127.0.0.1):
// exempt them so dev traffic shares no bucket.
function requestIp(request) {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || !/^[0-9a-fA-F.:]{3,45}$/.test(ip)) return null;
  return isRoutableIp(ip) ? ip : null;
}

function isRoutableIp(ip) {
  const value = ip.toLowerCase();
  if (value === "::1" || value === "::" || value === "0.0.0.0") return false;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80")) return false;
  if (/^127\./.test(value)) return false;
  if (/^10\./.test(value)) return false;
  if (/^192\.168\./.test(value)) return false;
  const match = value.match(/^172\.(\d+)\./);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return false;
  }
  return true;
}

async function throttlePaddleIp(database, ip) {
  const now = Date.now();
  await database.prepare(
    "INSERT INTO paddle_requests (ip, created_at) VALUES (?, ?)"
  ).bind(ip, now).run();

  if (Math.random() < 0.125) {
    await database.prepare(
      "DELETE FROM paddle_requests WHERE created_at < ?"
    ).bind(now - PADDLE_LOG_RETENTION_MS).run();
  }

  const counted = await database.prepare(
    "SELECT COUNT(*) AS n FROM paddle_requests WHERE ip = ? AND created_at > ?"
  ).bind(ip, now - PADDLE_IP_WINDOW_MS).first();
  if (Number(counted?.n || 0) > PADDLE_IP_MAX) {
    throw new ApiError(429, "Too many paddles from this network. Try again later.");
  }
}

async function findOrCreatePaddle(database, deviceHash, now) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existing = await database.prepare(
      "SELECT paddle, alias FROM paddles WHERE device_hash = ?"
    ).bind(deviceHash).first();

    if (existing) {
      await database.prepare(
        "UPDATE paddles SET last_seen_at = ? WHERE device_hash = ?"
      ).bind(now, deviceHash).run();
      return {
        paddle: Number(existing.paddle),
        alias: existing.alias
      };
    }

    const next = await database.prepare(
      "SELECT COALESCE(MAX(paddle), 0) + 1 AS next_paddle FROM paddles"
    ).first();
    const paddle = Number(next?.next_paddle || 1);
    if (!Number.isSafeInteger(paddle) || paddle < 1 || paddle > MAX_PADDLE) {
      throw new ApiError(503, "Paddle numbers are exhausted.");
    }

    const alias = aliasForHash(deviceHash);
    try {
      await database.prepare(
        `INSERT INTO paddles
          (paddle, device_hash, alias, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(paddle, deviceHash, alias, now, now).run();
      return { paddle, alias };
    } catch (error) {
      // A concurrent request may have claimed the same device or next paddle.
      // Re-read before surfacing the database error.
      const concurrent = await database.prepare(
        "SELECT paddle, alias FROM paddles WHERE device_hash = ?"
      ).bind(deviceHash).first();
      if (concurrent) {
        await database.prepare(
          "UPDATE paddles SET last_seen_at = ? WHERE device_hash = ?"
        ).bind(now, deviceHash).run();
        return {
          paddle: Number(concurrent.paddle),
          alias: concurrent.alias
        };
      }
      if (attempt === 3) throw error;
    }
  }

  throw new ApiError(503, "Could not assign a paddle.");
}

async function createHostChallenge(request, env) {
  const body = await readJson(request);
  const hostAddress = normalizeNimiqAddress(
    body.hostAddress || body.walletAddress || body.payoutAddress
  );
  if (!hostAddress) {
    throw new ApiError(400, "A valid Nimiq wallet address is required.");
  }

  const database = requireDb(env);
  let controlLotId = null;
  if (body.lotId !== undefined) {
    if (typeof body.lotId !== "string") throw new ApiError(400, "Invalid lot id.");
    controlLotId = decodeLotId(body.lotId);
    const lot = await selectLot(database, controlLotId);
    if (!lot) throw new ApiError(404, "Lot not found.");
    if (lot.host_address !== hostAddress) throw new ApiError(403, "This wallet is not the lot host.");
  }
  const now = Date.now();
  await database.prepare(
    "DELETE FROM host_challenges WHERE expires_at <= ?"
  ).bind(now).run();

  const active = await database.prepare(
    `SELECT COUNT(*) AS active_count
     FROM host_challenges
     WHERE host_address = ? AND used_at IS NULL AND expires_at > ?`
  ).bind(hostAddress, now).first();
  if (Number(active?.active_count || 0) >= 5) {
    throw new ApiError(429, "Too many active host challenges. Try again shortly.");
  }

  const id = crypto.randomUUID();
  const nonce = randomHex(32);
  const expiresAt = now + CHALLENGE_TTL_MS;
  const message = [
    ...(controlLotId ? ["Nimgavel lot control authorization", `Lot: ${controlLotId}`] : ["Nimgavel host authorization"]),
    `Wallet: ${hostAddress}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date(now).toISOString()}`,
    `Expires: ${new Date(expiresAt).toISOString()}`
  ].join("\n");

  await database.prepare(
    `INSERT INTO host_challenges
      (id, host_address, message, issued_at, expires_at, used_at)
     VALUES (?, ?, ?, ?, ?, NULL)`
  ).bind(id, hostAddress, message, now, expiresAt).run();

  return json({
    ok: true,
    challenge: {
      id,
      message,
      expiresAt: new Date(expiresAt).toISOString()
    }
  }, 201);
}

async function createLot(request, env) {
  const body = await readJson(request);
  const database = requireDb(env);
  const secret = requireSecret(env);
  const challenge = await getHostChallenge(database, body.challengeId);
  if (challenge.message.startsWith("Nimgavel lot control authorization\n")) throw new ApiError(400, "This challenge is for an existing lot.");
  const hostAddress = normalizeNimiqAddress(
    body.hostAddress || body.walletAddress || challenge.host_address
  );
  if (!hostAddress || hostAddress !== challenge.host_address) {
    throw new ApiError(401, "Wallet does not match the signed challenge.");
  }

  const lotInput = parseLotInput(body, hostAddress);
  const paddleAuth = await verifyToken(tokenFrom(request, body, "paddleToken", "x-paddle-token"), secret, { type: "paddle" });
  if (!paddleAuth.ok || paddleAuth.payload.paddle !== lotInput.hostPaddle) {
    throw new ApiError(401, "Host paddle authorization is invalid or expired.");
  }
  const proof = await verifyNimiqSignedMessage({
    message: challenge.message,
    walletAddress: hostAddress,
    publicKey: body.publicKey || body.publicKeyHex,
    signature: body.signature || body.signatureHex
  });
  if (!proof.ok) throw new ApiError(401, proof.error);

  const consumed = await database.prepare(
    `UPDATE host_challenges
     SET used_at = ?
     WHERE id = ? AND used_at IS NULL AND expires_at > ?`
  ).bind(Date.now(), challenge.id, Date.now()).run();
  if (!hasChanges(consumed)) {
    throw new ApiError(409, "Challenge has already been used.");
  }

  const now = Date.now();
  const lot = {
    id: crypto.randomUUID(),
    title: lotInput.title,
    description: lotInput.description,
    imageUrl: lotInput.imageUrl,
    hostPaddle: lotInput.hostPaddle,
    hostAddress,
    startPriceLunas: lotInput.startPriceLunas,
    minIncrementLunas: lotInput.minIncrementLunas,
    durationSec: lotInput.durationSec,
    status: "created",
    scheduledAt: lotInput.scheduledAt,
    startedAt: null,
    endedAt: null,
    winningPaddle: null,
    winningBidLunas: null,
    txHash: null,
    createdAt: now
  };

  await database.prepare(
    `INSERT INTO lots
      (id, title, description, image_url, host_paddle, host_address,
       start_price_lunas, min_increment_lunas, duration_sec, status,
       scheduled_at, started_at, ended_at, winning_paddle,
       winning_bid_lunas, tx_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`
  ).bind(
    lot.id,
    lot.title,
    lot.description,
    lot.imageUrl,
    lot.hostPaddle,
    lot.hostAddress,
    lot.startPriceLunas,
    lot.minIncrementLunas,
    lot.durationSec,
    lot.status,
    lot.scheduledAt,
    lot.createdAt
  ).run();

  let roomReady = false;
  if (env.ROOM) {
    const seeded = await invokeRoom(request, env, lot.id, "/seed", {
      method: "POST",
      body: JSON.stringify(toRoomLot(lot))
    }).catch(() => null);
    roomReady = Boolean(seeded?.ok);
  }

  const hostToken = await issueToken({
    type: "host",
    lotId: lot.id,
    hostAddress,
    exp: Math.floor((now + HOST_TOKEN_TTL_MS) / 1000)
  }, secret, now);

  return json({
    ok: true,
    lot: toPublicLot(lot),
    roomReady,
    hostToken,
    hostTokenExpiresAt: new Date(now + HOST_TOKEN_TTL_MS).toISOString()
  }, 201);
}

async function getHostChallenge(database, challengeId) {
  if (typeof challengeId !== "string" || challengeId.length < 10 || challengeId.length > 100) {
    throw new ApiError(400, "A valid host challenge is required.");
  }

  const challenge = await database.prepare(
    `SELECT id, host_address, message, issued_at, expires_at, used_at
     FROM host_challenges WHERE id = ?`
  ).bind(challengeId).first();
  if (!challenge) throw new ApiError(400, "Challenge not found.");
  if (challenge.used_at) throw new ApiError(400, "Challenge has already been used.");
  if (Number(challenge.expires_at) <= Date.now()) {
    throw new ApiError(400, "Challenge has expired.");
  }
  return challenge;
}

// Public leaderboard: aggregate paddle activity across the floor. Paddle
// numbers are partially masked in the response itself, so the public list
// cannot be used to build a full cross-auction identity index.
function maskPaddle(paddle) {
  const digits = String(paddle);
  if (digits.length <= 2) return `•${digits.slice(-1)}`;
  return `${digits[0]}${"•".repeat(digits.length - 2)}${digits.slice(-1)}`;
}

async function leaderboard(env) {
  const database = requireDb(env);

  const bidders = await database.prepare(
    `SELECT p.paddle AS paddle, p.alias AS alias,
            COUNT(*) AS bids,
            COUNT(DISTINCT b.lot_id) AS rooms,
            (SELECT COUNT(*) FROM lots l WHERE l.winning_paddle = p.paddle AND l.status IN ('sold', 'settled')) AS wins
     FROM paddles p
     JOIN bids b ON b.paddle = p.paddle
     WHERE NOT EXISTS (SELECT 1 FROM bid_removals r WHERE r.lot_id = b.lot_id AND r.paddle = b.paddle AND r.amount_lunas = b.amount_lunas AND r.bid_created_at = b.created_at)
     GROUP BY p.paddle, p.alias
     ORDER BY wins DESC, bids DESC, p.paddle ASC
     LIMIT 25`
  ).all();

  const winners = await database.prepare(
    `SELECT winning_paddle AS paddle,
            COUNT(*) AS wins,
            COALESCE(SUM(winning_bid_lunas), 0) AS won_lunas
     FROM lots
     WHERE winning_paddle IS NOT NULL AND status IN ('sold', 'settled')
     GROUP BY winning_paddle`
  ).all();

  const winMap = new Map((winners.results || []).map((row) => [row.paddle, row]));
  const rows = (bidders.results || []).map((row) => {
    const win = winMap.get(row.paddle);
    return {
      paddle: maskPaddle(row.paddle),
      alias: row.alias,
      bids: row.bids,
      rooms: row.rooms,
      wins: win ? win.wins : 0,
      wonLunas: win ? win.won_lunas : 0
    };
  });

  rows.sort((a, b) => (b.wins - a.wins) || (b.bids - a.bids) || a.alias.localeCompare(b.alias));

  return json({ ok: true, leaderboard: rows.slice(0, 25) });
}

async function listLots(env, url) {
  const database = requireDb(env);
  const limit = parseLimit(url.searchParams.get("limit"));
  const groups = [
    ["live", "status = 'live'", "started_at DESC"],
    ["upcoming", "status = 'created'", "COALESCE(scheduled_at, created_at) DESC"],
    ["results", "status IN ('sold', 'settled', 'passed')", "ended_at DESC"]
  ];
  const entries = await Promise.all(groups.map(async ([name, filter, order]) => {
    const result = await database.prepare(`SELECT * FROM lots WHERE ${filter} ORDER BY ${order}, id ASC LIMIT ?`).bind(limit).all();
    return [name, (result.results || []).map(toPublicLot)];
  }));
  return json(Object.fromEntries(entries));
}

async function getLot(env, lotId) {
  const database = requireDb(env);
  const row = await selectLot(database, lotId);
  if (!row) throw new ApiError(404, "Lot not found.");

  const result = await database.prepare(
    `SELECT b.paddle, p.alias, b.amount_lunas, b.created_at
     FROM bids b
     LEFT JOIN paddles p ON p.paddle = b.paddle
     WHERE b.lot_id = ? AND NOT EXISTS (SELECT 1 FROM bid_removals r WHERE r.lot_id = b.lot_id AND r.paddle = b.paddle AND r.amount_lunas = b.amount_lunas AND r.bid_created_at = b.created_at)
     ORDER BY b.id DESC
     LIMIT 100`
  ).bind(lotId).all();

  const removed = await database.prepare(`SELECT r.*, p.alias FROM bid_removals r
    LEFT JOIN paddles p ON p.paddle = r.paddle WHERE r.lot_id = ?
    ORDER BY r.removed_at DESC, r.bid_id ASC LIMIT 100`).bind(lotId).all();
  return json({
    lot: toPublicLot(row),
    bids: (result?.results || []).map(toPublicBid),
    removedBids: (removed.results || []).map(row => ({
      ...toPublicBid({ ...row, created_at: row.bid_created_at }),
      removal: { removedAt: row.removed_at, removedBy: row.removed_by, role: row.role, reason: row.reason }
    }))
  });
}

async function authorizeLotHost(request, env, lotId) {
  const body = await readJson(request);
  const database = requireDb(env);
  const secret = requireSecret(env);
  const lot = await selectLot(database, lotId);
  if (!lot) throw new ApiError(404, "Lot not found.");
  const challenge = await getHostChallenge(database, body.challengeId);
  const prefix = `Nimgavel lot control authorization\nLot: ${lotId}\nWallet: ${lot.host_address}\n`;
  if (challenge.host_address !== lot.host_address || !challenge.message.startsWith(prefix)) {
    throw new ApiError(401, "The challenge does not authorize this lot.");
  }
  const proof = await verifyNimiqSignedMessage({ message: challenge.message, walletAddress: lot.host_address, publicKey: body.publicKey, signature: body.signature });
  if (!proof.ok) throw new ApiError(401, proof.error);
  const now = Date.now();
  const consumed = await database.prepare("UPDATE host_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?").bind(now, challenge.id, now).run();
  if (!hasChanges(consumed)) throw new ApiError(409, "Challenge has already been used.");
  const hostToken = await issueToken({ type: "host", lotId, hostAddress: lot.host_address, exp: Math.floor((now + HOST_TOKEN_TTL_MS) / 1000) }, secret, now);
  return json({ ok: true, hostToken, expiresAt: new Date(now + HOST_TOKEN_TTL_MS).toISOString() });
}

async function removeLotBid(request, env, lotId, bidId) {
  const body = await readJson(request);
  const row = await selectLot(requireDb(env), lotId);
  if (!row) throw new ApiError(404, "Lot not found.");
  const reason = textField(body.reason, "Removal reason", 1, 280);
  const role = body.role || "bidder";
  if (!["bidder", "host"].includes(role)) throw new ApiError(400, "Invalid removal role.");
  const host = role === "host";
  const token = tokenFrom(request, body, host ? "hostToken" : "paddleToken", host ? "x-host-token" : "x-paddle-token");
  const auth = await verifyToken(token, requireSecret(env), host ? { type: "host", lotId, hostAddress: row.host_address } : { type: "paddle" });
  if (!auth.ok) throw new ApiError(401, "Bid removal authorization is invalid or expired.");
  const actor = host ? { role, hostAddress: row.host_address } : { role, paddle: auth.payload.paddle };
  if (!host && (!Number.isSafeInteger(actor.paddle) || actor.paddle < 1)) throw new ApiError(401, "Invalid paddle authorization.");
  if (!env.ROOM) throw new ApiError(503, "Auction rooms are not configured.");
  const response = await invokeRoom(request, env, lotId, "/remove-bid", { method: "POST", body: JSON.stringify({ bidId, reason, actor }) });
  return json(await readResponseJson(response), response.status);
}

async function startLot(request, env, lotId) {
  const body = await readJson(request);
  const database = requireDb(env);
  const row = await selectLot(database, lotId);
  if (!row) throw new ApiError(404, "Lot not found.");
  if (row.status !== "created") throw new ApiError(409, "Lot is already started.");

  const token = tokenFrom(request, body, "hostToken", "x-host-token");
  const tokenResult = await verifyToken(
    token,
    requireSecret(env),
    { type: "host", lotId, hostAddress: row.host_address }
  );
  if (!tokenResult.ok) throw new ApiError(401, "Host authorization is invalid or expired.");
  if (!env.ROOM) throw new ApiError(503, "Auction rooms are not configured.");

  const seeded = await invokeRoom(request, env, lotId, "/seed", {
    method: "POST",
    body: JSON.stringify(toRoomLot(row))
  });
  if (!seeded.ok) throw new ApiError(502, "The auction room could not be initialized.");

  const started = await invokeRoom(request, env, lotId, "/start", { method: "POST" });
  const startedBody = await readResponseJson(started);
  if (!started.ok) {
    throw new ApiError(started.status === 409 ? 409 : 502, startedBody.error || "The auction could not start.");
  }

  const startedAt = Number(startedBody.startedAt || startedBody.serverNow || Date.now());
  await database.prepare(
    "UPDATE lots SET status = 'live', started_at = ? WHERE id = ? AND status = 'created'"
  ).bind(startedAt, lotId).run();

  return json({
    ok: true,
    lot: toPublicLot({ ...row, status: "live", started_at: startedAt }),
    state: startedBody
  });
}

async function settleLot(request, env, lotId) {
  const body = await readJson(request);
  const database = requireDb(env);
  const row = await selectLot(database, lotId);
  if (!row) throw new ApiError(404, "Lot not found.");

  const token = tokenFrom(request, body, "paddleToken", "x-paddle-token");
  const tokenResult = await verifyToken(
    token,
    requireSecret(env),
    { type: "paddle" }
  );
  if (!tokenResult.ok || tokenResult.payload.type !== "paddle") {
    throw new ApiError(401, "Paddle authorization is invalid or expired.");
  }

  const txHash = normalizeTxHash(body.txHash || body.transactionHash);
  if (!txHash) throw new ApiError(400, "A valid transaction hash is required.");

  const paddle = Number(tokenResult.payload.paddle);
  if (!Number.isSafeInteger(paddle) || paddle < 1) {
    throw new ApiError(401, "Paddle authorization is invalid or expired.");
  }

  if (row.status !== "sold" && row.status !== "settled") {
    throw new ApiError(409, "The lot is not ready for settlement.");
  }
  if (Number(row.winning_paddle) !== paddle) {
    throw new ApiError(403, "Only the winning paddle can settle this lot.");
  }
  if (row.status === "settled" && row.tx_hash === txHash) return json(settlementResponse(row));
  if (row.status === "settled" && (row.settle_verified || !String(row.settle_failure || "").startsWith("rejected:"))) {
    throw new ApiError(409, "This lot already has a different settlement. Wait for verification before correcting it.");
  }

  const updated = await database.prepare(
    `UPDATE lots
     SET status = 'settled', tx_hash = ?, settle_verified = 0,
         settle_checked_at = NULL, settle_failure = NULL
     WHERE id = ? AND winning_paddle = ? AND settle_verified = 0
       AND ((status = 'sold' AND tx_hash IS NULL) OR (status = 'settled' AND tx_hash = ? AND settle_failure LIKE 'rejected:%'))`
  ).bind(txHash, lotId, paddle, row.tx_hash).run();

  if (!hasChanges(updated)) {
    const current = await selectLot(database, lotId);
    if (current?.status === "settled" && current.tx_hash === txHash) {
      return json(settlementResponse(current));
    }
    throw new ApiError(409, "The lot settlement changed. Try again.");
  }

  return json(settlementResponse({ ...row, status: "settled", tx_hash: txHash, settle_verified: 0, settle_checked_at: null, settle_failure: null }), 201);
}

// On-demand settlement verification. The receipt is labeled pending until
// this (or the scheduled pass) sees the payment on chain. Auth matches the
// settle endpoint: only the winning paddle can trigger a re-check.
async function verifyLotSettlement(request, env, lotId) {
  const body = await readJson(request);
  const database = requireDb(env);
  const row = await selectLot(database, lotId);
  if (!row) throw new ApiError(404, "Lot not found.");

  const token = tokenFrom(request, body, "paddleToken", "x-paddle-token");
  const tokenResult = await verifyToken(
    token,
    requireSecret(env),
    { type: "paddle" }
  );
  if (!tokenResult.ok || tokenResult.payload.type !== "paddle") {
    throw new ApiError(401, "Paddle authorization is invalid or expired.");
  }
  if (Number(tokenResult.payload.paddle) !== Number(row.winning_paddle)) {
    throw new ApiError(403, "Only the winning paddle can verify this settlement.");
  }

  const publicLot = toPublicLot(row);
  if (publicLot.status !== "settled" && publicLot.status !== "sold") {
    throw new ApiError(409, "The lot is not settled yet.");
  }

  // Settled and verified earlier: replay the stored verdict.
  if (row.settle_verified) {
    return json({
      ok: true,
      settlement: settlementStateFor(row, SETTLE_STATE.VERIFIED)
    });
  }
  if (row.tx_hash && (row.settle_failure || "").startsWith("rejected:")) {
    return json({
      ok: true,
      settlement: settlementStateFor(row, SETTLE_STATE.REJECTED)
    });
  }
  if (!row.tx_hash) {
    return json({
      ok: true,
      settlement: { state: SETTLE_STATE.PENDING, reason: "No payment recorded yet." }
    });
  }

  const result = await verifySettlement({
    txHash: row.tx_hash,
    hostAddress: row.host_address,
    amountLunas: Number(row.winning_bid_lunas),
    lotId,
    network: env.NIMIQ_NETWORK || "testnet",
    rpcUrl: rpcUrlForEnv(env)
  });

  if (result.status === SETTLE_STATE.VERIFIED) {
    await database.prepare(
      `UPDATE lots SET settle_verified = 1, settle_checked_at = ?, settle_failure = NULL WHERE id = ? AND tx_hash = ?`
    ).bind(Date.now(), lotId, row.tx_hash).run();
  } else if (result.status === SETTLE_STATE.REJECTED) {
    await database.prepare(
      `UPDATE lots SET settle_checked_at = ?, settle_failure = ? WHERE id = ? AND tx_hash = ? AND settle_verified = 0`
    ).bind(Date.now(), `rejected:${result.reason}`, lotId, row.tx_hash).run();
  }

  const updated = { ...row, settle_checked_at: Date.now() };
  return json({ ok: true, settlement: settlementStateFor(updated, result.status, result) });
}

function settlementStateFor(row, state, result) {
  const failure = row.settle_failure || "";
  return {
    state,
    txHash: row.tx_hash || null,
    reason: state === SETTLE_STATE.REJECTED
      ? failure.replace(/^rejected:/, "") || result?.reason || "Payment does not match."
      : result?.reason || null,
    confirmations: result?.confirmations ?? null,
    checkedAt: Number(row.settle_checked_at) || null
  };
}

async function getRoomState(request, env, lotId) {
  if (!await selectLot(requireDb(env), lotId)) throw new ApiError(404, "Lot not found.");
  if (!env.ROOM) throw new ApiError(503, "Auction rooms are not configured.");
  const response = await invokeRoom(request, env, lotId, "/state", { method: "GET" });
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new ApiError(response.status, body.error || "Room state unavailable.");
  }

  if (env.DB) {
    const row = await selectLot(env.DB, lotId);
    if (row) {
      body.status = row.status;
      if (row.status === "settled") body.phase = "settled";
    }
  }
  return json(body);
}

async function selectLot(database, lotId) {
  return database.prepare(
    `SELECT id, title, description, image_url, host_paddle, host_address,
            start_price_lunas, min_increment_lunas, duration_sec, status,
            scheduled_at, started_at, ended_at, winning_paddle,
            winning_bid_lunas, tx_hash, created_at,
            settle_verified, settle_checked_at, settle_failure
     FROM lots WHERE id = ?`
  ).bind(lotId).first();
}

async function invokeRoom(request, env, lotId, suffix, options) {
  const stub = env.ROOM.get(env.ROOM.idFromName(lotId));
  const target = new URL(request.url);
  target.pathname = `/ws/${encodeURIComponent(lotId)}${suffix}`;
  target.search = "";
  const roomRequest = new Request(target, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body
  });
  return stub.fetch(roomRequest);
}

function settlementResponse(row) {
  const txHash = row.tx_hash;
  const settleState = Number(row.settle_verified) === 1
    ? SETTLE_STATE.VERIFIED
    : (row.settle_failure || "").startsWith("rejected:")
      ? SETTLE_STATE.REJECTED
      : SETTLE_STATE.PENDING;
  return {
    ok: true,
    lot: toPublicLot(row),
    receipt: {
      lotId: row.id,
      status: "settled",
      txHash,
      explorerUrl: explorerUrl(txHash),
      settlement: {
        state: settleState,
        reason: settleState === SETTLE_STATE.REJECTED
          ? String(row.settle_failure || "").replace(/^rejected:/, "")
          : null,
        checkedAt: Number(row.settle_checked_at) || null
      }
    }
  };
}

function explorerUrl(txHash) {
  return `https://nimiq.watch/#${encodeURIComponent(txHash)}`;
}

function toPublicLot(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    imageUrl: row.image_url ?? row.imageUrl ?? null,
    hostPaddle: numberOrNull(row.host_paddle ?? row.hostPaddle),
    hostAddress: row.host_address ?? row.hostAddress,
    startPriceLunas: numberOrNull(row.start_price_lunas ?? row.startPriceLunas),
    minIncrementLunas: numberOrNull(row.min_increment_lunas ?? row.minIncrementLunas),
    durationSec: numberOrNull(row.duration_sec ?? row.durationSec),
    status: row.status,
    scheduledAt: numberOrNull(row.scheduled_at ?? row.scheduledAt),
    startedAt: numberOrNull(row.started_at ?? row.startedAt),
    endedAt: numberOrNull(row.ended_at ?? row.endedAt),
    winningPaddle: numberOrNull(row.winning_paddle ?? row.winningPaddle),
    winningBidLunas: numberOrNull(row.winning_bid_lunas ?? row.winningBidLunas),
    txHash: row.tx_hash ?? row.txHash ?? null,
    settlement: settlementSummary(row),
    createdAt: numberOrNull(row.created_at ?? row.createdAt)
  };
}

function settlementSummary(row) {
  const settled = row.status === "settled";
  if (!settled && row.status !== "sold") return null;
  if (!row.tx_hash && !settled) return null;

  const verified = Number(row.settle_verified ?? 0) === 1;
  const failure = String(row.settle_failure ?? "");
  if (verified) return { state: SETTLE_STATE.VERIFIED };
  if (failure.startsWith("rejected:")) {
    return { state: SETTLE_STATE.REJECTED, reason: failure.slice("rejected:".length) };
  }
  if (!row.tx_hash) return null;
  return { state: SETTLE_STATE.PENDING };
}

function toPublicBid(row) {
  return {
    id: bidKey(row),
    paddle: Number(row.paddle),
    alias: row.alias || `Paddle ${row.paddle}`,
    amountLunas: Number(row.amount_lunas ?? row.amountLunas),
    createdAt: Number(row.created_at ?? row.createdAt)
  };
}

function toRoomLot(row) {
  const lot = toPublicLot(row);
  return {
    id: lot.id,
    title: lot.title,
    description: lot.description,
    imageUrl: lot.imageUrl,
    hostPaddle: lot.hostPaddle,
    hostAddress: lot.hostAddress,
    startPriceLunas: lot.startPriceLunas,
    minIncrementLunas: lot.minIncrementLunas,
    durationSec: lot.durationSec
  };
}

function parseLotInput(body, hostAddress) {
  const title = textField(body.title, "Title", 1, 120);
  const description = textField(body.description ?? "", "Description", 0, 2_000);
  const imageValue = body.imageUrl ?? body.image_url ?? null;
  let imageUrl = null;
  if (imageValue !== null && imageValue !== "") {
    if (typeof imageValue !== "string" || imageValue.length > 300_000) {
      throw new ApiError(400, "Image must be at most 300,000 characters.");
    }
    if (imageValue.startsWith("data:image/")) {
      // Uploaded photos arrive as client-downscaled data URIs; hosts can
      // also pass any public https image link.
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(imageValue)) {
        throw new ApiError(400, "Image must be a base64 JPEG, PNG, or WebP.");
      }
      imageUrl = imageValue;
    } else {
      try {
        const parsed = new URL(imageValue);
        if (parsed.protocol !== "https:") throw new Error("https required");
        imageUrl = parsed.toString();
      } catch {
        throw new ApiError(400, "Image URL must use https.");
      }
    }
  }

  const hostPaddle = integerField(body.hostPaddle ?? body.paddle, "Host paddle", 1, MAX_PADDLE);
  const startPriceLunas = integerField(
    body.startPriceLunas,
    "Start price",
    1,
    MAX_BID_LUNAS,
    DEFAULT_START_PRICE_LUNAS
  );
  const minIncrementLunas = integerField(
    body.minIncrementLunas,
    "Minimum increment",
    1,
    MAX_BID_LUNAS,
    DEFAULT_MIN_INCREMENT_LUNAS
  );
  const durationSec = integerField(body.durationSec, "Duration", 5, 86_400, DEFAULT_DURATION_SEC);
  const scheduledAt = timestampField(body.scheduledAt ?? body.scheduled_at, "Scheduled time");

  if (minIncrementLunas > MAX_BID_LUNAS - startPriceLunas) {
    throw new ApiError(400, "Minimum increment is too large.");
  }

  return {
    title,
    description,
    imageUrl,
    hostPaddle,
    hostAddress,
    startPriceLunas,
    minIncrementLunas,
    durationSec,
    scheduledAt
  };
}

function textField(value, label, min, max) {
  if (typeof value !== "string") throw new ApiError(400, `${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new ApiError(400, `${label} must be between ${min} and ${max} characters.`);
  }
  return trimmed;
}

function integerField(value, label, min, max, fallback) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new ApiError(400, `${label} is required.`);
  }
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) throw new ApiError(400, `${label} must be an integer.`);
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new ApiError(400, `${label} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function timestampField(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < Date.now() - 60_000) {
    throw new ApiError(400, `${label} must be a future timestamp.`);
  }
  return timestamp;
}

function parseLimit(value) {
  if (value === null) return 50;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LOT_LIMIT) {
    throw new ApiError(400, `Limit must be an integer between 1 and ${MAX_LOT_LIMIT}.`);
  }
  return limit;
}

function normalizeTxHash(value) {
  if (typeof value !== "string") return null;
  const hash = value.trim().replace(/^0x/i, "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}

function aliasForHash(deviceHash) {
  const adjective = ADJECTIVES[Number.parseInt(deviceHash.slice(0, 8), 16) % ADJECTIVES.length];
  const animal = ANIMALS[Number.parseInt(deviceHash.slice(8, 16), 16) % ANIMALS.length];
  return `${adjective} ${animal}`;
}

function tokenFrom(request, body, bodyKey, headerName) {
  const authorization = request.headers.get("authorization");
  if (authorization && /^Bearer\s+/i.test(authorization)) {
    return authorization.replace(/^Bearer\s+/i, "").trim();
  }
  return request.headers.get(headerName) || body[bodyKey] || null;
}

function requireDb(env) {
  if (!env.DB) throw new ApiError(503, "Database is not configured.");
  return env.DB;
}

function requireSecret(env) {
  const secret = env.NIMGAVEL_SECRET || env.PADDLE_SECRET || env.WORKER_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    throw new ApiError(503, "Worker auth secret is not configured.");
  }
  return secret;
}

function decodeLotId(value) {
  try {
    const lotId = decodeURIComponent(value);
    if (!lotId || lotId.length > 128 || /[\r\n]/.test(lotId)) {
      throw new Error("invalid lot id");
    }
    return lotId;
  } catch {
    throw new ApiError(400, "Invalid lot id.");
  }
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "Request body is too large.");
  }

  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new ApiError(413, "Request body is too large.");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  if (!text.trim()) return {};
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("object required");
    }
    return body;
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
}

async function readResponseJson(response) {
  return response.json().catch(() => ({}));
}

function hasChanges(result) {
  const changes = result?.meta?.changes ?? result?.changes;
  return changes === undefined || Number(changes) > 0;
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isAllowedOrigin(request, url) {
  const origin = request.headers.get("origin");
  return !origin || origin === url.origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function withCors(response, request, url) {
  // WebSocket upgrades pass through untouched: rebuilding a 101 response
  // breaks the protocol switch in workerd.
  if (response.status === 101) return response;

  const origin = request.headers.get("origin");
  const headers = new Headers(response.headers);

  // Security headers on every response. The app handles wallet tokens:
  // framing, MIME sniffing, and referrer leakage are real threats.
  headers.set("x-frame-options", "DENY");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set(
    "content-security-policy",
    `default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://rpc.nimiqwatch.com https://rpc.testnet.nimiqwatch.com ${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}; frame-ancestors 'none'; base-uri 'self'`
  );

  if (!origin || !isAllowedOrigin(request, url)) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,authorization,x-host-token,x-paddle-token");
  headers.set("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function json(payload, status = 200, extraHeaders = {}) {
  const headers = new Headers(JSON_HEADERS);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(payload), { status, headers });
}

class ApiError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}
