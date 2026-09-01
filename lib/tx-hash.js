// Derive Nimiq transaction hashes from basic-format serialized transactions.
// The wallet returns the serialized signed transaction, never the hash, so
// the hash is recomputed here with the same layout @nimiq/core uses:
//   hash = blake2b-256(serialize_content())
// Wire format (basic):  format(1)=0x00 | proofTypeAndFlags(1) | publicKey(32)
//   | recipient(20) | value(8 BE) | fee(8 BE) | validityStartHeight(4 BE)
//   | networkId(1) | signature(64) [| webauthn fields]
// Content preimage:     u16BE(0) | senderAddress(20) | senderType(1)=0x00
//   | recipient(20) | recipientType(1)=0x00 | value(8) | fee(8)
//   | validityStartHeight(4) | networkId(1) | flags(1)=0x00
// senderAddress = blake2b-256(publicKey)[0..20].
import { blake2b } from "@noble/hashes/blake2.js";

const BASIC_FORMAT_TAG = 0x00;
const ED25519_NO_WEBAUTHN = 0x00;
const BASIC_WIRE_SIZE = 139;
const PUBLIC_KEY_LENGTH = 32;
const SIGNATURE_LENGTH = 64;
const ADDRESS_LENGTH = 20;

export function parseSerializedBasicTx(serializedTx) {
  const bytes = hexToBytes(serializedTx);
  if (bytes.length !== BASIC_WIRE_SIZE) {
    throw new Error(
      `Serialized transaction has ${bytes.length} bytes, expected ${BASIC_WIRE_SIZE} for a basic transaction.`
    );
  }
  if (bytes[0] !== BASIC_FORMAT_TAG) {
    throw new Error("Only basic-format transactions are supported.");
  }
  if (bytes[1] !== ED25519_NO_WEBAUTHN) {
    throw new Error("Unsupported signature proof type in transaction.");
  }

  const publicKey = bytes.slice(2, 2 + PUBLIC_KEY_LENGTH);
  let offset = 2 + PUBLIC_KEY_LENGTH;
  const recipient = bytes.slice(offset, offset + ADDRESS_LENGTH);
  offset += ADDRESS_LENGTH;
  const value = bytesToBigIntBE(bytes.slice(offset, offset + 8));
  offset += 8;
  const fee = bytesToBigIntBE(bytes.slice(offset, offset + 8));
  offset += 8;
  const validityStartHeight = bytesToBigIntBE(bytes.slice(offset, offset + 4));
  offset += 4;
  const networkId = bytes[offset];
  offset += 1;
  const signature = bytes.slice(offset, offset + SIGNATURE_LENGTH);

  const sender = blake2b(publicKey, { dkLen: 32 }).slice(0, ADDRESS_LENGTH);

  return {
    serializedTx: bytesToHex(bytes),
    publicKey: bytesToHex(publicKey),
    sender: bytesToHex(sender),
    recipient: bytesToHex(recipient),
    value,
    fee,
    validityStartHeight,
    networkId,
    signature: bytesToHex(signature)
  };
}

export function deriveTxHash(serializedTx) {
  const tx = parseSerializedBasicTx(serializedTx);

  const content = new Uint8Array(66);
  // recipient_data length: 0, big-endian u16.
  content[0] = 0x00;
  content[1] = 0x00;
  let offset = 2;
  offset = appendBytes(content, offset, hexToBytes(tx.sender));
  content[offset] = 0x00; // senderType: basic
  offset += 1;
  offset = appendBytes(content, offset, hexToBytes(tx.recipient));
  content[offset] = 0x00; // recipientType: basic
  offset += 1;
  offset = appendBigIntBE(content, offset, tx.value, 8);
  offset = appendBigIntBE(content, offset, tx.fee, 8);
  offset = appendBigIntBE(content, offset, tx.validityStartHeight, 4);
  content[offset] = tx.networkId;
  offset += 1;
  content[offset] = 0x00; // flags: empty for basic transactions
  offset += 1;
  if (offset !== content.length) {
    throw new Error("Transaction content serialization length mismatch.");
  }

  return {
    ...tx,
    txHash: bytesToHex(blake2b(content, { dkLen: 32 }))
  };
}

function hexToBytes(value) {
  if (typeof value !== "string") {
    throw new Error("Serialized transaction must be a hex string.");
  }
  const normalized = value.trim().replace(/^0x/i, "").toLowerCase();
  if (normalized.length === 0 || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/.test(normalized)) {
    throw new Error("Serialized transaction is not valid hex.");
  }
  return Uint8Array.from(normalized.match(/../g), (byte) => Number.parseInt(byte, 16));
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBigIntBE(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function appendBytes(target, offset, bytes) {
  target.set(bytes, offset);
  return offset + bytes.length;
}

function appendBigIntBE(target, offset, value, byteLength) {
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    target[offset + index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return offset + byteLength;
}
