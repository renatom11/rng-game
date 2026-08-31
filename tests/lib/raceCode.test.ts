import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.SUMMIT_DB_PATH = ':memory:';

import { resetDbForTests } from '@/lib/db';
import { createRace, getRaceView, restoreRace } from '@/lib/races';
import { decodeRaceCode, encodeRaceCode, RaceCodeError } from '@/lib/raceCode';
import { heightOrderAt, displayPosAt } from '@/lib/client/raceState';
import { generateEverest } from '@/themes/everest/generate';
import { toJourneySnapshot } from '@/lib/slice';

const NOW = 1_700_000_000_000;

function teams(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `Team ${i + 1}` }));
}

beforeAll(() => resetDbForTests());
afterAll(() => resetDbForTests());

describe('recovery codes', () => {
  it('round-trips and rejects tampering', () => {
    const payload = {
      v: 1 as const,
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
    const code = encodeRaceCode(payload);
    expect(decodeRaceCode(code)).toEqual(payload);
    expect(decodeRaceCode(`  ${code}\n`)).toEqual(payload); // whitespace-tolerant
    expect(() => decodeRaceCode(code.slice(0, -1) + 'X')).toThrow(RaceCodeError);
    expect(() => decodeRaceCode('SMT1.garbage.12345678')).toThrow(RaceCodeError);
    expect(() => decodeRaceCode('hello')).toThrow(RaceCodeError);
  });

  it('restores a crashed race byte-identically, same slug, mid-flight', () => {
    const { slug, recoveryCode } = createRace(
      { teams: teams(6), durationMs: 3_600_000, startAtMs: NOW + 60_000, title: 'Crash Test' },
      NOW,
    );
    const midRace = NOW + 60_000 + 1_200_000;
    const before = getRaceView(slug, midRace);
    expect(before).not.toBeNull();

    // The server burns down.
    resetDbForTests();
    expect(getRaceView(slug, midRace)).toBeNull();

    // The host pastes the code — restore is exact and lands mid-race.
    const restored = restoreRace(recoveryCode, midRace);
    expect(restored.slug).toBe(slug);
    expect(restored.existed).toBe(false);
    const after = getRaceView(slug, midRace);
    expect(after).not.toBeNull();
    expect(after!.startAt).toBe(before!.startAt);
    expect(after!.status).toBe('running');
    expect(JSON.stringify(after!.snapshot)).toBe(JSON.stringify(before!.snapshot));

    // Restoring again is a no-op.
    expect(restoreRace(recoveryCode, midRace).existed).toBe(true);
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
    // After a wipe, wiped teams occupy the bottom of the order.
    for (const w of t.wipeouts) {
      const o = heightOrderAt(snap, 8, w.tMs + 1);
      const wipedByThen = t.wipeouts
        .filter((x) => x.tMs <= w.tMs + 1)
        .map((x) => x.teamIdx);
      expect(o.slice(-wipedByThen.length).sort()).toEqual(wipedByThen.sort());
    }
  });
});
