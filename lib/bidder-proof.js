// Shared canonical messages for binding a bidding paddle to a Nimiq wallet.
// V1 included a wallet address supplied by the client. V2 lets the Worker
// derive the checked address from the public key that actually signed the
// authorization, which avoids assuming the first shared Nimiq Pay account is
// the account the user intended to bid with.

export const BIDDER_PROOF_TTL_MS = 24 * 60 * 60 * 1000;
export const BIDDER_PROOF_VERSION = 2;

export function canonicalNimiqAddress(value) {
  const compact = String(value || "").trim().replace(/\s+/g, "").toUpperCase();
  if (!/^NQ[0-9]{2}[A-Z0-9]{32}$/.test(compact)) return null;
  return compact.match(/.{1,4}/g).join(" ");
}

function assertCommonFields({ lotId, paddle, expiresAt }) {
  if (typeof lotId !== "string" || !lotId || /[\r\n]/.test(lotId)) {
    throw new Error("A lot id is required.");
  }
  if (!Number.isSafeInteger(Number(paddle)) || Number(paddle) < 1) {
    throw new Error("A valid paddle is required.");
  }
  if (!Number.isSafeInteger(Number(expiresAt)) || Number(expiresAt) <= 0) {
    throw new Error("A valid proof expiry is required.");
  }
}

// Legacy proof kept for already-open tabs during a rolling Cloudflare deploy.
export function bidderAuthorizationMessage({ lotId, paddle, walletAddress, expiresAt }) {
  const address = canonicalNimiqAddress(walletAddress);
  if (!address) throw new Error("A valid Nimiq wallet address is required.");
  assertCommonFields({ lotId, paddle, expiresAt });

  return [
    "Nimgavel bidder authorization",
    `Lot: ${lotId}`,
    `Paddle: ${Number(paddle)}`,
    `Wallet: ${address}`,
    `Expires: ${new Date(Number(expiresAt)).toISOString()}`,
    "Purpose: prove this wallet can back bids in this auction. No funds are locked."
  ].join("\n");
}

// V2 intentionally does not put a client-selected address in the message.
// The Worker derives the Nimiq address from the public key returned by the
// wallet signature and checks that exact account's live on-chain balance.
export function bidderAuthorizationMessageV2({ lotId, paddle, expiresAt }) {
  assertCommonFields({ lotId, paddle, expiresAt });

  return [
    "Nimgavel bidder authorization v2",
    `Lot: ${lotId}`,
    `Paddle: ${Number(paddle)}`,
    `Expires: ${new Date(Number(expiresAt)).toISOString()}`,
    "Purpose: prove the signing wallet can back bids in this auction. No funds are locked."
  ].join("\n");
}
