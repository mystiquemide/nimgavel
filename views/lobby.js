// Gate 4 — Lobby. The app home for wallet users; spectate wrapper for
// plain browsers. LIVE card (REST poll), NEXT, results, host CTA, ghost
// empty state.
import { connectWallet, getPaddle, formatNim, WalletCancelledError } from "../lib/nimiq.js";
import { getOrCreatePaddle, listLots, getRoomState, ApiError } from "../lib/api.js";
import { session, isSpectate, walletReady } from "../lib/session.js";
import { ghostSvg } from "../components/ghost.js";
import { escapeHtml, escapeAttr } from "./room.js";

const LIST_REFRESH_MS = 30_000;
const LIVE_POLL_MS = 5_000;

export function renderLobby(container, { navigate }) {
  const state = {
    lots: { live: [], upcoming: [], results: [] },
    roomState: null,
    wallet: { status: "connecting", message: null },
    listTimer: null,
    liveTimer: null
  };

  container.innerHTML = `
    <header class="app-header">
      <img src="/favicon.svg" alt="Nimgavel" width="28" height="28" />
      <h1 class="brand">NIMGAVEL</h1>
      <span class="tagline">Going once.<br/>Going twice. NIM.</span>
    </header>
    <div id="spectate-slot"></div>
    <div id="wallet-slot"></div>
    <main class="lobby-main" id="lobby-main"><div class="skeleton">connecting wallet…</div></main>
    <footer class="app-footer">
      <span>Nimgavel</span>
      <span class="mono">live auctions in NIM</span>
    </footer>
  `;

  const main = container.querySelector("#lobby-main");
  const walletSlot = container.querySelector("#wallet-slot");
  const spectateSlot = container.querySelector("#spectate-slot");

  function render() {
    renderWalletArea();
    renderLots();
  }

  function renderWalletArea() {
    if (isSpectate()) {
      
      spectateSlot.innerHTML = `
        <div class="spectate-bar">
          <span>Watching from a plain browser.</span>
          <a href="nimiqpay://miniapp?url=${encodeURIComponent("https://nimgavel.artistic-chip.workers.dev/lobby")}">Open in Nimiq Pay</a>
        </div>
      `;
      walletSlot.innerHTML = "";
      return;
    }

    const { status, message } = state.wallet;
    if (status === "ready") {
      walletSlot.innerHTML = `
        <div class="wallet-row">
          Paddle <b>#${session.paddle ?? "…"} ${session.alias ?? ""}</b>
        </div>
      `;
      return;
    }
    if (status === "connecting") {
      walletSlot.innerHTML = "";
      return;
    }

    const copy = status === "no_accounts"
      ? "No Nimiq account found. Create one in Nimiq Pay, then try again."
      : message || "Wallet request cancelled. Tap to retry.";
    walletSlot.innerHTML = `
      <div class="wallet-row">
        ${escapeHtml(copy)}
        <button class="btn sm full" style="margin-top:10px" id="wallet-retry">Try again</button>
      </div>
    `;
    walletSlot.querySelector("#wallet-retry").addEventListener("click", () => {
      bootWallet();
    });
  }

  function renderLots() {
    const { live, upcoming, results } = state.lots;
    const bootDone = state.wallet.status !== "connecting";
    const hasAnything = live.length || upcoming.length || results.length;

    if (!hasAnything && !isSpectate() && bootDone) {
      main.innerHTML = `
        <div class="ghost-state">
          ${ghostSvg()}
          <div>The room is quiet. Host the first lot.</div>
          ${walletReady() ? `<button class="btn sm" id="ghost-host" style="margin-top:6px">Host a lot</button>` : ""}
        </div>
      `;
      const hostButton = main.querySelector("#ghost-host");
      if (hostButton) hostButton.addEventListener("click", () => navigate("/host"));
      return;
    }

    const sections = [];

    if (live.length) {
      const lot = live[0];
      const room = state.roomState;
      const bid = room?.currentBidLunas ?? lot.startPriceLunas ?? 0;
      const remaining = roomRemaining(room);
      sections.push(`
        <div class="section-label live"><span class="live-dot"></span>LIVE</div>
        <div class="card lot-card">
          <img class="thumb" src="${escapeAttr(lot.imageUrl || "/favicon.svg")}" alt="${escapeAttr(lot.title)}" />
          <div class="lot-body">
            <h2 class="lot-title">${escapeHtml(lot.title)}</h2>
            <div class="lot-meta num">
              <span class="lot-price">${formatNim(bid)} NIM</span>
              ${room ? ` · ${room.connections} paddle${room.connections === 1 ? "" : "s"}` : ""}
              ${remaining !== null ? ` · ${formatRemaining(remaining)}` : ""}
            </div>
            <button class="btn sm full" style="margin-top:10px" data-enter="${escapeAttr(lot.id)}">Enter the room</button>
          </div>
        </div>
      `);
    }

    if (upcoming.length) {
      const lot = upcoming[0];
      sections.push(`
        <div class="section-label">NEXT${lot.scheduledAt ? ` · ${formatSchedule(lot.scheduledAt)}` : ""}</div>
        <div class="card lot-card">
          <img class="thumb" src="${escapeAttr(lot.imageUrl || "/favicon.svg")}" alt="${escapeAttr(lot.title)}" />
          <div class="lot-body">
            <h2 class="lot-title">${escapeHtml(lot.title)}</h2>
            <div class="lot-meta num">opens at ${formatNim(lot.startPriceLunas ?? 0)} NIM</div>
          </div>
        </div>
      `);
    }

    if (!isSpectate() && walletReady()) {
      sections.push(`
        <button class="btn secondary full" style="margin-top:12px" id="lobby-host">Host a lot</button>
      `);
    }

    if (isSpectate()) {
      
      sections.push(`
        <a class="btn full" style="margin-top:12px" href="nimiqpay://miniapp?url=${encodeURIComponent("https://nimgavel.artistic-chip.workers.dev/lobby")}">Bid from Nimiq Pay →</a>
      `);
    }

    if (results.length) {
      const rows = results.slice(0, 5).map((lot) => `
        <div class="card lot-card" style="margin-bottom:8px" data-enter="${escapeAttr(lot.id)}" role="button" aria-label="${escapeAttr(lot.title)}, sold for ${formatNim(lot.winningBidLunas ?? 0)} NIM">
          <img class="thumb" src="${escapeAttr(lot.imageUrl || "/favicon.svg")}" alt="${escapeAttr(lot.title)}" />
          <div class="lot-body">
            <div class="lot-title">${escapeHtml(lot.title)}</div>
            <div class="lot-meta num">
              <span class="lot-price">${formatNim(lot.winningBidLunas ?? 0)} NIM</span> · won by #${lot.winningPaddle ?? "?"}
            </div>
          </div>
        </div>
      `).join("");
      sections.push(`
        <div class="section-label">RECENT RESULTS <a href="/results" style="margin-left:auto;font-size:11px;padding:6px 0">all results →</a></div>
        ${rows}
      `);
    }

    main.innerHTML = sections.join("");

    main.querySelectorAll("[data-enter]").forEach((el) => {
      el.addEventListener("click", () => navigate(`/room/${el.dataset.enter}`));
    });
    const hostButton = main.querySelector("#lobby-host");
    if (hostButton) hostButton.addEventListener("click", () => navigate("/host"));
  }

  function roomRemaining(room) {
    if (!room || typeof room.endsAt !== "number" || typeof room.serverNow !== "number") return null;
    return Math.max(room.endsAt - room.serverNow, 0);
  }

  async function refreshList() {
    try {
      state.lots = await listLots();
      render();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      main.innerHTML = `<div class="wallet-row">Can't reach the auction house. Your connection or ours. Retrying…</div>`;
    }
  }

  async function pollLiveRoom() {
    const lot = state.lots.live[0];
    if (!lot) return;
    try {
      state.roomState = await getRoomState(lot.id);
    } catch {
      state.roomState = null;
    }
  }

  async function bootWallet() {
    state.wallet = { status: "connecting", message: null };
    render();

    const walletState = await connectWallet();
    if (["spectate", "cancelled", "no_accounts"].includes(walletState)) {
      state.wallet = { status: walletState, message: null };
      render();
      return;
    }

    try {
      const deviceId = await getPaddle();
      session.deviceId = deviceId;
      const paddle = await getOrCreatePaddle(deviceId);
      session.paddle = paddle.paddle;
      session.alias = paddle.alias;
      session.paddleToken = paddle.paddleToken;
      state.wallet = { status: "ready", message: null };
    } catch (error) {
      if (error instanceof WalletCancelledError) {
        state.wallet = { status: "cancelled", message: error.message };
      } else if (error instanceof ApiError) {
        state.wallet = { status: "error", message: "The paddle desk is unreachable. Tap to retry." };
      } else {
        state.wallet = { status: "cancelled", message: null };
      }
    }
    render();
  }

  async function start() {
    await refreshList();
    bootWallet();
    await pollLiveRoom();
    if (state.lots.live.length) renderLots();

    state.listTimer = setInterval(refreshList, LIST_REFRESH_MS);
    state.liveTimer = setInterval(async () => {
      await pollLiveRoom();
      if (state.lots.live.length) renderLots();
    }, LIVE_POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
  }

  function onVisibility() {
    if (document.visibilityState === "visible") {
      refreshList();
      pollLiveRoom().then(() => { if (state.lots.live.length) renderLots(); });
    }
  }

  start();

  return function cleanup() {
    clearInterval(state.listTimer);
    clearInterval(state.liveTimer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

function formatRemaining(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSchedule(timestamp) {
  const date = new Date(timestamp);
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}
