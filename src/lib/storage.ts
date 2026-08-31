/**
 * Storage seam: one tiny async interface, two drivers.
 *
 * - Node (dev, tests, self-hosted): the better-sqlite3 file database,
 *   loaded lazily so the native module is never touched on Workers.
 * - Cloudflare Workers: a D1 database bound as SUMMIT_DB. Timelines are
 *   gzipped into a BLOB there — a worst-case 50-team × 24h timeline is
 *   ~1.9MB of JSON, a whisker under D1's 2MB row cap, and ~250KB gzipped.
 *
 * Rows are immutable either way; race status is always derived from the
 * clock, so the storage contract is just get / exists / insert.
 */

export interface RaceRow {
  id: string;
  theme: string;
  seed: string;
  config_json: string;
  timeline_json: string;
  created_at: number;
  start_at: number;
  duration_ms: number;
}

export interface RaceStorage {
  get(id: string): Promise<RaceRow | null>;
  exists(id: string): Promise<boolean>;
  insert(row: RaceRow): Promise<void>;
}

/* ---------------- gzip helpers (Web Streams — Workers + Node 18+) -------- */

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

/* ---------------- D1 driver --------------------------------------------- */

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

function d1Storage(db: D1Like): RaceStorage {
  return {
    async get(id) {
      const row = await db
        .prepare(
          'SELECT id, theme, seed, config_json, timeline_gz, created_at, start_at, duration_ms FROM races WHERE id = ?',
        )
        .bind(id)
        .first<Omit<RaceRow, 'timeline_json'> & { timeline_gz: ArrayBuffer }>();
      if (!row) return null;
      const { timeline_gz, ...rest } = row;
      return { ...rest, timeline_json: await gunzip(timeline_gz) };
    },
    async exists(id) {
      const row = await db
        .prepare('SELECT id FROM races WHERE id = ?')
        .bind(id)
        .first<{ id: string }>();
      return row !== null;
    },
    async insert(row) {
      const gz = await gzip(row.timeline_json);
      await db
        .prepare(
          `INSERT INTO races (id, theme, seed, config_json, timeline_gz, created_at, start_at, duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.theme,
          row.seed,
          row.config_json,
          gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength),
          row.created_at,
          row.start_at,
          row.duration_ms,
        )
        .run();
    },
  };
}

/* ---------------- Node / better-sqlite3 driver --------------------------- */

let nodeStorage: RaceStorage | null = null;

async function getNodeStorage(): Promise<RaceStorage> {
  if (nodeStorage) return nodeStorage;
  // Lazy dynamic import: the native module must never be resolved on Workers.
  const { getDb } = await import('./db');
  nodeStorage = {
    async get(id) {
      const row = getDb().prepare('SELECT * FROM races WHERE id = ?').get(id) as
        | RaceRow
        | undefined;
      return row ?? null;
    },
    async exists(id) {
      return getDb().prepare('SELECT id FROM races WHERE id = ?').get(id) !== undefined;
    },
    async insert(row) {
      getDb()
        .prepare(
          `INSERT INTO races (id, theme, seed, config_json, timeline_json, created_at, start_at, duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.theme,
          row.seed,
          row.config_json,
          row.timeline_json,
          row.created_at,
          row.start_at,
          row.duration_ms,
        );
    },
  };
  return nodeStorage;
}

/** Test hook mirror of resetDbForTests — clears the cached driver too. */
export function resetStorageForTests(): void {
  nodeStorage = null;
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
