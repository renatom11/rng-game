#!/usr/bin/env node
/**
 * One-command Cloudflare setup: `npm run setup:cf`
 *
 * Does everything the deploy needs, in order, and is safe to re-run:
 *   1. log in to Cloudflare (browser, once)
 *   2. find or create the `summit` D1 database
 *   3. write its id into wrangler.jsonc
 *   4. build and deploy the Worker
 *   5. generate and store SUMMIT_CODE_SECRET (recovery-code signing key)
 *   6. check the live site actually answers
 *
 * There is no migration step: the Worker creates its own tables on first
 * write (src/lib/schema.ts), so a fresh database just works.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'wrangler.jsonc');
const PLACEHOLDER = 'REPLACE_WITH_YOUR_D1_DATABASE_ID';
const DB_NAME = 'summit';
const SECRET_NAME = 'SUMMIT_CODE_SECRET';
const IS_WIN = process.platform === 'win32';
// On Windows the bare names resolve to PowerShell shims that an execution
// policy can block; the .cmd wrappers always run (and need shell: true).
const NPM = IS_WIN ? 'npm.cmd' : 'npm';
const NPX = IS_WIN ? 'npx.cmd' : 'npx';
const ENV = { ...process.env, WRANGLER_SEND_METRICS: 'false' };

let stepNo = 0;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const step = (msg) => console.log(`\n${bold(`[${++stepNo}] ${msg}`)}`);
const ok = (msg) => console.log(`    \x1b[32m✓\x1b[0m ${msg}`);
const note = (msg) => console.log(`    \x1b[33m•\x1b[0m ${msg}`);
const die = (msg, hint) => {
  console.error(`\n\x1b[31m✗ ${msg}\x1b[0m`);
  if (hint) console.error(`  ${hint}`);
  console.error('');
  process.exit(1);
};

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}

/** Run a command, streaming output while also capturing it. Stdin stays
 *  connected so wrangler's prompts (login, account picker) work. */
function run(cmd, args, { input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: ENV,
      shell: IS_WIN,
      stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      out += d;
      process.stderr.write(d);
    });
    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    }
    child.on('close', (code) => resolve({ code, out }));
  });
}

/** Run a command quietly and return its output. */
function capture(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    env: ENV,
    shell: IS_WIN,
    encoding: 'utf8',
  });
  return { code: res.status ?? 1, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

const wrangler = (args, opts) => run(NPX, ['wrangler', ...args], opts);
const wranglerQuiet = (args) => capture(NPX, ['wrangler', ...args]);

/** Wrangler prints banners and warnings around its JSON; find the payload. */
function parseJsonLoose(text) {
  const attempt = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const direct = attempt(text.trim());
  if (direct !== undefined) return direct;
  for (const [open, close] of [
    ['[', ']'],
    ['{', '}'],
  ]) {
    const a = text.indexOf(open);
    const b = text.lastIndexOf(close);
    if (a !== -1 && b > a) {
      const parsed = attempt(text.slice(a, b + 1));
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

const asList = (v) =>
  Array.isArray(v) ? v : Array.isArray(v?.result) ? v.result : Array.isArray(v?.results) ? v.results : [];
const idOf = (d) => d?.uuid ?? d?.database_id ?? d?.id;
const nameOf = (d) => d?.name ?? d?.database_name;

async function main() {
  console.log(bold('\n🏔  Summit → Cloudflare (free tier)\n'));

  /* 0. dependencies ----------------------------------------------------- */
  if (!existsSync(path.join(ROOT, 'node_modules', 'wrangler'))) {
    step('Installing dependencies');
    const { code } = await run(NPM, ['install']);
    if (code !== 0) die('npm install failed.');
    ok('dependencies installed');
  }

  /* 1. auth -------------------------------------------------------------- */
  step('Checking your Cloudflare login');
  let who = wranglerQuiet(['whoami']);
  if (who.code !== 0 || /not authenticated|not logged in/i.test(who.out)) {
    note('opening a browser to log in to Cloudflare…');
    const { code } = await wrangler(['login']);
    if (code !== 0) die('Cloudflare login failed.', 'Re-run `npx wrangler login` and try again.');
    who = wranglerQuiet(['whoami']);
    if (who.code !== 0) die('Still not logged in after the browser step.');
  }
  const accountId = (who.out.match(/\b[0-9a-f]{32}\b/) ?? [])[0] ?? null;
  const email = (who.out.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) ?? [])[0];
  ok(`logged in${email ? ` as ${email}` : ''}${accountId ? ` (account ${accountId})` : ''}`);

  /* 2. database ---------------------------------------------------------- */
  step(`Finding or creating the "${DB_NAME}" D1 database`);
  const findDb = () => {
    const listed = wranglerQuiet(['d1', 'list', '--json']);
    return asList(parseJsonLoose(listed.out)).find((d) => nameOf(d) === DB_NAME);
  };
  let database = findDb();
  if (database) {
    ok(`found existing database (${idOf(database)})`);
  } else {
    note('none found — creating it');
    const { code } = await wrangler(['d1', 'create', DB_NAME]);
    if (code !== 0) die('Could not create the D1 database.');
    database = findDb();
    if (!database) die('Created the database but could not read its id back.', 'Run `npx wrangler d1 list` and paste the id into wrangler.jsonc.');
    ok(`created database (${idOf(database)})`);
  }
  const databaseId = idOf(database);
  if (!databaseId) die('The database has no id — unexpected wrangler output.');

  /* 3. config ------------------------------------------------------------ */
  step('Writing the database id into wrangler.jsonc');
  const before = readFileSync(CONFIG_PATH, 'utf8');
  if (before.includes(PLACEHOLDER)) {
    writeFileSync(CONFIG_PATH, before.replace(PLACEHOLDER, databaseId));
    ok('wrangler.jsonc updated — commit this change so pushes deploy too');
  } else if (before.includes(databaseId)) {
    ok('already set');
  } else {
    note(`wrangler.jsonc names a different database id than the "${DB_NAME}" database.`);
    note('Leaving it alone — edit it by hand if that is not what you want.');
  }

  /* 4. deploy ------------------------------------------------------------ */
  step('Building and deploying the Worker (a minute or two)');
  const deploy = await run(NPM, ['run', 'deploy:cf']);
  if (deploy.code !== 0) die('The deploy failed — the output above says why.');
  const urls = deploy.out.match(/https:\/\/[a-z0-9._-]+\.workers\.dev/gi) ?? [];
  const liveUrl = urls[urls.length - 1] ?? null;
  ok(liveUrl ? `deployed to ${liveUrl}` : 'deployed');

  /* 5. signing secret ---------------------------------------------------- */
  step('Setting the recovery-code signing secret');
  const secrets = asList(parseJsonLoose(wranglerQuiet(['secret', 'list', '--json']).out));
  if (secrets.some((s) => (s?.name ?? s) === SECRET_NAME)) {
    ok(`${SECRET_NAME} is already set — leaving it as it is`);
  } else {
    const value = randomBytes(32).toString('base64url');
    const { code } = await run(NPX, ['wrangler', 'secret', 'put', SECRET_NAME], { input: value });
    if (code !== 0) {
      note(`Could not set ${SECRET_NAME} automatically.`);
      note(`Add it by hand: dashboard → the summit Worker → Settings → Variables and Secrets.`);
    } else {
      ok(`${SECRET_NAME} generated and stored (Cloudflare keeps it; it is not saved locally)`);
    }
  }

  /* 6. verify ------------------------------------------------------------ */
  if (liveUrl) {
    step('Checking the live site');
    try {
      const res = await fetch(liveUrl, { redirect: 'follow' });
      const body = await res.text();
      if (res.ok && /summit/i.test(body)) ok(`${liveUrl} is live and serving the app`);
      else note(`${liveUrl} answered ${res.status} — it may still be propagating; try it in a browser.`);
    } catch {
      note(`Could not reach ${liveUrl} from here — try it in a browser.`);
    }
  }

  /* summary -------------------------------------------------------------- */
  console.log(bold('\n\nDone.\n'));
  if (liveUrl) console.log(`  Your site:   ${bold(liveUrl)}`);
  console.log(`  Custom domain: dashboard → the summit Worker → Settings → Domains & Routes.`);
  console.log('');
  console.log('  To make every git push deploy automatically (optional — you can');
  console.log('  always just re-run this script or `npm run deploy:cf`):');
  console.log('    1. Cloudflare dashboard → My Profile → API Tokens → Create Token');
  console.log('       → "Edit Cloudflare Workers" template, plus the D1:Edit permission.');
  console.log('    2. GitHub repo → Settings → Secrets and variables → Actions, add:');
  console.log('         CLOUDFLARE_API_TOKEN   = that token');
  console.log(`         CLOUDFLARE_ACCOUNT_ID  = ${accountId ?? '(see `npx wrangler whoami`)'}`);
  console.log('');
  if (readFileSync(CONFIG_PATH, 'utf8') !== before && existsSync(path.join(ROOT, '.git'))) {
    console.log('  One file changed — commit it so CI deploys the same database:');
    console.log(bold('    git add wrangler.jsonc && git commit -m "Add D1 database id" && git push'));
    console.log('');
  }
}

main().catch((err) => die(err?.stack ?? String(err)));
