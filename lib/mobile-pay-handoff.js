// Keeps the plain mobile-browser side of the Nimiq Pay handoff clean.
// Some mobile OS/browser combinations keep the originating page visible
// underneath the native app transition. Replace the interactive page with a
// neutral handoff layer so users do not see or re-tap stale Pay/Host controls.

let overlay = null;
let leftPageAt = 0;
let fallbackTimer = null;

function isEmbeddedNimiqPay() {
  return typeof window !== "undefined" && Boolean(window.nimiq || window.nimiqPay);
}

function isMobileDevice() {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function clearFallbackTimer() {
  if (fallbackTimer) clearTimeout(fallbackTimer);
  fallbackTimer = null;
}

function closeOverlay() {
  clearFallbackTimer();
  overlay?.remove();
  overlay = null;
  document.documentElement.style.removeProperty("overflow");
}

function showOverlay() {
  closeOverlay();

  const layer = document.createElement("div");
  layer.id = "nimgavel-mobile-pay-handoff";
  layer.setAttribute("role", "status");
  layer.setAttribute("aria-live", "polite");
  layer.innerHTML = `
    <div class="nimgavel-mobile-pay-handoff-card">
      <span class="nimgavel-mobile-pay-handoff-kicker">NIMIQ PAY</span>
      <h2>Opening Nimiq Pay…</h2>
      <p>Continue there to connect your wallet, bid, host, or pay. This browser page will restore when you return.</p>
      <button type="button" id="nimgavel-mobile-pay-handoff-back">Back to Nimgavel</button>
    </div>`;

  const style = document.createElement("style");
  style.textContent = `
    #nimgavel-mobile-pay-handoff{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:24px;background:#f7f0d9;color:#173300;font-family:Inter,system-ui,sans-serif}
    .nimgavel-mobile-pay-handoff-card{width:min(100%,430px);padding:28px;border:2px dashed #173300;border-radius:24px;background:#fffaf0;text-align:center;box-shadow:0 18px 60px rgba(23,51,0,.12)}
    .nimgavel-mobile-pay-handoff-kicker{display:inline-block;margin-bottom:10px;font:600 13px/1.2 "Roboto Mono",monospace;letter-spacing:.12em}
    .nimgavel-mobile-pay-handoff-card h2{margin:0 0 10px;font:800 30px/1.05 "Bricolage Grotesque",Inter,sans-serif}
    .nimgavel-mobile-pay-handoff-card p{margin:0 auto 22px;max-width:34ch;font-size:16px;line-height:1.55}
    #nimgavel-mobile-pay-handoff-back{width:100%;padding:14px 18px;border:2px solid #173300;border-radius:14px;background:#173300;color:#fff;font:700 16px/1.2 Inter,sans-serif}
  `;
  layer.prepend(style);
  document.body.appendChild(layer);
  document.documentElement.style.overflow = "hidden";
  overlay = layer;
  layer.querySelector("#nimgavel-mobile-pay-handoff-back")?.addEventListener("click", closeOverlay);

  // If no native handler opens and the page never becomes hidden, restore the
  // site instead of trapping the user behind the handoff layer.
  fallbackTimer = setTimeout(() => {
    if (!document.hidden && leftPageAt === 0) closeOverlay();
  }, 8000);
}

document.addEventListener("click", (event) => {
  const link = event.target instanceof Element
    ? event.target.closest('a[href^="nimiqpay://"]')
    : null;
  if (!link || !isMobileDevice() || isEmbeddedNimiqPay()) return;

  event.preventDefault();
  const deeplink = link.getAttribute("href");
  if (!deeplink) return;

  leftPageAt = 0;
  showOverlay();
  requestAnimationFrame(() => {
    window.location.href = deeplink;
  });
}, true);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    leftPageAt = Date.now();
    clearFallbackTimer();
    return;
  }

  if (overlay && leftPageAt) {
    // Give the browser a moment to finish restoring its viewport after the
    // native app transition before bringing the normal page back.
    setTimeout(closeOverlay, 350);
  }
});

window.addEventListener("pageshow", () => {
  if (overlay && leftPageAt) setTimeout(closeOverlay, 350);
});
