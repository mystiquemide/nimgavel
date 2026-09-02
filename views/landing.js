// Gate 6 — Landing. Plain browsers AND (for now) Pay users; the smart
// root split lands with the Lobby gate. Every claim is real data.
import { listLots, getRoomState, ApiError } from "../lib/api.js";
import { formatNim } from "../lib/nimiq.js";
import { escapeHtml, escapeAttr } from "./room.js";

const payDeeplink = () =>
  `https://nimpay.app/miniapps/open/${encodeURIComponent(location.origin + "/")}`;

export function renderLanding(container, { navigate }) {
  const state = { lots: null, room: null, roomTimer: null };

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
          <a class="btn full" href="${payDeeplink()}">Open in Nimiq Pay →</a>
          <button class="btn secondary full" id="watch-live">Watch a live auction</button>
        </div>
        <div class="proof-note settle" style="animation-delay:320ms">Settlements verified on-chain. Every bid and payout is public.</div>
      </section>

      <section class="landing-live">
        <div class="section-label live"><span class="live-dot"></span>LIVE NOW</div>
        <div id="live-slot"><div class="skeleton">checking the floor…</div></div>
      </section>

      <section class="landing-live" id="landing-results">
        <div class="section-label">RECENT RESULTS <a href="/results" style="margin-left:auto;font-size:11px;padding:6px 0">all results →</a></div>
        <div id="results-slot"></div>
      </section>

      <section class="landing-steps">
        <div class="section-label">HOW A LOT RUNS</div>
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
        <a class="btn full" href="${payDeeplink()}">Open in Nimiq Pay</a>
      </section>
      </main>

      <footer class="landing-footer">
        <span>Nimgavel</span>
        <span class="mono">live auctions in NIM</span>
      </footer>
    </div>
  `;

  container.querySelector("#watch-live").addEventListener("click", () => {
    const lot = state.lots?.live?.[0];
    if (lot) navigate(`/room/${lot.id}`);
    else document.querySelector(".landing-live")?.scrollIntoView({ behavior: "smooth" });
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
      <div class="card lot-card" style="margin-bottom:8px">
        <img class="thumb" src="${escapeAttr(lot.imageUrl || "/favicon.svg")}" alt="${escapeAttr(lot.title)}" />
        <div class="lot-body">
          <div class="lot-title">${escapeHtml(lot.title)}</div>
          <div class="lot-meta num">
            <span class="lot-price">${formatNim(lot.winningBidLunas ?? 0)} NIM</span> · won by #${lot.winningPaddle ?? "?"}
            ${lot.settlement?.state === "verified" ? ` · <span style="color:var(--green)">✓ verified</span>` : ""}
          </div>
        </div>
      </div>
    `).join("");
  }

  function renderLive() {
    const slot = container.querySelector("#live-slot");
    if (!slot) return;
    const lot = state.lots?.live?.[0];

    if (!lot) {
      slot.innerHTML = `
        <div class="card">
          <span class="dim" style="font-size:14px">
            ${state.lots === null
              ? "Can't reach the auction house right now."
              : "The floor is quiet right now. Open a room and watch."}
          </span>
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
