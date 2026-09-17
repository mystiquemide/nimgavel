// Page session state: wallet connection + paddle identity.
// bootWallet() is single-flight: the first caller runs the connect+paddle
// handshake; every later caller awaits the same result. A provider-injection
// timeout gets one bounded retry, while account approval and user cancellation
// never get silently re-prompted.
import {
  getWalletState,
  getAccount,
  connectWallet,
  getPaddle,
  isEmbeddedNimiqPay,
  WalletCancelledError
} from "./nimiq.js";
import { getOrCreatePaddle, ApiError } from "./api.js";

export const session = {
  get walletState() { return getWalletState(); },
  get account() { return getAccount(); },
  deviceId: null,
  paddle: null,
  alias: null,
  paddleToken: null
};

export const isSpectate = () => getWalletState() === "spectate";
export const walletReady = () => getWalletState() === "ready";
export const paddleReady = () => session.paddle !== null;

// idle | connecting | ready | spectate | provider_timeout | account_timeout |
// cancelled | no_accounts | wallet_error | paddle_error
let bootState = { status: "idle", error: null };
let bootPromise = null;

export function getBootState() {
  return bootState;
}

// Retry entry point: clears the cached attempt so the next bootWallet()
// call starts a fresh handshake.
export function resetBoot() {
  if (bootState.status === "connecting") return;
  bootPromise = null;
  Object.assign(session, { deviceId: null, paddle: null, alias: null, paddleToken: null });
  bootState = { status: "idle", error: null };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function bootWallet() {
  if (bootPromise) return bootPromise;
  bootState = { status: "connecting", error: null };
  bootPromise = (async () => {
    let walletState;
    try {
      walletState = await connectWallet();

      // initSdk timing out before provider injection is safe to retry once.
      // Account approval is deliberately excluded: a second listAccounts()
      // request could stack duplicate native permission prompts.
      if (walletState === "provider_timeout" && isEmbeddedNimiqPay()) {
        await wait(750);
        walletState = await connectWallet({ providerTimeoutMs: 15000, accountTimeoutMs: 45000 });
      }
    } catch (error) {
      bootState = { status: "wallet_error", error };
      return { walletState: "wallet_error", paddle: null, error };
    }

    if (walletState !== "ready") {
      bootState = { status: walletState, error: null };
      return { walletState, paddle: null, error: null };
    }

    try {
      const deviceId = await getPaddle();
      session.deviceId = deviceId;
      const paddle = await getOrCreatePaddle(deviceId);
      session.paddle = paddle.paddle;
      session.alias = paddle.alias;
      session.paddleToken = paddle.paddleToken;
      bootState = { status: "ready", error: null };
      return { walletState, paddle, error: null };
    } catch (error) {
      // Wallet works but the paddle desk is unreachable or cancelled:
      // bidding stays closed this visit; the UI offers a retry.
      bootState = {
        status: "paddle_error",
        error: error instanceof WalletCancelledError || error instanceof ApiError ? error : null
      };
      return { walletState, paddle: null, error };
    }
  })();
  return bootPromise;
}

export { WalletCancelledError };
