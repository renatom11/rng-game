import type { CoreTimeline } from '@/engine/types';
import { HOLD_P, PUSH_U, progressAt } from '@/engine/types';
import type { RNG } from '@/engine/prng';
import { NODES, nodeById } from './route';

/**
 * The display track: where each team visibly IS on the mountain.
 *
 * The engine's p is monotone "expedition progress"; real expeditions yo-yo
 * up and down to acclimatize. So pre-push we choreograph rotations around p:
 * a team's maximum reach tracks p, but between unlocking camps they descend
 * to rest and re-ascend, on per-team staggered cycles — at any check-in the
 * field is spread across the mountain doing different things. From the
 * weather-window phase the field converges on the South Col, and during the
 * push display position is an affine map of p (the actual race line).
 *
 * The track never influences the engine — it is derived FROM it.
 */

/**
 * Shared sparse grid for display + meters. Structural extras (summit times,
 * push start) are spliced in so the displayed marker hits the summit at the
 * exact instant its summit event fires — with a plain grid, a team could be
 * announced on top while drawn below the Hillary Step for one step.
 */
export function sparseTimes(durationMs: number, extraMs: number[] = []): number[] {
  const step = Math.max(5000, durationMs / 400);
  const set = new Set<number>();
  for (let t = 0; t <= durationMs; t += step) set.add(Math.round(t));
  set.add(durationMs);
  for (const t of extraMs) {
    if (t >= 0 && t <= durationMs) set.add(Math.round(t));
  }
  return Array.from(set).sort((a, b) => a - b);
}

const C4_FRAC = nodeById.get('C4')!.frac; // 0.70 in display space
const COL_APPROACH_U = 0.78; // from here, converge on the Col

interface Cycle {
  startMs: number;
  endMs: number;
  /** fraction of the cycle spent [ascending, dwelling high, descending, dwelling low] */
  shape: [number, number, number, number];
  /** how many camps down the rest camp is (1 or 2) */
  restDepth: number;
}

function buildCycles(
  rng: RNG,
  durationMs: number,
  teamIdx: number,
  nTeams: number,
): Cycle[] {
  const colApproachMs = COL_APPROACH_U * durationMs;
  // 2–4 rotation cycles depending on duration; staggered start per team.
  const nCycles = durationMs < 300_000 ? 2 : durationMs < 3_600_000 ? 3 : 4;
  // Stagger: spread team cycle boundaries across ~40% of a cycle length.
  const cycleLen = colApproachMs / nCycles;
  const offset = ((teamIdx / Math.max(1, nTeams)) * 0.4 + rng() * 0.15) * cycleLen;
  const cycles: Cycle[] = [];
  for (let c = 0; c < nCycles; c++) {
    const start = c * cycleLen + (c === 0 ? 0 : offset * (c % 2 === 0 ? 0.6 : 1));
    const end = Math.min(colApproachMs, (c + 1) * cycleLen + offset * 0.5);
    const dwellHigh = 0.12 + rng() * 0.1;
    // Short races get shallow rotations: with only seconds per phase, deep
    // descents leave the team too far from the Col to converge in time.
    const shallow = durationMs < 900_000;
    const descend = (0.12 + rng() * 0.08) * (shallow ? 0.6 : 1);
    const dwellLow = 0.1 + rng() * 0.12;
    const ascend = Math.max(0.3, 1 - dwellHigh - descend - dwellLow);
    const norm = ascend + dwellHigh + descend + dwellLow;
    cycles.push({
      startMs: start,
      endMs: end,
      shape: [ascend / norm, dwellHigh / norm, descend / norm, dwellLow / norm],
      restDepth: shallow ? 1 : rng() < 0.35 ? 2 : 1,
    });
  }
  return cycles;
}

/** Highest camp node index whose display frac is <= x (in display space). */
function campIndexBelow(x: number): number {
  let idx = 0;
  for (let i = 0; i < NODES.length; i++) {
    if (NODES[i].frac <= x + 1e-9 && NODES[i].id !== 'BALC' && NODES[i].id !== 'SSUM' && NODES[i].id !== 'HILL' && NODES[i].id !== 'SUMMIT') {
      idx = i;
    }
  }
  return idx;
}

export function buildDisplayTrack(
  rng: RNG,
  core: CoreTimeline,
  durationMs: number,
): { tMs: number[]; pos: number[][] } {
  const n = core.grid.p.length;
  const tMs = sparseTimes(durationMs, [core.pushStartMs, ...core.summitTimesMs]);
  const pos: number[][] = [];

  // Per-step motion caps scale with the sparse step so short races can
  // actually move (a fixed cap strangled a 1-minute race), while long races
  // keep stately, teleport-free motion.
  const step = Math.max(5000, durationMs / 400);
  const normalCap = Math.max(0.02, (step / durationMs) * 0.95);
  const approachCap = normalCap * 2.25;
  const pushCatch = normalCap * 3;

  for (let team = 0; team < n; team++) {
    const cycles = buildCycles(rng, durationMs, team, n);
    const row: number[] = [];
    let lastPos = 0;

    for (const t of tMs) {
      const u = t / durationMs;
      const p = progressAt(core.grid, team, t);
      let x: number;

      if (t >= core.pushStartMs) {
        // The race line: affine map of p onto Col->Summit, approached with
        // a bounded catch-up so push start never teleports the marker.
        const target =
          C4_FRAC + ((Math.max(p, HOLD_P) - HOLD_P) / (1 - HOLD_P)) * (1 - C4_FRAC);
        x = Math.min(target, lastPos + pushCatch);
        x = Math.max(x, lastPos); // monotone during the push
        if (p >= 1 - 1e-6) x = 1; // the summit moment is exact
      } else if (u >= COL_APPROACH_U) {
        // Converge on the South Col: ease from wherever we are toward C4,
        // arrival staggered naturally by each team's p.
        const f = (u - COL_APPROACH_U) / (PUSH_U - COL_APPROACH_U);
        const ease = f * f * (3 - 2 * f);
        const target = Math.min(C4_FRAC - 0.002, Math.max(p, lastPos));
        x = lastPos + (Math.max(target, C4_FRAC - 0.02 - 0.06 * (1 - ease)) - lastPos) * Math.min(1, ease * 1.4);
        x = Math.min(x, C4_FRAC - 0.002);
        x = Math.max(x, lastPos - 0.0005); // effectively monotone here
      } else {
        // Rotation choreography. Max reach tracks p; oscillate below it.
        const reach = Math.min(p, C4_FRAC - 0.02);
        const cycle = cycles.find((c) => t >= c.startMs && t < c.endMs);
        if (!cycle) {
          x = Math.min(reach, lastPos + 0.004);
        } else {
          const cf = (t - cycle.startMs) / (cycle.endMs - cycle.startMs);
          const [a, dh, d, dl] = cycle.shape;
          const restCamp = NODES[Math.max(0, campIndexBelow(reach) - cycle.restDepth)];
          let low = Math.min(restCamp.frac, reach);
          // Short races: keep rest stops close enough to converge in time.
          if (durationMs < 900_000) low = Math.max(low, reach - 0.2);
          if (cf < a) {
            // ascend from low toward reach
            const f = cf / a;
            x = low + (reach - low) * (f * f * (3 - 2 * f));
          } else if (cf < a + dh) {
            x = reach; // dwell high
          } else if (cf < a + dh + d) {
            const f = (cf - a - dh) / d;
            x = reach - (reach - low) * (f * f * (3 - 2 * f));
          } else {
            x = low; // dwell low (resting)
          }
        }
      }

      if (t < core.pushStartMs) {
        // Keep visible motion sane: no display teleports between sparse
        // steps. During the Col approach teams hustle — the window is open.
        const cap = u >= COL_APPROACH_U ? approachCap : normalCap;
        x = Math.max(lastPos - cap, Math.min(lastPos + cap, x));
      }
      x = Math.max(0, Math.min(1, x));
      row.push(Math.round(x * 1e4) / 1e4);
      lastPos = row[row.length - 1];
    }
    pos.push(row);
  }

  return { tMs, pos };
}
