import { forkRng, shuffle } from './prng';
import { buildCheckpoints } from './checkpoints';
import { buildAnchors } from './anchors';
import { buildPushPlan, pushCurves } from './push';
import { prePushKeyframes, evalKeyframes, buildGridTimes } from './curves';
import type { CoreParams, CoreTimeline } from './types';

/**
 * Core timeline generation. Fairness-first ordering of operations:
 *
 *   1. finalOrder — Fisher–Yates from its own stream. THE result; uniform.
 *   2. checkpoint standings bridge (reads finalRank, N, T only)
 *   3. anchors + push plan (summit times)
 *   4. curves
 *
 * Nothing here reads team names, colors, or styles — themes decorate later
 * from separate streams, so cosmetic knobs provably cannot shift outcomes.
 */
export function generateCore(seedHex: string, params: CoreParams): CoreTimeline {
  const { nTeams, durationMs } = params;

  // 1. The fair random result.
  const finalOrder = shuffle(
    forkRng(seedHex, 'perm'),
    Array.from({ length: nTeams }, (_, i) => i),
  );
  const finalRank: number[] = new Array(nTeams);
  finalOrder.forEach((teamIdx, i) => (finalRank[teamIdx] = i + 1));

  // 2. Pre-push standings bridge.
  const checkpoints = buildCheckpoints(seedHex, nTeams, durationMs, finalRank);

  // 3. Progress anchors + summit push plan.
  const anchorSet = buildAnchors(seedHex, nTeams, durationMs, checkpoints);
  const plan = buildPushPlan(seedHex, nTeams, durationMs, finalOrder);

  // 4. Curves on the shared grid.
  const gridTimes = buildGridTimes(
    durationMs,
    checkpoints,
    plan.pushStartMs,
    plan.summitTimesMs,
  );
  const preKf = prePushKeyframes(
    seedHex,
    nTeams,
    durationMs,
    checkpoints,
    anchorSet,
  );
  const lastK = checkpoints.length - 1;
  const startP = Array.from(
    { length: nTeams },
    (_, i) => anchorSet.anchors[i][lastK],
  );

  const preTimes = gridTimes.filter((t) => t <= plan.pushStartMs);
  const pushTimes = gridTimes.filter((t) => t > plan.pushStartMs);
  const pushP = pushCurves(seedHex, plan, startP, pushTimes);

  const q = (x: number) => Math.round(x * 1e5) / 1e5;
  const p: number[][] = [];
  for (let i = 0; i < nTeams; i++) {
    const row: number[] = [];
    for (const t of preTimes) row.push(q(evalKeyframes(preKf[i], t)));
    for (let gi = 0; gi < pushTimes.length; gi++) row.push(q(pushP[i][gi]));
    // Quantization guard: re-assert monotonicity.
    for (let j = 1; j < row.length; j++) {
      if (row[j] < row[j - 1]) row[j] = row[j - 1];
    }
    p.push(row);
  }

  return {
    finalOrder,
    finalRank,
    summitTimesMs: plan.summitTimesMs,
    pushStartMs: plan.pushStartMs,
    checkpoints,
    grid: { tMs: gridTimes, p },
  };
}
