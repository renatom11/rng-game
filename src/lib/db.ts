import fs from 'node:fs';
import path from 'node:path';
import type DatabaseNS from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

/**
 * SQLite storage (Node driver): dev, tests, and self-hosting. Schema comes
 * from ./schema, shared with D1. Rows are immutable — status is always
 * derived from the clock, so there are no background jobs.
 *
 * better-sqlite3 is loaded through a specifier assembled at runtime, which
 * no bundler can follow, and that is deliberate. It is a native module, and
 * only this path uses it; the Cloudflare build must not depend on it, or
 * deploying would require a working C++ toolchain to compile a driver the
 * Worker never runs (it uses D1). Hence also its place in
 * optionalDependencies: an install that cannot build it still deploys.
 */

let db: DatabaseNS.Database | null = null;
let ctor: typeof DatabaseNS | null = null;

async function loadDriver(): Promise<typeof DatabaseNS> {
  if (ctor) return ctor;
  const spec = ['better', 'sqlite3'].join('-');
  let mod: unknown;
  try {
    mod = await import(/* webpackIgnore: true */ spec);
  } catch (err) {
    throw new Error(
      'better-sqlite3 is not installed, so races cannot be stored locally. ' +
        'Install it with `npm install better-sqlite3` (it needs a C++ build ' +
        'toolchain if no prebuilt binary exists for your Node version), or ' +
        'deploy to Cloudflare, where D1 is used instead. Original error: ' +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  const resolved = (mod as { default?: unknown }).default ?? mod;
  ctor = resolved as typeof DatabaseNS;
  return ctor;
}

export async function getDb(): Promise<DatabaseNS.Database> {
  if (db) return db;
  const Database = await loadDriver();
  const dbPath = process.env.SUMMIT_DB_PATH ?? path.join(process.cwd(), 'data', 'summit.db');
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

/** Test hook: close and reset the handle (used with :memory: databases). */
export function resetDbForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}
