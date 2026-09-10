# Nimgavel

Live community auctions inside [Nimiq Pay](https://www.nimiq.com/nimiq-pay). A host lists an item, bidders raise paddles, and the winner pays the host directly in NIM.

[Open the app](https://nimgavel.artistic-chip.workers.dev) · [How it works](https://nimgavel.artistic-chip.workers.dev/how-it-works) · [Results](https://nimgavel.artistic-chip.workers.dev/results)

## Try it

Browse the auction floor in any browser. To host or bid, use **Open in Nimiq Pay** on your phone, or scan the room's QR code. Allow the wallet and paddle requests, then enter a room.

Hosting signs a one-time wallet challenge. Bids are free. Each bid during the final 30 seconds resets the remaining time to 30 seconds. When bidding ends, only the winning paddle gets the payment action.

Nimiq Pay handles signing and transfers without exposing private keys to the app. Payments include the lot's reference. The server checks that reference, transaction hash, network, recipient, amount, execution and 60 confirmations before showing a verified receipt. A recorded hash alone is not proof of payment.

## Implementation

- Vanilla JavaScript and Vite frontend, with wallet, spectator, loading and recovery states.
- Cloudflare Worker API and one Durable Object per auction for ordered bids, WebSockets and close alarms.
- D1 stores lots, paddles, bid history and receipt verification state.
- `@nimiq/mini-app-sdk` supplies wallet accounts, message signing, device-scoped paddles and NIM transfers. `@nimiq/core` parses wallet transaction results.
- A scheduled Worker rechecks pending payments every ten minutes.

See [architecture and API](docs/ARCHITECTURE.md) and [deployment](docs/DEPLOY.md).

## Run locally

Requires Node.js 22.20 or newer. Create `.dev.vars` with a random `NIMGAVEL_SECRET` of at least 32 characters. Keep this file private. Set `NIMIQ_RPC_URL=http://127.0.0.1:8899` for the test suite's local RPC fixture. The default network is testnet.

```sh
npm ci
npm run build:web
npm run db:migrate:local
npm run dev:worker -- --local --test-scheduled
```

Open `http://localhost:8799`. For frontend hot reload, run `npm run dev:web` in another terminal. The Vite proxy forwards the API and WebSockets to port 8799.

## Verification

With the local Worker running:

```sh
npm test
npm run build:web
npm run worker:check
npm audit
```

The tests exercise signed hosting, authenticated bidding, minimum increments, soft closes, settlement checks, transaction parsing and failure recovery. [Security regression tests](test/security-regressions.test.js) cover authorization bypasses, expired auctions, D1 outages and invalid payment evidence. RPC fixtures are simulated chain responses, not mainnet payment proof.

## Limitations

- No escrow, custody, delivery guarantee or payment enforcement. Confirm the item and host before paying. Nimgavel charges no platform fee, but network fees may apply.
- Paddles identify devices, not unique people or verified wallets. Hosts can use other devices. Auction activity and host addresses are publicly linkable.
- Verification trusts the configured RPC provider. The live results currently provide no independently confirmed successful auction payment example. Native-wallet compatibility and listing provenance must be checked before relying on a listing.
- Host-control tokens expire after 24 hours. Start a lot before expiry and keep its browser storage. Lost or expired controls currently have no recovery flow.
- Lists are bounded to the most recent 50 entries per category. The leaderboard counts archived bids and winning bids, not unique users or paid volume.
- Local demo scripts create explicitly synthetic fixtures and refuse non-loopback targets. Demo activity does not establish real usage.

## License

[MIT](LICENSE). Third-party libraries and photography retain their own licenses. [Image credits](docs/CREDITS.md).
