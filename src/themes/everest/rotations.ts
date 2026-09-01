import type { CoreTimeline } from '@/engine/types';
import { HOLD_P, progressAt } from '@/engine/types';
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
const COL_APPROACH_U = 0.78; // from here, the field breaks for the Col

/** Parked at the Col: reached Camp IV, not yet committed to the ridge. */
const COL_PARK = C4_FRAC - 0.002;

/**
 * When the closing window opens: rotations are over, and the field starts
 * moving up to the Col whatever shape it is in. From here the climb is one
 * continuous summit bid, which is why the meters price it differently.
 */
export const summitBidStartMs = (durationMs: number) => COL_APPROACH_U * durationMs;

// Where condition starts and stops braking the climb, on the same 0–100
// scale the readiness bar shows. Above BRAKE_FULL a squad climbs freely;
// between the two it drags; at BRAKE_STOP it is done going up until rest
// buys something back.
const BRAKE_FULL = 34;
const BRAKE_STOP = 12;

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

/**
 * How fit a squad is to move, 0..100 — the same readiness the team card
 * shows, integrated alongside the choreography rather than after it.
 *
 * The loop asks `readiness()` before it decides where a team goes next, then
 * reports the step it settled on. So condition DRIVES the climb instead of
 * merely recording it: a spent squad sits a storm out, gets turned around,
 * drops further to recover, and near the floor simply cannot go up until rest
 * has bought it something back — and because the readings only ever depend on
 * steps already committed, the bar on screen is the very number that decided
 * all of it.
 *
 * Still pure decoration: it reads meters derived from this display track, and
 * the finishing order was drawn before any of it existed.
 */
export interface LiveCondition {
  readiness(): number;
  advance(tMs: number, pos: number): void;
}

export type ConditionFactory = (team: number) => LiveCondition;

/** A squad lost outright: the mountain keeps them where they fell. */
export interface Wipeout {
  teamIdx: number;
  tMs: number;
}

export function buildDisplayTrack(
  rng: RNG,
  core: CoreTimeline,
  durationMs: number,
  route: RotationRoute = EVEREST_ROTATION_ROUTE,
  paceEvents: PaceEvent[] = [],
  storms: StormWindow[] = [],
  conditionFor?: ConditionFactory,
  wipeouts: Wipeout[] = [],
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

  // The earliest summiter anchors the summit-push departure stagger.
  const stMin = Math.min(...core.summitTimesMs);
  const stSpan = Math.max(1, Math.max(...core.summitTimesMs) - stMin);
  const colOpenMs = COL_APPROACH_U * durationMs;
  // The ridge ease's peak slope is 1.45x(1 - C4_FRAC) per unit of local time.
  // Hold it to 60% of the per-step catch-up cap so the drawn climb is never
  // clipped — a clipped climb would have to teleport at the summit instant to
  // keep the arrival exact.
  const minRidgeMs = ((1.45 * (1 - C4_FRAC)) / (pushCatch * 0.6)) * step;

  for (let team = 0; team < n; team++) {
    const cycles = buildCycles(rng, durationMs, team, n, route.forceShallow ?? false);
    // Per-team departure texture for the push (drawn here, outside the time
    // loop, so rng consumption stays deterministic per team).
    const colJitter = rng();

    // Weather decisions: does this team sit a given storm out at a camp, or
    // gamble and keep climbing through it? Style flavors the choice (and,
    // like every style effect, shapes only the telling — never the outcome).
    // Whether to sit a storm out is read from condition alone — the same rule
    // the route forks use. No personality, no dial. (The field's standing is
    // deliberately NOT used here: teams are choreographed one at a time, so at
    // this point the rest of the field has no positions yet. Standing-aware
    // risk belongs in buildTraversals, which runs over a finished track.)
    const holdP = 0.7;
    // The squad's live condition. Without one (bare choreography, as the
    // tests build it) every decision sees an even 55 and behaves as it always
    // did.
    const live = conditionFor?.(team);
    const cond = () => (live ? live.readiness() : 55);
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

    // Every roll is drawn up front, in a fixed order, so the stream stays
    // deterministic — but the THRESHOLDS each roll is judged against are
    // evaluated later, at the moment the squad actually has to decide, when
    // its real condition is known. Decisions are memoized: a call made is a
    // call made, and second-guessing it mid-storm would read as a flicker.
    const holdRoll = storms.map(() => rng());
    const holdCall: (boolean | undefined)[] = storms.map(() => undefined);
    /**
     * Sit this storm out, or gamble and climb through it? The spent dig in;
     * the fresh gamble. Decided when the storm arrives — or earlier, if the
     * squad is planning a rotation that runs into it.
     */
    const holdsStorm = (si: number): boolean => {
      if (holdCall[si] === undefined) {
        holdCall[si] = holdRoll[si] < clamp01(holdP + (55 - cond()) / 90);
      }
      return holdCall[si];
    };
    const stormCamp: (number | undefined)[] = storms.map(() => undefined);
    const holdBeaten = storms.map(() => false);
    const pushBeaten = storms.map(() => false);

    // Attempt plans: per rotation cycle, does the push for height fail and
    // force a retreat to the camp it started from? Climbing into a storm
    // makes failure much more likely — the retreat is the price of the
    // gamble the wait-it-out teams refused.
    const attempts = cycles.map(() => ({
      failRoll: rng(),
      peakF: 0.45 + rng() * 0.3,
      called: false,
      fail: false,
      stormy: false,
      beaten: false,
      restBeaten: false,
    }));

    /** Settle this cycle's attempt on the condition the squad sets out in. */
    const attemptFor = (ci: number) => {
      const at = attempts[ci];
      if (at.called) return at;
      at.called = true;
      const c = cycles[ci];
      const ascEnd = c.startMs + c.shape[0] * (c.endMs - c.startMs);
      at.stormy = storms.some(
        (s, si) => c.startMs < s.endMs && ascEnd > s.startMs && !holdsStorm(si),
      );
      // A tired squad gets turned around; a strong one gets the height.
      const base = at.stormy ? 0.75 : 0.35;
      at.fail = allowFails && at.failRoll < clamp01(base + (55 - cond()) / 110);
      return at;
    };

    /** The held storm blowing at t, if any (holds beat everything else). */
    const activeHeldStorm = (t: number): number => {
      for (let si = 0; si < storms.length; si++) {
        if (t < storms[si].startMs || t > storms[si].endMs) continue;
        if (holdsStorm(si)) return si;
      }
      return -1;
    };

    const wipeMs = wipeouts.find((w) => w.teamIdx === team)?.tMs;
    let wipeFrozen: number | null = null;

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
    // A camp, once made, is a floor. Real expeditions do walk all the way
    // back to Base Camp between rotations, but on screen a team sliding
    // below a camp it already reached — three quarters of the way into the
    // race — reads as losing progress rather than resting. So the deepest a
    // squad ever drops is the highest camp it has stood in.
    let campFloor = 0;

    // --- The break for the Col -------------------------------------------
    // The field no longer bunches at Camp IV waiting for one gun. Each squad
    // reaches the Col and leaves it on its own clock, so a squad that managed
    // itself well is already on the summit ridge while a spent one is still
    // below Camp IV — and a late departure is a real chase rather than a
    // formality. Every input is data the viewer already has (this squad's
    // readiness bar, its own summit clock, its own draw), and nothing is
    // written back: core drew the ending before any of this existed, and the
    // arrival at 1.0 is still stamped to the millisecond by `st`.
    const st = core.summitTimesMs[team];
    // The window this squad actually has: from the moment the field breaks for
    // the Col, to the last instant it can still leave and be drawn onto the
    // summit at its own exact summit time.
    const colLastMs = Math.max(colOpenMs, st - minRidgeMs);
    const colWin = colLastMs - colOpenMs;
    let colPlan: { wait: number; arrive: number; go: number } | null = null;
    let colBase = 0;
    let departMs: number | null = null;

    /** Settle this squad's Col schedule, on the shape it breaks camp in. */
    const planCol = () => {
      if (colPlan) return colPlan;
      colBase = lastPos;
      // 0 = first squad off the Col, 1 = last. Mostly the shape the squad is
      // in — that IS the resource game the bars have been telling — with a
      // light pull from its own summit clock so the picture never reads as
      // random, plus per-team texture. Weighting condition over the clock is
      // also what stops the departure order being a readable copy of the
      // finishing order, which is what it used to be exactly.
      // Centred on the condition squads actually carry into the closing
      // window (median ~69), not on the full 0-100 scale: against the whole
      // range this saturated for most of the field and the spread collapsed.
      const shape = 1 - clamp01((cond() - 40) / 55);
      const clock = (st - stMin) / stSpan;
      const score = clamp01(0.72 * shape + 0.16 * clock + 0.12 * colJitter);
      colPlan = {
        // A short breather for everyone, then the walk up: a fresh squad is at
        // the Col early with time to brew up, a spent one is still grinding
        // toward it when the leaders have gone.
        // A spent squad does not merely walk up slower, it sets off later:
        // sharing one start time and differing only in pace let every laggard
        // close the gap inside a couple of steps, and the field arrived
        // together anyway.
        wait: colOpenMs + (0.03 + 0.5 * score) * colWin,
        arrive: colOpenMs + (0.08 + 0.72 * score) * colWin,
        go: colOpenMs + (0.22 + 0.72 * score) * colWin,
      };
      return colPlan;
    };

    for (const t of tMs) {
      const u = t / durationMs;
      const p = progressAt(core.grid, team, t);
      let x: number;

      // Has this squad committed to the ridge yet? The final act is per squad
      // now, not one gun fired for the whole field at pushStartMs.
      const onRidge =
        departMs !== null ||
        (u >= COL_APPROACH_U && t >= planCol().go && lastPos >= COL_PARK - 1e-9);

      if (onRidge) {
        // The summit ridge, staged for the screen — and for the story so far.
        // Each squad climbs its own summit-timed ease from the Col it actually
        // left, so an early departure really is time in hand, a late one really
        // is a chase, and near-rivals duel within a rope-length. A bounded
        // trace of the raw-p signal survives as stall/surge texture once the
        // engine's own push is live. Summit arrival stays exact to the
        // millisecond, and none of this touches the engine's staging —
        // standings rank by checkpoints and by p, never by pixels.
        if (departMs === null) departMs = t;
        const u2 = Math.max(0, Math.min(1, (t - departMs) / Math.max(1, st - departMs)));
        const base = Math.pow(u2, 1.45);
        const affine = (Math.max(p, HOLD_P) - HOLD_P) / (1 - HOLD_P);
        // Before the engine's push, p is pinned under HOLD_P by construction,
        // so the trace would read as a constant drag rather than as texture.
        const texture =
          t < core.pushStartMs
            ? 0
            : Math.max(-0.035, Math.min(0.035, (affine - base) * 0.3)) * (1 - u2);
        const target =
          C4_FRAC + (1 - C4_FRAC) * Math.max(0, Math.min(1, base + texture));
        x = Math.min(target, lastPos + pushCatch);
        x = Math.max(x, lastPos); // monotone on the ridge
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
          // This squad's own walk up to the Col: sit where the rotations left
          // it, then climb, arriving at its own hour instead of everyone's.
          const plan = planCol();
          colBase = Math.max(colBase, lastPos);
          const f = Math.max(
            0,
            Math.min(1, (t - plan.wait) / Math.max(1, plan.arrive - plan.wait)),
          );
          const ease = f * f * (3 - 2 * f);
          let target = colBase + (COL_PARK - colBase) * ease;
          // Backstop: the summit time is fixed, so the walk-up has to end.
          // Once the ridge clock is the binding constraint, close the gap at
          // whatever the approach cap allows.
          if (t >= plan.go) target = COL_PARK;
          x = Math.max(lastPos, Math.min(COL_PARK, target));
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
            stormCamp[heldSi] = Math.max(
              Math.min(campFloor, lastPos),
              durationMs < 900_000 || route.forceShallow
                ? Math.round(lastPos * 1e4) / 1e4
                : route.restFracs[restIndexBelow(route.restFracs, lastPos + 0.005)],
            );
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
            // The worse the shape, the further down they go to fix it.
            const deeper = cond() < BRAKE_FULL ? 1 : 0;
            const restFrac =
              route.restFracs[
                Math.max(
                  0,
                  restIndexBelow(route.restFracs, reach) - cycle.restDepth - deeper,
                )
              ];
            let low = Math.min(restFrac, reach);
            // Short races / shallow themes: keep rest stops close enough.
            if (durationMs < 900_000 || route.forceShallow) low = Math.max(low, reach - 0.2);
            // Never below a camp already made.
            low = Math.max(low, Math.min(campFloor, reach));
            const at = attemptFor(ci);
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
            if (pushBeaten[si]) continue;
            if (t < s.startMs || t > s.endMs) continue;
            if (holdsStorm(si)) continue;
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

      if (!onRidge) {
        // Keep visible motion sane: no display teleports between sparse
        // steps. During the Col approach teams hustle — the window is open.
        const cap = u >= COL_APPROACH_U ? approachCap : normalCap;
        x = Math.max(lastPos - cap, Math.min(lastPos + cap, x));
        // The floor is absolute, not just a target for the rest dip: the
        // short-handed pace lag must not walk a team back below a camp it
        // already stood in either.
        x = Math.max(x, campFloor);
      }

      // Rock bottom means rock bottom. A squad with nothing left does not
      // keep strolling uphill: climbing slows as condition falls and stops
      // outright at the floor, until rest has bought something back. This is
      // the whole point of the readiness bar — down there it is not a status
      // light, it is a brake.
      //
      // The brake governs the rotation phase only. Once the summit window
      // opens the whole field commits, ready or not — that closing window is
      // the forcing function that gets everyone to the Col, and braking
      // inside it would strand a squad below C4 with nothing but the push's
      // catch-up rate to save it.
      if (u < COL_APPROACH_U && x > lastPos) {
        const c = cond();
        if (c < BRAKE_FULL) {
          const throttle = Math.max(0, (c - BRAKE_STOP) / (BRAKE_FULL - BRAKE_STOP));
          x = lastPos + (x - lastPos) * throttle;
        }
      }

      // A squad lost outright stops here for good — the freeze belongs in the
      // choreography, not stamped on afterwards, so their meters record a
      // team that stopped where it fell rather than one still climbing.
      if (wipeMs !== undefined && t >= wipeMs) {
        if (wipeFrozen === null) wipeFrozen = lastPos;
        x = wipeFrozen;
      }

      x = Math.max(0, Math.min(1, x));
      row.push(Math.round(x * 1e4) / 1e4);
      lastPos = row[row.length - 1];
      live?.advance(t, lastPos);
      // Standing in a camp raises the floor for every later rest.
      const madeIdx = restIndexBelow(route.restFracs, lastPos + 1e-9);
      const made = route.restFracs[madeIdx];
      if (made > campFloor && lastPos >= made - 1e-9) campFloor = made;
    }
    pos.push(row);
  }

  beats.sort((a, b) => a.tMs - b.tMs || a.teamIdx - b.teamIdx);
  return { tMs, pos, beats };
}
