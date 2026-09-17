// Shared canonical messages for binding a bidding paddle to Nimiq Pay.
// V1 bound one client-selected address. V2 derived one address from the
// message-signing key. V3 signs the bounded set of NIM addresses that Nimiq
// Pay shared with the mini app so the balance guard can use the wallet's
// actual spendable account set instead of assuming the signing key is funded.

export const BIDDER_PROOF_TTL_MS = 24 * 60 * 60 * 1000;
export const BIDDER_PROOF_VERSION = 2;
export const BIDDER_PROOF_VERSION_V3 = 3;
export const MAX_BIDDER_WALLET_ADDRESSES = 8;

export function canonicalNimiqAddress(value) {
  const compact = String(value || "").trim().replace(/\s+/g, "").toUpperCase();
  if (!/^NQ[0-9]{2}[A-Z0-9]{32}$/.test(compact)) return null;
  return compact.match(/.{1,4}/g).join(" ");
}

export function canonicalWalletAddresses(values) {
  if (!Array.isArray(values)) return [];
  const unique = [];
  const seen = new Set();
  for (const value of values) {
    const address = canonicalNimiqAddress(value);
    if (!address || seen.has(address)) continue;
    seen.add(address);
    unique.push(address);
    if (unique.length >= MAX_BIDDER_WALLET_ADDRESSES) break;
  }
  return unique.sort();
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

// V2 derives one checked address from the public key returned by sign().
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

// V3 records the addresses Nimiq Pay shared for this wallet session. The
// signer still authorizes the bid proof, while the Worker checks the shared
// account set and requires at least one address to cover the proposed bid.
export function bidderAuthorizationMessageV3({ lotId, paddle, walletAddresses, expiresAt }) {
  assertCommonFields({ lotId, paddle, expiresAt });
  const addresses = canonicalWalletAddresses(walletAddresses);
  if (!addresses.length) throw new Error("At least one Nimiq Pay account is required.");

  return [
    "Nimgavel bidder authorization v3",
    `Lot: ${lotId}`,
    `Paddle: ${Number(paddle)}`,
    `Wallet accounts: ${addresses.join(", ")}`,
    `Expires: ${new Date(Number(expiresAt)).toISOString()}`,
    "Purpose: authorize balance-backed bids from these Nimiq Pay accounts. No funds are locked."
  ].join("\n");
}
