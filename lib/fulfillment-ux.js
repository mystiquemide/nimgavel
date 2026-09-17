// Submission-safe fulfillment UX.
// Fulfillment terms are stored inside the existing lot description so this
// improvement needs no schema migration. The room separates them back out
// for bidders and winners.

const FULFILLMENT_PREFIX = "Fulfillment:";
const DELIVERY_PREFIX = "Delivery details:";
const MAX_DESCRIPTION = 1500;
const MAX_DELIVERY_DETAILS = 350;

let currentRoomPath = null;
let currentFulfillment = null;
let applyQueued = false;

function parseDescription(value) {
  const raw = String(value || "").trim();
  const lines = raw.split(/\r?\n/);
  if (!lines[0]?.startsWith(FULFILLMENT_PREFIX) || !lines[1]?.startsWith(DELIVERY_PREFIX)) {
    return { description: raw, fulfillment: null };
  }

  const method = lines[0].slice(FULFILLMENT_PREFIX.length).trim();
  const details = lines[1].slice(DELIVERY_PREFIX.length).trim();
  const description = lines.slice(2).join("\n").trim();
  if (!method || !details) return { description: raw, fulfillment: null };
  return { description, fulfillment: { method, details } };
}

function encodeDescription(method, details, description) {
  const clean = parseDescription(description).description;
  return `${FULFILLMENT_PREFIX} ${method}\n${DELIVERY_PREFIX} ${details}\n\n${clean}`;
}

function currentLotId() {
  const match = location.pathname.match(/^\/room\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function agreementKey() {
  const lotId = currentLotId();
  return lotId ? `nimgavel.fulfillment-agreement.${lotId}` : null;
}

function hasAcceptedFulfillment() {
  const key = agreementKey();
  if (!key) return false;
  try { return sessionStorage.getItem(key) === "1"; }
  catch { return false; }
}

function setAcceptedFulfillment(accepted) {
  const key = agreementKey();
  if (!key) return;
  try {
    if (accepted) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
  } catch {}
}

function createFormGroup() {
  const group = document.createElement("div");
  group.className = "form-group fulfillment-host-fields";
  group.innerHTML = `
    <label for="lot-fulfillment-method" class="form-label">Fulfillment / Delivery</label>
    <select id="lot-fulfillment-method" name="fulfillmentMethod" class="form-input" required>
      <option value="" selected disabled>Select how the winner gets the item</option>
      <option value="Shipping">Shipping</option>
      <option value="Local pickup">Local pickup</option>
      <option value="Digital delivery">Digital delivery</option>
      <option value="Other">Other</option>
    </select>
    <label for="lot-fulfillment-details" class="form-label" style="margin-top:12px">Delivery / collection terms</label>
    <textarea
      id="lot-fulfillment-details"
      name="fulfillmentDetails"
      class="form-textarea"
      rows="4"
      maxlength="${MAX_DELIVERY_DETAILS}"
      required
      placeholder="Include area or coverage, expected delivery / collection timeframe, who pays any shipping cost, and how handoff will be arranged. Do not publish a private home address."
    ></textarea>
    <p class="form-trust-note">These terms are shown before bidding and again to the winner. Be specific enough that a bidder can decide whether the delivery or collection arrangement works for them.</p>
  `;
  return group;
}

function ensureHostFields() {
  const form = document.querySelector("#create-lot-form");
  if (!form || form.querySelector(".fulfillment-host-fields")) return;

  const description = form.querySelector("#lot-desc-input");
  if (!description) return;
  description.maxLength = MAX_DESCRIPTION;
  description.closest(".form-group")?.insertAdjacentElement("beforebegin", createFormGroup());
}

// The host view's submit handler reads FormData during the normal submit
// bubble. Capture first so the existing API path receives the encoded terms.
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== "create-lot-form") return;

  const method = form.querySelector("#lot-fulfillment-method")?.value?.trim();
  const details = form.querySelector("#lot-fulfillment-details")?.value?.trim();
  const description = form.querySelector("#lot-desc-input");
  if (!method || !details || !description) return;

  description.value = encodeDescription(method, details, description.value);
}, true);

function fulfillmentForCurrentRoom() {
  const room = document.querySelector(".room-view");
  if (!room) return null;

  const path = location.pathname;
  if (path !== currentRoomPath) {
    currentRoomPath = path;
    currentFulfillment = null;
  }

  const desc = room.querySelector(".room-card-desc");
  if (desc) {
    const parsed = parseDescription(desc.textContent);
    if (parsed.fulfillment) {
      currentFulfillment = parsed.fulfillment;
      desc.textContent = parsed.description;
      if (!parsed.description) desc.hidden = true;
    }
  }

  return currentFulfillment;
}

function shortDetails(value, max = 180) {
  const text = String(value || "").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function showAgreementNotice(message) {
  const toast = document.querySelector(".toast");
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = "block";
  clearTimeout(toast.__nimgavelFulfillmentTimer);
  toast.__nimgavelFulfillmentTimer = setTimeout(() => {
    toast.style.display = "none";
  }, 4200);
}

function ensureBidAgreement(action, fulfillment) {
  if (!action || action.querySelector(".fulfillment-agreement")) return;

  const accepted = hasAcceptedFulfillment();
  const wrap = document.createElement("label");
  wrap.className = "spectate-deck-note fulfillment-agreement";
  wrap.style.display = "flex";
  wrap.style.gap = "10px";
  wrap.style.alignItems = "flex-start";
  wrap.style.cursor = "pointer";
  wrap.innerHTML = `
    <input type="checkbox" class="fulfillment-agreement-checkbox" ${accepted ? "checked" : ""} style="margin-top:3px" />
    <span class="bid-removal-note">
      I’ve read and agree to the published ${fulfillment.method.toLowerCase()} terms for this lot, including the stated delivery / collection arrangement. I understand Nimgavel verifies payment but does not escrow funds, ship items, or guarantee delivery.
    </span>
  `;

  const checkbox = wrap.querySelector(".fulfillment-agreement-checkbox");
  checkbox?.addEventListener("change", () => {
    setAcceptedFulfillment(Boolean(checkbox.checked));
  });

  action.insertBefore(wrap, action.firstChild);
}

function ensureRoomFulfillment() {
  const room = document.querySelector(".room-view");
  if (!room) return;
  const fulfillment = fulfillmentForCurrentRoom();
  if (!fulfillment) return;

  const details = room.querySelector(".room-lot-details");
  if (details && !details.querySelector(".fulfillment-terms-card")) {
    const card = document.createElement("div");
    card.className = "spectate-deck-note fulfillment-terms-card";
    const heading = document.createElement("p");
    heading.className = "spectate-deck-text";
    heading.textContent = `How the winner gets it: ${fulfillment.method}`;
    const copy = document.createElement("p");
    copy.className = "bid-removal-note";
    copy.textContent = fulfillment.details;
    const trust = document.createElement("p");
    trust.className = "bid-removal-note";
    trust.textContent = "Delivery is arranged directly between the host and winner. Nimgavel verifies payment but does not ship or custody items.";
    card.append(heading, copy, trust);
    const specs = details.querySelector(".room-spec-grid");
    if (specs) specs.insertAdjacentElement("beforebegin", card);
    else details.appendChild(card);
  }

  // miniapp-compat builds a judge-friendly "Before you bid" summary. Keep
  // the internal description envelope out of that card and surface delivery
  // as an explicit fact instead.
  const contextDesc = room.querySelector(".bid-context-desc");
  if (contextDesc) {
    const parsed = parseDescription(contextDesc.textContent);
    if (parsed.fulfillment) contextDesc.textContent = parsed.description || "No additional item description was provided.";
  }
  const facts = room.querySelector(".bid-context-facts");
  if (facts && !facts.querySelector(".fulfillment-context-fact")) {
    const chip = document.createElement("span");
    chip.className = "fulfillment-context-fact";
    chip.textContent = `Delivery: ${fulfillment.method}`;
    facts.appendChild(chip);
  }
  const contextTrust = room.querySelector(".bid-context-trust");
  if (contextTrust) {
    contextTrust.textContent = `Delivery terms: ${shortDetails(fulfillment.details)} The winner pays the host directly in NIM. Nimgavel verifies payment but does not escrow funds, ship items, or guarantee delivery.`;
  }

  const action = room.querySelector("#room-action-section .deck-action-section-inner");
  if (action) {
    ensureBidAgreement(action, fulfillment);
    if (!action.querySelector(".fulfillment-bid-note")) {
      const note = document.createElement("p");
      note.className = "bid-removal-note fulfillment-bid-note";
      note.textContent = `Delivery: ${fulfillment.method}. ${shortDetails(fulfillment.details)}`;
      action.appendChild(note);
    }
  }

  const winner = room.querySelector(".winner-settlement-card, .settle-verified-box");
  if (winner && !winner.querySelector(".fulfillment-winner-note")) {
    const card = document.createElement("div");
    card.className = "spectate-deck-note fulfillment-winner-note";
    const heading = document.createElement("strong");
    heading.textContent = "Getting your item";
    const copy = document.createElement("p");
    copy.className = "bid-removal-note";
    copy.textContent = `${fulfillment.method}: ${fulfillment.details}`;
    const trust = document.createElement("p");
    trust.className = "bid-removal-note";
    trust.textContent = "After payment is verified, complete fulfillment directly with the host using these published terms. Nimgavel currently records the terms and payment proof but does not arbitrate delivery disputes.";
    card.append(heading, copy, trust);
    winner.appendChild(card);
  }
}

// Block all bid entry points until the bidder has acknowledged the fulfillment
// terms for this lot. Capture runs before the room's normal click handlers.
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest("#btn-raise-paddle, #sticky-bid-btn, .btn-inc-pill[data-inc-lunas]")
    : null;
  if (!target || !location.pathname.startsWith("/room/")) return;
  const fulfillment = fulfillmentForCurrentRoom();
  if (!fulfillment || hasAcceptedFulfillment()) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const checkbox = document.querySelector(".fulfillment-agreement-checkbox");
  checkbox?.focus();
  showAgreementNotice("Read and accept this lot’s delivery / collection terms before bidding.");
}, true);

function ensureDocsFulfillmentAnswer() {
  const lifecycle = document.querySelector("#doc-lifecycle .doc-steps");
  if (lifecycle && !lifecycle.querySelector(".fulfillment-doc-step")) {
    const verification = lifecycle.lastElementChild;
    const li = document.createElement("li");
    li.className = "fulfillment-doc-step";
    li.innerHTML = "<strong>Host fulfills the lot.</strong> The host follows the delivery terms published before bidding. Shipping, pickup, or digital handoff happens directly between the host and winner; Nimgavel does not handle logistics.";
    if (verification) lifecycle.insertBefore(li, verification);
    else lifecycle.appendChild(li);
  }

  const faq = document.querySelector("#doc-faq .doc-list");
  if (faq && !faq.querySelector(".fulfillment-faq-item")) {
    const li = document.createElement("li");
    li.className = "fulfillment-faq-item";
    li.innerHTML = "<strong>How do I get the item if I win?</strong> The host publishes the fulfillment method, area or coverage, expected timing, costs, and handoff details before bidding. You must acknowledge those terms before your first bid. After verified payment, the host and winner complete delivery directly.";
    faq.appendChild(li);
  }

  if (faq && !faq.querySelector(".fulfillment-dispute-faq-item")) {
    const li = document.createElement("li");
    li.className = "fulfillment-dispute-faq-item";
    li.innerHTML = "<strong>What if my item is late or never arrives?</strong> Nimgavel currently preserves the published fulfillment terms, auction history, and verified payment record, but it does not yet operate an in-app dispute or delivery-guarantee service. Only bid when the published terms give you a workable fulfillment arrangement. A structured issue-reporting and delivery-status flow is planned.";
    faq.appendChild(li);
  }
}

function applyFulfillmentUx() {
  ensureHostFields();
  ensureRoomFulfillment();
  ensureDocsFulfillmentAnswer();
}

const observer = new MutationObserver(() => {
  if (applyQueued) return;
  applyQueued = true;
  requestAnimationFrame(() => {
    applyQueued = false;
    applyFulfillmentUx();
  });
});

function start() {
  applyFulfillmentUx();
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
