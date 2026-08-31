import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema';

/**
 * SQLite storage (Node driver). Schema mirrors the D1 migrations: a race is
 * one meta row (seed committed at init), the uploaded chunk rows, and one
 * finals row. Rows are immutable — status is always derived from the clock,
 * so there are no background jobs and nothing to migrate at runtime.
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
