import { renderNav } from "./components/nav.js";
import { renderLanding } from "./views/landing.js";
import { renderLobby } from "./views/lobby.js";
import { renderRoom } from "./views/room.js";
import { renderHost } from "./views/host.js";
import { renderResults } from "./views/results.js";
import { renderNotFound } from "./views/not-found.js";
import { renderHowItWorks } from "./views/how-it-works.js";
import { renderPrivacy } from "./views/privacy.js";
import { renderTerms } from "./views/terms.js";
import { renderLeaderboard } from "./views/leaderboard.js";

let cleanup = null;

function initApp() {
  const app = document.getElementById("app");
  if (!app) return;

  function handleRoute() {
    if (cleanup) {
      try { cleanup(); } catch { /* view already gone */ }
      cleanup = null;
    }

    const path = window.location.pathname;
    const titles = { "/": "Live Community Auctions", "/lobby": "Auction Floor", "/host": "Host an Auction", "/results": "Results Ledger", "/leaderboard": "Leaderboard", "/how-it-works": "How It Works", "/privacy": "Privacy", "/terms": "Terms" };
    document.title = `${titles[path] || (path.startsWith("/room/") ? "Auction Room" : "Page Not Found")} · Nimgavel`;
    const isLanding = path === "/" || path === "";

    app.innerHTML = `
      <div class="ambient-glow" aria-hidden="true"></div>
      <div id="nav-slot"></div>
      <main class="shell" id="main-content"></main>
      ${isLanding ? "" : `
      <footer class="app-trust-footer">
        <span class="trust-footer-brand">NIMGAVEL</span>
        <nav class="trust-footer-links" aria-label="Trust links">
          <a href="/results">Results</a>
          <a href="/how-it-works">How It Works</a>
          <a href="https://nimiq.watch" target="_blank" rel="noopener noreferrer">Nimiq Watch ↗</a>
          <a href="https://github.com/mystiquemide/nimgavel" target="_blank" rel="noopener noreferrer">Source ↗</a>
          <a href="https://www.nimiq.com/nimiq-pay" target="_blank" rel="noopener noreferrer">Nimiq Pay ↗</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>`}
    `;

    const navSlot = document.getElementById("nav-slot");
    const mainContent = document.getElementById("main-content");

    renderNav(navSlot, { activePath: path });

    if (path === "/" || path === "") {
      cleanup = renderLanding(mainContent) || null;
    } else if (path === "/lobby") {
      cleanup = renderLobby(mainContent) || null;
    } else if (path.startsWith("/room/")) {
      const lotId = path.replace("/room/", "").split("/")[0];
      cleanup = renderRoom(mainContent, lotId) || null;
    } else if (path === "/host") {
      cleanup = renderHost(mainContent) || null;
    } else if (path === "/results") {
      cleanup = renderResults(mainContent) || null;
    } else if (path === "/leaderboard") {
      cleanup = renderLeaderboard(mainContent) || null;
    } else if (path === "/how-it-works") {
      cleanup = renderHowItWorks(mainContent) || null;
    } else if (path === "/privacy") {
      cleanup = renderPrivacy(mainContent) || null;
    } else if (path === "/terms") {
      cleanup = renderTerms(mainContent) || null;
    } else {
      renderNotFound(mainContent);
    }

    window.scrollTo(0, 0);
  }

  // Intercept relative client-side navigation clicks
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const target = new URL(href, location.href);
    if (!["http:", "https:"].includes(target.protocol) || target.origin !== location.origin) return;

    e.preventDefault();
    if (window.location.href !== target.href) {
      window.history.pushState({}, "", target.href);
      handleRoute();
    }
  });

  window.addEventListener("popstate", handleRoute);
  handleRoute();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp, { once: true });
} else {
  initApp();
}
