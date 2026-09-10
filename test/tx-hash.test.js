// T5 tx-hash oracle test: deriveTxHash must reproduce @nimiq-core tx.hash()
// exactly for every basic-format serialized transaction on the networks
// Nimiq Pay sends to (main 42, test 1, plus dev networks 2 and 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Nimiq from "@nimiq/core";
import { deriveTxHash, parseSerializedBasicTx } from "../lib/tx-hash.js";

const NETWORKS = [24, 5, 42, 1, 2, 4];

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildSignedTx({ value, fee, validityStartHeight, networkId }) {
  const keyPair = Nimiq.KeyPair.generate();
  const recipient = Nimiq.KeyPair.generate().toAddress();
  const tx = Nimiq.TransactionBuilder.newBasic(
    keyPair.toAddress(),
    recipient,
    BigInt(value),
    BigInt(fee),
    validityStartHeight,
    networkId
  );
  tx.sign(keyPair);
  return { tx, keyPair, recipient, serialized: hex(tx.serialize()) };
}

test("deriveTxHash matches @nimiq/core tx.hash() across networks and amounts", () => {
  let checked = 0;
  for (const networkId of NETWORKS) {
    for (const amount of [1, 100000, 4300001, 1_000_000_000, Number.MAX_SAFE_INTEGER / 1e5 - 1]) {
      const value = Math.floor(amount) * 100_000 + 7;
      const fee = 138;
      const { tx, keyPair, recipient, serialized } = buildSignedTx({
        value,
        fee,
        validityStartHeight: 12345,
        networkId
      });

      const derived = deriveTxHash(serialized);

      assert.equal(derived.txHash, tx.hash(), `hash mismatch on network ${networkId}`);
      assert.equal(derived.value, BigInt(value));
      assert.equal(derived.fee, BigInt(fee));
      assert.equal(derived.networkId, networkId);
      assert.equal(derived.sender, hex(new Uint8Array(keyPair.toAddress().serialize())));
      assert.equal(derived.recipient, hex(new Uint8Array(recipient.serialize())));
      assert.equal(derived.publicKey, keyPair.publicKey.toHex());
      assert.equal(derived.serializedTx, serialized.toLowerCase());
      checked += 1;
    }
  }
  assert.ok(checked >= 16);
});

test("deriveTxHash accepts 0x prefix and uppercase hex", () => {
  const { tx, serialized } = buildSignedTx({
    value: 500000,
    fee: 138,
    validityStartHeight: 100,
    networkId: 42
  });
  const derived = deriveTxHash(`0x${serialized.toUpperCase()}`);
  assert.equal(derived.txHash, tx.hash());
});

test("deriveTxHash rejects malformed serialized transactions", () => {
  const { serialized } = buildSignedTx({
    value: 500000,
    fee: 138,
    validityStartHeight: 100,
    networkId: 42
  });

  assert.throws(() => deriveTxHash(serialized.slice(0, -2)), /expected 139/);
  assert.throws(() => deriveTxHash("zz"), /hex/);
  assert.throws(() => deriveTxHash("0"), /hex/);
  // Flip the format tag byte to extended (0x01).
  assert.throws(() => deriveTxHash(`01${serialized.slice(2)}`), /basic-format/);
  // Flip the proof type byte to a webauthn variant.
  assert.throws(() => deriveTxHash(`${serialized.slice(0, 2)}01${serialized.slice(4)}`), /proof type/);
});

test("parseSerializedBasicTx exposes all wire fields", () => {
  const validityStartHeight = 4_242_424;
  const networkId = 1;
  const { serialized } = buildSignedTx({
    value: 430000,
    fee: 200,
    validityStartHeight,
    networkId
  });
  const parsed = parseSerializedBasicTx(serialized);
  assert.equal(parsed.validityStartHeight, BigInt(validityStartHeight));
  assert.equal(parsed.networkId, networkId);
  assert.equal(parsed.signature.length, 128);
  assert.equal(parsed.publicKey.length, 64);
  assert.equal(parsed.sender.length, 40);
  assert.equal(parsed.recipient.length, 40);
});
