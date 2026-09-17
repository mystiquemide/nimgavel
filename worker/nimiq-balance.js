const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_RETRY_DELAY_MS = 500;

export class BalanceLookupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BalanceLookupError";
    this.code = code;
  }
}

export function parseNimBalancePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new BalanceLookupError("invalid_payload", "Nimiq RPC returned an invalid response.");
  }
  if (payload.error) {
    throw new BalanceLookupError("rpc_error", "Nimiq RPC rejected the account lookup.");
  }

  // PoS RPC responses use result.data. Keep direct-result compatibility for
  // older/local fixtures, but require an explicit balance field either way.
  const account = payload.result?.data ?? payload.result;
  if (!account || typeof account !== "object" || !Object.prototype.hasOwnProperty.call(account, "balance")) {
    throw new BalanceLookupError("invalid_payload", "Nimiq RPC did not return an account balance.");
  }

  const rawBalance = account.balance;
  if (rawBalance === null || rawBalance === undefined || rawBalance === "" || typeof rawBalance === "boolean") {
    throw new BalanceLookupError("invalid_payload", "Nimiq RPC returned an invalid account balance.");
  }

  let balance;
  if (typeof rawBalance === "number") {
    balance = rawBalance;
  } else if (typeof rawBalance === "string" && /^\d+$/.test(rawBalance.trim())) {
    balance = Number(rawBalance.trim());
  } else {
    throw new BalanceLookupError("invalid_payload", "Nimiq RPC returned an invalid account balance.");
  }

  if (!Number.isSafeInteger(balance) || balance < 0) {
    throw new BalanceLookupError("invalid_payload", "Nimiq RPC returned an unsafe account balance.");
  }

  return balance;
}

export async function fetchNimBalance(
  walletAddress,
  rpcUrl,
  { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, retryDelayMs = DEFAULT_RETRY_DELAY_MS } = {}
) {
  let lastError = null;

  // One retry covers a transient timeout/rate-limit response. A first zero
  // balance is also confirmed once before Nimgavel rejects a funded-looking
  // wallet, so a single stale read cannot masquerade as an empty account.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `${Date.now()}-${attempt}`,
          method: "getAccountByAddress",
          params: [walletAddress]
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        throw new BalanceLookupError(
          response.status === 429 ? "rate_limited" : "rpc_http",
          `Nimiq RPC returned HTTP ${response.status}.`
        );
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new BalanceLookupError("invalid_json", "Nimiq RPC returned invalid JSON.");
      }

      const balance = parseNimBalancePayload(payload);
      if (balance !== 0 || attempt === 1) return balance;

      // Confirm a reported zero once. This costs one extra request only for
      // zero-balance reads and prevents a transient stale response becoming a
      // false "empty wallet" rejection.
      lastError = new BalanceLookupError("zero_unconfirmed", "Confirming zero NIM balance.");
    } catch (error) {
      lastError = error instanceof BalanceLookupError
        ? error
        : new BalanceLookupError("rpc_unavailable", "Nimiq RPC request failed.");
    }

    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw lastError || new BalanceLookupError("rpc_unavailable", "Nimiq RPC request failed.");
}
