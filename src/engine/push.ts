import { forkRng, expRand, gauss, randInt } from './prng';
import { HOLD_P, PUSH_U } from './types';

/**
 * The summit push: the final ~13% of the race, where the field converges to
 * the predetermined order.
 *
 * Construction guarantees convergence without a repair loop:
 * - Summit times are staggered inside a late window; their order IS the
 *   final ranking.
 * - Every team climbs the same easing curve F, differing only in time
 *   scale, so base curves never cross: the base ordering during the push
 *   already equals the final ordering.
 * - All drama is bounded perturbation on top: a "carry" term honoring the
 *   pre-push standings that decays by mid-push, per-team stall windows
 *   (rope queues, O2 changes), and OU noise whose amplitude and crossing
 *   allowance shrink as teams near the summit — early push scrambles,
 *   endgame only adjacent-place twists.
 */

export interface PushPlan {
  pushStartMs: number;
  /** per team index */
  summitTimesMs: number[];
  /** per team: monotone time-warp knots for stalls, in local time */
  stallWarps: { v: number; w: number }[][];
}

export function buildPushPlan(
  seedHex: string,
  nTeams: number,
  durationMs: number,
  finalOrder: number[],
): PushPlan {
  const rng = forkRng(seedHex, 'summit');
  const pushStartMs = Math.round(PUSH_U * durationMs);

  // Summit window: starts ~93% (jittered), ends 99.5%.
  const windowStart =
    Math.round((0.93 + (rng() * 2 - 1) * 0.01) * durationMs);
  const windowEnd = Math.round(0.995 * durationMs);

  // Gaps between consecutive summits; occasional photo-finish squeezes.
  const gaps: number[] = [];
  for (let i = 0; i < nTeams - 1; i++) {
    let g = 0.4 + expRand(rng);
    if (rng() < 0.25) g = 0.1; // photo finish
    gaps.push(g);
  }
  const gapSum = gaps.reduce((a, g) => a + g, 0) || 1;
  const span = windowEnd - windowStart;
  const minGap = Math.max(300, 0.003 * durationMs);

  const times: number[] = [windowStart];
  for (let i = 0; i < gaps.length; i++) {
    times.push(times[i] + Math.max(minGap, (gaps[i] / gapSum) * span));
  }
  // If minGap enforcement overshot the window, compress back inside it.
  const overshoot = times[times.length - 1] - windowEnd;
  if (overshoot > 0) {
    const scale = (windowEnd - windowStart) / (times[times.length - 1] - windowStart);
    for (let i = 1; i < times.length; i++) {
      times[i] = windowStart + (times[i] - windowStart) * scale;
    }
  }

  const summitTimesMs: number[] = new Array(nTeams).fill(0);
  finalOrder.forEach((teamIdx, rank0) => {
    summitTimesMs[teamIdx] = Math.round(times[rank0]);
  });

  // Stall windows per team: 0–2 flat spots in local progress v ∈ (0.15, 0.75),
  // expressed as a monotone piecewise-linear warp W(v) with W(v)=v outside
  // stalls and W flat inside them. W(v) = v exactly for v >= 0.85.
  const stallWarps: { v: number; w: number }[][] = [];
  for (let i = 0; i < nTeams; i++) {
    const knots: { v: number; w: number }[] = [{ v: 0, w: 0 }];
    const nStalls = randInt(rng, 0, 2);
    let vCursor = 0.15;
    let lag = 0;
    const maxLag = 0.09;
    for (let s = 0; s < nStalls; s++) {
      const start = vCursor + rng() * (0.5 - vCursor) * 0.6;
      const len = Math.min(0.02 + rng() * 0.05, maxLag - lag);
      // Stalls must end by v=0.58 so the lag recovers gently before v=0.85
      // (steep recovery + the easing curve's peak slope would teleport).
      if (len <= 0.005 || start + len > 0.58) break;
      knots.push({ v: start, w: start - lag });
      knots.push({ v: start + len, w: start - lag }); // flat: stall
      lag += len;
      vCursor = start + len + 0.03;
    }
    // Recover the lag smoothly so W(0.85) = 0.85 and identity afterward.
    knots.push({ v: 0.85, w: 0.85 });
    knots.push({ v: 1, w: 1 });
    stallWarps.push(knots);
  }

  return { pushStartMs, summitTimesMs, stallWarps };
}

function warp(knots: { v: number; w: number }[], v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  for (let i = 1; i < knots.length; i++) {
    if (v <= knots[i].v) {
      const a = knots[i - 1];
      const b = knots[i];
      const span = b.v - a.v;
      if (span <= 0) return b.w;
      return a.w + ((v - a.v) / span) * (b.w - a.w);
    }
  }
  return 1;
}

/** Shared easing: slow leaving the Col, strong through the night, ease at top. */
function ease(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v * v * (3 - 2 * v);
}

/** Base (noise-free) progress for a team at absolute time tMs. */
export function pushBase(
  plan: PushPlan,
  teamIdx: number,
  tMs: number,
): number {
  const t0 = plan.pushStartMs;
  const ts = plan.summitTimesMs[teamIdx];
  if (tMs <= t0) return HOLD_P;
  if (tMs >= ts) return 1;
  const v = (tMs - t0) / (ts - t0);
  const w = warp(plan.stallWarps[teamIdx], v);
  return HOLD_P + (1 - HOLD_P) * ease(w);
}

/**
 * Full push-phase progress for all teams on the given time grid
 * (times must be >= pushStartMs, ascending). Returns p[teamIdx][i].
 * startP: per-team p at push start (the final pre-push anchors).
 */
export function pushCurves(
  seedHex: string,
  plan: PushPlan,
  startP: number[],
  gridMs: number[],
): number[][] {
  const n = startP.length;
  const rng = forkRng(seedHex, 'push-noise');
  const lastSummit = Math.max(...plan.summitTimesMs);
  const pushSpan = lastSummit - plan.pushStartMs || 1;

  // Order of teams by summit time (earliest first) for adjacency gaps.
  const bySummit = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => plan.summitTimesMs[a] - plan.summitTimesMs[b] || a - b,
  );
  const posInOrder: number[] = new Array(n);
  bySummit.forEach((team, pos) => (posInOrder[team] = pos));

  // Per-team OU noise state.
  const phi = 0.88;
  const noise: number[] = new Array(n).fill(0);
  const out: number[][] = Array.from({ length: n }, () => []);

  for (let gi = 0; gi < gridMs.length; gi++) {
    const t = gridMs[gi];
    const vGlobal = Math.min(1, (t - plan.pushStartMs) / pushSpan);
    const bases: number[] = new Array(n);
    for (let i = 0; i < n; i++) bases[i] = pushBase(plan, i, t);

    for (let i = 0; i < n; i++) {
      noise[i] = phi * noise[i] + Math.sqrt(1 - phi * phi) * gauss(rng);
      const ts = plan.summitTimesMs[i];

      if (t >= ts) {
        out[i].push(1);
        continue;
      }

      const vLocal = Math.min(1, (t - plan.pushStartMs) / (ts - plan.pushStartMs));

      // Carry: honor pre-push standings, decaying to zero by mid-push.
      const carryDecay = Math.pow(Math.max(0, 1 - vGlobal / 0.45), 1.5);
      const carry = (startP[i] - HOLD_P) * carryDecay;

      // Noise amplitude fades as the team nears its summit.
      const amp = 0.016 * Math.pow(1 - vLocal, 1.2);
      let dev = noise[i] * amp;

      // Crossing allowance: generous early, tight in the endgame.
      const pos = posInOrder[i];
      const ahead = pos > 0 ? bases[bySummit[pos - 1]] : null;
      const behind = pos < n - 1 ? bases[bySummit[pos + 1]] : null;
      let factor: number;
      if (vLocal < 0.6) factor = 1.5;
      else if (vLocal < 0.85) factor = 1.5 - ((vLocal - 0.6) / 0.25) * 1.05;
      else factor = 0.45 * (1 - ((vLocal - 0.85) / 0.15) * 0.5);
      const upGap = ahead === null ? 0.03 : Math.max(0, ahead - bases[i]);
      const dnGap = behind === null ? 0.03 : Math.max(0, bases[i] - behind);
      dev = Math.min(dev, factor * upGap + 1e-6);
      dev = Math.max(dev, -(factor * dnGap + 1e-6));

      let p = bases[i] + carry + dev;
      // Never regress below the Col start, never touch 1 early.
      p = Math.max(p, startP[i]);
      p = Math.min(p, 1 - 1e-5);
      // Monotone per team.
      const prev = out[i].length ? out[i][out[i].length - 1] : startP[i];
      p = Math.max(p, prev);
      out[i].push(p);
    }
  }
  return out;
}
