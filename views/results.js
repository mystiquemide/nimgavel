import { listLots, ApiError } from "../lib/api.js";
import { formatNim } from "../lib/nimiq.js";
import { escapeHtml, escapeAttr, shortAddress, shortHash } from "./room.js";

export function renderResults(container) {
  let disposed = false;
  let searchQuery = "";
  const state = { results: null, unreachable: false };

  function chipFor(settle, status) {
    if (status === "passed") return `<span class="archive-chip-pending">NO BIDS</span>`;
    if (!settle) return `<span class="archive-chip-pending">AWAITING PAYMENT</span>`;
    if (settle?.state === "verified") {
      return `
        <span class="archive-chip-verified">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>VERIFIED ON-CHAIN</span>
        </span>`;
    }
    if (settle?.state === "rejected") {
      return `<span class="archive-chip-rejected">REJECTED</span>`;
    }
    return `<span class="archive-chip-pending">PENDING</span>`;
  }

  function render() {
    if (disposed) return;
    const catalog = state.results || [];
    const filtered = catalog.filter((item) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (item.title || "").toLowerCase().includes(q) ||
             String(item.hostAddress || "").toLowerCase().includes(q);
    });

    // Settled means the payment verified on-chain. Rejected attempts stay
    // on the ledger as audit history, but never count toward settled volume.
    const verified = catalog.filter((item) => item.settlement?.state === "verified");
    const rejected = catalog.filter((item) => item.settlement?.state === "rejected");
    const totalVolumeLunas = verified.reduce((sum, item) => sum + (item.winningBidLunas || 0), 0);

    container.innerHTML = `
      <div class="results-view">
        <!-- Subheader Navigation Bar -->
        <div class="results-header-bar">
          <div class="results-back-group">
            <a href="/lobby" class="btn-back-nav" aria-label="Return to Auction Floor">
              <span aria-hidden="true">←</span>
              <span>Back to Floor</span>
            </a>
            <div class="results-title-wrap">
              <h1 class="results-page-title">Results Ledger</h1>
              <span class="results-stat-badge">
                <span class="badge-dot"></span>
                <span>${verified.length} Verified Settlement${verified.length === 1 ? "" : "s"}${rejected.length ? ` · ${rejected.length} Rejected` : ""}</span>
              </span>
            </div>
            <p class="results-page-desc">
              Public proof of every hammer price, winning paddle, and on-chain settlement check on Nimiq. Pending and rejected payment references are shown separately from verified transfers.
            </p>
          </div>

          <div class="results-volume-card">
            <span class="volume-label">VERIFIED SETTLED VOLUME</span>
            <span class="volume-amount">${formatNim(totalVolumeLunas)} NIM</span>
            ${rejected.length ? `<span class="volume-fiat">${rejected.length} rejected attempt${rejected.length === 1 ? "" : "s"} not counted</span>` : ""}
          </div>
        </div>

        <!-- Search & Control Row -->
        <div class="results-filter-row">
          <div class="results-search-box">
            <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              id="results-search-input"
              class="results-search-input"
              placeholder="Search by lot title or host address..."
              value="${escapeAttr(searchQuery)}"
              aria-label="Filter results by keyword"
            />
          </div>

          <span class="results-count-pill">${filtered.length} of ${catalog.length} Records</span>
        </div>

        ${state.unreachable ? `
        <div class="quiet-floor-state" data-animate="scale-in">
          <h2 class="quiet-title">Can't reach the auction house right now.</h2>
          <p class="quiet-desc">Your connection or ours. The ledger comes back with a refresh.</p>
        </div>` : !catalog.length ? `
        <div class="quiet-floor-state" data-animate="scale-in">
          <h2 class="quiet-title">No settled auctions yet.</h2>
          <p class="quiet-desc">The first hammer falls soon. Results land here with their on-chain receipts.</p>
          <div class="quiet-actions">
            <a href="/lobby" class="btn-quiet-results">Back to the Floor</a>
          </div>
        </div>` : !filtered.length ? `
        <div class="quiet-floor-state" data-animate="scale-in">
          <h2 class="quiet-title">No records match "${escapeHtml(searchQuery)}".</h2>
          <p class="quiet-desc">Try a different lot title or host address.</p>
          <div class="quiet-actions">
            <button class="btn-quiet-results" id="btn-clear-search">Clear Search</button>
          </div>
        </div>` : `
        <!-- Results Grid -->
        <div class="results-cards-grid">
          ${filtered.map((item, index) => {
            const settle = item.settlement;
            const reason = settle?.state === "rejected" && settle.reason
              ? `<p class="archive-reject-reason">Rejected: ${escapeHtml(settle.reason)}</p>`
              : "";
            const date = item.createdAt ? formatDate(item.createdAt) : "";
            const tx = item.txHash
              ? `<div class="archive-footer-row">
                   <div class="archive-tx-group">
                     <span class="archive-tx-label">TX RECEIPT</span>
                     <span class="archive-tx-hash">${shortHash(item.txHash)}</span>
                   </div>
                   <a
                     href="https://nimiq.watch/#${escapeAttr(item.txHash)}"
                     target="_blank"
                     rel="noopener noreferrer"
                     class="btn-explorer-link"
                     aria-label="View transaction ${escapeAttr(item.txHash)} on Nimiq Watch block explorer"
                   >
                     <span>View on nimiq.watch</span>
                     <span aria-hidden="true">↗</span>
                   </a>
                 </div>`
              : "";
            return `
            <article class="archive-card" id="result-${escapeAttr(item.id)}">
              <div class="archive-media-wrap">
                <img
                  src="${escapeAttr(item.imageUrl || "/favicon.svg")}"
                  alt="${escapeAttr(item.title)}"
                  class="archive-img"
                  loading="lazy"
                  decoding="async"
                  width="800"
                  height="500"
                />
                ${chipFor(settle, item.status)}
                <span class="archive-lot-tag">LOT #${catalog.length - index}</span>
              </div>

              <div class="archive-body">
                <div class="archive-info-header">
                  <h2 class="archive-lot-title">${escapeHtml(item.title)}</h2>
                  <p class="archive-date">${date}</p>
                </div>

                <div class="archive-receipt-box">
                  <div class="receipt-row">
                    <span class="receipt-label">Hammer Price:</span>
                    <span class="receipt-val-bold">${formatNim(item.winningBidLunas ?? 0)} NIM</span>
                  </div>
                  <div class="receipt-row">
                    <span class="receipt-label">Winner:</span>
                    <span class="receipt-val-mono">Paddle #${item.winningPaddle ?? "?"}</span>
                  </div>
                  <div class="receipt-row">
                    <span class="receipt-label">Host Recipient:</span>
                    <span class="receipt-val-mono">${escapeHtml(shortAddress(item.hostAddress))}</span>
                  </div>
                </div>

                ${reason}
                <a class="btn-explorer-link" href="/room/${encodeURIComponent(item.id)}">View bids and removal history</a>
                ${tx}
              </div>
            </article>`;
          }).join("")}
        </div>`}
      </div>
    `;

    const searchInput = container.querySelector("#results-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value.trim();
        render();
        const nextInput = container.querySelector("#results-search-input");
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        }
      });
    }

    const clearSearch = container.querySelector("#btn-clear-search");
    if (clearSearch) clearSearch.addEventListener("click", () => {
      searchQuery = "";
      render();
    });
  }

  async function load() {
    try {
      const lots = await listLots();
      state.results = lots.results || [];
      state.unreachable = false;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      state.unreachable = true;
      state.results = [];
    }
    render();
  }

  load();

  return function cleanup() { disposed = true; /* listeners die with the DOM */ };
}

function formatDate(ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
