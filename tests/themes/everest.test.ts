import { beforeAll, describe, expect, it } from 'vitest';
import { generateEverest } from '@/themes/everest/generate';
import type { DeathCause, EverestTimeline } from '@/themes/everest/types';
import { METER_KEYS } from '@/themes/everest/types';
import { NODES, SEGMENTS, altitudeAt } from '@/themes/everest/route';
import { HERITAGES, SHERPA_HERITAGE } from '@/themes/everest/people';
import { SQUAD_ROLES } from '@/themes/everest/names';
import { buildDisplayTrack } from '@/themes/everest/rotations';
import {
  CAUGHT_WAITING_LINES,
  DEATH_TEMPLATES,
  PATIENCE_LINES,
  REPULSED_LINES,
  REPULSED_STORM_LINES,
  SHORT_HANDED,
  STORM_GAMBLE_LINES,
  STORM_LINES,
  STORM_ONSET,
  WEATHER_HOLD_LINES,
  WIPEOUT_TEMPLATES,
  ROTATION_LINES,
  FIRST_ROTATION_LINES,
} from '@/themes/everest/commentary/templates';
import { LineWriter } from '@/lib/linewriter';
import { forkRng } from '@/engine/prng';
import { generateCore } from '@/engine/generate';
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

  it('readiness is a cause, not a caption — an empty squad stops climbing', () => {
    // The bar has to MEAN something: a squad with nothing left does not keep
    // strolling uphill. Two failure modes this guards, both of which reduce
    // readiness to decoration — behaviour that ignores the number, and a
    // number so pinned to its floor that ignoring it is the only option.
    const READY = METER_KEYS.indexOf('readiness');
    const ROTATION_END = 0.78; // the closing window; see summitBidStartMs
    let brake = 0, brakeUp = 0, free = 0, freeUp = 0, stop = 0, stopUp = 0;
    let teamsBraked = 0, teams = 0;
    const atCol: number[] = [];

    for (const t of runs.slice(0, 24)) {
      const times = t.displayTrack.tMs;
      const wiped = new Set(t.wipeouts.map((w) => w.teamIdx));
      let iCol = 0;
      while (iCol < times.length - 1 && times[iCol + 1] <= t.core.pushStartMs) iCol++;
      for (let team = 0; team < N; team++) {
        if (wiped.has(team)) continue;
        const pos = t.displayTrack.pos[team];
        const ready = t.meters.values[team][READY];
        teams++;
        atCol.push(ready[iCol]);
        let dipped = false;
        for (let i = 1; i < times.length; i++) {
          if (times[i] / DUR >= ROTATION_END) break; // the field commits regardless
          // The reading the step was decided on is the one BEFORE it.
          const r = ready[i - 1];
          const up = pos[i] - pos[i - 1] > 0.0008;
          if (r >= 34) { free++; if (up) freeUp++; }
          else { brake++; if (up) brakeUp++; dipped = true; }
          if (r < 12) { stop++; if (up) stopUp++; }
        }
        if (dipped) teamsBraked++;
      }
    }

    // The mechanism has to actually engage on a decent share of the field,
    // or the assertions below pass vacuously.
    expect(teamsBraked / teams, 'squads must actually run themselves down').toBeGreaterThan(0.25);
    expect(stop, 'some squad must reach the floor').toBeGreaterThan(0);

    // And when it engages, it bites: a braked squad gains ground far less
    // often than a fresh one, and an empty squad essentially never does.
    const rate = (a: number, b: number) => a / Math.max(1, b);
    expect(rate(brakeUp, brake), 'a spent squad must climb less than a fresh one')
      .toBeLessThan(rate(freeUp, free) * 0.8);
    expect(rate(stopUp, stop), 'an empty squad must not keep strolling uphill')
      .toBeLessThan(0.1);

    // Nor may the whole field arrive at the Col pinned to the floor — then
    // the number is meaningless for the entire final act, which is exactly
    // what it used to do.
    const sorted = [...atCol].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)], 'median squad reaches the Col with something left')
      .toBeGreaterThan(25);
    expect(sorted[Math.floor(sorted.length * 0.9)] - sorted[Math.floor(sorted.length * 0.1)],
      'the field must arrive at the Col in visibly different shape').toBeGreaterThan(20);
  });

  it('the meters shown to players sweep and oscillate — no stagnant bars', () => {
    // The bars are the squad's story. Two ways to be useless: sit in a
    // narrow band all race (what o2, food and readiness used to do), or
    // slide one way to the floor and stay there. So assert BOTH a wide
    // span and genuine two-way movement — a monotone collapse has a large
    // span but almost no rise, and fails here.
    const OSC = { o2: 0, food: 2, energy: 4, readiness: 7 };
    const collect = (m: number) => {
      const spans: number[] = [], rises: number[] = [], falls: number[] = [], pins: number[] = [];
      for (const t of runs.slice(0, 12)) {
        const wiped = new Set(t.wipeouts.map((w) => w.teamIdx));
        for (let team = 0; team < N; team++) {
          if (wiped.has(team)) continue;
          const row = t.meters.values[team][m];
          let up = 0, down = 0;
          for (let i = 1; i < row.length; i++) {
            const d = row[i] - row[i - 1];
            if (d > 0) up += d;
            else down -= d;
          }
          const lo = Math.min(...row);
          spans.push(Math.max(...row) - lo);
          rises.push(up);
          falls.push(down);
          pins.push(row.filter((v) => v <= lo + 3).length / row.length);
        }
      }
      // Judge the 10th-percentile team, not the single unluckiest one: a
      // lone squad that starves high all race is a story, systemic
      // flatness is the bug this guards against.
      const lowQ = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.1)];
      const highQ = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.9)];
      return { span: lowQ(spans), rise: lowQ(rises), fall: lowQ(falls), pinned: highQ(pins) };
    };
    for (const [name, m] of Object.entries(OSC)) {
      const r = collect(m);
      expect(r.span, `${name} must sweep a wide range`).toBeGreaterThan(45);
      expect(r.rise, `${name} must recover, not just drain`).toBeGreaterThan(40);
      expect(r.fall, `${name} must actually deplete`).toBeGreaterThan(70);
      expect(r.pinned, `${name} must not sit at its floor all race`).toBeLessThan(0.6);
    }
    // Acclimatization is meant to be a one-way climb, but must still travel.
    expect(collect(6).span, 'acclimatization must span a wide range').toBeGreaterThan(45);
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

const DEATH_CAUSES: DeathCause[] = [
  'fall-crevasse', 'fall-serac', 'fall-face', 'froze', 'exhaustion', 'altitude', 'avalanche',
];

function displayAt(t: EverestTimeline, teamIdx: number, tMs: number): number {
  const ts = t.displayTrack.tMs;
  const row = t.displayTrack.pos[teamIdx];
  if (tMs <= ts[0]) return row[0];
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] >= tMs) {
      const f = (tMs - ts[i - 1]) / (ts[i] - ts[i - 1] || 1);
      return row[i - 1] + f * (row[i] - row[i - 1]);
    }
  }
  return row[row.length - 1];
}

describe('sponsored squads', () => {
  it('every team fields exactly four, in the four roles, sirdar from the Sherpa bank', () => {
    for (const t of runs) {
      for (const squad of t.climbers) {
        expect(squad.length).toBe(4);
        expect(squad.map((c) => c.role)).toEqual(SQUAD_ROLES);
        expect(squad[1].name.endsWith(' Sherpa')).toBe(true);
        expect(squad[1].nationality).toBe('Nepal');
      }
    }
  });

  it('dossiers are complete, in-range, heritage-consistent, and never duplicated', () => {
    for (const t of runs) {
      const seen = new Set<string>();
      for (const squad of t.climbers) {
        for (const c of squad) {
          expect(seen.has(c.name)).toBe(false);
          seen.add(c.name);
          expect(c.age).toBeGreaterThanOrEqual(21);
          expect(c.age).toBeLessThanOrEqual(58);
          expect(c.flag).toBeTruthy();
          expect(c.nationality).toBeTruthy();
          expect(c.hometown).toBeTruthy();
          expect(c.bio).toBeTruthy();
          expect(c.bio).not.toMatch(/\{\w+\}/);
          const look = c.look!;
          expect(look.skin).toBeGreaterThanOrEqual(0);
          expect(look.skin).toBeLessThanOrEqual(5);
          expect(look.hair).toBeGreaterThanOrEqual(0);
          expect(look.hair).toBeLessThanOrEqual(5);
          expect(look.hairColor).toBeGreaterThanOrEqual(0);
          expect(look.hairColor).toBeLessThanOrEqual(4);
          expect(look.headgear).toBeGreaterThanOrEqual(0);
          expect(look.headgear).toBeLessThanOrEqual(3);
          if (look.gender === 1) expect(look.facial).toBe(0);

          if (c.role === 'Sirdar') {
            expect(SHERPA_HERITAGE.hometowns).toContain(c.hometown);
            const given = c.name.replace(/ Sherpa$/, '').split(' ')[0];
            const bankGivens = SHERPA_HERITAGE.given.map((g) => g.split(' ')[0]);
            expect(bankGivens).toContain(given);
            expect(look.skin).toBeGreaterThanOrEqual(SHERPA_HERITAGE.skinBand[0]);
            expect(look.skin).toBeLessThanOrEqual(SHERPA_HERITAGE.skinBand[1]);
          } else {
            const h = HERITAGES.find((x) => x.country === c.nationality)!;
            expect(h).toBeTruthy();
            const parts = c.name.split(' ');
            const first = parts[0];
            const last = parts[parts.length - 1];
            expect([...h.firstM, ...h.firstF]).toContain(first);
            const lastBankHit =
              h.last.includes(last) ||
              (h.feminizeLast &&
                (h.last.includes(last.replace(/a$/, '')) ||
                  h.last.includes(last.replace(/ska$/, 'ski'))));
            expect(lastBankHit, `${c.name} surname not in ${h.id} bank`).toBe(true);
            expect(h.hometowns).toContain(c.hometown);
            expect(look.skin).toBeGreaterThanOrEqual(h.skinBand[0]);
            expect(look.skin).toBeLessThanOrEqual(h.skinBand[1]);
          }
        }
      }
    }
  });

  it('the sirdar never falls individually', () => {
    for (const t of runs) {
      for (const e of t.events) {
        if (e.type === 'climber_fall' && e.teamIdx !== undefined) {
          expect(t.climbers[e.teamIdx][e.climberIdx!].role).not.toBe('Sirdar');
        }
      }
    }
  });

  it('every death carries a valid cause obeying the hard altitude rules', () => {
    for (const t of runs) {
      for (const e of t.events) {
        if (e.type === 'climber_fall') {
          expect(DEATH_CAUSES).toContain(e.cause);
          const alt = altitudeAt(displayAt(t, e.teamIdx!, e.tMs));
          if (e.cause === 'fall-crevasse') expect(alt).toBeLessThan(6500);
          if (e.cause === 'fall-serac') expect(alt).toBeLessThan(6200);
          if (e.cause === 'fall-face') expect(alt).toBeGreaterThanOrEqual(6400);
          if (e.cause === 'altitude') expect(alt).toBeGreaterThan(7000);
          if (e.cause === 'avalanche') expect(alt).toBeLessThan(7400);
        }
        if (e.type === 'team_wipeout') {
          expect(['froze', 'avalanche']).toContain(e.cause);
        }
      }
    }
  });

  it('no fall lands in a wiped-only time window (the timing side channel is closed)', () => {
    // Regression: wipeout-foreshadow falls once drew from a window
    // ((0.65, 0.87)·duration) no other fall could occupy, so a served
    // pre-push fall event identified its team as the last-place finisher.
    // Every pre-push fall must now sit inside the shared windows.
    for (const t of runs) {
      const pushStart = t.core.pushStartMs;
      for (const e of t.events) {
        if (e.type !== 'climber_fall') continue;
        if (e.tMs >= pushStart) continue;
        const u = e.tMs / DUR;
        const inIcefall = u >= 0.04 - 1e-9 && u <= 0.24 + 1e-9;
        const inMid = u >= 0.35 - 1e-9 && u <= 0.65 + 1e-9;
        expect(inIcefall || inMid, `fall at u=${u.toFixed(3)} outside shared windows`).toBe(true);
      }
    }
  });

  it('the mountain is brutal but bounded, and deaths spread through the race', () => {
    let total = 0;
    let racesWith = 0;
    const thirds = new Set<number>();
    for (const t of runs) {
      const wipedSet = new Set(t.wipeouts.map((w) => w.teamIdx));
      const deaths = t.events.filter(
        (e) => e.type === 'climber_fall' && !wipedSet.has(e.teamIdx!),
      );
      total += deaths.length;
      if (t.events.some((e) => e.type === 'climber_fall')) racesWith++;
      for (const d of deaths) thirds.add(Math.min(2, Math.floor((d.tMs / DUR) * 3)));
    }
    const mean = total / runs.length;
    expect(mean).toBeGreaterThanOrEqual(7);
    expect(mean).toBeLessThanOrEqual(14);
    expect(racesWith / runs.length).toBeGreaterThanOrEqual(0.9);
    expect(thirds.size).toBeGreaterThanOrEqual(2);
  });

  it('the short-handed pace lag is decoration-shaped', () => {
    const core = generateCore('lag-seed-1', { nTeams: 8, durationMs: DUR });
    const base = buildDisplayTrack(forkRng('lag-seed-1', 'rotations'), core, DUR);
    const td = Math.round(0.3 * DUR);
    const lag = buildDisplayTrack(forkRng('lag-seed-1', 'rotations'), core, DUR, undefined, [
      { teamIdx: 0, tMs: td },
    ]);
    let maxGap = 0;
    for (let i = 0; i < base.tMs.length; i++) {
      const t = base.tMs[i];
      const d = base.pos[0][i] - lag.pos[0][i];
      // byte-identical before (and at) the death — no anticipatory signal
      if (t <= td) expect(d).toBe(0);
      // lag only ever slows, and only in the free window
      if (t <= 0.75 * DUR) expect(lag.pos[0][i]).toBeLessThanOrEqual(base.pos[0][i] + 1e-9);
      if (d > maxGap) maxGap = d;
      // pace events for team 0 leave every other team untouched
      for (let tm = 1; tm < 8; tm++) expect(lag.pos[tm][i]).toBe(base.pos[tm][i]);
      // dead by push start
      if (t >= core.pushStartMs) expect(Math.abs(d)).toBeLessThan(0.01);
    }
    expect(maxGap).toBeGreaterThanOrEqual(0.015); // the effect visibly exists
    expect(lag.pos[0][lag.pos[0].length - 1]).toBeGreaterThan(0.99); // still summits
  });

  it('very short races opt out of the pace lag entirely', () => {
    const SHORT = 120_000;
    const core = generateCore('lag-seed-2', { nTeams: 6, durationMs: SHORT });
    const base = buildDisplayTrack(forkRng('lag-seed-2', 'rotations'), core, SHORT);
    const lag = buildDisplayTrack(forkRng('lag-seed-2', 'rotations'), core, SHORT, undefined, [
      { teamIdx: 0, tMs: 30_000 },
      { teamIdx: 2, tMs: 50_000 },
    ]);
    expect(JSON.stringify(lag)).toEqual(JSON.stringify(base));
  });

  it('storm windows are serialized, sane, and the field visibly slows inside them', () => {
    let stormMove = 0, clearMove = 0, sm = 0, cm = 0;
    for (const t of runs) {
      const storms = t.storms ?? [];
      expect(storms.length).toBeGreaterThanOrEqual(1);
      for (let i = 0; i < storms.length; i++) {
        expect(storms[i].startMs).toBeGreaterThanOrEqual(0);
        expect(storms[i].endMs).toBeGreaterThan(storms[i].startMs);
        expect(storms[i].endMs).toBeLessThanOrEqual(DUR);
        if (i > 0) expect(storms[i].startMs).toBeGreaterThan(storms[i - 1].endMs);
      }
      for (let i = 1; i < t.displayTrack.tMs.length; i++) {
        const tm = t.displayTrack.tMs[i];
        if (tm > 0.75 * DUR) break;
        const inStorm = storms.some((s) => tm >= s.startMs && tm <= s.endMs);
        for (let team = 0; team < N; team++) {
          const d = Math.abs(t.displayTrack.pos[team][i] - t.displayTrack.pos[team][i - 1]);
          if (inStorm) { stormMove += d; sm++; }
          else { clearMove += d; cm++; }
        }
      }
    }
    expect(stormMove / sm).toBeLessThan(clearMove / cm);
  });

  it('camp life is narrated: repulsed attempts and weather holds appear in the feed', () => {
    let repulseRuns = 0, holdRuns = 0;
    for (const t of runs) {
      if (t.events.some((e) => e.activity?.startsWith('Retreating to '))) repulseRuns++;
      if (t.events.some((e) => e.activity?.startsWith('Waiting out the storm'))) holdRuns++;
    }
    expect(repulseRuns / runs.length).toBeGreaterThan(0.6);
    expect(holdRuns / runs.length).toBeGreaterThan(0.5);
  });

  it('every new template line renders with no unfilled slots', () => {
    const writer = new LineWriter(forkRng('lint-seed', 'lint'));
    const ctx = {
      climber: 'Test Climber', role: 'medic', team: 'Test Team',
      alt: 7000, edge: 'the test line', sherpa: 'Pasang', gap: 3,
      camp: 'Camp II',
    };
    const pools: readonly string[][] = [
      ...Object.values(DEATH_TEMPLATES).map((p) => [...p]),
      ...Object.values(WIPEOUT_TEMPLATES).map((p) => [...p]),
      [...SHORT_HANDED],
      [...STORM_ONSET],
      [...STORM_LINES],
      [...REPULSED_LINES],
      [...REPULSED_STORM_LINES],
      [...WEATHER_HOLD_LINES],
      [...PATIENCE_LINES],
      [...CAUGHT_WAITING_LINES],
      [...STORM_GAMBLE_LINES],
      [...ROTATION_LINES],
      [...FIRST_ROTATION_LINES],
    ];
    for (const pool of pools) {
      for (const line of pool) {
        expect(writer.render(`lint:${line.slice(0, 12)}`, [line], ctx)).not.toMatch(/\{\w+\}/);
      }
    }
  });
});

describe('storm holds and rotation narration', () => {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const templateRe = (line: string) =>
    new RegExp('^' + line.split(/\{\w+\}/).map(esc).join('[\\s\\S]*') + '$');

  it('a holding team is pinned at its camp for the whole storm — never walked downhill through its own hold, never "repulsed" while flat', () => {
    const D = 3_600_000;
    const core = generateCore('hold-seed-1', { nTeams: 8, durationMs: D });
    const storms = [
      { startMs: D * 0.3, endMs: D * 0.36 },
      { startMs: D * 0.62, endMs: D * 0.68 },
    ];
    const styles = Array.from({ length: 8 }, () => 'cautious' as const);
    const { tMs, pos, beats } = buildDisplayTrack(
      forkRng('hold-seed-1', 'rotations'), core, D, undefined, [], storms, styles,
    );
    const holds = beats.filter((b) => b.kind === 'hold');
    expect(holds.length).toBeGreaterThan(0);
    for (const h of holds) {
      const storm = storms.find((st) => h.tMs >= st.startMs && h.tMs <= st.endMs)!;
      expect(storm).toBeTruthy();
      let reached = false;
      for (let i = 0; i < tMs.length; i++) {
        const t = tMs[i];
        if (t < h.tMs || t > storm.endMs) continue;
        if (t / D >= 0.78) break;
        const x = pos[h.teamIdx][i];
        expect(x).toBeGreaterThanOrEqual(h.campFrac - 1e-6);
        if (!reached && Math.abs(x - h.campFrac) < 1e-6) reached = true;
        if (reached) expect(Math.abs(x - h.campFrac)).toBeLessThan(1e-6);
      }
      expect(
        beats.some(
          (b) => b.kind === 'repulsed' && b.teamIdx === h.teamIdx &&
            b.tMs >= h.tMs && b.tMs <= storm.endMs && b.tMs / D < 0.78,
        ),
      ).toBe(false);
    }
  });

  it('a hold survives crossing into the Col approach while its storm still blows — and everyone still summits', () => {
    const D = 3_600_000;
    const core = generateCore('hold-seed-2', { nTeams: 6, durationMs: D });
    const storms = [{ startMs: D * 0.74, endMs: D * 0.84 }];
    const styles = Array.from({ length: 6 }, () => 'cautious' as const);
    const { tMs, pos, beats } = buildDisplayTrack(
      forkRng('hold-seed-2', 'rotations'), core, D, undefined, [], storms, styles,
    );
    const holds = beats.filter((b) => b.kind === 'hold');
    expect(holds.length).toBeGreaterThan(0);
    for (const h of holds) {
      // Just past the 0.78 phase line, the storm is still on: still pinned.
      const i79 = tMs.findIndex((t) => t >= D * 0.79);
      expect(Math.abs(pos[h.teamIdx][i79] - h.campFrac)).toBeLessThan(1e-6);
    }
    for (let team = 0; team < 6; team++) {
      expect(pos[team][pos[team].length - 1]).toBe(1);
    }
  });

  it('the wait-vs-go ledger never predates the checkpoint whose standings it narrates', () => {
    const patterns = [...PATIENCE_LINES, ...CAUGHT_WAITING_LINES].map(templateRe);
    let matched = 0;
    for (const t of runs) {
      const storms = t.storms ?? [];
      for (const e of t.events) {
        if (!patterns.some((re) => re.test(e.text))) continue;
        matched++;
        const storm = [...storms].filter((st) => st.endMs <= e.tMs).pop();
        expect(storm).toBeTruthy();
        expect(
          t.core.checkpoints.some((cp) => cp.tMs >= storm!.endMs && cp.tMs <= e.tMs),
        ).toBe(true);
      }
    }
    expect(matched).toBeGreaterThan(0);
  });

  it('deliberate recovery descents are narrated, so going down reads as strategy', () => {
    const withRest = runs.filter((t) =>
      t.events.some((e) => e.activity?.startsWith('Down to ')),
    );
    expect(withRest.length / runs.length).toBeGreaterThan(0.3);
  });
});

