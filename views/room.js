// S1 — The Room, live state + close + winner flow. Gold on midnight.
import { formatNim, sendPayment, WalletCancelledError } from "../lib/nimiq.js";
import { getLot, getRoomState, settleLot, verifySettlement } from "../lib/api.js";
import { session, isSpectate } from "../lib/session.js";
import { createRoomSocket } from "../lib/ws.js";

const PHASE_LABEL = {
  created: "GAVEL IN",
  live: "LIVE",
  going_once: "GOING ONCE",
  going_twice: "GOING TWICE",
  sold: "SOLD",
  settled: "SETTLED",
  passed: "PASSED · NO BIDS"
};

export function renderRoom(container, { navigate, params }) {
  const lotId = params[0];
  const state = {
    socket: null,
    phase: "created",
    endsAt: 0,
    offset: 0,
    startedAt: 0,
    currentBid: 0,
    minNext: 0,
    minIncrement: 100000,
    leading: null,
    hostPaddle: null,
    hostAddress: null,
    lotTitle: "",
    imageUrl: null,
    bids: [],
    connections: 0,
    connectionStatus: "connecting",
    tickTimer: null,
    booted: false,
    lastPhase: null,
    toastTimer: null,
    sold: null,
    receipt: null,
    paying: false
  };

  container.innerHTML = `
    <div class="slam-flash" id="slam-flash"></div>
    <div class="room-banner" id="room-banner" data-phase="created" aria-live="polite">
      <span class="phase-text" id="phase-text">CONNECTING</span>
      <span class="conn" id="conn-text"></span>
    </div>
    <div id="room-body"><div class="skeleton">entering the room…</div></div>
    <div id="cta-slot"></div>
  `;

  const body = container.querySelector("#room-body");
  const ctaSlot = container.querySelector("#cta-slot");
  const banner = container.querySelector("#room-banner");
  const phaseText = container.querySelector("#phase-text");
  const connText = container.querySelector("#conn-text");

  function renderBanner() {
    const phase = state.phase;
    const changed = phase !== state.lastPhase;
    state.lastPhase = phase;
    banner.dataset.phase = phase;
    phaseText.textContent = PHASE_LABEL[phase] || phase.toUpperCase();
    if (changed && state.booted) {
      phaseText.classList.remove("swap");
      void phaseText.offsetWidth;
      phaseText.classList.add("swap");
    }
    if (state.connectionStatus === "reconnecting") {
      connText.innerHTML = `<span class="reconnecting">reconnecting</span>`;
    } else {
      connText.textContent = state.connections ? `${state.connections} in the room` : "";
    }
  }

  function renderBody() {
    const closed = ["sold", "settled", "passed"].includes(state.phase);

    const image = state.imageUrl
      ? `<img class="lot-image" src="${escapeAttr(state.imageUrl)}" alt="${escapeAttr(state.lotTitle)}" />`
      : `<img class="lot-image" src="https://images.unsplash.com/photo-1589216532372-1c2a367900d9?w=800&q=75&auto=format" alt="Auction lot" />`;

    const soldBlock = closed && state.phase !== "passed" && state.sold
      ? `
        <div class="sold-wrap">
          <div class="sold-stamp">
            SOLD
            <span class="sub num">${formatNim(state.sold.amountLunas)} NIM · won by #${state.sold.winningPaddle} ${escapeHtml(state.sold.alias || "")}</span>
          </div>
        </div>`
      : state.phase === "passed"
        ? `<div class="passed-note">No bids this round. The lot can be relisted.</div>`
        : "";

    const leadingChip = state.leading
      ? `<span class="paddle-chip ${state.leading.paddle === session.paddle ? "own" : ""}">leading #${state.leading.paddle} ${escapeHtml(state.leading.alias || "")}</span>`
      : `<span class="dim" style="font-size:13px">waiting for the first paddle</span>`;

    const countdownHtml = closed
      ? ""
      : `<div class="countdown ${remaining() <= 15000 ? "urgent" : ""}" id="countdown">
           <svg width="56" height="56" viewBox="0 0 56 56">
             <circle cx="28" cy="28" r="24" fill="none" stroke="var(--border)" stroke-width="4" />
             <circle id="ring" cx="28" cy="28" r="24" fill="none"
               stroke="${remaining() <= 15000 ? "var(--red)" : "var(--gold)"}"
               stroke-width="4" stroke-linecap="round" stroke-dasharray="150.8" stroke-dashoffset="0" />
           </svg>
           <span class="time" id="countdown-time">${formatRemaining(remaining())}</span>
         </div>`;

    const feedRows = state.bids.length
      ? state.bids.slice(0, 30).map((bid) => `
          <div class="feed-row ${bid.paddle === session.paddle ? "own" : ""}">
            <span class="paddle">#${bid.paddle}</span>
            <span class="alias">${escapeHtml(bid.alias || "")}</span>
            <span class="amount num">${formatNim(bid.amountLunas)} NIM</span>
            <span class="ago">${formatAgo(bid.ts)}</span>
          </div>
        `).join("")
      : `<div class="feed-empty">No paddles up yet. First bid takes the lead at ${formatNim(state.minNext || 0)} NIM.</div>`;

    body.innerHTML = `
      <div class="room-lot">
        ${image}
        <h1 class="lot-title-lg">${escapeHtml(state.lotTitle || "Auction room")}</h1>
        <div class="lot-sub mono">host #${state.hostPaddle ?? "?"} · lot ${escapeHtml(String(lotId).slice(0, 8))}</div>
      </div>
      ${soldBlock}
      ${closed ? "" : `
      <div class="bid-block">
        <div class="current-bid">
          <div class="amount">${formatNim(state.currentBid || 0)}<span class="unit">NIM</span></div>
          <div class="leading">${leadingChip}</div>
        </div>
        ${countdownHtml}
      </div>`}
      <div class="bid-feed" role="log" aria-live="polite">${feedRows}</div>
      <div class="footer-space"></div>
    `;
    renderCta();
    updateRing();
  }

  function renderCta() {
    const closed = ["sold", "settled", "passed"].includes(state.phase);

    if (closed) {
      // Winner pay sheet (until settled) / receipt (after settle).
      const iWon = state.sold && session.paddle && session.paddle === state.sold.winningPaddle;

      if (iWon && state.phase === "sold" && !state.settled) {
        const due = state.sold.amountLunas;
        const hostShort = shortAddress(state.sold.hostAddress || state.hostAddress);
        ctaSlot.innerHTML = `
          <div class="sticky-cta">
            <div class="pay-sheet">
              <div class="due">${formatNim(due)} NIM</div>
              <div class="pay-sub">won by your paddle · pay to host <span class="mono">${escapeHtml(hostShort)}</span></div>
              <button class="btn full" id="pay-btn" ${state.paying ? "disabled" : ""}>
                ${state.paying ? "Waiting for Nimiq Pay…" : "Pay with Nimiq Pay"}
              </button>
            </div>
          </div>`;
        ctaSlot.querySelector("#pay-btn").addEventListener("click", payWinner);
        return;
      }

      if (state.receipt) {
        const r = state.receipt;
        const s = r.settlement || {};
        const chipClass = s.state === "verified" ? "verified" : s.state === "rejected" ? "rejected" : "pending";
        ctaSlot.innerHTML = `
          <div class="sticky-cta">
            <div class="receipt ${s.state === "verified" ? "ok" : ""}">
              <div class="r-row"><span class="label">tx</span>
                <span class="value"><a href="${escapeAttr(r.explorerUrl)}" target="_blank" rel="noreferrer">${shortHash(r.txHash)} →</a></span></div>
              <div class="r-row"><span class="label">settlement</span>
                <span class="settle-chip ${chipClass} ${s.state === "pending" ? "shimmer" : ""}">${
                  s.state === "verified" ? "✓ verified on-chain"
                  : s.state === "rejected" ? `rejected · ${escapeHtml(s.reason || "payment mismatch")}`
                  : "checking the payment on chain…"
                }</span></div>
            </div>
          </div>`;
        return;
      }

      ctaSlot.innerHTML = "";
      return;
    }

    if (isSpectate()) {
      ctaSlot.innerHTML = `
        <div class="sticky-cta">
          <div class="cta-note">Spectating. Bidding needs Nimiq Pay.</div>
        </div>`;
      return;
    }

    if (state.hostPaddle === session.paddle) {
      ctaSlot.innerHTML = `
        <div class="sticky-cta">
          <div class="cta-note">You are hosting. Watch the room.</div>
        </div>`;
      return;
    }

    const disconnected = state.connectionStatus !== "open";
    ctaSlot.innerHTML = `
      <div class="sticky-cta">
        <button class="btn" id="bid-btn" aria-live="polite" ${disconnected ? "disabled" : ""}>
          ${disconnected ? "reconnecting to the room…" : `BID ${formatNim(state.minNext || 0)} NIM`}
        </button>
      </div>`;
    ctaSlot.querySelector("#bid-btn").addEventListener("click", placeBid);
  }

  function remaining() {
    return Math.max(state.endsAt - (Date.now() + state.offset), 0);
  }

  function tick() {
    const timeEl = container.querySelector("#countdown-time");
    if (!timeEl || !state.endsAt) return;
    timeEl.textContent = formatRemaining(remaining());
    updateRing();

    const phase = phaseForRemaining(remaining());
    if (phase !== state.phase && ["live", "going_once", "going_twice"].includes(state.phase)) {
      state.phase = phase;
      renderBanner();
    }
  }

  function updateRing() {
    const ring = container.querySelector("#ring");
    if (!ring || !state.endsAt) return;
    const total = Math.max(state.endsAt - (state.startedAt || state.endsAt - 180000), 1000);
    const left = Math.min(remaining() / total, 1);
    ring.style.strokeDashoffset = String(150.8 * (1 - left));
    const cd = container.querySelector("#countdown");
    if (cd) {
      const urgent = remaining() <= 15000;
      cd.classList.toggle("urgent", urgent);
      ring.style.stroke = urgent ? "var(--red)" : "var(--gold)";
    }
  }

  function phaseForRemaining(ms) {
    if (ms > 30000) return "live";
    if (ms > 15000) return "going_once";
    if (ms > 0) return "going_twice";
    return "sold";
  }

  function placeBid() {
    if (!state.socket) return;
    state.socket.send({ type: "bid", amountLunas: state.minNext });
  }

  function onMessage(message) {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "state":
        state.phase = message.phase;
        state.endsAt = message.endsAt;
        state.currentBid = message.currentBidLunas;
        state.minNext = message.minNextBidLunas;
        state.leading = message.leadingPaddle;
        state.bids = (message.bids || []).slice().reverse();
        state.connections = message.connections;
        if (message.lot) {
          state.lotTitle = message.lot.title;
          state.imageUrl = message.lot.imageUrl;
          state.hostPaddle = message.lot.hostPaddle;
          state.minIncrement = message.lot.minIncrementLunas || 100000;
          state.startedAt = state.endsAt - message.lot.durationSec * 1000;
        }
        renderBanner();
        renderBody();
        state.booted = true;
        // Reload of an already-closed room: the sold broadcast already
        // happened; rebuild the stamp from the state snapshot.
        if (["sold", "settled"].includes(state.phase) && !state.sold && state.leading) {
          state.sold = {
            winningPaddle: state.leading.paddle,
            alias: state.leading.alias,
            amountLunas: state.currentBid,
            hostAddress: state.hostAddress
          };
          renderBody();
        }
        break;
      case "bid":
        state.currentBid = message.amountLunas;
        state.leading = { paddle: message.paddle, alias: message.alias };
        state.minNext = message.amountLunas + state.minIncrement;
        state.bids.unshift({ paddle: message.paddle, alias: message.alias, amountLunas: message.amountLunas, ts: message.ts });
        renderBody();
        tickAmount();
        break;
      case "phase":
        state.phase = message.phase;
        if (typeof message.endsAt === "number") state.endsAt = message.endsAt;
        renderBanner();
        renderBody();
        break;
      case "sold":
        state.phase = "sold";
        state.sold = message;
        gavelSlam();
        renderBanner();
        renderBody();
        break;
      case "passed":
        state.phase = "passed";
        renderBanner();
        renderBody();
        break;
      case "error":
        handleErrorCode(message);
        break;
    }
  }

  function handleErrorCode(message) {
    const map = {
      outbid_increment: () => `Bid at least ${formatNim(state.minNext)} NIM`,
      host_cannot_bid: () => "Hosts watch, bidders win.",
      rate_limited: () => "Easy, auctioneer.",
      not_live: () => "The gavel already fell.",
      invalid_token: () => "Your paddle lost its seat. Refresh to continue."
    };
    showToast((map[message.code] || (() => "That bid didn't go through. Try again."))());
  }

  function tickAmount() {
    const el = container.querySelector(".current-bid .amount");
    if (!el) return;
    el.classList.remove("tick");
    void el.offsetWidth;
    el.classList.add("tick");
  }

  function gavelSlam() {
    flash.classList.remove("on");
    void flash.offsetWidth; // restart animation
    flash.classList.add("on");
    if (navigator.vibrate) navigator.vibrate(20);
  }

  async function payWinner() {
    if (state.paying) return;
    state.paying = true;
    renderCta();
    try {
      const payment = await sendPayment({
        recipient: state.sold.hostAddress || state.hostAddress,
        nim: formatNim(state.sold.amountLunas)
      });
      const settled = await settleLot(lotId, session.paddleToken, payment.txHash);
      state.phase = "settled";
      state.settled = true;
      state.receipt = settled.receipt;
      showToast("The gavel fell your way. Paid.");
    } catch (error) {
      if (error instanceof WalletCancelledError) {
        showToast("Payment cancelled. Pay when ready.");
      } else {
        showToast(`${error.message || "The payment didn't go through."} Nothing was sent.`);
      }
    }
    state.paying = false;
    renderBanner();
    renderBody();
    pollVerification();
  }

  async function pollVerification() {
    for (let attempt = 0; attempt < 3 && !state.receipt?.settlement?.verified; attempt += 1) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const result = await verifySettlement(lotId, session.paddleToken);
        if (state.receipt) {
          state.receipt.settlement = result.settlement;
          renderCta();
        }
        if (result.settlement?.state === "verified") break;
      } catch { /* retry */ }
    }
  }

  function showToast(message) {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    let el = container.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      container.appendChild(el);
    }
    el.textContent = message;
    el.style.display = "block";
    state.toastTimer = setTimeout(() => { el.style.display = "none"; }, 2200);
  }

  async function start() {
    try {
      const detail = await getLot(lotId);
      if (detail?.lot?.id) {
        state.hostAddress = detail.lot.hostAddress;
        state.minIncrement = detail.lot.minIncrementLunas;
        state.lotTitle = detail.lot.title;
        state.imageUrl = detail.lot.imageUrl;
        state.hostPaddle = detail.lot.hostPaddle;
        document.title = `${detail.lot.title} · Nimgavel`;

        // Reload of an already-closed room: reconstruct the outcome so the
        // stamp renders without the live sold broadcast.
        if (detail.lot.status === "passed") {
          state.phase = "passed";
        } else if (["sold", "settled"].includes(detail.lot.status) && detail.lot.winningPaddle) {
          state.phase = detail.lot.status;
          state.currentBid = detail.lot.winningBidLunas || 0;
          state.sold = {
            winningPaddle: detail.lot.winningPaddle,
            alias: "",
            amountLunas: detail.lot.winningBidLunas || 0,
            hostAddress: detail.lot.hostAddress
          };
          if (detail.lot.status === "settled" && detail.lot.txHash) {
            state.settled = true;
            state.receipt = {
              txHash: detail.lot.txHash,
              explorerUrl: `https://nimiq.watch/transaction/${detail.lot.txHash}`,
              settlement: detail.lot.settlement || { state: "pending" }
            };
          }
        }
      }
    } catch {
      // Room state alone still carries the view.
    }

    // Dead end: unknown lot id (bad link, deleted lot). The ghost explains.
    if (!state.lotTitle) {
      const roomProbe = await getRoomState(lotId).catch(() => null);
      if (!roomProbe?.lot) {
        renderRoomGone();
        return;
      }
    }

    const paddle = session.paddle ?? 0;
    const alias = session.alias ?? "Spectator";
    state.socket = createRoomSocket({
      lotId,
      paddle,
      alias,
      onMessage,
      onStatus: (status) => {
        state.connectionStatus = status;
        renderBanner();
        renderCta();
      }
    });
    state.socket.connect();
    state.tickTimer = setInterval(tick, 250);
  }

  function renderRoomGone() {
    body.innerHTML = `
      <div class="dead-end">
        ${ghostInline()}
        <div class="dead-title">This room is gone.</div>
        <div class="dead-sub">The gavel fell elsewhere. The lot may have been relisted under a new room.</div>
        <a class="btn sm" href="/lobby">Back to the lobby</a>
      </div>`;
    ctaSlot.innerHTML = "";
  }

  function ghostInline() {
    return `
<svg viewBox="0 0 96 96" height="84" width="84" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g class="ghost-body">
    <path d="M28 22c0-11 9-18 20-18s20 7 20 18v34l-6.5-5-6.5 5-7-5-7 5-6.5-5-6.5 5V22Z" fill="#131E33" stroke="#1D2A44" stroke-width="2"/>
    <circle class="ghost-eye" cx="39" cy="26" r="3" fill="#8A94AB"/>
    <circle class="ghost-eye" cx="57" cy="26" r="3" fill="#8A94AB"/>
    <path d="M42 36c2 2.4 6 2.4 8 0" stroke="#8A94AB" stroke-width="2" stroke-linecap="round"/>
  </g>
</svg>`;
  }

  start();

  return function cleanup() {
    clearInterval(state.tickTimer);
    if (state.toastTimer) clearTimeout(state.toastTimer);
    if (state.socket) state.socket.close();
  };
}

function formatRemaining(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatAgo(ts) {
  const seconds = Math.max(Math.floor((Date.now() - ts) / 1000), 0);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

function shortAddress(address) {
  const compact = String(address || "").replace(/ /g, "");
  return compact.length > 14 ? `${compact.slice(0, 8)}…${compact.slice(-6)}` : compact;
}

function shortHash(hash) {
  const h = String(hash || "");
  return h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttr(value) {
  return escapeHtml(value);
}
