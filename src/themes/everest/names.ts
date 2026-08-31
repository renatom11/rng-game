import type { RNG } from '@/engine/prng';
import { shuffle } from '@/engine/prng';
import type { Climber } from './types';
import { HERITAGES, SHERPA_HERITAGE, drawClimber, drawSirdar } from './people';

/**
 * Roles, in draft order — index 0 is always the expedition leader. Squads
 * are exactly four: every team fields a Leader, a Sirdar, a Medic, and a
 * Route Setter (the sponsor's four souls on the mountain).
 */
export const SQUAD_SIZE = 4;
export const SQUAD_ROLES = ['Expedition Leader', 'Sirdar', 'Medic', 'Route Setter'];

export interface Cast {
  /** Per team: the sirdar's given name, used heavily in commentary. */
  sirdar: string[];
  /** Per team: a short epithet, e.g. "the crimson line". */
  epithet: string[];
}

export function buildSquads(
  rng: RNG,
  nTeams: number,
  colorNames: string[],
): { climbers: Climber[][]; cast: Cast } {
  const sirdarPool = shuffle(rng, SHERPA_HERITAGE.given);
  // A shuffled heritage deck spreads squads across many nations before any
  // heritage repeats; redealt when it runs out.
  let deck = shuffle(rng, HERITAGES);
  let di = 0;
  const nextHeritage = () => {
    if (di >= deck.length) {
      deck = shuffle(rng, HERITAGES);
      di = 0;
    }
    return deck[di++];
  };
  const usedNames = new Set<string>();

  const climbers: Climber[][] = [];
  const sirdar: string[] = [];
  const epithet: string[] = [];

  for (let t = 0; t < nTeams; t++) {
    const squad: Climber[] = [];
    const sirdarName = sirdarPool[t % sirdarPool.length];
    for (let c = 0; c < SQUAD_SIZE; c++) {
      const role = SQUAD_ROLES[c];
      if (role === 'Sirdar') {
        squad.push(drawSirdar(rng, sirdarName, usedNames));
      } else {
        squad.push(drawClimber(rng, nextHeritage(), role, usedNames));
      }
    }
    climbers.push(squad);
    sirdar.push(sirdarName);
    epithet.push(`the ${(colorNames[t] ?? 'unmarked').toLowerCase()} line`);
  }
  return { climbers, cast: { sirdar, epithet } };
}

/**
 * Curated team palette: [hex, spoken name], in ASSIGNMENT ORDER.
 * Validated (dataviz six checks) against the dark surface #111c30:
 * lightness band, chroma floor, adjacent-pair CVD separation, normal-vision
 * floor, and 3:1 contrast all pass (one adjacent pair sits in the 6–8 CVD
 * band, which is legal because markers always carry team tags and standings
 * rows/chart lines carry direct labels). Do not re-order casually.
 */
export const TEAM_PALETTE: [string, string][] = [
  ['#3987e5', 'Cobalt'],
  ['#d95926', 'Ember'],
  ['#199e70', 'Jade'],
  ['#c98500', 'Gold'],
  ['#d55181', 'Rose'],
  ['#008300', 'Forest'],
  ['#9085e9', 'Violet'],
  ['#e66767', 'Coral'],
  ['#12a7a7', 'Lagoon'],
  ['#9e497d', 'Mulberry'],
  ['#909b3b', 'Moss'],
  ['#5465b1', 'Indigo'],
  ['#c77f3e', 'Amber'],
  ['#118568', 'Pine'],
  ['#b379c0', 'Orchid'],
  ['#7b6c01', 'Bronze'],
  ['#439ccc', 'Sky'],
  ['#a8465d', 'Garnet'],
  ['#5da56e', 'Sage'],
  ['#725ca9', 'Iris'],
];

export function assignColors(nTeams: number, given: (string | undefined)[]): {
  colors: string[];
  colorNames: string[];
} {
  const colors: string[] = [];
  const colorNames: string[] = [];
  for (let i = 0; i < nTeams; i++) {
    const fallback = TEAM_PALETTE[i % TEAM_PALETTE.length];
    if (given[i]) {
      colors.push(given[i]!);
      colorNames.push(fallback[1]);
    } else {
      colors.push(fallback[0]);
      colorNames.push(fallback[1]);
    }
  }
  return { colors, colorNames };
}
