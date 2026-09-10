# Nimgavel Roadmap

Nimgavel's direction is to become a reliable live-auction tool for Nimiq communities, creators, and event organizers. The priority is a complete, trustworthy auction experience before broader marketplace features.

This roadmap describes proposed work, not shipped capabilities. Progress depends on user feedback and verification, rather than fixed delivery dates.

## Before submission

- Verify hosting, bidding, cancellation, and payment inside Nimiq Pay using two devices.
- Capture a successful auction payment receipt and a reproducible walkthrough.
- Confirm listing provenance. Clearly label demonstrations so users cannot mistake them for available goods.
- Confirm submission eligibility, registration, and required promotion.
- Gather genuine user feedback and organizer usage evidence. Device paddles and automated tests are not unique-wallet usage.

The strongest immediate proof is one genuine community auction completed successfully from listing through payment.

## Near-term product priorities

| Priority | Proposed addition | Purpose and constraints |
|---|---|---|
| First | Wallet-signed host-control recovery | Let hosts regain control after losing browser storage or an expiring token. Recovery must verify ownership of the lot's host wallet. |
| Second | Cancel an unstarted auction | Prevent abandoned listings while retaining their history. Cancellation must be authorized and unavailable after bidding begins. |
| Conditional | Explicit demonstration labels | Required wherever seeded inventory appears. Demonstrations must not imply available goods, real customers, or successful live payments. |

These improvements follow verification of the deployed native-wallet payment flow. No additional dashboard is needed to establish that proof.

## Phase 1: Make repeat auctions dependable

- Add wallet-based host recovery and clearer bidder identity.
- Support draft editing, defined cancellation rules, and explicit unpaid outcomes.
- Improve monitoring, backups, bounded bid storage, pagination, and native-device coverage.
- Commission an independent security review before encouraging higher-value trades.

**Measure:** payment completion, repeat hosts, bidder participation, and support incidents. A successful demonstration or competition result alone does not establish product demand.

## Phase 2: Support community organizers

Build these capabilities when returning hosts demonstrate a need:

- Organizer pages with upcoming and completed auctions.
- Multi-lot auction events.
- Shareable schedules and opt-in reminders.
- Payment-status and receipt exports.

**Progress signal:** organizers return to run additional auctions and can identify which tools would remove their current operational friction.

## Phase 3: Improve transaction trust

- Clearly distinguish wallet ownership from seller reputation.
- Provide item-provenance and delivery information.
- Add reporting and moderation tools.
- Base reputation on meaningful completed activity, not raw bid counts.

**Trust boundary:** payment verification must never imply that Nimgavel verified an item's authenticity or guaranteed delivery.

## Phase 4: Test a sustainable business

Keep basic community auctions accessible. Test paid organizer tools such as branded event pages, team controls, and reporting before introducing transaction fees.

Optional escrow or delivery-linked settlement should be considered only after demonstrated demand, legal review, and dedicated security work.

**Progress signal:** repeat organizers are willing to pay for a clearly defined operational benefit.

## Scope discipline

Do not add an AI auctioneer, project token, multichain support, USDT, or escrow solely to increase the feature count. Each expansion must solve a demonstrated user problem and justify its security and maintenance costs.

If Nimgavel wins the competition, use that opportunity to validate the audience, strengthen security, and recruit repeat organizers. The next step should not be a broad marketplace rebuild.
