/**
 * The one definition of the storage schema, shared by both drivers.
 *
 * A race is one meta row (seed committed at init), the creator-uploaded
 * chunk rows, and one finals row. Every statement is `IF NOT EXISTS`, so
 * applying it is idempotent and safe to run on every cold start — which is
 * exactly what the D1 driver does, so a fresh deployment needs no migration
 * step at all. `migrations/` still carries the same statements for anyone
 * who prefers to apply them explicitly.
 */

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS race_meta (
      id            TEXT PRIMARY KEY,
      theme         TEXT NOT NULL DEFAULT 'everest',
      seed          TEXT NOT NULL,
      config_json   TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      start_at      INTEGER NOT NULL,
      duration_ms   INTEGER NOT NULL,
      ready         INTEGER NOT NULL DEFAULT 0
    )`,
  `CREATE TABLE IF NOT EXISTS race_chunks (
      race_id TEXT NOT NULL,
      idx     INTEGER NOT NULL,
      from_ms INTEGER NOT NULL,
      to_ms   INTEGER NOT NULL,
      body    TEXT NOT NULL,
      PRIMARY KEY (race_id, idx)
    )`,
  `CREATE TABLE IF NOT EXISTS race_finals (
      race_id TEXT PRIMARY KEY,
      body    TEXT NOT NULL
    )`,
];

/** The same statements as one script, for drivers that take raw SQL. */
export const SCHEMA_SQL = SCHEMA_STATEMENTS.join(';\n') + ';';
