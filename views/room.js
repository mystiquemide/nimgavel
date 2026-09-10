import { getLot, getRoomState, settleLot, verifySettlement, ApiError } from "../lib/api.js";
import {
  formatNim,
  sendPayment,
  WalletCancelledError
} from "../lib/nimiq.js";
import { session, bootWallet, isSpectate, walletReady } from "../lib/session.js";
import { createRoomSocket } from "../lib/ws.js";

const APP_ORIGIN = "https://nimgavel.artistic-chip.workers.dev";

export function renderRoom(container, lotId) {
  const state = {
    phase: "loading", // loading | live | going_once | going_twice | sold | passed | settled | gone
    lotTitle: null,
    lotDesc: "",
    imageUrl: null,
    hostAddress: null,
    hostPaddle: null,
    startPrice: 0,
    minIncrement: 0,
    currentBid: 0,
    minNext: 0,
    leading: null, // { paddle, alias }
    bids: [],
    connections: 0,
    endsAt: null,
    startedAt: null,
    socket: null,
    socketStatus: "connecting",
    clockOffset: 0,
    sold: null,
    receipt: null,
    paying: false,
    tickTimer: null,
    toastTimer: null,
    toast: null
  };

  function remaining() {
    if (typeof state.endsAt !== "number") return null;
    return Math.max(state.endsAt - (Date.now() + state.clockOffset), 0);
  }

  function canBid() {
    return walletReady() && session.paddle !== null && state.socketStatus === "open" &&
      ["live", "going_once", "going_twice"].includes(state.phase);
  }

  function render() {
    if (state.phase === "gone") {
      renderRoomGone();
      return;
    }

    const userPaddle = session.paddle;
    const userAlias = session.alias || "Spectator";
    const isUserLeading = state.leading && userPaddle !== null && state.leading.paddle === userPaddle;
    const isHost = state.hostPaddle !== null && userPaddle === state.hostPaddle;

    container.innerHTML = `
      <div class="room-view">
        <!-- Room Control Header -->
        <div class="room-header-bar">
          <div class="room-back-group">
            <a href="/lobby" class="btn-back-nav" aria-label="Return to Auction Floor">
              <span aria-hidden="true">←</span>
              <span>Back to Floor</span>
            </a>
            <div class="room-title-wrap">
              <h1 class="room-title">${state.lotTitle ? escapeHtml(state.lotTitle) : "Loading room…"}</h1>
              <span class="room-ws-badge" id="room-ws-badge">
                <span class="${state.socketStatus === "open" ? "pulse-dot-green" : "pulse-dot-amber"}" aria-hidden="true"></span>
                <span>${wsLabel()}</span>
              </span>
            </div>
          </div>

          <div class="room-user-chip">
            <span class="paddle-tag">Your Bidding Paddle</span>
            <span class="paddle-val">${userPaddle !== null ? `#${userPaddle} (${escapeHtml(userAlias)})` : "Spectator"}</span>
          </div>
        </div>

        <!-- Dynamic Gavel Urgency Banner -->
        <div class="room-phase-banner-wrap" id="phase-banner-wrap">
          ${renderPhaseBanner()}
        </div>

        <!-- 2-Column Room Arena -->
        <div class="room-arena-grid">
          <!-- Left Column: Lot Spotlight -->
          <div class="room-lot-column">
            <article class="room-lot-card">
              <div class="room-media-wrap">
                <img
                  src="${escapeAttr(state.imageUrl || "/favicon.svg")}"
                  alt="${escapeAttr(state.lotTitle || "Auction lot")}"
                  class="room-lot-img"
                  loading="eager"
                  decoding="async"
                  width="800"
                  height="500"
                />
                <div class="room-media-badges">
                  <span class="status-badge-live">
                    <span class="pulse-dot" aria-hidden="true"></span>
                    <span>${["sold", "settled", "passed"].includes(state.phase) ? "AUCTION CONCLUDED" : "ACTIVE LOT"}</span>
                  </span>
                  <span class="room-host-chip">Host: ${escapeHtml(shortAddress(state.hostAddress))}</span>
                </div>
              </div>

              <div class="room-lot-details">
                <h2 class="room-card-title">${escapeHtml(state.lotTitle || "")}</h2>
                ${state.lotDesc ? `<p class="room-card-desc">${escapeHtml(state.lotDesc)}</p>` : ""}

                <div class="room-spec-grid">
                  <div class="spec-cell">
                    <span class="spec-label">Starting Reserve</span>
                    <span class="spec-val">${formatNim(state.startPrice)} NIM</span>
                  </div>
                  <div class="spec-cell">
                    <span class="spec-label">Min Increment</span>
                    <span class="spec-val">+${formatNim(state.minIncrement)} NIM</span>
                  </div>
                  <div class="spec-cell">
                    <span class="spec-label">Settlement</span>
                    <span class="spec-val">Direct Wallet-to-Wallet</span>
                  </div>
                </div>
              </div>
            </article>
          </div>

          <!-- Right Column: Live Bidding Deck -->
          <div class="room-deck-column">
            <div class="bidding-deck-card">
              <!-- Top Bid Display -->
              <div class="deck-top-section">
                <div class="deck-price-block">
                  <span class="deck-price-label">CURRENT HIGH BID</span>
                  <div class="deck-price-amount-wrap">
                    <span class="deck-price-nim" id="room-bid-amount">${formatNim(state.currentBid)} NIM</span>
                    <span class="deck-price-fiat" id="room-next-amount">${nextBidLabel()}</span>
                  </div>
                  <div class="deck-leader-pill ${isUserLeading ? "user-leading" : ""}">
                    ${leaderLabel(isUserLeading)}
                  </div>
                </div>

                <!-- Countdown Timer Block -->
                ${state.endsAt !== null && !["sold", "settled", "passed"].includes(state.phase) ? `
                <div class="deck-timer-block">
                  <span class="deck-timer-label">TIME REMAINING</span>
                  <div class="deck-timer-display" id="deck-timer-display">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span class="deck-time-digits" id="deck-timer-digits">${formatRemaining(remaining() ?? 0)}</span>
                  </div>
                  <span class="deck-softclose-note">Anti-snipe: bids in the final 30s extend by +30s</span>
                </div>` : ""}
              </div>

              <!-- Live Bids Feed -->
              <div class="deck-feed-section">
                <div class="feed-header-row">
                  <span class="feed-title">LIVE BID STREAM</span>
                  <span class="feed-count">${state.bids.length} bids · ${state.connections} paddle${state.connections === 1 ? "" : "s"}</span>
                </div>
                <div class="feed-list-wrap" id="room-feed-list" role="log" aria-live="polite">
                  ${state.bids.length ? state.bids.map(renderFeedRow).join("")
                    : `<div class="feed-empty">No bids yet. The opening bid is ${formatNim(state.minNext || state.startPrice)} NIM.</div>`}
                </div>
              </div>

              <!-- Action Paddle Deck -->
              <div class="deck-action-section" id="room-action-section">
                ${renderActionSection()}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="toast" role="status" aria-live="polite" style="display:none"></div>
    `;

    wireActionButtons();
  }

  function renderFeedRow(bid) {
    const own = session.paddle !== null && bid.paddle === session.paddle;
    return `
      <div class="feed-row ${own ? "own-bid" : ""}">
        <div class="feed-row-left">
          <span class="feed-paddle-badge">#${bid.paddle}</span>
          <span class="feed-alias">${escapeHtml(bid.alias || "")}${own ? " (You)" : ""}</span>
        </div>
        <div class="feed-row-right">
          <span class="feed-amount">${formatNim(bid.amountLunas)} NIM</span>
          <span class="feed-time">${formatAgo(bid.ts)}</span>
        </div>
      </div>
    `;
  }

  function wsLabel() {
    const map = {
      connecting: "Connecting…",
      reconnecting: "Reconnecting to the room…",
      open: "Live Sync Active",
      closed: "Connection closed"
    };
    return map[state.socketStatus] || state.socketStatus;
  }

  function nextBidLabel() {
    if (["sold", "settled", "passed"].includes(state.phase)) return "";
    return state.minNext ? `next bid ≥ ${formatNim(state.minNext)} NIM` : "";
  }

  function leaderLabel(isUserLeading) {
    if (["sold", "settled"].includes(state.phase)) {
      if (state.sold && session.paddle !== null && state.sold.winningPaddle === session.paddle) {
        return '<span class="star-icon">★</span> The gavel fell your way!';
      }
      return state.sold ? `SOLD to Paddle #${state.sold.winningPaddle}${state.sold.alias ? ` (${escapeHtml(state.sold.alias)})` : ""}` : "Auction concluded";
    }
    if (state.phase === "passed") return "The lot passed without a winner";
    if (isUserLeading) return '<span class="star-icon">★</span> You have the winning bid!';
    if (state.leading) return `Highest Bidder: Paddle #${state.leading.paddle} (${escapeHtml(state.leading.alias || "")})`;
    return "Awaiting the opening bid";
  }

  function renderPhaseBanner() {
    const bid = state.currentBid;
    if (state.phase === "going_once") {
      return `
        <div class="phase-banner banner-coral">
          <span class="phase-gavel-icon">🔨</span>
          <span class="phase-text">GOING ONCE at <strong>${formatNim(bid)} NIM</strong>${state.leading ? ` to Paddle #${state.leading.paddle}` : ""}! Any final bids?</span>
        </div>
      `;
    }
    if (state.phase === "going_twice") {
      return `
        <div class="phase-banner banner-amber">
          <span class="phase-gavel-icon">⚡</span>
          <span class="phase-text">GOING TWICE! Final seconds to bid before the gavel drops!</span>
        </div>
      `;
    }
    if (["sold", "settled"].includes(state.phase)) {
      return `
        <div class="phase-banner banner-sold">
          <span class="phase-gavel-icon">🏆</span>
          <span class="phase-text">THE GAVEL FELL! SOLD${state.sold ? ` to Paddle #${state.sold.winningPaddle}` : ""} for ${formatNim(state.sold?.amountLunas ?? bid)} NIM!</span>
        </div>
      `;
    }
    if (state.phase === "passed") {
      return `
        <div class="phase-banner banner-amber">
          <span class="phase-gavel-icon">🔔</span>
          <span class="phase-text">THE GAVEL FELL — no qualifying bids. The lot passed.</span>
        </div>
      `;
    }
    return `
      <div class="phase-banner banner-live">
        <span class="phase-dot-live"></span>
        <span class="phase-text">Auction is active. Free bids accepted in real-time.</span>
      </div>
    `;
  }

  function renderActionSection() {
    // Concluded rooms show settlement surfaces instead of paddles.
    if (["sold", "settled"].includes(state.phase)) {
      const iWon = state.sold && session.paddle !== null && state.sold.winningPaddle === session.paddle;
      return iWon ? renderWinnerCard() : renderEndedCard();
    }
    if (state.phase === "passed") return renderEndedCard();

    // Spectators (plain browser or wallet not booted) get the Pay handoff.
    if (!walletReady() || session.paddle === null) {
      return `
        <div class="spectate-deck-note">
          <p class="spectate-deck-text">Spectator mode. Bidding runs inside Nimiq Pay.</p>
          <a class="btn-raise-paddle" href="nimiqpay://miniapp?url=${encodeURIComponent(`${APP_ORIGIN}/room/${lotId}`)}">
            <span>Open in Nimiq Pay to bid</span>
            <span aria-hidden="true">→</span>
          </a>
        </div>
      `;
    }

    if (state.hostPaddle === session.paddle) {
      return `
        <div class="spectate-deck-note">
          <p class="spectate-deck-text">You are hosting this lot. Hosts watch, bidders win.</p>
        </div>
      `;
    }

    const minInc = state.minIncrement || 0;
    const quicks = [minInc * 2, minInc * 5, minInc * 10].filter((v) => v > 0);

    return `
      <div class="deck-action-section-inner">
        <button class="btn-raise-paddle" id="btn-raise-paddle" aria-label="Place next minimum bid of ${formatNim(state.minNext)} NIM" ${canBid() ? "" : "disabled"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14.5 2.5l7 7-2 2-7-7 2-2zm-2.5 4.5l-9 9 2 2 9-9-2-2zm-8 12.5h16v2h-16v-2z"/>
          </svg>
          <span>Raise Paddle: ${formatNim(state.minNext)} NIM</span>
          <span class="btn-quick-tag">+${formatNim(minInc)} NIM</span>
        </button>

        ${quicks.length ? `
        <div class="quick-increments-row">
          ${quicks.map((v) => `
          <button class="btn-inc-pill" data-inc-lunas="${v}" ${canBid() ? "" : "disabled"}>+${formatNim(v)} NIM</button>
          `).join("")}
        </div>` : ""}
      </div>
    `;
  }

  function renderWinnerCard() {
    const amountLunas = state.sold?.amountLunas ?? state.currentBid;
    const nim = formatNim(amountLunas);
    const lunas = amountLunas;

    if (state.receipt) {
      const settle = state.receipt.settlement || { state: "pending" };
      if (settle.state === "verified") {
        return `
          <div class="settle-verified-box">
            <div class="settle-verified-header">
              <span class="verified-check-badge">✓</span>
              <span class="verified-title">SETTLEMENT VERIFIED ON-CHAIN</span>
            </div>
            <p class="settle-tx-line">Tx Hash: <code>${shortHash(state.receipt.txHash)}</code></p>
            <a href="https://nimiq.watch/#${escapeAttr(state.receipt.txHash)}" target="_blank" rel="noopener noreferrer" class="btn-view-explorer">
              <span>View Receipt on Nimiq Watch</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        `;
      }
      if (settle.state === "rejected") {
        return `
          <div class="settle-rejected-box">
            <div class="settle-verified-header">
              <span class="verified-check-badge rejected">✕</span>
              <span class="verified-title">SETTLEMENT REJECTED</span>
            </div>
            <p class="settle-tx-line">${escapeHtml(settle.reason || "The transaction didn't match this auction.")}</p>
            <a href="https://nimiq.watch/#${escapeAttr(state.receipt.txHash)}" target="_blank" rel="noopener noreferrer" class="btn-view-explorer">
              <span>View transaction on Nimiq Watch</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        `;
      }
      return `
        <div class="settle-verification-flow">
          <div class="settle-spinner-row">
            <div class="settle-pulse-ring"></div>
            <span class="settle-status-text">Confirming your payment on the Nimiq blockchain…</span>
          </div>
          <p class="settle-tx-line">Tx Hash: <code>${shortHash(state.receipt.txHash)}</code></p>
        </div>
      `;
    }

    return `
      <div class="winner-settlement-card" id="winner-card">
        <div class="winner-congrats-header">
          <span class="winner-crown">👑</span>
          <div class="winner-title-wrap">
            <h3 class="winner-h3">The Gavel Fell Your Way!</h3>
            <p class="winner-sub">You won this auction for ${nim} NIM.</p>
          </div>
        </div>

        <div class="settle-bill-box">
          <div class="bill-row">
            <span class="bill-label">Amount Due:</span>
            <span class="bill-val-nim">${nim} NIM</span>
          </div>
          <div class="bill-row">
            <span class="bill-label">Lunas Conversion:</span>
            <span class="bill-val-mono">${Number(lunas).toLocaleString()} Lunas</span>
          </div>
          <div class="bill-row">
            <span class="bill-label">Recipient Host:</span>
            <span class="bill-val-mono">${escapeHtml(state.sold?.hostAddress || state.hostAddress || "")}</span>
          </div>
        </div>

        <div class="winner-actions-wrap" id="winner-action-box">
          <button class="btn-winner-pay" id="btn-winner-pay" ${state.paying ? "disabled" : ""}>
            <span>${state.paying ? "Waiting for Nimiq Pay…" : "Pay with Nimiq Pay"}</span>
            <span aria-hidden="true">→</span>
          </button>
          <p class="winner-note">Winner-to-host direct payment. No escrow fees.</p>
        </div>
      </div>
    `;
  }

  function renderEndedCard() {
    const amount = state.sold?.amountLunas ?? state.currentBid;
    return `
      <div class="auction-ended-card">
        <h3 class="ended-title">The Gavel Has Fallen</h3>
        <p class="ended-desc">${
          state.phase === "passed"
            ? "The lot closed without qualifying bids."
            : `The gavel dropped at ${formatNim(amount)} NIM. The winner settles direct on-chain.`
        }</p>
        <a href="/lobby" class="btn-back-floor">
          <span>Back to the Floor</span>
          <span aria-hidden="true">→</span>
        </a>
      </div>
    `;
  }

  function renderRoomGone() {
    container.innerHTML = `
      <div class="not-found-view" data-animate="scale-in">
        <div class="not-found-card">
          <div class="not-found-icon-wrap">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14.5 2.5l7 7-2 2-7-7 2-2zm-2.5 4.5l-9 9 2 2 9-9-2-2zm-8 12.5h16v2h-16v-2z"/>
            </svg>
          </div>
          <span class="not-found-badge">ROOM NOT FOUND</span>
          <h1 class="not-found-title">This room is gone.</h1>
          <p class="not-found-desc">The gavel fell elsewhere. The lot may have been relisted under a new room.</p>
          <div class="not-found-actions">
            <a href="/lobby" class="btn-hero-primary"><span>Back to the Floor</span><span aria-hidden="true">→</span></a>
            <a href="/results" class="btn-hero-secondary"><span>View Recent Results</span></a>
          </div>
        </div>
      </div>
    `;
  }

  function wireActionButtons() {
    const raiseBtn = container.querySelector("#btn-raise-paddle");
    if (raiseBtn && raiseBtn.tagName === "BUTTON") {
      raiseBtn.addEventListener("click", () => placeBid(state.minNext));
    }

    container.querySelectorAll(".btn-inc-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const inc = Number(btn.getAttribute("data-inc-lunas") || "0", 10);
        if (inc > 0) placeBid(state.currentBid + inc);
      });
    });

    const payBtn = container.querySelector("#btn-winner-pay");
    if (payBtn) payBtn.addEventListener("click", payWinner);
  }

  function placeBid(amountLunas) {
    if (!state.socket || !canBid()) return;
    state.socket.send({ type: "bid", amountLunas });
  }

  function onMessage(message) {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "state":
        state.phase = message.phase || "live";
        state.endsAt = message.endsAt;
        state.currentBid = message.currentBidLunas || 0;
        state.minNext = message.minNextBidLunas || 0;
        state.leading = message.leadingPaddle
          ? { paddle: message.leadingPaddle, alias: message.leadingAlias || "" }
          : null;
        state.bids = (message.bids || []).slice().reverse();
        state.connections = message.connections || 0;
        if (message.lot) {
          state.minIncrement = message.lot.minIncrementLunas || state.minIncrement;
          state.startedAt = state.endsAt - (message.lot.durationSec || 180) * 1000;
          // Direct room links: the WS state carries the lot even when the
          // REST detail has not loaded (or the row is fresh).
          if (!state.lotTitle) {
            state.lotTitle = message.lot.title;
            state.lotDesc = message.lot.description || "";
            state.imageUrl = message.lot.imageUrl;
            state.startPrice = message.lot.startPriceLunas || state.startPrice;
            state.hostAddress = message.lot.hostAddress || state.hostAddress;
            state.hostPaddle = message.lot.hostPaddle ?? state.hostPaddle;
            if (state.lotTitle) document.title = `${state.lotTitle} · Nimgavel`;
          }
        }
        break;
      case "bid":
        state.currentBid = message.amountLunas;
        state.leading = { paddle: message.paddle, alias: message.alias || "" };
        state.minNext = message.amountLunas + state.minIncrement;
        state.bids.unshift({
          paddle: message.paddle,
          alias: message.alias || "",
          amountLunas: message.amountLunas,
          ts: message.ts || Date.now()
        });
        break;
      case "phase":
        state.phase = message.phase;
        if (typeof message.endsAt === "number") state.endsAt = message.endsAt;
        break;
      case "sold":
        state.phase = "sold";
        state.sold = message;
        break;
      case "passed":
        state.phase = "passed";
        break;
      case "error":
        handleErrorCode(message);
        return;
      default:
        return;
    }
    render();
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

  function tick() {
    if (typeof state.endsAt !== "number") return;
    const digits = container.querySelector("#deck-timer-digits");
    const ms = remaining();
    if (digits && ms !== null) digits.textContent = formatRemaining(ms);

    // Smooth client-side phase shifts between server phase messages.
    const next = ms > 30_000 ? "live" : ms > 15_000 ? "going_once" : ms > 0 ? "going_twice" : "sold";
    if (next !== state.phase && ["live", "going_once", "going_twice"].includes(state.phase)) {
      if (next === "sold") return; // the server owns the gavel
      state.phase = next;
      const banner = container.querySelector("#phase-banner-wrap");
      if (banner) banner.innerHTML = renderPhaseBanner();
    }
  }

  async function payWinner() {
    if (state.paying) return;
    state.paying = true;
    render();
    try {
      const payment = await sendPayment({
        recipient: state.sold.hostAddress || state.hostAddress,
        nim: formatNim(state.sold.amountLunas)
      });
      const settled = await settleLot(lotId, session.paddleToken, payment.txHash);
      state.phase = "settled";
      state.receipt = {
        txHash: payment.txHash,
        settlement: settled.receipt?.settlement || settled.settlement || { state: "pending" }
      };
      showToast("The gavel fell your way. Paid.");
    } catch (error) {
      if (error instanceof WalletCancelledError) {
        showToast("Payment cancelled. Pay when ready.");
      } else {
        showToast(`${error.message || "The payment didn't go through."} Nothing was sent.`);
      }
    }
    state.paying = false;
    render();
    pollVerification();
  }

  async function pollVerification() {
    for (let attempt = 0; attempt < 3 && state.receipt?.settlement?.state === "pending"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      try {
        const result = await verifySettlement(lotId, session.paddleToken);
        if (state.receipt) {
          state.receipt.settlement = result.settlement;
          if (result.settlement?.state !== "pending") render();
        }
        if (result.settlement?.state === "verified" || result.settlement?.state === "rejected") break;
      } catch { /* retry */ }
    }
  }

  function showToast(message) {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    const el = container.querySelector(".toast");
    if (!el) return;
    el.textContent = message;
    el.style.display = "block";
    state.toastTimer = setTimeout(() => { el.style.display = "none"; }, 2600);
  }

  async function start() {
    // Room links are shared directly: boot the wallet here too, not only in
    // the lobby. bootWallet is single-flight, so this is one prompt per page.
    // Plain browsers skip the handshake entirely: spectate is sync-detected.
    if (!isSpectate()) {
      bootWallet().then(() => {
        if (["live", "going_once", "going_twice", "loading"].includes(state.phase)) render();
      });
    }

    try {
      const detail = await getLot(lotId);
      if (detail?.lot?.id) {
        const lot = detail.lot;
        state.hostAddress = lot.hostAddress;
        state.hostPaddle = lot.hostPaddle;
        state.minIncrement = lot.minIncrementLunas || 0;
        state.startPrice = lot.startPriceLunas || 0;
        state.lotTitle = lot.title;
        state.lotDesc = lot.description || "";
        state.imageUrl = lot.imageUrl;
        document.title = `${lot.title} · Nimgavel`;

        // Reload of an already-closed room: reconstruct the outcome so the
        // settlement surfaces render without the live sold broadcast.
        if (lot.status === "passed") {
          state.phase = "passed";
        } else if (["sold", "settled"].includes(lot.status) && lot.winningPaddle) {
          state.phase = lot.status;
          state.currentBid = lot.winningBidLunas || 0;
          state.sold = {
            winningPaddle: lot.winningPaddle,
            alias: "",
            amountLunas: lot.winningBidLunas || 0,
            hostAddress: lot.hostAddress
          };
          if (lot.status === "settled" && lot.txHash) {
            state.receipt = {
              txHash: lot.txHash,
              settlement: lot.settlement || { state: "pending" }
            };
          }
        }
      }
    } catch {
      // Room state alone can still carry the view.
    }

    // Dead end: unknown lot id (bad link, deleted lot).
    if (!state.lotTitle) {
      const roomProbe = await getRoomState(lotId).catch(() => null);
      if (!roomProbe?.lot) {
        state.phase = "gone";
        render();
        return;
      }
    }

    state.socket = createRoomSocket({
      lotId,
      paddle: session.paddle ?? 0,
      alias: session.alias ?? "Spectator",
      onMessage,
      onStatus: (status) => {
        state.socketStatus = status;
        state.clockOffset = state.socket.clockOffset;
        const badge = container.querySelector("#room-ws-badge");
        if (badge) {
          badge.innerHTML = `
            <span class="${status === "open" ? "pulse-dot-green" : "pulse-dot-amber"}" aria-hidden="true"></span>
            <span>${wsLabel()}</span>
          `;
        }
      }
    });
    state.socket.connect();
    render();
    state.tickTimer = setInterval(tick, 250);
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

export function shortAddress(address) {
  const compact = String(address || "").replace(/ /g, "");
  return compact.length > 14 ? `${compact.slice(0, 8)}…${compact.slice(-6)}` : compact;
}

export function shortHash(hash) {
  const h = String(hash || "");
  return h.length > 20 ? `${h.slice(0, 8)}...${h.slice(-6)}` : h;
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
