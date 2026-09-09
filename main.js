// Router. The landing is the front door for everyone — browsers and
// Nimiq Pay alike; the hero CTA adapts in-app (see views/landing.js).
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

const routes = [
  { pattern: /^\/$/, name: "landing", view: renderLanding, title: () => "Nimgavel · Live auctions in NIM" },
  { pattern: /^\/lobby$/, name: "lobby", view: renderLobby, title: () => "The lobby · Nimgavel" },
  { pattern: /^\/room\/([^/]+)$/, name: "room", view: renderRoom, title: (lotId) => `Auction room · Nimgavel` },
  { pattern: /^\/host$/, name: "host", view: renderHost, title: () => "Host a lot · Nimgavel" },
  { pattern: /^\/results$/, name: "results", view: renderResults, title: () => "Results · Nimgavel" }
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
  document.body.dataset.route = matched ? matched.route.name : "notfound";
  if (matched) {
    if (matched.route.title) document.title = matched.route.title(...matched.params);
    cleanup = matched.route.view(app, { navigate, params: matched.params });
    return;
  }

  document.title = "Not found · Nimgavel";
  app.innerHTML = `
    <div class="dead-end not-found">
      <span class="brand" style="font-family:var(--font-display);font-weight:700;font-size:20px;letter-spacing:.06em">NIMGAVEL</span>
      <h1 class="dead-title">This floor doesn't exist.</h1>
      <div class="dead-sub">The link may be mistyped, or the room moved. The gavel falls in the lobby.</div>
      <div class="dead-actions">
        <button class="btn sm" id="nf-lobby">Back to the lobby</button>
        <button class="btn secondary sm" id="nf-results">View results</button>
      </div>
    </div>
  `;
  app.querySelector("#nf-lobby").addEventListener("click", () => navigate("/lobby"));
  app.querySelector("#nf-results").addEventListener("click", () => navigate("/results"));
}

window.addEventListener("popstate", render);

render();
