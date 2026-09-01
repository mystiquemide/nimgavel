// On-chain settlement verification against a public Nimiq JSON-RPC node.
// ARCHITECTURE.md section 6: the worker checks the winner's recorded tx
// hash before trusting it. A payment counts as verified only when the
// chain shows an executed transfer of the winning amount to the host.

import { normalizeNimiqAddress } from "./auth.js";

export const MAINNET_RPC_URL = "https://rpc.nimiqwatch.com";
export const TESTNET_RPC_URL = "https://rpc.testnet.nimiqwatch.com";
const RPC_TIMEOUT_MS = 8000;
const MAX_UNVERIFIED_BATCH = 25;
const MAX_RPC_FAILURES = 3;

export const SETTLE_STATE = {
  PENDING: "pending",
  VERIFIED: "verified",
  REJECTED: "rejected"
};

// Returns { status: "pending" | "verified" | "rejected", reason? }.
// pending: tx unknown yet or node unreachable (retry later).
// verified: executed transfer of exact amount to host.
// rejected: tx exists but does not pay the host the winning amount.
export async function verifySettlement({ txHash, hostAddress, amountLunas, rpcUrl }) {
  const rpcResult = await fetchTransaction(txHash, rpcUrl);
  if (!rpcResult.ok) {
    if (rpcResult.notFound) return { status: SETTLE_STATE.PENDING };
    // Network/protocol failure: keep pending, scheduler retries.
    return { status: SETTLE_STATE.PENDING, reason: rpcResult.error };
  }

  const tx = rpcResult.tx;
  if (tx.executionResult === false) {
    return { status: SETTLE_STATE.REJECTED, reason: "The transaction failed to execute." };
  }

  const expectedHost = normalizeNimiqAddress(hostAddress);
  const actualRecipient = normalizeNimiqAddress(tx.to);
  if (!expectedHost || !actualRecipient || expectedHost !== actualRecipient) {
    return { status: SETTLE_STATE.REJECTED, reason: "The transaction pays a different recipient." };
  }

  const value = Number(tx.value);
  if (!Number.isSafeInteger(value) || value !== amountLunas) {
    return { status: SETTLE_STATE.REJECTED, reason: "The transaction amount does not match the winning bid." };
  }

  return { status: SETTLE_STATE.VERIFIED, confirmations: Number(tx.confirmations || 0) };
}

export async function fetchTransaction(txHash, rpcUrl) {
  let response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransactionByHash",
        params: [txHash]
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
    });
  } catch {
    return { ok: false, notFound: false, error: "The Nimiq RPC node is unreachable." };
  }

  if (!response.ok) {
    return { ok: false, notFound: false, error: `The Nimiq RPC node returned ${response.status}.` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, notFound: false, error: "The Nimiq RPC node returned invalid JSON." };
  }

  if (payload.error) {
    // Node answers "Transaction not found" as an internal error, matching
    // the live probe of rpc.nimiqwatch.com.
    const message = String(payload.error.data || payload.error.message || "");
    if (message.toLowerCase().includes("not found")) {
      return { ok: false, notFound: true };
    }
    return { ok: false, notFound: false, error: "The Nimiq RPC node rejected the lookup." };
  }

  const tx = payload?.result?.data;
  if (!tx || typeof tx.hash !== "string") {
    return { ok: false, notFound: false, error: "The Nimiq RPC node returned an unexpected response." };
  }
  return { ok: true, tx };
}

// Scheduled pass: verify pending settlements, give up after repeated
// RPC failures or a long-pending tx. Returns a summary for logging.
export async function verifyPendingSettlements(env, { now = Date.now(), rpcUrl } = {}) {
  const database = env.DB;
  if (!database) return { checked: 0, verified: 0, rejected: 0, pending: 0 };

  const rpc = rpcUrl || rpcUrlForEnv(env);
  const cutoff = now - 24 * 60 * 60 * 1000;
  const rows = await database.prepare(
    `SELECT id, host_address, winning_bid_lunas, tx_hash, settle_checked_at,
            settle_failure, created_at, ended_at
     FROM lots
     WHERE status = 'settled' AND settle_verified = 0
       AND (settle_failure IS NULL OR settle_failure NOT LIKE 'rejected:%')
     ORDER BY COALESCE(ended_at, created_at) ASC
     LIMIT ?`
  ).bind(MAX_UNVERIFIED_BATCH).all();

  const summary = { checked: 0, verified: 0, rejected: 0, pending: 0 };
  for (const row of rows?.results || []) {
    if (!row.tx_hash) continue;
    summary.checked += 1;

    const result = await verifySettlement({
      txHash: row.tx_hash,
      hostAddress: row.host_address,
      amountLunas: Number(row.winning_bid_lunas),
      rpcUrl: rpc
    });

    if (result.status === SETTLE_STATE.VERIFIED) {
      await database.prepare(
        `UPDATE lots SET settle_verified = 1, settle_checked_at = ?, settle_failure = NULL WHERE id = ?`
      ).bind(now, row.id).run();
      summary.verified += 1;
      continue;
    }

    if (result.status === SETTLE_STATE.REJECTED) {
      await database.prepare(
        `UPDATE lots SET settle_checked_at = ?, settle_failure = ? WHERE id = ?`
      ).bind(now, `rejected:${result.reason}`, row.id).run();
      summary.rejected += 1;
      continue;
    }

    // Pending: unknown tx or node problems. Persist progress; give up on
    // settlements that stayed unverifiable for more than a day.
    const attempts = countAttempts(row.settle_failure);
    const ageMs = now - Number(row.ended_at || row.created_at || now);
    if (attempts >= MAX_RPC_FAILURES || ageMs > 24 * 60 * 60 * 1000) {
      await database.prepare(
        `UPDATE lots SET settle_checked_at = ?, settle_failure = ? WHERE id = ?`
      ).bind(now, `pending:${result.reason || "transaction not on chain yet"}`, row.id).run();
    } else {
      await database.prepare(
        `UPDATE lots SET settle_checked_at = ?, settle_failure = ? WHERE id = ?`
      ).bind(now, row.settle_failure, row.id).run();
    }
    summary.pending += 1;
  }

  // Keep cutoff variable honest: reserved for future auto-expiry policy.
  void cutoff;
  return summary;
}

export function rpcUrlForEnv(env) {
  if (env.NIMIQ_RPC_URL) return env.NIMIQ_RPC_URL;
  if (env.NIMIQ_NETWORK === "mainnet") return MAINNET_RPC_URL;
  return TESTNET_RPC_URL;
}

function countAttempts(failure) {
  if (!failure) return 0;
  const match = failure.match(/^pending:attempt=(\d+)$/);
  return match ? Number(match[1]) : failure.startsWith("pending:") ? 1 : 0;
}
