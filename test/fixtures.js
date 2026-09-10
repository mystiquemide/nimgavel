import { Hash, KeyPair } from "@nimiq/core";
import { encodeNimiqSignedMessage } from "../worker/auth.js";

export const BASE = process.env.WRANGLER_URL || "http://127.0.0.1:8799";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(BASE).hostname)) throw new Error("Tests only run against a loopback worker.");

export async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body.error}`);
  return body;
}

export function makePaddle() {
  return api(`/api/paddle?deviceId=${crypto.randomUUID()}`);
}

export async function makeLot(spec = {}, host) {
  host ||= await makePaddle();
  const key = KeyPair.generate();
  const hostAddress = key.toAddress().toUserFriendlyAddress();
  const { challenge } = await api("/api/host/challenge", { method: "POST", body: JSON.stringify({ hostAddress }) });
  const created = await api("/api/lots", {
    method: "POST",
    body: JSON.stringify({
      title: "Local test auction", description: "Synthetic test fixture", startPriceLunas: 100000, minIncrementLunas: 100000, durationSec: 60,
      ...spec, hostPaddle: host.paddle, paddleToken: host.paddleToken, hostAddress,
      challengeId: challenge.id, publicKey: key.publicKey.toHex(), signature: key.sign(Hash.computeSha256(encodeNimiqSignedMessage(challenge.message))).toHex()
    })
  });
  return { ...created, host };
}

export function startAuction(created) {
  return api(`/api/lots/${created.lot.id}/start`, { method: "POST", body: JSON.stringify({ hostToken: created.hostToken }) });
}
