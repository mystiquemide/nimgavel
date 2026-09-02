// Results archive: every sold lot with real photos, price, winner, tx link,
// settlement chip. Public proof of activity (judges land here from lobby).
import { listLots, ApiError } from "../lib/api.js";
import { formatNim } from "../lib/nimiq.js";
import { escapeHtml, escapeAttr } from "./room.js";

export function renderResults(container, { navigate }) {
  const state = { results: [], loading: true, error: null };

  container.innerHTML = `
    <div class="host-back">
      <a href="/lobby">← lobby</a>
      <h1 class="brand">RESULTS</h1>
    </div>
    <main id="results-main"><div class="skeleton">pulling the archive…</div></main>
    <footer class="app-footer"><span>Nimgavel</span><span class="mono">every tx hash public</span></footer>
  `;

  const main = container.querySelector("#results-main");

  function render() {
    if (state.error) {
      main.innerHTML = `<div class="wallet-row">Can't reach the auction house. Your connection or ours. Retrying…</div>`;
      return;
    }
    if (!state.results.length) {
      main.innerHTML = `
        <div class="dead-end">
          ${ghostSvgInline()}
          <div class="dead-title">No gavels yet.</div>
          <div class="dead-sub">The first sold lot lands here with its full bid history and payout.</div>
          <button class="btn sm" id="back-lobby">Back to the lobby</button>
        </div>`;
      main.querySelector("#back-lobby").addEventListener("click", () => navigate("/lobby"));
      return;
    }

    const rows = state.results.map((lot) => {
      const settle = lot.settlement;
      const chip = settle?.state === "verified"
        ? `<span class="settle-chip verified">✓ verified</span>`
        : settle?.state === "rejected"
          ? `<span class="settle-chip rejected">rejected</span>`
          : settle
            ? `<span class="settle-chip pending shimmer">checking…</span>`
            : "";
      const tx = lot.txHash
        ? `<a class="mono" style="font-size:11px" href="https://nimiq.watch/#${escapeAttr(lot.txHash)}" target="_blank" rel="noreferrer">${shortHash(lot.txHash)} →</a>`
        : "";
      return `
        <div class="arch-row" data-enter="${escapeAttr(lot.id)}" role="button" aria-label="${escapeAttr(lot.title)}, sold for ${formatNim(lot.winningBidLunas ?? 0)} NIM">
          <img class="thumb" src="${escapeAttr(lot.imageUrl || "/favicon.svg")}" alt="${escapeAttr(lot.title)}" />
          <div class="arch-body">
            <h2 class="arch-title">${escapeHtml(lot.title)}</h2>
            <div class="arch-meta">
              <span class="arch-price">${formatNim(lot.winningBidLunas ?? 0)} NIM</span> · won by #${lot.winningPaddle ?? "?"}
            </div>
            <div style="display:flex;gap:8px;align-items:center;margin-top:6px">${chip} ${tx}</div>
          </div>
        </div>`;
    }).join("");

    main.innerHTML = `
      <div class="section-label">RECENT RESULTS</div>
      ${rows}
      <div class="footer-space"></div>
    `;

    main.querySelectorAll("[data-enter]").forEach((el) => {
      el.addEventListener("click", () => navigate(`/room/${el.dataset.enter}`));
    });
  }

  (async () => {
    try {
      const lots = await listLots();
      state.results = lots.results || [];
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      state.error = true;
    }
    state.loading = false;
    render();
  })();

  return function cleanup() {};
}

function ghostSvgInline() {
  return `
<svg viewBox="0 0 96 96" height="84" width="84" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g class="ghost-body">
    <path d="M28 22c0-11 9-18 20-18s20 7 20 18v34l-6.5-5-6.5 5-7-5-7 5-6.5-5-6.5 5V22Z" fill="#131E33" stroke="#1D2A44" stroke-width="2"/>
    <circle class="ghost-eye" cx="39" cy="26" r="3" fill="#8A94AB"/>
    <circle class="ghost-eye" cx="57" cy="26" r="3" fill="#8A94AB"/>
    <path d="M42 36c2 2.4 6 2.4 8 0" stroke="#8A94AB" stroke-width="2" stroke-linecap="round"/>
  </g>
  <g transform="rotate(14 70 58)">
    <rect x="66" y="34" width="14" height="26" rx="2" fill="#0D1626" stroke="#FFCE46" stroke-width="2"/>
    <rect x="70" y="60" width="6" height="18" rx="2" fill="#1D2A44"/>
  </g>
</svg>`;
}

function shortHash(hash) {
  const h = String(hash || "");
  return h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h;
}
