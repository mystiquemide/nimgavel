import { listLots, getRoomState, ApiError } from "../lib/api.js";
import { formatNim } from "../lib/nimiq.js";
import { getRecentLotIds, getJoinedLotIds } from "../lib/activity.js";
import { escapeHtml, escapeAttr, shortAddress } from "./room.js";

const HERO_POLL_MS = 10000;

export function renderLanding(container) {
  let disposed = false;
  const state = { lots: null, room: null, timer: null, resultsSignature: null };

  container.innerHTML = `
    <section class="hero-section" aria-labelledby="hero-heading">
      <div class="hero-center-container">
        <!-- Hero Copy & Actions Centered -->
        <div class="hero-center-content" data-animate="fade-up">
          <p class="hero-kicker" aria-label="Auction chant" style="font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; transform: none;">
            Going once. Going twice. <span class="kicker-sold" style="font-family: inherit; font-size: inherit; font-weight: 800; letter-spacing: inherit; padding: 0;">SOLD</span>. NIM.
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

    <section class="rules-section" id="your-auctions" aria-labelledby="your-auctions-heading">
      <div class="rules-header" data-animate="fade-up">
        <span class="rules-kicker">YOUR NIMGAVEL</span>
        <h2 id="your-auctions-heading" class="rules-title">Start here or pick up where you left off.</h2>
        <p class="rules-subhead">Open the floor, return to auctions you joined, or jump back into rooms you recently viewed without finding the old link again.</p>
      </div>

      <div class="rules-grid" data-animate-stagger>
        <article class="rule-card rule-card-white" data-animate-child>
          <div class="rule-badge-row"><span class="rule-step-badge">HOST</span></div>
          <h3 class="rule-card-title">My Auctions</h3>
          <p class="rule-card-text">Find the rooms you created and manage them from one place.</p>
          <a href="/host#my-lots-section" class="btn-card-action"><span>Open My Auctions</span><span aria-hidden="true">→</span></a>
        </article>

        <article class="rule-card rule-card-gold" id="joined-auctions" data-animate-child>
          <div class="rule-badge-row"><span class="rule-step-badge rule-badge-primary">BIDDER</span></div>
          <h3 class="rule-card-title">Joined Auctions</h3>
          <div id="joined-auctions-list"><p class="rule-card-text">Auctions you bid in will appear here.</p></div>
        </article>

        <article class="rule-card rule-card-green" id="recent-auctions" data-animate-child>
          <div class="rule-badge-row"><span class="rule-step-badge rule-badge-green">RECENT</span></div>
          <h3 class="rule-card-title">Recently Viewed</h3>
          <div id="recent-auctions-list"><p class="rule-card-text">Rooms you open will appear here for quick return.</p></div>
        </article>
      </div>

      <p class="hero-boundary-note" data-animate="fade-up"><a href="/lobby">Auction Floor</a> · <a href="/host">Host an Auction</a> · <a href="/how-it-works">How It Works</a></p>
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
            Connect with your Nimiq wallet. Your device receives a pseudonymous paddle number and animal alias, like Paddle #42 Quiet Heron. No account creation or password setup.
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

    <!-- SECTION 5: LIVE COMMUNITY FEEDBACK -->
    <section class="rules-section" id="community-feedback" aria-labelledby="community-feedback-heading">
      <div class="rules-header" data-animate="fade-up">
        <span class="rules-kicker">LIVE COMMUNITY FEEDBACK</span>
        <h2 id="community-feedback-heading" class="rules-title">What early Nimgavel users are saying</h2>
        <p class="rules-subhead">Real feedback from people creating rooms, bidding, and using Nimiq Pay on Nimiq mainnet.</p>
      </div>

      <div class="rules-grid" data-animate-stagger>
        <article class="rule-card rule-card-white" data-animate-child>
          <div class="rule-badge-row">
            <span class="rule-step-badge">EARLY USER</span>
          </div>
          <p class="rule-card-text">“The UI is smooth, there’s a beginner guide, and it’s so easy to navigate.”</p>
          <p class="lot-meta">Mobile mainnet user</p>
        </article>

        <article class="rule-card rule-card-gold" data-animate-child>
          <div class="rule-badge-row">
            <span class="rule-step-badge rule-badge-primary">LIVE BIDDING</span>
          </div>
          <p class="rule-card-text">“Bidding on an open auction item was seamless.”</p>
          <p class="lot-meta">Early Nimgavel user</p>
        </article>

        <article class="rule-card rule-card-green" data-animate-child>
          <div class="rule-badge-row">
            <span class="rule-step-badge rule-badge-green">FIRST IMPRESSION</span>
          </div>
          <p class="rule-card-text">“Basically, your own mini auction house, powered by Nimiq.”</p>
          <p class="lot-meta">First-time Nimgavel user</p>
        </article>
      </div>

      <p class="hero-boundary-note" data-animate="fade-up">Running on Nimiq mainnet · Host → Bid → Win → Pay → Verify on-chain</p>
    </section>

    <!-- SECTION 6: FINAL CALL TO ACTION -->
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

    <!-- SECTION 7: FOOTER -->
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
              <li><a href="/how-it-works" class="footer-link">How It Works</a></li>
              <li><a href="/privacy" class="footer-link">Privacy</a></li>
              <li><a href="/terms" class="footer-link">Terms</a></li>
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
  const joinedList = container.querySelector("#joined-auctions-list");
  const recentList = container.querySelector("#recent-auctions-list");

  function lotMap() {
    const groups = state.lots ? [state.lots.upcoming || [], state.lots.live || [], state.lots.results || []] : [];
    return new Map(groups.flat().map((lot) => [lot.id, lot]));
  }

  function activityRows(ids, emptyText) {
    if (!ids.length) return `<p class="rule-card-text">${escapeHtml(emptyText)}</p>`;
    const lots = lotMap();
    return ids.slice(0, 4).map((id) => {
      const lot = lots.get(id);
      const title = lot?.title || `Auction ${id.slice(0, 8)}`;
      const status = lot?.status ? ` · ${lot.status}` : "";
      return `<a href="/room/${escapeAttr(id)}" class="btn-card-action" style="margin-top:8px"><span>${escapeHtml(title)}${escapeHtml(status)}</span><span aria-hidden="true">→</span></a>`;
    }).join("");
  }

  function renderActivity() {
    if (!joinedList || !recentList) return;
    const joinedIds = getJoinedLotIds();
    const joined = new Set(joinedIds);
    const recentIds = getRecentLotIds().filter((id) => !joined.has(id));
    joinedList.innerHTML = activityRows(joinedIds, "Auctions you bid in will appear here.");
    recentList.innerHTML = activityRows(recentIds, "Rooms you open will appear here for quick return.");
  }

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
    const signature = results.map((lot) => [
      lot.id,
      lot.status,
      lot.txHash || "",
      lot.settlement?.state || "",
      lot.winningBidLunas ?? ""
    ].join(":" )).join("|");
    if (state.resultsSignature === signature) return;
    state.resultsSignature = signature;

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
    if (disposed) return;
    renderResults();
    renderActivity();

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
    if (!disposed) renderHeroLot();
  }

  // Activity shortcuts work immediately from local usage history, then gain titles/status after the floor loads.
  renderActivity();

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
    disposed = true;
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
