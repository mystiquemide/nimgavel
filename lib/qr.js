// QR handoff for the Nimiq Pay boundary: plain browsers get a scannable
// deeplink instead of a dead custom-protocol tap.
import QRCode from "qrcode";

export const PAY_INSTALL_URL = "https://www.nimiq.com/nimiq-pay";
export const STORE_LINKS = {
  appStore: "https://apps.apple.com/app/id6471844738",
  playStore: "https://play.google.com/store/apps/details?id=com.nimiq.pay"
};

export function storeLinksMarkup() {
  return `
    <span class="store-links">
      <a href="${STORE_LINKS.appStore}" target="_blank" rel="noopener">App Store ↗</a>
      <a href="${STORE_LINKS.playStore}" target="_blank" rel="noopener">Google Play ↗</a>
    </span>`;
}

// In-app wallet failure card: the wallet handshake stalled, so offer a
// retry instead of a dead spinner. Never shown in plain browsers.
export function walletTroubleCard(retryId) {
  return `
    <div class="wallet-trouble-card">
      <p class="wallet-trouble-title">The wallet did not respond.</p>
      <p class="wallet-trouble-desc">This can happen when the permission prompt was dismissed or the app version is older. Try again.</p>
      <button type="button" class="btn-raise-paddle" id="${retryId}">
        <span>Retry wallet connection</span>
        <span aria-hidden="true">→</span>
      </button>
    </div>`;
}

export async function renderQr(container, text, { size = 148 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "QR code that opens this page in Nimiq Pay");
  await QRCode.toCanvas(canvas, text, {
    width: size,
    margin: 2,
    color: { dark: "#173300", light: "#FFFFFF" }
  });
  container.innerHTML = "";
  container.appendChild(canvas);
}

export function qrToggleMarkup(id) {
  return `
    <button type="button" class="btn-qr-toggle" id="${id}" aria-expanded="false">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
        <path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M21 21v.01M17.5 17.5h.01"></path>
      </svg>
      <span>Show QR</span>
    </button>`;
}

export function wireQrToggle({ container, toggleId, deeplink, slotClass = "qr-slot" }) {
  const toggle = container.querySelector(`#${toggleId}`);
  if (!toggle) return;
  toggle.addEventListener("click", async () => {
    let slot = container.querySelector(`.${slotClass}`);
    const open = toggle.getAttribute("aria-expanded") === "true";
    if (open) {
      if (slot) slot.remove();
      toggle.setAttribute("aria-expanded", "false");
      toggle.querySelector("span").textContent = "Show QR";
      return;
    }
    slot = document.createElement("div");
    slot.className = slotClass;
    toggle.after(slot);
    toggle.setAttribute("aria-expanded", "true");
    toggle.querySelector("span").textContent = "Hide QR";
    try {
      await renderQr(slot, deeplink);
      const hint = document.createElement("p");
      hint.className = "qr-hint";
      hint.textContent = "Scan with your phone camera to open this page in Nimiq Pay.";
      slot.appendChild(hint);
    } catch {
      slot.innerHTML = `<p class="qr-hint">Open this link on your phone: <code>${deeplink}</code></p>`;
    }
  });
}
