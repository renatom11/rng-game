import { describe, expect, it } from 'vitest';
import { generateCore } from '@/engine';

describe('determinism', () => {
  it('same (seed, config) produces a byte-identical timeline', () => {
    const a = generateCore('deadbeefcafe0001', { nTeams: 9, durationMs: 3_600_000 });
    const b = generateCore('deadbeefcafe0001', { nTeams: 9, durationMs: 3_600_000 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('different seeds produce different final orders (sanity)', () => {
    const orders = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const t = generateCore(`seed-${i}`, { nTeams: 8, durationMs: 600_000 });
      orders.add(t.finalOrder.join(','));
    }
    expect(orders.size).toBeGreaterThan(30);
  });

  it('handles the extremes: 2 teams / 50 teams, 1 minute / 8 hours', () => {
    for (const [n, d] of [
      [2, 60_000],
      [50, 60_000],
      [2, 28_800_000],
      [50, 28_800_000],
    ] as const) {
      const t = generateCore('extremes', { nTeams: n, durationMs: d });
      expect(t.finalOrder).toHaveLength(n);
      expect(t.grid.tMs[t.grid.tMs.length - 1]).toBe(d);
      for (let i = 0; i < n; i++) {
        expect(t.grid.p[i][t.grid.p[i].length - 1]).toBe(1);
      }
    }
  });
});
