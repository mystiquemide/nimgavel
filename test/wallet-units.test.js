// T5 unit tests: NIM <-> Lunas conversion and the wallet module surface.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LUNAS_PER_NIM,
  WalletCancelledError,
  nimToLunas,
  lunasToNim,
  formatNim,
  getWalletState
} from "../lib/nimiq.js";

test("LUNAS_PER_NIM matches the Nimiq protocol", () => {
  assert.equal(LUNAS_PER_NIM, 100_000);
});

test("nimToLunas converts whole and fractional NIM to integer Lunas", () => {
  assert.equal(nimToLunas(1), 100_000);
  assert.equal(nimToLunas(43), 4_300_000);
  assert.equal(nimToLunas(0.5), 50_000);
  assert.equal(nimToLunas(0.001), 100);
  assert.equal(nimToLunas("7"), 700_000);
});

test("nimToLunas rejects amounts that cannot be integer Lunas", () => {
  assert.throws(() => nimToLunas(0.000001), RangeError);
  assert.throws(() => nimToLunas(0), RangeError);
  assert.throws(() => nimToLunas(-1), RangeError);
  assert.throws(() => nimToLunas(Number.NaN), RangeError);
  assert.throws(() => nimToLunas(Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => nimToLunas(1e12), RangeError);
});

test("lunasToNim converts Lunas back to NIM", () => {
  assert.equal(lunasToNim(100_000), 1);
  assert.equal(lunasToNim(4_300_000), 43);
  assert.equal(lunasToNim(50_000), 0.5);
  assert.equal(lunasToNim(0), 0);
  assert.throws(() => lunasToNim(-1), RangeError);
  assert.throws(() => lunasToNim(1.5), RangeError);
});

test("formatNim renders compact auction prices", () => {
  assert.equal(formatNim(4_300_000), "43");
  assert.equal(formatNim(43_000_000), "430");
  assert.equal(formatNim(50_000), "0.5");
  assert.equal(formatNim(100), "0.001");
  assert.equal(formatNim(4_300_100), "43.001");
  assert.equal(formatNim(430_010), "4.3001");
  assert.equal(formatNim(0), "0");
});

test("wallet module exposes state and cancel error without touching window", () => {
  assert.equal(getWalletState(), "connecting");
  const cancel = new WalletCancelledError();
  assert.equal(cancel.name, "WalletCancelledError");
  assert.equal(cancel.message, "The wallet request was cancelled.");
});
