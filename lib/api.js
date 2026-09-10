// Same-origin REST client for the Nimgavel worker API.
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: options.method || "GET",
      headers: options.body
        ? { "content-type": "application/json", ...(options.headers || {}) }
        : options.headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new ApiError("Can't reach the auction house. Your connection or ours.", 0);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(body.error || "The request failed.", response.status);
  }
  return body;
}

export const getRoomState = (lotId) =>
  request(`/api/rooms/${encodeURIComponent(lotId)}/state`);

export const getLot = (lotId) =>
  request(`/api/lots/${encodeURIComponent(lotId)}`);

export const listLots = () => request(`/api/lots`);

export const getOrCreatePaddle = (deviceId) =>
  request(`/api/paddle?deviceId=${encodeURIComponent(deviceId)}`);

export const createHostChallenge = (hostAddress) =>
  request("/api/host/challenge", { method: "POST", body: { hostAddress } });

export const createLot = (body) =>
  request("/api/lots", { method: "POST", body });

export const startLot = (lotId, hostToken) =>
  request(`/api/lots/${encodeURIComponent(lotId)}/start`, { method: "POST", body: { hostToken } });

export const settleLot = (lotId, paddleToken, txHash) =>
  request(`/api/lots/${encodeURIComponent(lotId)}/settle`, {
    method: "POST",
    headers: { authorization: `Bearer ${paddleToken}` },
    body: { txHash }
  });

export const verifySettlement = (lotId, paddleToken) =>
  request(`/api/lots/${encodeURIComponent(lotId)}/verify`, {
    method: "POST",
    headers: { authorization: `Bearer ${paddleToken}` },
    body: {}
  });
