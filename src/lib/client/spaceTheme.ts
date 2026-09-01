import type { JourneyTheme } from './journeyTheme';
import { distanceLabel, nodeAtOrBelow } from '@/themes/space/route';
import { SPACE_PHASE_NAMES } from '@/themes/space/commentary';
import { phaseAt } from './raceState';

export const SPACE_JOURNEY: JourneyTheme = {
  standingsTitle: 'Fleet standings',
  finaleTitle: 'FINAL DESCENT',
  finaleArrivedPrefix: 'down at',
  squadTitle: 'Crew',
  readinessLabel: 'Burn readiness',
  wipedCard: 'All contact lost. The void keeps them.',
  lostShort: 'dark',
  lostWhere: 'Contact lost',
  finishedWhere: 'Mars',
  finishedActivity: 'On Mars',
  positionLabel: distanceLabel,
  waypointAt: (pos) => {
    const wp = nodeAtOrBelow(pos);
    return { label: wp.label, frac: wp.frac };
  },
  motion: {
    up: 'Under burn',
    down: 'Falling back to resupply',
    restingAt: (w) => `Station-keeping at ${w}`,
    holding: 'Coasting',
    preparing: 'On the pad',
  },
  statusLabels: {
    climbing: 'on shift',
    resting: 'off shift',
    injured: 'injured',
    'turned-back': 'sent home',
    fallen: 'lost',
  },
  meterLabels: [
    'Fuel',
    'Supplies',
    'Hull',
    'Spares',
    'Crew energy',
    'Morale',
    'Trajectory trim',
  ],
  resultsFinishLine: (t) => `touched down at ${t}`,
  resultsLostLine: 'All contact lost — never reached Mars',
  phaseLabel: (tMs, durationMs) => {
    const phase = SPACE_PHASE_NAMES[phaseAt(tMs, durationMs)];
    return phase.charAt(0).toUpperCase() + phase.slice(1);
  },
  finaleJumpLabel: 'Final descent',
  stillActiveLabel: (n) => `${n} still aboard`,
};
