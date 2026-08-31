/**
 * Deterministic PRNG utilities. The engine must never touch Math.random or
 * Date.now — every random draw flows from a race's hex seed through here.
 *
 * Base generator: sfc32 (128-bit state, passes PractRand far beyond our needs).
 * Stream forking: hash(seedHex + ':' + label) -> independent sfc32 state, so
 * each subsystem (permutation, standings, decoration, ...) owns an isolated
 * stream. Tweaking how many draws one subsystem makes can never perturb
 * another — this is what makes the fairness guarantees provable.
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

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Derive an independent RNG stream from the race seed and a subsystem label. */
export function forkRng(seedHex: string, label: string): RNG {
  const mix = splitmix32(fnv1a(seedHex + ':' + label));
  const rng = sfc32(mix(), mix(), mix(), mix());
  // Discard warm-up output so nearby hash states decorrelate.
  for (let i = 0; i < 12; i++) rng();
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
