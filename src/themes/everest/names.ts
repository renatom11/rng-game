import type { RNG } from '@/engine/prng';
import { pick, randInt, shuffle } from '@/engine/prng';
import type { Climber } from './types';

/** Roles, in draft order — index 0 is always the expedition leader. */
const ROLES = [
  'Expedition Leader',
  'Sirdar',
  'Medic',
  'Route Setter',
  'Rope Chief',
  'Navigator',
  'Porter Captain',
  'Weather Officer',
];

// 'Tashi' and the surname 'Sherpa' are reserved for sirdars — sharing them
// with the general pools once produced two different climbers both named
// "Tashi Sherpa", one of them in the same squad as the other.
const FIRST = [
  'Anya', 'Marco', 'Tenzin', 'Ingrid', 'Kenji', 'Rosa', 'Dmitri', 'Amara',
  'Lars', 'Priya', 'Sofia', 'Emil', 'Yuki', 'Owen', 'Freya', 'Nikolai',
  'Carmen', 'Elena', 'Piotr', 'Maren', 'Diego', 'Astrid', 'Rafael',
  'Nadia', 'Finn', 'Leila', 'Viktor', 'Greta', 'Mateo', 'Zoya', 'Henrik',
  'Alma', 'Stefan', 'Iris', 'Tomas', 'Vera', 'Andrei', 'Lucia', 'Bjorn',
];

const LAST = [
  'Halvorsen', 'Okafor', 'Petrova', 'Sato', 'Lindqvist', 'Moreau', 'Katsaros',
  'Novak', 'Fernandez', 'Berg', 'Takeda', 'Kovacs', 'Almeida',
  'Nilsen', 'Volkov', 'Marchetti', 'Haugen', 'Reyes', 'Dahl', 'Ivanov',
  'Costa', 'Larsen', 'Vasquez', 'Antonov', 'Strand', 'Romano', 'Eriksen',
  'Duarte', 'Sokolov', 'Meyer', 'Norgay', 'Bakker', 'Silva', 'Weiss',
];

const SIRDAR_NAMES = [
  'Pasang', 'Lhakpa', 'Mingma', 'Nima', 'Pemba', 'Dawa', 'Phurba', 'Ang Dorje',
  'Kami', 'Tashi', 'Chhiring', 'Norbu', 'Gyalzen', 'Ang Rita', 'Dorje',
  'Sonam', 'Karma', 'Lobsang', 'Tsering', 'Jangbu',
];

export interface Cast {
  /** Per team: the sirdar's given name, used heavily in commentary. */
  sirdar: string[];
  /** Per team: a short epithet, e.g. "the crimson line". */
  epithet: string[];
}

const EPITHET_COLOR_WORD: Record<string, string> = {};

export function buildSquads(
  rng: RNG,
  nTeams: number,
  colorNames: string[],
): { climbers: Climber[][]; cast: Cast } {
  const firstPool = shuffle(rng, FIRST);
  const lastPool = shuffle(rng, LAST);
  const sirdarPool = shuffle(rng, SIRDAR_NAMES);
  let fi = 0;
  let li = 0;

  const climbers: Climber[][] = [];
  const sirdar: string[] = [];
  const epithet: string[] = [];

  for (let t = 0; t < nTeams; t++) {
    const size = randInt(rng, 4, 6);
    const squad: Climber[] = [];
    const sirdarName = sirdarPool[t % sirdarPool.length];
    for (let c = 0; c < size; c++) {
      const role = ROLES[c] ?? 'Climber';
      if (role === 'Sirdar') {
        squad.push({ name: `${sirdarName} Sherpa`, role });
      } else {
        const name = `${firstPool[fi++ % firstPool.length]} ${lastPool[li++ % lastPool.length]}`;
        squad.push({ name, role });
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
