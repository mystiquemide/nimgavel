const RECENT_KEY = "nimgavel.recentLots";
const JOINED_KEY = "nimgavel.joinedLots";
const MAX_ITEMS = 8;

function readIds(key) {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => typeof entry === "string" ? entry : entry?.id)
      .filter((id) => typeof id === "string" && id.trim())
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function writeId(key, lotId) {
  if (typeof localStorage === "undefined") return;
  const id = String(lotId || "").trim();
  if (!id) return;
  try {
    const next = [id, ...readIds(key).filter((item) => item !== id)].slice(0, MAX_ITEMS);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Activity shortcuts are convenience only. Never block an auction if storage is unavailable.
  }
}

export function markRecentLot(lotId) {
  writeId(RECENT_KEY, lotId);
}

export function markJoinedLot(lotId) {
  writeId(JOINED_KEY, lotId);
  writeId(RECENT_KEY, lotId);
}

export function getRecentLotIds() {
  return readIds(RECENT_KEY);
}

export function getJoinedLotIds() {
  return readIds(JOINED_KEY);
}
