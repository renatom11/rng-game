import type { JourneySnapshot } from '@/lib/slice';
import type { ClimberStatus } from '@/themes/everest/types';
import { altitudeAt } from '@/themes/everest/route';
import { displayPosAt, metersAt, type ClimberDeath } from './raceState';

/**
 * Per-climber vitals, derived — never stored. Everything is a pure function
 * of the delivered snapshot (team meters, display altitude), the climber's
 * static dossier ints, and time, so vitals cost zero payload and cannot leak
 * anything the event stream hasn't already said. Everest-specific (reads the
 * mountain's altitude profile).
 */
export interface ClimberVitals {
  alive: boolean;
  /** Blood oxygen saturation, % */
  spo2: number;
  /** Core temperature, °C */
  tempC: number;
  /** Work rate, 0–100 */
  output: number;
  note: string;
}

export function climberVitalsAt(
  snap: JourneySnapshot,
  teamIdx: number,
  climberIdx: number,
  tMs: number,
  status: ClimberStatus = 'climbing',
  death: ClimberDeath | null = null,
): ClimberVitals {
  if (death !== null || status === 'fallen') {
    return { alive: false, spo2: 0, tempC: 0, output: 0, note: '' };
  }
  const climber = snap.climbers[teamIdx]?.[climberIdx];
  const age = climber?.age ?? 35;
  const look = climber?.look;
  const ageFactor = Math.max(0, Math.min(1, (age - 21) / 37));
  // Small stable personal offsets from the dossier ints — two climbers on
  // the same rope read slightly differently, consistently.
  const seed = (look ? look.skin * 7 + look.hair * 13 + look.hairColor * 3 : 5) + climberIdx * 29;
  const personal = ((seed % 9) - 4) * 0.6;
  const phase = (seed % 17) / 17;
  const wobble = Math.sin(2 * Math.PI * (tMs / 600_000 + phase));

  const alt = altitudeAt(displayPosAt(snap, teamIdx, tMs));
  const m = metersAt(snap, teamIdx, tMs);
  const injured = status === 'injured';
  const altFrac = Math.max(0, Math.min(1, (alt - 5364) / (8849 - 5364)));

  let spo2 =
    98 -
    altFrac * 30 +
    (m.accl / 100) * 6 +
    (m.o2 / 100) * 4 -
    5 +
    personal +
    wobble * 1.2 -
    ageFactor * 1.5 -
    (injured ? 2 : 0);
  spo2 = Math.max(66, Math.min(99, spo2));

  let tempC =
    36.8 -
    altFrac * 1.8 * (1 - m.energy / 250) -
    (injured ? 0.4 : 0) +
    wobble * 0.15;
  tempC = Math.max(33.5, Math.min(37.2, tempC));

  let output = m.energy * 0.6 + m.morale * 0.3 + 10 - ageFactor * 8 + personal;
  if (injured) output *= 0.6;
  if (status === 'turned-back') output = 0;
  output = Math.max(0, Math.min(100, output));

  let note = 'steady';
  if (status === 'turned-back') note = 'descended safely';
  else if (injured) note = 'moving hurt';
  else if (spo2 < 72) note = alt > 8000 ? 'in the death zone' : 'hypoxic';
  else if (output < 35) note = 'running on fumes';
  else if (output > 78) note = 'strong';

  return {
    alive: true,
    spo2: Math.round(spo2),
    tempC: Math.round(tempC * 10) / 10,
    output: Math.round(output),
    note,
  };
}
