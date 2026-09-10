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
          <a href="https://nimiq.com/pay/" target="_blank" rel="noopener noreferrer">Nimiq Pay ↗</a>
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
    if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) {
      return;
    }

    e.preventDefault();
    if (window.location.pathname !== href) {
      window.history.pushState({}, "", href);
      handleRoute();
    }
  });

  window.addEventListener("popstate", handleRoute);
  handleRoute();
}

document.addEventListener("DOMContentLoaded", initApp);
if (document.readyState === "complete" || document.readyState === "interactive") {
  initApp();
}
