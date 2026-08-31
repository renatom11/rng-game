import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema';

/**
 * SQLite storage (Node driver): dev, tests, and self-hosting. Schema comes
 * from ./schema, shared with D1. Rows are immutable — status is always
 * derived from the clock, so there are no background jobs.
 *
 * This uses Node's BUILT-IN `node:sqlite` rather than a native module from
 * npm, which means the project compiles nothing on install: no C++
 * toolchain, no prebuilt-binary roulette, nothing to go wrong on a fresh
 * clone. Needs Node 22.13+ (it is stable in Node 24).
 *
 * The module is loaded through a specifier assembled at runtime, which no
 * bundler can follow, so the Cloudflare build never has to resolve
 * `node:sqlite` — the Worker uses D1 and never loads this file.
 */

export interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type SqliteCtor = new (filename: string) => SqliteDatabase;

let db: SqliteDatabase | null = null;
let ctor: SqliteCtor | null = null;

async function loadDriver(): Promise<SqliteCtor> {
  if (ctor) return ctor;
  const spec = ['node', 'sqlite'].join(':');
  let mod: { DatabaseSync?: SqliteCtor };
  try {
    mod = (await import(/* webpackIgnore: true */ spec)) as { DatabaseSync?: SqliteCtor };
  } catch (err) {
    throw new Error(
      "This build stores races with Node's built-in SQLite, which needs " +
        `Node 22.13 or newer (you are on ${process.version}). Upgrade Node, ` +
        'or deploy to Cloudflare, where D1 is used instead. Original error: ' +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  if (!mod.DatabaseSync) {
    throw new Error(
      `node:sqlite loaded but exposes no DatabaseSync on ${process.version} — upgrade Node to 22.13+.`,
    );
  }
  ctor = mod.DatabaseSync;
  return ctor;
}

export async function getDb(): Promise<SqliteDatabase> {
  if (db) return db;
  const DatabaseSync = await loadDriver();
  const dbPath = process.env.SUMMIT_DB_PATH ?? path.join(process.cwd(), 'data', 'summit.db');
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const opened = new DatabaseSync(dbPath);
  // WAL is meaningless for an in-memory database and SQLite refuses it there.
  if (dbPath !== ':memory:') opened.exec('PRAGMA journal_mode = WAL');
  opened.exec(SCHEMA_SQL);
  db = opened;
  return db;
}

/** Test hook: close and reset the handle (used with :memory: databases). */
export function resetDbForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}
