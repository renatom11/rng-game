import type { RNG } from '@/engine/prng';
import { shuffle, randInt } from '@/engine/prng';
import { gauss } from '@/engine/prng';
import type { Checkpoint, CoreTimeline } from '@/engine/types';
import {
  MARQUEE_SPORTS,
  SPORTS,
  type PointsKeyframe,
  type ScheduledEvent,
} from './types';

/**
 * Schedule, points, and live-curve construction.
 *
 * Regular events conclude exactly at the core's pre-push checkpoints, so the
 * cumulative points order realizes each checkpoint's standings. Three
 * marquee events land in the final phase; their concluding orders converge
 * on the true final order with shrinking displacement — the last one IS the
 * final order, so gold is decided by the closing event, naturally.
 */

export function buildSchedule(
  rng: RNG,
  durationMs: number,
  checkpoints: Checkpoint[],
): ScheduledEvent[] {
  const K = checkpoints.length;
  const sportPool = shuffle(rng, SPORTS.map((_, i) => i));
  const out: ScheduledEvent[] = [];
  let prevEnd = Math.round(durationMs * 0.015); // after the opening ceremony
  for (let k = 0; k < K; k++) {
    const endMs = checkpoints[k].tMs;
    out.push({
      sportIdx: sportPool[k % sportPool.length],
      startMs: Math.min(prevEnd, endMs - 1),
      endMs,
      marquee: false,
    });
    prevEnd = endMs + Math.max(500, Math.round(durationMs * 0.002));
  }
  // Marquee block: SPORTS indices continue past the pool into MARQUEE_SPORTS
  // (encoded as SPORTS.length + i).
  const marqueeEnds = [0.92, 0.96, 0.995].map((f) => Math.round(f * durationMs));
  const marqueeOrder = [0, 1, 2];
  marqueeEnds.forEach((endMs, i) => {
    out.push({
      sportIdx: SPORTS.length + marqueeOrder[i % MARQUEE_SPORTS.length],
      startMs: Math.min(prevEnd, endMs - 1),
      endMs,
      marquee: true,
    });
    prevEnd = endMs + Math.max(500, Math.round(durationMs * 0.002));
  });
  return out;
}

/** Orders the marquee events conclude on: converging to the final order. */
export function buildMarqueeOrders(
  rng: RNG,
  finalOrder: number[],
): number[][] {
  const n = finalOrder.length;
  // Disjoint adjacent swaps only (skip past a swapped pair), so one pass
  // displaces any team by at most 1 — a plain bubble pass can carry a team
  // several places and break the convergence bound.
  const perturb = (base: number[], passes: number, prob: number) => {
    let arr = base.slice();
    for (let p = 0; p < passes; p++) {
      const next = arr.slice();
      let i = 0;
      while (i < n - 1) {
        if (rng() < prob) {
          [next[i], next[i + 1]] = [next[i + 1], next[i]];
          i += 2;
        } else {
          i += 1;
        }
      }
      arr = next;
    }
    return arr;
  };
  return [
    perturb(finalOrder, 2, 0.4), // displacement ≤ 2
    perturb(finalOrder, 1, 0.3), // displacement ≤ 1
    finalOrder.slice(), // the closing event settles it exactly
  ];
}

/**
 * Integer cumulative points realizing each concluding order.
 * Same monotone-repair trick as the Everest anchors: assign ascending
 * values worst→best; a team's total can never decrease, so a slumping
 * leader keeps their pile while others catch up.
 */
export function buildPointsKeyframes(
  rng: RNG,
  schedule: ScheduledEvent[],
  orders: number[][],
  nTeams: number,
): PointsKeyframe[] {
  const frames: PointsKeyframe[] = [];
  let prev = new Array(nTeams).fill(0);
  schedule.forEach((ev, k) => {
    const order = orders[k];
    const weight = ev.marquee
      ? 2.2 + 0.4 * (k - (schedule.length - 3))
      : 1 + (0.6 * k) / Math.max(1, schedule.length - 4);
    const worstToBest = order.slice().reverse();
    const next = new Array(nTeams).fill(0);
    let cursor = 0;
    for (const team of worstToBest) {
      const gap = 1 + randInt(rng, 0, Math.max(1, Math.round(5 * weight)));
      cursor = Math.max(cursor + gap, prev[team] + 1);
      next[team] = cursor;
    }
    frames.push({
      tMs: ev.endMs,
      order,
      points: next,
      earned: next.map((v, i) => v - prev[i]),
    });
    prev = next;
  });
  return frames;
}

/**
 * Within-event live performance curves: noisy early, converging to the
 * event's actual result (ranking by earned points) at its end.
 */
export function buildLiveCurves(
  rng: RNG,
  schedule: ScheduledEvent[],
  frames: PointsKeyframe[],
  nTeams: number,
): { tMs: number[]; score: number[][] }[] {
  return schedule.map((ev, k) => {
    const span = ev.endMs - ev.startMs;
    const m = Math.max(8, Math.min(28, Math.round(span / 20_000)));
    const tMs: number[] = [];
    for (let i = 0; i <= m; i++) {
      tMs.push(Math.round(ev.startMs + (span * i) / m));
    }
    // Target: z-scores by earned ranking (higher earned = higher target).
    const earned = frames[k].earned;
    const byEarned = Array.from({ length: nTeams }, (_, i) => i).sort(
      (a, b) => earned[b] - earned[a] || a - b,
    );
    const target = new Array(nTeams).fill(0);
    byEarned.forEach((team, rank0) => {
      target[team] = (nTeams - 1 - 2 * rank0) / Math.max(1, nTeams - 1); // +1 … −1
    });
    const z = Array.from({ length: nTeams }, () => gauss(rng) * 0.7);
    const score: number[][] = Array.from({ length: nTeams }, () => []);
    for (let i = 0; i <= m; i++) {
      const v = i / m;
      const w = v >= 1 ? 1 : 0.15 + 0.85 * v * v * (3 - 2 * v);
      for (let team = 0; team < nTeams; team++) {
        z[team] = 0.82 * z[team] + 0.4 * gauss(rng) * (1 - v);
        const s = v >= 1 ? target[team] : (1 - w) * z[team] + w * target[team];
        score[team].push(Math.round(s * 1000) / 1000);
      }
    }
    return { tMs, score };
  });
}

/** Sport lookup that spans the regular and marquee pools. */
export function sportAt(sportIdx: number) {
  return sportIdx >= SPORTS.length
    ? MARQUEE_SPORTS[sportIdx - SPORTS.length]
    : SPORTS[sportIdx];
}

/** Sanity helper for tests: last frame's order must equal the final order. */
export function lastOrderMatches(core: CoreTimeline, frames: PointsKeyframe[]): boolean {
  const last = frames[frames.length - 1];
  return JSON.stringify(last.order) === JSON.stringify(core.finalOrder);
}
