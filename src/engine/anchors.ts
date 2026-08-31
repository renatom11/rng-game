import { forkRng, expRand } from './prng';
import { HOLD_P, type Checkpoint } from './types';

/**
 * Convert checkpoint standings into concrete per-team progress anchors.
 *
 * Progress is monotone (you cannot un-climb), so a slumping team's p cannot
 * drop — it stalls while others pass. Mid-race anchors therefore track the
 * standings loosely (assign ascending slot values by standings order, then
 * repair to be >= the previous anchor). Displayed standings pre-push come
 * from the checkpoint orders themselves, not from p, so the lag is invisible.
 *
 * The FINAL pre-push checkpoint is special: the whole field is packed into a
 * thin band just below HOLD_P (the South Col regroup) in exactly the
 * standings order, so the push phase starts from p values that agree with
 * the last displayed standings.
 */

/** Pack centroid B(u): where the middle of the field sits at race fraction u. */
export function packCentroid(u: number): number {
  const pts: [number, number][] = [
    [0.0, 0.0],
    [0.1, 0.13],
    [0.3, 0.3],
    [0.55, 0.47],
    [0.72, 0.59],
    [0.87, 0.682],
  ];
  if (u <= 0) return 0;
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i][0]) {
      const [u0, p0] = pts[i - 1];
      const [u1, p1] = pts[i];
      return p0 + ((u - u0) / (u1 - u0)) * (p1 - p0);
    }
  }
  return pts[pts.length - 1][1];
}

/** Field spread(u): how far apart the leaders and stragglers are at u. */
export function packSpread(u: number): number {
  if (u <= 0.05) return 0.06 * (u / 0.05);
  if (u <= 0.25) return 0.06 + 0.04 * ((u - 0.05) / 0.2);
  if (u <= 0.65) return 0.1;
  // shrink into the Col regroup
  return Math.max(0.012, 0.1 - 0.088 * ((u - 0.65) / 0.22));
}

const CEIL = HOLD_P - 0.002; // absolute ceiling for any pre-push anchor
const MID_CEIL = HOLD_P - 0.006; // ceiling for non-final checkpoints

export interface AnchorSet {
  /** anchors[teamIdx][k] = progress at checkpoint k. Monotone per team. */
  anchors: number[][];
}

export function buildAnchors(
  seedHex: string,
  nTeams: number,
  durationMs: number,
  checkpoints: Checkpoint[],
): AnchorSet {
  const rng = forkRng(seedHex, 'anchors');
  const K = checkpoints.length;
  const anchors: number[][] = Array.from({ length: nTeams }, () => []);

  for (let k = 0; k < K; k++) {
    const cp = checkpoints[k];
    const u = cp.tMs / durationMs;
    const isFinal = k === K - 1;
    // Standings worst-to-best so ascending assignment matches the order.
    const worstToBest = cp.order.slice().reverse();

    if (!isFinal) {
      const spread = packSpread(u);
      const b = packCentroid(u);
      // Ladder of slot values across the field (Dirichlet-ish gaps), then
      // assign each team INDEPENDENTLY: max(its slot, its own previous
      // anchor). A shared cursor that also repaired against other teams'
      // previous anchors compounds checkpoint over checkpoint and pins the
      // whole field at the ceiling for hours in long races — don't bring
      // that back. The cost is that p-ordering can lag the standings
      // mid-race, which is invisible: displayed standings come from the
      // checkpoint orders, not from p.
      const gaps = Array.from({ length: nTeams }, () => 0.25 + expRand(rng));
      const gapSum = gaps.reduce((a, g) => a + g, 0);
      const base = Math.max(0, b - spread / 2);
      let acc = 0;
      for (let j = 0; j < nTeams; j++) {
        const team = worstToBest[j];
        acc += (gaps[j] / gapSum) * spread;
        const prev = k === 0 ? 0 : anchors[team][k - 1];
        anchors[team].push(Math.min(Math.max(base + acc, prev), MID_CEIL));
      }
    } else {
      // South Col regroup: pack everyone in standings order into the thin
      // band (base, CEIL], where base clears every previous anchor.
      let base = 0;
      for (let i = 0; i < nTeams; i++) {
        base = Math.max(base, anchors[i][k - 1] ?? 0);
      }
      base = Math.min(base, MID_CEIL);
      const band = CEIL - base;
      for (let j = 0; j < nTeams; j++) {
        const team = worstToBest[j];
        const v = base + (band * (j + 1)) / nTeams;
        anchors[team].push(v);
      }
    }
  }

  return { anchors };
}
