// Page session state: wallet connection + paddle identity.
// bootWallet() is single-flight with an overall timeout: the first caller
// runs the connect+paddle handshake; every later caller awaits the same
// result. Views read getBootState() to surface retry UI instead of a
// forever-spinner when the wallet does not answer.
import {
  getWalletState,
  getAccount,
  connectWallet,
  getPaddle,
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

// idle | connecting | ready | spectate | cancelled | no_accounts | paddle_error
let bootState = { status: "idle", error: null };
let bootPromise = null;

export function getBootState() {
  return bootState;
}

// Retry entry point: clears the cached attempt so the next bootWallet()
// call starts a fresh handshake.
export function resetBoot() {
  bootPromise = null;
  bootState = { status: "idle", error: null };
}

export function bootWallet() {
  if (bootPromise) return bootPromise;
  bootState = { status: "connecting", error: null };
  bootPromise = (async () => {
    let walletState;
    try {
      walletState = await connectWallet();
    } catch {
      bootState = { status: "cancelled", error: null };
      return { walletState: "cancelled", paddle: null, error: null };
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
