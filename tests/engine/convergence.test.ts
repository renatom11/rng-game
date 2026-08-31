import { beforeAll, describe, expect, it } from 'vitest';
import { generateCore, HOLD_P } from '@/engine';
import type { CoreTimeline } from '@/engine';

const N = 8;
const SEEDS = 200;
const DUR = 1_800_000; // 30 min

let runs: CoreTimeline[] = [];

beforeAll(() => {
  runs = [];
  for (let s = 0; s < SEEDS; s++) {
    runs.push(generateCore(`conv-${s}`, { nTeams: N, durationMs: DUR }));
  }
});

/** Rank teams at grid index i: p desc; ties at p=1 broken by summit time. */
function ranksAt(t: CoreTimeline, gi: number): number[] {
  const idx = Array.from({ length: N }, (_, i) => i);
  idx.sort((a, b) => {
    const pa = t.grid.p[a][gi];
    const pb = t.grid.p[b][gi];
    if (pa !== pb) return pb - pa;
    return t.summitTimesMs[a] - t.summitTimesMs[b];
  });
  const rank: number[] = new Array(N);
  idx.forEach((team, r) => (rank[team] = r + 1));
  return rank;
}

function gridIndexAtPushFraction(t: CoreTimeline, v: number): number {
  const lastSummit = Math.max(...t.summitTimesMs);
  const target = t.pushStartMs + v * (lastSummit - t.pushStartMs);
  let best = 0;
  for (let i = 0; i < t.grid.tMs.length; i++) {
    if (t.grid.tMs[i] <= target) best = i;
    else break;
  }
  return best;
}

describe('convergence & curves', () => {
  it('teams summit in exactly the predetermined order, p hits 1 exactly then', () => {
    for (const t of runs) {
      const bySummit = Array.from({ length: N }, (_, i) => i).sort(
        (a, b) => t.summitTimesMs[a] - t.summitTimesMs[b],
      );
      expect(bySummit).toEqual(t.finalOrder);
      for (let i = 0; i < N; i++) {
        const gi = t.grid.tMs.indexOf(t.summitTimesMs[i]);
        expect(gi).toBeGreaterThan(-1);
        expect(t.grid.p[i][gi]).toBe(1);
        if (gi > 0) expect(t.grid.p[i][gi - 1]).toBeLessThan(1);
      }
    }
  });

  it('curves are monotone, within [0,1], and never teleport', () => {
    for (const t of runs) {
      const dt = t.grid.tMs;
      for (let i = 0; i < N; i++) {
        const row = t.grid.p[i];
        expect(row[0]).toBe(0);
        for (let j = 1; j < row.length; j++) {
          expect(row[j]).toBeGreaterThanOrEqual(row[j - 1]);
          expect(row[j]).toBeLessThanOrEqual(1);
          const stepMs = dt[j] - dt[j - 1];
          // Teleport guard: no more than 3.5% progress per grid step for
          // steps at the normal cadence (structural extra points can be
          // arbitrarily close together, which makes the increment tiny).
          if (stepMs >= 1000) {
            expect(row[j] - row[j - 1]).toBeLessThanOrEqual(0.035);
          }
        }
      }
    }
  });

  it('pre-push progress stays below the hold point', () => {
    for (const t of runs) {
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < t.grid.tMs.length; j++) {
          if (t.grid.tMs[j] > t.pushStartMs) break;
          expect(t.grid.p[i][j]).toBeLessThan(HOLD_P);
        }
      }
    }
  });

  it('p-ordering at push start matches the last checkpoint standings exactly', () => {
    for (const t of runs) {
      const gi = t.grid.tMs.indexOf(t.pushStartMs);
      expect(gi).toBeGreaterThan(-1);
      const byP = Array.from({ length: N }, (_, i) => i).sort(
        (a, b) => t.grid.p[b][gi] - t.grid.p[a][gi],
      );
      const lastCp = t.checkpoints[t.checkpoints.length - 1];
      expect(byP).toEqual(lastCp.order);
    }
  });

  it('late push is nearly settled: rank error <= 2 at v=0.9, <= 1 at v=0.96', () => {
    for (const t of runs) {
      for (const [v, bound] of [
        [0.9, 2],
        [0.96, 1],
      ] as const) {
        const gi = gridIndexAtPushFraction(t, v);
        const ranks = ranksAt(t, gi);
        for (let i = 0; i < N; i++) {
          expect(Math.abs(ranks[i] - t.finalRank[i])).toBeLessThanOrEqual(bound);
        }
      }
    }
  });

  it('drama exists: most races change p-leader inside the push', () => {
    let withLeadChange = 0;
    for (const t of runs) {
      const winner = t.finalOrder[0];
      let changed = false;
      for (let j = 0; j < t.grid.tMs.length; j++) {
        if (t.grid.tMs[j] <= t.pushStartMs) continue;
        const ranks = ranksAt(t, j);
        if (ranks[winner] !== 1) {
          changed = true;
          break;
        }
      }
      if (changed) withLeadChange++;
    }
    expect(withLeadChange / SEEDS).toBeGreaterThan(0.5);
  });

  it('summit times sit inside the late window, are distinct, and the finish envelope varies', () => {
    const lastFractions = new Set<number>();
    for (const t of runs) {
      const sorted = t.summitTimesMs.slice().sort((a, b) => a - b);
      expect(sorted[0]).toBeGreaterThan(0.9 * DUR);
      expect(sorted[N - 1]).toBeLessThanOrEqual(0.9975 * DUR);
      for (let i = 1; i < N; i++) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(50);
      }
      lastFractions.add(Math.round((sorted[N - 1] / DUR) * 1000));
    }
    // The last summit must NOT land at one scripted constant across races.
    expect(lastFractions.size).toBeGreaterThan(5);
  });

  it('photo finishes occur even with two teams', () => {
    let close = 0;
    for (let s = 0; s < 120; s++) {
      const t = generateCore(`duel-${s}`, { nTeams: 2, durationMs: 600_000 });
      const gap = Math.abs(t.summitTimesMs[0] - t.summitTimesMs[1]);
      if (gap <= 2_000) close++;
      expect(gap).toBeGreaterThan(0);
    }
    expect(close).toBeGreaterThan(5);
  });

  it('long races: the field is not pinned at the pre-push ceiling for hours', () => {
    for (const dur of [28_800_000, 86_400_000]) {
      const t = generateCore('long-haul', { nTeams: 10, durationMs: dur });
      // At halfway, nobody should already be parked at the Col ceiling.
      const gi = t.grid.tMs.findIndex((x) => x >= dur / 2);
      for (let i = 0; i < 10; i++) {
        expect(t.grid.p[i][gi]).toBeLessThan(0.62);
      }
    }
  });
});
