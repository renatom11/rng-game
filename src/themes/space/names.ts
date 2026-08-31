import type { RNG } from '@/engine/prng';
import { randInt, shuffle } from '@/engine/prng';
import type { Climber } from '@/themes/everest/types';

/**
 * Crew generation. Structurally identical to the Everest squads (the shared
 * machinery reads roles and statuses, not words): index 0 is the Commander
 * and the Flight Director is the protected sirdar-analog voice — both keep
 * talking on the loop, so fate events never touch them.
 */

const ROLES = [
  'Commander',
  'Flight Director',
  'Flight Engineer',
  'Navigator',
  'Flight Surgeon',
  'Payload Specialist',
  'Systems Officer',
  'Comms Officer',
];

const FIRST = [
  'Ada', 'Marcus', 'Yuna', 'Dmitri', 'Priya', 'Silas', 'Ingrid', 'Kofi',
  'Elena', 'Hiro', 'Zara', 'Anton', 'Maeve', 'Rafael', 'Nadia', 'Otto',
  'Suki', 'Viktor', 'Amara', 'Felix', 'Greta', 'Mateo', 'Lena', 'Bao',
  'Iris', 'Stefan', 'Vera', 'Diego', 'Astrid', 'Emil', 'Zoya', 'Henrik',
];

const LAST = [
  'Okonkwo', 'Volkova', 'Sato', 'Lindgren', 'Moreau', 'Katsaros', 'Novak',
  'Fernandez', 'Berg', 'Takeda', 'Kovacs', 'Almeida', 'Nilsen', 'Marchetti',
  'Haugen', 'Reyes', 'Dahl', 'Ivanov', 'Costa', 'Larsen', 'Vasquez',
  'Antonov', 'Strand', 'Romano', 'Eriksen', 'Duarte', 'Sokolov', 'Meyer',
  'Bakker', 'Silva', 'Weiss', 'Aldrin-Cole',
];

/** Call-sign pool for the Flight Director voice, per team. */
const DIRECTOR_NAMES = [
  'Flight Kowalski', 'Flight Ngata', 'Flight Herrera', 'Flight Osei',
  'Flight Lindqvist', 'Flight Baptiste', 'Flight Zhao', 'Flight Moreno',
  'Flight Petrov', 'Flight Achebe', 'Flight Sandoval', 'Flight Iwu',
  'Flight Halloran', 'Flight Demir', 'Flight Okafor', 'Flight Varga',
  'Flight Sorensen', 'Flight Mbeki', 'Flight Castellano', 'Flight Ruiz',
];

export interface SpaceCast {
  /** Per team: the Flight Director's call sign, used heavily in commentary. */
  director: string[];
  /** Per team: a short ship epithet, e.g. "the crimson ship". */
  epithet: string[];
}

export function buildCrews(
  rng: RNG,
  nTeams: number,
  colorNames: string[],
): { crews: Climber[][]; cast: SpaceCast } {
  const firstPool = shuffle(rng, FIRST);
  const lastPool = shuffle(rng, LAST);
  const directorPool = shuffle(rng, DIRECTOR_NAMES);
  let fi = 0;
  let li = 0;

  const crews: Climber[][] = [];
  const director: string[] = [];
  const epithet: string[] = [];

  for (let t = 0; t < nTeams; t++) {
    const size = randInt(rng, 4, 6);
    const crew: Climber[] = [];
    for (let c = 0; c < size; c++) {
      crew.push({
        name: `${firstPool[fi++ % firstPool.length]} ${lastPool[li++ % lastPool.length]}`,
        role: ROLES[c === 1 ? 1 : c === 0 ? 0 : c] ?? 'Mission Specialist',
      });
    }
    crews.push(crew);
    director.push(directorPool[t % directorPool.length]);
    epithet.push(`the ${(colorNames[t] ?? 'unmarked').toLowerCase()} ship`);
  }
  return { crews, cast: { director, epithet } };
}
