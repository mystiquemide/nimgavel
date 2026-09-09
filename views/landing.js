// Gate 6 — Landing. The front door for everyone: plain browsers and the
// Nimiq Pay webview. The hero CTA adapts — inside Pay it enters the floor,
// in a browser it hands off to the wallet. Every claim is real data.
import { listLots, getRoomState, ApiError } from "../lib/api.js";
import { formatNim } from "../lib/nimiq.js";
import { escapeHtml, escapeAttr } from "./room.js";

// The HTTPS directory link (nimpay.app/miniapps/open/) 404s for unlisted
// hosts — verified live, even for known apps. The nimiqpay:// custom scheme
// is the documented path (nimiq.dev/mini-apps): opens the app inside
// Nimiq Pay, with a one-time warning for unlisted hosts.
const APP_ORIGIN = "https://nimgavel.artistic-chip.workers.dev";
const payDeeplink = (path = "/") =>
  `nimiqpay://miniapp?url=${encodeURIComponent(APP_ORIGIN + path)}`;

export function renderLanding(container, { navigate }) {
  const state = { lots: null, room: null, roomTimer: null };
  const inPay = typeof window !== "undefined" && !!window.nimiq;

  const primaryCta = inPay
    ? `<button class="btn full" id="enter-floor">Enter the floor →</button>`
    : `<a class="btn full" href="${payDeeplink()}">Open in Nimiq Pay →</a>`;
  const finalCta = inPay
    ? `<button class="btn full" id="enter-floor-final">Enter the floor</button>`
    : `<a class="btn full" href="${payDeeplink()}">Open in Nimiq Pay</a>`;

  container.innerHTML = `
    <div class="landing">
      <div class="landing-header">
        <header class="app-header">
          <img src="/favicon.svg" alt="Nimgavel" width="28" height="28" />
          <span class="brand">NIMGAVEL</span>
        </header>
      </div>

      <main>

      <section class="landing-hero">
        <div class="kicker settle">LIVE AUCTIONS IN NIMIQ PAY</div>
        <h1 class="settle" style="animation-delay:80ms">Going once.<br/>Going twice.<br/><span class="nim">NIM.</span></h1>
        <p class="sub settle" style="animation-delay:160ms">
          Bid from your Nimiq wallet. The winner pays the seller directly
          on-chain. No escrow, no custody, no middleman.
        </p>
        <div class="cta-row settle" style="animation-delay:240ms">
          ${primaryCta}
          <button class="btn secondary full" id="watch-live">Watch a live auction</button>
        </div>
        <div class="proof-note settle" style="animation-delay:320ms">A mini app that runs inside Nimiq Pay, the Nimiq wallet. Settlements verified on-chain.</div>
      </section>

      <section class="landing-live">
        <div class="section-label live"><span class="live-dot"></span>LIVE NOW</div>
        <div id="live-slot"><div class="skeleton">checking the floor…</div></div>
      </section>

      <section class="landing-live" id="landing-results">
        <div class="section-label">RECENT RESULTS <a href="/results" style="margin-left:auto;font-size:11px;padding:6px 0">all results →</a></div>
        <div id="results-slot"></div>
      </section>

      <section class="landing-steps" id="how-it-works">
        <h2 class="section-label">HOW A LOT RUNS</h2>
        <div class="step">
          <span class="num-col">01</span>
          <div>
            <h3>Get your paddle</h3>
            <p>Open Nimgavel in Nimiq Pay. Your device gets a paddle number and alias.</p>
          </div>
        </div>
        <div class="step">
          <span class="num-col">02</span>
          <div>
            <h3>Bid in the room</h3>
            <p>One tap bids the next amount. Soft close keeps the door open for counterbids.</p>
          </div>
        </div>
        <div class="step">
          <span class="num-col">03</span>
          <div>
            <h3>Winner pays host</h3>
            <p>The winner pays the host directly. Nimgavel verifies the payment on-chain.</p>
          </div>
        </div>
      </section>

      <div class="trust-strip">no escrow · no custody · no house cut · every tx hash public</div>

      <section class="landing-final">
        <h2>The next gavel is live.</h2>
        ${finalCta}
      </section>
      </main>

      <footer class="landing-footer">
        <span>Nimgavel <span class="mono">· live auctions in NIM</span></span>
        <nav class="footer-links" aria-label="Trust">
          <a href="/results">Results</a>
          <a href="https://github.com/mystiquemide/nimgavel" target="_blank" rel="noopener">Source</a>
          <a href="https://github.com/mystiquemide/nimgavel/blob/main/LICENSE" target="_blank" rel="noopener">MIT</a>
          <a href="https://nimiq.com/pay/" target="_blank" rel="noopener">Nimiq Pay</a>
        </nav>
      </footer>
    </div>
  `;

  const enterFloor = container.querySelector("#enter-floor");
  if (enterFloor) enterFloor.addEventListener("click", () => navigate("/lobby"));
  const enterFloorFinal = container.querySelector("#enter-floor-final");
  if (enterFloorFinal) enterFloorFinal.addEventListener("click", () => navigate("/lobby"));

  container.querySelector("#watch-live").addEventListener("click", () => {
    const lot = state.lots?.live?.[0];
    if (lot) {
      navigate(`/room/${lot.id}`);
      return;
    }
    // Quiet floor: send the visitor somewhere real instead of a dead section.
    const hasResults = (state.lots?.results || []).length > 0;
    if (hasResults) navigate("/results");
    else container.querySelector("#how-it-works")?.scrollIntoView({ behavior: "smooth" });
  });

  (async () => {
    try {
      state.lots = await listLots();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      state.lots = null;
    }
    renderLive();
    renderResults();
    if (state.lots?.live?.length) pollRoom();
  })();

  function renderResults() {
    const slot = container.querySelector("#results-slot");
    if (!slot) return;
    const results = state.lots?.results || [];
    if (!results.length) {
      container.querySelector("#landing-results").style.display = "none";
      return;
    }
    slot.innerHTML = results.slice(0, 3).map((lot) => `
      <div class="card lot-card" data-enter="${escapeAttr(lot.id)}" role="button" tabindex="0" aria-label="${escapeAttr(lot.title)}, sold for ${formatNim(lot.winningBidLunas ?? 0)} NIM">
        <img class="thumb" loading="lazy" decoding="async" src="${escapeAttr(lot.imageUrl || "/favicon.svg")}" alt="${escapeAttr(lot.title)}" />
        <div class="lot-body">
          <div class="lot-title">${escapeHtml(lot.title)}</div>
          <div class="lot-meta num">
            <span class="lot-price">${formatNim(lot.winningBidLunas ?? 0)} NIM</span> · won by #${lot.winningPaddle ?? "?"}
            ${lot.settlement?.state === "verified" ? ` · <span style="color:var(--green)">✓ verified</span>` : ""}
          </div>
        </div>
      </div>
    `).join("");
    slot.querySelectorAll("[data-enter]").forEach((el) => {
      el.addEventListener("click", () => navigate(`/room/${el.dataset.enter}`));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") navigate(`/room/${el.dataset.enter}`);
      });
    });
  }

  function renderLive() {
    const slot = container.querySelector("#live-slot");
    if (!slot) return;
    const lot = state.lots?.live?.[0];

    if (!lot) {
      const hasResults = (state.lots?.results || []).length > 0;
      slot.innerHTML = `
        <div class="card quiet-card">
          <div style="font-size:15px">${state.lots === null ? "Can't reach the auction house right now." : "No live auctions right now."}</div>
          <div class="dim" style="font-size:13px;margin-top:4px;line-height:1.5">
            ${state.lots === null
              ? "Your connection or ours. The rooms come back with a refresh."
              : "Rooms open when a host lists a lot. Check back soon."}
          </div>
          ${state.lots !== null && hasResults
            ? `<a class="btn secondary sm full" style="margin-top:12px" href="/results">View recent results →</a>`
            : ""}
        </div>`;
      return;
    }

    const room = state.room;
    const bid = room?.currentBidLunas ?? lot.startPriceLunas ?? 0;
    const connections = room?.connections ?? null;
    slot.innerHTML = `
      <div class="card lot-card">
        <img class="thumb" src="${escapeAttr(lot.imageUrl || "/favicon.svg")}" alt="${escapeAttr(lot.title)}" />
        <div class="lot-body">
          <h2 class="lot-title">${escapeHtml(lot.title)}</h2>
          <div class="lot-meta">
            <span class="lot-price num">${formatNim(bid)} NIM</span>${connections ? ` · ${connections} paddle${connections === 1 ? "" : "s"}` : ""}
          </div>
          <button class="btn full" style="margin-top:10px" id="enter-live">Watch this room</button>
        </div>
      </div>`;
    slot.querySelector("#enter-live").addEventListener("click", () => navigate(`/room/${lot.id}`));
  }

  async function pollRoom() {
    const lot = state.lots?.live?.[0];
    if (!lot) return;
    try {
      state.room = await getRoomState(lot.id);
      renderLive();
    } catch { /* keep the last good state */ }
    state.roomTimer = setTimeout(pollRoom, 5000);
  }

  return function cleanup() {
    if (state.roomTimer) clearTimeout(state.roomTimer);
  };
}
