import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * SQLite storage. One table; rows are immutable — status is always derived
 * from the clock, so there are no background jobs and nothing to migrate.
 */

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = process.env.SUMMIT_DB_PATH ?? path.join(process.cwd(), 'data', 'summit.db');
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS races (
      id            TEXT PRIMARY KEY,
      theme         TEXT NOT NULL DEFAULT 'everest',
      seed          TEXT NOT NULL,
      config_json   TEXT NOT NULL,
      timeline_json TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      start_at      INTEGER NOT NULL,
      duration_ms   INTEGER NOT NULL
    );
  `);
  return db;
}

/** Test hook: close and reset the handle (used with :memory: databases). */
export function resetDbForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}
