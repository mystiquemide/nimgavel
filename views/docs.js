// Full product and developer documentation for Nimgavel.
export function renderDocs(container) {
  container.innerHTML = `
    <div class="doc-view docs-view">
      <div class="doc-header">
        <a href="/" class="btn-back-nav" aria-label="Back to the home page">
          <span aria-hidden="true">←</span>
          <span>Back to Home</span>
        </a>
        <p class="docs-eyebrow">NIMGAVEL DOCUMENTATION</p>
        <h1 class="doc-title">Documentation</h1>
        <p class="doc-lede">
          Product mechanics, Nimiq Pay integration, architecture, settlement verification,
          public interfaces, trust boundaries, and troubleshooting for Nimgavel.
        </p>
        <div class="docs-quick-links" aria-label="Documentation sections">
          <a href="#quick-start">Quick start</a>
          <a href="#auction-lifecycle">Auction lifecycle</a>
          <a href="#nimiq-pay">Nimiq Pay</a>
          <a href="#architecture">Architecture</a>
          <a href="#api">API</a>
          <a href="#settlement">Settlement</a>
          <a href="#trust">Trust boundary</a>
          <a href="#troubleshooting">Troubleshooting</a>
        </div>
      </div>

      <section class="doc-section docs-callout" id="overview" aria-labelledby="docs-overview">
        <h2 id="docs-overview">What is Nimgavel?</h2>
        <p>
          Nimgavel is the live community auction house on Nimiq. It gives a community auction one
          authoritative room for bid ordering, deadlines, winner selection, and payment verification.
        </p>
        <div class="docs-flow" aria-label="Nimgavel auction flow">
          <span>Create</span><b>→</b><span>Bid</span><b>→</b><span>Soft close</span><b>→</b><span>Sell</span><b>→</b><span>Pay</span><b>→</b><span>Verify</span>
        </div>
        <p>
          Nimgavel does not custody funds and does not use a custom smart contract. The winner pays the
          host directly in native NIM through Nimiq Pay, and Nimgavel independently checks the resulting
          settlement against Nimiq mainnet.
        </p>
      </section>

      <section class="doc-section" id="quick-start" aria-labelledby="docs-quick-start">
        <h2 id="docs-quick-start">Quick start</h2>
        <ol class="doc-steps">
          <li><strong>Browse.</strong> Open the <a href="/lobby">Auction Floor</a> in any modern browser.</li>
          <li><strong>Use Nimiq Pay to participate.</strong> Hosting and authenticated bidding are handled inside Nimiq Pay.</li>
          <li><strong>Host a lot.</strong> Add the title, photo, description, starting bid, minimum increment, duration, and fulfillment terms. Review the preview and sign the host challenge.</li>
          <li><strong>Join as a bidder.</strong> Open the room in Nimiq Pay. Your device receives a pseudonymous paddle.</li>
          <li><strong>Acknowledge fulfillment terms.</strong> Read the seller's delivery or collection terms before your first bid.</li>
          <li><strong>Bid.</strong> Your first bid asks for wallet authorization. Nimgavel checks the NIM accounts shared by Nimiq Pay before accepting the bid.</li>
          <li><strong>Win and settle.</strong> When the gavel falls, only the winner receives the payment action. Payment goes directly to the host.</li>
          <li><strong>Verify.</strong> Nimgavel validates the matching NIM transaction before marking settlement verified.</li>
        </ol>
        <p class="doc-store-row">
          Useful links:
          <a href="/how-it-works">First-time guide</a>
          <a href="https://www.nimiq.com/nimiq-pay" target="_blank" rel="noopener noreferrer">Nimiq Pay ↗</a>
          <a href="https://nimiq.watch" target="_blank" rel="noopener noreferrer">Nimiq Watch ↗</a>
        </p>
      </section>

      <section class="doc-section" id="auction-lifecycle" aria-labelledby="docs-lifecycle">
        <h2 id="docs-lifecycle">Auction lifecycle</h2>
        <div class="docs-state-row" aria-label="Auction states">
          <code>created</code><b>→</b><code>live</code><b>→</b><code>going_once</code><b>→</b><code>going_twice</code><b>→</b><code>sold / passed</code>
        </div>
        <ul class="doc-list">
          <li><strong>Created.</strong> The lot exists, but bidding has not started. The host must explicitly start the room.</li>
          <li><strong>Live.</strong> Valid paddles can bid in real time. The server is authoritative for amount, leader, order, and deadline.</li>
          <li><strong>Soft close.</strong> A valid bid during the final 30 seconds resets the remaining time to 30 seconds.</li>
          <li><strong>Sold.</strong> The highest valid bid is locked when the auction closes.</li>
          <li><strong>Passed.</strong> A lot with no qualifying bids closes automatically without a winner.</li>
        </ul>
        <p>
          Bidders can withdraw eligible bids and hosts can remove invalid or mistaken bids with a public
          reason. The original bid stays in the audit trail. A winning bid is locked after close.
        </p>
      </section>

      <section class="doc-section" id="nimiq-pay" aria-labelledby="docs-nimiq-pay">
        <h2 id="docs-nimiq-pay">How Nimiq Pay is used</h2>
        <div class="docs-table-wrap">
          <table class="docs-table">
            <thead>
              <tr><th>Scene</th><th>Nimiq Pay role</th></tr>
            </thead>
            <tbody>
              <tr><td>Host signature</td><td>Signs the authorization used to create and later control the host's lot.</td></tr>
              <tr><td>Paddle identity</td><td>Provides the device context used to issue a pseudonymous auction paddle.</td></tr>
              <tr><td>Bidder access</td><td>Shares the bounded NIM account set and signs the first-bid authorization.</td></tr>
              <tr><td>Balance gate</td><td>Nimgavel checks shared NIM accounts individually against Nimiq mainnet. At least one account must cover the proposed bid.</td></tr>
              <tr><td>Winner payment</td><td>Sends the exact winning amount directly from the winner to the host in native NIM.</td></tr>
              <tr><td>Settlement proof</td><td>Produces the referenced transaction that Nimgavel verifies against Nimiq mainnet.</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          Nimgavel never receives a private key. Bid-time balances are checked but not locked, so the balance
          gate prevents obvious zero-balance price inflation at bid time without pretending to be escrow.
        </p>
      </section>

      <section class="doc-section" id="architecture" aria-labelledby="docs-architecture">
        <h2 id="docs-architecture">Architecture</h2>
        <div class="docs-architecture-grid">
          <article class="docs-mini-card">
            <span>Frontend</span>
            <strong>Vanilla JavaScript + Vite</strong>
            <p>Responsive SPA used in normal browsers and the Nimiq Pay webview.</p>
          </article>
          <article class="docs-mini-card">
            <span>Runtime</span>
            <strong>Cloudflare Workers</strong>
            <p>REST validation, authorization, public APIs, settlement verification, and asset routing.</p>
          </article>
          <article class="docs-mini-card">
            <span>Live rooms</span>
            <strong>Durable Objects + WebSockets</strong>
            <p>One authoritative room per lot for bid order, leader state, deadlines, and close alarms.</p>
          </article>
          <article class="docs-mini-card">
            <span>Persistence</span>
            <strong>Cloudflare D1</strong>
            <p>Lots, paddles, archived bids, removals, challenges, and settlement receipts.</p>
          </article>
          <article class="docs-mini-card">
            <span>Wallet</span>
            <strong>@nimiq/mini-app-sdk</strong>
            <p>Nimiq Pay provider access, device context, signatures, and transaction requests.</p>
          </article>
          <article class="docs-mini-card">
            <span>Chain verification</span>
            <strong>Nimiq JSON-RPC + @nimiq/core</strong>
            <p>Balance reads, transaction parsing, network checks, confirmations, and settlement evidence.</p>
          </article>
        </div>
        <div class="docs-code-block" role="figure" aria-label="Architecture request flow">
          <code>Browser / Nimiq Pay
        ↓
Nimgavel SPA
        ↓
Cloudflare Worker API ─────→ Nimiq JSON-RPC
        ↓
D1 + AuctionRoom Durable Object
        ↕
Live WebSocket clients</code>
        </div>
      </section>

      <section class="doc-section" id="api" aria-labelledby="docs-api">
        <h2 id="docs-api">Public and app API</h2>
        <p>
          Nimgavel uses same-origin JSON endpoints. Some endpoints are public, while bidding, host control,
          and settlement actions require short-lived paddle or host authorization.
        </p>
        <div class="docs-table-wrap">
          <table class="docs-table">
            <thead>
              <tr><th>Method</th><th>Path</th><th>Purpose</th></tr>
            </thead>
            <tbody>
              <tr><td>GET</td><td><code>/health</code></td><td>Database, network, and deployed-version health.</td></tr>
              <tr><td>GET</td><td><code>/api/lots</code></td><td>Bounded upcoming, live, and result lists.</td></tr>
              <tr><td>GET</td><td><code>/api/lots/:id</code></td><td>Public lot, archived active bids, and removal history.</td></tr>
              <tr><td>GET</td><td><code>/api/rooms/:id/state</code></td><td>Authoritative public room snapshot.</td></tr>
              <tr><td>GET</td><td><code>/api/leaderboard</code></td><td>Archived activity ranked by wins and bid count.</td></tr>
              <tr><td>GET</td><td><code>/api/paddle?deviceId=…</code></td><td>Issue or recover a device-scoped paddle and token.</td></tr>
              <tr><td>POST</td><td><code>/api/host/challenge</code></td><td>Create a one-time host signature challenge.</td></tr>
              <tr><td>POST</td><td><code>/api/lots</code></td><td>Create a signed auction lot.</td></tr>
              <tr><td>POST</td><td><code>/api/lots/:id/start</code></td><td>Start a created room using host authorization.</td></tr>
              <tr><td>POST</td><td><code>/api/lots/:id/authorize</code></td><td>Exchange a signed lot challenge for fresh host control.</td></tr>
              <tr><td>POST</td><td><code>/api/lots/:id/settle</code></td><td>Record the winner's transaction hash.</td></tr>
              <tr><td>POST</td><td><code>/api/lots/:id/verify</code></td><td>Recheck the recorded settlement transaction.</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          WebSocket clients connect to <code>/ws/:lotId</code>. Spectators receive state immediately.
          Authenticated bidders send a <code>join</code> frame with their paddle token before bid frames are accepted.
        </p>
      </section>

      <section class="doc-section" id="settlement" aria-labelledby="docs-settlement">
        <h2 id="docs-settlement">Settlement verification</h2>
        <p>
          The winning payment carries an auction-specific reference:
          <code>Nimgavel:&lt;lotId&gt;</code>.
        </p>
        <p>Nimgavel does not accept a transaction hash on faith. It checks:</p>
        <ul class="doc-list">
          <li>the configured Nimiq network</li>
          <li>the exact transaction hash</li>
          <li>the host recipient address</li>
          <li>the exact winning amount</li>
          <li>the auction reference</li>
          <li>successful execution</li>
          <li>the required confirmation state</li>
        </ul>
        <p>
          Receipt states are <code>pending</code>, <code>verified</code>, or <code>rejected</code>.
          Pending receipts are rechecked. Verified receipts can be inspected independently on Nimiq Watch.
        </p>
      </section>

      <section class="doc-section" id="trust" aria-labelledby="docs-trust">
        <h2 id="docs-trust">Trust boundary</h2>
        <div class="docs-trust-grid">
          <article class="docs-mini-card docs-good">
            <span>Nimgavel establishes</span>
            <ul class="doc-list">
              <li>authoritative auction state</li>
              <li>bid and removal history</li>
              <li>winning paddle</li>
              <li>published fulfillment terms</li>
              <li>session-scoped bidder acknowledgement</li>
              <li>bid-time NIM balance access</li>
              <li>matching NIM settlement evidence</li>
            </ul>
          </article>
          <article class="docs-mini-card docs-boundary">
            <span>Nimgavel does not guarantee</span>
            <ul class="doc-list">
              <li>custody or locked bidder funds</li>
              <li>physical item authenticity</li>
              <li>physical delivery</li>
              <li>escrow or refunds</li>
              <li>dispute arbitration</li>
              <li>real-world identity of bidder or seller</li>
            </ul>
          </article>
        </div>
        <p>
          A verified settlement proves that the matching NIM transfer occurred under the configured RPC trust
          assumption. It does not prove that a seller later delivered an item.
        </p>
      </section>

      <section class="doc-section" id="troubleshooting" aria-labelledby="docs-troubleshooting">
        <h2 id="docs-troubleshooting">Troubleshooting</h2>
        <ul class="doc-list">
          <li><strong>Nimgavel says to open Nimiq Pay even though you are already inside it.</strong> Update Nimiq Pay, reload the room, and use the retry action. Nimgavel also listens for delayed provider injection.</li>
          <li><strong>The wallet appears funded but a bid says 0 NIM.</strong> Confirm the funded NIM account is shared by Nimiq Pay and retry. Current bidder proofs bind the account set and check each shared account individually.</li>
          <li><strong>A fresh room says it has not started.</strong> The host created the lot but has not pressed Start. The configured duration begins when the host starts the room.</li>
          <li><strong>The timer reached zero.</strong> Client bid controls are disabled while the server finalizes the authoritative result.</li>
          <li><strong>Payment was cancelled.</strong> Explicit cancellation returns the winner to the settlement action. Do not resend blindly if the wallet outcome is uncertain; allow recovery/verification to determine whether a transaction exists.</li>
          <li><strong>A payment remains pending.</strong> Nimgavel may still be waiting for complete chain evidence or confirmations. Pending receipts are rechecked automatically.</li>
        </ul>
      </section>

      <section class="doc-section" id="resources" aria-labelledby="docs-resources">
        <h2 id="docs-resources">Resources</h2>
        <div class="docs-resource-grid">
          <a href="/how-it-works" class="docs-resource-card"><strong>How It Works</strong><span>Beginner-friendly auction and wallet guide →</span></a>
          <a href="/results" class="docs-resource-card"><strong>Results Ledger</strong><span>Completed auctions and settlement states →</span></a>
          <a href="/privacy" class="docs-resource-card"><strong>Privacy</strong><span>What Nimgavel stores and does not store →</span></a>
          <a href="/terms" class="docs-resource-card"><strong>Terms</strong><span>Auction rules and responsibilities →</span></a>
          <a href="https://github.com/mystiquemide/nimgavel" target="_blank" rel="noopener noreferrer" class="docs-resource-card"><strong>Source</strong><span>Repository and deeper architecture docs ↗</span></a>
          <a href="https://nimiq.watch" target="_blank" rel="noopener noreferrer" class="docs-resource-card"><strong>Nimiq Watch</strong><span>Inspect Nimiq transactions independently ↗</span></a>
        </div>
      </section>
    </div>
  `;
}
