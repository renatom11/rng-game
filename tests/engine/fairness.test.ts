import { beforeAll, describe, expect, it } from 'vitest';
import { generateCore } from '@/engine';
import type { CoreTimeline } from '@/engine';

/**
 * Statistical fairness over 3000 seeds, N=6:
 * - uniformity of the final placement distribution (chi-square)
 * - pairwise head-to-head balance
 * - reachability: at the last pre-push checkpoint, every
 *   (current rank, final rank) pair actually occurs.
 */

const N = 6;
const SEEDS = 3000;

let runs: CoreTimeline[] = [];

beforeAll(() => {
  runs = [];
  for (let s = 0; s < SEEDS; s++) {
    runs.push(generateCore(`fair-${s}`, { nTeams: N, durationMs: 120_000 }));
  }
});

describe('fairness', () => {
  it('final placements are uniform (chi-square over placement matrix)', () => {
    const counts: number[][] = Array.from({ length: N }, () =>
      new Array(N).fill(0),
    );
    for (const t of runs) {
      t.finalOrder.forEach((teamIdx, place) => counts[teamIdx][place]++);
    }
    const expected = SEEDS / N;
    let chi2 = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        chi2 += (counts[i][j] - expected) ** 2 / expected;
      }
    }
    // df = 25; 60 is far beyond the 0.999 quantile (~52.6).
    expect(chi2).toBeLessThan(60);
  });

  it('pairwise head-to-head probabilities are balanced', () => {
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let iAhead = 0;
        for (const t of runs) {
          if (t.finalRank[i] < t.finalRank[j]) iAhead++;
        }
        const frac = iAhead / SEEDS;
        expect(frac).toBeGreaterThan(0.46);
        expect(frac).toBeLessThan(0.54);
      }
    }
  });

  it('reachability: every (rank at last pre-push checkpoint -> final rank) occurs', () => {
    const cells: number[][] = Array.from({ length: N }, () =>
      new Array(N).fill(0),
    );
    for (const t of runs) {
      const lastCp = t.checkpoints[t.checkpoints.length - 1];
      lastCp.order.forEach((teamIdx, rank0) => {
        cells[rank0][t.finalRank[teamIdx] - 1]++;
      });
    }
    for (let r = 0; r < N; r++) {
      for (let f = 0; f < N; f++) {
        expect(cells[r][f], `cell rank=${r + 1} final=${f + 1}`).toBeGreaterThan(0);
      }
    }
  });

  it('the pre-push signal is weak-but-real', () => {
    // Leader at the last pre-push checkpoint should win more often than
    // chance (signal exists) but far from always (signal is weak).
    let leaderWins = 0;
    for (const t of runs) {
      const lastCp = t.checkpoints[t.checkpoints.length - 1];
      if (lastCp.order[0] === t.finalOrder[0]) leaderWins++;
    }
    const frac = leaderWins / SEEDS;
    expect(frac).toBeGreaterThan(1 / N); // better than chance...
    expect(frac).toBeLessThan(0.5); // ...but nowhere near decided
  });
});
