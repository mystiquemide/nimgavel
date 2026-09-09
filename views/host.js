// Gate 5 — Host: create + sign a lot, my lots with Start/Watch.
// Payout address = connected wallet. Inline errors, never alert().
import { getAccount, signMessage, formatNim, WalletCancelledError } from "../lib/nimiq.js";
import {
  createHostChallenge,
  createLot,
  listLots,
  startLot,
  ApiError
} from "../lib/api.js";
import { session, isSpectate, walletReady } from "../lib/session.js";
import { escapeHtml, escapeAttr } from "./room.js";

const myLotsKey = "nimgavel.myLots"; // lotId -> { hostToken, savedAt }

export function renderHost(container, { navigate }) {
  const state = { creating: false, myLots: [], justCreated: null, formError: null, shareLot: null };

  container.innerHTML = `
    <div class="host-back">
      <a href="/lobby">← lobby</a>
      <h1 class="brand">HOST A LOT</h1>
    </div>
    <div id="host-wallet-slot"></div>
    <main id="host-main"></main>
    <footer class="app-footer"><span>Nimgavel</span><span class="mono">host console</span></footer>
  `;

  const main = container.querySelector("#host-main");
  const walletSlot = container.querySelector("#host-wallet-slot");

  function render() {
    renderWalletGate();
    renderMain();
  }

  function renderWalletGate() {
    if (isSpectate()) {
      walletSlot.innerHTML = `
        <div class="wallet-row">
          Hosting needs Nimiq Pay.
          <a href="nimiqpay://miniapp?url=${encodeURIComponent("https://nimgavel.artistic-chip.workers.dev/host")}">Open in Nimiq Pay</a>
        </div>`;
      return;
    }
    if (!walletReady() || !getAccount()) {
      walletSlot.innerHTML = `<div class="wallet-row">Wallet not connected yet. Open the lobby once, then come back.</div>`;
      return;
    }
    const account = String(getAccount()).replace(/ /g, "");
    walletSlot.innerHTML = `
      <div class="wallet-row">
        Payout address
        <div class="mono" style="margin-top:4px;color:var(--text);font-size:12px">${escapeHtml(account)}</div>
      </div>`;
  }

  function renderMain() {
    if (isSpectate() || !walletReady() || !getAccount()) {
      main.innerHTML = `<div class="skeleton">hosting unavailable in this view</div>`;
      return;
    }
    main.innerHTML = `
      <form class="form" id="lot-form">
        <label>Title
          <input name="title" required maxlength="120" placeholder="Vintage mechanical watch" />
        </label>
        <label>Description
          <textarea name="description" maxlength="2000" rows="3" placeholder="What is the room bidding on?"></textarea>
        </label>
        <label>Image URL (https)
          <input name="imageUrl" type="url" placeholder="https://…" />
        </label>
        <div class="dim" style="font-size:12px;margin:-6px 0 4px">Any public https image link works. Leave empty for the gavel.</div>
        <div class="row">
          <label>Start price (NIM)
            <input name="startPrice" type="number" min="0.00001" step="0.00001" value="5" required />
          </label>
          <label>Increment (NIM)
            <input name="minIncrement" type="number" min="0.00001" step="0.00001" value="1" required />
          </label>
        </div>
        <div class="row">
          <label>Duration (min)
            <input name="duration" type="number" min="1" max="1440" value="3" required />
          </label>
          <label>Schedule (optional)
            <input name="schedule" type="datetime-local" />
          </label>
        </div>
        <button class="btn full" id="create-btn" type="submit" ${state.creating ? "disabled" : ""}>
          ${state.creating ? "Waiting for Nimiq Pay…" : "Sign & create lot"}
        </button>
        ${state.formError ? `<div class="form-error" role="alert">${escapeHtml(state.formError)}</div>` : ""}
        ${state.justCreated ? `<div class="form-success">Lot created. Start it below.</div>` : ""}
      </form>
      ${state.shareLot ? renderShareSheet() : ""}
      <div class="section-label">MY LOTS</div>
      <div id="my-lots"></div>
    `;

    main.querySelector("#lot-form").addEventListener("submit", onCreate);
    renderMyLots();
    wireShareSheet();
  }

  function renderShareSheet() {
    const lot = state.shareLot;
    const roomUrl = `${location.origin}/room/${lot.id}`;
    const deeplink = `nimiqpay://miniapp?url=${encodeURIComponent(roomUrl)}`;
    return `
      <div class="card share-card" id="share-sheet">
        <div class="share-title">Lot created. Bring bidders in.</div>
        <div class="share-row">
          <button class="btn sm" id="copy-link" data-url="${escapeAttr(roomUrl)}">Copy link</button>
          <button class="btn secondary sm" id="toggle-qr">Show QR</button>
        </div>
        <div class="qr-slot" id="qr-slot" style="display:none" data-deeplink="${escapeAttr(deeplink)}"></div>
        <div class="dim mono" style="font-size:11px;margin-top:10px">Share opens straight into Nimiq Pay.</div>
      </div>`;
  }

  function wireShareSheet() {
    const copy = main.querySelector("#copy-link");
    if (copy) copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(copy.dataset.url);
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy link"; }, 1600);
      } catch {
        window.prompt("Copy this link:", copy.dataset.url);
      }
    });

    const toggle = main.querySelector("#toggle-qr");
    if (toggle) toggle.addEventListener("click", async () => {
      const slot = main.querySelector("#qr-slot");
      if (!slot) return;
      if (slot.style.display === "none") {
        if (!slot.firstChild) {
          // Lazy: the QR lib only loads when a host actually shows the code.
          const { default: QRCode } = await import("qrcode");
          const canvas = document.createElement("canvas");
          slot.appendChild(canvas);
          await QRCode.toCanvas(canvas, slot.dataset.deeplink, { width: 132, margin: 1, color: { dark: "#060D1B", light: "#FFFFFF" } });
        }
        slot.style.display = "block";
        toggle.textContent = "Hide QR";
      } else {
        slot.style.display = "none";
        toggle.textContent = "Show QR";
      }
    });
  }

  function renderMyLots() {
    const slot = main.querySelector("#my-lots");
    if (!slot) return;
    if (!state.myLots.length) {
      slot.innerHTML = `<div class="dim" style="font-size:13px;padding:8px 0">No lots yet. Your first lot runs in minutes.</div>`;
      return;
    }
    slot.innerHTML = state.myLots.map((lot) => {
      const control = lot.status === "created"
        ? `<button class="btn sm full" style="margin-top:10px" data-start="${escapeAttr(lot.id)}">Start the room</button>`
        : `<button class="btn secondary sm full" style="margin-top:10px" data-watch="${escapeAttr(lot.id)}">${lot.status === "live" ? "Watch the room" : "See how it went"}</button>`;
      return `
        <div class="card lot-card" style="margin-bottom:10px">
          <img class="thumb" src="${escapeAttr(lot.imageUrl || "/favicon.svg")}" alt="${escapeAttr(lot.title)}" />
          <div class="lot-body">
            <h2 class="lot-title">${escapeHtml(lot.title)}</h2>
            <div class="lot-meta num">
              opens at ${formatNim(lot.startPriceLunas)} NIM · <span class="host-status-chip ${escapeAttr(lot.status)}">${escapeHtml(lot.status)}</span>
            </div>
            ${control}
          </div>
        </div>`;
    }).join("");

    slot.querySelectorAll("[data-start]").forEach((button) => {
      button.addEventListener("click", () => onStart(button.dataset.start));
    });
    slot.querySelectorAll("[data-watch]").forEach((button) => {
      button.addEventListener("click", () => navigate(`/room/${button.dataset.watch}`));
    });
  }

  async function onCreate(event) {
    event.preventDefault();
    if (state.creating) return;
    state.creating = true;
    state.justCreated = null;
    state.formError = null;
    renderMain();

    const form = new FormData(event.target);
    const startPriceLunas = Math.round(Number(form.get("startPrice")) * 100000);
    const minIncrementLunas = Math.round(Number(form.get("minIncrement")) * 100000);
    const durationSec = Math.round(Number(form.get("duration")) * 60);
    const scheduledAtRaw = form.get("schedule");
    const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw).getTime() : null;

    try {
      const hostAddress = getAccount();
      const challenge = await createHostChallenge(hostAddress);
      const signed = await signMessage(challenge.challenge.message);

      const created = await createLot({
        challengeId: challenge.challenge.id,
        hostAddress,
        publicKey: signed.publicKey,
        signature: signed.signature,
        title: form.get("title"),
        description: form.get("description") || "",
        imageUrl: form.get("imageUrl") || "",
        hostPaddle: session.paddle,
        startPriceLunas,
        minIncrementLunas,
        durationSec,
        ...(scheduledAt ? { scheduledAt } : {})
      });

      try {
        const store = JSON.parse(localStorage.getItem(myLotsKey) || "{}");
        store[created.lot.id] = { hostToken: created.hostToken, savedAt: Date.now() };
        localStorage.setItem(myLotsKey, JSON.stringify(store));
      } catch { /* storage unavailable: lot exists, Start needs recreate */ }

      state.justCreated = created.lot.id;
      state.shareLot = created.lot;
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
    renderMain();
  }

  async function onStart(lotId) {
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
      navigate(`/room/${lotId}`);
    } catch (error) {
      state.formError = error.message || "The room didn't start. Try again, or check the lot in My Lots.";
      renderMain();
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

  render();
  refreshMyLots();

  return function cleanup() {};
}
