import type { CoreTimeline } from '@/engine/types';
import { PUSH_U } from '@/engine/types';
import type { RNG } from '@/engine/prng';
import { pick, randInt } from '@/engine/prng';
import { NODES, SEGMENTS, altitudeAt, nodeAtOrBelow, nodeById } from './route';
import type { Climber, RaceEvent } from './types';
import type { Cast } from './names';
import type { FatePlan, Traversal } from './decorate';
import { LineWriter } from './commentary/render';
import {
  PHASE_NAMES,
  TEMPLATES,
  TROUBLES,
  WEATHER_LINES,
} from './commentary/templates';
import { METER_INDEX, nudgeMeter } from './meters';

/**
 * Assemble the full event log with pre-rendered commentary. Events explain
 * a story whose outcome is already fixed; nothing here feeds back into the
 * engine. Density scales with duration and no silent gap exceeds
 * max(45s, duration/40).
 */

interface BuildEventsInput {
  rng: RNG;
  core: CoreTimeline;
  durationMs: number;
  displayTrack: { tMs: number[]; pos: number[][] };
  meters: number[][][];
  traversals: Traversal[];
  fate: FatePlan;
  climbers: Climber[][];
  cast: Cast;
  teamNames: string[];
}

const ORDINALS = [
  'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth',
  'Ninth', 'Tenth', 'Eleventh', 'Twelfth',
];

function ordinal(place: number): string {
  return ORDINALS[place - 1] ?? `No. ${place}`;
}

export function buildEvents(input: BuildEventsInput): RaceEvent[] {
  const {
    rng, core, durationMs, displayTrack, meters, traversals, fate,
    climbers, cast, teamNames,
  } = input;
  const n = teamNames.length;
  const writer = new LineWriter(rng);
  const events: RaceEvent[] = [];
  const wipedAt = new Map(fate.wipeouts.map((w) => [w.teamIdx, w.tMs]));

  const ctxFor = (teamIdx: number) => ({
    team: teamNames[teamIdx],
    sherpa: cast.sirdar[teamIdx],
    epithet: cast.epithet[teamIdx],
  });

  const line = (
    type: RaceEvent['type'],
    ctx: Record<string, string | number | undefined>,
  ) => writer.render(type, TEMPLATES[type], ctx);

  // --- Structural skeleton -------------------------------------------------
  events.push({
    tMs: 0,
    type: 'race_start',
    severity: 3,
    text: line('race_start', { gap: n }),
  });

  const phaseUs = [0.1, 0.3, 0.55, 0.72, 0.87];
  phaseUs.forEach((u, i) => {
    events.push({
      tMs: Math.round(u * durationMs),
      type: 'phase_change',
      severity: 2,
      text: line('phase_change', { phase: PHASE_NAMES[i + 1] }),
    });
  });

  events.push({
    tMs: Math.round(0.8 * durationMs),
    type: 'weather_window',
    severity: 3,
    text: line('weather_window', {}),
  });

  // --- Track-derived team movement events ---------------------------------
  const times = displayTrack.tMs;
  for (let team = 0; team < n; team++) {
    const row = displayTrack.pos[team];
    let mode: 'up' | 'down' | 'rest' = 'rest';
    let lastEmit = -1e9;
    const minGap = Math.max(20_000, durationMs / 60);
    for (let i = 1; i < times.length; i++) {
      const t = times[i];
      if (t >= core.pushStartMs) break; // push handled separately
      if (wipedAt.has(team) && t >= wipedAt.get(team)!) break;
      const d = row[i] - row[i - 1];
      const newMode: 'up' | 'down' | 'rest' =
        d > 0.0008 ? 'up' : d < -0.0008 ? 'down' : 'rest';
      if (newMode === mode || t - lastEmit < minGap) continue;
      const camp = nodeAtOrBelow(row[i] + 0.01);
      const atCamp = Math.abs(camp.frac - row[i]) < 0.015;
      if (newMode === 'rest' && atCamp && camp.id !== 'BC') {
        events.push({
          tMs: t, type: 'camp_arrival', teamIdx: team, nodeId: camp.id, severity: 1,
          activity: `Resting at ${camp.label}`,
          text: line('camp_arrival', { ...ctxFor(team), camp: camp.label, alt: camp.alt }),
        });
        lastEmit = t;
      } else if (newMode === 'down' && mode !== 'down') {
        events.push({
          tMs: t, type: 'descend_rest', teamIdx: team, severity: 1,
          activity: 'Descending to rest',
          text: line('descend_rest', ctxFor(team)),
        });
        lastEmit = t;
      } else if (newMode === 'up' && mode === 'rest' && atCamp) {
        events.push({
          tMs: t, type: 'camp_depart', teamIdx: team, nodeId: camp.id, severity: 1,
          activity: 'Climbing',
          text: line('camp_depart', { ...ctxFor(team), camp: camp.label }),
        });
        lastEmit = t;
      }
      mode = newMode;
    }
  }

  // --- Route choices and their consequences -------------------------------
  const routeCausalCount = new Map<number, number>();
  const moveThresh = Math.max(2, Math.round(n / 6));
  for (const tr of traversals) {
    if (wipedAt.has(tr.teamIdx) && tr.tMs >= wipedAt.get(tr.teamIdx)!) continue;
    const seg = SEGMENTS[tr.segIdx];
    if (seg.edges.length > 1) {
      events.push({
        tMs: tr.tMs, type: 'fork_choice', teamIdx: tr.teamIdx,
        edgeId: tr.edge.id, severity: 1,
        activity: `On ${tr.edge.label}`,
        text: line('fork_choice', { ...ctxFor(tr.teamIdx), edge: tr.edge.label }),
      });
    }
    const causal = routeCausalCount.get(tr.teamIdx) ?? 0;
    if (causal >= 3 || Math.abs(tr.rankDelta) < moveThresh) continue;
    const later = tr.tMs + Math.max(30_000, durationMs * 0.015);
    if (later >= core.pushStartMs) continue;
    const ctx = { ...ctxFor(tr.teamIdx), edge: tr.edge.label };
    if (tr.rankDelta <= -moveThresh && tr.edge.risk === 'risky') {
      events.push({ tMs: Math.round(later), type: 'route_payoff', teamIdx: tr.teamIdx, edgeId: tr.edge.id, severity: 2, text: line('route_payoff', ctx) });
      nudgeMeter(meters, tr.teamIdx, METER_INDEX.MORALE, times, later, 9);
      routeCausalCount.set(tr.teamIdx, causal + 1);
    } else if (tr.rankDelta >= moveThresh && tr.edge.risk === 'risky') {
      events.push({ tMs: Math.round(later), type: 'route_punish', teamIdx: tr.teamIdx, edgeId: tr.edge.id, severity: 2, text: line('route_punish', ctx) });
      nudgeMeter(meters, tr.teamIdx, METER_INDEX.MORALE, times, later, -10);
      routeCausalCount.set(tr.teamIdx, causal + 1);
    } else if (tr.rankDelta >= moveThresh && tr.edge.risk === 'safe') {
      events.push({ tMs: Math.round(later), type: 'route_safe_passed', teamIdx: tr.teamIdx, edgeId: tr.edge.id, severity: 2, text: line('route_safe_passed', ctx) });
      routeCausalCount.set(tr.teamIdx, causal + 1);
    }
  }

  // --- Pre-push standings drama: overtakes, surges, setbacks ---------------
  for (let k = 1; k < core.checkpoints.length; k++) {
    const prev = core.checkpoints[k - 1];
    const cur = core.checkpoints[k];
    const tMs = cur.tMs;
    let bestGain = 0;
    let mover = -1;
    for (let team = 0; team < n; team++) {
      const gain = cur.order.indexOf(team) - prev.order.indexOf(team);
      if (gain < bestGain) {
        bestGain = gain;
        mover = team;
      }
    }
    if (mover >= 0 && bestGain <= -1) {
      const newRank = cur.order.indexOf(mover);
      const rival = newRank + 1 < n ? cur.order[newRank + 1] : prev.order[newRank];
      const alt = altitudeAt(displayAtTime(displayTrack, mover, tMs));
      if (bestGain <= -moveThresh && rng() < 0.6) {
        events.push({ tMs, type: 'surge', teamIdx: mover, severity: 2, text: line('surge', ctxFor(mover)) });
      } else {
        events.push({
          tMs, type: 'overtake', teamIdx: mover, rivalIdx: rival, severity: 2,
          text: line('overtake', { ...ctxFor(mover), rival: teamNames[rival], alt }),
        });
      }
    }
    // The biggest faller occasionally gets a setback + later recovery.
    let worstDrop = 0;
    let faller = -1;
    for (let team = 0; team < n; team++) {
      const drop = cur.order.indexOf(team) - prev.order.indexOf(team);
      if (drop > worstDrop) {
        worstDrop = drop;
        faller = team;
      }
    }
    if (faller >= 0 && worstDrop >= moveThresh && rng() < 0.5 && !wipedAt.has(faller)) {
      const trouble = pick(rng, TROUBLES);
      events.push({
        tMs: Math.round(tMs - Math.min(30_000, durationMs * 0.01)),
        type: 'setback', teamIdx: faller, severity: 2,
        activity: 'Solving a problem',
        text: line('setback', { ...ctxFor(faller), trouble }),
      });
      nudgeMeter(meters, faller, METER_INDEX.MORALE, times, tMs, -8);
      const recT = tMs + (durationMs / core.checkpoints.length) * (0.5 + rng() * 0.8);
      if (recT < core.pushStartMs) {
        events.push({
          tMs: Math.round(recT), type: 'recovery', teamIdx: faller, severity: 1,
          activity: 'Climbing', text: line('recovery', ctxFor(faller)),
        });
      }
    }
  }

  // --- Push-phase overtakes from actual p crossings ------------------------
  const grid = core.grid;
  const pushIdx: number[] = [];
  for (let i = 0; i < grid.tMs.length; i++) {
    if (grid.tMs[i] > core.pushStartMs) pushIdx.push(i);
  }
  let lastOvertakeT = -1e9;
  const overtakeGap = Math.max(15_000, durationMs / 120);
  let prevRanks = ranksByP(core, pushIdx[0] ?? 0);
  for (const gi of pushIdx.slice(1)) {
    const t = grid.tMs[gi];
    const ranks = ranksByP(core, gi);
    if (t - lastOvertakeT >= overtakeGap) {
      for (let team = 0; team < n; team++) {
        if (ranks[team] < prevRanks[team] && grid.p[team][gi] < 1) {
          if (wipedAt.has(team) && t >= wipedAt.get(team)!) continue;
          const rival = Object.keys(ranks)
            .map(Number)
            .find((r) => ranks[r] === ranks[team] + 1);
          const alt = altitudeAt(displayAtTime(displayTrack, team, t));
          events.push({
            tMs: t, type: 'overtake', teamIdx: team,
            rivalIdx: rival, severity: ranks[team] <= 3 ? 3 : 2,
            text: line('overtake', {
              ...ctxFor(team),
              rival: rival !== undefined ? teamNames[rival] : 'the pack',
              alt,
            }),
          });
          lastOvertakeT = t;
          break; // one per window
        }
      }
    }
    prevRanks = ranks;
  }

  // --- Fate: falls, injuries, turn-backs, wipeouts -------------------------
  const fallenCount = new Map<number, number>();
  for (const f of fate.falls) {
    const squad = climbers[f.teamIdx];
    const already = fallenCount.get(f.teamIdx) ?? 0;
    const idx = Math.min(squad.length - 1 - already, 1 + (already % Math.max(1, squad.length - 2)));
    const climberIdx = Math.max(1, idx);
    fallenCount.set(f.teamIdx, already + 1);
    const alt = altitudeAt(displayAtTime(displayTrack, f.teamIdx, f.tMs));
    const edge = nearestEdgeLabel(traversals, f.teamIdx, f.tMs);
    events.push({
      tMs: f.tMs, type: 'climber_fall', teamIdx: f.teamIdx, climberIdx, severity: 3,
      text: line('climber_fall', {
        ...ctxFor(f.teamIdx),
        climber: squad[climberIdx].name,
        role: squad[climberIdx].role.toLowerCase(),
        alt,
        edge,
      }),
    });
    nudgeMeter(meters, f.teamIdx, METER_INDEX.MORALE, times, f.tMs, -16);
    nudgeMeter(meters, f.teamIdx, METER_INDEX.MED, times, f.tMs, -8);
  }
  for (const inj of fate.injuries) {
    const squad = climbers[inj.teamIdx];
    const climberIdx = randInt(rng, 1, squad.length - 1);
    events.push({
      tMs: inj.tMs, type: 'climber_injured', teamIdx: inj.teamIdx, climberIdx, severity: 2,
      text: line('climber_injured', {
        ...ctxFor(inj.teamIdx),
        climber: squad[climberIdx].name,
        trouble: pick(rng, TROUBLES),
      }),
    });
    nudgeMeter(meters, inj.teamIdx, METER_INDEX.MED, times, inj.tMs, -14);
  }
  for (const tb of fate.turnedBack) {
    const squad = climbers[tb.teamIdx];
    const climberIdx = randInt(rng, 1, squad.length - 1);
    events.push({
      tMs: tb.tMs, type: 'climber_turned_back', teamIdx: tb.teamIdx, climberIdx, severity: 2,
      text: line('climber_turned_back', {
        ...ctxFor(tb.teamIdx),
        climber: squad[climberIdx].name,
      }),
    });
  }
  for (const w of fate.wipeouts) {
    events.push({
      tMs: w.tMs, type: 'team_wipeout', teamIdx: w.teamIdx, severity: 3,
      activity: 'Lost on the mountain',
      text: line('team_wipeout', { ...ctxFor(w.teamIdx), gap: w.teamIdx + 1 }),
    });
  }

  // --- Resupplies detected from meter refills ------------------------------
  for (let team = 0; team < n; team++) {
    let count = 0;
    for (let i = 1; i < times.length && count < 2; i++) {
      const o2row = meters[team][METER_INDEX.O2];
      if (o2row[i] - o2row[i - 1] > 8) {
        const camp = nodeAtOrBelow(displayTrack.pos[team][i] + 0.01);
        events.push({
          tMs: times[i], type: 'resupply', teamIdx: team, nodeId: camp.id, severity: 1,
          text: line('resupply', { ...ctxFor(team), camp: camp.label }),
        });
        count++;
        i += 10; // skip the rest of this refill ramp
      }
    }
  }

  // --- Summits and finish ---------------------------------------------------
  for (const teamIdx of core.finalOrder) {
    if (wipedAt.has(teamIdx)) continue;
    const place = core.finalRank[teamIdx];
    events.push({
      tMs: core.summitTimesMs[teamIdx], type: 'summit', teamIdx, severity: 3,
      activity: 'Summited',
      text: line('summit', {
        ...ctxFor(teamIdx),
        alt: 8849,
        place: `${ordinal(place)} on the summit`,
      }),
    });
  }
  events.push({
    tMs: durationMs, type: 'race_finish', severity: 3,
    text: line('race_finish', {}),
  });

  // --- Standings updates ----------------------------------------------------
  const nUpdates = Math.min(12, Math.max(4, Math.round(durationMs / 300_000)));
  for (let k = 1; k <= nUpdates; k++) {
    const t = Math.round((durationMs * k) / (nUpdates + 1));
    const cp = lastCheckpointAt(core, t);
    if (!cp) continue;
    events.push({
      tMs: t, type: 'standings_update', severity: 1,
      text: line('standings_update', {
        leader: teamNames[cp.order[0]],
        second: teamNames[cp.order[1] ?? cp.order[0]],
      }),
    });
  }

  // --- Ambient fill to density target + max-gap rule ------------------------
  events.sort((a, b) => a.tMs - b.tMs || a.severity - b.severity);
  const targetAmbient = Math.min(380, Math.max(28, Math.round(durationMs / 90_000) + 24));
  const maxGap = Math.max(45_000, durationMs / 40);
  const ambient: RaceEvent[] = [];
  const addAmbient = (tMs: number) => {
    const roll = rng();
    if (roll < 0.4) {
      ambient.push({ tMs, type: 'radio', severity: 0, text: line('radio', { camp: pick(rng, NODES).label, team: teamNames[randInt(rng, 0, n - 1)], sherpa: pick(rng, cast.sirdar) }) });
    } else if (roll < 0.7) {
      ambient.push({ tMs, type: 'weather', severity: 0, text: line('weather', { weather: pick(rng, WEATHER_LINES) }) });
    } else {
      ambient.push({ tMs, type: 'color', severity: 0, text: line('color', { camp: pick(rng, NODES).label, alt: pick(rng, [5364, 6065, 6400, 7160, 7950]) }) });
    }
  };
  // Fill the largest gaps first until density target or no gap > maxGap.
  let guard = 0;
  while (ambient.length < targetAmbient && guard++ < 1000) {
    const all = [...events, ...ambient].sort((a, b) => a.tMs - b.tMs);
    let bigGapStart = -1;
    let bigGap = 0;
    for (let i = 1; i < all.length; i++) {
      const gap = all[i].tMs - all[i - 1].tMs;
      if (gap > bigGap) {
        bigGap = gap;
        bigGapStart = all[i - 1].tMs;
      }
    }
    if (bigGap <= maxGap && ambient.length >= Math.min(targetAmbient, 28)) break;
    if (bigGapStart < 0) break;
    addAmbient(Math.round(bigGapStart + bigGap * (0.35 + rng() * 0.3)));
  }
  events.push(...ambient);
  events.sort((a, b) => a.tMs - b.tMs || a.severity - b.severity);
  return events;
}

function displayAtTime(
  track: { tMs: number[]; pos: number[][] },
  teamIdx: number,
  tMs: number,
): number {
  const t = track.tMs;
  const row = track.pos[teamIdx];
  if (tMs <= t[0]) return row[0];
  for (let i = 1; i < t.length; i++) {
    if (t[i] >= tMs) {
      const f = (tMs - t[i - 1]) / (t[i] - t[i - 1] || 1);
      return row[i - 1] + f * (row[i] - row[i - 1]);
    }
  }
  return row[row.length - 1];
}

function ranksByP(core: CoreTimeline, gi: number): Record<number, number> {
  const n = core.grid.p.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => {
    const pa = core.grid.p[a][gi];
    const pb = core.grid.p[b][gi];
    if (pa !== pb) return pb - pa;
    return core.summitTimesMs[a] - core.summitTimesMs[b];
  });
  const ranks: Record<number, number> = {};
  idx.forEach((team, r) => (ranks[team] = r + 1));
  return ranks;
}

function lastCheckpointAt(core: CoreTimeline, tMs: number) {
  let best = null;
  for (const cp of core.checkpoints) {
    if (cp.tMs <= tMs) best = cp;
    else break;
  }
  return best;
}

function nearestEdgeLabel(
  traversals: Traversal[],
  teamIdx: number,
  tMs: number,
): string {
  let best = 'the fixed lines';
  let bestDt = Infinity;
  for (const tr of traversals) {
    if (tr.teamIdx !== teamIdx) continue;
    const dt = Math.abs(tr.tMs - tMs);
    if (dt < bestDt) {
      bestDt = dt;
      best = tr.edge.label;
    }
  }
  return best;
}
