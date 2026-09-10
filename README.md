# Nimgavel

**Live auctions that settle in NIM. A mini app that runs inside [Nimiq Pay](https://nimiq.com/pay/).**

👉 **Live:** https://nimgavel.artistic-chip.workers.dev

Nimgavel is a wallet-native live auction room. Communities list a lot, bidders raise numbered paddles, and the winner pays the seller **directly on-chain** — no escrow, no custody, no house cut. Every payout lands on the Nimiq blockchain with a public receipt.

> Going once. Going twice. NIM.

## How it works

1. **Get your paddle** — open Nimgavel inside Nimiq Pay; your device gets a paddle number and alias
2. **Bid in the room** — one tap bids the next amount; a soft close keeps the door open for counterbids
3. **Winner pays host** — the winner pays the host directly via a native Nimiq transaction; Nimgavel verifies the payment on-chain and publishes the receipt

## Try it in two minutes

**In Nimiq Pay (full experience):** open `nimiqpay://miniapp?url=https%3A%2F%2Fnimgavel.artistic-chip.workers.dev%2F` on your phone, or tap **Open in Nimiq Pay** on the landing page.

**In any browser (spectator):** browse the live room, watch bids land in real time, and explore settled results with public transaction links.

## What's proven

| Claim | Evidence |
|---|---|
| Bid integrity | Rate limits, minimum increments, host-self-bid rejection — covered by the test suite (19/19) |
| Soft close | Bids in the final 30s extend the auction; verified in room tests |
| Crash recovery | Soak test: 105 bids, hard kill of the worker mid-auction, exact state restore, correct winner — `npm run soak` |
| Settlement verification | Winner's tx checked against a public Nimiq RPC (recipient, amount, execution); cron re-verifies pending settlements |
| Security | HMAC paddle tokens, wallet-signed host challenges, WS message caps, per-IP throttle, CSP + HSTS + frame-deny headers |

Run everything locally:

```bash
npm install
npx wrangler d1 migrations apply nimgavel --local   # local D1
npx wrangler dev --port 8799 &                      # worker (API + WS)
npm test                                            # 19 tests (needs the dev server)
```

## Architecture

This repository contains the Nimgavel backend; the live URL serves the deployed web client.

- **Worker:** Cloudflare Workers — REST API + WebSocket rooms
- **Rooms:** one Durable Object per auction (authoritative state, soft-close alarms, hibernation-safe)
- **Data:** D1 (lots, bids, paddles, settlements)
- **Settlement:** winner-pays-host direct transfer; worker verifies the tx on-chain via public Nimiq RPC ([rpc.nimiqwatch.com](https://rpc.nimiqwatch.com))

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Honest limitations

- Bidding and hosting require Nimiq Pay (the Nimiq wallet app); browsers get spectator mode
- English ascending auctions only — deterministic bids, no randomness, no pay-per-bid, no raffle
- Settlement requires the winner to pay; the app verifies but does not enforce payment
- The Nimiq Pay directory listing is pending (PR to nimiq/awesome); the `nimiqpay://` link works with a one-time confirmation for unlisted apps

## Real usage

Live auctions run on the deployment above — lots seeded via the real signed-host flow. Settled auctions appear in [the results archive](https://nimgavel.artistic-chip.workers.dev/results) with public tx hashes and on-chain verification state.

## License

[MIT](LICENSE) — © 2026 MystiqueMide
