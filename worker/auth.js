import { blake2b } from "@noble/hashes/blake2.js";

const encoder = new TextEncoder();
const NIMIQ_ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVXY";
const NIMIQ_COMPACT_ADDRESS_PATTERN = /^NQ[0-9]{2}[A-Z0-9]{32}$/;
const TOKEN_VERSION = 1;

export const PADDLE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const HOST_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function normalizeNimiqAddress(value) {
  if (typeof value !== "string") return null;

  const compact = value.trim().replace(/\s+/g, "").toUpperCase();
  if (!NIMIQ_COMPACT_ADDRESS_PATTERN.test(compact)) return null;
  return compact.match(/.{1,4}/g).join(" ");
}

export async function sha256Hex(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export async function issueToken(payload, secret, now = Date.now()) {
  const tokenPayload = {
    v: TOKEN_VERSION,
    ...payload,
    exp: payload.exp ?? Math.floor((now + PADDLE_TOKEN_TTL_MS) / 1000)
  };
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(tokenPayload)));
  const signature = await hmacHex(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function verifyToken(token, secret, expected = {}, now = Date.now()) {
  if (typeof token !== "string") {
    return { ok: false, error: "Token is required." };
  }

  const parts = token.split(".");
  if (parts.length !== 2 || !/^[a-f0-9]{64}$/i.test(parts[1])) {
    return { ok: false, error: "Token is invalid." };
  }

  const validSignature = await verifyHmac(parts[0], parts[1], secret);
  if (!validSignature) {
    return { ok: false, error: "Token is invalid." };
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  } catch {
    return { ok: false, error: "Token is invalid." };
  }

  if (!payload || payload.v !== TOKEN_VERSION || !Number.isInteger(payload.exp)) {
    return { ok: false, error: "Token is invalid." };
  }
  if (payload.exp <= Math.floor(now / 1000)) {
    return { ok: false, error: "Token has expired." };
  }

  for (const [key, value] of Object.entries(expected)) {
    if (payload[key] !== value) {
      return { ok: false, error: "Token is invalid." };
    }
  }

  return { ok: true, payload };
}

export async function verifyNimiqSignedMessage({
  message,
  walletAddress,
  publicKey,
  signature
}) {
  const normalizedWallet = normalizeNimiqAddress(walletAddress);
  if (!normalizedWallet) {
    return { ok: false, error: "A valid Nimiq wallet address is required." };
  }
  if (!isHex(publicKey, 64) || !isHex(signature, 128)) {
    return { ok: false, error: "Public key or signature has an invalid format." };
  }

  try {
    const publicKeyBytes = fromHex(publicKey);
    const derivedAddress = publicKeyToNimiqAddress(publicKeyBytes);
    if (derivedAddress !== normalizedWallet) {
      return { ok: false, error: "Public key does not belong to this wallet." };
    }

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "Ed25519",
      cryptoKey,
      fromHex(signature),
      await crypto.subtle.digest("SHA-256", encodeNimiqSignedMessage(message))
    );

    if (!valid) {
      return { ok: false, error: "Wallet signature is invalid." };
    }

    return {
      ok: true,
      walletAddress: normalizedWallet,
      publicKey: publicKey.toLowerCase()
    };
  } catch {
    return { ok: false, error: "Wallet proof could not be verified." };
  }
}

export function publicKeyToNimiqAddress(publicKeyBytes) {
  if (!(publicKeyBytes instanceof Uint8Array) || publicKeyBytes.length !== 32) {
    throw new TypeError("Nimiq public keys must contain 32 bytes.");
  }

  const addressBytes = blake2b(publicKeyBytes, { dkLen: 32 }).slice(0, 20);
  const base32 = encodeNimiqBase32(addressBytes);
  const checksum = 98 - ibanChecksum(`NQ00${base32}`);
  const compact = `NQ${String(checksum).padStart(2, "0")}${base32}`;
  return compact.match(/.{1,4}/g).join(" ");
}

export function encodeNimiqSignedMessage(message) {
  const messageBytes = encoder.encode(String(message));
  const prefixBytes = encoder.encode(`\x16Nimiq Signed Message:\n${messageBytes.byteLength}`);
  const payload = new Uint8Array(prefixBytes.byteLength + messageBytes.byteLength);
  payload.set(prefixBytes);
  payload.set(messageBytes, prefixBytes.byteLength);
  return payload;
}

async function hmacHex(value, secret) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(new Uint8Array(signature));
}

async function verifyHmac(value, signature, secret) {
  const key = await importHmacKey(secret);
  return crypto.subtle.verify("HMAC", key, fromHex(signature), encoder.encode(value));
}

function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function encodeNimiqBase32(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      output += NIMIQ_ALPHABET[(value >>> bits) & 31];
      value &= (1 << bits) - 1;
    }
  }

  if (bits > 0) {
    output += NIMIQ_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function ibanChecksum(iban) {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let checksum = 0;

  for (const character of rearranged) {
    const numeric = /[0-9]/.test(character)
      ? character
      : String(character.charCodeAt(0) - 55);

    for (const digit of numeric) {
      checksum = (checksum * 10 + Number(digit)) % 97;
    }
  }

  return checksum;
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
  return Uint8Array.from(value.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
}

function isHex(value, length) {
  return typeof value === "string" && value.length === length && /^[a-fA-F0-9]+$/.test(value);
}
