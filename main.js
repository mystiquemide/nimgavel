// Router. Gates 1+2+4+6 shipped. Smart root: Pay users land in the Lobby
// (zero friction); plain browsers get the Landing.
import "./styles.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/jetbrains-mono/400.css";
import { renderRoom } from "./views/room.js";
import { renderLobby } from "./views/lobby.js";
import { renderLanding } from "./views/landing.js";
import { renderHost } from "./views/host.js";
import { renderResults } from "./views/results.js";

const app = document.getElementById("app");
let cleanup = null;

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  render();
}

function renderRoot(container, options) {
  return window.nimiq ? renderLobby(container, options) : renderLanding(container, options);
}

const routes = [
  { pattern: /^\/$/, view: renderRoot, title: () => "Nimgavel · Live auctions in NIM" },
  { pattern: /^\/lobby$/, view: renderLobby, title: () => "The lobby · Nimgavel" },
  { pattern: /^\/room\/([^/]+)$/, view: renderRoom, title: (lotId) => `Auction room · Nimgavel` },
  { pattern: /^\/host$/, view: renderHost, title: () => "Host a lot · Nimgavel" },
  { pattern: /^\/results$/, view: renderResults, title: () => "Results · Nimgavel" }
];

// Per-screen document titles (tabs, history, shares).
const documentTitle = {
  room: (lotTitle) => {
    document.title = lotTitle ? `${lotTitle} · Nimgavel` : "Auction room · Nimgavel";
  },
  reset: () => { document.title = "Nimgavel · Live auctions in NIM"; }
};

function matchRoute(path) {
  for (const route of routes) {
    const match = path.match(route.pattern);
    if (match) return { route, params: match.slice(1) };
  }
  return null;
}

function render() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }

  const matched = matchRoute(location.pathname);
  if (matched) {
    if (matched.route.title) document.title = matched.route.title(...matched.params);
    cleanup = matched.route.view(app, { navigate, params: matched.params });
    return;
  }

  app.innerHTML = `
    <div style="min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center">
      <span style="font-family:var(--font-display);font-weight:700;font-size:20px;letter-spacing:.06em">NIMGAVEL</span>
      <span style="color:var(--text-dim);font-size:13px;max-width:30ch">The floor opens at Gate 1. Watch the live room from the link you were sent.</span>
    </div>
  `;
}

window.addEventListener("popstate", render);

render();
