import { listLots, getRoomState, ApiError } from "../lib/api.js";
import { formatNim } from "../lib/nimiq.js";
import { session, bootWallet, resetBoot, getBootState, isSpectate, walletReady } from "../lib/session.js";
import { qrToggleMarkup, wireQrToggle, storeLinksMarkup } from "../lib/qr.js";
import { escapeHtml, escapeAttr, shortAddress } from "./room.js";

const LIST_REFRESH_MS = 30_000;
const LIVE_POLL_MS = 5_000;
const APP_ORIGIN = "https://nimgavel.artistic-chip.workers.dev";

export function renderLobby(container) {
  let disposed = false;
  let activeFilter = "all";
  const state = {
    lots: { live: [], upcoming: [], results: [] },
    rooms: new Map(), // lotId -> room state
    walletBooted: false,
    unreachable: false,
    loaded: false,
    listTimer: null,
    liveTimer: null
  };

  function paddleChip() {
    if (isSpectate()) {
      return `<span class="paddle-val" id="user-paddle-display">Spectator · open in Nimiq Pay</span>`;
    }
    const boot = getBootState().status;
    if (boot === "connecting" || boot === "idle") {
      return `<span class="paddle-val" id="user-paddle-display">connecting…</span>`;
    }
    if (walletReady() && session.paddle) {
      return `<span class="paddle-val" id="user-paddle-display">#${session.paddle} ${escapeHtml(session.alias || "")}</span>`;
    }
    if (boot === "ready" && !session.paddle) {
      return `<span class="paddle-val" id="user-paddle-display">Paddle unavailable</span>`;
    }
    // cancelled | no_accounts | paddle_error: recoverable with a retry.
    return `
      <span class="paddle-val" id="user-paddle-display">Wallet didn't respond</span>
      <button type="button" class="btn-paddle-retry" id="btn-paddle-retry">Retry</button>`;
  }

  function lotCard(lot, room, status) {
    const remaining = roomRemaining(room);
    const isClosing = status === "live" && remaining !== null && remaining <= 30_000;
    const statusLabel = status === "upcoming"
      ? (lot.scheduledAt ? `STARTS ${formatSchedule(lot.scheduledAt).toUpperCase()}` : "UPCOMING")
      : isClosing ? "GOING ONCE" : "LIVE BIDDING";
    const bid = room?.currentBidLunas ?? lot.startPriceLunas ?? 0;
    const connections = room?.connections ?? 0;
    const bidCount = Array.isArray(room?.bids) ? room.bids.length : 0;
    const leader = room?.leadingPaddle
      ? `Paddle #${typeof room.leadingPaddle === "object" ? room.leadingPaddle.paddle : room.leadingPaddle} leading`
      : status === "upcoming" ? "Reserve price set" : "Awaiting first bid";
    const themeClasses = ["card-theme-wheat", "card-theme-coral", "card-theme-butter", "card-theme-mint"];
    const themeClass = themeClasses[Math.abs(hashString(lot.id)) % themeClasses.length];

    return `
      <article class="lobby-lot-card ${themeClass}" data-animate-child id="lot-${escapeAttr(lot.id)}">
        <div class="lobby-card-media">
          <img
            src="${escapeAttr(lot.imageUrl || "/favicon.svg")}"
            alt="${escapeAttr(lot.title)}"
            class="lobby-card-img"
            loading="lazy"
            decoding="async"
            width="800"
            height="500"
          />
          <div class="lobby-status-overlay">
            <span class="lobby-status-pill ${status}">
              ${status === "live" ? '<span class="status-pulse"></span>' : ""}
              <span>${statusLabel}</span>
            </span>
            ${status === "live" && remaining !== null ? `
            <span class="lobby-timer-pill" data-lot-id="${escapeAttr(lot.id)}" data-ends-at="${room.endsAt}" data-drift="${room.serverNow - Date.now()}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span class="timer-num">${formatRemaining(remaining)}</span>
            </span>` : ""}
          </div>
        </div>

        <div class="lobby-card-body">
          <div class="lobby-lot-info">
            <h2 class="lobby-lot-title">${escapeHtml(lot.title)}</h2>
            ${lot.description ? `<p class="lobby-lot-desc">${escapeHtml(lot.description)}</p>` : ""}
            <p class="lobby-lot-host">Host: ${escapeHtml(shortAddress(lot.hostAddress))}</p>
          </div>

          <div class="lobby-bid-box">
            <div class="lobby-bid-header">
              <span class="lobby-bid-label">${status === "upcoming" ? "STARTING RESERVE" : "CURRENT HIGH BID"}</span>
              <span class="lobby-bids-count">${status === "upcoming" ? `${connections} paddle${connections === 1 ? "" : "s"} in room` : `${bidCount} bids · ${connections} paddle${connections === 1 ? "" : "s"} in room`}</span>
            </div>
            <div class="lobby-bid-amount-row">
              <span class="lobby-bid-nim">${formatNim(bid)} NIM</span>
              <span class="lobby-bid-leader">${leader}</span>
            </div>
          </div>

          <a href="/room/${escapeAttr(lot.id)}" class="btn-enter-room" aria-label="Enter auction room for ${escapeAttr(lot.title)}">
            <span>${status === "upcoming" ? "View Lot Details" : "Enter Auction Room"}</span>
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </article>
    `;
  }

  function quietFloor() {
    if (state.unreachable) {
      return `
        <div class="quiet-floor-state" data-animate="scale-in">
          <div class="quiet-icon-box">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </div>
          <h2 class="quiet-title">Can't reach the auction house right now.</h2>
          <p class="quiet-desc">Your connection or ours. The rooms come back with a retry.</p>
          <div class="quiet-actions">
            <button class="btn-quiet-results" id="btn-retry-floor">Retry the Floor</button>
          </div>
        </div>
      `;
    }
    const emptyCopy = {
      all: ["No auctions on the block right now.", "Rooms open when a host lists a lot. Check back soon or host the next one."],
      live: ["No live bidding right now.", "Rooms open when a host lists a lot. Check back soon."],
      closing: ["Nothing is closing right now.", "Live rooms enter their final 30 seconds here, with the anti-snipe window in play."],
      upcoming: ["No upcoming auctions yet.", "Scheduled lots land here before they open. Host the next one and pick your start time."]
    }[activeFilter] || ["Nothing here yet.", "Check back soon."];
    return `
      <div class="quiet-floor-state" data-animate="scale-in">
        <div class="quiet-icon-box">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="8" y1="12" x2="16" y2="12"></line>
          </svg>
        </div>
        <h2 class="quiet-title">${emptyCopy[0]}</h2>
        <p class="quiet-desc">${emptyCopy[1]}</p>
        <div class="quiet-actions">
          <a href="/results" class="btn-quiet-results">View Past Results</a>
          <a href="/host" class="btn-quiet-host">Host the Next Auction</a>
        </div>
      </div>
    `;
  }

  function render() {
    if (disposed) return;
    const liveLots = state.lots.live || [];
    const upcomingLots = state.lots.upcoming || [];

    const visibleLots = [
      ...liveLots.map((lot) => ({ lot, status: "live" })),
      ...upcomingLots.map((lot) => ({ lot, status: "upcoming" }))
    ];
    const closingCount = liveLots.filter((lot) => {
      const r = state.rooms.get(lot.id);
      const rem = roomRemaining(r);
      return rem !== null && rem <= 30_000;
    }).length;

    const filteredLots = visibleLots.filter(({ lot, status }) => {
      if (activeFilter === "all") return true;
      if (activeFilter === "live") return status === "live";
      if (activeFilter === "closing") {
        const r = state.rooms.get(lot.id);
        return status === "live" && roomRemaining(r) !== null && roomRemaining(r) <= 30_000;
      }
      if (activeFilter === "upcoming") return status === "upcoming";
      return true;
    });

    container.innerHTML = `
      <div class="lobby-view">
        <!-- Subheader Navigation & Status -->
        <div class="lobby-header-bar">
          <div class="lobby-back-group">
            <a href="/" class="btn-back-nav" aria-label="Return to Landing Page">
              <span aria-hidden="true">←</span>
              <span>Back to Home</span>
            </a>
            <div class="lobby-title-wrap">
              <h1 class="lobby-title">The Auction Floor</h1>
              <span class="live-activity-badge">
                <span class="pulse-dot-green" aria-hidden="true"></span>
                <span>${liveLots.length} Auction${liveLots.length === 1 ? "" : "s"} on the Block</span>
              </span>
            </div>
          </div>

          <div class="lobby-user-actions">
            <div class="user-paddle-chip" id="lobby-paddle-chip">
              <span class="paddle-tag">Your Paddle</span>
              ${paddleChip()}
            </div>
            <a href="/host" class="btn-host-lot">
              <span aria-hidden="true">+</span>
              <span>Host an Auction</span>
            </a>
          </div>
        </div>

        ${isSpectate() ? `
        <div class="spectate-note-row">
          <span>Watching from a plain browser. Bidding runs inside Nimiq Pay.</span>
          <span class="spectate-actions">
            ${qrToggleMarkup("lobby-qr-toggle")}
            <a class="btn-open-pay" href="nimiqpay://miniapp?url=${encodeURIComponent(APP_ORIGIN + "/lobby")}">Open in Nimiq Pay</a>
          </span>
        </div>
        <p class="spectate-install-note">No Nimiq Pay yet? Get it free: ${storeLinksMarkup()} · <a href="https://www.nimiq.com/nimiq-pay" target="_blank" rel="noopener">nimiq.com/nimiq-pay</a>. Then scan the QR to jump straight into the floor.</p>` : ""}

        <!-- Filter Pills Bar -->
        <div class="lobby-filters-bar" role="tablist" aria-label="Filter auction lots">
          <button class="filter-pill ${activeFilter === "all" ? "active" : ""}" data-filter="all" role="tab" aria-selected="${activeFilter === "all"}">
            All Lots (${visibleLots.length})
          </button>
          <button class="filter-pill ${activeFilter === "live" ? "active" : ""}" data-filter="live" role="tab" aria-selected="${activeFilter === "live"}">
            Live Bidding (${liveLots.length})
          </button>
          <button class="filter-pill ${activeFilter === "closing" ? "active" : ""}" data-filter="closing" role="tab" aria-selected="${activeFilter === "closing"}">
            Closing Soon (${closingCount})
          </button>
          <button class="filter-pill ${activeFilter === "upcoming" ? "active" : ""}" data-filter="upcoming" role="tab" aria-selected="${activeFilter === "upcoming"}">
            Upcoming (${upcomingLots.length})
          </button>
        </div>

        <!-- Auction Floor Grid, Loading Skeleton, or Quiet State -->
        ${!state.loaded
          ? `
        <div class="lobby-lots-grid" aria-label="Loading the auction floor">
          ${[0, 1, 2].map(() => `
          <div class="lobby-lot-card lobby-skeleton-card" aria-hidden="true">
            <div class="lobby-card-media"><div class="skeleton-shimmer"></div></div>
            <div class="lobby-card-body">
              <div class="skeleton-line w-70"></div>
              <div class="skeleton-line w-45"></div>
              <div class="skeleton-line w-90"></div>
            </div>
          </div>`).join("")}
        </div>`
          : filteredLots.length === 0
          ? quietFloor()
          : `
        <div class="lobby-lots-grid" data-animate-stagger>
          ${filteredLots.map(({ lot, status }) => lotCard(lot, state.rooms.get(lot.id), status)).join("")}
        </div>`}
      </div>
    `;

    container.querySelectorAll(".filter-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeFilter = btn.getAttribute("data-filter") || "all";
        render();
      });
    });

    const retry = container.querySelector("#btn-retry-floor");
    if (retry) retry.addEventListener("click", () => {
      state.loaded = false;
      render();
      refreshList();
    });

    if (isSpectate()) {
      wireQrToggle({
        container,
        toggleId: "lobby-qr-toggle",
        deeplink: `nimiqpay://miniapp?url=${encodeURIComponent(APP_ORIGIN + "/lobby")}`
      });
    }

    const paddleRetry = container.querySelector("#btn-paddle-retry");
    if (paddleRetry) paddleRetry.addEventListener("click", () => {
      resetBoot();
      render();
      bootWallet().then(() => render());
    });

    initAnimations(container);
  }

  async function refreshList() {
    try {
      state.lots = await listLots();
      state.unreachable = false;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      state.unreachable = true;
    }
    // Rooms and lots load together: the floor must never show a start
    // price as if it were the live bid.
    await pollLiveRooms();
    state.loaded = true;
    render();
  }

  // Keep live-room facts (bid, paddles, countdown) honest while the floor is open.
  async function pollLiveRooms() {
    const liveLots = state.lots.live || [];
    await Promise.all(liveLots.map(async (lot) => {
      try {
        const room = await getRoomState(lot.id);
        state.rooms.set(lot.id, room);
      } catch {
        state.rooms.delete(lot.id);
      }
    }));

    // Patch timers and counters in place; a full re-render would reset focus.
    for (const [lotId, room] of state.rooms) {
      const card = container.querySelector(`#lot-${CSS.escape(lotId)}`);
      if (!card) continue;
      const timer = card.querySelector(".lobby-timer-pill .timer-num");
      const rem = roomRemaining(room);
      if (timer && rem !== null) {
        timer.textContent = formatRemaining(rem);
        const pill = timer.closest(".lobby-timer-pill");
        pill.dataset.endsAt = room.endsAt;
        pill.dataset.drift = room.serverNow - Date.now();
      }
      const nim = card.querySelector(".lobby-bid-nim");
      if (nim && typeof room.currentBidLunas === "number") {
        nim.textContent = `${formatNim(room.currentBidLunas)} NIM`;
      }
      const count = card.querySelector(".lobby-bids-count");
      if (count) {
        const bidCount = Array.isArray(room.bids) ? room.bids.length : 0;
        count.textContent = `${bidCount} bids · ${room.connections} paddle${room.connections === 1 ? "" : "s"} in room`;
      }
      const leader = card.querySelector(".lobby-bid-leader");
      if (leader) {
        const lp = room.leadingPaddle;
        leader.textContent = lp
          ? `Paddle #${typeof lp === "object" ? lp.paddle : lp} leading`
          : "Awaiting first bid";
      }
    }
  }

  function startLiveTimerTicking() {
    return setInterval(() => {
      container.querySelectorAll(".lobby-timer-pill").forEach((el) => {
        const endsAt = Number(el.dataset.endsAt || 0);
        const drift = Number(el.dataset.drift || 0);
        if (!endsAt) return;
        const ms = Math.max(endsAt - (Date.now() + drift), 0);
        const num = el.querySelector(".timer-num");
        if (num) num.textContent = formatRemaining(ms);
      });
    }, 1000);
  }

  function initAnimations(scope) {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.05 }
    );
    scope.querySelectorAll("[data-animate], [data-animate-stagger]").forEach((el) => observer.observe(el));
  }

  async function start() {
    refreshList();
    // Plain browsers are spectate from the first paint (sync detect, no
    // 8s SDK handshake). Only Pay webviews run the connect+paddle boot.
    if (!isSpectate()) {
      bootWallet().then(() => {
        state.walletBooted = true;
        render();
      });
    }
    state.listTimer = setInterval(refreshList, LIST_REFRESH_MS);
    state.liveTimer = setInterval(pollLiveRooms, LIVE_POLL_MS);
    const ticker = startLiveTimerTicking();

    return () => {
      clearInterval(state.listTimer);
      clearInterval(state.liveTimer);
      clearInterval(ticker);
    };
  }

  const cleanup = start();
  return function () {
    disposed = true;
    Promise.resolve(cleanup).then((stop) => stop && stop());
  };
}

function roomRemaining(room) {
  if (!room || typeof room.endsAt !== "number" || typeof room.serverNow !== "number") return null;
  return Math.max(room.endsAt - room.serverNow, 0);
}

function formatRemaining(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatSchedule(timestamp) {
  const date = new Date(timestamp);
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < String(value).length; i += 1) {
    hash = (hash * 31 + String(value).charCodeAt(i)) | 0;
  }
  return hash;
}
