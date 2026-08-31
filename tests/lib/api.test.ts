import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.SUMMIT_DB_PATH = ':memory:';

import { resetDbForTests } from '@/lib/db';
import {
  createRace,
  getRaceView,
  validateCreateInput,
  ValidationError,
} from '@/lib/races';
import { horizonFor, preLookaheadMs, pushLookaheadMs } from '@/lib/slice';

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

  it('scheduled races serve nothing but static config', () => {
    const { slug } = createRace(
      { teams: teams(6), durationMs: 600_000, title: 'Draft Night' },
      NOW,
    );
    const view = getRaceView(slug, NOW + 1_000)!;
    expect(view.status).toBe('scheduled');
    expect(view.config.teams).toHaveLength(6);
    expect(view.snapshot.complete).toBe(false);
    expect(view.snapshot.horizonMs).toBe(-1);
    expect(view.snapshot.events).toHaveLength(0);
    if (view.snapshot.theme !== 'everest') throw new Error('expected everest');
    expect(view.snapshot.grid.tMs).toHaveLength(0);
    expect(view.snapshot.checkpoints).toHaveLength(0);
    expect(view.snapshot.wipeouts).toHaveLength(0);
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
    expect(horizon).toBe(300_000 + preLookaheadMs(600_000));

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

  it('pre-push horizons are hard-capped at the push start (no convergence data early)', () => {
    const duration = 600_000;
    const { slug } = createRace(
      { teams: teams(6), durationMs: duration, startAtMs: NOW },
      NOW,
    );
    const view0 = getRaceView(slug, NOW)!;
    const pushStart = view0.snapshot.pushStartMs;
    for (const elapsed of [0, 100_000, pushStart - 10_000, pushStart - 1]) {
      const v = getRaceView(slug, NOW + elapsed)!;
      expect(v.snapshot.horizonMs).toBeLessThanOrEqual(pushStart);
      if (v.snapshot.theme !== 'everest') throw new Error('expected everest');
      expect(v.snapshot.wipeouts).toHaveLength(0); // wipes are all post-push
    }
  });

  it('a minimum-duration race no longer serves its whole timeline at t=0', () => {
    const { slug } = createRace(
      { teams: teams(6), durationMs: 60_000, startAtMs: NOW },
      NOW,
    );
    const v = getRaceView(slug, NOW + 100)!;
    expect(v.status).toBe('running');
    const snap = v.snapshot;
    if (snap.theme !== 'everest') throw new Error('expected everest');
    // Horizon covers only a few seconds — not the race.
    expect(snap.horizonMs).toBeLessThanOrEqual(preLookaheadMs(60_000) + 100);
    const lastGrid = snap.grid.tMs[snap.grid.tMs.length - 1] ?? 0;
    expect(lastGrid).toBeLessThan(snap.pushStartMs);
    // No team's served curve is anywhere near finished.
    for (const row of snap.grid.p) {
      for (const p of row) expect(p).toBeLessThan(0.9);
    }
  });

  it('push-phase lookahead is a few seconds, not the finale', () => {
    const duration = 600_000;
    const { slug } = createRace(
      { teams: teams(6), durationMs: duration, startAtMs: NOW },
      NOW,
    );
    const pushStart = getRaceView(slug, NOW)!.snapshot.pushStartMs;
    const elapsed = pushStart + 5_000;
    const v = getRaceView(slug, NOW + elapsed)!;
    expect(v.snapshot.horizonMs).toBe(
      Math.min(duration, elapsed + pushLookaheadMs(duration)),
    );
    expect(horizonFor(elapsed, duration, pushStart)).toBe(v.snapshot.horizonMs);
  });

  it('olympics: marquee result keyframes never ship early', () => {
    const duration = 300_000;
    const { slug } = createRace(
      {
        teams: teams(6),
        durationMs: duration,
        startAtMs: NOW,
        theme: 'olympics',
      },
      NOW,
    );
    // Pre-push: no marquee keyframes at all (they all end after pushStart).
    const pre = getRaceView(slug, NOW + 200_000)!;
    if (pre.snapshot.theme !== 'olympics') throw new Error('expected olympics');
    expect(pre.snapshot.horizonMs).toBeLessThanOrEqual(pre.snapshot.pushStartMs);
    // At 90% elapsed the closing keyframe (99.5%) is still unserved.
    const late = getRaceView(slug, NOW + duration * 0.9)!;
    if (late.snapshot.theme !== 'olympics') throw new Error('expected olympics');
    const maxServed = Math.max(
      0,
      ...late.snapshot.pointsKeyframes.map((f) => f.tMs),
    );
    expect(maxServed).toBeLessThan(duration * 0.995);
    expect(JSON.stringify(late)).not.toContain('"finalOrder"');
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
