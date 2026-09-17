// Nimiq Pay wallet wrapper. One wallet connection per page.
// States: connecting -> ready | spectate | provider_timeout | account_timeout |
// cancelled | no_accounts | wallet_error.
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

export class WalletTimeoutError extends Error {
  constructor(message = "The wallet did not respond in time.") {
    super(message);
    this.name = "WalletTimeoutError";
  }
}

export function isEmbeddedNimiqPay() {
  return typeof window !== "undefined" && Boolean(window.nimiq || window.nimiqPay);
}

const wallet = {
  // Nimiq Pay can expose its app bridge a moment before the wallet provider.
  // Treat either signal as an embedded-wallet environment so initSdk gets
  // time to wait for the provider instead of misclassifying the first load
  // as a plain spectator browser.
  state: isEmbeddedNimiqPay() ? "connecting" : "spectate",
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

export async function connectWallet({ providerTimeoutMs = 15000, accountTimeoutMs = 45000 } = {}) {
  wallet.state = "connecting";

  let provider;
  try {
    provider = await initSdk({ timeout: providerTimeoutMs });
  } catch {
    // initSdk's timeout is about provider injection, not user approval.
    // If the Nimiq Pay bridge/provider is visible, this is recoverable and
    // the session layer can safely retry once without opening two prompts.
    wallet.provider = null;
    wallet.account = null;
    wallet.state = isEmbeddedNimiqPay() ? "provider_timeout" : "spectate";
    return wallet.state;
  }

  wallet.provider = provider;

  // Account approval crosses the native Nimiq Pay bridge and can legitimately
  // take longer than provider injection. Keep a generous safety bound, but do
  // not recycle this into the provider retry path: a second listAccounts()
  // call could create duplicate permission prompts on slower devices.
  let accounts;
  try {
    accounts = await withTimeout(
      provider.listAccounts(),
      accountTimeoutMs,
      "Nimiq Pay is still waiting for account approval.",
      WalletTimeoutError
    );
  } catch (error) {
    wallet.account = null;
    if (error instanceof WalletTimeoutError) {
      wallet.state = "account_timeout";
    } else if (isWalletCancellation(error)) {
      wallet.state = "cancelled";
    } else {
      wallet.state = "wallet_error";
    }
    return wallet.state;
  }

  if (isErrorResponse(accounts)) {
    wallet.account = null;
    wallet.state = isWalletCancellation(accounts.error) ? "cancelled" : "wallet_error";
    return wallet.state;
  }
  if (!Array.isArray(accounts) || accounts.length === 0) {
    wallet.account = null;
    wallet.state = "no_accounts";
    return wallet.state;
  }

  wallet.account = accounts[0];
  wallet.state = "ready";
  return wallet.state;
}

async function withTimeout(promise, ms, message, TimeoutErrorClass = Error) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutErrorClass(message)), ms);
      })
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

  let result;
  try {
    result = await withTimeout(provider.sendBasicTransactionWithData({
      recipient,
      value: valueLunas,
      data: `Nimgavel:${lotId}`
    }), 120000, "The payment outcome is unknown. Check your wallet before doing anything else.");
  } catch (error) {
    // Nimiq Pay versions can signal a user cancellation either by returning
    // an error payload or by rejecting the provider promise. Only explicit
    // cancellation signals are safe to classify this way; unknown failures
    // must stay in recovery mode to avoid a possible double payment.
    if (isWalletCancellation(error)) {
      throw new WalletCancelledError(error?.message || "The payment was cancelled.");
    }
    throw error;
  }

  if (isErrorResponse(result)) {
    if (isWalletCancellation(result.error)) {
      throw new WalletCancelledError(result.error?.message || "The payment was cancelled.");
    }
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

function isWalletCancellation(error) {
  if (!error) return false;
  const nested = error?.error && typeof error.error === "object" ? error.error : null;
  const type = String(error.type || error.name || nested?.type || nested?.name || "");
  const code = error.code ?? nested?.code;
  const message = String(error.message || nested?.message || "");

  if (["PermissionDeniedError", "PERMISSION_DENIED", "AbortError"].includes(type)) return true;
  if (Number(code) === 4001) return true;
  return /\b(cancelled|canceled|user rejected|rejected by user|permission denied|denied by user|declined)\b/i.test(message);
}

function isUnavailableError(error) {
  return typeof error?.message === "string" && error.message.includes("unavailable");
}
