import { beforeAll, describe, expect, it } from 'vitest';
import { generateOlympics } from '@/themes/olympics/generate';
import type { OlympicsTimeline } from '@/themes/olympics/types';
import { toOlympicsSnapshot } from '@/lib/slice';

function cfg(n: number, durationMs: number) {
  return {
    teams: Array.from({ length: n }, (_, i) => ({ name: `Nation ${i + 1}` })),
    durationMs,
  };
}

const N = 8;
const DUR = 1_800_000;
let runs: OlympicsTimeline[] = [];

beforeAll(() => {
  runs = [];
  for (let s = 0; s < 50; s++) {
    runs.push(generateOlympics(`oly-${s}`, cfg(N, DUR)));
  }
});

describe('olympics theme', () => {
  it('is deterministic', () => {
    const a = generateOlympics('same', cfg(6, 600_000));
    const b = generateOlympics('same', cfg(6, 600_000));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('one points keyframe per scheduled event, at its end time, ascending', () => {
    for (const t of runs) {
      expect(t.pointsKeyframes).toHaveLength(t.schedule.length);
      for (let k = 0; k < t.schedule.length; k++) {
        expect(t.pointsKeyframes[k].tMs).toBe(t.schedule[k].endMs);
        if (k > 0) {
          expect(t.schedule[k].endMs).toBeGreaterThan(t.schedule[k - 1].endMs);
        }
      }
    }
  });

  it('cumulative points realize the recorded order exactly, and never decrease', () => {
    for (const t of runs) {
      let prev: number[] | null = null;
      for (const f of t.pointsKeyframes) {
        const byPoints = Array.from({ length: N }, (_, i) => i).sort(
          (a, b) => f.points[b] - f.points[a] || a - b,
        );
        expect(byPoints).toEqual(f.order);
        for (let i = 0; i < N; i++) {
          expect(f.earned[i]).toBeGreaterThanOrEqual(0);
          if (prev) expect(f.points[i]).toBeGreaterThanOrEqual(prev[i]);
          expect(Number.isInteger(f.points[i])).toBe(true);
        }
        prev = f.points;
      }
    }
  });

  it('regular events conclude on the core checkpoints; the last event settles the final order', () => {
    for (const t of runs) {
      const regular = t.schedule.filter((e) => !e.marquee);
      expect(regular).toHaveLength(t.core.checkpoints.length);
      regular.forEach((ev, k) => {
        expect(ev.endMs).toBe(t.core.checkpoints[k].tMs);
        expect(t.pointsKeyframes[k].order).toEqual(t.core.checkpoints[k].order);
      });
      const last = t.pointsKeyframes[t.pointsKeyframes.length - 1];
      expect(last.order).toEqual(t.core.finalOrder);
    }
  });

  it('marquee convergence: displacement shrinks and gold is live until the closing event', () => {
    let goldChangedAtLast = 0;
    for (const t of runs) {
      const K = t.pointsKeyframes.length;
      const m2 = t.pointsKeyframes[K - 2];
      for (let i = 0; i < N; i++) {
        const dispM2 = Math.abs(m2.order.indexOf(i) - (t.core.finalRank[i] - 1));
        expect(dispM2).toBeLessThanOrEqual(3);
      }
      if (m2.order[0] !== t.core.finalOrder[0]) goldChangedAtLast++;
    }
    // In a healthy fraction of games the overall lead still flips at the end.
    expect(goldChangedAtLast).toBeGreaterThan(2);
  });

  it('live curves end on the event result ordering', () => {
    for (const t of runs.slice(0, 10)) {
      t.schedule.forEach((ev, k) => {
        const lv = t.live[k];
        const last = lv.tMs.length - 1;
        const byScore = Array.from({ length: N }, (_, i) => i).sort(
          (a, b) => lv.score[b][last] - lv.score[a][last] || a - b,
        );
        const byEarned = Array.from({ length: N }, (_, i) => i).sort(
          (a, b) =>
            t.pointsKeyframes[k].earned[b] - t.pointsKeyframes[k].earned[a] ||
            a - b,
        );
        expect(byScore).toEqual(byEarned);
      });
    }
  });

  it('event log has ceremonies, per-event beats, and no long silent gaps', () => {
    for (const t of runs.slice(0, 10)) {
      expect(t.events[0].type).toBe('ceremony_open');
      expect(t.events[t.events.length - 1].type).toBe('ceremony_close');
      const finishes = t.events.filter(
        (e) => e.type === 'event_finish' || e.type === 'upset',
      );
      expect(finishes.length).toBe(t.schedule.length);
      const times = t.events.map((e) => e.tMs);
      const maxGap = Math.max(45_000, DUR / 40);
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1]).toBeLessThanOrEqual(maxGap);
      }
      for (const e of t.events) {
        expect(e.text).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('spoiler slicing: mid-race snapshots leak no future results', () => {
    const t = runs[0];
    const mid = DUR * 0.5;
    const snap = toOlympicsSnapshot(t, mid, { complete: false });
    expect(snap.finalOrder).toBeUndefined();
    for (const f of snap.pointsKeyframes) {
      expect(f.tMs).toBeLessThanOrEqual(snap.horizonMs);
    }
    for (const e of snap.events) expect(e.tMs).toBeLessThanOrEqual(snap.horizonMs);
    for (const lv of snap.live) {
      for (const tm of lv?.tMs ?? []) expect(tm).toBeLessThanOrEqual(snap.horizonMs);
    }
    const json = JSON.stringify(snap);
    expect(json).not.toContain('"finalOrder"');
    // schedule metadata IS public
    expect(snap.schedule.length).toBe(t.schedule.length);

    const full = toOlympicsSnapshot(t, DUR, { complete: true });
    expect(full.finalOrder).toEqual(t.core.finalOrder);
  });

  it('uniform outcomes across seeds (spot check)', () => {
    const counts = new Array(4).fill(0);
    for (let s = 0; s < 400; s++) {
      const t = generateOlympics(`uni-${s}`, cfg(4, 120_000));
      counts[t.core.finalOrder[0]]++;
    }
    for (const c of counts) {
      expect(c).toBeGreaterThan(60); // expected 100 each
      expect(c).toBeLessThan(140);
    }
  });
});
