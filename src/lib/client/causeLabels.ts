import type { DeathCause } from '@/themes/everest/types';

/** Short structured labels for how a climber was lost. */
export const DEATH_CAUSE_LABELS: Record<DeathCause, string> = {
  'fall-crevasse': 'Crevasse fall',
  'fall-serac': 'Serac collapse',
  'fall-face': 'Tumbled down the mountain',
  froze: 'Died of exposure',
  exhaustion: 'Exhaustion',
  altitude: 'Altitude sickness',
  avalanche: 'Avalanche',
};

/** Label with a fallback for events stored before causes existed. */
export function deathCauseLabel(cause: DeathCause | undefined): string {
  return cause ? DEATH_CAUSE_LABELS[cause] : 'Lost on the mountain';
}
