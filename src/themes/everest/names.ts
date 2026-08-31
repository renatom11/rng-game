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

const FIRST = [
  'Anya', 'Marco', 'Tenzin', 'Ingrid', 'Kenji', 'Rosa', 'Dmitri', 'Amara',
  'Lars', 'Priya', 'Sofia', 'Emil', 'Yuki', 'Owen', 'Freya', 'Nikolai',
  'Carmen', 'Tashi', 'Elena', 'Piotr', 'Maren', 'Diego', 'Astrid', 'Rafael',
  'Nadia', 'Finn', 'Leila', 'Viktor', 'Greta', 'Mateo', 'Zoya', 'Henrik',
  'Alma', 'Stefan', 'Iris', 'Tomas', 'Vera', 'Andrei', 'Lucia', 'Bjorn',
];

const LAST = [
  'Halvorsen', 'Okafor', 'Petrova', 'Sato', 'Lindqvist', 'Moreau', 'Katsaros',
  'Novak', 'Fernandez', 'Berg', 'Takeda', 'Sherpa', 'Kovacs', 'Almeida',
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

/** Curated team palette: [hex, spoken name]. Distinct on a dark map. */
export const TEAM_PALETTE: [string, string][] = [
  ['#ff5e5b', 'Crimson'],
  ['#4fc1ff', 'Sky'],
  ['#ffd166', 'Amber'],
  ['#7ae582', 'Jade'],
  ['#c792ea', 'Violet'],
  ['#ff9f68', 'Ember'],
  ['#64dfdf', 'Glacier'],
  ['#f2789f', 'Rose'],
  ['#b8f26d', 'Moss'],
  ['#8ab6ff', 'Cobalt'],
  ['#ffe08a', 'Gold'],
  ['#9ef0e0', 'Mint'],
  ['#e6a4ff', 'Orchid'],
  ['#ffb3ab', 'Coral'],
  ['#a2e8ff', 'Ice'],
  ['#d4c05e', 'Ochre'],
  ['#96e072', 'Fern'],
  ['#f797e1', 'Magenta'],
  ['#7fd4a8', 'Sage'],
  ['#c9a7ff', 'Lilac'],
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
