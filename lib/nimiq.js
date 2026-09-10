// Nimiq Pay wallet wrapper. One wallet connection per page.
// States: connecting -> ready | spectate | cancelled | no_accounts.
// User cancellations are normal outcomes (WalletCancelledError), never
// shown as errors in the UI per DESIGN.md section 8.
import { init as initSdk, requestDeviceIdentifier, getHostLanguage } from "@nimiq/mini-app-sdk";
import { deriveTxHash } from "./tx-hash.js";

export const LUNAS_PER_NIM = 100_000;
export const PADDLE_REASON = "Your Nimgavel bidder paddle";

export class WalletCancelledError extends Error {
  constructor(message = "The wallet request was cancelled.") {
    super(message);
    this.name = "WalletCancelledError";
  }
}

const wallet = {
  // Sync spectate detection: without an injected provider (plain browser,
  // direct room URLs) the state must be reliable before any async boot.
  state: typeof window !== "undefined" && window.nimiq ? "connecting" : "spectate",
  provider: null,
  account: null
};

// Dev-only review hook, compile-gated: `import.meta.env.DEV` is false in
// production builds, so ?reviewWallet=1 is dead code stripped from the
// deployed bundle.
if (typeof window !== "undefined" && import.meta.env.DEV) {
  const params = new URLSearchParams(location.search);
  if (params.get("reviewWallet") === "1" && !wallet.account) {
    wallet.state = "ready";
    wallet.account = "NQ49 A9A5 9UFL SDTQ 8HPU 5U43 1V4T EYMS EPT0";
  }
}

export function getWalletState() {
  return wallet.state;
}

export function getAccount() {
  return wallet.account;
}

export function getHostLanguageSafe() {
  try {
    return getHostLanguage();
  } catch {
    return undefined;
  }
}

export async function connectWallet({ timeoutMs = 8000 } = {}) {
  wallet.state = "connecting";

  let provider;
  try {
    provider = await initSdk({ timeout: timeoutMs });
  } catch {
    // The SDK only rejects init when the provider was never injected,
    // i.e. a plain browser: spectate mode, not an error.
    wallet.provider = null;
    wallet.account = null;
    wallet.state = "spectate";
    return wallet.state;
  }

  const accounts = await provider.listAccounts();
  if (isErrorResponse(accounts)) {
    wallet.provider = provider;
    wallet.account = null;
    wallet.state = "cancelled";
    return wallet.state;
  }
  if (!Array.isArray(accounts) || accounts.length === 0) {
    wallet.provider = provider;
    wallet.account = null;
    wallet.state = "no_accounts";
    return wallet.state;
  }

  wallet.provider = provider;
  wallet.account = accounts[0];
  wallet.state = "ready";
  return wallet.state;
}

export async function getPaddle() {
  try {
    return await requestDeviceIdentifier({ reason: PADDLE_REASON });
  } catch (error) {
    if (isUnavailableError(error)) {
      throw new Error("A paddle is only available inside Nimiq Pay.");
    }
    throw new WalletCancelledError(
      error?.message || "The paddle request was cancelled."
    );
  }
}

export async function signMessage(message) {
  const provider = requireProvider();
  const result = await provider.sign(String(message));
  if (isErrorResponse(result)) {
    throw new WalletCancelledError(result.error?.message || "The signing request was cancelled.");
  }
  if (!result?.publicKey || !result?.signature) {
    throw new Error("The wallet returned an incomplete signature.");
  }
  return { publicKey: result.publicKey, signature: result.signature };
}

export async function sendPayment({ recipient, nim }) {
  const provider = requireProvider();
  const valueLunas = nimToLunas(nim);

  const result = await provider.sendBasicTransaction({
    recipient,
    value: valueLunas
  });
  if (isErrorResponse(result)) {
    throw new WalletCancelledError(result.error?.message || "The payment was cancelled.");
  }

  const tx = deriveTxHash(String(result));
  return {
    serializedTx: tx.serializedTx,
    txHash: tx.txHash,
    valueLunas,
    feeLunas: Number(tx.fee),
    recipient: tx.recipient,
    sender: tx.sender,
    networkId: tx.networkId
  };
}

export async function isConsensusEstablished() {
  const provider = requireProvider();
  try {
    return await provider.isConsensusEstablished();
  } catch {
    return false;
  }
}

export function nimToLunas(nim) {
  const number = typeof nim === "number" ? nim : Number(nim);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError("NIM amount must be a positive number.");
  }
  const lunas = number * LUNAS_PER_NIM;
  if (!Number.isSafeInteger(lunas)) {
    throw new RangeError("NIM amount is too large.");
  }
  return lunas;
}

export function lunasToNim(lunas) {
  const number = typeof lunas === "number" ? lunas : Number(lunas);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new RangeError("Lunas must be a non-negative integer.");
  }
  return number / LUNAS_PER_NIM;
}

export function formatNim(lunas) {
  const nim = lunasToNim(lunas);
  if (Number.isInteger(nim)) return String(nim);
  return nim.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function requireProvider() {
  if (!wallet.provider) {
    throw new Error("The wallet is not connected yet.");
  }
  return wallet.provider;
}

function isErrorResponse(result) {
  return Boolean(result) && typeof result === "object" && "error" in result;
}

function isUnavailableError(error) {
  return typeof error?.message === "string" && error.message.includes("unavailable");
}
