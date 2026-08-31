/**
 * Storage seam v2 for the chunk protocol: one tiny async interface, two
 * drivers.
 *
 * - Node (dev, tests, self-hosted): Node's built-in SQLite, loaded lazily
 *   so nothing SQLite-shaped ever reaches Workers.
 * - Cloudflare Workers: D1 bound as SUMMIT_DB — where every operation is
 *   row I/O and string passing, comfortably inside the free tier's CPU cap.
 *
 * A race is: one meta row (seed committed at init, ready=0), then the
 * creator-uploaded chunk rows + finals row (ready=1). Rows are immutable;
 * status is always derived from the clock.
 */

import { SCHEMA_STATEMENTS } from './schema';

export interface RaceMetaRow {
  id: string;
  theme: string;
  seed: string;
  config_json: string;
  created_at: number;
  start_at: number;
  duration_ms: number;
  ready: number;
}

export interface StoredChunk {
  idx: number;
  body: string;
}

export interface RaceStorage {
  getMeta(id: string): Promise<RaceMetaRow | null>;
  insertMeta(row: RaceMetaRow): Promise<void>;
  /** Store all chunks + finals and flip ready — the upload commit. */
  putTimeline(
    id: string,
    chunks: { idx: number; fromMs: number; toMs: number; body: string }[],
    finalsBody: string,
  ): Promise<void>;
  /** Chunk bodies with idx > afterIdx and window end <= maxToMs (null = all). */
  getChunks(id: string, afterIdx: number, maxToMs: number | null): Promise<StoredChunk[]>;
  getFinals(id: string): Promise<string | null>;
}

/* ---------------- D1 driver --------------------------------------------- */

export interface D1Stmt {
  bind(...args: unknown[]): D1Stmt;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}

export interface D1Like {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<unknown>;
}

/**
 * D1 needs its tables to exist, and a brand-new deployment has none. Rather
 * than make a migration step part of every setup path, the driver applies
 * the (idempotent) schema once per isolate, on the first write. Reads keep a
 * zero-cost path and only fall back to bootstrapping if they actually hit a
 * missing table — which can only happen on a deployment where no race has
 * ever been created.
 *
 * Deliberately a plain boolean and not a cached in-flight promise: an
 * unsettled promise created inside one request belongs to that request's
 * I/O context, and if that request is cancelled (the user closes the tab
 * mid-create) workerd cancels its continuations, so a cached promise would
 * never settle and every later write in the isolate would hang on it
 * forever. The DDL is all IF NOT EXISTS, so letting two concurrent requests
 * race through it costs nothing.
 */
let d1SchemaDone = false;

async function ensureD1Schema(db: D1Like): Promise<void> {
  if (d1SchemaDone) return;
  await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
  d1SchemaDone = true;
}

function isMissingTable(err: unknown): boolean {
  return /no such table/i.test(err instanceof Error ? err.message : String(err));
}

/** Run a read, bootstrapping the schema and retrying once if it's absent. */
async function readGuarded<T>(db: D1Like, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    d1SchemaDone = false;
    await ensureD1Schema(db);
    return fn();
  }
}

/** The D1 driver over any D1-shaped binding. Exported for tests. */
export function d1Storage(db: D1Like): RaceStorage {
  return {
    async getMeta(id) {
      return readGuarded(db, () =>
        db.prepare('SELECT * FROM race_meta WHERE id = ?').bind(id).first<RaceMetaRow>(),
      );
    },
    async insertMeta(r) {
      await ensureD1Schema(db);
      await db
        .prepare(
          `INSERT INTO race_meta (id, theme, seed, config_json, created_at, start_at, duration_ms, ready)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        )
        .bind(r.id, r.theme, r.seed, r.config_json, r.created_at, r.start_at, r.duration_ms)
        .run();
    },
    async putTimeline(id, chunks, finalsBody) {
      await ensureD1Schema(db);
      const insert = db.prepare(
        'INSERT OR REPLACE INTO race_chunks (race_id, idx, from_ms, to_ms, body) VALUES (?, ?, ?, ?, ?)',
      );
      const BATCH = 80;
      for (let i = 0; i < chunks.length; i += BATCH) {
        await db.batch(
          chunks
            .slice(i, i + BATCH)
            .map((c) => insert.bind(id, c.idx, c.fromMs, c.toMs, c.body)),
        );
      }
      await db.batch([
        db.prepare('INSERT OR REPLACE INTO race_finals (race_id, body) VALUES (?, ?)').bind(id, finalsBody),
        db.prepare('UPDATE race_meta SET ready = 1 WHERE id = ?').bind(id),
      ]);
    },
    async getChunks(id, afterIdx, maxToMs) {
      return readGuarded(db, async () => {
        const stmt =
          maxToMs === null
            ? db
                .prepare(
                  'SELECT idx, body FROM race_chunks WHERE race_id = ? AND idx > ? ORDER BY idx',
                )
                .bind(id, afterIdx)
            : db
                .prepare(
                  'SELECT idx, body FROM race_chunks WHERE race_id = ? AND idx > ? AND to_ms <= ? ORDER BY idx',
                )
                .bind(id, afterIdx, maxToMs);
        return (await stmt.all<StoredChunk>()).results;
      });
    },
    async getFinals(id) {
      return readGuarded(db, async () => {
        const row = await db
          .prepare('SELECT body FROM race_finals WHERE race_id = ?')
          .bind(id)
          .first<{ body: string }>();
        return row?.body ?? null;
      });
    },
  };
}

/* ---------------- Node / built-in SQLite driver -------------------------- */

let nodeStorage: RaceStorage | null = null;

async function getNodeStorage(): Promise<RaceStorage> {
  if (nodeStorage) return nodeStorage;
  const { getDb } = await import('./db');
  nodeStorage = {
    async getMeta(id) {
      return (
        ((await getDb()).prepare('SELECT * FROM race_meta WHERE id = ?').get(id) as
          | RaceMetaRow
          | undefined) ?? null
      );
    },
    async insertMeta(r) {
      (await getDb())
        .prepare(
          `INSERT INTO race_meta (id, theme, seed, config_json, created_at, start_at, duration_ms, ready)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(r.id, r.theme, r.seed, r.config_json, r.created_at, r.start_at, r.duration_ms);
    },
    async putTimeline(id, chunks, finalsBody) {
      const db = await getDb();
      db.exec('BEGIN');
      try {
        const insert = db.prepare(
          'INSERT OR REPLACE INTO race_chunks (race_id, idx, from_ms, to_ms, body) VALUES (?, ?, ?, ?, ?)',
        );
        for (const c of chunks) insert.run(id, c.idx, c.fromMs, c.toMs, c.body);
        db.prepare('INSERT OR REPLACE INTO race_finals (race_id, body) VALUES (?, ?)').run(id, finalsBody);
        db.prepare('UPDATE race_meta SET ready = 1 WHERE id = ?').run(id);
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // the transaction is already gone; report the original failure
        }
        throw err;
      }
    },
    async getChunks(id, afterIdx, maxToMs) {
      const db = await getDb();
      return (
        maxToMs === null
          ? db
              .prepare(
                'SELECT idx, body FROM race_chunks WHERE race_id = ? AND idx > ? ORDER BY idx',
              )
              .all(id, afterIdx)
          : db
              .prepare(
                'SELECT idx, body FROM race_chunks WHERE race_id = ? AND idx > ? AND to_ms <= ? ORDER BY idx',
              )
              .all(id, afterIdx, maxToMs)
      ) as StoredChunk[];
    },
    async getFinals(id) {
      const row = (await getDb()).prepare('SELECT body FROM race_finals WHERE race_id = ?').get(id) as
        | { body: string }
        | undefined;
      return row?.body ?? null;
    },
  };
  return nodeStorage;
}

/** Test hook mirror of resetDbForTests — clears the cached driver too. */
export function resetStorageForTests(): void {
  nodeStorage = null;
  d1SchemaDone = false;
}

/* ---------------- selection --------------------------------------------- */

export async function getStorage(): Promise<RaceStorage> {
  // On Cloudflare, OpenNext exposes the bindings; anywhere else this import
  // either fails or has no context, and we fall through to SQLite.
  try {
    const mod = await import('@opennextjs/cloudflare');
    const ctx = mod.getCloudflareContext();
    const env = ctx?.env as { SUMMIT_DB?: D1Like } | undefined;
    if (env?.SUMMIT_DB) return d1Storage(env.SUMMIT_DB);
  } catch {
    // not running under the Cloudflare adapter
  }
  return getNodeStorage();
}
