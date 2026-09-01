# Nimgavel — Architecture

## 1. Topology

```
Nimiq Pay WebView (mobile)
  └─ Vite SPA (vanilla JS, dist/)
       ├─ @nimiq/mini-app-sdk  (wallet: accounts, sign, device id, NIM tx)
       └─ WebSocket + fetch
            │
Cloudflare Worker (worker/index.js)
  ├─ REST /api/*  (lots, paddles, settle)
  ├─ WS   /ws/:lotId  → forwarded to Durable Object
  ├─ D1   (lots, bids, paddles, results)
  └─ Durable Object: AuctionRoom (one per live lot)
        ├─ authoritative bid state machine
        ├─ WebSocket fan-out to all bidders
        └─ alarms (phase transitions, close, persistence)

Plain browser (no Nimiq Pay)
  └─ same SPA in spectate mode: live room read-only + "Open in Nimiq Pay" CTA
```

Two entry URLs for the app: standard HTTPS (workers.dev or custom domain) and the Nimiq Pay deeplink `https://nimpay.app/miniapps/open/<app-url>`.

## 2. Components

### Frontend (Vite + vanilla JS modules)
- `lib/nimiq.js`: SDK wrapper. `init()`, `listAccounts()`, `requestDeviceIdentifier()`, `sign()`, `sendBasicTransaction()`. Detects absence of provider (plain browser) and switches to spectate mode.
- `lib/ws.js`: reconnecting WebSocket client with exponential backoff, server-time offset sync.
- Views: lobby, room, host, settle. Router in `main.js`.
- Design tokens and components per DESIGN.md.

### Worker (stateless router)
- REST endpoints (table in section 5).
- WS upgrade: `env.ROOM.idFromName(lotId)` then `stub.fetch(request)`.
- Issues paddle tokens (HMAC).
- Persists lot results from DO to D1 (DO calls back via internal fetch on close, or worker polls; chosen: DO writes to D1 directly through its env binding).

### AuctionRoom Durable Object
Single-writer authority for one lot. All bid validation and ordering happen here. No race conditions by construction.

**In-memory state:** lotId, config (startPriceLunas, minIncrementLunas, durationSec, hostPaddle, hostAddress), phase, endsAt (ms epoch), currentBidLunas, leadingPaddle, bids ring buffer (last 100), connections map.

**Storage (DO SQLite) for restart safety:** latest snapshot of the above, written on every state change. On DO restart mid-auction, state restores and alarm re-arms.

### D1 (durable records)
- `lots`: id TEXT PK, title, description, image_url, host_paddle INT, host_address TEXT, start_price_lunas INTEGER, min_increment_lunas INTEGER, duration_sec INT, status TEXT (created|live|sold|passed|settled), scheduled_at, started_at, ended_at, winning_paddle INT NULL, winning_bid_lunas INTEGER NULL, tx_hash TEXT NULL, created_at, settle_verified INT DEFAULT 0, settle_checked_at INT NULL, settle_failure TEXT NULL
- `bids`: id INTEGER PK AUTOINCREMENT, lot_id TEXT, paddle INT, amount_lunas INTEGER, created_at
- `paddles`: paddle INT PK, device_hash TEXT UNIQUE, alias TEXT, created_at, last_seen_at
- `host_challenges`: id TEXT PK, host_address TEXT, message TEXT, issued_at INTEGER, expires_at INTEGER, used_at INTEGER NULL
- `lot_results` (view over lots where status in sold|settled) for the archive and results ticker.

## 3. Auction state machine

```
created → live → going_once → going_twice → sold → settled
                     ↑  any bid in final 30s resets endsAt to now+30s
                 (no bids at expiry) → passed
```

Phase derives from remaining time, so a soft-close extension naturally rewinds the phase:

| Phase | Condition | Broadcast |
|---|---|---|
| live | remaining > 30s | state |
| going_once | 30s >= remaining > 15s | phase |
| going_twice | 15s >= remaining > 0 | phase |
| sold / passed | remaining <= 0 (alarm fires) | sold/passed |

- Host starts the room: `startsAt = now`, `endsAt = now + durationSec`.
- Bid validity (checked in DO): phase in live|going_once|going_twice, paddle != host_paddle, amount_lunas >= currentBid + minIncrement (or start price for first bid), per-paddle rate limit 1 bid per 500ms, amount sane (integer, <= 1e12 lunas).
- Valid bid when remaining <= 30s: `endsAt = now + 30000`.
- Alarms: DO sets an alarm at each phase boundary and at endsAt. Clients render the countdown locally from `endsAt` and `serverNow` (clock offset), so no per-second server traffic.

## 4. WebSocket protocol (client ↔ DO)

Client → server:
| type | fields | notes |
|---|---|---|
| join | paddleToken | verified by HMAC (section 7) |
| bid | amountLunas | bound to the joined paddle |

Server → client:
| type | fields |
|---|---|
| state | phase, endsAt, serverNow, currentBidLunas, leadingPaddle, lot summary, connections |
| bid | paddle, alias, amountLunas, ts |
| phase | phase, endsAt, serverNow |
| sold | winningPaddle, alias, amountLunas, hostAddress |
| passed | reason |
| error | code, message |

Error codes: `outbid_increment`, `not_live`, `host_cannot_bid`, `rate_limited`, `invalid_token`.

## 5. REST API (Worker)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | /api/paddle?deviceId=... | get or create paddle (number + alias + token) | device id |
| POST | /api/host/challenge | get sign challenge for host address | none |
| POST | /api/lots | create lot | signed host message |
| GET | /api/lots | list: upcoming, live, recent results | none |
| GET | /api/lots/:id | lot detail + bid history | none |
| POST | /api/lots/:id/start | start auction (host token) | host token |
| POST | /api/lots/:id/settle | record tx hash after winner pays | winner paddle token |
| POST | /api/lots/:id/verify | on-chain payment check (winner paddle token) | winner paddle token |
| GET | /api/rooms/:id/state | REST fallback for spectate polling | none |

All JSON. Same-origin CORS policy with localhost dev exceptions (nimquest pattern). A scheduled handler (cron, every 10 minutes) re-checks settlements still marked `pending`.

## 6. Settlement flow

1. DO closes auction → broadcasts `sold`, writes result to D1 (status sold).
2. Winner UI shows amount due and Pay button → `nimiq.sendBasicTransaction({ recipient: hostAddress, value: lunas })` → native Nimiq Pay dialog. The wallet returns the serialized transaction; the client derives the tx hash locally (blake2b-256 over the content serialization, `lib/tx-hash.js`, verified against @nimiq/core).
3. On tx result, app POSTs `/settle` with tx hash. Worker stores it, lot status `settled`, settlement state `pending`.
4. Verification (`worker/settle-verify.js`): the worker queries a public Nimiq JSON-RPC node (`getTransactionByHash`, mainnet `rpc.nimiqwatch.com` / testnet `rpc.testnet.nimiqwatch.com`, overridable via `NIMIQ_RPC_URL`) and marks the settlement `verified` only when the on-chain tx executed and paid exactly `winning_bid_lunas` to the host address. Any mismatch (wrong recipient, wrong amount, failed execution) marks it `rejected` with the reason. Unknown tx stays `pending`.
5. Receipts show the settlement state (`pending` / `verified` / `rejected`) with the tx hash + explorer link. A cron pass every 10 minutes re-checks pending settlements so receipts converge without user action.
No escrow, no custody. The app never touches keys or funds.

## 7. Identity and auth

**Paddle (bidder):** client calls `requestDeviceIdentifier()` (native consent on first use), sends the id to `/api/paddle`. Worker stores `sha256(deviceId)` in D1, assigns the next sequential paddle number, generates a stable alias from the hash (adjective + animal). Issues `paddleToken = HMAC-SHA256(workerSecret, paddle + deviceHash + exp)` (24h). The DO verifies tokens on join. One connection per paddle per room.

**Host:** payout address is the identity anchor. Lot creation: worker returns a challenge, host signs with `nimiq.sign()` using the wallet that owns the payout address, worker verifies signature against the address (same challenge-store pattern NimQuest proved). Host token issued for lot control (start).

The Worker signs paddle and host-control tokens with the `NIMGAVEL_SECRET` secret. Tokens are stateless and expire after 24 hours. Host challenges are one-time D1 records and expire after five minutes.

Device ids are pseudonymous and client-attested only; acceptable threat trade for a community app, mitigated by rate limits and server-side paddle assignment. Host control is wallet-grade because money flows to that address.

## 8. Security notes

- No secrets in the client bundle; HMAC secret and D1 live in Worker env only.
- All money movement happens in native Nimiq Pay dialogs. The app only constructs requests.
- Input validation at worker and DO: string length caps, https-only image URLs, integer lunas with bounds.
- Rate limits: WS message cap per connection, 1 bid per 500ms per paddle, paddle creation throttle per IP.
- User cancellation (`PermissionDeniedError`) treated as a normal outcome everywhere with clear copy, never an error state.
- DO is the only writer of auction state; bid order is total and deterministic.

## 9. ADRs

1. **Durable Object per room** over pub/sub + DB polling: single-writer correctness, native WebSockets, alarms for deterministic close. Cloudflare-native, same platform NimQuest proved.
2. **Direct winner-pays-host** over escrow: no custody, no smart contract risk, honest framing. Escrow can arrive later without breaking the loop.
3. **Pseudonymous paddles** over wallet-address bidding: matches the auction-house fantasy, lower friction, privacy default. Wallet appears only where money moves.
4. **Vanilla JS** over React: WebView performance, tiny bundle, NimQuest-proven toolchain.
5. **Spectate mode** in plain browsers: dev + QA automation surface, plus marketing reach for anyone opening the link outside Nimiq Pay.

## 10. Dev, test, deploy

- Local: `wrangler dev` serves worker + DO + D1 locally; Vite dev proxy for the frontend. Browser QA runs in spectate mode; scripted WS clients (Node) drive full auction lifecycles including soft-close wars.
- Stress gate: 2 scripted paddles, 50+ bids, extension storms, restart-DO-mid-auction. Auction must close correctly with exact winning bid.
- Deploy: Workers with assets (`dist`), `run_worker_first` for `/api/*` and `/ws/*`, D1 binding, DO binding with SQLite class migration. HTTPS via workers.dev subdomain; custom domain optional later.
- Health: `GET /health` returns build id + D1 check (nimquest pattern).

## 11. Metrics (D1-derived)

- lots created, sold rate, median final price, distinct paddles per lot, bids per lot, soft-close extensions per lot, settlements recorded with verified tx. Surfaced in the results archive; no external analytics service.
