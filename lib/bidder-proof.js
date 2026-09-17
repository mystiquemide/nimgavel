// Shared canonical message for binding a bidding paddle to a Nimiq wallet.
// The client signs this once per auction and the Worker verifies the exact
// same string before accepting balance-backed bids.

export const BIDDER_PROOF_TTL_MS = 24 * 60 * 60 * 1000;

export function canonicalNimiqAddress(value) {
  const compact = String(value || "").trim().replace(/\s+/g, "").toUpperCase();
  if (!/^NQ[0-9]{2}[A-Z0-9]{32}$/.test(compact)) return null;
  return compact.match(/.{1,4}/g).join(" ");
}

export function bidderAuthorizationMessage({ lotId, paddle, walletAddress, expiresAt }) {
  const address = canonicalNimiqAddress(walletAddress);
  if (!address) throw new Error("A valid Nimiq wallet address is required.");
  if (typeof lotId !== "string" || !lotId) throw new Error("A lot id is required.");
  if (!Number.isSafeInteger(Number(paddle)) || Number(paddle) < 1) throw new Error("A valid paddle is required.");
  if (!Number.isSafeInteger(Number(expiresAt)) || Number(expiresAt) <= 0) throw new Error("A valid proof expiry is required.");

  return [
    "Nimgavel bidder authorization",
    `Lot: ${lotId}`,
    `Paddle: ${Number(paddle)}`,
    `Wallet: ${address}`,
    `Expires: ${new Date(Number(expiresAt)).toISOString()}`,
    "Purpose: prove this wallet can back bids in this auction. No funds are locked."
  ].join("\n");
}
