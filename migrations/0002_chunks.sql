-- Chunk protocol schema: the creator's browser generates and pre-slices the
-- race; the server stores opaque chunk bodies and serves them by clock math.
-- (The 0001 `races` table is superseded and unused.)
CREATE TABLE IF NOT EXISTS race_meta (
  id            TEXT PRIMARY KEY,
  theme         TEXT NOT NULL DEFAULT 'everest',
  seed          TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  start_at      INTEGER NOT NULL,
  duration_ms   INTEGER NOT NULL,
  ready         INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS race_chunks (
  race_id TEXT NOT NULL,
  idx     INTEGER NOT NULL,
  from_ms INTEGER NOT NULL,
  to_ms   INTEGER NOT NULL,
  body    TEXT NOT NULL,
  PRIMARY KEY (race_id, idx)
);
CREATE TABLE IF NOT EXISTS race_finals (
  race_id TEXT PRIMARY KEY,
  body    TEXT NOT NULL
);
