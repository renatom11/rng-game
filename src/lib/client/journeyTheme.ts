import type { ClimberStatus } from '@/themes/everest/types';
import { altitudeAt, nodeAtOrBelow } from '@/themes/everest/route';
import { PHASE_NAMES } from '@/themes/everest/commentary/templates';
import { phaseAt } from './raceState';

/**
 * Client-side vocabulary and geometry hooks for a journey-shaped theme.
 * The components (standings, finale board, results, activity derivation)
 * are theme-neutral; everything worded or measured comes from here.
 */
export interface JourneyTheme {
  standingsTitle: string;
  finaleTitle: string;
  squadTitle: string;
  readinessLabel: string;
  wipedCard: string;
  /** short standings/finale label for a wiped team, e.g. 'lost' */
  lostShort: string;
  lostWhere: string;
  finishedWhere: string;
  finishedActivity: string;
  /** e.g. '7,950 m' or '142.1M km' */
  positionLabel: (pos: number) => string;
  /** nearest named waypoint at/below pos */
  waypointAt: (pos: number) => { label: string; frac: number };
  motion: {
    up: string;
    down: string;
    /** descending with a destination, e.g. "Down to Camp II to recover" */
    downTo?: (waypoint: string) => string;
    restingAt: (waypoint: string) => string;
    holding: string;
    preparing: string;
    /** stationary during a storm window, e.g. "Waiting out the storm at Camp II" */
    holdingStorm?: (waypoint: string) => string;
  };
  statusLabels: Record<ClimberStatus, string>;
  /** 7 labels in meter order: o2, food, rope, med, energy, morale, accl */
  meterLabels: [string, string, string, string, string, string, string];
  resultsFinishLine: (timeStr: string) => string;
  resultsLostLine: string;
  /** phase banner label at time t */
  phaseLabel: (tMs: number, durationMs: number) => string;
  /** the playback bar's jump-to-finale button text */
  finaleJumpLabel: string;
  /** results memorial heading; the memorial renders only when set and deaths exist */
  memorialTitle?: string;
  /** finale alive-pips tooltip, e.g. "3 still climbing" */
  stillActiveLabel?: (n: number) => string;
}

export const EVEREST_JOURNEY: JourneyTheme = {
  standingsTitle: 'On the mountain',
  finaleTitle: 'SUMMIT PUSH',
  squadTitle: 'Squad',
  readinessLabel: 'Readiness for next push',
  wipedCard: 'The mountain keeps them. Expedition over.',
  lostShort: 'lost',
  lostWhere: 'Lost on the mountain',
  finishedWhere: 'Summit',
  finishedActivity: 'Summited',
  positionLabel: (pos) => `${altitudeAt(pos).toLocaleString()} m`,
  waypointAt: (pos) => {
    const n = nodeAtOrBelow(pos);
    return { label: n.label, frac: n.frac };
  },
  motion: {
    up: 'Climbing',
    down: 'Descending to rest',
    downTo: (w) => `Down to ${w} to recover`,
    restingAt: (w) => `Resting at ${w}`,
    holding: 'Holding position',
    preparing: 'Preparing at Base Camp',
    holdingStorm: (w) => `Waiting out the storm at ${w}`,
  },
  statusLabels: {
    climbing: 'climbing',
    resting: 'resting',
    injured: 'injured',
    'turned-back': 'turned back',
    fallen: 'fallen',
  },
  meterLabels: [
    'Oxygen',
    'Food & fuel',
    'Rope',
    'Medical',
    'Energy',
    'Morale',
    'Acclimatization',
  ],
  resultsFinishLine: (t) => `summited at ${t}`,
  resultsLostLine: 'Lost on the mountain — did not summit',
  phaseLabel: (tMs, durationMs) => {
    const phase = PHASE_NAMES[phaseAt(tMs, durationMs)];
    return phase.charAt(0).toUpperCase() + phase.slice(1);
  },
  finaleJumpLabel: 'Summit push',
  memorialTitle: 'The mountain keeps them',
  stillActiveLabel: (n) => `${n} still climbing`,
};
