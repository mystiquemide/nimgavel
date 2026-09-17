// Production entrypoint that keeps the existing Worker/router and AuctionRoom
// state machine intact, while adding wallet-proof + live-balance enforcement
// before a bid is allowed to reach the room logic.

import worker, { AuctionRoom as BaseAuctionRoom } from "./index.js";
import { normalizeNimiqAddress, verifyNimiqSignedMessage } from "./auth.js";
import {
  BIDDER_PROOF_TTL_MS,
  bidderAuthorizationMessage
} from "../lib/bidder-proof.js";

const MAINNET_RPC_URL = "https://rpc.nimiqwatch.com";
const TESTNET_RPC_URL = "https://rpc.testnet.nimiqwatch.com";
const RPC_TIMEOUT_MS = 6000;
const PROOF_CLOCK_SKEW_MS = 60_000;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;
const LIST_COLUMNS = `id,title,description,host_paddle,host_address,
  start_price_lunas,min_increment_lunas,duration_sec,status,scheduled_at,
  started_at,ended_at,winning_paddle,winning_bid_lunas,tx_hash,created_at,
  settle_verified,settle_checked_at,settle_failure`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // List pages do not need embedded base64 photos. Returning image endpoints
    // instead keeps Auction Floor / Results payloads small on mobile while the
    // immutable lot photos load independently and can be cached by the browser.
    if (request.method === "GET" && url.pathname === "/api/lots") {
      try {
        return await listLotsLightweight(env, url);
      } catch {
        // Preserve the existing router as a safe fallback if the optimized read
        // ever encounters an unexpected schema/runtime problem.
        return worker.fetch(request, env, ctx);
      }
    }

    const imageMatch = url.pathname.match(/^\/api\/lots\/([^/]+)\/image$/);
    if (request.method === "GET" && imageMatch) {
      return serveLotImage(request, env, decodeLotId(imageMatch[1]));
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const response = await worker.fetch(request, env, ctx);
      let payload;
      try {
        payload = await response.json();
      } catch {
        return response;
      }

      const version = env.CF_VERSION_METADATA;
      return new Response(JSON.stringify({
        ...payload,
        buildId: version?.id || env.BUILD_ID || "local",
        versionTag: version?.tag || null,
        versionTimestamp: version?.timestamp || null
      }), {
        status: response.status,
        headers: response.headers
      });
    }

    return worker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    return worker.scheduled(event, env, ctx);
  }
};

export class AuctionRoom extends BaseAuctionRoom {
  async webSocketMessage(server, data) {
    let message;
    try {
      message = typeof data === "string" ? JSON.parse(data) : null;
    } catch {
      return super.webSocketMessage(server, data);
    }

    // Existing CI lifecycle tests intentionally exercise the auction state
    // machine without a live chain. This flag is generated only in local CI
    // and is never configured in production.
    if (this.env.NIMGAVEL_TEST_MODE === "1" || message?.type !== "bid") {
      return super.webSocketMessage(server, data);
    }

    await this.load();
    const session = this.sessionFor(server);

    // Preserve the core room's existing auth/host/amount errors. Balance
    // enforcement only runs once there is a real authenticated bidder.
    if (!session.exp || session.exp <= Date.now() / 1000 || !Number.isSafeInteger(session.paddle) || session.paddle < 1 || session.paddle === this.lot?.hostPaddle) {
      return super.webSocketMessage(server, data);
    }
    if (!Number.isSafeInteger(message.amountLunas) || message.amountLunas <= 0) {
      return super.webSocketMessage(server, data);
    }

    try {
      const walletAddress = await this.authorizeBidderWallet(session, message.bidderProof);
      const balanceLunas = await fetchNimBalance(walletAddress, rpcUrlForEnv(this.env));
      if (balanceLunas < message.amountLunas) {
        throw new BidGuardError(
          "insufficient_balance",
          `You need at least ${formatNim(message.amountLunas)} NIM in this wallet to place this bid. Your current balance is ${formatNim(balanceLunas)} NIM.`
        );
      }
    } catch (error) {
      const code = error instanceof BidGuardError ? error.code : "balance_unavailable";
      const text = error instanceof BidGuardError
        ? error.message
        : "Nimgavel could not verify your live NIM balance. Please try the bid again.";
      try { server.send(JSON.stringify({ type: "error", code, message: text })); } catch {}
      return;
    }

    return super.webSocketMessage(server, data);
  }

  async authorizeBidderWallet(session, proof) {
    const now = Date.now();
    if (session.bidderWallet && session.bidderProofExpiresAt > now) {
      return session.bidderWallet;
    }

    if (!proof || typeof proof !== "object") {
      throw new BidGuardError("bidder_auth_required", "Confirm your bidder wallet in Nimiq Pay before placing your first bid.");
    }

    const walletAddress = normalizeNimiqAddress(proof.walletAddress);
    const expiresAt = Number(proof.expiresAt);
    if (!walletAddress || proof.paddle !== session.paddle || !Number.isSafeInteger(expiresAt)) {
      throw new BidGuardError("bidder_auth_required", "Bidder wallet authorization is invalid. Try the bid again.");
    }
    if (expiresAt <= now || expiresAt > now + BIDDER_PROOF_TTL_MS + PROOF_CLOCK_SKEW_MS) {
      throw new BidGuardError("bidder_auth_required", "Bidder wallet authorization expired. Confirm your wallet again.");
    }

    let expectedMessage;
    try {
      expectedMessage = bidderAuthorizationMessage({
        lotId: this.lot.id,
        paddle: session.paddle,
        walletAddress,
        expiresAt
      });
    } catch {
      throw new BidGuardError("bidder_auth_required", "Bidder wallet authorization is invalid. Try the bid again.");
    }

    const verified = await verifyNimiqSignedMessage({
      message: expectedMessage,
      walletAddress,
      publicKey: proof.publicKey,
      signature: proof.signature
    });
    if (!verified.ok) {
      throw new BidGuardError("bidder_auth_required", verified.error || "Bidder wallet authorization could not be verified.");
    }

    // Cache only on this authenticated socket. A reconnect must present the
    // signed proof again, while repeated bids in the same room stay seamless.
    session.bidderWallet = walletAddress;
    session.bidderProofExpiresAt = expiresAt;
    return walletAddress;
  }
}

async function listLotsLightweight(env, url) {
  if (!env.DB) throw new Error("database unavailable");
  const limit = listLimit(url.searchParams.get("limit"));
  const groups = [
    ["live", "status = 'live'", "started_at DESC"],
    ["upcoming", "status = 'created'", "COALESCE(scheduled_at, created_at) DESC"],
    ["results", "status IN ('sold', 'settled', 'passed')", "ended_at DESC"]
  ];

  const entries = await Promise.all(groups.map(async ([name, filter, order]) => {
    const result = await env.DB.prepare(
      `SELECT ${LIST_COLUMNS} FROM lots WHERE ${filter} ORDER BY ${order}, id ASC LIMIT ?`
    ).bind(limit).all();
    return [name, (result.results || []).map(toListLot)];
  }));

  return new Response(JSON.stringify(Object.fromEntries(entries)), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    }
  });
}

function toListLot(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    imageUrl: `/api/lots/${encodeURIComponent(row.id)}/image`,
    hostPaddle: numberOrNull(row.host_paddle),
    hostAddress: row.host_address,
    startPriceLunas: numberOrNull(row.start_price_lunas),
    minIncrementLunas: numberOrNull(row.min_increment_lunas),
    durationSec: numberOrNull(row.duration_sec),
    status: row.status,
    scheduledAt: numberOrNull(row.scheduled_at),
    startedAt: numberOrNull(row.started_at),
    endedAt: numberOrNull(row.ended_at),
    winningPaddle: numberOrNull(row.winning_paddle),
    winningBidLunas: numberOrNull(row.winning_bid_lunas),
    txHash: row.tx_hash || null,
    settlement: listSettlement(row),
    createdAt: numberOrNull(row.created_at)
  };
}

function listSettlement(row) {
  const settled = row.status === "settled";
  if (!settled && row.status !== "sold") return null;
  if (!row.tx_hash && !settled) return null;
  if (Number(row.settle_verified || 0) === 1) return { state: "verified" };
  const failure = String(row.settle_failure || "");
  if (failure.startsWith("rejected:")) {
    return { state: "rejected", reason: failure.slice("rejected:".length) };
  }
  if (!row.tx_hash) return null;
  return { state: "pending" };
}

async function serveLotImage(request, env, lotId) {
  if (!env.DB) return new Response("Image unavailable.", { status: 503 });
  const row = await env.DB.prepare("SELECT image_url FROM lots WHERE id = ?").bind(lotId).first();
  if (!row) return new Response("Lot not found.", { status: 404 });

  const value = typeof row.image_url === "string" ? row.image_url : "";
  if (!value) {
    return Response.redirect(new URL("/favicon.svg", request.url).href, 302);
  }
  if (value.startsWith("https://")) {
    return Response.redirect(value, 302);
  }

  const match = value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return Response.redirect(new URL("/favicon.svg", request.url).href, 302);

  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    return Response.redirect(new URL("/favicon.svg", request.url).href, 302);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": `image/${match[1]}`,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff"
    }
  });
}

function listLimit(value) {
  if (value === null) return DEFAULT_LIST_LIMIT;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_LIST_LIMIT) {
    return DEFAULT_LIST_LIMIT;
  }
  return number;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function decodeLotId(value) {
  try {
    const lotId = decodeURIComponent(value);
    if (!lotId || lotId.length > 128 || /[\r\n]/.test(lotId)) throw new Error("invalid lot id");
    return lotId;
  } catch {
    return "";
  }
}

async function fetchNimBalance(walletAddress, rpcUrl) {
  let response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountByAddress",
        params: [walletAddress]
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
    });
  } catch {
    throw new Error("rpc unavailable");
  }

  if (!response.ok) throw new Error("rpc unavailable");
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error("rpc unavailable"); }

  if (payload?.error) throw new Error("rpc rejected account lookup");
  const balance = Number(payload?.result?.data?.balance);
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error("invalid balance response");
  return balance;
}

function rpcUrlForEnv(env) {
  if (env.NIMIQ_RPC_URL) return env.NIMIQ_RPC_URL;
  // Nimgavel is a mainnet product. Use mainnet unless a development/test
  // environment explicitly opts into testnet. This prevents an unset
  // NIMIQ_NETWORK binding from silently reporting funded mainnet wallets as 0.
  return env.NIMIQ_NETWORK === "testnet" ? TESTNET_RPC_URL : MAINNET_RPC_URL;
}

function formatNim(lunas) {
  const nim = Number(lunas) / 100_000;
  if (Number.isInteger(nim)) return String(nim);
  return nim.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

class BidGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
