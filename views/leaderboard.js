// Public leaderboard: the floor's most active paddles. Paddle numbers are
// partially masked by the API, so the list shows personas (aliases), not
// a cross-auction identity index.
import { formatNim } from "../lib/nimiq.js";
import { escapeHtml } from "./room.js";

const REFRESH_MS = 5000;

export function renderLeaderboard(container) {
  let disposed = false;
  let refreshTimer = null;
  const state = { rows: null, unreachable: false, updatedAt: null };

  function freshnessText() {
    if (!state.updatedAt) return "Live board";
    const seconds = Math.max(0, Math.round((Date.now() - state.updatedAt) / 1000));
    return seconds < 5 ? "Updated just now" : `Updated ${seconds}s ago`;
  }

  function render() {
    if (disposed) return;
    if (state.unreachable && !state.rows) {
      container.innerHTML = `
        <div class="doc-view">
          <div class="doc-header">
            <a href="/lobby" class="btn-back-nav" aria-label="Return to Auction Floor">
              <span aria-hidden="true">←</span>
              <span>Back to Floor</span>
            </a>
            <h1 class="doc-title">The Leaderboard</h1>
          </div>
          <div class="quiet-floor-state" data-animate="scale-in">
            <h2 class="quiet-title">Can't reach the auction house right now.</h2>
            <p class="quiet-desc">Your connection or ours. The board will retry automatically.</p>
          </div>
        </div>
      `;
      return;
    }

    if (!state.rows) return; // loading: header only

    if (!state.rows.length) {
      container.innerHTML = `
        <div class="doc-view">
          <div class="doc-header">
            <a href="/lobby" class="btn-back-nav" aria-label="Return to Auction Floor">
              <span aria-hidden="true">←</span>
              <span>Back to Floor</span>
            </a>
            <h1 class="doc-title">The Leaderboard</h1>
            <p class="doc-lede">The floor's most active paddles. No names, no wallets, just the chant.</p>
            <p class="lot-meta" aria-live="polite">${freshnessText()} · refreshes every 5s</p>
          </div>
          <div class="quiet-floor-state" data-animate="scale-in">
            <h2 class="quiet-title">No bids on the board yet.</h2>
            <p class="quiet-desc">The first paddles to raise will rank here by wins, then by bids.</p>
            <div class="quiet-actions">
              <a href="/lobby" class="btn-quiet-results">Back to the Floor</a>
            </div>
          </div>
        </div>
      `;
      return;
    }

    const medal = ["gold", "wheat", "green"];
    const rows = state.rows.map((row, index) => `
      <div class="lb-row ${index < 3 ? `lb-${medal[index]}` : ""}" data-animate-child>
        <span class="lb-rank num">${index + 1}</span>
        <div class="lb-who">
          <span class="lb-alias">${escapeHtml(row.alias)}</span>
          <span class="lb-paddle mono">Paddle #${escapeHtml(row.paddle)}</span>
        </div>
        <div class="lb-stats">
          <span class="lb-stat"><strong class="num">${row.wins}</strong> won</span>
          <span class="lb-stat"><strong class="num">${row.bids}</strong> bids</span>
          <span class="lb-stat"><strong class="num">${row.rooms}</strong> rooms</span>
          <span class="lb-stat lb-volume"><strong class="num">${formatNim(row.wonLunas)}</strong> NIM in winning bids</span>
        </div>
      </div>
    `).join("");

    container.innerHTML = `
      <div class="doc-view">
        <div class="doc-header">
          <a href="/lobby" class="btn-back-nav" aria-label="Return to Auction Floor">
            <span aria-hidden="true">←</span>
            <span>Back to Floor</span>
          </a>
          <h1 class="doc-title">The Leaderboard</h1>
          <p class="doc-lede">
            The floor's most active paddles, ranked by gavels won, then bids raised.
            Paddle numbers stay partially hidden; the alias is the persona.
          </p>
          <p class="lot-meta" aria-live="polite">${freshnessText()} · refreshes every 5s${state.unreachable ? " · reconnecting" : ""}</p>
        </div>
        <div class="lb-list" data-animate-stagger>
          ${rows}
        </div>
      </div>
    `;
  }

  async function load({ initial = false } = {}) {
    if (initial) {
      container.innerHTML = `
        <div class="doc-view">
          <div class="doc-header">
            <a href="/lobby" class="btn-back-nav" aria-label="Return to Auction Floor">
              <span aria-hidden="true">←</span>
              <span>Back to Floor</span>
            </a>
            <h1 class="doc-title">The Leaderboard</h1>
          </div>
          <div class="lobby-lots-grid" aria-label="Loading the leaderboard">
            ${[0, 1, 2].map(() => `
            <div class="lobby-lot-card lobby-skeleton-card" aria-hidden="true">
              <div class="lobby-card-body" style="padding:20px">
                <div class="skeleton-line w-70"></div>
                <div class="skeleton-line w-45"></div>
                <div class="skeleton-line w-90"></div>
              </div>
            </div>`).join("")}
          </div>
        </div>
      `;
    }

    try {
      const response = await fetch(`/api/leaderboard?ts=${Date.now()}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error("bad response");
      state.rows = body.leaderboard || [];
      state.updatedAt = Date.now();
      state.unreachable = false;
    } catch {
      // Keep the last known board visible if a refresh fails. Only show the
      // full unreachable state when we have never successfully loaded data.
      state.unreachable = true;
    }
    render();
  }

  void load({ initial: true });
  refreshTimer = setInterval(() => {
    if (!document.hidden) void load();
  }, REFRESH_MS);

  const onVisibilityChange = () => {
    if (!document.hidden) void load();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  return function cleanup() {
    disposed = true;
    if (refreshTimer) clearInterval(refreshTimer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
