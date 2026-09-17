# Nimgavel Roadmap

Nimgavel's direction is to become a reliable live-auction tool for Nimiq communities, creators, and event organizers. The priority is a complete, trustworthy auction experience before broader marketplace features.

This roadmap describes proposed work, not shipped capabilities. Progress depends on real user feedback, repeat usage, and security verification rather than fixed delivery dates.

## Before submission

- Verify hosting, bidding, bid withdrawal, host moderation, settlement, and payment verification inside Nimiq Pay using multiple real devices.
- Test balance-backed bidding with wallets that have enough NIM and wallets that do not.
- Complete at least one genuine auction from listing through verified payment.
- Confirm that fulfillment terms are visible before bidding and again to the winner after the auction.
- Capture a successful auction payment receipt and a reproducible walkthrough.
- Confirm listing provenance. Clearly label demonstrations so users cannot mistake them for available goods.
- Confirm submission eligibility, registration, and required promotion.
- Gather genuine user feedback and organizer usage evidence. Device paddles and automated tests are not unique-wallet usage.

The strongest immediate proof is one genuine community auction completed successfully from listing through verified payment and a clearly understood fulfillment handoff.

## Near-term product priorities

| Priority | Proposed addition | Purpose and constraints |
|---|---|---|
| First | Wallet-signed host-control recovery | Let hosts regain control after losing browser storage or an expiring token. Recovery must verify ownership of the lot's host wallet. |
| Second | Cancel an unstarted auction | Prevent abandoned listings while retaining their history. Cancellation must be authorized and unavailable after bidding begins. |
| Third | Explicit unpaid-winner state | Give hosts and bidders a clear outcome when a winning bidder does not settle. Do not silently treat an unpaid lot as completed. |
| Conditional | Explicit demonstration labels | Required wherever seeded inventory appears. Demonstrations must not imply available goods, real customers, or successful live payments. |

These improvements follow verification of the deployed native-wallet payment flow. No additional dashboard is needed to establish that proof.

## Phase 1: Make repeat auctions dependable

- Add wallet-based host recovery and clearer bidder identity.
- Support draft editing and defined cancellation rules.
- Add an explicit settlement window for winners and a public unpaid outcome when settlement expires.
- Decide how a host can offer an unpaid lot to the next eligible bidder without rewriting auction history.
- Improve monitoring, backups, bounded bid storage, pagination, and native-device coverage.
- Commission an independent security review before encouraging higher-value trades.

**Measure:** payment completion, repeat hosts, bidder participation, unpaid-auction rate, and support incidents. A successful demonstration or competition result alone does not establish product demand.

## Phase 2: Fulfillment and post-auction coordination

Nimgavel currently makes hosts publish delivery terms before bidding. If real users continue using the product, extend that into a proper post-auction workflow without turning the product into a logistics company.

- Private host-winner contact exchange after a verified settlement.
- Delivery-status states such as awaiting fulfillment, shipped, ready for pickup, delivered, and digital delivery completed.
- Optional shipping references or tracking links supplied by the host.
- Winner delivery confirmation.
- Host and winner activity history tied to the auction record.
- Clear handling for digital goods, local pickup, and physical shipping.
- A lightweight issue-reporting flow for delivery disputes.
- Privacy controls so home addresses and private contact information are never exposed publicly.

**Trust boundary:** Nimgavel can record fulfillment claims and status changes, but it must not present them as proof that an item was authentic, delivered correctly, or received in the promised condition unless a future verification mechanism actually establishes that.

## Phase 3: Support community organizers

Build these capabilities when returning hosts demonstrate a need:

- Organizer pages with upcoming and completed auctions.
- Multi-lot auction events.
- Shareable schedules and opt-in reminders.
- Team controls for organizers running auctions together.
- Payment-status, fulfillment-status, and receipt exports.
- Branded event pages for recurring community auctions.

**Progress signal:** organizers return to run additional auctions and can identify which tools would remove their current operational friction.

## Phase 4: Improve transaction trust

- Clearly distinguish wallet ownership from seller reputation.
- Add stronger item-provenance fields and supporting evidence.
- Add reporting and moderation tools.
- Base reputation on meaningful completed auctions, verified settlements, and fulfillment history rather than raw bid counts.
- Detect repeated unpaid wins and other obvious abuse patterns without turning pseudonymous participation into invasive identity collection.

### Stronger bid commitment

Balance-backed bidding prevents wallets without enough NIM from inflating an auction at bid time, but funds are not locked. A bidder could still move funds before settlement.

If real usage shows this remains a meaningful problem, evaluate stronger mechanisms such as:

- a small refundable bid bond,
- a wallet-level payment commitment,
- or an escrow / HTLC-style settlement design.

Do not ship any of these without protocol feasibility work, refund and failure-state design, legal review where needed, and a dedicated security review.

## Phase 5: Test a sustainable business

Keep basic community auctions accessible. Test paid organizer tools such as branded event pages, team controls, analytics, and reporting before introducing transaction fees.

Optional escrow, delivery-linked settlement, or managed logistics should be considered only after demonstrated demand, legal review, and dedicated security work.

**Progress signal:** repeat organizers are willing to pay for a clearly defined operational benefit.

## Scope discipline

Do not add an AI auctioneer, project token, multichain support, USDT, escrow, or a full marketplace solely to increase the feature count. Each expansion must solve a demonstrated user problem and justify its security and maintenance costs.

If Nimgavel wins the competition, use that opportunity to validate the audience, strengthen security, improve the settlement-to-delivery lifecycle, and recruit repeat organizers. The next step should be a more dependable auction product, not a broad marketplace rebuild.
