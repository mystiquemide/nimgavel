# Nimgavel deploy runbook (T11)

Production target: Cloudflare Workers + D1 + Durable Objects, workers.dev URL.
Deploy method: Cloudflare Workers Builds (Git-connected, same as NimQuest's
`artistic-chip.workers.dev`).

## Account

- Cloudflare account: **Artistic Chip** (`a4fd4657ae05bc1a629dd25ba394198b`)

## Done (2026-09-02, via MCP bindings API)

- [x] D1 database `nimgavel` created:
      id `7822a65b-8cfb-4ab8-bc5b-33da6d027999` (region EEUR)
- [x] Migrations 0001-0005 applied and verified (lots, bids, paddles,
      host_challenges, paddle_requests, settle columns, unique bid index)
- [x] `wrangler.jsonc` carries the real `database_id`

## Remaining (dashboard, ~2 minutes)

1. **Connect the Worker to Git**
   - Dashboard → Workers & Pages → Create → Worker → "Connect to Git"
   - Select `mystiquemide/nimgavel`, branch `main`
   - The first build creates the Worker `nimgavel` and deploys it

2. **Set production vars** (Worker → Settings → Variables)
   - Secret `NIMGAVEL_SECRET`: `openssl rand -hex 32` (any random 32+ chars)
   - Var `NIMIQ_NETWORK`: `mainnet`
   - Do NOT set `NIMIQ_RPC_URL` (defaults to public mainnet RPC)

## Verification (after first deploy)

```
curl https://nimgavel.<subdomain>.workers.dev/health
# expect {"ok":true,"app":"nimgavel","db":true,"network":"mainnet",...}

curl https://nimgavel.<subdomain>.workers.dev/api/lots
# expect {"live":[],"upcoming":[],"results":[]}
```

## Notes

- Workers Builds auto-deploys every push to `main`.
- The cron trigger (`*/10 * * * *`, settle verification retry) ships in
  `wrangler.jsonc` and activates on deploy automatically.
- Durable Object namespace is created by the `0001_do_auction_room`
  migration in `wrangler.jsonc` on first deploy.
- Ops scripts kept out of the repo: `scripts/cf-mcp.mjs` (MCP client) and
  `/tmp/apply-migrations.mjs` drive the Cloudflare bindings MCP server with
  local OAuth tokens.
