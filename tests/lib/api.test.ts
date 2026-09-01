import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.SUMMIT_DB_PATH = ':memory:';

import { resetDbForTests } from '@/lib/db';
import { resetStorageForTests } from '@/lib/storage';
import { validateCreateInput, ValidationError, type Theme } from '@/lib/races';
import { acceptUpload, buildEnvelope, initRace } from '@/lib/raceApi';
import { buildUploadBody } from '@/lib/clientGen';
import { boundariesFor, pushStartFor } from '@/lib/chunking';
import { horizonFor } from '@/lib/slice';

const NOW = 1_700_000_000_000;

function teams(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `Team ${i + 1}` }));
}

function reset() {
  resetDbForTests();
  resetStorageForTests();
}

beforeAll(reset);
afterAll(reset);

interface Envelope {
  status: string;
  cursor: number;
  complete: boolean;
  chunks: { sinceMs: number; horizonMs: number }[];
  finals: unknown;
  seed: string | null;
  startAt: number;
  durationMs: number;
  config: { title: string; teams: unknown[] };
}

async function envelope(slug: string, nowMs: number, cursor = -1) {
  const body = await buildEnvelope(slug, nowMs, cursor);
  expect(body).not.toBeNull();
  return { raw: body!, data: JSON.parse(body!) as Envelope };
}

async function createFull(opts: {
  theme?: Theme;
  n?: number;
  durationMs?: number;
  startAtMs?: number;
  demo?: boolean;
}) {
  const theme = opts.theme ?? 'everest';
  const n = opts.n ?? 6;
  const durationMs = opts.durationMs ?? 600_000;
  const init = await initRace(
    {
      theme,
      teams: teams(n),
      durationMs,
      ...(opts.startAtMs !== undefined ? { startAtMs: opts.startAtMs } : {}),
      demo: opts.demo ?? false,
    },
    NOW,
  );
  const { body } = await buildUploadBody(theme, init.seed, teams(n), durationMs);
  await acceptUpload(init.slug, init.seed, body);
  return { ...init, durationMs, theme, n };
}

describe('race API under the chunk protocol', () => {
  it('validates input', () => {
    expect(() => validateCreateInput({ teams: teams(1), durationMs: 60_000 }, NOW)).toThrow(ValidationError);
    expect(() => validateCreateInput({ teams: teams(51), durationMs: 60_000 }, NOW)).toThrow(ValidationError);
    expect(() => validateCreateInput({ teams: teams(4), durationMs: 30_000 }, NOW)).toThrow(ValidationError);
    expect(() => validateCreateInput({ teams: teams(4), durationMs: 25 * 3_600_000 }, NOW)).toThrow(ValidationError);
    expect(() =>
      validateCreateInput(
        { teams: [{ name: 'A' }, { name: 'a' }], durationMs: 60_000 },
        NOW,
      ),
    ).toThrow(/duplicate/);
    const ok = validateCreateInput({ teams: teams(4), durationMs: 300_000 }, NOW);
    expect(ok.startAtMs).toBe(NOW + 60_000);
  });

  it('a race without its upload is "preparing" and serves nothing', async () => {
    const init = await initRace(
      { teams: teams(4), durationMs: 300_000 },
      NOW,
    );
    const { data } = await envelope(init.slug, NOW + 90_000);
    expect(data.status).toBe('preparing');
    expect(data.chunks).toHaveLength(0);
    expect(data.finals).toBeNull();
    expect(data.seed).toBeNull();
  });

  it('scheduled races serve config only — zero chunks before the gun', async () => {
    const race = await createFull({ startAtMs: NOW + 120_000 });
    const { raw, data } = await envelope(race.slug, NOW + 30_000);
    expect(data.status).toBe('scheduled');
    expect(data.chunks).toHaveLength(0);
    expect(data.finals).toBeNull();
    expect(raw).not.toContain('"finalOrder"');
    expect(data.config.teams).toHaveLength(6);
  });

  it('mid-race, every served chunk respects the phased horizon and nothing leaks', async () => {
    const race = await createFull({ startAtMs: NOW + 60_000, durationMs: 600_000 });
    const start = NOW + 60_000;
    for (const elapsed of [30_000, 250_000, 540_000, 585_000]) {
      const { raw, data } = await envelope(race.slug, start + elapsed);
      const horizon = horizonFor(elapsed, race.durationMs, pushStartFor(race.durationMs));
      for (const c of data.chunks) {
        expect(c.horizonMs).toBeLessThanOrEqual(horizon);
        if (elapsed < pushStartFor(race.durationMs)) {
          expect(c.horizonMs).toBeLessThanOrEqual(pushStartFor(race.durationMs));
        }
      }
      expect(data.complete).toBe(false);
      expect(data.finals).toBeNull();
      expect(data.seed).toBeNull();
      expect(raw).not.toContain('"finalOrder"');
      expect(raw).not.toContain('"summitTimesMs"');
    }
  });

  it('the cursor pages chunks forward without overlap', async () => {
    const race = await createFull({ startAtMs: NOW + 60_000 });
    const start = NOW + 60_000;
    const first = await envelope(race.slug, start + 200_000);
    expect(first.data.chunks.length).toBeGreaterThan(0);
    const again = await envelope(race.slug, start + 200_000, first.data.cursor);
    expect(again.data.chunks).toHaveLength(0);
    const later = await envelope(race.slug, start + 400_000, first.data.cursor);
    expect(later.data.chunks.length).toBeGreaterThan(0);
    expect(later.data.chunks[0].sinceMs).toBe(
      first.data.chunks[first.data.chunks.length - 1].horizonMs,
    );
  });

  it('finished races serve everything: all chunks, finals, and the seed for verification', async () => {
    const race = await createFull({ startAtMs: NOW + 60_000, durationMs: 600_000 });
    const { data } = await envelope(race.slug, NOW + 60_000 + 600_001);
    expect(data.status).toBe('finished');
    expect(data.complete).toBe(true);
    expect(data.chunks).toHaveLength(boundariesFor(race.durationMs).length);
    expect(data.finals).not.toBeNull();
    expect(data.seed).toBe(race.seed);
  });

  it('demo races are complete immediately', async () => {
    const race = await createFull({ demo: true });
    const { data } = await envelope(race.slug, NOW + 1_000);
    expect(data.complete).toBe(true);
    expect(data.finals).not.toBeNull();
  });

  it('upload is guarded: wrong seed, double upload, and forged windows all rejected', async () => {
    const init = await initRace({ teams: teams(4), durationMs: 300_000 }, NOW);
    const { body } = await buildUploadBody('everest', init.seed, teams(4), 300_000);
    await expect(acceptUpload(init.slug, 'not-the-seed', body)).rejects.toThrow(/seed/);
    await acceptUpload(init.slug, init.seed, body);
    await expect(acceptUpload(init.slug, init.seed, body)).rejects.toThrow(/already/);

    const init2 = await initRace({ teams: teams(4), durationMs: 300_000 }, NOW);
    const wrong = await buildUploadBody('everest', init2.seed, teams(4), 600_000);
    await expect(acceptUpload(init2.slug, init2.seed, wrong.body)).rejects.toThrow(
      /chunk|window/,
    );
  });

});
