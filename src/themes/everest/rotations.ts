import type { CoreTimeline } from '@/engine/types';
import { HOLD_P, PUSH_U, progressAt } from '@/engine/types';
import type { RNG } from '@/engine/prng';
import { NODES, nodeById } from './route';
import type { Style } from './types';

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
const COL_APPROACH_U = 0.78; // from here, converge on the hold point

/**
 * Rest-stop geometry, so another journey theme (space) can reuse the
 * choreography with its own waypoints. `restFracs` are the display fracs a
 * team may drop back to between pushes; `forceShallow` keeps dips small
 * regardless of duration (spacecraft loop back, they don't fly home).
 */
export interface RotationRoute {
  restFracs: number[];
  forceShallow?: boolean;
}

const EVEREST_ROTATION_ROUTE: RotationRoute = {
  // Base Camp through Camp IV — the camps a squad can rest at.
  restFracs: NODES.filter((n) =>
    ['BC', 'C1', 'C2', 'C3', 'C4'].includes(n.id),
  ).map((n) => n.frac),
};

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
  forceShallow: boolean,
): Cycle[] {
  const colApproachMs = COL_APPROACH_U * durationMs;
  // 2–6 rotation cycles depending on duration; staggered start per team.
  const nCycles =
    durationMs < 300_000 ? 2
    : durationMs < 3_600_000 ? 3
    : durationMs < 14_400_000 ? 4
    : durationMs < 43_200_000 ? 5
    : 6;
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
    const shallow = durationMs < 900_000 || forceShallow;
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

/** Highest rest-frac index at or below x. */
function restIndexBelow(restFracs: number[], x: number): number {
  let idx = 0;
  for (let i = 0; i < restFracs.length; i++) {
    if (restFracs[i] <= x + 1e-9) idx = i;
  }
  return idx;
}

/**
 * A moment that visibly slows a team's choreography — a death in the squad.
 * Decoration only: the fate layer scheduled these from its own stream, and
 * the lag applied here is exactly zero before each event (no served byte
 * ever anticipates a death) and decays to zero well before the Col approach
 * (the push construction — and therefore the outcome's staging — is
 * untouched, byte for byte).
 */
export interface PaceEvent {
  teamIdx: number;
  tMs: number;
}

/**
 * A choreography beat the event layer narrates: a repulsed attempt (the
 * team pushed for the next camp, failed, and retreated to where it left),
 * a weather hold (dug in at a camp while a storm passed), or a storm push
 * (climbed through the weather and got away with it). Beats are
 * generation-side only — never serialized — and, like everything here,
 * pure decoration on standings the core already decided.
 */
export interface ChoreoBeat {
  kind: 'repulsed' | 'hold' | 'stormPush' | 'rest';
  teamIdx: number;
  tMs: number;
  /** The camp frac the beat is anchored to (retreated to / holding at). */
  campFrac: number;
  stormy: boolean;
}

export interface StormWindow {
  startMs: number;
  endMs: number;
}

export function buildDisplayTrack(
  rng: RNG,
  core: CoreTimeline,
  durationMs: number,
  route: RotationRoute = EVEREST_ROTATION_ROUTE,
  paceEvents: PaceEvent[] = [],
  storms: StormWindow[] = [],
  styles?: Style[],
): { tMs: number[]; pos: number[][]; beats: ChoreoBeat[] } {
  const n = core.grid.p.length;
  const tMs = sparseTimes(durationMs, [core.pushStartMs, ...core.summitTimesMs]);
  const pos: number[][] = [];
  const beats: ChoreoBeat[] = [];
  // Failed-attempt texture needs enough steps to read as a story; a 1-2
  // minute race keeps the clean climb.
  const allowFails = durationMs >= 300_000;

  // Per-step motion caps scale with the sparse step so short races can
  // actually move (a fixed cap strangled a 1-minute race), while long races
  // keep stately, teleport-free motion.
  const step = Math.max(5000, durationMs / 400);
  const normalCap = Math.max(0.02, (step / durationMs) * 0.95);
  const approachCap = normalCap * 2.25;
  const pushCatch = normalCap * 3;

  // Short-handed lag tuning. sDur turns the effect fully off below 5 minutes
  // (a 60s race has ~one Col-approach step of recovery headroom) and fully on
  // from 15 minutes. Max total lag 0.06 clears easily: the free window
  // [0.75, 0.78]·duration alone offers ≥ 0.20 of capped recovery.
  const T_FREE = 0.75 * durationMs;
  const sDur = Math.max(0, Math.min(1, (durationMs - 300_000) / 600_000));
  const LAG_AMP = 0.035 * sDur;
  const smooth = (u: number) => {
    const c = Math.max(0, Math.min(1, u));
    return c * c * (3 - 2 * c);
  };

  for (let team = 0; team < n; team++) {
    const cycles = buildCycles(rng, durationMs, team, n, route.forceShallow ?? false);

    // Weather decisions: does this team sit a given storm out at a camp, or
    // gamble and keep climbing through it? Style flavors the choice (and,
    // like every style effect, shapes only the telling — never the outcome).
    const style = styles?.[team] ?? 'balanced';
    const holdP = style === 'cautious' ? 0.9 : style === 'bold' ? 0.4 : 0.7;
    const holdStorm = storms.map(() => rng() < holdP);
    const stormCamp: (number | undefined)[] = storms.map(() => undefined);
    const holdBeaten = storms.map(() => false);
    const pushBeaten = storms.map(() => false);

    // Attempt plans: per rotation cycle, does the push for height fail and
    // force a retreat to the camp it started from? Climbing into a storm
    // makes failure much more likely — the retreat is the price of the
    // gamble the wait-it-out teams refused.
    const attempts = cycles.map((c) => {
      const ascEnd = c.startMs + c.shape[0] * (c.endMs - c.startMs);
      const stormy = storms.some(
        (s, si) => !holdStorm[si] && c.startMs < s.endMs && ascEnd > s.startMs,
      );
      const failRoll = rng();
      const peakF = 0.45 + rng() * 0.3;
      const fail = allowFails && failRoll < (stormy ? 0.75 : 0.35);
      return { fail, stormy, peakF, beaten: false, restBeaten: false };
    });

    /** The held storm blowing at t, if any (holds beat everything else). */
    const activeHeldStorm = (t: number): number => {
      for (let si = 0; si < storms.length; si++) {
        if (!holdStorm[si]) continue;
        if (t >= storms[si].startMs && t <= storms[si].endMs) return si;
      }
      return -1;
    };

    const deaths = paceEvents
      .filter((pe) => pe.teamIdx === team && pe.tMs < T_FREE)
      .map((pe) => pe.tMs);
    const lagAt = (t: number): number => {
      if (LAG_AMP === 0 || deaths.length === 0) return 0;
      let sum = 0;
      for (const td of deaths) {
        if (t <= td) continue; // exactly zero before (and at) the death
        const up = smooth((t - td) / Math.max(1, 2 * step));
        const downEnd = Math.min(td + 0.25 * durationMs, T_FREE);
        const down = 1 - smooth((t - td) / Math.max(1, downEnd - td));
        sum += LAG_AMP * up * down;
      }
      return Math.min(0.06, sum);
    };
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
        // A hold taken during the rotations keeps holding into the approach
        // while its storm lasts — crossing 0.78 of the race doesn't clear the
        // sky. But never past the last moment the Col can still be reached
        // before the push: the closing window forces everyone up eventually.
        const heldSi = activeHeldStorm(t);
        let stillHeld = false;
        if (heldSi >= 0 && stormCamp[heldSi] !== undefined) {
          const needSteps = (C4_FRAC - 0.02 - stormCamp[heldSi]!) / approachCap;
          const releaseMs = core.pushStartMs - needSteps * step * 1.4;
          stillHeld = t <= releaseMs;
        }
        if (stillHeld) {
          x = stormCamp[heldSi]!;
        } else {
          // Converge on the South Col: ease from wherever we are toward C4,
          // arrival staggered naturally by each team's p.
          const f = (u - COL_APPROACH_U) / (PUSH_U - COL_APPROACH_U);
          const ease = f * f * (3 - 2 * f);
          const target = Math.min(C4_FRAC - 0.002, Math.max(p, lastPos));
          x = lastPos + (Math.max(target, C4_FRAC - 0.02 - 0.06 * (1 - ease)) - lastPos) * Math.min(1, ease * 1.4);
          x = Math.min(x, C4_FRAC - 0.002);
          x = Math.max(x, lastPos - 0.0005); // effectively monotone here
        }
      } else {
        // A hold takes precedence over everything else in the rotation
        // phase: a team that decided to sit a storm out IS at its camp,
        // flat, until the sky clears. (This used to be a one-way clamp
        // applied after the cycle math, which let the cycle keep walking a
        // "dug in" team downhill through its own hold — and let a repulse
        // be narrated for an attempt whose marker never moved.)
        const heldSi = activeHeldStorm(t);
        if (heldSi >= 0) {
          if (stormCamp[heldSi] === undefined) {
            // Dig in at the camp at/below where the storm caught them — or
            // exactly where they stand when the race is too short to repay
            // a descent (the shallow-dip floor exists for a reason).
            stormCamp[heldSi] =
              durationMs < 900_000 || route.forceShallow
                ? Math.round(lastPos * 1e4) / 1e4
                : route.restFracs[restIndexBelow(route.restFracs, lastPos + 0.005)];
          }
          x = stormCamp[heldSi]!;
          if (!holdBeaten[heldSi]) {
            holdBeaten[heldSi] = true;
            beats.push({
              kind: 'hold', teamIdx: team, tMs: Math.max(t, storms[heldSi].startMs),
              campFrac: stormCamp[heldSi]!, stormy: true,
            });
          }
        } else {
          // Rotation choreography. Max reach tracks p; oscillate below it.
          // A squad that lost someone visibly climbs lower for a while.
          const reach = Math.max(0, Math.min(p, C4_FRAC - 0.02) - lagAt(t));
          const ci = cycles.findIndex((c) => t >= c.startMs && t < c.endMs);
          const cycle = ci >= 0 ? cycles[ci] : null;
          let cleanAscent = false;
          if (!cycle) {
            x = Math.min(reach, lastPos + 0.004);
          } else {
            const cf = (t - cycle.startMs) / (cycle.endMs - cycle.startMs);
            const [a, dh, d] = cycle.shape;
            const restFrac =
              route.restFracs[
                Math.max(0, restIndexBelow(route.restFracs, reach) - cycle.restDepth)
              ];
            let low = Math.min(restFrac, reach);
            // Short races / shallow themes: keep rest stops close enough.
            if (durationMs < 900_000 || route.forceShallow) low = Math.max(low, reach - 0.2);
            const at = attempts[ci];
            if (cf < a) {
              const f = cf / a;
              if (!at.fail) {
                // clean ascent from low toward reach
                cleanAscent = true;
                x = low + (reach - low) * smooth(f);
              } else {
                // A failed attempt: push toward the next height, get turned
                // around partway, retreat to the camp just left, then go
                // again. The wasted climbing drains the meters (they derive
                // from motion), which is the whole tradeoff made visible.
                const peak = low + (reach - low) * at.peakF;
                const dipTo = low + (reach - low) * 0.06;
                if (f < 0.45) {
                  x = low + (peak - low) * smooth(f / 0.45);
                } else if (f < 0.72) {
                  x = peak - (peak - dipTo) * smooth((f - 0.45) / 0.27);
                  if (!at.beaten) {
                    at.beaten = true;
                    beats.push({
                      kind: 'repulsed', teamIdx: team, tMs: t,
                      campFrac: low, stormy: at.stormy,
                    });
                  }
                } else {
                  x = dipTo + (reach - dipTo) * smooth((f - 0.72) / 0.28);
                }
              }
            } else if (cf < a + dh) {
              x = reach; // dwell high
            } else if (cf < a + dh + d) {
              const f = (cf - a - dh) / d;
              x = reach - (reach - low) * smooth(f);
              // A deliberate recovery descent is a story, not a glitch —
              // narrate the deep ones so "why are they going DOWN?" has an
              // answer in the feed.
              if (!at.restBeaten && reach - low > 0.12) {
                at.restBeaten = true;
                beats.push({
                  kind: 'rest', teamIdx: team, tMs: t,
                  campFrac: low, stormy: false,
                });
              }
            } else {
              x = low; // dwell low (resting)
            }
          }

          // Storm gamble: narrated only when the gamble is actually going to
          // pay. A storm-crossed attempt scripted to fail gets its repulse
          // narrated instead — never "got away with it" minutes before a
          // retreat.
          for (let si = 0; si < storms.length; si++) {
            const s = storms[si];
            if (holdStorm[si] || pushBeaten[si]) continue;
            if (t < s.startMs || t > s.endMs) continue;
            if (cleanAscent && x > lastPos + 0.0008) {
              pushBeaten[si] = true;
              beats.push({
                kind: 'stormPush', teamIdx: team, tMs: t,
                campFrac: lastPos, stormy: true,
              });
            }
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

  beats.sort((a, b) => a.tMs - b.tMs || a.teamIdx - b.teamIdx);
  return { tMs, pos, beats };
}
