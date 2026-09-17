// Compatibility and UX hardening for Nimiq Pay WebViews.
// Keep this module small and DOM-driven so core auction state stays in the
// existing views and Durable Object state machine.
import { bootWallet, getBootState, resetBoot } from "./session.js";
import { renderQr, storeLinksMarkup } from "./qr.js";

let walletProbeRunning = false;
let walletProbeFinished = false;
let payHandoffDialog = null;

function routeNeedsWallet() {
  return location.pathname === "/host" || location.pathname.startsWith("/room/");
}

async function recoverEmbeddedWallet() {
  if (typeof window === "undefined" || !window.nimiqPay || !routeNeedsWallet() || walletProbeRunning || walletProbeFinished) return;

  const status = getBootState().status;
  if (!["idle", "spectate"].includes(status)) {
    if (status === "ready" || status === "cancelled" || status === "no_accounts" || status === "paddle_error") {
      walletProbeFinished = true;
    }
    return;
  }

  walletProbeRunning = true;
  try {
    // Nimiq Pay injects window.nimiqPay before page scripts. If the Nimiq
    // provider itself lands a moment later, the SDK init helper should wait
    // for it instead of leaving the page permanently in spectator mode.
    if (status === "spectate") resetBoot();
    const result = await bootWallet();
    if (result.walletState === "ready") {
      walletProbeFinished = true;
      // Re-render the current SPA route so Host/Room surfaces pick up the
      // newly-ready wallet and paddle session.
      window.dispatchEvent(new PopStateEvent("popstate"));
    } else if (result.walletState !== "spectate") {
      // Do not automatically re-prompt after cancellation, no accounts, or
      // a paddle permission error. Existing retry UI remains authoritative.
      walletProbeFinished = true;
    }
  } finally {
    walletProbeRunning = false;
  }
}

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isMobileDevice() {
  return isAppleMobile() || /Android|Mobile/i.test(navigator.userAgent);
}

function hardenPhotoPicker() {
  const input = document.querySelector("#lot-photo-input");
  if (input && isAppleMobile() && input.getAttribute("accept") !== "image/*") {
    // iOS Photos may return formats other than the narrow JPEG/PNG/WebP
    // list. The image pipeline converts the selected image to JPEG anyway.
    input.setAttribute("accept", "image/*");
  }
}

function appendText(parent, className, text) {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function isHostRoom(room) {
  const hostMessage = room?.querySelector("#room-action-section .spectate-deck-text")?.textContent || "";
  return /you are hosting this lot/i.test(hostMessage);
}

function clarifyAuctionNumbers() {
  const room = document.querySelector(".room-view");
  if (!room) return;

  for (const cell of room.querySelectorAll(".spec-cell")) {
    const label = cell.querySelector(".spec-label");
    if (label?.textContent?.trim() === "Min Increment") {
      label.textContent = "Bid Step After Opening";
    }
  }

  const current = room.querySelector("#room-bid-amount")?.textContent?.trim() || "";
  const next = room.querySelector("#room-next-amount");
  if (/^0(?:\.0+)?\s*NIM$/i.test(current) && next && /^next bid\s*≥/i.test(next.textContent || "")) {
    next.textContent = next.textContent.replace(/^next bid\s*≥\s*/i, "Opening bid ");
    const priceLabel = room.querySelector(".deck-price-label");
    if (priceLabel) priceLabel.textContent = "NO BIDS YET";
  }
}

function humanizeLongTimers() {
  const selectors = [
    ".deck-time-digits",
    ".sticky-bid-timer",
    ".lobby-timer-pill .timer-num",
    "#timer-display"
  ];

  for (const el of document.querySelectorAll(selectors.join(","))) {
    const match = (el.textContent || "").trim().match(/^(\d+):(\d{2})$/);
    if (!match) continue;
    const minutes = Number(match[1]);
    if (!Number.isFinite(minutes) || minutes < 60) continue;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    el.textContent = `${hours}h ${remainingMinutes}m`;
    el.setAttribute("aria-label", `${hours} hours ${remainingMinutes} minutes remaining`);
  }
}

function hardenLandingResultImages() {
  const section = document.querySelector("#results-preview");
  if (!section) return;

  section.querySelectorAll(".result-card-media").forEach((media) => {
    media.classList.add("archive-media-wrap");
  });

  section.querySelectorAll("img.result-img").forEach((img) => {
    img.classList.add("archive-img");
    img.loading = "eager";
    if (img.dataset.nimgavelImageGuard) return;
    img.dataset.nimgavelImageGuard = "ready";
    img.addEventListener("error", () => {
      if (img.dataset.nimgavelImageGuard === "fallback") return;
      img.dataset.nimgavelImageGuard = "fallback";
      img.src = "/favicon.svg";
    });
  });
}

async function showDesktopPayHandoff(deeplink) {
  if (payHandoffDialog?.isConnected) return;

  const dialog = document.createElement("dialog");
  payHandoffDialog = dialog;
  dialog.className = "bid-removal-dialog";
  dialog.setAttribute("aria-labelledby", "pay-handoff-title");
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="pay-handoff-title">Open in Nimiq Pay</h2>
      <p>You are on a desktop browser. Scan this QR code with your phone to open the same Nimgavel page in Nimiq Pay.</p>
      <div class="qr-slot" id="desktop-pay-qr"></div>
      <p>No Nimiq Pay yet? ${storeLinksMarkup()}</p>
      <div class="bid-removal-actions">
        <button type="submit" class="bid-remove-button">Close</button>
      </div>
    </form>`;

  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (payHandoffDialog === dialog) payHandoffDialog = null;
  }, { once: true });

  dialog.showModal();
  const qr = dialog.querySelector("#desktop-pay-qr");
  try {
    await renderQr(qr, deeplink, { size: 180 });
    const hint = document.createElement("p");
    hint.className = "qr-hint";
    hint.textContent = "Scan with your phone camera, then continue inside Nimiq Pay.";
    qr.appendChild(hint);
  } catch {
    qr.innerHTML = `<p class="qr-hint">Open this page on your phone, then launch it in Nimiq Pay.</p>`;
  }
}

function ensureBidContext() {
  const room = document.querySelector(".room-view");
  if (!room || isHostRoom(room)) return;

  const action = room.querySelector("#room-action-section");
  if (!action || action.querySelector(".bid-context-card")) return;
  if (action.querySelector(".winner-settlement-card, .auction-ended-card, .settle-verified-box, .settle-verification-flow")) return;

  const title = room.querySelector(".room-card-title")?.textContent?.trim();
  if (!title) return;

  const desc = room.querySelector(".room-card-desc")?.textContent?.trim() || "No additional item description was provided.";
  const host = room.querySelector(".room-host-chip")?.textContent?.replace(/^Host:\s*/i, "").trim();
  const specs = [...room.querySelectorAll(".spec-cell")].map((cell) => ({
    label: cell.querySelector(".spec-label")?.textContent?.trim(),
    value: cell.querySelector(".spec-val")?.textContent?.trim()
  })).filter((item) => item.label && item.value);

  const card = document.createElement("aside");
  card.className = "bid-context-card";
  card.setAttribute("aria-label", "Auction details before bidding");

  const kicker = document.createElement("span");
  kicker.className = "bid-context-kicker";
  kicker.textContent = "BEFORE YOU BID";
  card.appendChild(kicker);
  appendText(card, "bid-context-title", title);
  appendText(card, "bid-context-desc", desc);

  const facts = document.createElement("div");
  facts.className = "bid-context-facts";
  if (host) {
    const chip = document.createElement("span");
    chip.textContent = `Host ${host}`;
    facts.appendChild(chip);
  }
  for (const spec of specs) {
    const chip = document.createElement("span");
    chip.textContent = `${spec.label}: ${spec.value}`;
    facts.appendChild(chip);
  }
  card.appendChild(facts);

  appendText(
    card,
    "bid-context-trust",
    "The winner pays the host directly in NIM. Nimgavel does not escrow the payment or guarantee item delivery. A valid bid in the final 30 seconds extends the auction by 30 seconds."
  );

  action.prepend(card);
}

function ensureHostRoomClarity() {
  const room = document.querySelector(".room-view");
  if (!room || !isHostRoom(room)) return;

  const feed = room.querySelector(".deck-feed-section");
  if (feed && !feed.querySelector(".host-bid-guidance")) {
    const guidance = document.createElement("div");
    guidance.className = "host-bid-guidance";
    guidance.setAttribute("role", "status");

    const title = document.createElement("strong");
    title.textContent = "Bids are accepted automatically";
    guidance.appendChild(title);

    appendText(
      guidance,
      "host-bid-guidance-copy",
      "You do not need to accept incoming bids. Use bid moderation only when you need to remove an invalid or mistaken bid."
    );

    const header = feed.querySelector(".feed-header-row");
    if (header) header.insertAdjacentElement("afterend", guidance);
    else feed.prepend(guidance);
  }

  const hostControls = feed?.querySelector("#enable-host-controls");
  if (hostControls) {
    if (hostControls.textContent.trim() === "Enable host controls") hostControls.textContent = "Enable bid moderation";
    if (hostControls.textContent.trim() === "Refresh host controls") hostControls.textContent = "Refresh moderation controls";
  }

  const sticky = room.querySelector(".room-sticky-bid-bar");
  const cta = sticky?.querySelector(".sticky-bid-cta");
  if (cta && !cta.classList.contains("host-sticky-status")) {
    const status = document.createElement("span");
    status.className = "sticky-bid-cta host-sticky-status";
    status.textContent = "Hosting this auction";
    status.setAttribute("aria-label", "You are hosting this auction. Bids are accepted automatically.");
    cta.replaceWith(status);
  }
}

// Desktop browsers cannot reliably report whether a custom-protocol handler
// exists. Do not leave users with a dead nimiqpay:// click: show a QR handoff
// instead. Mobile devices still get the native protocol attempt.
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[href^="nimiqpay://"]') : null;
  if (!link || window.nimiqPay || isMobileDevice()) return;
  event.preventDefault();
  void showDesktopPayHandoff(link.getAttribute("href"));
});

// iOS WebViews can occasionally swallow the synthetic click that normally
// follows a touch. Convert the explicit Remove photo touch into the existing
// click handler while suppressing the duplicate follow-up click.
document.addEventListener("touchend", (event) => {
  const target = event.target instanceof Element ? event.target.closest("#btn-remove-photo") : null;
  if (!target) return;
  event.preventDefault();
  target.click();
}, { passive: false });

function applyUxHardening() {
  void recoverEmbeddedWallet();
  hardenPhotoPicker();
  clarifyAuctionNumbers();
  humanizeLongTimers();
  hardenLandingResultImages();
  ensureBidContext();
  ensureHostRoomClarity();
}

const observer = new MutationObserver(() => {
  applyUxHardening();
});

function startCompat() {
  applyUxHardening();
  observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startCompat, { once: true });
} else {
  startCompat();
}
