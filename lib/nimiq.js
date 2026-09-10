// Nimiq Pay wallet wrapper. One wallet connection per page.
// States: connecting -> ready | spectate | cancelled | no_accounts.
// User cancellations are normal outcomes (WalletCancelledError), never
// shown as errors in the UI per DESIGN.md section 8.
import { init as initSdk, requestDeviceIdentifier, getHostLanguage } from "@nimiq/mini-app-sdk";

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

  // The injected provider can accept a call and never answer (an
  // unanswered permission prompt, an app version mismatch). Every wallet
  // call is bounded so the UI can offer a retry instead of hanging.
  let accounts;
  try {
    accounts = await withTimeout(provider.listAccounts(), timeoutMs, "The wallet did not respond.");
  } catch {
    wallet.provider = provider;
    wallet.account = null;
    wallet.state = "cancelled";
    return wallet.state;
  }
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

async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getPaddle() {
  try {
    return await withTimeout(requestDeviceIdentifier({ reason: PADDLE_REASON }), 60000, "The paddle request timed out. Check Nimiq Pay before retrying.");
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
  const result = await withTimeout(provider.sign(String(message)), 60000, "The signature request timed out. Check Nimiq Pay before retrying.");
  if (isErrorResponse(result)) {
    throw new WalletCancelledError(result.error?.message || "The signing request was cancelled.");
  }
  if (!result?.publicKey || !result?.signature) {
    throw new Error("The wallet returned an incomplete signature.");
  }
  return { publicKey: result.publicKey, signature: result.signature };
}

export async function sendPayment({ recipient, nim, lotId }) {
  const provider = requireProvider();
  const valueLunas = nimToLunas(nim);
  if (!lotId || typeof provider.sendBasicTransactionWithData !== "function") throw new Error("Update Nimiq Pay to send an auction payment reference.");
  const { Transaction } = await import("@nimiq/core");
  const result = await withTimeout(provider.sendBasicTransactionWithData({
    recipient,
    value: valueLunas,
    data: `Nimgavel:${lotId}`
  }), 120000, "The payment outcome is unknown. Check your wallet before doing anything else.");
  if (isErrorResponse(result)) {
    if (result.error?.type === "PermissionDeniedError") throw new WalletCancelledError("The payment was cancelled.");
    throw new Error(result.error?.message || "The wallet could not confirm the payment outcome.");
  }
  return { ...readWalletPayment(result, Transaction), valueLunas };
}

export function readWalletPayment(result, Transaction) {
  if (typeof result !== "string") throw new Error("The wallet returned an unknown payment result. Check its transaction history.");
  const hex = result.trim().replace(/^0x/i, "");
  if (/^[a-f0-9]{64}$/i.test(hex)) return { txHash: hex.toLowerCase() };
  const tx = Transaction.fromAny(hex);
  try {
    return { txHash: tx.hash(), serializedTx: hex, networkId: tx.networkId };
  } finally {
    tx.free();
  }
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
  const text = String(nim).trim();
  if (!/^\d+(?:\.\d{1,5})?$/.test(text)) {
    throw new RangeError("Enter a positive NIM amount with at most five decimal places.");
  }
  const [whole, fraction = ""] = text.split(".");
  const lunas = BigInt(whole) * 100000n + BigInt(fraction.padEnd(5, "0"));
  if (lunas <= 0n || lunas > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("NIM amount is outside the supported range.");
  }
  return Number(lunas);
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
