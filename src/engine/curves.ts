import { forkRng, expRand } from './prng';
import type { AnchorSet } from './anchors';
import type { Checkpoint } from './types';

/**
 * Pre-push curve texture: between consecutive anchors, subdivide into noisy
 * monotone sub-keyframes (surges and plateaus) that land exactly on the next
 * anchor. Returns per-team keyframe polylines covering [0, pushStart].
 */
export function prePushKeyframes(
  seedHex: string,
  nTeams: number,
  durationMs: number,
  checkpoints: Checkpoint[],
  anchorSet: AnchorSet,
): { tMs: number[]; p: number[] }[] {
  const rng = forkRng(seedHex, 'pre-push-texture');
  const subSpacing = Math.max(1000, durationMs / 600);
  const out: { tMs: number[]; p: number[] }[] = [];

  for (let team = 0; team < nTeams; team++) {
    const tArr: number[] = [0];
    const pArr: number[] = [0];
    let prevT = 0;
    let prevP = 0;
    for (let k = 0; k < checkpoints.length; k++) {
      const t1 = checkpoints[k].tMs;
      const p1 = anchorSet.anchors[team][k];
      const segSpan = t1 - prevT;
      const m = Math.max(1, Math.min(30, Math.floor(segSpan / subSpacing)));
      if (m > 1 && p1 > prevP) {
        // Noisy increments: exp draws, a quarter of them zeroed (plateaus).
        const incs: number[] = [];
        let sum = 0;
        for (let j = 0; j < m; j++) {
          // Clamp so a single sub-interval can't swallow an outsized share
          // of a big anchor delta (reads as teleporting on the map).
          const inc = rng() < 0.25 ? 0 : Math.min(2.5, expRand(rng));
          incs.push(inc);
          sum += inc;
        }
        if (sum <= 0) {
          incs[incs.length - 1] = 1;
          sum = 1;
        }
        let acc = 0;
        for (let j = 0; j < m - 1; j++) {
          acc += incs[j];
          tArr.push(Math.round(prevT + (segSpan * (j + 1)) / m));
          pArr.push(prevP + (p1 - prevP) * (acc / sum));
        }
      }
      tArr.push(t1);
      pArr.push(p1);
      prevT = t1;
      prevP = p1;
    }
    out.push({ tMs: tArr, p: pArr });
  }
  return out;
}

/** Evaluate a keyframe polyline at time tMs (linear interpolation). */
export function evalKeyframes(
  kf: { tMs: number[]; p: number[] },
  tMs: number,
): number {
  const t = kf.tMs;
  const p = kf.p;
  if (tMs <= t[0]) return p[0];
  const last = t.length - 1;
  if (tMs >= t[last]) return p[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= tMs) lo = mid;
    else hi = mid;
  }
  const span = t[hi] - t[lo];
  if (span <= 0) return p[hi];
  return p[lo] + ((tMs - t[lo]) / span) * (p[hi] - p[lo]);
}

/** Build the shared time grid: uniform samples ∪ structural times. */
export function buildGridTimes(
  durationMs: number,
  checkpoints: Checkpoint[],
  pushStartMs: number,
  summitTimesMs: number[],
): number[] {
  const count = Math.min(1800, Math.max(240, Math.round(durationMs / 4000)));
  const set = new Set<number>();
  for (let i = 0; i <= count; i++) {
    set.add(Math.round((durationMs * i) / count));
  }
  for (const cp of checkpoints) set.add(cp.tMs);
  set.add(pushStartMs);
  for (const ts of summitTimesMs) set.add(ts);
  set.add(durationMs);
  return Array.from(set).sort((a, b) => a - b);
}
