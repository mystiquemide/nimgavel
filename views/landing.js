import { listLots, getRoomState, ApiError } from "../lib/api.js";
import { formatNim } from "../lib/nimiq.js";
import { escapeHtml, escapeAttr, shortAddress } from "./room.js";

const HERO_POLL_MS = 5000;

export function renderLanding(container) {
  const state = { lots: null, room: null, timer: null };

  container.innerHTML = `
    <section class="hero-section" aria-labelledby="hero-heading">
      <div class="hero-center-container">
        <!-- Hero Copy & Actions Centered -->
        <div class="hero-center-content" data-animate="fade-up">
          <p class="hero-kicker" aria-label="Auction chant">
            going once , going twice . <span class="kicker-sold">SOLD</span> . NIM
          </p>
          <h1 id="hero-heading" class="hero-title">
            The live community auction house for Nimiq.
          </h1>
          <p class="hero-subhead">
            When the gavel falls, the winner pays the host directly in NIM from their wallet. No escrow middlemen and No platform cuts.
          </p>

          <div class="hero-cta-group">
            <a href="/lobby" class="btn-hero-primary" id="hero-enter-btn">
              <span>Enter the Floor</span>
              <span aria-hidden="true">→</span>
            </a>
            <a href="/host" class="btn-hero-secondary">
              <span>Host an Auction</span>
            </a>
          </div>
          <p class="hero-boundary-note">Browse on the web. Bid and host inside Nimiq Pay.</p>
        </div>

        <!-- Featured Live Lot Card Below -->
        <div class="hero-card-center" data-animate="scale-in" data-animate-delay="0.1">
          <div id="hero-lot-slot"><div class="hero-lot-loading">checking the floor…</div></div>
        </div>
      </div>
    </section>

    <!-- SECTION 3: HOW A NIMGAVEL AUCTION RUNS -->
    <section class="rules-section" id="rules" aria-labelledby="rules-heading">
      <div class="rules-header" data-animate="fade-up">
        <span class="rules-kicker">AUCTION MECHANICS</span>
        <h2 id="rules-heading" class="rules-title">Three simple rules. Zero auction fees.</h2>
        <p class="rules-subhead">Built specifically for the Nimiq community experience.</p>
      </div>

      <div class="rules-grid" data-animate-stagger>
        <article class="rule-card rule-card-white" data-animate-child>
          <div class="rule-badge-row">
            <span class="rule-step-badge">Step 01</span>
          </div>
          <h3 class="rule-card-title">Pick up your paddle</h3>
          <p class="rule-card-text">
            Connect with your Nimiq wallet. Your device receives an anonymous paddle number and animal alias, like Paddle #42 Quiet Heron. No account creation or password setup.
          </p>
        </article>

        <article class="rule-card rule-card-gold" data-animate-child>
          <div class="rule-badge-row">
            <span class="rule-step-badge rule-badge-primary">Step 02</span>
          </div>
          <h3 class="rule-card-title">Free real-time bids</h3>
          <p class="rule-card-text">
            Raise your paddle with one tap. Any bid placed during the final 30 seconds adds 30 more seconds so no one gets sniped by automated bots at the last second.
          </p>
        </article>

        <article class="rule-card rule-card-green" data-animate-child>
          <div class="rule-badge-row">
            <span class="rule-step-badge rule-badge-green">Step 03</span>
          </div>
          <h3 class="rule-card-title">Settle direct on-chain</h3>
          <p class="rule-card-text">
            When the gavel drops, the winner sends NIM straight to the host. Our worker checks the transaction on-chain before stamping the receipt.
          </p>
        </article>
      </div>
    </section>

    <!-- SECTION 4: RECENT HAMMER RESULTS -->
    <section class="results-preview-section" id="results-preview" aria-labelledby="results-preview-heading">
      <div class="results-preview-header" data-animate="fade-up">
        <div class="results-title-group">
          <span class="rules-kicker">SETTLED AUCTIONS</span>
          <h2 id="results-preview-heading" class="results-preview-title">Recent hammer results</h2>
          <p class="results-preview-subhead">
            Real lots, real winning paddles, and on-chain settlement records on Nimiq.
          </p>
        </div>
        <a href="/results" class="view-all-results-link">
          <span>Browse All Results</span>
          <span aria-hidden="true">→</span>
        </a>
      </div>

      <div class="results-grid" data-animate-stagger id="landing-results-grid"></div>
    </section>

    <!-- SECTION 5: FINAL CALL TO ACTION -->
    <section class="final-cta-section" aria-labelledby="final-cta-heading">
      <div class="final-cta-box" data-animate="scale-in">
        <span class="final-cta-pill">HOST YOUR OWN</span>
        <h2 id="final-cta-heading" class="final-cta-title">
          Got an item to auction to the Nimiq community?
        </h2>
        <p class="final-cta-subhead">
          Set a starting reserve, pick a duration from 5 minutes to 24 hours, and sign with your Nimiq wallet. Your room goes live instantly with its own shareable link and QR code.
        </p>
        <div class="final-cta-buttons">
          <a href="/host" class="btn-cta-gold">
            <span>Start Hosting a Lot</span>
            <span aria-hidden="true">→</span>
          </a>
          <a href="/lobby" class="btn-cta-outline">
            <span>Browse Live Auctions</span>
          </a>
        </div>
      </div>
    </section>

    <!-- SECTION 6: FOOTER -->
    <footer class="site-footer" role="contentinfo">
      <div class="footer-main">
        <div class="footer-brand-col">
          <div class="brand-group">
            <a href="/" class="brand-logo" aria-label="Nimgavel Home">
              <svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.5 2.5l7 7-2 2-7-7 2-2zm-2.5 4.5l-9 9 2 2 9-9-2-2zm-8 12.5h16v2h-16v-2z"/>
              </svg>
              <span>NIMGAVEL</span>
            </a>
            <span class="brand-badge">Live Community Auctions</span>
          </div>
          <p class="footer-desc">
            Live community auction floor for Nimiq. Built for Cycle II. Direct wallet-to-wallet transfers on Nimiq Proof-of-Stake.
          </p>
        </div>

        <nav class="footer-links-col" aria-label="Footer Navigation">
          <div class="footer-links-group">
            <h3 class="footer-links-heading">Explore</h3>
            <ul class="footer-links-list">
              <li><a href="/lobby" class="footer-link">Auction Floor</a></li>
              <li><a href="/results" class="footer-link">Past Results</a></li>
              <li><a href="/host" class="footer-link">Host an Auction</a></li>
              <li><a href="/#rules" class="footer-link">Auction Mechanics</a></li>
            </ul>
          </div>
          <div class="footer-links-group">
            <h3 class="footer-links-heading">Trust & Code</h3>
            <ul class="footer-links-list">
              <li>
                <a href="https://nimiq.watch" target="_blank" rel="noopener noreferrer" class="footer-link">
                  <span>Nimiq Watch Explorer</span>
                  <span aria-hidden="true">↗</span>
                </a>
              </li>
              <li>
                <a href="https://github.com/mystiquemide/nimgavel" target="_blank" rel="noopener noreferrer" class="footer-link">
                  <span>Github</span>
                  <span aria-hidden="true">↗</span>
                </a>
              </li>
            </ul>
          </div>
        </nav>
      </div>

      <div class="footer-bottom-strip">
        <p>© 2026 Nimgavel. Made for the Nimiq ecosystem. No cookies, no tracking scripts, no platform fee.</p>
      </div>
    </footer>
  `;

  const lotSlot = container.querySelector("#hero-lot-slot");
  const resultsGrid = container.querySelector("#landing-results-grid");

  function renderHeroLot() {
    const lot = state.lots?.live?.[0];
    if (!lot) {
      lotSlot.innerHTML = `
        <article class="featured-lot-card" aria-label="Auction floor status">
          <div class="card-body">
            <div class="lot-header">
              <h2 class="lot-title">${state.lots === null ? "Checking the floor…" : "The floor is quiet right now."}</h2>
              <p class="lot-meta">${state.lots === null
                ? "Your connection or ours."
                : "Rooms open when a host lists a lot."}</p>
            </div>
            <a href="/host" class="btn-card-action">
              <span>${state.lots === null ? "Retry from the Lobby" : "Host the First Auction"}</span>
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </article>
      `;
      lotSlot.querySelector(".btn-card-action").href = state.lots === null ? "/lobby" : "/host";
      return;
    }

    const room = state.room;
    const bid = room?.currentBidLunas ?? lot.startPriceLunas ?? 0;
    const connections = room?.connections ?? 0;
    const remaining = roomRemaining(room);

    lotSlot.innerHTML = `
      <article class="featured-lot-card" aria-label="Featured live auction lot">
        <div class="card-media-wrap">
          <img
            src="${escapeAttr(lot.imageUrl || "/favicon.svg")}"
            alt="${escapeAttr(lot.title)}"
            class="card-img"
            loading="eager"
            decoding="async"
            width="800"
            height="500"
          />
          <div class="card-status-bar">
            <span class="status-badge-live">
              <span class="pulse-dot" aria-hidden="true"></span>
              <span>LIVE NOW</span>
            </span>
            ${remaining !== null ? `
            <span class="status-timer-pill" id="hero-timer" aria-label="Remaining time">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span id="timer-display">${formatRemaining(remaining)}</span>
            </span>` : ""}
          </div>
        </div>

        <div class="card-body">
          <div class="lot-header">
            <h2 class="lot-title">${escapeHtml(lot.title)}</h2>
            <p class="lot-meta">Host: ${escapeHtml(shortAddress(lot.hostAddress))}</p>
          </div>

          <div class="bid-status-box">
            <div class="bid-label-row">
              <span class="bid-label">CURRENT HIGH BID</span>
              <span class="bid-leader">${connections} paddle${connections === 1 ? "" : "s"} in the room</span>
            </div>
            <div class="bid-value-row">
              <span class="bid-amount-nim">${formatNim(bid)} NIM</span>
            </div>
          </div>

          <a href="/room/${escapeAttr(lot.id)}" class="btn-card-action">
            <span>Join Live Auction Room</span>
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </article>
    `;
    startHeroTimer(room);
  }

  function startHeroTimer(room) {
    if (state.timer) clearInterval(state.timer);
    if (!room || typeof room.endsAt !== "number" || typeof room.serverNow !== "number") return;
    const drift = room.serverNow - Date.now();
    const display = container.querySelector("#timer-display");
    if (!display) return;

    state.timer = setInterval(() => {
      const ms = Math.max(room.endsAt - (Date.now() + drift), 0);
      display.textContent = formatRemaining(ms);
      if (ms <= 0) clearInterval(state.timer);
    }, 1000);
  }

  function renderResults() {
    const results = (state.lots?.results || []).slice(0, 3);
    if (!results.length) {
      resultsGrid.innerHTML = `
        <p class="results-preview-subhead" style="grid-column:1/-1">
          No settled auctions yet. The first hammer falls soon.
        </p>`;
      return;
    }
    resultsGrid.innerHTML = results.map((lot) => {
      const settle = lot.settlement;
      const chip = settle?.state === "verified"
        ? `<span class="result-status-chip verified">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
               <polyline points="20 6 9 17 4 12"></polyline>
             </svg>
             <span>VERIFIED ON-CHAIN</span>
           </span>`
        : settle?.state === "rejected"
          ? `<span class="result-status-chip">REJECTED</span>`
          : `<span class="result-status-chip">PENDING</span>`;
      const tx = lot.txHash
        ? `<div class="result-tx-footer">
             <span class="result-tx-hash" title="Transaction Hash">${shortHash(lot.txHash)}</span>
             <a href="https://nimiq.watch/#${escapeAttr(lot.txHash)}" target="_blank" rel="noopener noreferrer" class="result-explorer-btn"
                aria-label="View transaction on Nimiq Watch block explorer">
               <span>View on Explorer</span>
               <span aria-hidden="true">↗</span>
             </a>
           </div>`
        : "";
      return `
        <article class="result-card" data-animate-child>
          <div class="result-card-media">
            <img
              src="${escapeAttr(lot.imageUrl || "/favicon.svg")}"
              alt="${escapeAttr(lot.title)}"
              class="result-img"
              loading="lazy"
              decoding="async"
              width="800"
              height="500"
            />
            ${chip}
          </div>
          <div class="result-card-body">
            <h3 class="result-lot-title">${escapeHtml(lot.title)}</h3>
            <p class="result-lot-host">Host: ${escapeHtml(shortAddress(lot.hostAddress))}</p>
            <div class="result-price-box">
              <div class="result-price-row">
                <span class="result-price-label">Hammer Price:</span>
                <span class="result-price-value">${formatNim(lot.winningBidLunas ?? 0)} NIM</span>
              </div>
              <div class="result-winner-row">
                <span class="result-winner-label">Winner:</span>
                <span class="result-winner-val">Paddle #${lot.winningPaddle ?? "?"}</span>
              </div>
            </div>
            ${tx}
          </div>
        </article>`;
    }).join("");
  }

  async function refresh() {
    try {
      state.lots = await listLots();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      state.lots = null;
    }
    renderResults();

    const lot = state.lots?.live?.[0];
    if (lot) {
      try {
        state.room = await getRoomState(lot.id);
      } catch {
        state.room = null;
      }
    } else {
      state.room = null;
    }
    renderHeroLot();
  }

  // Initial paint, then keep the featured card honest while the page is open.
  refresh();
  const poll = setInterval(refresh, HERO_POLL_MS);

  initScrollAnimations(container);

  // Adapt CTA if opened inside Nimiq Pay
  if (typeof window !== "undefined" && window.nimiq) {
    const btn = container.querySelector("#hero-enter-btn span:first-child");
    if (btn) btn.textContent = "Enter Floor";
  }

  return function cleanup() {
    clearInterval(poll);
    if (state.timer) clearInterval(state.timer);
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
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function shortHash(hash) {
  const h = String(hash || "");
  return h.length > 20 ? `${h.slice(0, 8)}...${h.slice(-6)}` : h;
}

function initScrollAnimations(container) {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const delay = el.getAttribute("data-animate-delay");
        if (delay) el.style.transitionDelay = `${delay}s`;
        el.classList.add("in-view");
        observer.unobserve(el);
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
  );

  container.querySelectorAll("[data-animate], [data-animate-stagger]").forEach((el) => {
    observer.observe(el);
  });
  document.body.classList.add("animate-ready");
}
