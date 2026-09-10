# Interface conventions

The interface uses a light auction-floor layout with gold accents, green status indicators and dark text. The current CSS tokens in [`styles.css`](../styles.css) are the source of truth for colors, spacing and breakpoints.

## Structure

- The landing page explains the auction and shows the current featured lot.
- The auction floor separates active and upcoming lots.
- A room keeps the lot, leading bid, countdown, recent bids and available action together.
- Host forms pair the lot details with a clearly labeled preview.
- The results ledger distinguishes waiting, rejected and verified payments. The leaderboard shows activity, not paid volume.

## Interaction rules

- Display amounts in NIM, with integer Luna used in requests and storage. Show the exact next minimum bid before submission.
- The server owns auction outcomes and close times. Client countdowns only display the latest server deadline.
- Browsers may spectate. Nimiq Pay actions use native signing and payment prompts.
- Preserve pending payment information through reloads. Never claim that nothing was sent after an unknown wallet or API outcome.
- Loading, empty, disconnected, cancelled and rejected states must remain distinct.
- Keep keyboard focus visible, inputs labeled, status text readable without color, and mobile actions clear of safe-area insets. Honor reduced-motion preferences.

Fonts currently load from Google Fonts: Bricolage Grotesque, Inter, Roboto Mono and Reenie Beanie. Photography attribution is maintained in [image credits](CREDITS.md). Preview imagery is illustrative, not evidence that a listed item exists or is available.
