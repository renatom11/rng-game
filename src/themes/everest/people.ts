import type { RNG } from '@/engine/prng';
import { pick, randInt } from '@/engine/prng';
import type { Climber, ClimberLook } from './types';

/**
 * Heritage banks for generated climbers. First and last names are LINKED —
 * a climber's given name, surname, nationality, and hometown all come from
 * one heritage, so the roster reads like real people rather than a name
 * blender. Skin tone indices reference the portrait palette (0 light → 5
 * deep) and are drawn inside each heritage's band; a couple of bands are
 * deliberately wide where the country is.
 *
 * Everything here is cosmetic: consumed only from the 'cast' stream, forked
 * after the core outcome is fixed.
 */
export interface Heritage {
  id: string;
  country: string;
  flag: string;
  firstM: string[];
  firstF: string[];
  last: string[];
  hometowns: string[];
  skinBand: [number, number];
  /** Slavic-style surname feminization: -ov/-ev → +a, -ski → -ska. */
  feminizeLast?: boolean;
}

export const HERITAGES: Heritage[] = [
  {
    id: 'nepali',
    country: 'Nepal',
    flag: '🇳🇵',
    firstM: ['Bikash', 'Suman', 'Rajan', 'Anil', 'Deepak', 'Kiran', 'Prakash'],
    firstF: ['Sunita', 'Anita', 'Mira', 'Kamala', 'Sarita', 'Binita'],
    last: ['Gurung', 'Rai', 'Tamang', 'Magar', 'Thapa', 'Shrestha', 'Adhikari', 'Karki'],
    hometowns: ['Kathmandu', 'Pokhara', 'Lukla', 'Dharan'],
    skinBand: [2, 4],
  },
  {
    id: 'japanese',
    country: 'Japan',
    flag: '🇯🇵',
    firstM: ['Kenji', 'Hiroshi', 'Takeshi', 'Yuto', 'Daisuke', 'Haruki'],
    firstF: ['Yuki', 'Aiko', 'Sakura', 'Hana', 'Emi', 'Rin'],
    last: ['Sato', 'Takeda', 'Yamamoto', 'Kobayashi', 'Watanabe', 'Tanaka', 'Fujii', 'Nakamura'],
    hometowns: ['Sapporo', 'Nagano', 'Sendai', 'Matsumoto'],
    skinBand: [1, 2],
  },
  {
    id: 'korean',
    country: 'South Korea',
    flag: '🇰🇷',
    firstM: ['Minjun', 'Jihoon', 'Seojun', 'Taeyang', 'Donghyun', 'Joon'],
    firstF: ['Jiwoo', 'Soyeon', 'Haeun', 'Yuna', 'Minseo', 'Eunji'],
    last: ['Kim', 'Park', 'Lee', 'Choi', 'Jung', 'Kang', 'Yoon', 'Lim'],
    hometowns: ['Seoul', 'Busan', 'Daegu', 'Chuncheon'],
    skinBand: [1, 2],
  },
  {
    id: 'chinese',
    country: 'China',
    flag: '🇨🇳',
    firstM: ['Wei', 'Jian', 'Ming', 'Tao', 'Feng', 'Lei'],
    firstF: ['Mei', 'Lin', 'Xia', 'Hui', 'Yan', 'Jing'],
    last: ['Wang', 'Li', 'Zhang', 'Chen', 'Liu', 'Yang', 'Zhao', 'Huang'],
    hometowns: ['Chengdu', 'Kunming', "Xi'an", 'Harbin'],
    skinBand: [1, 2],
  },
  {
    id: 'indian',
    country: 'India',
    flag: '🇮🇳',
    firstM: ['Arjun', 'Rohan', 'Vikram', 'Aditya', 'Karan', 'Rahul'],
    firstF: ['Priya', 'Ananya', 'Kavya', 'Meera', 'Divya', 'Isha'],
    last: ['Sharma', 'Patel', 'Singh', 'Verma', 'Nair', 'Rao', 'Iyer', 'Kapoor'],
    hometowns: ['Darjeeling', 'Dehradun', 'Mumbai', 'Manali'],
    skinBand: [2, 4],
  },
  {
    id: 'iranian',
    country: 'Iran',
    flag: '🇮🇷',
    firstM: ['Arash', 'Babak', 'Farhad', 'Kamran', 'Navid', 'Sohrab'],
    firstF: ['Leila', 'Shirin', 'Yasmin', 'Roya', 'Niloufar', 'Parisa'],
    last: ['Karimi', 'Hosseini', 'Rahimi', 'Farahani', 'Moradi', 'Jafari', 'Azad', 'Nazari'],
    hometowns: ['Tehran', 'Isfahan', 'Tabriz', 'Shiraz'],
    skinBand: [1, 3],
  },
  {
    id: 'kenyan',
    country: 'Kenya',
    flag: '🇰🇪',
    firstM: ['Brian', 'Kelvin', 'Dennis', 'Amos', 'Elias', 'Musa'],
    firstF: ['Faith', 'Mercy', 'Wanjiru', 'Achieng', 'Naliaka', 'Zawadi'],
    last: ['Mwangi', 'Ochieng', 'Kiprop', 'Wafula', 'Njoroge', 'Kamau', 'Otieno', 'Chebet'],
    hometowns: ['Nairobi', 'Eldoret', 'Nakuru', 'Nanyuki'],
    skinBand: [4, 5],
  },
  {
    id: 'nigerian',
    country: 'Nigeria',
    flag: '🇳🇬',
    firstM: ['Chinedu', 'Emeka', 'Tunde', 'Ifeanyi', 'Kelechi', 'Segun'],
    firstF: ['Amara', 'Chioma', 'Ngozi', 'Funmi', 'Adaeze', 'Bisi'],
    last: ['Okafor', 'Adeyemi', 'Okonkwo', 'Balogun', 'Eze', 'Nwachukwu', 'Obi', 'Adebayo'],
    hometowns: ['Lagos', 'Abuja', 'Enugu', 'Jos'],
    skinBand: [4, 5],
  },
  {
    id: 'norwegian',
    country: 'Norway',
    flag: '🇳🇴',
    firstM: ['Lars', 'Henrik', 'Bjørn', 'Finn', 'Emil', 'Sindre'],
    firstF: ['Ingrid', 'Astrid', 'Freya', 'Maren', 'Solveig', 'Kari'],
    last: ['Halvorsen', 'Berg', 'Nilsen', 'Haugen', 'Dahl', 'Strand', 'Eriksen', 'Larsen'],
    hometowns: ['Oslo', 'Tromsø', 'Bergen', 'Trondheim'],
    skinBand: [0, 1],
  },
  {
    id: 'german',
    country: 'Germany',
    flag: '🇩🇪',
    firstM: ['Stefan', 'Thomas', 'Jonas', 'Felix', 'Lukas', 'Matthias'],
    firstF: ['Greta', 'Anja', 'Lena', 'Clara', 'Birgit', 'Hanna'],
    last: ['Meyer', 'Weiss', 'Schneider', 'Fischer', 'Wagner', 'Keller', 'Brandt', 'Hofmann'],
    hometowns: ['Munich', 'Garmisch', 'Freiburg', 'Berchtesgaden'],
    skinBand: [0, 1],
  },
  {
    id: 'italian',
    country: 'Italy',
    flag: '🇮🇹',
    firstM: ['Marco', 'Matteo', 'Luca', 'Paolo', 'Andrea', 'Giulio'],
    firstF: ['Lucia', 'Sofia', 'Elena', 'Giulia', 'Francesca', 'Chiara'],
    last: ['Marchetti', 'Romano', 'Ricci', 'Moretti', 'Conti', 'Bianchi', 'Ferrari', 'Gallo'],
    hometowns: ['Courmayeur', 'Bolzano', 'Turin', 'Bergamo'],
    skinBand: [0, 2],
  },
  {
    id: 'french',
    country: 'France',
    flag: '🇫🇷',
    firstM: ['Luc', 'Antoine', 'Julien', 'Pierre', 'Mathieu', 'Rémy'],
    firstF: ['Camille', 'Élise', 'Margaux', 'Amélie', 'Claire', 'Manon'],
    last: ['Moreau', 'Lefèvre', 'Girard', 'Chamoux', 'Blanc', 'Ravanel', 'Dubois', 'Perrin'],
    hometowns: ['Chamonix', 'Grenoble', 'Annecy', 'Briançon'],
    skinBand: [0, 2],
  },
  {
    id: 'spanish',
    country: 'Spain',
    flag: '🇪🇸',
    firstM: ['Diego', 'Mateo', 'Javier', 'Álvaro', 'Sergio', 'Pablo'],
    firstF: ['Carmen', 'Rosa', 'Marta', 'Inés', 'Alba', 'Nuria'],
    last: ['Fernandez', 'Garcia', 'Lopez', 'Navarro', 'Serrano', 'Ortega', 'Molina', 'Iglesias'],
    hometowns: ['Granada', 'Huesca', 'Bilbao', 'Madrid'],
    skinBand: [0, 2],
  },
  {
    id: 'bolivian',
    country: 'Bolivia',
    flag: '🇧🇴',
    firstM: ['Ruben', 'Esteban', 'Julio', 'Waldo', 'Hernan', 'Marco'],
    firstF: ['Marisol', 'Carla', 'Ximena', 'Rocio', 'Tania', 'Lidia'],
    last: ['Quispe', 'Mamani', 'Condori', 'Vargas', 'Choque', 'Flores', 'Huanca', 'Apaza'],
    hometowns: ['La Paz', 'El Alto', 'Sorata', 'Cochabamba'],
    skinBand: [2, 4],
  },
  {
    id: 'brazilian',
    country: 'Brazil',
    flag: '🇧🇷',
    firstM: ['Rafael', 'Thiago', 'Bruno', 'Gustavo', 'Felipe', 'Caio'],
    firstF: ['Ana', 'Camila', 'Fernanda', 'Juliana', 'Beatriz', 'Larissa'],
    last: ['Silva', 'Costa', 'Almeida', 'Duarte', 'Oliveira', 'Souza', 'Ribeiro', 'Martins'],
    hometowns: ['São Paulo', 'Curitiba', 'Rio de Janeiro', 'Belo Horizonte'],
    skinBand: [1, 4],
  },
  {
    id: 'russian',
    country: 'Russia',
    flag: '🇷🇺',
    firstM: ['Dmitri', 'Nikolai', 'Viktor', 'Andrei', 'Sergei', 'Pavel'],
    firstF: ['Zoya', 'Vera', 'Nadia', 'Irina', 'Katya', 'Olga'],
    last: ['Volkov', 'Ivanov', 'Antonov', 'Sokolov', 'Fedorov', 'Morozov', 'Orlov', 'Belov'],
    hometowns: ['Moscow', 'Irkutsk', 'Yekaterinburg', 'Novosibirsk'],
    skinBand: [0, 1],
    feminizeLast: true,
  },
  {
    id: 'polish',
    country: 'Poland',
    flag: '🇵🇱',
    firstM: ['Piotr', 'Marek', 'Tomasz', 'Jakub', 'Andrzej', 'Wojtek'],
    firstF: ['Wanda', 'Agnieszka', 'Kasia', 'Magda', 'Ola', 'Ewa'],
    last: ['Kowalski', 'Nowak', 'Zawada', 'Mazur', 'Kamiński', 'Wiśniewski', 'Urban', 'Sikora'],
    hometowns: ['Kraków', 'Zakopane', 'Wrocław', 'Gdańsk'],
    skinBand: [0, 1],
    feminizeLast: true,
  },
  {
    id: 'british',
    country: 'United Kingdom',
    flag: '🇬🇧',
    firstM: ['Callum', 'Rhys', 'Angus', 'Declan', 'Ewan', 'Owen'],
    firstF: ['Niamh', 'Isla', 'Bronwyn', 'Tamsin', 'Erin', 'Maeve'],
    last: ['Murray', 'Bell', 'Fraser', 'Llewellyn', 'Gallagher', 'Hartley', 'Kerr', 'Doyle'],
    hometowns: ['Fort William', 'Sheffield', 'Llanberis', 'Keswick'],
    skinBand: [0, 1],
  },
  {
    id: 'american',
    country: 'United States',
    flag: '🇺🇸',
    firstM: ['Jake', 'Tyler', 'Cole', 'Mason', 'Wyatt', 'Miles'],
    firstF: ['Iris', 'Harper', 'Sage', 'Quinn', 'Emma', 'Riley'],
    last: ['Carter', 'Brooks', 'Hayes', 'Sullivan', 'Parker', 'Mitchell', 'Bennett', 'Walker'],
    hometowns: ['Boulder', 'Seattle', 'Bozeman', 'Salt Lake City'],
    skinBand: [0, 5],
  },
];

/**
 * Sirdars draw from a dedicated Sherpa bank — real expeditions are led up
 * the hill by Nepali sirdars, and 'Tashi' plus the surname 'Sherpa' stay
 * reserved here so no general-pool climber can collide with one.
 */
export const SHERPA_HERITAGE = {
  country: 'Nepal',
  flag: '🇳🇵',
  // Common day-names and given names only — no compounds that reproduce a
  // famous individual's exact full name (a generated sirdar can appear on
  // the memorial, and "Ang Rita Sherpa" is a real legend, not a character).
  // Sirdars always get a generated second given name for the same reason.
  given: [
    'Pasang', 'Lhakpa', 'Mingma', 'Nima', 'Pemba', 'Dawa', 'Phurba',
    'Kami', 'Tashi', 'Chhiring', 'Norbu', 'Gyalzen', 'Dorje',
    'Sonam', 'Karma', 'Lobsang', 'Tsering', 'Jangbu', 'Nuru', 'Phinjo',
  ],
  /** Given names in the bank that are not used for women. */
  maleOnly: ['Norbu', 'Gyalzen', 'Dorje', 'Lobsang', 'Jangbu', 'Phinjo'],
  hometowns: ['Namche Bazaar', 'Khumjung', 'Phortse', 'Thame', 'Pangboche'],
  skinBand: [2, 3] as [number, number],
};

const JOBS = [
  'schoolteacher', 'glacier guide', 'carpenter', 'ER nurse', 'physicist',
  'photographer', 'farmer', 'firefighter', 'cartographer', 'chef',
  'software engineer', 'geologist',
];

const PEAKS = [
  'Denali', 'Aconcagua', 'Ama Dablam', 'Cho Oyu', 'Kilimanjaro',
  'Mont Blanc', 'Elbrus', 'Manaslu',
];

const QUIRKS = [
  'carries the same lucky carabiner on every climb',
  'writes a postcard home from every camp',
  'hums show tunes on fixed lines',
  'refuses to move before morning tea',
  'names every crevasse ladder',
  'keeps a pebble from each summit',
  'reads Tolstoy at altitude',
  'talks to the mountain, quietly, when the wind drops',
];

const BIO_TEMPLATES = [
  '{job} from {hometown}; {quirk}.',
  'Summited {peak} three winters ago and never quite came down.',
  'A {job} who saves all year for expedition season; {quirk}.',
  'Learned ropework on {peak}; {quirk}.',
  'From {hometown} — first laced boots at twelve, first frostbite at twenty.',
  'Ex-{job}. Sold the business, bought the permit.',
  '{quirk}. The squad stopped asking why.',
  'Two attempts on {peak}, both turned back by weather. This one is personal.',
  'The calm one — {job} by trade; {quirk}.',
  'From {hometown}; promised the family this is the last big one. Again.',
];

const SIRDAR_BIOS = [
  'Eleven seasons above eight thousand metres; still counts every prayer flag.',
  'Runs the family teahouse in {hometown} between seasons.',
  'Learned the Icefall from an uncle who learned it from his.',
  'Has carried loads since fourteen; reads weather like other people read mood.',
  'The mountain is an office; {hometown} is home.',
];

function fillBio(rng: RNG, template: string, hometown: string): string {
  const out = template
    .replace(/\{job\}/g, pick(rng, JOBS))
    .replace(/\{peak\}/g, pick(rng, PEAKS))
    .replace(/\{quirk\}/g, pick(rng, QUIRKS))
    .replace(/\{hometown\}/g, hometown);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function feminizeSurname(last: string): string {
  if (last.endsWith('ski')) return last.slice(0, -3) + 'ska';
  if (last.endsWith('ov') || last.endsWith('ev')) return last + 'a';
  return last;
}

function drawLook(rng: RNG, band: [number, number], gender: 0 | 1): ClimberLook {
  const skin = randInt(rng, band[0], band[1]);
  // Deeper skin bands keep hair in the black/dark/grey range.
  const hairColor = skin >= 2 ? pick(rng, [0, 1, 4]) : randInt(rng, 0, 4);
  return {
    skin,
    hair: randInt(rng, 0, 5),
    hairColor,
    facial: gender === 1 ? 0 : randInt(rng, 0, 3),
    headgear: randInt(rng, 0, 3),
    gender,
  };
}

/** Generate one non-sirdar climber from a heritage, deduped globally. */
export function drawClimber(
  rng: RNG,
  heritage: Heritage,
  role: string,
  usedNames: Set<string>,
): Climber {
  const gender: 0 | 1 = rng() < 0.5 ? 0 : 1;
  const firsts = gender === 1 ? heritage.firstF : heritage.firstM;
  let name = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    const first = pick(rng, firsts);
    let last = pick(rng, heritage.last);
    if (heritage.feminizeLast && gender === 1) last = feminizeSurname(last);
    name = `${first} ${last}`;
    if (!usedNames.has(name)) break;
    name = '';
  }
  if (!name || usedNames.has(name)) {
    // Bounded retries exhausted (only plausible at very large fields):
    // disambiguate with a middle initial rather than looping forever.
    const first = pick(rng, firsts);
    let last = pick(rng, heritage.last);
    if (heritage.feminizeLast && gender === 1) last = feminizeSurname(last);
    name = `${first} ${String.fromCharCode(65 + randInt(rng, 0, 25))}. ${last}`;
  }
  usedNames.add(name);
  const hometown = pick(rng, heritage.hometowns);
  return {
    name,
    role,
    nationality: heritage.country,
    flag: heritage.flag,
    age: randInt(rng, 21, 58),
    hometown,
    bio: fillBio(rng, pick(rng, BIO_TEMPLATES), hometown),
    look: drawLook(rng, heritage.skinBand, gender),
  };
}

// Second given names — Sherpa names are usually compound, and the pairing
// keeps generated sirdars from matching any real famous climber's exact
// full name.
const SHERPA_SECOND_M = ['Gyalje', 'Tenji', 'Thundu', 'Chhiri', 'Dendi', 'Rinji'];
const SHERPA_SECOND_F = ['Futi', 'Yangji', 'Chhiri', 'Doma', 'Diki'];

/** Generate a sirdar from the Sherpa bank. */
export function drawSirdar(
  rng: RNG,
  givenName: string,
  usedNames: Set<string>,
): Climber {
  const gender: 0 | 1 = SHERPA_HERITAGE.maleOnly.includes(givenName)
    ? 0
    : rng() < 0.5
      ? 0
      : 1;
  const hometown = pick(rng, SHERPA_HERITAGE.hometowns);
  const seconds = gender === 1 ? SHERPA_SECOND_F : SHERPA_SECOND_M;
  let name = `${givenName} ${pick(rng, seconds)} Sherpa`;
  for (let attempt = 0; usedNames.has(name) && attempt < 12; attempt++) {
    name = `${givenName} ${pick(rng, seconds)} Sherpa`;
  }
  usedNames.add(name);
  return {
    name,
    role: 'Sirdar',
    nationality: SHERPA_HERITAGE.country,
    flag: SHERPA_HERITAGE.flag,
    age: randInt(rng, 26, 55),
    hometown,
    bio: fillBio(rng, pick(rng, SIRDAR_BIOS), hometown),
    look: drawLook(rng, SHERPA_HERITAGE.skinBand, gender),
  };
}

/** The (single) full-name collision space is shared, so callers pass one set. */
export type UsedNames = Set<string>;
