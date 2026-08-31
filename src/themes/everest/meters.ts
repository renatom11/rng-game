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

const O2 = 0;
const ROPE = 1;
const FOOD = 2;
const MED = 3;
const ENERGY = 4;
const MORALE = 5;
const ACCL = 6;
const READY = 7;

export function buildMeters(
  rng: RNG,
  displayTrack: { tMs: number[]; pos: number[][] },
  durationMs: number,
  pushStartMs: number,
  routeFns: MeterRouteFns = EVEREST_METER_FNS,
): number[][][] {
  const n = displayTrack.pos.length;
  const times = displayTrack.tMs;
  const values: number[][][] = [];

  for (let team = 0; team < n; team++) {
    const rows: number[][] = METER_KEYS.map(() => []);
    // Slight per-team personality in drain/recovery rates (cosmetic).
    const drainMul = 0.85 + rng() * 0.3;
    const recoverMul = 0.85 + rng() * 0.3;

    let o2 = 96 + rng() * 4;
    let rope = 90 + rng() * 10;
    let food = 92 + rng() * 8;
    let med = 95 + rng() * 5;
    let energy = 90 + rng() * 10;
    let morale = 62 + rng() * 10;
    let accl = 8 + rng() * 6;
    let maxAlt = 5364;

    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      const dtFrac = i === 0 ? 0 : (times[i] - times[i - 1]) / durationMs;
      const pos = displayTrack.pos[team][i];
      const prevPos = i === 0 ? pos : displayTrack.pos[team][i - 1];
      const alt = routeFns.strainAt(pos);
      maxAlt = Math.max(maxAlt, alt);
      const moving = pos - prevPos > 0.0005;
      const descending = prevPos - pos > 0.0005;
      const high = alt > 7000;
      const inPush = t >= pushStartMs;

      // scale: full-race totals, expressed per unit of race fraction
      const drain = 100 * dtFrac * drainMul;
      const recover = 100 * dtFrac * recoverMul;

      if (moving) {
        energy -= drain * (0.9 + (alt - 5300) / 3200);
        food -= drain * 0.55;
        if (high) o2 -= drain * (inPush ? 1.35 : 1.0);
        rope -= drain * 0.35;
      } else if (descending) {
        energy -= drain * 0.45;
        food -= drain * 0.45;
      } else {
        // resting
        energy += recover * (alt < 6200 ? 1.6 : alt < 7200 ? 0.9 : 0.25);
        if (!inPush && routeFns.canRestockAt(pos) && (o2 < 80 || food < 75)) {
          // resupply at Camp II or below
          o2 = Math.min(100, o2 + recover * 4);
          food = Math.min(100, food + recover * 4);
          rope = Math.min(100, rope + recover * 2.5);
        }
      }

      // Acclimatization: time spent high builds it; can't exceed a curve
      // that matures around the weather window.
      if (alt > 5800) accl += 100 * dtFrac * (1.15 + (alt > 6400 ? 0.5 : 0));
      const acclCap = Math.min(100, 25 + 90 * (t / (pushStartMs || 1)));
      accl = Math.min(accl, acclCap);

      // Morale drifts toward baseline; altitude grinds it, summits (later,
      // via event nudges) lift it.
      morale += (62 - morale) * 0.04 + (high ? -0.25 : 0.15) * (dtFrac * 100);

      // Gentle noise so bars breathe.
      const wiggle = () => (rng() * 2 - 1) * 0.6;
      o2 = clamp(o2 + wiggle());
      food = clamp(food + wiggle());
      energy = clamp(energy + wiggle());
      morale = clamp(morale + wiggle());
      med = clamp(med + wiggle() * 0.3);
      rope = clamp(rope + wiggle() * 0.4);
      accl = clamp(accl);

      // Floors: the story never shows a team at literally zero unless wiped.
      o2 = Math.max(o2, inPush ? 12 : 25);
      energy = Math.max(energy, 15);
      food = Math.max(food, 18);

      rows[O2].push(Math.round(o2));
      rows[ROPE].push(Math.round(rope));
      rows[FOOD].push(Math.round(food));
      rows[MED].push(Math.round(med));
      rows[ENERGY].push(Math.round(energy));
      rows[MORALE].push(Math.round(morale));
      rows[ACCL].push(Math.round(accl));
      rows[READY].push(0); // recomputed below
    }
    values.push(rows);
  }

  recomputeReadiness(values);
  return values;
}

function clamp(x: number): number {
  return Math.max(0, Math.min(100, x));
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
        clamp(
          0.28 * rows[O2][i] +
            0.3 * rows[ENERGY][i] +
            0.27 * rows[ACCL][i] +
            0.15 * rows[MORALE][i],
        ),
      );
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
