/**
 * Core engine types — theme-agnostic.
 *
 * The core deals in one abstraction: N teams whose scalar progress
 * p ∈ [0, 1] must be monotone, start together, and arrive at 1 in a
 * predetermined uniformly-random order, with standings that stay genuinely
 * open until the final push. Themes translate p and the standings into
 * mountains, medals, or anything else.
 */

export interface CoreParams {
  nTeams: number;
  durationMs: number;
}

/** Where the field is "held" before the final push (Everest: Camp IV). */
export const HOLD_P = 0.695;

/** Fraction of the race after which convergence to the true order begins. */
export const PUSH_U = 0.87;

export interface Checkpoint {
  tMs: number;
  /** order[0] = current leader (team index), order[N-1] = current last. */
  order: number[];
}

export interface CoreTimeline {
  /** finalOrder[0] = winner's team index. THE fair random result. */
  finalOrder: number[];
  /** finalRank[teamIdx] = placement 1..N. Derived from finalOrder. */
  finalRank: number[];
  /** Per team index: when p reaches exactly 1, in ms from race start. */
  summitTimesMs: number[];
  pushStartMs: number;
  /** Pre-push standings checkpoints (secret while running; used by tests/themes). */
  checkpoints: Checkpoint[];
  /**
   * Shared time grid with per-team progress. grid.p[teamIdx][i] corresponds
   * to grid.tMs[i]. Monotone non-decreasing per team; clamped to [0, 1].
   */
  grid: {
    tMs: number[];
    p: number[][];
  };
}

/**
 * Rank teams by progress at a grid index: returns team indices, leader
 * first. Teams that have finished (p = 1) tie on progress, so pass
 * summitTimesMs to rank them by arrival — without it, finished teams would
 * collapse to team-index order and contradict the real result.
 */
export function rankAtGridIndex(
  grid: CoreTimeline['grid'],
  i: number,
  summitTimesMs?: number[],
): number[] {
  const idx = grid.p.map((_, team) => team);
  idx.sort((a, b) => {
    const d = grid.p[b][i] - grid.p[a][i];
    if (d !== 0) return d;
    if (summitTimesMs) return summitTimesMs[a] - summitTimesMs[b];
    return a - b;
  });
  return idx;
}

/** Linear interpolation of team progress at an arbitrary time. */
export function progressAt(
  grid: CoreTimeline['grid'],
  teamIdx: number,
  tMs: number,
): number {
  const t = grid.tMs;
  const p = grid.p[teamIdx];
  if (tMs <= t[0]) return p[0];
  const last = t.length - 1;
  if (tMs >= t[last]) return p[last];
  // binary search for the segment containing tMs
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= tMs) lo = mid;
    else hi = mid;
  }
  const span = t[hi] - t[lo];
  if (span <= 0) return p[hi];
  const f = (tMs - t[lo]) / span;
  return p[lo] + (p[hi] - p[lo]) * f;
}
