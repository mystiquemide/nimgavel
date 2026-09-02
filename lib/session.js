// Page session state: wallet connection + paddle identity.
import { getWalletState, getAccount } from "./nimiq.js";

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
