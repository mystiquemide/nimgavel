// How an auction runs: the in-app documentation page. Linked from the nav
// ("How It Works") so the mechanics are one tap from anywhere.
export function renderHowItWorks(container) {
  container.innerHTML = `
    <div class="doc-view">
      <div class="doc-header">
        <a href="/lobby" class="btn-back-nav" aria-label="Return to Auction Floor">
          <span aria-hidden="true">←</span>
          <span>Back to Floor</span>
        </a>
        <h1 class="doc-title">How a Nimgavel auction runs</h1>
        <p class="doc-lede">
          Browse on the web. Bid and host inside Nimiq Pay. Three rules, zero fees, and every settlement checked on-chain.
        </p>
      </div>

      <section class="doc-section" aria-labelledby="doc-rules">
        <h2 id="doc-rules">The three rules</h2>
        <div class="rules-grid">
          <article class="rule-card rule-card-white">
            <span class="rule-step-badge">Step 01</span>
            <h3 class="rule-card-title">Pick up your paddle</h3>
            <p class="rule-card-text">
              Open Nimgavel inside Nimiq Pay. Your device receives an anonymous paddle number and animal alias, like Paddle #42 Quiet Heron. No account, no password.
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
            <strong>Winner pays host.</strong> The winner sends the exact amount straight from their wallet to the host address. No escrow, no platform account, no fee.
          </li>
          <li>
            <strong>Verification.</strong> Nimgavel checks the transaction on the Nimiq blockchain: right recipient, right amount, executed. The receipt is stamped verified, rejected, or pending until the chain answers. Every verdict lands in the public Results Ledger.
          </li>
        </ol>
      </section>

      <section class="doc-section" aria-labelledby="doc-wallet">
        <h2 id="doc-wallet">Why Nimiq Pay?</h2>
        <p>
          Bidding and hosting need a wallet, and Nimiq Pay is the wallet built for exactly this: fast, self-custodial NIM payments with mini apps inside. The web view stays a spectator floor on purpose; your keys never touch it.
        </p>
        <p class="doc-store-row">
          Get Nimiq Pay free:
          <a href="https://apps.apple.com/app/id6471844738" target="_blank" rel="noopener">App Store ↗</a>
          <a href="https://play.google.com/store/apps/details?id=com.nimiq.pay" target="_blank" rel="noopener">Google Play ↗</a>
        </p>
      </section>

      <section class="doc-section" aria-labelledby="doc-trust">
        <h2 id="doc-trust">What Nimgavel does not do</h2>
        <ul class="doc-list">
          <li>No escrow and no custody: payments go wallet to wallet, directly.</li>
          <li>No fees: bids are free, listings are free, settlement is free.</li>
          <li>No accounts: your paddle is tied to your device, anonymously.</li>
          <li>No trust required: every settlement receipt links to its transaction on the public Nimiq blockchain.</li>
        </ul>
      </section>
    </div>
  `;
}
