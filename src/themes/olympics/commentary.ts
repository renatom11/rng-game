import type { RNG } from '@/engine/prng';
import { pick, shuffle } from '@/engine/prng';
import type { Athlete, OlympicsEventType } from './types';
import { SPECIALTIES } from './types';

export const OLY_TEMPLATES: Record<OlympicsEventType, readonly string[]> = {
  ceremony_open: [
    'The cauldron is lit. {gap} delegations march beneath the flags, and the Games are open.',
    'Fireworks over the stadium: {gap} teams, seventeen venues, one podium that matters. Let the Games begin.',
    'The anthem fades, the doves are released (digitally, these days), and {gap} delegations get to work.',
  ],
  ceremony_close: [
    'The cauldron gutters out. The Games are over — the table is final.',
    'Closing ceremony: tired athletes, full medal cases, a result nobody can argue with.',
  ],
  event_start: [
    '{sport} is underway at the {venue}.',
    'Over at the {venue}: {sport} begins.',
    'The officials call the field to order — {sport}, {venue}.',
    'Flashbulbs at the {venue} as {sport} gets going.',
  ],
  event_finish: [
    '{team} take {sport}! {second} silver, {third} bronze.',
    'Gold in {sport} goes to {team}, ahead of {second} and {third}.',
    '{sport} is decided: {team} on top of the podium, {second} and {third} alongside.',
    'A commanding win for {team} in {sport}. {second} and {third} complete the podium.',
  ],
  medal_moment: [
    'First gold of the Games for {team} — the delegation is beside itself.',
    "{team}'s bench erupts. That medal changes their Games.",
  ],
  lead_change: [
    'NEW LEADER: {team} move to the top of the table, {gap} points clear of {rival}.',
    'The table turns over — {team} now lead the Games from {rival}.',
    '{team} seize the overall lead. {rival} will want it back.',
  ],
  standings_update: [
    'Medal table check: {leader} lead on {pts}, {second} chasing.',
    'As the day closes: {leader} on top, {second} within reach, everything still live.',
    'The board reads: {leader}, then {second} — with days of sport to come.',
  ],
  athlete_flavor: [
    '{athlete} of {team} looks untouchable in warmups at the {venue}.',
    'Word from the village: {athlete} ({team}) slept nine hours and ate like a horse. Ominous for everyone else.',
    "Coaches' whisper: watch {athlete} of {team} in {specialty}.",
    '{athlete} signs autographs at the {venue}. Loose. Dangerous.',
  ],
  upset: [
    'UPSET at the {venue}! {team} — near the bottom of the table — snatch {sport}!',
    'Nobody saw that coming: {team} storm {sport} from the back of the field.',
  ],
  crowd: [
    'The roar from the {venue} can be heard across the park.',
    'A wave goes around the stadium. Twice.',
    'Ticket touts outside the {venue} are having the week of their lives.',
  ],
  venue_color: [
    'Groundskeepers repaint the lines at the {venue} under floodlight.',
    'The medal engraver sharpens her tools. Busy days ahead.',
    'Rain sweeps the park for ten minutes and leaves everything gleaming.',
    'A lost mascot performer wanders the {venue} concourse to great applause.',
  ],
};

const FIRST = [
  'Anya', 'Marco', 'Keiko', 'Ingrid', 'Kwame', 'Rosa', 'Dmitri', 'Amara',
  'Lars', 'Priya', 'Sofia', 'Emil', 'Yuki', 'Owen', 'Freya', 'Nikolai',
  'Carmen', 'Elena', 'Piotr', 'Maren', 'Diego', 'Astrid', 'Rafael', 'Nadia',
  'Finn', 'Leila', 'Viktor', 'Greta', 'Mateo', 'Zoya', 'Henrik', 'Alma',
];

const LAST = [
  'Halvorsen', 'Okafor', 'Petrova', 'Sato', 'Lindqvist', 'Moreau', 'Katsaros',
  'Novak', 'Fernandez', 'Berg', 'Takeda', 'Kovacs', 'Almeida', 'Nilsen',
  'Volkov', 'Marchetti', 'Haugen', 'Reyes', 'Dahl', 'Ivanov', 'Costa',
  'Larsen', 'Vasquez', 'Antonov', 'Strand', 'Romano', 'Eriksen', 'Duarte',
];

export function buildAthletes(rng: RNG, nTeams: number): Athlete[][] {
  const firstPool = shuffle(rng, FIRST);
  const lastPool = shuffle(rng, LAST);
  let fi = 0;
  let li = 0;
  const out: Athlete[][] = [];
  for (let t = 0; t < nTeams; t++) {
    const squad: Athlete[] = [];
    const specs = shuffle(rng, SPECIALTIES);
    for (let a = 0; a < 6; a++) {
      squad.push({
        name: `${firstPool[fi++ % firstPool.length]} ${lastPool[li++ % lastPool.length]}`,
        specialty: specs[a % specs.length],
      });
    }
    out.push(squad);
  }
  return out;
}

export function pickAthlete(rng: RNG, athletes: Athlete[][], teamIdx: number): Athlete {
  return pick(rng, athletes[teamIdx]);
}
