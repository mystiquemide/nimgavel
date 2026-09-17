// Adds one-time bidder wallet proof to outgoing auction bids.
// The Worker independently verifies the signature and live NIM balance,
// so this layer is UX plumbing rather than the security boundary.

import { signMessage } from "./nimiq.js";
import { session, walletReady } from "./session.js";
import {
  BIDDER_PROOF_TTL_MS,
  BIDDER_PROOF_VERSION,
  bidderAuthorizationMessageV2
} from "./bidder-proof.js";

const nativeSend = WebSocket.prototype.send;
const proofs = new Map();
const pendingProofs = new Map();
const watchedSockets = new WeakSet();

function lotIdFromSocket(socket) {
  try {
    const url = new URL(socket.url);
    const match = url.pathname.match(/^\/ws\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function showBidNotice(message) {
  const toast = document.querySelector(".toast");
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = "block";
  clearTimeout(toast.__nimgavelBalanceTimer);
  toast.__nimgavelBalanceTimer = setTimeout(() => {
    toast.style.display = "none";
  }, 4200);
}

function watchBalanceErrors(socket) {
  if (watchedSockets.has(socket)) return;
  watchedSockets.add(socket);
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message?.type !== "error") return;
    if (["insufficient_balance", "balance_unavailable", "bidder_auth_required"].includes(message.code)) {
      queueMicrotask(() => showBidNotice(message.message || "This bid could not be balance-verified."));
    }
  });
}

async function createBidderProof(lotId) {
  if (!walletReady() || !Number.isSafeInteger(session.paddle) || session.paddle < 1) {
    throw new Error("Reconnect your Nimiq Pay wallet before bidding.");
  }

  const paddle = session.paddle;
  const expiresAt = Date.now() + BIDDER_PROOF_TTL_MS;

  // Do not assume listAccounts()[0] is the account the user wants to bid with.
  // Nimiq Pay can expose more than one address. The Worker derives the actual
  // checked Nimiq address from the public key returned by this signature.
  const message = bidderAuthorizationMessageV2({ lotId, paddle, expiresAt });
  const signed = await signMessage(message);

  return {
    version: BIDDER_PROOF_VERSION,
    paddle,
    expiresAt,
    publicKey: signed.publicKey,
    signature: signed.signature
  };
}

function hasUsableProof(lotId) {
  const current = proofs.get(lotId);
  return Boolean(
    current &&
    current.version === BIDDER_PROOF_VERSION &&
    current.expiresAt > Date.now() + 30_000 &&
    current.paddle === session.paddle
  );
}

function proofForLot(lotId) {
  const current = proofs.get(lotId);
  if (hasUsableProof(lotId)) {
    return Promise.resolve(current);
  }

  if (pendingProofs.has(lotId)) return pendingProofs.get(lotId);
  const pending = createBidderProof(lotId)
    .then((proof) => {
      proofs.set(lotId, proof);
      return proof;
    })
    .finally(() => pendingProofs.delete(lotId));
  pendingProofs.set(lotId, pending);
  return pending;
}

WebSocket.prototype.send = function nimgavelBalanceBackedSend(data) {
  let message;
  try {
    message = typeof data === "string" ? JSON.parse(data) : null;
  } catch {
    return nativeSend.call(this, data);
  }

  const lotId = message?.type === "bid" ? lotIdFromSocket(this) : null;
  if (!lotId) return nativeSend.call(this, data);

  watchBalanceErrors(this);

  const proofReady = hasUsableProof(lotId);

  // Do not queue several taps behind the first wallet-signature prompt.
  // The first bid waits for proof; any extra tap while that proof is pending
  // is ignored so one approval cannot accidentally release multiple bids.
  if (!proofReady && pendingProofs.has(lotId)) {
    showBidNotice("Approve the bidder-wallet signature in Nimiq Pay. Your original bid is waiting. No NIM is being sent.");
    return undefined;
  }

  if (!proofReady) {
    // A bid is intentionally off-chain. The first bid only needs one wallet
    // signature so the Worker can identify the exact signing wallet and verify
    // its live balance. Make this visible immediately so the native prompt does
    // not look like a missing transaction request.
    showBidNotice("First bid: approve the wallet signature in Nimiq Pay. Nimgavel will check that signing wallet's live NIM balance. No NIM is being sent.");
  }

  const socket = this;
  void proofForLot(lotId)
    .then((bidderProof) => {
      if (socket.readyState !== WebSocket.OPEN) {
        showBidNotice("The auction connection changed. Try your bid again.");
        return;
      }
      nativeSend.call(socket, JSON.stringify({ ...message, bidderProof }));
    })
    .catch((error) => {
      showBidNotice(error?.message || "Bid authorization was cancelled.");
    });

  return undefined;
};

function ensureBalanceNotice() {
  const action = document.querySelector("#room-action-section .deck-action-section-inner");
  if (!action || action.querySelector(".balance-backed-bid-note")) return;
  const note = document.createElement("p");
  note.className = "bid-removal-note balance-backed-bid-note";
  note.textContent = "First bid asks for one wallet signature. Nimgavel checks the exact signing wallet's spendable on-chain balance. Bids do not send NIM; only the winner pays at settlement.";
  action.appendChild(note);
}

const balanceNoticeObserver = new MutationObserver(ensureBalanceNotice);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    ensureBalanceNotice();
    balanceNoticeObserver.observe(document.documentElement, { childList: true, subtree: true });
  }, { once: true });
} else {
  ensureBalanceNotice();
  balanceNoticeObserver.observe(document.documentElement, { childList: true, subtree: true });
}
