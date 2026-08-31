import type { RNG } from '@/engine/prng';
import { shuffle } from '@/engine/prng';

/**
 * Template rendering with anti-repetition: per template pool, serve a
 * seeded shuffled cycle — the pool is exhausted before any line repeats.
 */

export interface LineCtx {
  [slot: string]: string | number | undefined;
}

export class LineWriter {
  private cycles = new Map<string, { order: number[]; next: number }>();

  constructor(private rng: RNG) {}

  render(poolKey: string, pool: readonly string[], ctx: LineCtx): string {
    let cycle = this.cycles.get(poolKey);
    if (!cycle || cycle.next >= cycle.order.length) {
      cycle = {
        order: shuffle(this.rng, pool.map((_, i) => i)),
        next: 0,
      };
      this.cycles.set(poolKey, cycle);
    }
    const template = pool[cycle.order[cycle.next++]];
    return template.replace(/\{(\w+)\}/g, (_, slot: string) => {
      const v = ctx[slot];
      return v === undefined ? `{${slot}}` : String(v);
    });
  }
}
