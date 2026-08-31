import { beforeAll, describe, expect, it } from 'vitest';
import { generateSpace } from '@/themes/space/generate';
import type { EverestTimeline } from '@/themes/everest/types';
import { METER_KEYS } from '@/themes/everest/types';
import { NODES, SEGMENTS } from '@/themes/space/route';
import { toJourneySnapshot } from '@/lib/slice';
import { HOLD_P } from '@/engine/types';

function cfg(n: number, durationMs: number, style?: 'bold' | 'cautious') {
  return {
    teams: Array.from({ length: n }, (_, i) => ({
      name: `Crew ${i + 1}`,
      style,
    })),
    durationMs,
  };
}

const N = 8;
const DUR = 1_800_000;
let runs: EverestTimeline[] = [];

beforeAll(() => {
  runs = [];
  for (let s = 0; s < 40; s++) {
    runs.push(generateSpace(`sp-${s}`, cfg(N, DUR)));
  }
});

describe('space theme', () => {
  it('is deterministic', () => {
    const a = generateSpace('same-seed', cfg(6, 600_000));
    const b = generateSpace('same-seed', cfg(6, 600_000));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('styles provably cannot shift the outcome', () => {
    for (let s = 0; s < 25; s++) {
      const bold = generateSpace(`style-${s}`, cfg(7, 300_000, 'bold'));
      const caut = generateSpace(`style-${s}`, cfg(7, 300_000, 'cautious'));
      expect(JSON.stringify(bold.core)).toEqual(JSON.stringify(caut.core));
    }
  });

  it('display track stays in [0,1], never teleports, touches down at 1', () => {
    for (const t of runs) {
      for (let team = 0; team < N; team++) {
        const row = t.displayTrack.pos[team];
        const wiped = t.wipeouts.find((w) => w.teamIdx === team);
        for (let i = 0; i < row.length; i++) {
          expect(row[i]).toBeGreaterThanOrEqual(0);
          expect(row[i]).toBeLessThanOrEqual(1);
          if (i > 0) {
            expect(Math.abs(row[i] - row[i - 1])).toBeLessThanOrEqual(0.06);
          }
        }
        if (!wiped) {
          expect(row[row.length - 1]).toBeGreaterThan(0.99);
        }
      }
    }
  });

  it('the fleet spreads out mid-race (anti-bunching)', () => {
    let spreadSum = 0;
    let count = 0;
    for (const t of runs) {
      for (const frac of [0.35, 0.5, 0.65]) {
        const target = frac * DUR;
        let gi = 0;
        for (let i = 0; i < t.displayTrack.tMs.length; i++) {
          if (t.displayTrack.tMs[i] <= target) gi = i;
        }
        const vals = t.displayTrack.pos.map((row) => row[gi]);
        spreadSum += Math.max(...vals) - Math.min(...vals);
        count++;
      }
    }
    expect(spreadSum / count).toBeGreaterThan(0.08);
  });

  it('meters stay in range and move continuously', () => {
    for (const t of runs.slice(0, 12)) {
      for (let team = 0; team < N; team++) {
        for (let m = 0; m < METER_KEYS.length; m++) {
          const row = t.meters.values[team][m];
          for (let i = 0; i < row.length; i++) {
            expect(row[i]).toBeGreaterThanOrEqual(0);
            expect(row[i]).toBeLessThanOrEqual(100);
            if (i > 0) {
              expect(Math.abs(row[i] - row[i - 1])).toBeLessThanOrEqual(25);
            }
          }
        }
      }
    }
  });

  it('dark ships only at bottom placements, late, before any touchdown', () => {
    for (const t of runs) {
      const n = t.core.finalOrder.length;
      const firstDown = Math.min(...t.core.summitTimesMs);
      for (const w of t.wipeouts) {
        expect(t.core.finalRank[w.teamIdx]).toBeGreaterThan(n - t.wipeouts.length);
        expect(w.tMs).toBeGreaterThan(t.core.pushStartMs);
        expect(w.tMs).toBeLessThan(firstDown);
      }
    }
  });

  it('crew losses respect the roster; Commander and Flight Director never fall', () => {
    for (const t of runs) {
      const fallCounts = new Map<number, number>();
      for (const e of t.events) {
        if (e.type === 'climber_fall' && e.teamIdx !== undefined) {
          fallCounts.set(e.teamIdx, (fallCounts.get(e.teamIdx) ?? 0) + 1);
          const role = t.climbers[e.teamIdx][e.climberIdx!].role;
          expect(role).not.toBe('Commander');
          expect(role).not.toBe('Flight Director');
        }
      }
      for (const [team, falls] of fallCounts) {
        expect(falls).toBeLessThanOrEqual(t.climbers[team].length);
      }
    }
  });

  it('touchdown events match the final order; dark ships never land', () => {
    for (const t of runs) {
      const downs = t.events.filter((e) => e.type === 'summit');
      const wipedSet = new Set(t.wipeouts.map((w) => w.teamIdx));
      const expected = t.core.finalOrder.filter((i) => !wipedSet.has(i));
      expect(downs.map((e) => e.teamIdx)).toEqual(expected);
    }
  });

  it('event density scales and leaves no long silent gaps; no unfilled slots', () => {
    for (const [n, dur] of [
      [6, 60_000],
      [10, 3_600_000],
    ] as const) {
      const t = generateSpace(`density-${n}-${dur}`, cfg(n, dur));
      const times = t.events.map((e) => e.tMs).sort((a, b) => a - b);
      expect(times.length).toBeGreaterThan(30);
      const maxGap = Math.max(45_000, dur / 40);
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1]).toBeLessThanOrEqual(maxGap);
      }
      for (const e of t.events) {
        expect(e.text, `${e.type}: ${e.text}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('every fork_choice edge is a real edge of the Mars route', () => {
    const validEdges = new Set(SEGMENTS.flatMap((s) => s.edges.map((e) => e.id)));
    for (const t of runs.slice(0, 12)) {
      for (const e of t.events) {
        if (e.type === 'fork_choice') {
          expect(validEdges.has(e.edgeId!)).toBe(true);
        }
      }
    }
  });

  it('route geometry is consistent with the journey contract', () => {
    expect(NODES[0].frac).toBe(0);
    expect(NODES[NODES.length - 1].frac).toBe(1);
    const staging = NODES.find((n) => n.id === 'STAGING')!;
    expect(Math.abs(staging.frac - 0.7)).toBeLessThan(0.02);
    expect(HOLD_P).toBeLessThan(staging.frac);
  });

  it('spoiler slicing works for the space theme', () => {
    const t = runs[0];
    const snap = toJourneySnapshot('space', t, DUR * 0.5, { complete: false });
    expect(snap.theme).toBe('space');
    expect(snap.finalOrder).toBeUndefined();
    expect(snap.horizonMs).toBeLessThanOrEqual(t.core.pushStartMs);
    for (const e of snap.events) expect(e.tMs).toBeLessThanOrEqual(snap.horizonMs);
    expect(JSON.stringify(snap)).not.toContain('"finalOrder"');
  });
});
