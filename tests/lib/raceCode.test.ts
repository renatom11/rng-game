import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.SUMMIT_DB_PATH = ':memory:';

import { resetDbForTests } from '@/lib/db';
import { resetStorageForTests } from '@/lib/storage';
import { acceptUpload, buildEnvelope, initRace, restoreRace } from '@/lib/raceApi';
import { buildUploadBody } from '@/lib/clientGen';
import { decodeRaceCode, encodeRaceCode, RaceCodeError } from '@/lib/raceCode';
import { heightOrderAt, displayPosAt } from '@/lib/client/raceState';
import { generateEverest } from '@/themes/everest/generate';
import { toJourneySnapshot } from '@/lib/slice';

const NOW = 1_700_000_000_000;
const SECRET = 'summit-dev-secret'; // matches the raceApi fallback

function teams(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `Team ${i + 1}` }));
}

function reset() {
  resetDbForTests();
  resetStorageForTests();
}

beforeAll(reset);
afterAll(reset);

describe('signed recovery codes', () => {
  const payload = {
    v: 2 as const,
    slug: 'abc123def4',
    seed: 'deadbeefdeadbeefdeadbeefdeadbeef',
    theme: 'everest' as const,
    title: 'T',
    teams: teams(4),
    durationMs: 600_000,
    startAtMs: NOW,
    demo: false,
    createdAt: NOW,
  };

  it('round-trips, rejects tampering, and rejects foreign secrets', async () => {
    const code = await encodeRaceCode(payload, SECRET);
    expect(await decodeRaceCode(code, SECRET)).toEqual(payload);
    expect(await decodeRaceCode(`  ${code}\n`, SECRET)).toEqual(payload);
    await expect(decodeRaceCode(code.slice(0, -2) + 'XX', SECRET)).rejects.toThrow(RaceCodeError);
    await expect(decodeRaceCode('SMT2.garbage.sig', SECRET)).rejects.toThrow(RaceCodeError);
    await expect(decodeRaceCode('hello', SECRET)).rejects.toThrow(RaceCodeError);
    // A code signed under another secret (i.e. a forged/shopped seed) fails.
    const forged = await encodeRaceCode({ ...payload, seed: '11111111111111111111111111111111' }, 'attacker');
    await expect(decodeRaceCode(forged, SECRET)).rejects.toThrow(RaceCodeError);
  });

  it('restores a crashed race byte-identically, same slug, mid-flight', async () => {
    const init = await initRace(
      { teams: teams(6), durationMs: 3_600_000, startAtMs: NOW + 60_000, title: 'Crash Test' },
      NOW,
    );
    const { body } = await buildUploadBody('everest', init.seed, teams(6), 3_600_000);
    await acceptUpload(init.slug, init.seed, body);
    const midRace = NOW + 60_000 + 1_200_000;
    const before = await buildEnvelope(init.slug, midRace, -1);
    expect(before).not.toBeNull();

    // The server burns down.
    reset();
    expect(await buildEnvelope(init.slug, midRace, -1)).toBeNull();

    // The host pastes the signed code; the shell comes back, then the
    // restoring browser regenerates from the SAME committed seed and
    // re-uploads. The served bytes end up identical.
    const restored = await restoreRace(init.recoveryCode, midRace);
    expect(restored.slug).toBe(init.slug);
    expect(restored.existed).toBe(false);
    expect(restored.ready).toBe(false);
    expect(restored.seed).toBe(init.seed);
    const again = await buildUploadBody(
      'everest',
      restored.seed,
      restored.teams,
      restored.durationMs,
    );
    await acceptUpload(restored.slug, restored.seed, again.body);
    const after = await buildEnvelope(init.slug, midRace, -1);
    expect(after).toBe(before);

    // Restoring an existing race is a no-op.
    expect((await restoreRace(init.recoveryCode, midRace)).existed).toBe(true);
  });
});

describe('live height order', () => {
  it('pre-push: sorted by display position; wiped teams sink', () => {
    const t = generateEverest('height-1', { teams: teams(8), durationMs: 1_800_000 });
    const snap = toJourneySnapshot('everest', t, 1_800_000, { complete: true });
    const at = 0.5 * 1_800_000;
    const order = heightOrderAt(snap, 8, at);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let i = 1; i < order.length; i++) {
      expect(displayPosAt(snap, order[i - 1], at)).toBeGreaterThanOrEqual(
        displayPosAt(snap, order[i], at) - 1e-9,
      );
    }
    for (const w of t.wipeouts) {
      const o = heightOrderAt(snap, 8, w.tMs + 1);
      const wipedByThen = t.wipeouts
        .filter((x) => x.tMs <= w.tMs + 1)
        .map((x) => x.teamIdx);
      expect(o.slice(-wipedByThen.length).sort()).toEqual(wipedByThen.sort());
    }
  });
});
