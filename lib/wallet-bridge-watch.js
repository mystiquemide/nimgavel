// Passive recovery for Nimiq Pay WebViews that inject their provider after
// the page has already rendered. This watcher never opens a wallet prompt on
// its own in a plain browser; it only reacts once a Nimiq Pay bridge/provider
// actually appears.
import { isEmbeddedNimiqPay } from "./nimiq.js";
import { bootWallet, getBootState, resetBoot } from "./session.js";

const WATCH_MS = 45_000;
const POLL_MS = 250;

let timer = null;
let watchStartedAt = 0;
let recovering = false;

function routeNeedsWallet() {
  return location.pathname === "/lobby" ||
    location.pathname === "/host" ||
    location.pathname.startsWith("/room/");
}

function hasInjectedProvider() {
  return typeof window !== "undefined" && Boolean(window.nimiq || window.nimiqPay);
}

function stopWatch() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function recoverIfReady() {
  if (recovering || !routeNeedsWallet() || !isEmbeddedNimiqPay()) return;

  const status = getBootState().status;
  if (status === "ready" || status === "connecting") return;

  // A provider timeout can happen when Nimiq Pay opens the Mini App before
  // window.nimiq is fully injected. Once the actual provider appears, allow
  // a fresh handshake instead of leaving the user on the retry card.
  const recoverable = status === "idle" || status === "spectate" ||
    (status === "provider_timeout" && hasInjectedProvider());
  if (!recoverable) return;

  recovering = true;
  try {
    if (status !== "idle") resetBoot();
    const result = await bootWallet();
    if (result.walletState === "ready") {
      stopWatch();
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  } finally {
    recovering = false;
  }
}

function armWatch() {
  stopWatch();
  if (!routeNeedsWallet()) return;

  watchStartedAt = Date.now();
  void recoverIfReady();
  timer = setInterval(() => {
    if (Date.now() - watchStartedAt >= WATCH_MS || getBootState().status === "ready") {
      stopWatch();
      return;
    }
    void recoverIfReady();
  }, POLL_MS);
}

window.addEventListener("popstate", armWatch);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void recoverIfReady();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", armWatch, { once: true });
} else {
  armWatch();
}
