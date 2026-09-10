# Deployment

Nimgavel serves its frontend and API from one Cloudflare Worker. It requires a D1 database and the SQLite-backed `AuctionRoom` Durable Object binding defined in `wrangler.jsonc`.

## Configuration

| Setting | Purpose |
|---|---|
| `NIMGAVEL_SECRET` | Required secret for paddle and host-control HMAC tokens. Generate at least 32 random characters. Use Cloudflare secrets in production and a private `.dev.vars` locally. |
| `NIMIQ_NETWORK` | `mainnet` or `testnet`. Defaults to `testnet`. Albatross network IDs are 24 and 5 respectively. |
| `NIMIQ_RPC_URL` | Optional trusted JSON-RPC endpoint. Defaults to the public Nimiq Watch endpoint for the chosen network. Never point a production deployment at a test fixture. |
| `BUILD_ID` | Optional deployment identifier returned by `/health`. Set to the deployed commit SHA for traceability. |
| `DB` | D1 binding. Replace `database_id` when deploying to your own Cloudflare account. |
| `ROOM` | Durable Object namespace binding. Provisioned by the migration in `wrangler.jsonc`. |

`PADDLE_SECRET` and `WORKER_SECRET` are legacy aliases for the signing secret. Prefer `NIMGAVEL_SECRET`. No server secret belongs in Vite variables or public assets.

## Deploy an instance

1. Install dependencies with `npm ci` and authenticate Wrangler to your own account.
2. Create a D1 database and update its ID in `wrangler.jsonc`. When using a different domain, update the WebSocket origin in `public/_headers` and the app's public URLs. Apply migrations with `npm run db:migrate:remote` only against the intended instance.
3. Set the signing secret with `npx wrangler secret put NIMGAVEL_SECRET`. Configure the network and build ID in Worker settings.
4. Run `npm run build:web`, local tests, `npm run worker:check` and `npm audit`.
5. Deploy with `npm run deploy -- --keep-vars` when the release is approved. The frontend must be built first.

For Workers Builds, use `npm run build:web` as the build command and `npx wrangler deploy --keep-vars` as the deployment command. A Git-connected deployment may publish every push to its configured branch. GitHub Actions in this repository verifies code but does not itself deploy.

## Verify the deployed instance

- `/health` returns `ok: true`, `db: true`, the intended network and build ID.
- The homepage, `/lobby`, `/host`, `/results`, `/leaderboard`, `/how-it-works`, `/privacy` and `/terms` render correctly on mobile.
- Open the app inside Nimiq Pay and test host authorization, a second device's bid, the soft close, cancellation and the payment receipt. Browser-injected wallet fixtures cannot replace this check.
- Confirm unknown room IDs return 404 and public `/ws/:id/seed` and `/ws/:id/start` requests are rejected.
- Check the ten-minute cron is active and pending receipts progress. Treat RPC failures as pending, never as proof of rejection or successful payment.

## Payment protocol changes

Current payments require `Nimgavel:<lotId>` in transaction recipient data. Earlier basic payments did not include this reference. Do not ask a user to pay an old completed transfer again merely to satisfy a new verifier. Reconcile existing receipts manually before rolling out this protocol change. Previously stored verified verdicts also need independent revalidation; updating the code does not retroactively validate them.

Release the Worker and frontend together. Existing open WebSockets must reconnect and authenticate with a `join` frame. Back up D1 before planned data migrations. A rollback must preserve compatible receipt semantics; restoring an older verifier would reopen the security gap.
