// Compatibility and UX hardening for Nimiq Pay WebViews.
// Keep this module small and DOM-driven so core auction state stays in the
// existing views and Durable Object state machine.
import { bootWallet, getBootState, resetBoot } from "./session.js";

let walletProbeRunning = false;
let walletProbeFinished = false;

async function recoverEmbeddedWallet() {
  if (typeof window === "undefined" || !window.nimiqPay || walletProbeRunning || walletProbeFinished) return;

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

function ensureBidContext() {
  const room = document.querySelector(".room-view");
  if (!room) return;

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

// iOS WebViews can occasionally swallow the synthetic click that normally
// follows a touch. Convert the explicit Remove photo touch into the existing
// click handler while suppressing the duplicate follow-up click.
document.addEventListener("touchend", (event) => {
  const target = event.target instanceof Element ? event.target.closest("#btn-remove-photo") : null;
  if (!target) return;
  event.preventDefault();
  target.click();
}, { passive: false });

const observer = new MutationObserver(() => {
  hardenPhotoPicker();
  ensureBidContext();
});

function startCompat() {
  void recoverEmbeddedWallet();
  hardenPhotoPicker();
  ensureBidContext();
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startCompat, { once: true });
} else {
  startCompat();
}
