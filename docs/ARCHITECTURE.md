# Architecture and API

## Request flow

```text
Browser / Nimiq Pay WebView
  Vite SPA: views, wallet adapter, same-origin API, WebSocket client
       |
Cloudflare Worker
  REST validation and authorization
       |                         |
  D1 records                 AuctionRoom Durable Object
  lots / paddles / bids      one per lot, persistent snapshot
  challenges / receipts     WebSockets, bid ordering, close alarms
       |
  Trusted Nimiq JSON-RPC: transaction verification
```

Nimiq Pay owns private keys, signature prompts and transaction submission. The server never signs transfers or holds funds. The app has no custom smart contracts.

## State and persistence

A lot starts as `created`. The host starts it explicitly, then the room moves through `live`, `going_once`, `going_twice` and `sold` or `passed`. A valid bid within the final 30 seconds resets the deadline to 30 seconds from that bid. The server rejects bids at or beyond the deadline even if an alarm is delayed.

The Durable Object stores the current bid, leader, deadline and bid log in its persistent snapshot. Close writes to D1 are idempotent. Finalization is marked complete only after those writes succeed, with a retry alarm left armed during persistence.

D1's `settled` status means a payment hash was recorded, not that payment was verified. The separate receipt state is `pending`, `verified` or `rejected`. Only verified receipts count toward the results page's paid volume.

## Trust boundaries

- A paddle token grants control of a device-scoped paddle for 24 hours. The device identifier is client-attested and is not proof of a unique person or wallet owner. Sharing it can expose control of that paddle.
- Hosting requires a one-time wallet signature plus authorization for the nominated host paddle. Host-control tokens bind the lot and payout address and expire after 24 hours. If initial room seeding is unavailable, the creation response still returns the saved lot and host token with `roomReady: false`; Start retries initialization.
- A public WebSocket starts as a read-only spectator. A `join` frame authenticates the paddle token and derives the alias from D1. URL identity fields have no authority. Tokens are not placed in WebSocket URLs.
- Internal room seeding and starting are reached only through the Worker's authorized REST flow. Their public `/ws` paths are blocked.
- Per-paddle cooldown uses persisted bid history; socket message counters and authorization expiry survive hibernation. Frames are capped at 4 KiB, and each room accepts at most 200 sockets. These controls do not establish Sybil resistance.
- User text is escaped before HTML insertion. Requests have a streamed 320 KiB cap; photo data URIs have a separate 300000-character limit.

## REST API

All endpoints use JSON and the same origin. Errors return `{ "error": "message" }` with a non-success status.

| Method | Path | Authorization / result |
|---|---|---|
| GET | `/health` | Public database and network health |
| GET | `/api/paddle?deviceId=...` | Device-scoped handle; returns paddle, alias and expiring token. Treat device IDs and tokens as private. |
| POST | `/api/host/challenge` | `{hostAddress}` creates an expiring one-time challenge |
| POST | `/api/lots` | Wallet signature, challenge ID, host address, host paddle and paddle token, plus lot fields |
| GET | `/api/lots?limit=50` | Independently bounded live, upcoming and results lists, at most 100 per category |
| GET | `/api/lots/:id` | Public lot and most recent 100 archived bids |
| POST | `/api/lots/:id/start` | Lot-specific host token |
| POST | `/api/lots/:id/settle` | Winner paddle token and transaction hash; idempotent for the same hash; rejected references can be corrected |
| POST | `/api/lots/:id/verify` | Winner paddle token; verifies recorded payment |
| GET | `/api/rooms/:id/state` | Public live snapshot; unknown lot returns 404 |
| GET | `/api/leaderboard` | Archived activity ranked by wins, then bid count; winning bids are not paid volume |

Lot fields are `title`, `description`, optional `imageUrl`, `startPriceLunas`, `minIncrementLunas` and `durationSec`. One NIM equals 100000 Luna. `scheduledAt` is an optional display timestamp, not an automatic start trigger.

## WebSocket protocol

Connect to `/ws/:lotId`. The initial `state` is available without a paddle. Send `{type: "join", paddleToken}` to receive `joined`. Then send `{type: "bid", amountLunas}`. The server derives identity, checks expiry, host exclusion, deadline, increment, amount bounds and cooldown.

Server frames include `state`, `joined`, `bid`, `phase`, `sold`, `passed` and `error`. Bid frames include the current `endsAt` and `serverNow`, even if the phase did not change. Reconnecting clients receive the authoritative state again. Spectators cannot submit bids.

## Payment verification

The wallet sends NIM with `Nimgavel:<lotId>` as recipient data. Wallet versions may return a transaction hash or serialized transaction; the adapter accepts a hash and otherwise uses the official core parser.

The trusted RPC result must match the submitted hash, host address, exact amount, lot reference and configured Albatross network. `executionResult` must be explicitly true. At least 60 confirmations are required, spanning a complete current Albatross batch. Unknown transactions, incomplete evidence or unavailable RPC remain pending. The ten-minute scheduler processes least-recently checked receipts first so an unknown transaction cannot permanently exclude newer receipts.

Verification proves a matching transfer under the RPC trust assumption. It does not prove the sender's real-world identity, item authenticity or delivery. A winner may pay from another wallet. See [deployment](DEPLOY.md) for the compatibility boundary with earlier receipts.
