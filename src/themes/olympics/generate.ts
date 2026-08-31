import { forkRng, pick, randInt } from '@/engine/prng';
import { generateCore } from '@/engine/generate';
import { LineWriter } from '@/lib/linewriter';
import { assignColors } from '@/themes/everest/names';
import {
  buildLiveCurves,
  buildMarqueeOrders,
  buildPointsKeyframes,
  buildSchedule,
  sportAt,
} from './build';
import { OLY_TEMPLATES, buildAthletes, pickAthlete } from './commentary';
import type {
  OlympicsRaceEvent,
  OlympicsTimeline,
} from './types';

export interface OlympicsConfig {
  teams: { name: string; color?: string }[];
  durationMs: number;
}

/**
 * Olympics orchestrator. Same fairness-first ordering as Everest:
 * generateCore() runs first and reads nothing from team identities.
 */
export function generateOlympics(
  seedHex: string,
  config: OlympicsConfig,
): OlympicsTimeline {
  const nTeams = config.teams.length;
  const { durationMs } = config;
  const teamNames = config.teams.map((t) => t.name);

  const core = generateCore(seedHex, { nTeams, durationMs });
  const { colors } = assignColors(nTeams, config.teams.map((t) => t.color));
  const athletes = buildAthletes(forkRng(seedHex, 'oly-athletes'), nTeams);

  const schedule = buildSchedule(
    forkRng(seedHex, 'oly-schedule'),
    durationMs,
    core.checkpoints,
  );
  const marqueeOrders = buildMarqueeOrders(
    forkRng(seedHex, 'oly-marquee'),
    core.finalOrder,
  );
  const orders = [
    ...core.checkpoints.map((cp) => cp.order),
    ...marqueeOrders,
  ];
  const pointsKeyframes = buildPointsKeyframes(
    forkRng(seedHex, 'oly-points'),
    schedule,
    orders,
    nTeams,
  );
  const live = buildLiveCurves(
    forkRng(seedHex, 'oly-live'),
    schedule,
    pointsKeyframes,
    nTeams,
  );

  const events = buildOlyEvents({
    seedHex,
    nTeams,
    durationMs,
    teamNames,
    athletes,
    schedule,
    pointsKeyframes,
  });

  return {
    version: 1,
    theme: 'olympics',
    core,
    athletes,
    colors,
    schedule,
    pointsKeyframes,
    live,
    events,
  };
}

function buildOlyEvents(input: {
  seedHex: string;
  nTeams: number;
  durationMs: number;
  teamNames: string[];
  athletes: OlympicsTimeline['athletes'];
  schedule: OlympicsTimeline['schedule'];
  pointsKeyframes: OlympicsTimeline['pointsKeyframes'];
}): OlympicsRaceEvent[] {
  const { seedHex, nTeams, durationMs, teamNames, athletes, schedule, pointsKeyframes } = input;
  const rng = forkRng(seedHex, 'oly-events');
  const writer = new LineWriter(forkRng(seedHex, 'oly-lines'));
  const line = (
    type: OlympicsRaceEvent['type'],
    ctx: Record<string, string | number | undefined>,
  ) => writer.render(type, OLY_TEMPLATES[type], ctx);

  const events: OlympicsRaceEvent[] = [];

  events.push({
    tMs: 0,
    type: 'ceremony_open',
    severity: 3,
    text: line('ceremony_open', { gap: nTeams }),
  });

  const goldsSoFar = new Map<number, number>();
  let prevLeader: number | null = null;

  schedule.forEach((ev, k) => {
    const sport = sportAt(ev.sportIdx);
    const frame = pointsKeyframes[k];
    events.push({
      tMs: ev.startMs,
      type: 'event_start',
      eventIdx: k,
      severity: ev.marquee ? 2 : 1,
      text: line('event_start', { sport: sport.name, venue: sport.venue }),
    });

    // Podium: top 3 by earned points in this event.
    const byEarned = Array.from({ length: nTeams }, (_, i) => i).sort(
      (a, b) => frame.earned[b] - frame.earned[a] || a - b,
    );
    const [gold, silver, bronze] = byEarned;
    const prevFrame = k > 0 ? pointsKeyframes[k - 1] : null;

    // Upset flavor: event winner sat in the bottom third beforehand.
    const wasRank = prevFrame ? prevFrame.order.indexOf(gold) : -1;
    if (prevFrame && wasRank >= Math.ceil((2 * nTeams) / 3) && nTeams >= 5) {
      events.push({
        tMs: ev.endMs,
        type: 'upset',
        teamIdx: gold,
        eventIdx: k,
        severity: 2,
        text: line('upset', {
          team: teamNames[gold],
          sport: sport.name,
          venue: sport.venue,
        }),
      });
    } else {
      events.push({
        tMs: ev.endMs,
        type: 'event_finish',
        teamIdx: gold,
        eventIdx: k,
        severity: ev.marquee ? 3 : 2,
        text: line('event_finish', {
          team: teamNames[gold],
          second: silver !== undefined ? teamNames[silver] : '—',
          third: bronze !== undefined ? teamNames[bronze] : '—',
          sport: sport.name,
        }),
      });
    }

    const golds = (goldsSoFar.get(gold) ?? 0) + 1;
    goldsSoFar.set(gold, golds);
    if (golds === 1 && k > 2 && rng() < 0.5) {
      events.push({
        // clamp: a beat after the final event must not fall past the finish
        tMs: Math.min(durationMs - 1, ev.endMs + Math.max(1000, durationMs * 0.001)),
        type: 'medal_moment',
        teamIdx: gold,
        severity: 2,
        text: line('medal_moment', { team: teamNames[gold] }),
      });
    }

    // Overall lead changes. The gap quoted is to the CURRENT runner-up —
    // quoting the deposed leader with the runner-up's arithmetic once put a
    // number on the board that contradicted the visible table.
    const leader = frame.order[0];
    if (prevLeader !== null && leader !== prevLeader) {
      const runnerUp = frame.order[1] ?? prevLeader;
      events.push({
        tMs: Math.min(durationMs - 1, ev.endMs + Math.max(500, durationMs * 0.0005)),
        type: 'lead_change',
        teamIdx: leader,
        rivalIdx: runnerUp,
        severity: ev.marquee ? 3 : 2,
        text: line('lead_change', {
          team: teamNames[leader],
          rival: teamNames[runnerUp],
          gap: frame.points[leader] - frame.points[runnerUp],
        }),
      });
    }
    prevLeader = leader;
  });

  // Periodic standings updates.
  const nUpdates = Math.min(10, Math.max(3, Math.round(durationMs / 400_000)));
  for (let u = 1; u <= nUpdates; u++) {
    const t = Math.round((durationMs * u) / (nUpdates + 1));
    let frame = null;
    for (const f of pointsKeyframes) {
      if (f.tMs <= t) frame = f;
      else break;
    }
    if (!frame) continue;
    events.push({
      tMs: t,
      type: 'standings_update',
      severity: 1,
      text: line('standings_update', {
        leader: teamNames[frame.order[0]],
        second: teamNames[frame.order[1] ?? frame.order[0]],
        pts: frame.points[frame.order[0]],
      }),
    });
  }

  events.push({
    tMs: durationMs,
    type: 'ceremony_close',
    severity: 3,
    text: line('ceremony_close', {}),
  });

  // Ambient fill with the same max-gap rule as Everest.
  events.sort((a, b) => a.tMs - b.tMs || a.severity - b.severity);
  const targetAmbient = Math.min(600, Math.max(24, Math.round(durationMs / 100_000) + 20));
  const maxGap = Math.max(45_000, durationMs / 40);
  const ambient: OlympicsRaceEvent[] = [];
  let guard = 0;
  // Keep filling until BOTH the density target and the max-gap rule hold —
  // stopping on count alone can leave a silent stretch longer than the rule.
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
    if (bigGap <= maxGap && ambient.length >= Math.min(targetAmbient, 24)) break;
    if (bigGapStart < 0) break;
    const t = Math.round(bigGapStart + bigGap * (0.3 + rng() * 0.4));
    const roll = rng();
    // Anchor flavor to a random venue that's plausibly active.
    const evNow = schedule.find((ev) => t >= ev.startMs && t <= ev.endMs) ?? pick(rng, schedule);
    const sport = sportAt(evNow.sportIdx);
    if (roll < 0.4) {
      const teamIdx = randInt(rng, 0, nTeams - 1);
      const ath = pickAthlete(rng, athletes, teamIdx);
      ambient.push({
        tMs: t,
        type: 'athlete_flavor',
        teamIdx,
        severity: 0,
        text: line('athlete_flavor', {
          athlete: ath.name,
          team: teamNames[teamIdx],
          specialty: ath.specialty,
          venue: sport.venue,
        }),
      });
    } else if (roll < 0.7) {
      ambient.push({
        tMs: t,
        type: 'crowd',
        severity: 0,
        text: line('crowd', { venue: sport.venue }),
      });
    } else {
      ambient.push({
        tMs: t,
        type: 'venue_color',
        severity: 0,
        text: line('venue_color', { venue: sport.venue }),
      });
    }
  }
  events.push(...ambient);
  events.sort((a, b) => a.tMs - b.tMs || a.severity - b.severity);
  return events;
}
