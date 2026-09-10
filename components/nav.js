export function renderNav(container, { activePath = "/" } = {}) {
  const isLobby = activePath === "/lobby";
  const isResults = activePath === "/results";
  const isHost = activePath === "/host";
  const isDocs = activePath === "/how-it-works";
  const isBoard = activePath === "/leaderboard";

  container.innerHTML = `
    <header class="nav-wrapper">
      <div class="shell">
        <nav class="dashed-nav" aria-label="Main Navigation">
          <div class="brand-group">
            <a href="/" class="brand-logo" aria-label="Nimgavel Home">
              <svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.5 2.5l7 7-2 2-7-7 2-2zm-2.5 4.5l-9 9 2 2 9-9-2-2zm-8 12.5h16v2h-16v-2z"/>
              </svg>
              <span>NIMGAVEL</span>
            </a>
            <span class="brand-badge">Live Community Auctions</span>
          </div>

          <ul class="nav-links">
            <li>
              <a href="/lobby" class="nav-link ${isLobby ? "active" : ""}">Auction Floor</a>
            </li>
            <li>
              <a href="/results" class="nav-link ${isResults ? "active" : ""}">Results</a>
            </li>
            <li>
              <a href="/leaderboard" class="nav-link ${isBoard ? "active" : ""}">Leaderboard</a>
            </li>
            <li>
              <a href="/how-it-works" class="nav-link ${isDocs ? "active" : ""}">How It Works</a>
            </li>
          </ul>

          <div class="nav-actions">
            ${isHost
              ? `<a href="/lobby" class="btn-primary-nav" id="nav-cta-btn">
                   <span>Enter the Floor</span>
                   <span aria-hidden="true">→</span>
                 </a>`
              : isLobby || activePath.startsWith("/room")
                ? `<a href="/host" class="btn-primary-nav" id="nav-cta-btn">
                     <span aria-hidden="true">+</span>
                     <span>Host an Auction</span>
                   </a>`
                : `<a href="/lobby" class="btn-primary-nav" id="nav-cta-btn">
                     <span>Enter the Floor</span>
                     <span aria-hidden="true">→</span>
                   </a>`
            }
            <button class="mobile-toggle" id="mobile-toggle-btn" aria-label="Toggle navigation menu" aria-expanded="false">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
          </div>
        </nav>

        <div class="mobile-menu-drawer" id="mobile-drawer" aria-hidden="true">
          <a href="/lobby" class="mobile-link">Auction Floor</a>
          <a href="/results" class="mobile-link">Past Results</a>
          <a href="/leaderboard" class="mobile-link">Leaderboard</a>
          <a href="/how-it-works" class="mobile-link">How It Works</a>
          ${isHost ? "" : `<a href="/host" class="mobile-link">Host an Auction</a>`}
        </div>
      </div>
    </header>
  `;

  const toggleBtn = container.querySelector("#mobile-toggle-btn");
  const drawer = container.querySelector("#mobile-drawer");

  if (toggleBtn && drawer) {
    toggleBtn.addEventListener("click", () => {
      const isOpen = drawer.classList.toggle("open");
      toggleBtn.setAttribute("aria-expanded", String(isOpen));
      drawer.setAttribute("aria-hidden", String(!isOpen));
    });
  }

  // Swap CTA text if opened inside Nimiq Pay webview
  if (typeof window !== "undefined" && window.nimiq) {
    const cta = container.querySelector("#nav-cta-btn span:first-child");
    if (cta && !(isLobby || activePath.startsWith("/room"))) cta.textContent = "Enter Floor";
  }
}
