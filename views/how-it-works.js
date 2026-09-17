// How an auction runs: the in-app documentation page. Linked from the nav
// so the mechanics and first-time setup are one tap from anywhere.
export function renderHowItWorks(container) {
  container.innerHTML = `
    <div class="doc-view">
      <div class="doc-header">
        <a href="/lobby" class="btn-back-nav" aria-label="Return to Auction Floor">
          <span aria-hidden="true">←</span>
          <span>Back to Floor</span>
        </a>
        <h1 id="doc-title" class="doc-title">How Nimgavel works</h1>
        <p class="doc-lede">
          New to Nimiq or already holding NIM, this page shows the full path from browsing a lot to paying the host.
        </p>
      </div>

      <section class="doc-section" id="new-to-nimiq" aria-labelledby="doc-new-to-nimiq">
        <h2 id="doc-new-to-nimiq">New to Nimiq? Start here</h2>
        <p>
          <strong>Nimiq</strong> is the blockchain Nimgavel settles on. <strong>NIM</strong> is its native currency. <strong>Nimiq Pay</strong> is the self-custodial wallet app Nimgavel uses for wallet access, signatures, bidding identity, and winner payments.
        </p>
        <ol class="doc-steps">
          <li>
            <strong>Browse first.</strong> You can explore the Auction Floor and completed results in a normal web browser without connecting a wallet.
          </li>
          <li>
            <strong>Install Nimiq Pay to bid or host.</strong> Download the wallet on your phone, open it, and complete its normal wallet setup before returning to Nimgavel.
          </li>
          <li>
            <strong>Hand off the page to the app.</strong> On mobile, tap <em>Open in Nimiq Pay</em>. On desktop, use the QR handoff and scan it with your phone. Nimgavel opens the same page inside Nimiq Pay.
          </li>
          <li>
            <strong>Approve your paddle.</strong> Nimiq Pay may ask for wallet or device permission. Once approved, Nimgavel gives your device a pseudonymous paddle so you can bid.
          </li>
        </ol>
        <p class="doc-store-row">
          Get Nimiq Pay free:
          <a href="https://apps.apple.com/app/id6471844738" target="_blank" rel="noopener">App Store ↗</a>
          <a href="https://play.google.com/store/apps/details?id=com.nimiq.pay" target="_blank" rel="noopener">Google Play ↗</a>
          <a href="https://www.nimiq.com" target="_blank" rel="noopener">Learn about Nimiq ↗</a>
        </p>
      </section>

      <section class="doc-section" aria-labelledby="doc-rules">
        <h2 id="doc-rules">The three rules</h2>
        <div class="rules-grid">
          <article class="rule-card rule-card-white">
            <span class="rule-step-badge">Step 01</span>
            <h3 class="rule-card-title">Pick up your paddle</h3>
            <p class="rule-card-text">
              Open Nimgavel inside Nimiq Pay. Your device receives a pseudonymous paddle number and animal alias, like Paddle #42 Quiet Heron. No account, no password.
            </p>
          </article>
          <article class="rule-card rule-card-gold">
            <span class="rule-step-badge rule-badge-primary">Step 02</span>
            <h3 class="rule-card-title">Free real-time bids</h3>
            <p class="rule-card-text">
              Raise your paddle with one tap. Any bid in the final 30 seconds adds 30 more seconds, so nobody gets sniped at the last moment.
            </p>
          </article>
          <article class="rule-card rule-card-green">
            <span class="rule-step-badge rule-badge-green">Step 03</span>
            <h3 class="rule-card-title">Settle direct on-chain</h3>
            <p class="rule-card-text">
              When the gavel drops, the winner sends NIM straight to the host wallet. Nimgavel verifies the transaction on-chain before stamping the receipt.
            </p>
          </article>
        </div>
      </section>

      <section class="doc-section" aria-labelledby="doc-lifecycle">
        <h2 id="doc-lifecycle">The life of a lot</h2>
        <ol class="doc-steps">
          <li>
            <strong>Host signs.</strong> The host describes the lot, sets a starting reserve, a minimum step, and a duration. Their Nimiq wallet signs a challenge; the lot is registered. Nothing is custodied.
          </li>
          <li>
            <strong>The room opens.</strong> Paddles join over a live connection. Every bid broadcasts to the room in real time, each one at least one minimum step above the last.
          </li>
          <li>
            <strong>The soft close.</strong> In the final 30 seconds, any new bid extends the clock by 30 seconds. The room only closes when bidding truly stops.
          </li>
          <li>
            <strong>The gavel falls.</strong> SOLD to the highest paddle, or the lot passes if nobody met the reserve.
          </li>
          <li>
            <strong>Winner pays host.</strong> The winner sends the exact amount straight from their wallet to the host address. Losing bidders pay nothing. No escrow or platform account is involved.
          </li>
          <li>
            <strong>Verification.</strong> Nimgavel checks the transaction on the Nimiq blockchain: right recipient, right amount, executed. The receipt is stamped verified, rejected, or pending until the chain answers. Every verdict lands in the public Results Ledger.
          </li>
        </ol>
      </section>

      <section class="doc-section" aria-labelledby="doc-wallet">
        <h2 id="doc-wallet">Why Nimiq Pay?</h2>
        <p>
          Bidding and hosting need a wallet, and Nimiq Pay is the wallet Nimgavel integrates with for self-custodial NIM payments and Mini App access. The plain web view stays a spectator floor on purpose; your private keys remain in the wallet app.
        </p>
        <p class="doc-store-row">
          Get Nimiq Pay free:
          <a href="https://apps.apple.com/app/id6471844738" target="_blank" rel="noopener">App Store ↗</a>
          <a href="https://play.google.com/store/apps/details?id=com.nimiq.pay" target="_blank" rel="noopener">Google Play ↗</a>
        </p>
      </section>

      <section class="doc-section" id="faq" aria-labelledby="doc-faq">
        <h2 id="doc-faq">First-time questions</h2>
        <ul class="doc-list">
          <li><strong>Do I need Nimiq Pay just to browse?</strong> No. Browsing lots, watching rooms, and checking results work in a normal browser. Bidding and hosting happen inside Nimiq Pay.</li>
          <li><strong>What is NIM?</strong> NIM is the native currency used for Nimgavel auction settlement. If you win, the wallet sends the winning amount directly to the host.</li>
          <li><strong>What can I auction?</strong> Physical or digital items that you own or are authorized to sell and can lawfully deliver to the winner. Hosts are responsible for accurate descriptions, provenance, legality, and fulfillment. Do not list illegal goods, stolen or counterfeit items, regulated weapons, controlled substances, or anything you cannot actually deliver.</li>
          <li><strong>What happens if nobody bids?</strong> When the timer reaches zero without a qualifying bid, the lot closes automatically as Passed. It does not stay live and the host does not need to take another action.</li>
          <li><strong>What if the winning bidder does not pay?</strong> Only the winner owes settlement; losing bidders never pay. Nimgavel does not lock bidder funds or force a transfer. If the winner does not pay, the auction remains publicly visible without a verified payment receipt. The bid history and settlement state stay transparent, but non-payment penalties, re-offering to the next bidder, and stronger commitment mechanisms are future work rather than protections Nimgavel claims today.</li>
          <li><strong>How do I move from the website into Nimiq Pay?</strong> On a phone, use Open in Nimiq Pay. On desktop, scan the QR code so the same Nimgavel page opens on your phone inside the wallet.</li>
          <li><strong>What if the wallet says it did not respond?</strong> Make sure Nimiq Pay is up to date, return to Nimgavel, and use Retry wallet connection. If the app was still initializing, a second attempt should not require recreating the auction or bid.</li>
          <li><strong>How do I get NIM?</strong> Check the funding and acquisition options available inside Nimiq Pay or use official Nimiq resources. Availability can vary by region and wallet version.</li>
          <li><strong>Does Nimgavel hold my money?</strong> No. The winner pays the host directly from their wallet. Nimgavel records and verifies the settlement but does not escrow the funds.</li>
        </ul>
      </section>

      <section class="doc-section" aria-labelledby="doc-trust">
        <h2 id="doc-trust">What Nimgavel does not do</h2>
        <ul class="doc-list">
          <li>No escrow and no custody: payments go wallet to wallet, directly.</li>
          <li>No platform fees: bids and listings are free. The wallet may charge a network transaction fee.</li>
          <li>No forced settlement: Nimgavel can verify a payment, but it cannot seize or lock bidder funds if a winner refuses to pay.</li>
          <li>No accounts: your paddle is tied to your device. Public auction activity can be linked across rooms.</li>
          <li>Trust boundaries: hosts are responsible for their listings and delivery. Verification relies on a public RPC node, and receipts link to the transaction for independent inspection.</li>
        </ul>
      </section>
    </div>
  `;
}
