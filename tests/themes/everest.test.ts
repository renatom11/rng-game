import { beforeAll, describe, expect, it } from 'vitest';
import { generateEverest } from '@/themes/everest/generate';
import type { EverestTimeline } from '@/themes/everest/types';
import { METER_KEYS } from '@/themes/everest/types';
import { NODES, SEGMENTS } from '@/themes/everest/route';
import { HOLD_P } from '@/engine/types';

function cfg(n: number, durationMs: number, style?: 'bold' | 'cautious') {
  return {
    teams: Array.from({ length: n }, (_, i) => ({
      name: `Team ${i + 1}`,
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
  for (let s = 0; s < 60; s++) {
    runs.push(generateEverest(`ev-${s}`, cfg(N, DUR)));
  }
});

describe('everest theme', () => {
  it('is deterministic', () => {
    const a = generateEverest('same-seed', cfg(6, 600_000));
    const b = generateEverest('same-seed', cfg(6, 600_000));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('styles provably cannot shift the outcome', () => {
    for (let s = 0; s < 40; s++) {
      const bold = generateEverest(`style-${s}`, cfg(7, 300_000, 'bold'));
      const caut = generateEverest(`style-${s}`, cfg(7, 300_000, 'cautious'));
      expect(bold.core.finalOrder).toEqual(caut.core.finalOrder);
      expect(bold.core.summitTimesMs).toEqual(caut.core.summitTimesMs);
      expect(JSON.stringify(bold.core)).toEqual(JSON.stringify(caut.core));
    }
  });

  it('display track stays in [0,1], never teleports, and summits at 1', () => {
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

  it('teams are meaningfully spread out mid-race (anti-bunching)', () => {
    // At several mid-race instants, the field should NOT be clumped: the
    // spread between highest and lowest displayed team is substantial.
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
    expect(spreadSum / count).toBeGreaterThan(0.12);
  });

  it('rotations happen: teams visibly descend during the middle of the race', () => {
    for (const t of runs.slice(0, 20)) {
      let teamsWithDescent = 0;
      for (let team = 0; team < N; team++) {
        const row = t.displayTrack.pos[team];
        let maxSoFar = 0;
        let descended = false;
        for (let i = 0; i < row.length; i++) {
          if (t.displayTrack.tMs[i] >= t.core.pushStartMs) break;
          maxSoFar = Math.max(maxSoFar, row[i]);
          if (maxSoFar - row[i] > 0.08) descended = true;
        }
        if (descended) teamsWithDescent++;
      }
      expect(teamsWithDescent).toBeGreaterThanOrEqual(N - 2);
    }
  });

  it('meters stay in range and move continuously', () => {
    for (const t of runs.slice(0, 20)) {
      for (let team = 0; team < N; team++) {
        for (let m = 0; m < METER_KEYS.length; m++) {
          const row = t.meters.values[team][m];
          for (let i = 0; i < row.length; i++) {
            expect(row[i]).toBeGreaterThanOrEqual(0);
            expect(row[i]).toBeLessThanOrEqual(100);
            if (i > 0) {
              // No meter jumps more than 25 points between sparse keyframes.
              expect(Math.abs(row[i] - row[i - 1])).toBeLessThanOrEqual(25);
            }
          }
        }
      }
    }
  });

  it('wipeouts only hit bottom placements, late, before any summit', () => {
    for (const t of runs) {
      const n = t.core.finalOrder.length;
      const firstSummit = Math.min(...t.core.summitTimesMs);
      t.wipeouts.forEach((w, i) => {
        // wiped teams occupy the bottom placements
        expect(t.core.finalRank[w.teamIdx]).toBeGreaterThan(n - t.wipeouts.length);
        expect(w.tMs).toBeGreaterThan(t.core.pushStartMs);
        expect(w.tMs).toBeLessThan(firstSummit);
      });
      // lower placement wipes earlier
      const sorted = [...t.wipeouts].sort((a, b) => a.tMs - b.tMs);
      for (let i = 1; i < sorted.length; i++) {
        expect(t.core.finalRank[sorted[i - 1].teamIdx]).toBeGreaterThan(
          t.core.finalRank[sorted[i].teamIdx],
        );
      }
    }
  });

  it('falls never exceed squad size and wiped teams lose everyone only at the wipe', () => {
    for (const t of runs) {
      const fallCounts = new Map<number, number>();
      for (const e of t.events) {
        if (e.type === 'climber_fall') {
          fallCounts.set(e.teamIdx!, (fallCounts.get(e.teamIdx!) ?? 0) + 1);
        }
      }
      for (const [team, falls] of fallCounts) {
        const size = t.climbers[team].length;
        const wiped = t.wipeouts.some((w) => w.teamIdx === team);
        expect(falls).toBeLessThanOrEqual(wiped ? size : size - 1);
      }
    }
  });

  it('summit events match the final order; wiped teams never summit', () => {
    for (const t of runs) {
      const summits = t.events.filter((e) => e.type === 'summit');
      const wipedSet = new Set(t.wipeouts.map((w) => w.teamIdx));
      const expected = t.core.finalOrder.filter((i) => !wipedSet.has(i));
      expect(summits.map((e) => e.teamIdx)).toEqual(expected);
      for (const w of t.wipeouts) {
        expect(summits.some((e) => e.teamIdx === w.teamIdx)).toBe(false);
      }
    }
  });

  it('event density scales sanely and leaves no long silent gaps', () => {
    for (const [n, dur] of [
      [6, 60_000],
      [10, 3_600_000],
      [10, 86_400_000],
    ] as const) {
      const t = generateEverest(`density-${n}-${dur}`, cfg(n, dur));
      const times = t.events.map((e) => e.tMs).sort((a, b) => a - b);
      expect(times.length).toBeGreaterThan(30);
      expect(times.length).toBeLessThan(dur >= 43_200_000 ? 2600 : 1500);
      const maxGap = Math.max(45_000, dur / 40);
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1]).toBeLessThanOrEqual(maxGap);
      }
    }
  });

  it('no template slot is left unfilled in any event text', () => {
    for (const t of runs.slice(0, 20)) {
      for (const e of t.events) {
        expect(e.text, `${e.type}: ${e.text}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('every fork_choice edge is a real edge of a real segment', () => {
    const validEdges = new Set(
      SEGMENTS.flatMap((s) => s.edges.map((e) => e.id)),
    );
    for (const t of runs.slice(0, 20)) {
      for (const e of t.events) {
        if (e.type === 'fork_choice') {
          expect(validEdges.has(e.edgeId!)).toBe(true);
        }
      }
    }
  });

  it('route nodes are consistent', () => {
    expect(NODES[0].frac).toBe(0);
    expect(NODES[NODES.length - 1].frac).toBe(1);
    const c4 = NODES.find((n) => n.id === 'C4')!;
    expect(Math.abs(c4.frac - 0.7)).toBeLessThan(0.02);
    expect(HOLD_P).toBeLessThan(c4.frac);
  });
});
