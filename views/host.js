import {
  createHostChallenge,
  createLot,
  listLots,
  startLot,
  ApiError
} from "../lib/api.js";
import { formatNim, signMessage, getAccount, WalletCancelledError } from "../lib/nimiq.js";
import { session, bootWallet, resetBoot, getBootState, isSpectate, walletReady } from "../lib/session.js";
import { storeLinksMarkup, walletTroubleCard } from "../lib/qr.js";
import { fileToLotImage } from "../lib/image.js";
import { escapeHtml, escapeAttr, shortAddress } from "./room.js";

const myLotsKey = "nimgavel.myLots"; // lotId -> { hostToken, savedAt }
const defaultPhoto = "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=800&q=80";
const APP_ORIGIN = "https://nimgavel.artistic-chip.workers.dev";

export function renderHost(container) {
  const state = {
    creating: false,
    justCreated: null,
    formError: null,
    shareLot: null,
    myLots: [],
    imageUrl: "",
    walletBooted: false
  };

  function hostChip() {
    if (isSpectate()) return "Spectator";
    if (walletReady() && getAccount()) return shortAddress(getAccount());
    if (getBootState().status === "connecting" || getBootState().status === "idle") return "connecting…";
    return "Wallet unavailable";
  }

  function render() {
    if (state.shareLot) {
      renderShareView();
      return;
    }
    if (isSpectate()) {
      renderSpectateGate();
      return;
    }
    const boot = getBootState().status;
    if (boot === "connecting" || boot === "idle") {
      renderBootGate();
      return;
    }
    if (!walletReady() || !getAccount()) {
      renderWalletTroubleGate();
      return;
    }
    renderForm();
    renderMyLots();
  }

  function renderBootGate() {
    container.innerHTML = `
      <div class="host-view">
        <div class="host-header-bar">
          <div class="host-back-group">
            <a href="/lobby" class="btn-back-nav" aria-label="Return to Auction Floor">
              <span aria-hidden="true">←</span>
              <span>Back to Floor</span>
            </a>
            <div class="host-title-wrap">
              <h1 class="host-title">Host an Auction</h1>
              <span class="host-badge">Zero Listing Fees</span>
            </div>
          </div>
        </div>
        <div class="quiet-floor-state" data-animate="scale-in">
          <div class="quiet-icon-box">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <h2 class="quiet-title">Connecting your wallet…</h2>
          <p class="quiet-desc">Hosting signs a challenge with your Nimiq wallet.</p>
        </div>
      </div>
    `;
  }

  function renderSpectateGate() {
    container.innerHTML = `
      <div class="host-view">
        <div class="host-header-bar">
          <div class="host-back-group">
            <a href="/lobby" class="btn-back-nav" aria-label="Return to Auction Floor">
              <span aria-hidden="true">←</span>
              <span>Back to Floor</span>
            </a>
            <div class="host-title-wrap">
              <h1 class="host-title">Host an Auction</h1>
              <span class="host-badge">Zero Listing Fees</span>
            </div>
          </div>
        </div>
        <div class="quiet-floor-state" data-animate="scale-in">
          <div class="quiet-icon-box">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14.5 2.5l7 7-2 2-7-7 2-2zm-2.5 4.5l-9 9 2 2 9-9-2-2zm-8 12.5h16v2h-16v-2z"/>
            </svg>
          </div>
          <h2 class="quiet-title">Hosting runs inside Nimiq Pay.</h2>
          <p class="quiet-desc">Your wallet signs the lot into existence. That is the whole registration. No accounts, no passwords.</p>
          <div class="quiet-actions">
            <a class="btn-quiet-results" href="nimiqpay://miniapp?url=${encodeURIComponent(APP_ORIGIN + "/host")}">Open in Nimiq Pay</a>
            <a class="btn-quiet-host" href="/lobby">Back to the Floor</a>
          </div>
          <p class="spectate-install-note">Get it free: ${storeLinksMarkup()} · <a href="https://www.nimiq.com/nimiq-pay" target="_blank" rel="noopener">nimiq.com/nimiq-pay</a></p>
        </div>
      </div>
    `;
  }

  function renderWalletTroubleGate() {
    container.innerHTML = `
      <div class="host-view">
        <div class="host-header-bar">
          <div class="host-back-group">
            <a href="/lobby" class="btn-back-nav" aria-label="Return to Auction Floor">
              <span aria-hidden="true">←</span>
              <span>Back to Floor</span>
            </a>
            <div class="host-title-wrap">
              <h1 class="host-title">Host an Auction</h1>
              <span class="host-badge">Zero Listing Fees</span>
            </div>
          </div>
        </div>
        ${walletTroubleCard("btn-wallet-retry")}
        <p class="spectate-install-note">Still failing? Make sure Nimiq Pay is up to date: ${storeLinksMarkup()}</p>
      </div>
    `;
    const retry = container.querySelector("#btn-wallet-retry");
    if (retry) retry.addEventListener("click", () => {
      resetBoot();
      render();
      bootWallet().then(() => render());
    });
  }

  function renderForm() {
    container.innerHTML = `
      <div class="host-view">
        <!-- Subheader Navigation Bar -->
        <div class="host-header-bar">
          <div class="host-back-group">
            <a href="/lobby" class="btn-back-nav" aria-label="Return to Auction Floor">
              <span aria-hidden="true">←</span>
              <span>Back to Floor</span>
            </a>
            <div class="host-title-wrap">
              <h1 class="host-title">Host an Auction</h1>
              <span class="host-badge">Zero Listing Fees</span>
            </div>
          </div>

          <div class="host-user-chip">
            <span class="paddle-tag">Host Wallet</span>
            <span class="paddle-val">${escapeHtml(hostChip())}</span>
          </div>
        </div>

          <!-- 2-Column Host Layout -->
          <div class="host-grid">
            <!-- Left Column: Create Form -->
            <div class="host-form-column">
              <div class="host-card">
                <div class="host-card-header">
                  <h2 class="host-section-title">Auction Details</h2>
                  <p class="host-section-desc">
                    Fill in your lot information. When you submit, your Nimiq wallet will request a cryptographic signature to register the room.
                  </p>
                </div>

                <form id="create-lot-form" class="host-form">
                  <!-- Item Title with Ghost View Placeholder -->
                  <div class="form-group">
                    <label for="lot-title-input" class="form-label">Item Title</label>
                    <input
                      type="text"
                      id="lot-title-input"
                      name="title"
                      class="form-input"
                      placeholder="1972 Vintage Polaroid SX-70 Land Camera"
                      maxlength="120"
                      required
                      value=""
                    />
                  </div>

                  <!-- Item Photograph Upload -->
                  <div class="form-group">
                    <label for="lot-photo-input" class="form-label">Item Photograph</label>
                    <div
                      class="photo-dropzone"
                      id="photo-dropzone"
                      role="button"
                      tabindex="0"
                      aria-label="Upload a photo of your item"
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                        <rect x="3" y="6" width="18" height="14" rx="3"></rect>
                        <circle cx="12" cy="13" r="3.5"></circle>
                        <path d="M9 6l1.2-2h3.6L15 6"></path>
                      </svg>
                      <span class="dz-title" id="dz-title">Tap to add a photo</span>
                      <span class="dz-sub">JPEG, PNG, or WebP. Resized on your device before upload.</span>
                    </div>
                    <input
                      type="file"
                      id="lot-photo-input"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                    />
                    <div class="photo-selected" id="photo-selected" hidden>
                      <img id="photo-selected-thumb" alt="Selected item photo preview" />
                      <div class="photo-selected-row">
                        <span class="dz-sub" id="photo-selected-note"></span>
                        <button type="button" class="btn-remove-photo" id="btn-remove-photo">Remove photo</button>
                      </div>
                    </div>
                  </div>

                  <!-- Reserve Price & Increment with Ghost Placeholders -->
                  <div class="form-row-2">
                    <div class="form-group">
                      <label for="lot-price-input" class="form-label">Starting Reserve (NIM)</label>
                      <input
                        type="number"
                        id="lot-price-input"
                        name="price"
                        class="form-input font-mono"
                        placeholder="500"
                        min="0.00001"
                        step="0.00001"
                        required
                        value=""
                      />
                    </div>
                    <div class="form-group">
                      <label for="lot-inc-input" class="form-label">Minimum Bid Step (NIM)</label>
                      <input
                        type="number"
                        id="lot-inc-input"
                        name="inc"
                        class="form-input font-mono"
                        placeholder="50"
                        min="0.00001"
                        step="0.00001"
                        required
                        value=""
                      />
                    </div>
                  </div>

                  <!-- Duration Selection -->
                  <div class="form-group">
                    <label class="form-label">Auction Length</label>
                    <div class="duration-pills-row">
                      <label class="duration-pill active">
                        <input type="radio" name="duration" value="300" checked />
                        <span>5 Minutes</span>
                      </label>
                      <label class="duration-pill">
                        <input type="radio" name="duration" value="900" />
                        <span>15 Minutes</span>
                      </label>
                      <label class="duration-pill">
                        <input type="radio" name="duration" value="3600" />
                        <span>1 Hour</span>
                      </label>
                      <label class="duration-pill">
                        <input type="radio" name="duration" value="86400" />
                        <span>24 Hours</span>
                      </label>
                    </div>
                  </div>

                  <!-- Description with Ghost Placeholder -->
                  <div class="form-group">
                    <label for="lot-desc-input" class="form-label">Item Description & Provenance</label>
                    <textarea
                      id="lot-desc-input"
                      name="desc"
                      class="form-textarea"
                      rows="3"
                      maxlength="2000"
                      placeholder="Folding SLR instant camera with genuine brown leather trim and glass lens. Tested with fresh film pack."
                      required
                    ></textarea>
                  </div>

                  <!-- Submit Action -->
                  <button type="submit" class="btn-create-submit" id="btn-submit-lot" ${state.creating ? "disabled" : ""}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M14.5 2.5l7 7-2 2-7-7 2-2zm-2.5 4.5l-9 9 2 2 9-9-2-2zm-8 12.5h16v2h-16v-2z"/>
                    </svg>
                    <span>${state.creating ? "Waiting for wallet signature…" : "Sign & Create Auction Room"}</span>
                    <span aria-hidden="true">→</span>
                  </button>

                  ${state.formError ? `<div class="form-error-note" role="alert">${escapeHtml(state.formError)}</div>` : ""}

                  <p class="form-trust-note">
                    Your Nimiq wallet signs the challenge locally. The app never touches your private keys.
                  </p>
                </form>
              </div>
            </div>

            <!-- Right Column: Live Card Preview & Rules -->
            <div class="host-side-column">
              <!-- Live Preview Card -->
              <div class="preview-box">
                <span class="preview-box-label">LIVE CARD PREVIEW</span>
                <article class="featured-lot-card" id="host-preview-card">
                  <div class="card-media-wrap">
                    <img
                      src="${escapeAttr(state.imageUrl || defaultPhoto)}"
                      id="preview-img"
                      alt="Preview"
                      class="card-img"
                    />
                    <div class="card-status-bar">
                      <span class="status-badge-live">
                        <span class="pulse-dot" aria-hidden="true"></span>
                        <span>PREVIEW</span>
                      </span>
                      <span class="status-timer-pill" id="preview-timer-pill">05:00</span>
                    </div>
                  </div>
                  <div class="card-body">
                    <h3 class="lot-title" id="preview-title">1972 Vintage Polaroid SX-70 Land Camera</h3>
                    <p class="lot-meta" id="preview-meta">Host: ${escapeHtml(shortAddress(getAccount() || ""))}</p>
                    <div class="bid-status-box">
                      <div class="bid-label-row">
                        <span class="bid-label">STARTING RESERVE</span>
                        <span class="bid-leader" id="preview-inc-label">Min +50 NIM</span>
                      </div>
                      <div class="bid-value-row">
                        <span class="bid-amount-nim" id="preview-price">500 NIM</span>
                      </div>
                    </div>
                  </div>
                </article>
              </div>

              <!-- Host Guide Card -->
              <div class="host-guide-card">
                <h3 class="guide-title">How Hosting Works</h3>
                <ul class="guide-list">
                  <li>
                    <span class="guide-num">1</span>
                    <span>Set your reserve price in NIM. Bidding cannot start below this amount.</span>
                  </li>
                  <li>
                    <span class="guide-num">2</span>
                    <span>Bidders raise paddles in real-time. Any bid placed in the final 30s extends the auction by 30s.</span>
                  </li>
                  <li>
                    <span class="guide-num">3</span>
                    <span>When the gavel falls, the winning bidder sends NIM straight to your address on-chain.</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <!-- My Lots ledger -->
          <div class="host-my-lots-section" id="my-lots-section">
            <span class="preview-box-label">MY LOTS</span>
            <div id="my-lots"></div>
          </div>
      </div>
    `;

    // Duration pill radio changes
    container.querySelectorAll(".duration-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        container.querySelectorAll(".duration-pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        const radio = pill.querySelector("input");
        if (radio) {
          radio.checked = true;
          const mins = Math.floor(parseInt(radio.value, 10) / 60);
          const timerEl = container.querySelector("#preview-timer-pill");
          if (timerEl) timerEl.textContent = `${String(mins).padStart(2, "0")}:00`;
        }
      });
    });

    // Live preview wiring
    const titleInput = container.querySelector("#lot-title-input");
    const priceInput = container.querySelector("#lot-price-input");
    const incInput = container.querySelector("#lot-inc-input");

    if (titleInput) {
      titleInput.addEventListener("input", (e) => {
        const preview = container.querySelector("#preview-title");
        if (preview) preview.textContent = e.target.value.trim() || "1972 Vintage Polaroid SX-70 Land Camera";
      });
    }

    // Photo upload: pick or drop a file, downscale on-device, preview it.
    const dropzone = container.querySelector("#photo-dropzone");
    const fileInput = container.querySelector("#lot-photo-input");
    if (dropzone && fileInput) {
      const openPicker = () => fileInput.click();
      dropzone.addEventListener("click", openPicker);
      dropzone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
      });
      dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dz-drag"); });
      dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dz-drag"));
      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dz-drag");
        const file = e.dataTransfer?.files?.[0];
        if (file) void handlePhoto(file);
      });
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (file) void handlePhoto(file);
      });

      async function handlePhoto(file) {
        try {
          const dataUri = await fileToLotImage(file);
          state.imageUrl = dataUri;
          const selected = container.querySelector("#photo-selected");
          const thumb = container.querySelector("#photo-selected-thumb");
          const note = container.querySelector("#photo-selected-note");
          if (thumb) thumb.src = dataUri;
          if (note) {
            const kb = Math.round(dataUri.length * 0.75 / 1024);
            note.textContent = `Attached, about ${kb} KB after resizing.`;
          }
          if (selected) selected.hidden = false;
          if (dropzone) dropzone.hidden = true;
          const previewImg = container.querySelector("#preview-img");
          if (previewImg) previewImg.src = dataUri;
        } catch (error) {
          state.formError = error.message || "That photo could not be read.";
          render();
        }
      }

      const removeBtn = container.querySelector("#btn-remove-photo");
      if (removeBtn) removeBtn.addEventListener("click", () => {
        state.imageUrl = "";
        if (fileInput) fileInput.value = "";
        const selected = container.querySelector("#photo-selected");
        if (selected) selected.hidden = true;
        if (dropzone) dropzone.hidden = false;
        const previewImg = container.querySelector("#preview-img");
        if (previewImg) previewImg.src = defaultPhoto;
      });
    }

    if (priceInput) {
      priceInput.addEventListener("input", (e) => {
        const preview = container.querySelector("#preview-price");
        const val = Number(e.target.value || "0");
        if (preview) preview.textContent = val > 0 ? `${formatNim(Math.round(val * 100000))} NIM` : "500 NIM";
      });
    }

    if (incInput) {
      incInput.addEventListener("input", (e) => {
        const incLabel = container.querySelector("#preview-inc-label");
        const val = Number(e.target.value || "0");
        if (incLabel) incLabel.textContent = val > 0 ? `Min +${val} NIM` : "Min +50 NIM";
      });
    }

    const form = container.querySelector("#create-lot-form");
    if (form) form.addEventListener("submit", onCreate);
  }

  function renderShareView() {
    const lot = state.shareLot;
    const roomUrl = `${location.origin}/room/${lot.id}`;

    container.innerHTML = `
      <div class="host-view">
        <div class="share-sheet-container" data-animate="scale-in">
          <div class="share-sheet-card">
            <div class="share-success-header">
              <span class="share-success-icon">✓</span>
              <div class="share-title-group">
                <h2 class="share-h2">Auction Room Created!</h2>
                <p class="share-subhead">Your lot is registered and ready for bidders. Start the room when you're ready.</p>
              </div>
            </div>

            <div class="share-lot-summary">
              <img src="${escapeAttr(lot.imageUrl || "/favicon.svg")}" alt="${escapeAttr(lot.title)}" class="share-lot-thumb" />
              <div class="share-lot-info">
                <h3 class="share-lot-name">${escapeHtml(lot.title)}</h3>
                <p class="share-lot-price">Starting Reserve: <strong>${formatNim(lot.startPriceLunas)} NIM</strong></p>
                <p class="share-lot-roomid">Room ID: <code>${escapeHtml(lot.id)}</code></p>
              </div>
            </div>

            <div class="share-link-box">
              <span class="share-box-label">SHAREABLE ROOM LINK</span>
              <div class="share-input-row">
                <input type="text" readonly class="share-url-input" id="share-url-input" value="${escapeAttr(roomUrl)}" />
                <button type="button" class="btn-copy-url" id="btn-copy-url">
                  <span id="copy-btn-text">Copy Room Link</span>
                </button>
              </div>
              <p class="dropzone-sub-text">Share opens straight into Nimiq Pay on mobile.</p>
            </div>

            <div class="share-actions-row">
              <button type="button" class="btn-enter-created-room" id="btn-start-room">
                <span>Start the Auction Now</span>
                <span aria-hidden="true">→</span>
              </button>
              <button type="button" class="btn-create-another" id="btn-create-another">
                <span>Create Another Lot</span>
              </button>
            </div>
            ${state.formError ? `<div class="form-error-note" role="alert" style="margin-top:12px">${escapeHtml(state.formError)}</div>` : ""}
          </div>
        </div>
      </div>
    `;

    const copy = container.querySelector("#btn-copy-url");
    if (copy) copy.addEventListener("click", async () => {
      const input = container.querySelector("#share-url-input");
      const btnText = container.querySelector("#copy-btn-text");
      if (!input) return;
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand?.("copy");
      }
      if (btnText) {
        btnText.textContent = "Copied!";
        setTimeout(() => { btnText.textContent = "Copy Room Link"; }, 2000);
      }
    });

    const start = container.querySelector("#btn-start-room");
    if (start) start.addEventListener("click", () => onStart(lot.id));

    const another = container.querySelector("#btn-create-another");
    if (another) another.addEventListener("click", () => {
      state.shareLot = null;
      state.formError = null;
      state.imageUrl = "";
      render();
      renderMyLots();
    });
  }

  function renderMyLots() {
    const section = container.querySelector("#my-lots-section");
    if (!section) return;
    const slot = container.querySelector("#my-lots");
    if (!slot) return;

    if (!state.myLots.length) {
      slot.innerHTML = `<p class="dropzone-sub-text" style="padding:8px 0">No lots yet. Your first lot runs in minutes.</p>`;
      return;
    }

    slot.innerHTML = state.myLots.map((lot) => {
      const control = lot.status === "created"
        ? `<button class="btn-inc-pill" data-start="${escapeAttr(lot.id)}" style="margin-top:10px">Start the room</button>`
        : `<button class="btn-inc-pill" data-watch="${escapeAttr(lot.id)}" style="margin-top:10px">${lot.status === "live" ? "Watch the room" : "See how it went"}</button>`;
      return `
        <div class="lobby-lot-card" style="margin-bottom:10px">
          <div class="lobby-card-media">
            <img src="${escapeAttr(lot.imageUrl || "/favicon.svg")}" alt="${escapeAttr(lot.title)}" class="lobby-card-img" loading="lazy" decoding="async" width="800" height="500" />
          </div>
          <div class="lobby-card-body">
            <h2 class="lobby-lot-title">${escapeHtml(lot.title)}</h2>
            <p class="lot-meta" style="margin:4px 0 0">opens at ${formatNim(lot.startPriceLunas)} NIM · ${escapeHtml(lot.status)}</p>
            ${control}
          </div>
        </div>`;
    }).join("");

    slot.querySelectorAll("[data-start]").forEach((button) => {
      button.addEventListener("click", () => onStart(button.dataset.start));
    });
    slot.querySelectorAll("[data-watch]").forEach((button) => {
      button.addEventListener("click", () => {
        window.history.pushState({}, "", `/room/${button.dataset.watch}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
    });
  }

  async function onCreate(event) {
    event.preventDefault();
    if (state.creating) return;
    state.creating = true;
    state.formError = null;

    const form = new FormData(event.target);
    const startPriceLunas = Math.round(Number(form.get("price")) * 100000);
    const minIncrementLunas = Math.round(Number(form.get("inc")) * 100000);
    const durationSec = Math.round(Number(form.get("duration")));
    const title = String(form.get("title") || "").trim();
    const description = String(form.get("desc") || "").trim();
    // The photo travels as a downscaled data URI prepared by the picker;
    // no URL field exists anymore.
    const imageUrl = state.imageUrl || "";

    const submitBtn = container.querySelector("#btn-submit-lot span");
    if (submitBtn) submitBtn.textContent = "Waiting for wallet signature…";

    try {
      const hostAddress = getAccount();
      const challenge = await createHostChallenge(hostAddress);
      const signed = await signMessage(challenge.challenge.message);

      const created = await createLot({
        challengeId: challenge.challenge.id,
        hostAddress,
        publicKey: signed.publicKey,
        signature: signed.signature,
        title,
        description,
        imageUrl,
        hostPaddle: session.paddle,
        startPriceLunas,
        minIncrementLunas,
        durationSec
      });

      try {
        const store = JSON.parse(localStorage.getItem(myLotsKey) || "{}");
        store[created.lot.id] = { hostToken: created.hostToken, savedAt: Date.now() };
        localStorage.setItem(myLotsKey, JSON.stringify(store));
      } catch { /* storage unavailable: lot exists, Start needs recreate */ }

      state.justCreated = created.lot.id;
      state.shareLot = created.lot;
      state.imageUrl = "";
      await refreshMyLots();
    } catch (error) {
      if (error instanceof WalletCancelledError) {
        // Normal: nothing signed, nothing created.
      } else {
        state.formError = error instanceof ApiError
          ? error.message
          : "The lot didn't get created. Nothing was signed. Try again.";
      }
    }
    state.creating = false;
    render();
    renderMyLots();
  }

  async function onStart(lotId) {
    state.formError = null;
    try {
      const store = JSON.parse(localStorage.getItem(myLotsKey) || "{}");
      const hostToken = store[lotId]?.hostToken;
      if (!hostToken) throw new Error("Start permission is tied to this device's wallet. Recreate the lot here to start it.");
      try {
        await startLot(lotId, hostToken);
      } catch (error) {
        if (error instanceof ApiError && /already started|already live/i.test(error.message)) {
          // The room is live: watching it is the right action.
        } else {
          throw error;
        }
      }
      window.history.pushState({}, "", `/room/${lotId}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (error) {
      state.formError = error.message || "The room didn't start. Try again, or check the lot in My Lots.";
      render();
      renderMyLots();
    }
  }

  async function refreshMyLots() {
    try {
      const all = await listLots();
      const store = JSON.parse(localStorage.getItem(myLotsKey) || "{}");
      const mine = new Set(Object.keys(store));
      if (session.paddle) {
        for (const group of [all.upcoming, all.live, all.results]) {
          for (const lot of group) {
            if (lot.hostPaddle === session.paddle) mine.add(lot.id);
          }
        }
      }
      const allLots = [...all.upcoming, ...all.live, ...all.results];
      state.myLots = allLots.filter((lot) => mine.has(lot.id));
      renderMyLots();
    } catch {
      // Lobby unreachable: my lots simply don't render this pass.
    }
  }

  // Plain browsers are spectate from the first paint (sync detect). Only
  // Pay webviews run the connect handshake before the form unlocks.
  if (!isSpectate()) {
    bootWallet().then(() => {
      render();
      refreshMyLots();
    });
  }

  render();

  return function cleanup() { /* listeners die with the DOM */ };
}
