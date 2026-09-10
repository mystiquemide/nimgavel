export function renderPrivacy(container) {
  container.innerHTML = `
    <div class="doc-view legal-view">
      <div class="doc-header">
        <a href="/" class="btn-back-nav" aria-label="Back to the home page">
          <span aria-hidden="true">←</span>
          <span>Back to Home</span>
        </a>
        <h1 class="doc-title">Privacy Policy</h1>
        <p class="doc-lede">Short version: we store almost nothing, and none of it identifies you.</p>
      </div>

      <section class="doc-section">
        <h2>What we store</h2>
        <ul class="doc-list">
          <li><strong>A paddle record.</strong> When you claim a paddle inside Nimiq Pay, we store a random device identifier from your wallet, the paddle number, and a generated animal alias. The device identifier never leaves our database and is not linked to your wallet address.</li>
          <li><strong>Auction data.</strong> Lots, bids, hammer prices, and settlement receipts are public by design. Anyone can see them; that is the point of a public auction ledger.</li>
          <li><strong>Host records.</strong> Hosts sign a challenge with their wallet. We store the public key and the wallet address that receives the winner payment. That information is public on the blockchain anyway.</li>
        </ul>
      </section>

      <section class="doc-section">
        <h2>What we do not do</h2>
        <ul class="doc-list">
          <li>No accounts, no email addresses, no passwords.</li>
          <li>No cookies for tracking. The site sets no tracking cookies.</li>
          <li>No analytics scripts, no third-party trackers, no advertising.</li>
          <li>No custody of funds at any point. Payments go directly from the winning wallet to the host wallet.</li>
        </ul>
      </section>

      <section class="doc-section">
        <h2>Third parties</h2>
        <ul class="doc-list">
          <li><strong>Nimiq blockchain.</strong> Settlement verification reads public blockchain data through a public Nimiq RPC node.</li>
          <li><strong>Cloudflare.</strong> The app runs on Cloudflare Workers, which processes request logs as part of normal operation.</li>
          <li><strong>Lot images.</strong> Images are loaded from whatever public https URL a host provides; loading an image reveals your IP to that image host.</li>
        </ul>
      </section>

      <section class="doc-section">
        <h2>Contact</h2>
        <p>Questions about this policy: open an issue at <a href="https://github.com/mystiquemide/nimgavel" target="_blank" rel="noopener">the public repository</a>.</p>
      </section>
    </div>
  `;
}
