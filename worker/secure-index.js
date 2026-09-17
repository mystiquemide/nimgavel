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

export default worker;

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
