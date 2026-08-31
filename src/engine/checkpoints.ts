import { forkRng, gauss } from './prng';
import { PUSH_U, type Checkpoint } from './types';

/**
 * Pre-push checkpoint standings: a latent-score Ornstein–Uhlenbeck bridge.
 *
 * Each team carries a latent "form" z that evolves with persistence ρ, so
 * hot streaks and slumps span several checkpoints instead of reshuffling
 * every time. The displayed standings blend that form with a secret target
 * derived from the final ranking, at weight w(u) that ramps from 6% to 28%
 * across the pre-push window — a weak-but-real signal.
 *
 * Crucially there is NO clamp against the final order here: any
 * (current rank → final rank) transition stays possible right up to the
 * push. Reachability is a statistical property of the small w, verified by
 * tests, not an accident.
 */

const RHO = 0.75;
const W_MIN = 0.06;
const W_MAX = 0.28;

export function checkpointTimes(
  seedHex: string,
  durationMs: number,
): number[] {
  const rng = forkRng(seedHex, 'checkpoint-times');
  const count = Math.min(40, Math.max(6, Math.round(durationMs / 480_000)));
  const spacing = PUSH_U / count;
  const us: number[] = [];
  for (let k = 1; k <= count; k++) {
    const jitter = (rng() * 2 - 1) * 0.2 * spacing;
    us.push(Math.min(PUSH_U, Math.max(spacing * 0.3, k * spacing + jitter)));
  }
  us.sort((a, b) => a - b);
  // Deduplicate any collisions introduced by jitter+clamping.
  const out: number[] = [];
  for (const u of us) {
    if (out.length === 0 || u - out[out.length - 1] > spacing * 0.05) out.push(u);
  }
  // The final pre-push checkpoint always sits exactly at the push boundary,
  // so the push phase starts from a known standings order.
  out[out.length - 1] = PUSH_U;
  return out.map((u) => Math.round(u * durationMs));
}

export function buildCheckpoints(
  seedHex: string,
  nTeams: number,
  durationMs: number,
  finalRank: number[],
): Checkpoint[] {
  const rng = forkRng(seedHex, 'standings');
  const tMsList = checkpointTimes(seedHex, durationMs);

  // Target score: better final rank => higher target, normalized to ~N(0,1) scale.
  const mean = (nTeams + 1) / 2;
  let varSum = 0;
  for (let r = 1; r <= nTeams; r++) varSum += (r - mean) ** 2;
  const sd = Math.sqrt(varSum / nTeams) || 1;
  const target = finalRank.map((r) => -(r - mean) / sd);

  const z: number[] = [];
  for (let i = 0; i < nTeams; i++) z.push(gauss(rng));

  const checkpoints: Checkpoint[] = [];
  for (const tMs of tMsList) {
    const u = tMs / durationMs;
    for (let i = 0; i < nTeams; i++) {
      z[i] = RHO * z[i] + Math.sqrt(1 - RHO * RHO) * gauss(rng);
    }
    const w = W_MIN + (W_MAX - W_MIN) * Math.min(1, u / PUSH_U);
    const score = z.map((zi, i) => (1 - w) * zi + w * target[i]);
    const order = score
      .map((s, i) => i)
      .sort((a, b) => score[b] - score[a] || a - b);
    checkpoints.push({ tMs, order });
  }
  return checkpoints;
}
