# Deploying Summit to Cloudflare — free tier

**The whole thing fits the FREE Workers plan.** Under the chunk protocol the
server never generates or parses a race: the creator's browser generates the
timeline from a server-committed seed and uploads it pre-sliced, and the
Worker only commits seeds, stores chunk strings, and serves them by clock
arithmetic — all well inside the free tier's ~10ms CPU budget. The built
Worker is ~1.0 MB gzipped, comfortably under the free plan's 3 MB limit.

There is **no migration step**: the Worker creates its own tables on first
write (`src/lib/schema.ts`), so a brand-new database just works. The files in
`migrations/` carry the same statements for anyone who prefers to apply them
explicitly.

## The fast path — one command

```bash
npm run setup:cf
```

It logs you into Cloudflare (one browser prompt), finds or creates the
`summit` D1 database, writes its id into `wrangler.jsonc`, builds and deploys
the Worker, generates and stores the recovery-code signing secret, and checks
that the live URL actually answers. It is safe to re-run at any time — every
step detects work that is already done and skips it.

When it finishes you have a live site at
`https://summit.<your-subdomain>.workers.dev`. Commit the one-line
`wrangler.jsonc` change it makes so CI deploys against the same database.

## The no-terminal path

If you would rather not run anything locally, everything except the database
id can be done from the Cloudflare dashboard:

1. **Storage & Databases → D1 → Create database**, name it `summit`. Copy the
   database ID it shows you and paste it into `wrangler.jsonc` in place of
   `REPLACE_WITH_YOUR_D1_DATABASE_ID` (or hand it to Claude to commit).
2. **Workers & Pages → Create → Import a repository**, point it at this repo
   and branch. Set the build command to `npx opennextjs-cloudflare build` and
   the deploy command to `npx opennextjs-cloudflare deploy`. Cloudflare then
   builds and deploys on every push, with no API tokens and no GitHub secrets.
3. **The `summit` Worker → Settings → Variables and Secrets** → add a secret
   named `SUMMIT_CODE_SECRET` with any long random string (see below).
4. **Settings → Domains & Routes → Add custom domain** if you want it on your
   own domain — one click, since your DNS is already on Cloudflare.

## The signing secret

`SUMMIT_CODE_SECRET` is what signs recovery codes, so a forged code cannot
smuggle a hand-picked seed in through `/restore`. Until it is set, a built-in
development default is used — fine for trying things out, not for a real
draw. Keep a copy: a fresh deployment needs the same secret for previously
issued recovery codes to keep verifying.

## Push-to-deploy through GitHub Actions (optional)

`.github/workflows/deploy.yml` deploys on every push once two repo secrets
exist; until then it skips with a notice, so CI stays green either way. You
only need this if you did **not** use the dashboard's repository import
(which already deploys on push).

1. Cloudflare dashboard → My Profile → API Tokens → Create Token → the
   **Edit Cloudflare Workers** template, plus the **D1: Edit** permission.
2. GitHub repo → Settings → Secrets and variables → Actions:
   - `CLOUDFLARE_API_TOKEN` — that token
   - `CLOUDFLARE_ACCOUNT_ID` — dashboard → Workers & Pages, right sidebar
     (or `npx wrangler whoami`)

## Manual commands

```bash
npm run deploy:cf      # build with OpenNext and deploy
npm run preview:cf     # the real Worker + a local D1, at http://localhost:8787
npm run migrate:cf     # optional — the app creates its own tables anyway
```

## Notes

- **Recovery codes make this near risk-free**: even if the D1 database were
  lost, every race rebuilds byte-identically from its code at `/restore`.
- A race is stored as one meta row plus its pre-sliced chunk rows, so no
  single row approaches D1's size limits regardless of race length.
- The Node/VPS path still works unchanged (`npm run build && npm start` with
  `SUMMIT_DB_PATH` on a disk) — the storage seam picks the right driver by
  environment.
