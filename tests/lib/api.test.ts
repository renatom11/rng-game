import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.SUMMIT_DB_PATH = ':memory:';

import { resetDbForTests } from '@/lib/db';
import {
  createRace,
  getRaceView,
  validateCreateInput,
  ValidationError,
} from '@/lib/races';
import { LOOKAHEAD_MS } from '@/lib/slice';

const NOW = 1_700_000_000_000;

function teams(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `Team ${i + 1}` }));
}

beforeAll(() => resetDbForTests());
afterAll(() => resetDbForTests());

describe('race storage & spoiler-proof serving', () => {
  it('validates input', () => {
    expect(() => validateCreateInput({ teams: teams(1), durationMs: 60_000 }, NOW)).toThrow(ValidationError);
    expect(() => validateCreateInput({ teams: teams(51), durationMs: 60_000 }, NOW)).toThrow(ValidationError);
    expect(() => validateCreateInput({ teams: teams(4), durationMs: 30_000 }, NOW)).toThrow(ValidationError);
    expect(() => validateCreateInput({ teams: teams(4), durationMs: 9 * 3_600_000 }, NOW)).toThrow(ValidationError);
    expect(() =>
      validateCreateInput(
        { teams: [{ name: 'A' }, { name: 'a' }], durationMs: 60_000 },
        NOW,
      ),
    ).toThrow(/duplicate/);
    const ok = validateCreateInput({ teams: teams(4), durationMs: 300_000 }, NOW);
    expect(ok.startAtMs).toBe(NOW + 60_000);
  });

  it('create -> fetch round trip, scheduled state', () => {
    const { slug } = createRace(
      { teams: teams(6), durationMs: 600_000, title: 'Draft Night' },
      NOW,
    );
    const view = getRaceView(slug, NOW + 1_000)!;
    expect(view.status).toBe('scheduled');
    expect(view.config.title).toBe('Draft Night');
    expect(view.config.teams).toHaveLength(6);
    // scheduled: nothing beyond the lookahead from t=0 leaks
    expect(view.snapshot.complete).toBe(false);
    expect(view.snapshot.horizonMs).toBeLessThanOrEqual(LOOKAHEAD_MS);
  });

  it('mid-race truncation never leaks the future or the outcome', () => {
    const { slug } = createRace(
      { teams: teams(8), durationMs: 600_000, startAtMs: NOW },
      NOW,
    );
    const midNow = NOW + 300_000; // halfway
    const view = getRaceView(slug, midNow)!;
    expect(view.status).toBe('running');
    const snap = view.snapshot;
    if (snap.theme !== 'everest') throw new Error('expected everest snapshot');
    const horizon = snap.horizonMs;
    expect(horizon).toBe(300_000 + LOOKAHEAD_MS);

    expect(snap.finalOrder).toBeUndefined();
    expect(snap.finalRank).toBeUndefined();
    expect(snap.summitTimesMs).toBeUndefined();
    for (const e of snap.events) expect(e.tMs).toBeLessThanOrEqual(horizon);
    for (const c of snap.checkpoints) expect(c.tMs).toBeLessThanOrEqual(horizon);
    for (const w of snap.wipeouts) expect(w.tMs).toBeLessThanOrEqual(horizon);
    for (const t of snap.grid.tMs) expect(t).toBeLessThanOrEqual(horizon);
    for (const t of snap.displayTrack.tMs) expect(t).toBeLessThanOrEqual(horizon);
    for (const t of snap.meters.tMs) expect(t).toBeLessThanOrEqual(horizon);
    expect(snap.grid.p[0].length).toBe(snap.grid.tMs.length);
    expect(snap.displayTrack.pos[0].length).toBe(snap.displayTrack.tMs.length);

    // Deep scan: the serialized payload must not contain outcome keys.
    const json = JSON.stringify(view);
    expect(json).not.toContain('"finalOrder"');
    expect(json).not.toContain('"finalRank"');
    expect(json).not.toContain('"summitTimesMs"');
  });

  it('finished races disclose everything', () => {
    const { slug } = createRace(
      { teams: teams(5), durationMs: 600_000, startAtMs: NOW },
      NOW,
    );
    const view = getRaceView(slug, NOW + 600_001)!;
    expect(view.status).toBe('finished');
    expect(view.snapshot.complete).toBe(true);
    expect(view.snapshot.finalOrder).toHaveLength(5);
    if (view.snapshot.theme !== 'everest') throw new Error('expected everest');
    expect(view.snapshot.summitTimesMs).toHaveLength(5);
    const lastEvent = view.snapshot.events[view.snapshot.events.length - 1];
    expect(lastEvent.type).toBe('race_finish');
  });

  it('demo races are fully disclosed from the start', () => {
    const { slug } = createRace(
      { teams: teams(4), durationMs: 600_000, demo: true },
      NOW,
    );
    const view = getRaceView(slug, NOW + 1_000)!;
    expect(view.config.demo).toBe(true);
    expect(view.snapshot.complete).toBe(true);
    expect(view.snapshot.finalOrder).toHaveLength(4);
  });

  it('unknown slug returns null', () => {
    expect(getRaceView('nope-nope', NOW)).toBeNull();
  });

  it('grid/meters/events lengths are consistent as the horizon advances', () => {
    const { slug } = createRace(
      { teams: teams(6), durationMs: 300_000, startAtMs: NOW },
      NOW,
    );
    let prevEvents = -1;
    for (const dt of [30_000, 90_000, 150_000, 240_000]) {
      const v = getRaceView(slug, NOW + dt)!;
      if (v.snapshot.theme !== 'everest') throw new Error('expected everest');
      expect(v.snapshot.events.length).toBeGreaterThanOrEqual(prevEvents);
      prevEvents = v.snapshot.events.length;
      expect(v.snapshot.meters.values[0][0].length).toBe(v.snapshot.meters.tMs.length);
    }
  });
});
