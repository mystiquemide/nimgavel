// On-chain settlement verification against a public Nimiq JSON-RPC node.
// ARCHITECTURE.md section 6: the worker checks the winner's recorded tx
// hash before trusting it. A payment counts as verified only when the
// chain shows an executed transfer of the winning amount to the host.

import { normalizeNimiqAddress } from "./auth.js";

export const MAINNET_RPC_URL = "https://rpc.nimiqwatch.com";
export const TESTNET_RPC_URL = "https://rpc.testnet.nimiqwatch.com";
const RPC_TIMEOUT_MS = 8000;
const MAX_UNVERIFIED_BATCH = 25;

export const SETTLE_STATE = {
  PENDING: "pending",
  VERIFIED: "verified",
  REJECTED: "rejected"
};

// Returns { status: "pending" | "verified" | "rejected", reason? }.
// pending: tx unknown yet or node unreachable (retry later).
// verified: executed transfer of exact amount to host.
// rejected: tx exists but does not pay the host the winning amount.
export async function verifySettlement({ txHash, hostAddress, amountLunas, lotId, network, rpcUrl }) {
  const rpcResult = await fetchTransaction(txHash, rpcUrl);
  if (!rpcResult.ok) {
    if (rpcResult.notFound) return { status: SETTLE_STATE.PENDING };
    // Network/protocol failure: keep pending, scheduler retries.
    return { status: SETTLE_STATE.PENDING, reason: rpcResult.error };
  }

  const tx = rpcResult.tx;
  if (tx.hash.toLowerCase() !== txHash.toLowerCase()) return { status: SETTLE_STATE.PENDING, reason: "RPC transaction hash mismatch." };
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

  if (tx.executionResult !== true) return { status: SETTLE_STATE.PENDING, reason: "Execution has not been confirmed." };
  const expectedNetwork = network === "mainnet" ? 24 : network === "testnet" ? 5 : null;
  if (expectedNetwork === null || tx.networkId !== expectedNetwork) return { status: SETTLE_STATE.REJECTED, reason: "The transaction network does not match this auction." };
  const reference = lotId && Array.from(new TextEncoder().encode(`Nimgavel:${lotId}`), byte => byte.toString(16).padStart(2, "0")).join("");
  if (!reference || typeof tx.recipientData !== "string" || tx.recipientData.toLowerCase() !== reference) return { status: SETTLE_STATE.REJECTED, reason: "The payment reference does not match this auction." };
  const confirmations = tx.confirmations;
  if (!Number.isSafeInteger(confirmations) || confirmations < 60 || !Number.isSafeInteger(tx.blockNumber) || tx.blockNumber < 1) {
    return { status: SETTLE_STATE.PENDING, reason: "Waiting for macro-block finality (60 confirmations)." };
  }
  return { status: SETTLE_STATE.VERIFIED, confirmations };
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

  if (!payload || typeof payload !== "object") return { ok: false, notFound: false, error: "The Nimiq RPC node returned an unexpected response." };
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

// Scheduled pass: verify pending settlements fairly across retries.
// Provider failures remain pending. Returns a summary for logging.
export async function verifyPendingSettlements(env, { now = Date.now(), rpcUrl } = {}) {
  const database = env.DB;
  if (!database) return { checked: 0, verified: 0, rejected: 0, pending: 0 };

  const rpc = rpcUrl || rpcUrlForEnv(env);
  const rows = await database.prepare(
    `SELECT id, host_address, winning_bid_lunas, tx_hash, settle_checked_at,
            settle_failure, created_at, ended_at
     FROM lots
     WHERE status = 'settled' AND settle_verified = 0
       AND (settle_failure IS NULL OR settle_failure NOT LIKE 'rejected:%')
     ORDER BY COALESCE(settle_checked_at, 0) ASC, id ASC
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
      lotId: row.id,
      network: env.NIMIQ_NETWORK || "testnet",
      rpcUrl: rpc
    });

    if (result.status === SETTLE_STATE.VERIFIED) {
      await database.prepare(
        `UPDATE lots SET settle_verified = 1, settle_checked_at = ?, settle_failure = NULL WHERE id = ? AND tx_hash = ?`
      ).bind(now, row.id, row.tx_hash).run();
      summary.verified += 1;
      continue;
    }

    if (result.status === SETTLE_STATE.REJECTED) {
      await database.prepare(
        `UPDATE lots SET settle_checked_at = ?, settle_failure = ? WHERE id = ? AND tx_hash = ? AND settle_verified = 0`
      ).bind(now, `rejected:${result.reason}`, row.id, row.tx_hash).run();
      summary.rejected += 1;
      continue;
    }

    // Pending: unknown tx or node problems. Persist progress without
    // turning provider outages into a false rejection of payment.
    const attempts = countAttempts(row.settle_failure) + 1;
    const reason = result.reason || "transaction not on chain yet";
    await database.prepare(
      `UPDATE lots SET settle_checked_at = ?, settle_failure = ? WHERE id = ? AND tx_hash = ? AND settle_verified = 0`
    ).bind(now, `pending:attempt=${attempts}:${reason}`, row.id, row.tx_hash).run();
    summary.pending += 1;
  }

  // Least-recently checked ordering keeps unknown transactions from starving newer receipts.
  return summary;
}

export function rpcUrlForEnv(env) {
  if (env.NIMIQ_RPC_URL) return env.NIMIQ_RPC_URL;
  if (env.NIMIQ_NETWORK === "mainnet") return MAINNET_RPC_URL;
  return TESTNET_RPC_URL;
}

function countAttempts(failure) {
  if (!failure) return 0;
  const match = failure.match(/^pending:attempt=(\d+)(?::|$)/);
  return match ? Number(match[1]) : failure.startsWith("pending:") ? 1 : 0;
}
