import type { RNG } from '@/engine/prng';
import { METER_KEYS } from './types';
import { altitudeAt, nodeAtOrBelow } from './route';

/**
 * Route hooks that let another journey theme reuse these meter dynamics:
 * strainAt maps display pos to the Everest-altitude strain scale
 * (5364–8849; the drain math is calibrated to it), and canRestockAt says
 * where resupply is possible.
 */
export interface MeterRouteFns {
  strainAt: (pos: number) => number;
  canRestockAt: (pos: number) => boolean;
}

const EVEREST_METER_FNS: MeterRouteFns = {
  strainAt: altitudeAt,
  canRestockAt: (pos) => nodeAtOrBelow(pos + 0.005).alt <= 6400,
};

/**
 * Per-team resource and condition meters on the shared sparse grid.
 * Rule-based dynamics driven by the display track (moving vs resting,
 * altitude, descents = resupply opportunities), so the numbers always tell
 * the same story as the map. Events later nudge these (injury -> med drop);
 * readiness is recomputed at the end.
 *
 * Meter order (METER_KEYS): o2, rope, food, med, energy, morale, accl, readiness.
 */

/**
 * Consumption and recovery rates, budgeted against the race clock rather than
 * picked by feel. `drain` and `recover` below sum to 100 over a whole race, so
 * a rate here reads directly as "how many bars' worth, if the squad did only
 * this the entire time" — which is what makes these tunable against a target
 * story instead of by trial and error.
 *
 * The story they are tuned to: rotations SWING (working high costs more than a
 * night at Base Camp gives back, so a squad that overreaches visibly empties
 * and has to go down to refill), the Col is reached worn but stocked, and
 * summit day is expensive but survivable. Two failure modes to tune away from,
 * both of which make the readiness bar meaningless: rates so steep that the
 * whole field is pinned to the floor before the push even starts, and rates so
 * gentle that nobody is ever in trouble and the bar never explains anything.
 */
const R = {
  /** Eaten by everyone daily, more when working, on the way down too. */
  foodBase: 0.55,
  foodWork: 2.4,
  foodDown: 0.6,
  /** Bottled gas, burned above 5900 m; `thinAir` multiplies it above 7000 m. */
  o2Work: 3.35,
  o2Camp: 1.0,
  o2Down: 0.5,
  o2Bid: 2.2,
  thinAir: 1.25,
  /**
   * Effort. Rotation work is repeated hard labour — carry, climb, retreat,
   * do it again — and it is what makes the bars swing. The summit bid (the
   * move up to the Col and the climb above it) is one continuous, supported,
   * bottled-gas effort on a fixed plan, so it costs less per hour even though
   * it is higher; priced at rotation rates it ate ~40 points of every meter
   * before summit day even began, and the whole field arrived at the Col with
   * nothing left for the bar to say.
   */
  work: 2.5,
  workBid: 1.75,
  workDown: 0.7,
  /** Rest. Thick air is why squads keep going back down. */
  restLow: 6.8,
  restMid: 3.2,
  restHigh: 0.8,
  /**
   * Above the Col nobody recovers — you deteriorate, which is why squads do
   * not sit at Camp IV a moment longer than the weather makes them. Without
   * this, waiting for a summit slot at 7950 m read as a rest stop and the
   * whole field arrived on the ridge fresher than it left Base Camp.
   */
  deathZone: 4.2,
  /** Resupply at a camp porters can actually reach. */
  o2Stock: 11,
  foodStock: 9,
};

const O2 = 0;
const ROPE = 1;
const FOOD = 2;
const MED = 3;
const ENERGY = 4;
const MORALE = 5;
const ACCL = 6;
const READY = 7;

/**
 * One squad's meters, integrated a step at a time.
 *
 * Stepped rather than batch-built because readiness has to be a CAUSE, not a
 * readout: the choreography asks `readiness()` before it decides where a team
 * goes next, then hands back the step it settled on. Since the answer only
 * ever depends on steps already committed, there is no circularity — and the
 * number the team card shows is, by construction, the same number that
 * decided whether the squad could climb.
 */
export interface TeamMeters {
  /** Rows in METER_KEYS order, grown one entry per committed step. */
  readonly rows: number[][];
  /** Readiness (0–100) from every step committed so far. */
  readiness(): number;
  /** Commit a step: this squad stood at `pos` at `tMs`. */
  advance(tMs: number, pos: number): void;
}

export function createTeamMeters(
  rng: RNG,
  durationMs: number,
  pushStartMs: number,
  /**
   * When the closing window opens and the field starts moving up to the Col.
   * From here on the climb is priced as one summit bid rather than as more
   * rotation work (see R.workBid). Defaults to the push itself.
   */
  summitBidMs: number = pushStartMs,
  routeFns: MeterRouteFns = EVEREST_METER_FNS,
): TeamMeters {
  const rows: number[][] = METER_KEYS.map(() => []);
  // Slight per-team personality in drain/recovery rates (cosmetic).
  const drainMul = 0.85 + rng() * 0.3;
  const recoverMul = 0.85 + rng() * 0.3;
  const acclMul = 0.9 + rng() * 0.2;

  let o2 = 88 + rng() * 10;
  let rope = 90 + rng() * 10;
  let food = 92 + rng() * 8;
  let med = 95 + rng() * 5;
  let energy = 90 + rng() * 10;
  let morale = 62 + rng() * 10;
  let accl = 8 + rng() * 6;

  let prevT = 0;
  let prevPos = 0;
  let n = 0;
  // Before the first step there is no history to read, so readiness is what
  // the squad walked into Base Camp with.
  let ready = blendReadiness(energy, o2, food, accl);

  /** Store a value, sliding rather than snapping (see recomputeReadiness). */
  const commit = (m: number, v: number, maxJump: number): number => {
    const row = rows[m];
    let out = Math.round(v);
    if (row.length > 0) {
      const d = out - row[row.length - 1];
      if (d > maxJump) out = row[row.length - 1] + maxJump;
      else if (d < -maxJump) out = row[row.length - 1] - maxJump;
    }
    row.push(out);
    return out;
  };

  return {
    rows,
    readiness: () => ready,
    advance(t: number, pos: number) {
      const dtFrac = n === 0 ? 0 : (t - prevT) / durationMs;
      const from = n === 0 ? pos : prevPos;
      prevT = t;
      prevPos = pos;
      n++;

      const alt = routeFns.strainAt(pos);
      const moving = pos - from > 0.0005;
      const descending = from - pos > 0.0005;
      const high = alt > 7000;
      const inPush = t >= pushStartMs;
      const onBid = t >= summitBidMs;

      // scale: full-race totals, expressed per unit of race fraction
      const drain = 100 * dtFrac * drainMul;
      const recover = 100 * dtFrac * recoverMul;

      // Food and fuel: eaten every day by everyone, faster when working.
      food -= drain * (R.foodBase + (moving ? R.foodWork : descending ? R.foodDown : 0));

      // Bottled oxygen: burned from the first real altitude — cooking,
      // medical, sleeping gas — and hard on every climb above the Cwm.
      if (alt > 5900) {
        const burn = onBid
          ? R.o2Bid
          : moving
            ? R.o2Work
            : descending
              ? R.o2Down
              : R.o2Camp;
        o2 -= drain * burn * (alt > 7000 ? R.thinAir : 1);
      }

      if (moving) {
        energy -= drain * (onBid ? R.workBid : R.work) * (0.85 + (alt - 5300) / 5200);
        rope -= drain * 0.9;
      } else if (descending) {
        energy -= drain * R.workDown;
      } else {
        // Resting. Recovery is dramatically better in thick air — which is
        // exactly why squads keep going back down.
        energy +=
          recover *
          (alt < 6200
            ? R.restLow
            : alt < 7200
              ? R.restMid
              : alt < 7600
                ? R.restHigh
                : -R.deathZone);
        // Resupply: porters reach the low camps freely, the high camps
        // barely, and nothing crosses the Col once the push is on. Without
        // the partial high-camp stock a squad that stays up top simply
        // starved to the floor and sat there for half the race.
        const stock = alt <= 6400 ? 1 : alt <= 7300 ? 0.62 : 0;
        if (!inPush && stock > 0) {
          o2 = Math.min(100, o2 + recover * R.o2Stock * stock);
          food = Math.min(100, food + recover * R.foodStock * stock);
          rope = Math.min(100, rope + recover * 5 * stock);
          med = Math.min(100, med + recover * 3 * stock);
        }
      }

      // Acclimatization: time spent high builds it, against a maturing cap.
      // The cap gets a per-team tilt so the field doesn't all pin to one
      // identical curve late in the race.
      if (alt > 5800) accl += 100 * dtFrac * (1.15 + (alt > 6400 ? 0.5 : 0));
      const acclCap = Math.min(100, (25 + 90 * (t / (pushStartMs || 1))) * acclMul);
      accl = Math.min(accl, acclCap);

      // Morale drifts toward baseline, but slowly enough that event nudges
      // (a camp made, a climber lost) stay legible for a while.
      morale += (62 - morale) * 0.02 + (high ? -0.5 : 0.35) * (dtFrac * 100);

      // Gentle noise so bars breathe.
      const wiggle = () => (rng() * 2 - 1) * 0.6;
      o2 = clamp(o2 + wiggle());
      food = clamp(food + wiggle());
      energy = clamp(energy + wiggle());
      morale = clamp(morale + wiggle());
      med = clamp(med + wiggle() * 0.3);
      rope = clamp(rope + wiggle() * 0.4);
      accl = clamp(accl);

      // Floors exist only so a living squad never reads as literally zero.
      o2 = Math.max(o2, inPush ? 3 : 8);
      energy = Math.max(energy, 8);
      food = Math.max(food, 5);

      // The integration keeps its own un-smoothed state; what gets STORED is
      // rate-limited so bars slide instead of snapping. Readiness then reads
      // the stored numbers, so it always agrees with the bars on screen.
      const sO2 = commit(O2, o2, 24);
      commit(ROPE, rope, 24);
      const sFood = commit(FOOD, food, 24);
      commit(MED, med, 24);
      const sEnergy = commit(ENERGY, energy, 24);
      commit(MORALE, morale, 24);
      const sAccl = commit(ACCL, accl, 24);
      ready = commit(READY, blendReadiness(sEnergy, sO2, sFood, sAccl), 20);
    },
  };
}

function clamp(x: number): number {
  return Math.max(0, Math.min(100, x));
}

/**
 * Readiness answers one question: could this squad leave for the top right
 * now? So it is dragged down by whatever they are shortest of (an expedition
 * with no gas is not "70% ready"), then stretched for contrast so the bar
 * uses its whole range instead of hugging the middle the way any average of
 * several signals does.
 */
function blendReadiness(e: number, o: number, f: number, a: number): number {
  const blend = 0.38 * e + 0.24 * o + 0.14 * f + 0.24 * a;
  const weakest = Math.min(e, o, f);
  const limited = 0.62 * blend + 0.38 * weakest;
  return clamp(50 + (limited - 50) * 1.5);
}

/** readiness = weighted blend; call again after event nudges. */
export function recomputeReadiness(values: number[][][]): void {
  for (const rows of values) {
    // Event nudges can stack (a fall + a route punishment in the same sparse
    // step); smooth every meter so no keyframe-to-keyframe jump exceeds 24
    // points — bars should slide, not snap.
    for (let m = 0; m < rows.length; m++) {
      if (m === READY) continue;
      const row = rows[m];
      for (let i = 1; i < row.length; i++) {
        const d = row[i] - row[i - 1];
        if (d > 24) row[i] = row[i - 1] + 24;
        else if (d < -24) row[i] = row[i - 1] - 24;
      }
    }
    for (let i = 0; i < rows[O2].length; i++) {
      rows[READY][i] = Math.round(
        blendReadiness(rows[ENERGY][i], rows[O2][i], rows[FOOD][i], rows[ACCL][i]),
      );
    }
    // The contrast stretch multiplies input jumps too, so smooth readiness
    // last: bars must always slide rather than snap, however hard an event
    // nudge hits the meters underneath.
    for (let i = 1; i < rows[READY].length; i++) {
      const d = rows[READY][i] - rows[READY][i - 1];
      if (d > 20) rows[READY][i] = rows[READY][i - 1] + 20;
      else if (d < -20) rows[READY][i] = rows[READY][i - 1] - 20;
    }
  }
}

/** Nudge a meter from a time onward (decaying), used by event decoration. */
export function nudgeMeter(
  values: number[][][],
  teamIdx: number,
  meterIdx: number,
  times: number[],
  fromMs: number,
  delta: number,
  decaySteps = 24,
): void {
  const rows = values[teamIdx];
  let applied = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] < fromMs) continue;
    const fade = Math.max(0, 1 - applied / decaySteps);
    rows[meterIdx][i] = Math.round(clamp(rows[meterIdx][i] + delta * fade));
    applied++;
    if (fade <= 0) break;
  }
}

export const METER_INDEX = { O2, ROPE, FOOD, MED, ENERGY, MORALE, ACCL, READY };
