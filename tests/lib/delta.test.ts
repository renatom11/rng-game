import { describe, expect, it } from 'vitest';
import { generateEverest } from '@/themes/everest/generate';
import {
  toEverestSnapshot,
  horizonFor,
} from '@/lib/slice';
import { mergeSnapshot } from '@/lib/client/mergeSnapshot';

/**
 * The delta contract: a client holding full(t1) that applies delta(t1→t2)
 * must end up byte-identical to full(t2). This exercises the exact merge
 * code the browser runs.
 */

const DUR = 600_000;

function teams(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `Team ${i + 1}` }));
}

describe('delta snapshots', () => {
  const everest = generateEverest('delta-ev', { teams: teams(7), durationMs: DUR });
  const pushStart = everest.core.pushStartMs;

  const PAIRS: [number, number][] = [
    [30_000, 90_000],
    [90_000, 300_000],
    [300_000, pushStart - 5_000],
    [pushStart - 5_000, pushStart + 8_000], // crossing into the push
    [pushStart + 8_000, pushStart + 30_000],
    [100_000, 100_000], // empty delta
  ];

  it('everest: full(t2) === merge(full(t1), delta(t1→t2))', () => {
    for (const [e1, e2] of PAIRS) {
      const full1 = toEverestSnapshot(everest, e1, { complete: false });
      const full2 = toEverestSnapshot(everest, e2, { complete: false });
      const delta = toEverestSnapshot(everest, e2, {
        complete: false,
        sinceMs: full1.horizonMs,
      });
      const merged = mergeSnapshot(full1, delta);
      expect(merged).not.toBeNull();
      expect(merged).toEqual(full2);
    }
  });

  it('deltas omit static fields and respect the window on both sides', () => {
    const e1 = 120_000;
    const e2 = 200_000;
    const since = horizonFor(e1, DUR, pushStart);
    const delta = toEverestSnapshot(everest, e2, { complete: false, sinceMs: since });
    expect(delta.sinceMs).toBe(since);
    expect(delta.climbers).toHaveLength(0);
    expect(delta.styles).toHaveLength(0);
    expect(delta.colors).toHaveLength(0);
    for (const e of delta.events) {
      expect(e.tMs).toBeGreaterThan(since);
      expect(e.tMs).toBeLessThanOrEqual(delta.horizonMs);
    }
    for (const t of delta.grid.tMs) {
      expect(t).toBeGreaterThan(since);
      expect(t).toBeLessThanOrEqual(delta.horizonMs);
    }
    expect(JSON.stringify(delta)).not.toContain('"finalOrder"');
  });

  it('a cursor beyond the horizon falls back to a full snapshot', () => {
    const snap = toEverestSnapshot(everest, 60_000, {
      complete: false,
      sinceMs: 5_000_000, // way past the current horizon
    });
    expect(snap.sinceMs).toBe(-1);
    expect(snap.climbers.length).toBeGreaterThan(0);
  });

  it('merge rejects non-chaining deltas', () => {
    const full1 = toEverestSnapshot(everest, 60_000, { complete: false });
    const badDelta = toEverestSnapshot(everest, 200_000, {
      complete: false,
      sinceMs: full1.horizonMs + 1_000, // gap
    });
    expect(mergeSnapshot(full1, badDelta)).toBeNull();
  });

  it('a complete snapshot always replaces', () => {
    const full1 = toEverestSnapshot(everest, 60_000, { complete: false });
    const done = toEverestSnapshot(everest, DUR, { complete: true });
    expect(mergeSnapshot(full1, done)).toBe(done);
  });

  it('delta payloads are much smaller than full snapshots', () => {
    const full = toEverestSnapshot(everest, 300_000, { complete: false });
    const delta = toEverestSnapshot(everest, 310_000, {
      complete: false,
      sinceMs: full.horizonMs,
    });
    const fullSize = JSON.stringify(full).length;
    const deltaSize = JSON.stringify(delta).length;
    expect(deltaSize).toBeLessThan(fullSize / 5);
  });
});
