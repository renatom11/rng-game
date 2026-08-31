-- Summit races on D1. Rows are immutable; status is derived from the clock.
-- timeline_gz holds the gzipped timeline JSON (worst case ~1.9MB raw would
-- graze D1's 2MB row cap; gzipped it is ~250KB).
CREATE TABLE IF NOT EXISTS races (
  id            TEXT PRIMARY KEY,
  theme         TEXT NOT NULL DEFAULT 'everest',
  seed          TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  timeline_gz   BLOB NOT NULL,
  created_at    INTEGER NOT NULL,
  start_at      INTEGER NOT NULL,
  duration_ms   INTEGER NOT NULL
);
