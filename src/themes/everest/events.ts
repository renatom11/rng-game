import type { CoreTimeline } from '@/engine/types';
import { PUSH_U } from '@/engine/types';
import type { RNG } from '@/engine/prng';
import { pick, randInt, weightedPick } from '@/engine/prng';
import { NODES, SEGMENTS, altitudeAt, nodeAtOrBelow, nodeById } from './route';
import type { Climber, DeathCause, RaceEvent } from './types';
import type { Cast } from './names';
import type { FatePlan, Traversal, WeatherPlan } from './decorate';
import type { ChoreoBeat } from './rotations';
import type { Risk } from './route';
import { LineWriter } from '@/lib/linewriter';
import {
  CAUGHT_WAITING_LINES,
  FIRST_ROTATION_LINES,
  ROTATION_LINES,
  DEATH_TEMPLATES,
  PATIENCE_LINES,
  PHASE_NAMES,
  REPULSED_LINES,
  REPULSED_STORM_LINES,
  SHORT_HANDED,
  STORM_GAMBLE_LINES,
  STORM_LINES,
  STORM_ONSET,
  TEMPLATES,
  TROUBLES,
  WEATHER_HOLD_LINES,
  WEATHER_LINES,
  WIPEOUT_TEMPLATES,
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
  weather: WeatherPlan;
  beats: ChoreoBeat[];
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
    rng, core, durationMs, displayTrack, meters, traversals, fate, weather,
    beats, climbers, cast, teamNames,
  } = input;
  const n = teamNames.length;
  const writer = new LineWriter(rng);
  const events: RaceEvent[] = [];
  const wipedAt = new Map(fate.wipeouts.map((w) => [w.teamIdx, w.tMs]));
  const inStorm = (tMs: number) =>
    weather.storms.some((s) => tMs >= s.startMs && tMs <= s.endMs);

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

  for (const storm of weather.storms) {
    events.push({
      tMs: storm.startMs,
      type: 'weather',
      severity: 2,
      text: writer.render('storm_onset', STORM_ONSET, {}),
    });
  }

  // --- Track-derived team movement events ---------------------------------
  // Repulsed-attempt dips get their own narration; the generic mode-change
  // events stand aside around them ("descending to rest" over a forced
  // retreat reads as nonsense).
  const repulseTimes = new Map<number, number[]>();
  for (const b of beats) {
    if (b.kind !== 'repulsed') continue;
    if (!repulseTimes.has(b.teamIdx)) repulseTimes.set(b.teamIdx, []);
    repulseTimes.get(b.teamIdx)!.push(b.tMs);
  }
  const nearRepulse = (team: number, t: number, win: number): boolean =>
    (repulseTimes.get(team) ?? []).some((rt) => Math.abs(t - rt) < win);

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
      if (nearRepulse(team, t, minGap * 1.5)) {
        mode = row[i] - row[i - 1] > 0.0008 ? 'up' : 'down';
        continue;
      }
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
        // Making a camp is worth something you can see on the bars.
        nudgeMeter(meters, team, METER_INDEX.MORALE, times, t, 5);
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
    // During the push the story is on the upper mountain: a lower-mountain
    // fork "choice" at that point is display catch-up, not a decision.
    if (tr.tMs >= core.pushStartMs && tr.segIdx < 4) continue;
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
    // The payoff and the punishment are read from the checkpoint AFTER the
    // fork, so they cannot be told before that checkpoint has happened —
    // otherwise "that gamble paid" is a forward signal of a rank gain, served
    // before the gain exists. Removing the look-ahead from the CHOICE closed
    // half of this channel; this closes the loud half.
    const resolveAt = core.checkpoints.find((c) => c.tMs > tr.tMs)?.tMs;
    if (resolveAt === undefined) continue;
    const later = Math.max(tr.tMs + Math.max(30_000, durationMs * 0.015), resolveAt);
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
          // Never narrate overtaking a team the mountain has already taken.
          if (rival !== undefined && wipedAt.has(rival) && t >= wipedAt.get(rival)!) continue;
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
  // Climber identities are drawn randomly among the ELIGIBLE: never the
  // sirdar — the structural radio voice keeps speaking in ungated commentary
  // lines — and never a climber already fallen or turned back. A
  // deterministic formula here once made the sirdar always fall first, then
  // keep narrating from beyond the bergschrund. (The expedition leader is
  // mortal like everyone else; only the sirdar's voice is load-bearing.)
  const fated: Set<number>[] = climbers.map(() => new Set<number>());
  const protectedIdx = (teamIdx: number): Set<number> => {
    const s = new Set<number>();
    climbers[teamIdx].forEach((c, i) => {
      if (c.role === 'Sirdar') s.add(i);
    });
    return s;
  };
  const pickVictim = (teamIdx: number): number | null => {
    const off = protectedIdx(teamIdx);
    const eligible = climbers[teamIdx]
      .map((_, i) => i)
      .filter((i) => !off.has(i) && !fated[teamIdx].has(i));
    if (eligible.length === 0) return null;
    return eligible[randInt(rng, 0, eligible.length - 1)];
  };

  // Cause selection: weighted by where and when the death happens, with hard
  // altitude rules (a crevasse needs a glacier under you; HACE needs thin
  // air). Purely narrative — the death itself was already scheduled.
  const meterAt = (teamIdx: number, meterIdx: number, tMs: number): number => {
    const row = meters[teamIdx][meterIdx];
    if (tMs <= times[0]) return row[0];
    for (let i = 1; i < times.length; i++) {
      if (times[i] >= tMs) {
        const f = (tMs - times[i - 1]) / (times[i] - times[i - 1] || 1);
        return row[i - 1] + f * (row[i] - row[i - 1]);
      }
    }
    return row[row.length - 1];
  };
  const pickCause = (teamIdx: number, tMs: number, alt: number, edgeRisk: Risk | null): DeathCause => {
    const inPush = tMs >= core.pushStartMs;
    const storm = inStorm(tMs);
    const food = meterAt(teamIdx, METER_INDEX.FOOD, tMs);
    const energy = meterAt(teamIdx, METER_INDEX.ENERGY, tMs);
    const causes: DeathCause[] = [];
    const weights: number[] = [];
    const add = (c: DeathCause, w: number) => {
      causes.push(c);
      weights.push(w);
    };
    if (alt < 6500) add('fall-crevasse', alt < 6000 ? 3 : 1);
    if (alt < 6200) add('fall-serac', 1.5);
    if (alt >= 6400) add('fall-face', edgeRisk === 'risky' ? 3 : 1.5);
    if (alt > 7000 || inPush) add('froze', storm ? 6 : 1);
    // Exhaustion needs a story the meters can back up: depleted supplies,
    // or at least the long grind of the second half.
    if (food < 55 || energy < 50 || tMs > durationMs * 0.5) {
      add('exhaustion', food < 40 || energy < 35 ? 4 : 0.7);
    }
    if (alt > 7000) add('altitude', alt > 8300 ? 3 : 1.5);
    if (alt < 7400) add('avalanche', (storm ? 2 : 1) * (edgeRisk === 'risky' ? 1.6 : 0.8));
    if (causes.length === 0) return 'fall-face';
    return weightedPick(rng, causes, weights);
  };

  // Fates are ordered by time so eligibility folds forward correctly.
  const fateStream = [
    ...fate.falls.map((f) => ({ ...f, kind: 'fall' as const })),
    ...fate.injuries.map((f) => ({ ...f, kind: 'injury' as const })),
    ...fate.turnedBack.map((f) => ({ ...f, kind: 'turnback' as const })),
  ].sort((a, b) => a.tMs - b.tMs);

  for (const f of fateStream) {
    const squad = climbers[f.teamIdx];
    if (f.kind === 'fall') {
      const climberIdx = pickVictim(f.teamIdx);
      if (climberIdx === null) continue;
      fated[f.teamIdx].add(climberIdx);
      const posAtFall = displayAtTime(displayTrack, f.teamIdx, f.tMs);
      const alt = altitudeAt(posAtFall);
      const near = nearestEdge(traversals, f.teamIdx, f.tMs, posAtFall);
      const cause = pickCause(f.teamIdx, f.tMs, alt, near?.risk ?? null);
      events.push({
        tMs: f.tMs, type: 'climber_fall', teamIdx: f.teamIdx, climberIdx, severity: 3,
        cause,
        text: writer.render(`climber_fall:${cause}`, DEATH_TEMPLATES[cause], {
          ...ctxFor(f.teamIdx),
          climber: squad[climberIdx].name,
          role: squad[climberIdx].role.toLowerCase(),
          alt,
          edge: near?.label ?? 'the fixed lines',
        }),
      });
      nudgeMeter(meters, f.teamIdx, METER_INDEX.MORALE, times, f.tMs, -16);
      nudgeMeter(meters, f.teamIdx, METER_INDEX.MED, times, f.tMs, -8);
      nudgeMeter(meters, f.teamIdx, METER_INDEX.ENERGY, times, f.tMs, -8);
      // A little later: the squad is smaller, and the mountain notices.
      const shT = f.tMs + Math.max(60_000, durationMs * 0.02);
      const wipeAt = wipedAt.get(f.teamIdx);
      if (shT < core.pushStartMs && (wipeAt === undefined || shT < wipeAt)) {
        events.push({
          tMs: Math.round(shT), type: 'radio', teamIdx: f.teamIdx, severity: 1,
          text: writer.render('short_handed', SHORT_HANDED, ctxFor(f.teamIdx)),
        });
      }
    } else if (f.kind === 'injury') {
      const climberIdx = pickVictim(f.teamIdx);
      if (climberIdx === null) continue;
      // injured climbers stay on the mountain — not added to `fated`
      events.push({
        tMs: f.tMs, type: 'climber_injured', teamIdx: f.teamIdx, climberIdx, severity: 2,
        text: line('climber_injured', {
          ...ctxFor(f.teamIdx),
          climber: squad[climberIdx].name,
          trouble: pick(rng, TROUBLES),
        }),
      });
      nudgeMeter(meters, f.teamIdx, METER_INDEX.MED, times, f.tMs, -14);
    } else {
      const climberIdx = pickVictim(f.teamIdx);
      if (climberIdx === null) continue;
      fated[f.teamIdx].add(climberIdx);
      events.push({
        tMs: f.tMs, type: 'climber_turned_back', teamIdx: f.teamIdx, climberIdx, severity: 2,
        text: line('climber_turned_back', {
          ...ctxFor(f.teamIdx),
          climber: squad[climberIdx].name,
        }),
      });
    }
  }
  for (const w of fate.wipeouts) {
    // Wipes sit in the push window at Col altitudes: the plausible ways to
    // lose everyone at once are the storm or the slope. The froze story
    // ("the storm outlasted them") only holds while a storm is actually on.
    const inStormNow = weather.storms.some(
      (s) => w.tMs >= s.startMs && w.tMs <= s.endMs,
    );
    const cause: DeathCause = inStormNow ? 'froze' : 'avalanche';
    events.push({
      tMs: w.tMs, type: 'team_wipeout', teamIdx: w.teamIdx, severity: 3,
      activity: 'Lost on the mountain',
      cause,
      text: writer.render(`team_wipeout:${cause}`, WIPEOUT_TEMPLATES[cause], {
        ...ctxFor(w.teamIdx),
        gap: w.teamIdx + 1,
      }),
    });
  }

  // --- Camp-life beats: repulsed attempts, weather holds, storm gambles ----
  const campLabelAt = (frac: number) => nodeAtOrBelow(frac + 0.01).label;
  const beatCount = new Map<number, number>();
  const restCount = new Map<number, number>();
  let rotationExplained = false;
  for (const b of beats) {
    const wipeAt = wipedAt.get(b.teamIdx);
    if (wipeAt !== undefined && b.tMs >= wipeAt) continue;
    if (b.tMs >= core.pushStartMs) continue;
    const camp = campLabelAt(b.campFrac);
    const ctx = { ...ctxFor(b.teamIdx), camp, alt: altitudeAt(displayAtTime(displayTrack, b.teamIdx, b.tMs)) };
    if (b.kind === 'repulsed') {
      const seen = beatCount.get(b.teamIdx) ?? 0;
      if (seen >= 3) continue; // narrate at most three retreats per team
      beatCount.set(b.teamIdx, seen + 1);
      const pool = b.stormy ? REPULSED_STORM_LINES : REPULSED_LINES;
      events.push({
        tMs: b.tMs, type: 'setback', teamIdx: b.teamIdx, severity: 2,
        activity: `Retreating to ${camp}`,
        text: writer.render(b.stormy ? 'setback:repulsed-storm' : 'setback:repulsed', pool, ctx),
      });
      nudgeMeter(meters, b.teamIdx, METER_INDEX.MORALE, times, b.tMs, -7);
    } else if (b.kind === 'hold') {
      events.push({
        tMs: b.tMs, type: 'radio', teamIdx: b.teamIdx, severity: 1,
        activity: `Waiting out the storm at ${camp}`,
        text: writer.render('radio:weatherhold', WEATHER_HOLD_LINES, ctx),
      });
    } else if (b.kind === 'rest') {
      // The deliberate recovery descent, explained. The first one in the
      // race gets a louder scene-setting line (it is the moment the whole
      // board starts pouring back downhill and viewers reach for the rules).
      const seenRest = restCount.get(b.teamIdx) ?? 0;
      if (!rotationExplained) {
        rotationExplained = true;
        restCount.set(b.teamIdx, seenRest + 1);
        events.push({
          tMs: b.tMs, type: 'radio', teamIdx: b.teamIdx, severity: 2,
          activity: `Down to ${camp} to recover`,
          text: writer.render('radio:firstrotation', FIRST_ROTATION_LINES, ctx),
        });
      } else if (seenRest < 2) {
        restCount.set(b.teamIdx, seenRest + 1);
        events.push({
          tMs: b.tMs, type: 'radio', teamIdx: b.teamIdx, severity: 1,
          activity: `Down to ${camp} to recover`,
          text: writer.render('radio:rotation', ROTATION_LINES, ctx),
        });
      }
    } else if (b.kind === 'stormPush') {
      events.push({
        tMs: b.tMs, type: 'surge', teamIdx: b.teamIdx, severity: 2,
        text: writer.render('surge:stormgamble', STORM_GAMBLE_LINES, ctx),
      });
    }
  }

  // The wait-vs-go ledger, settled: after each storm, the holder whose
  // standing improved most gets the patience line; the holder who lost the
  // most places got caught waiting. (Checkpoint standings — the core's own
  // story — decide who's who; the lines only put weather-words to it.)
  for (const s of weather.storms) {
    const before = lastCheckpointAt(core, s.startMs);
    const after = core.checkpoints.find((cp) => cp.tMs >= s.endMs);
    if (!before || !after || s.endMs >= core.pushStartMs) continue;
    const holders = beats.filter(
      (b) => b.kind === 'hold' && b.tMs >= s.startMs && b.tMs <= s.endMs,
    );
    let bestGain = 0, bestTeam = -1, worstDrop = 0, worstTeam = -1, worstCamp = '';
    for (const h of holders) {
      const wipeAt = wipedAt.get(h.teamIdx);
      if (wipeAt !== undefined && s.endMs >= wipeAt) continue;
      const delta = after.order.indexOf(h.teamIdx) - before.order.indexOf(h.teamIdx);
      if (delta < bestGain) { bestGain = delta; bestTeam = h.teamIdx; }
      if (delta > worstDrop) { worstDrop = delta; worstTeam = h.teamIdx; worstCamp = campLabelAt(h.campFrac); }
    }
    // The ledger narrates that checkpoint's contents, so it must never be
    // dated before the checkpoint itself is servable: both ride the same
    // serving horizon, and an event saying "who gained" minutes ahead of the
    // standings beat that carries it is a spoiler side channel.
    const offset = Math.max(30_000, durationMs * 0.015) * (0.8 + rng() * 0.4);
    const jitter = Math.round(
      Math.max(s.endMs + offset, after.tMs + Math.max(10_000, durationMs * 0.004)),
    );
    if (bestTeam >= 0 && bestGain <= -1 && jitter < core.pushStartMs) {
      const h = holders.find((x) => x.teamIdx === bestTeam)!;
      events.push({
        tMs: jitter, type: 'surge', teamIdx: bestTeam, severity: 2,
        text: writer.render('surge:patience', PATIENCE_LINES, {
          ...ctxFor(bestTeam), camp: campLabelAt(h.campFrac),
        }),
      });
    }
    if (worstTeam >= 0 && worstDrop >= 2 && jitter + 1000 < core.pushStartMs) {
      events.push({
        tMs: jitter + 1000, type: 'setback', teamIdx: worstTeam, severity: 2,
        text: writer.render('setback:caughtwaiting', CAUGHT_WAITING_LINES, {
          ...ctxFor(worstTeam), camp: worstCamp,
        }),
      });
    }
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
        place: ordinal(place),
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
    // No table-reads during the push: checkpoint standings are stale there
    // (a wiped team could still "lead"), and the live finale board covers it.
    if (t > core.pushStartMs) continue;
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
  const targetAmbient = Math.min(600, Math.max(28, Math.round(durationMs / 90_000) + 24));
  const maxGap = Math.max(45_000, durationMs / 40);
  const ambient: RaceEvent[] = [];
  // Radio chatter must come from the living: never from a wiped team, and
  // teams that have lost a climber don't get "all accounted for" banter.
  const fallTimes = new Map<number, number>();
  for (const e of events) {
    if (e.type === 'climber_fall' && e.teamIdx !== undefined) {
      const prev = fallTimes.get(e.teamIdx);
      if (prev === undefined || e.tMs < prev) fallTimes.set(e.teamIdx, e.tMs);
    }
  }
  const intactTeamAt = (tMs: number): number | null => {
    const candidates: number[] = [];
    for (let i = 0; i < n; i++) {
      const wiped = wipedAt.get(i);
      const fell = fallTimes.get(i);
      if ((wiped === undefined || tMs < wiped) && (fell === undefined || tMs < fell)) {
        candidates.push(i);
      }
    }
    if (candidates.length === 0) return null;
    return candidates[randInt(rng, 0, candidates.length - 1)];
  };
  const addAmbient = (tMs: number) => {
    const roll = rng();
    const radioTeam = intactTeamAt(tMs);
    if (roll < 0.4 && radioTeam !== null) {
      ambient.push({ tMs, type: 'radio', severity: 0, text: line('radio', { camp: pick(rng, NODES).label, team: teamNames[radioTeam], sherpa: cast.sirdar[radioTeam] }) });
    } else if (roll < 0.7) {
      const pool = inStorm(tMs) ? STORM_LINES : WEATHER_LINES;
      ambient.push({ tMs, type: 'weather', severity: 0, text: line('weather', { weather: pick(rng, pool) }) });
    } else {
      ambient.push({ tMs, type: 'color', severity: 0, text: line('color', { camp: pick(rng, NODES).label, alt: pick(rng, [5364, 6065, 6400, 7160, 7950]) }) });
    }
  };
  // Fill the largest gaps first until BOTH the density target and the
  // max-gap rule hold — stopping on count alone can leave silent stretches.
  let guard = 0;
  while (ambient.length < targetAmbient * 2 && guard++ < 1200) {
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

/**
 * The route line a death can honestly be pinned to: the latest traversal the
 * team has already committed to (never a future fork) whose segment contains
 * the team's current display position. A death during a rotation descent —
 * below every segment the team crossed recently — gets no edge anchor, and
 * the template's generic "the fixed lines" stands in.
 */
function nearestEdge(
  traversals: Traversal[],
  teamIdx: number,
  tMs: number,
  pos: number,
): { label: string; risk: Risk } | null {
  let best: { label: string; risk: Risk } | null = null;
  for (const tr of traversals) {
    if (tr.teamIdx !== teamIdx) continue;
    if (tr.tMs > tMs) break; // traversals are time-sorted; the rest are future
    const seg = SEGMENTS[tr.segIdx];
    const fromFrac = nodeById.get(seg.from)!.frac;
    const toFrac = nodeById.get(seg.to)!.frac;
    if (pos >= fromFrac - 0.02 && pos <= toFrac + 0.02) {
      best = { label: tr.edge.label, risk: tr.edge.risk };
    }
  }
  return best;
}
