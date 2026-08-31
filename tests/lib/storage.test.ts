process.env.SUMMIT_DB_PATH = ':memory:';

import { describe, it, expect, beforeEach } from 'vitest';
import { getStorage, resetStorageForTests, d1Storage, type D1Like } from '@/lib/storage';
import { resetDbForTests } from '@/lib/db';

const meta = (id: string) => ({
  id,
  theme: 'everest',
  seed: 'a'.repeat(24),
  config_json: '{"teams":[]}',
  created_at: 1,
  start_at: 2,
  duration_ms: 60_000,
  ready: 0,
});

const CHUNKS = [
  { idx: 0, fromMs: -1, toMs: 10_000, body: '{"sinceMs":-1}' },
  { idx: 1, fromMs: 10_000, toMs: 20_000, body: '{"sinceMs":10000}' },
];

beforeEach(() => {
  resetDbForTests();
  resetStorageForTests();
});

/**
 * A fake D1 binding. `batchBehavior` decides what each successive batch()
 * call does, which is how the bootstrap failure modes get simulated.
 */
function fakeD1(batchBehavior: (n: number) => Promise<unknown>): D1Like & { calls: () => number } {
  let n = 0;
  const stmt = () => {
    const self = {
      bind: () => self,
      first: async <T,>() => null as T | null,
      run: async () => ({}),
      all: async <T,>() => ({ results: [] as T[] }),
    };
    return self;
  };
  return {
    calls: () => n,
    prepare: () => stmt(),
    batch: () => batchBehavior(++n),
  };
}

describe('storage', () => {
  it('a retried upload replaces rows instead of colliding on the primary key', async () => {
    const store = await getStorage();
    await store.insertMeta(meta('r1'));
    await store.putTimeline('r1', CHUNKS, '{"finalOrder":[0,1]}');

    // A partially-failed upload leaves rows behind, so the client retries the
    // whole thing. That must not die on (race_id, idx).
    await expect(store.putTimeline('r1', CHUNKS, '{"finalOrder":[0,1]}')).resolves.toBeUndefined();

    const got = await store.getChunks('r1', -1, null);
    expect(got.map((c) => c.idx)).toEqual([0, 1]);
    expect(got.map((c) => c.body)).toEqual(CHUNKS.map((c) => c.body));
    expect(await store.getFinals('r1')).toBe('{"finalOrder":[0,1]}');
  });

  it('a schema bootstrap that never settles does not wedge later writes', async () => {
    // Workers cancels the continuations of a request that goes away, so a
    // bootstrap promise cached across requests can hang forever. Caching an
    // in-flight promise here made every subsequent write in the isolate wait
    // on it; each call must be able to make its own progress instead.
    const db = fakeD1((n) => (n === 1 ? new Promise(() => {}) : Promise.resolve({})));
    const store = d1Storage(db);

    const abandoned = store.insertMeta(meta('r1')); // never settles, like a cancelled request
    void abandoned;

    await expect(store.insertMeta(meta('r2'))).resolves.toBeUndefined();
  });

  it('a failed bootstrap is retried rather than remembered', async () => {
    const db = fakeD1((n) => (n === 1 ? Promise.reject(new Error('D1 unavailable')) : Promise.resolve({})));
    const store = d1Storage(db);

    await expect(store.insertMeta(meta('r1'))).rejects.toThrow('D1 unavailable');
    await expect(store.insertMeta(meta('r2'))).resolves.toBeUndefined();
  });

  it('bootstraps once and then stops paying for it', async () => {
    const db = fakeD1(() => Promise.resolve({}));
    const store = d1Storage(db);

    await store.insertMeta(meta('r1'));
    const afterFirst = db.calls();
    await store.insertMeta(meta('r2'));
    await store.insertMeta(meta('r3'));

    expect(afterFirst).toBe(1);
    expect(db.calls()).toBe(1);
  });
});
