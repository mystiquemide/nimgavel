# Nimgavel deploy runbook (T11)

Production target: Cloudflare Workers + D1 + Durable Objects, workers.dev URL.
Deploy method: Cloudflare Workers Builds (Git-connected, same as NimQuest's
`artistic-chip.workers.dev`).

## One-time setup (dashboard, ~5 minutes)

1. **Create the D1 database** (if it does not exist yet)
   - Dashboard → Storage & Databases → D1 → Create
   - Name: `nimgavel`
   - Copy the generated **database id** (format `xxxxxxxx-xxxx-...`)

2. **Fill the database id into the repo**
   - `wrangler.jsonc` → `d1_databases[0].database_id` (currently `SET_AT_DEPLOY`)
   - Commit to `main` (or edit in the GitHub web UI)

3. **Connect the Worker to Git**
   - Dashboard → Workers & Pages → Create → Worker → "Connect to Git"
   - Select the `mystiquemide/nimgavel` repo (install/authorize the Cloudflare
     GitHub app if asked), branch `main`
   - Build command: leave default (`npx wrangler deploy`)
   - The first build creates the Worker named `nimgavel`

4. **Set production secrets and vars** (Worker → Settings → Variables)
   - Secret `NIMGAVEL_SECRET`: any random 32+ char hex (`openssl rand -hex 32`)
   - Var `NIMIQ_NETWORK`: `mainnet`
   - Do NOT set `NIMIQ_RPC_URL` (the worker then uses the public mainnet RPC
     `https://rpc.nimiqwatch.com`); set it only to override

5. **Apply remote D1 migrations** (once, from any machine with wrangler
   auth, or dashboard D1 console):
   ```
   npx wrangler d1 migrations apply nimgavel --remote
   ```
   Migrations 0001-0005 create: lots, bids, paddles, host_challenges,
   settle verification columns, paddle throttle table, bids unique index.

6. **Redeploy / verify the first build is green**

## Verification (after first deploy)

```
curl https://<worker>.workers.dev/health
# expect {"ok":true,"app":"nimgavel","db":true,...}

curl https://<worker>.workers.dev/api/lots
# expect {"live":[],"upcoming":[],"results":[]}
```

Phone path: open `https://nimpay.app/miniapps/open/<workers.dev-url>` in
Nimiq Pay (T10 covers the full on-device pass).

## Notes

- Workers Builds auto-deploys every push to `main`.
- The cron trigger (`*/10 * * * *`, settle verification retry) ships in
  `wrangler.jsonc` and activates on deploy automatically.
- Durable Object migration (`0001_do_auction_room`) is declared in
  `wrangler.jsonc`; first deploy creates the namespace.
- If the workers.dev subdomain is taken, rename the Worker in the dashboard
  and use the new `<name>.<subdomain>.workers.dev` URL everywhere.
