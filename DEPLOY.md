# Deploying Summit to Cloudflare

Every push to the main development branch auto-deploys to Cloudflare Workers
(`.github/workflows/deploy.yml`) once the one-time setup below is done. The
app runs on Workers via the OpenNext adapter with races stored in D1
(Cloudflare's SQLite); locally and in tests it keeps using the plain SQLite
file, chosen automatically by `src/lib/storage.ts`.

## One-time setup (~10 minutes)

1. **Workers paid plan ($5/mo).** In the Cloudflare dashboard → Workers &
   Pages → Plans, enable the Workers Paid plan. Required: generating a race
   takes ~50–200ms of CPU, and the free tier caps requests at 10ms. Reads
   (people watching a race) are cheap; this only matters for creation.

2. **Create the D1 database** (needs [wrangler login] once, or do it in the
   dashboard under Storage & Databases → D1):

   ```bash
   npx wrangler login
   npx wrangler d1 create summit
   ```

   Copy the printed `database_id` into `wrangler.jsonc` (replacing
   `REPLACE_WITH_YOUR_D1_DATABASE_ID`), commit, push.

3. **Create an API token** for deploys: dashboard → My Profile → API Tokens
   → Create Token → use the **Edit Cloudflare Workers** template, and add
   the **D1: Edit** permission to it. Copy the token.

4. **Add two GitHub repo secrets** (repo → Settings → Secrets and variables
   → Actions):
   - `CLOUDFLARE_API_TOKEN` — the token from step 3
   - `CLOUDFLARE_ACCOUNT_ID` — dashboard → Workers & Pages, right sidebar
     (or `npx wrangler whoami`)

5. **Push.** The deploy workflow applies the D1 migration and ships the
   Worker. Until the secrets exist it skips with a notice, so CI stays
   green either way. First deploy gives you
   `https://summit.<your-subdomain>.workers.dev`; to put it on your own
   domain, dashboard → the `summit` Worker → Settings → Domains & Routes →
   Add custom domain (your DNS is already on Cloudflare, so it's one click).

## Manual deploy (no GitHub involved)

```bash
npm run migrate:cf     # apply D1 migrations (first time / after schema changes)
npm run deploy:cf      # build with OpenNext and deploy
```

## Local check of the Workers build

```bash
npx wrangler d1 migrations apply SUMMIT_DB --local
npm run preview:cf     # the real Worker + a local D1, at http://localhost:8787
```

## Notes

- **Recovery codes make this near risk-free**: even if the D1 database were
  lost, every race rebuilds byte-identically from its code at `/restore`.
- Timelines are stored gzipped in D1 (`timeline_gz`): the worst-case
  50-team × 24h race is ~1.9MB of JSON (a whisker under D1's 2MB row cap)
  and ~250KB compressed.
- The Node/VPS path still works unchanged (`npm run build && npm start`
  with `SUMMIT_DB_PATH` on a disk) — the storage seam picks the right
  driver by environment.
