// Page session state: wallet connection + paddle identity.
// bootWallet() is single-flight: the first caller runs the connect+paddle
// handshake; every later caller (lobby, room, host) awaits the same result.
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

let bootPromise = null;

export function bootWallet() {
  if (!bootPromise) {
    bootPromise = (async () => {
      const walletState = await connectWallet();
      if (walletState !== "ready") return { walletState, paddle: null, error: null };

      try {
        const deviceId = await getPaddle();
        session.deviceId = deviceId;
        const paddle = await getOrCreatePaddle(deviceId);
        session.paddle = paddle.paddle;
        session.alias = paddle.alias;
        session.paddleToken = paddle.paddleToken;
        return { walletState, paddle, error: null };
      } catch (error) {
        // Wallet works but the paddle desk is unreachable: bidding stays
        // closed this visit, nothing is shown as an error screen.
        return {
          walletState,
          paddle: null,
          error: error instanceof WalletCancelledError || error instanceof ApiError
            ? error
            : null
        };
      }
    })();
  }
  return bootPromise;
}

export { WalletCancelledError };
