// NIM <-> Lunas units and wallet-state types shared across the suite.
// The protocol fixed-point is 5 decimals; every amount the backend stores
// or verifies is integer Lunas.
export const LUNAS_PER_NIM = 100_000;

export class WalletCancelledError extends Error {
  constructor(message = "The wallet request was cancelled.") {
    super(message);
    this.name = "WalletCancelledError";
  }
}

const wallet = {
  // Sync spectate detection: without an injected provider the state must
  // be reliable before any async boot.
  state: typeof window !== "undefined" && window.nimiq ? "connecting" : "spectate"
};

export function getWalletState() {
  return wallet.state;
}

export function nimToLunas(nim) {
  const number = typeof nim === "number" ? nim : Number(nim);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError("NIM amount must be a positive number.");
  }
  const lunas = number * LUNAS_PER_NIM;
  if (!Number.isSafeInteger(lunas)) {
    throw new RangeError("NIM amount is too large.");
  }
  return lunas;
}

export function lunasToNim(lunas) {
  const number = typeof lunas === "number" ? lunas : Number(lunas);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new RangeError("Lunas must be a non-negative integer.");
  }
  return number / LUNAS_PER_NIM;
}

export function formatNim(lunas) {
  const nim = lunasToNim(lunas);
  if (Number.isInteger(nim)) return String(nim);
  return nim.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}
