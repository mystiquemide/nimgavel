export function renderNotFound(container) {
  container.innerHTML = `
    <div class="not-found-view" data-animate="scale-in">
      <div class="not-found-card">
        <div class="not-found-icon-wrap">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14.5 2.5l7 7-2 2-7-7 2-2zm-2.5 4.5l-9 9 2 2 9-9-2-2zm-8 12.5h16v2h-16v-2z"/>
          </svg>
        </div>

        <span class="not-found-badge">ROOM NOT FOUND</span>
        <h1 class="not-found-title">This auction floor does not exist.</h1>
        <p class="not-found-desc">
          The auction may have concluded, or the link may have been typed incorrectly. Let us get you back to the live community floor.
        </p>

        <div class="not-found-actions">
          <a href="/lobby" class="btn-hero-primary">
            <span>Return to the Auction Floor</span>
            <span aria-hidden="true">→</span>
          </a>
          <a href="/results" class="btn-hero-secondary">
            <span>View Recent Results</span>
          </a>
        </div>
      </div>
    </div>
  `;
}
