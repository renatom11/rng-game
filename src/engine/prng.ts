/**
 * Deterministic PRNG utilities. The engine must never touch Math.random or
 * Date.now — every random draw flows from a race's hex seed through here.
 *
 * Base generator: sfc32 (128-bit state, passes PractRand far beyond our needs).
 * Stream forking: the seed's full 128 bits, domain-separated by a label hash,
 * become the sfc32 state, so each subsystem (permutation, standings,
 * decoration, ...) owns an isolated stream. Tweaking how many draws one
 * subsystem makes can never perturb another — this is what makes the
 * fairness guarantees provable.
 */

export type RNG = () => number; // uniform in [0, 1)

export function sfc32(a: number, b: number, c: number, d: number): RNG {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const out = (t + d) | 0;
    c = (c + out) | 0;
    return (out >>> 0) / 4294967296;
  };
}

function splitmix32(state: number): () => number {
  let s = state >>> 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    z = z ^ (z >>> 15);
    return z >>> 0;
  };
}

function fnv1a(str: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 128 bits from an arbitrary string via chained FNV-1a passes: each word's
 * hash is prefixed with the previous word, so a full collision requires
 * four successive 32-bit collisions (~2^-128 for non-adversarial input).
 */
function hash128(str: string): [number, number, number, number] {
  const w: number[] = [];
  let carry = 0x811c9dc5;
  for (let i = 0; i < 4; i++) {
    const h = fnv1a(String.fromCharCode(i + 1) + str, carry ^ (0x811c9dc5 + i * 0x9e3779b9));
    w.push(h);
    carry = h;
  }
  return w as [number, number, number, number];
}

const splitmixFinalize = (x: number): number => {
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
};

/**
 * Derive an independent RNG stream from the race seed and a subsystem label.
 *
 * The full 128 bits of a hex seed feed the sfc32 state directly (any other
 * string contributes via hash128), XORed with 128 label-derived bits for
 * domain separation. Funneling the seed through a single 32-bit hash here
 * would cap the whole product at 2^32 distinct races — uniform permutations
 * would be impossible beyond 12 teams and real seeds would collide — so
 * keep the state width if you touch this.
 *
 * Labels are reserved per subsystem (see generate.ts and the theme
 * generators); the seed and label are hashed separately, so pairs are unambiguous.
 */
export function forkRng(seedHex: string, label: string): RNG {
  const sw = /^[0-9a-fA-F]{32}$/.test(seedHex)
    ? ([0, 1, 2, 3].map((i) =>
        parseInt(seedHex.slice(i * 8, i * 8 + 8), 16),
      ) as [number, number, number, number])
    : hash128(seedHex);
  const lw = hash128(label);
  const rng = sfc32(
    splitmixFinalize(sw[0] ^ lw[0]),
    splitmixFinalize(sw[1] ^ lw[1]),
    splitmixFinalize(sw[2] ^ lw[2]),
    splitmixFinalize(sw[3] ^ lw[3]),
  );
  // Discard warm-up output so related states decorrelate.
  for (let i = 0; i < 15; i++) rng();
  return rng;
}

/** Standard normal via Box–Muller. */
export function gauss(rng: RNG): number {
  let u = 0;
  while (u === 0) u = rng(); // avoid log(0)
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Exponential with rate lambda. */
export function expRand(rng: RNG, lambda = 1): number {
  let u = 0;
  while (u === 0) u = rng();
  return -Math.log(u) / lambda;
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(rng: RNG, arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pick<T>(rng: RNG, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function weightedPick<T>(
  rng: RNG,
  items: readonly T[],
  weights: readonly number[],
): T {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Integer in [min, max] inclusive. */
export function randInt(rng: RNG, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
