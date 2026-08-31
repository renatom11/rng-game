import { describe, expect, it } from 'vitest';
import { generateEverest } from '@/themes/everest/generate';
import { toJourneySnapshot } from '@/lib/slice';
import { raceDeaths, teamStatesAt } from '@/lib/client/raceState';
import { climberVitalsAt } from '@/lib/client/climberVitals';
import { EVEREST_JOURNEY } from '@/lib/client/journeyTheme';

const N = 8;
const DUR = 1_800_000;

function snapFor(seed: string) {
  const t = generateEverest(seed, {
    teams: Array.from({ length: N }, (_, i) => ({ name: `Team ${i + 1}` })),
    durationMs: DUR,
  });
  return { t, snap: toJourneySnapshot('everest', t, DUR, { complete: true }) };
}

describe('client deaths fold', () => {
  it('records each death at its event time with its cause, never before', () => {
    for (let s = 0; s < 10; s++) {
      const { t, snap } = snapFor(`fold-${s}`);
      const falls = t.events.filter((e) => e.type === 'climber_fall');
      for (const f of falls) {
        const before = teamStatesAt(snap, N, f.tMs - 1, EVEREST_JOURNEY);
        const after = teamStatesAt(snap, N, f.tMs, EVEREST_JOURNEY);
        expect(before[f.teamIdx!].deaths[f.climberIdx!]).toBeNull();
        expect(before[f.teamIdx!].climberStatus[f.climberIdx!]).not.toBe('fallen');
        const d = after[f.teamIdx!].deaths[f.climberIdx!];
        expect(d).not.toBeNull();
        expect(d!.tMs).toBe(f.tMs);
        expect(d!.cause).toBe(f.cause);
      }
    }
  });

  it('a wipeout marks every remaining climber dead with the wipe cause; turned-back climbers survive', () => {
    for (let s = 0; s < 40; s++) {
      const { t, snap } = snapFor(`wipe-${s}`);
      for (const w of t.wipeouts) {
        const st = teamStatesAt(snap, N, DUR, EVEREST_JOURNEY)[w.teamIdx];
        st.climberStatus.forEach((c, ci) => {
          if (c === 'turned-back') {
            expect(st.deaths[ci]).toBeNull();
          } else {
            expect(c).toBe('fallen');
            expect(st.deaths[ci]).not.toBeNull();
            expect(st.deaths[ci]!.tMs).toBeLessThanOrEqual(w.tMs);
          }
        });
      }
    }
  });

  it('raceDeaths matches the per-team fold and is time-ordered', () => {
    for (let s = 0; s < 10; s++) {
      const { snap } = snapFor(`order-${s}`);
      const deaths = raceDeaths(snap, Number.MAX_SAFE_INTEGER);
      for (let i = 1; i < deaths.length; i++) {
        expect(deaths[i].tMs).toBeGreaterThanOrEqual(deaths[i - 1].tMs);
      }
      const states = teamStatesAt(snap, N, DUR, EVEREST_JOURNEY);
      const foldCount = states.reduce(
        (acc, s2) => acc + s2.deaths.filter((d) => d !== null).length,
        0,
      );
      expect(deaths.length).toBe(foldCount);
    }
  });
});

describe('climber vitals', () => {
  it('stay in range, deterministic, and smooth; the dead flatline', () => {
    const { snap } = snapFor('vitals-1');
    for (let team = 0; team < N; team++) {
      for (let ci = 0; ci < 4; ci++) {
        let prev: number | null = null;
        for (let tMs = 0; tMs <= DUR; tMs += 5_000) {
          const v = climberVitalsAt(snap, team, ci, tMs);
          expect(v.alive).toBe(true);
          expect(v.spo2).toBeGreaterThanOrEqual(65);
          expect(v.spo2).toBeLessThanOrEqual(100);
          expect(v.tempC).toBeGreaterThanOrEqual(33);
          expect(v.tempC).toBeLessThanOrEqual(37.5);
          expect(v.output).toBeGreaterThanOrEqual(0);
          expect(v.output).toBeLessThanOrEqual(100);
          if (prev !== null) expect(Math.abs(v.spo2 - prev)).toBeLessThanOrEqual(3);
          prev = v.spo2;
        }
        const a = climberVitalsAt(snap, team, ci, DUR / 2);
        const b = climberVitalsAt(snap, team, ci, DUR / 2);
        expect(a).toEqual(b);
      }
    }
    const dead = climberVitalsAt(snap, 0, 2, DUR / 2, 'fallen', { tMs: 1000 });
    expect(dead.alive).toBe(false);
    expect(dead.spo2).toBe(0);
  });

  it('two climbers on the same rope read differently but consistently', () => {
    const { snap } = snapFor('vitals-2');
    const t = DUR * 0.4;
    const a = climberVitalsAt(snap, 0, 0, t);
    const b = climberVitalsAt(snap, 0, 2, t);
    expect(a.spo2 === b.spo2 && a.output === b.output).toBe(false);
  });
});
