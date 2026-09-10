// QR handoff for the Nimiq Pay boundary: plain browsers get a scannable
// deeplink instead of a dead custom-protocol tap.
import QRCode from "qrcode";

export const PAY_INSTALL_URL = "https://nimiq.com/pay/";

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
