export function renderTerms(container) {
  container.innerHTML = `
    <div class="doc-view legal-view">
      <div class="doc-header">
        <a href="/" class="btn-back-nav" aria-label="Back to the home page">
          <span aria-hidden="true">←</span>
          <span>Back to Home</span>
        </a>
        <h1 class="doc-title">Terms of Service</h1>
        <p class="doc-lede">Nimgavel is a community auction floor, not a marketplace operator. Read this before bidding or hosting.</p>
      </div>

      <section class="doc-section">
        <h2>What Nimgavel is</h2>
        <ul class="doc-list">
          <li>Nimgavel runs live auctions and records their outcome, including on-chain settlement receipts.</li>
          <li>Payments are direct, wallet to wallet, between the winning bidder and the host. Nimgavel never holds, routes, or refunds funds.</li>
          <li>Bids are free. Listings are free. There are no fees.</li>
        </ul>
      </section>

      <section class="doc-section">
        <h2>What Nimgavel is not</h2>
        <ul class="doc-list">
          <li>Not an escrow service. Once the gavel falls, the payment is entirely between winner and host.</li>
          <li>Not a dispute resolution body. If a lot is not as described, that is between the bidders and the host.</li>
          <li>Not a guarantor. A verified receipt proves an on-chain payment matched the auction. It does not certify the item itself.</li>
          <li>Not a background checker. Hosts are anonymous paddles, exactly like bidders.</li>
        </ul>
      </section>

      <section class="doc-section">
        <h2>Auction rules</h2>
        <ul class="doc-list">
          <li>Each bid must be at least one minimum step above the current high bid.</li>
          <li>Bids in the final 30 seconds extend the auction by 30 seconds.</li>
          <li>The highest qualifying bid at close wins. If no bid meets the reserve, the lot passes.</li>
          <li>The host cannot bid in their own room.</li>
          <li>Abuse (rate-limit evasion, spam paddles, manipulation) gets paddles removed.</li>
        </ul>
      </section>

      <section class="doc-section">
        <h2>Settlement verification</h2>
        <p>
          Receipts are marked verified only when the recorded transaction pays the exact host address and amount on the Nimiq blockchain. A rejected receipt means the check failed; it stays on the public ledger as an audit record. Verification is a payment check, not an endorsement of the lot.
        </p>
      </section>

      <section class="doc-section">
        <h2>Liability</h2>
        <p>
          The service is provided as is, without warranties. You are responsible for what you bid, what you list, and what you pay. Nothing here is financial or legal advice.
        </p>
      </section>
    </div>
  `;
}
