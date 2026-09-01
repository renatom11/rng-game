import type { JourneySnapshot } from '@/lib/slice';
import type { ClimberStatus, DeathCause, RaceEvent } from '@/themes/everest/types';
import { METER_KEYS } from '@/themes/everest/types';
import { EVEREST_JOURNEY, type JourneyTheme } from './journeyTheme';

/**
 * Pure client-side race-state derivation: everything a component needs at
 * time t, computed from the (possibly truncated) snapshot. No React here —
 * fully unit-testable.
 */

export function interpAt(times: number[], values: number[], tMs: number): number {
  if (times.length === 0) return 0;
  if (tMs <= times[0]) return values[0];
  const last = times.length - 1;
  if (tMs >= times[last]) return values[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= tMs) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  if (span <= 0) return values[hi];
  return values[lo] + ((tMs - times[lo]) / span) * (values[hi] - values[lo]);
}

/** Display position along the route for a team at time t. */
export function displayPosAt(
  snap: JourneySnapshot,
  teamIdx: number,
  tMs: number,
): number {
  return interpAt(snap.displayTrack.tMs, snap.displayTrack.pos[teamIdx], tMs);
}

/** Engine progress for a team at time t (drives push-phase ranking). */
export function progressAt(
  snap: JourneySnapshot,
  teamIdx: number,
  tMs: number,
): number {
  return interpAt(snap.grid.tMs, snap.grid.p[teamIdx], tMs);
}

export function metersAt(
  snap: JourneySnapshot,
  teamIdx: number,
  tMs: number,
): Record<(typeof METER_KEYS)[number], number> {
  const out = {} as Record<(typeof METER_KEYS)[number], number>;
  METER_KEYS.forEach((key, m) => {
    out[key] = Math.round(
      interpAt(snap.meters.tMs, snap.meters.values[teamIdx][m], tMs),
    );
  });
  return out;
}

export function eventsUpTo(snap: JourneySnapshot, tMs: number): RaceEvent[] {
  // events are sorted by tMs at generation time
  const out: RaceEvent[] = [];
  for (const e of snap.events) {
    if (e.tMs > tMs) break;
    out.push(e);
  }
  return out;
}

/** Latest standings order at time t: checkpoints pre-push, live p in the push. */
export function standingsAt(
  snap: JourneySnapshot,
  nTeams: number,
  tMs: number,
): number[] {
  if (tMs > snap.pushStartMs && snap.grid.tMs.length > 0) {
    const summited = summitedOrder(snap, tMs);
    const summitedSet = new Set(summited);
    // Wiped teams sink below every active team; multiple wipes rank by
    // wipe time (later wipe = higher).
    const wipedAt = new Map(
      snap.wipeouts.filter((w) => w.tMs <= tMs).map((w) => [w.teamIdx, w.tMs]),
    );
    const rest = Array.from({ length: nTeams }, (_, i) => i)
      .filter((i) => !summitedSet.has(i))
      .sort((a, b) => {
        const wa = wipedAt.get(a);
        const wb = wipedAt.get(b);
        if (wa !== undefined || wb !== undefined) {
          if (wa === undefined) return -1;
          if (wb === undefined) return 1;
          return wb - wa;
        }
        return progressAt(snap, b, tMs) - progressAt(snap, a, tMs) || a - b;
      });
    return [...summited, ...rest];
  }
  let latest: number[] | null = null;
  for (const cp of snap.checkpoints) {
    if (cp.tMs <= tMs) latest = cp.order;
    else break;
  }
  if (latest) return latest;
  return Array.from({ length: nTeams }, (_, i) => i);
}

/**
 * Live "who is highest" order: what the mountain looks like right now.
 * Pre-push the list is sorted by current display position (so the board
 * churns as teams rotate, hold, and get repulsed — a resting leader really
 * does drop down the list); in the push it defers to the race order.
 * Summited teams stay on top in arrival order; wiped teams sink.
 */
export function heightOrderAt(
  snap: JourneySnapshot,
  nTeams: number,
  tMs: number,
): number[] {
  if (tMs > snap.pushStartMs) return standingsAt(snap, nTeams, tMs);
  const wipedAt = new Map(
    snap.wipeouts.filter((w) => w.tMs <= tMs).map((w) => [w.teamIdx, w.tMs]),
  );
  const cpRank = new Map(standingsAt(snap, nTeams, tMs).map((t, i) => [t, i]));
  return Array.from({ length: nTeams }, (_, i) => i).sort((a, b) => {
    const wa = wipedAt.get(a);
    const wb = wipedAt.get(b);
    if (wa !== undefined || wb !== undefined) {
      if (wa === undefined) return -1;
      if (wb === undefined) return 1;
      return wb - wa;
    }
    return (
      displayPosAt(snap, b, tMs) - displayPosAt(snap, a, tMs) ||
      (cpRank.get(a) ?? 0) - (cpRank.get(b) ?? 0)
    );
  });
}

/** Teams that have summited by t, in arrival order (from delivered events). */
export function summitedOrder(snap: JourneySnapshot, tMs: number): number[] {
  const out: number[] = [];
  for (const e of snap.events) {
    if (e.tMs > tMs) break;
    if (e.type === 'summit' && e.teamIdx !== undefined) out.push(e.teamIdx);
  }
  return out;
}

/** Standings a short while ago, for momentum arrows. */
export function momentum(
  snap: JourneySnapshot,
  nTeams: number,
  tMs: number,
  windowMs: number,
  orderAt: (
    snap: JourneySnapshot,
    nTeams: number,
    tMs: number,
  ) => number[] = standingsAt,
): number[] {
  // Before real standings exist there is no momentum — comparing against
  // the identity-order fallback fabricates arrows out of nothing.
  const firstCp = snap.checkpoints[0]?.tMs;
  if (firstCp === undefined || tMs - windowMs < firstCp) {
    return new Array(nTeams).fill(0);
  }
  const now = orderAt(snap, nTeams, tMs);
  const before = orderAt(snap, nTeams, tMs - windowMs);
  const rankNow = new Map(now.map((t, i) => [t, i]));
  const rankBefore = new Map(before.map((t, i) => [t, i]));
  return Array.from({ length: nTeams }, (_, i) => {
    return (rankBefore.get(i) ?? 0) - (rankNow.get(i) ?? 0); // + = gained places
  });
}

export interface ClimberDeath {
  tMs: number;
  cause?: DeathCause;
}

export interface TeamLiveState {
  activity: string;
  /** Coarse visual state for at-a-glance icons: what is this team DOING? */
  motionKind: 'prep' | 'up' | 'down' | 'rest' | 'hold' | 'storm' | 'done' | 'wiped';
  edgeId: string | null;
  wiped: boolean;
  climberStatus: ClimberStatus[];
  /** Index-aligned with the squad: when and how each climber was lost (null = alive). */
  deaths: (ClimberDeath | null)[];
}

/** Fold events up to t into per-team live state (activity, roster, edge). */
export function teamStatesAt(
  snap: JourneySnapshot,
  nTeams: number,
  tMs: number,
  jt: JourneyTheme = EVEREST_JOURNEY,
): TeamLiveState[] {
  const states: TeamLiveState[] = Array.from({ length: nTeams }, (_, i) => ({
    activity: jt.motion.preparing,
    motionKind: 'prep' as const,
    edgeId: null,
    wiped: false,
    climberStatus: snap.climbers[i].map(() => 'climbing' as ClimberStatus),
    deaths: snap.climbers[i].map(() => null),
  }));
  for (const e of snap.events) {
    if (e.tMs > tMs) break;
    if (e.teamIdx === undefined) continue;
    const s = states[e.teamIdx];
    if (e.activity) s.activity = e.activity;
    if (e.type === 'fork_choice' && e.edgeId) s.edgeId = e.edgeId;
    if (e.type === 'climber_fall' && e.climberIdx !== undefined) {
      // A climber who already turned back is off the mountain — they can't
      // fall from it (defense in depth; generation avoids this too).
      if (s.climberStatus[e.climberIdx] !== 'turned-back') {
        s.climberStatus[e.climberIdx] = 'fallen';
        s.deaths[e.climberIdx] = { tMs: e.tMs, cause: e.cause };
      }
    }
    if (e.type === 'climber_injured' && e.climberIdx !== undefined) {
      if (s.climberStatus[e.climberIdx] === 'climbing') {
        s.climberStatus[e.climberIdx] = 'injured';
      }
    }
    if (e.type === 'climber_turned_back' && e.climberIdx !== undefined) {
      if (s.climberStatus[e.climberIdx] !== 'fallen') {
        s.climberStatus[e.climberIdx] = 'turned-back';
      }
    }
    if (e.type === 'team_wipeout') {
      s.wiped = true;
      s.motionKind = 'wiped';
      s.climberStatus = s.climberStatus.map((c, ci) => {
        if (c === 'turned-back') return c;
        if (s.deaths[ci] === null) s.deaths[ci] = { tMs: e.tMs, cause: e.cause };
        return 'fallen';
      });
    }
    if (e.type === 'summit') {
      s.activity = jt.finishedActivity;
      s.motionKind = 'done';
    }
  }

  // Motion-aware activity: event-carried labels go stale between throttled
  // events ("Resting" while the marker visibly climbs), so derive the
  // day-to-day label from actual display motion. Terminal states win.
  const dtStep =
    snap.displayTrack.tMs.length > 1
      ? snap.displayTrack.tMs[1] - snap.displayTrack.tMs[0]
      : 5_000;
  const lookback = dtStep * 1.6;
  for (let i = 0; i < nTeams; i++) {
    const s = states[i];
    if (s.wiped || s.activity === jt.finishedActivity) continue;
    if (snap.displayTrack.tMs.length < 2 || tMs < lookback) continue;
    const pos = interpAt(snap.displayTrack.tMs, snap.displayTrack.pos[i], tMs);
    const prev = interpAt(
      snap.displayTrack.tMs,
      snap.displayTrack.pos[i],
      tMs - lookback,
    );
    const d = pos - prev;
    const thresh = 0.0012;
    if (d > thresh) {
      // keep a route label if one is current, else the generic moving verb
      if (!s.activity.startsWith('On ')) s.activity = jt.motion.up;
      s.motionKind = 'up';
    } else if (d < -thresh) {
      // Name where they are headed: an unexplained descent is the single
      // most confusing thing on the board ("why are they going DOWN?").
      const below = jt.waypointAt(Math.max(0, pos - 0.005));
      s.activity = jt.motion.downTo ? jt.motion.downTo(below.label) : jt.motion.down;
      s.motionKind = 'down';
    } else {
      const wp = jt.waypointAt(pos + 0.015);
      const inStorm =
        jt.motion.holdingStorm !== undefined &&
        (snap.storms ?? []).some((st) => tMs >= st.startMs && tMs <= st.endMs);
      if (inStorm) {
        s.activity = jt.motion.holdingStorm!(Math.abs(wp.frac - pos) < 0.02 ? wp.label : 'altitude');
        s.motionKind = 'storm';
      } else if (Math.abs(wp.frac - pos) < 0.02) {
        s.activity = jt.motion.restingAt(wp.label);
        s.motionKind = pos < 0.01 ? 'prep' : 'rest';
      } else {
        s.activity = jt.motion.holding;
        s.motionKind = 'hold';
      }
    }
  }
  return states;
}

export interface RaceDeath {
  teamIdx: number;
  climberIdx: number;
  tMs: number;
  cause?: DeathCause;
}

/**
 * Every climber lost by time t (all delivered events), in the order they
 * were lost — the memorial's data. Wipeouts contribute one entry per
 * climber who hadn't already fallen or turned back.
 */
export function raceDeaths(snap: JourneySnapshot, tMs: number): RaceDeath[] {
  const status: ClimberStatus[][] = snap.climbers.map((squad) =>
    squad.map(() => 'climbing' as ClimberStatus),
  );
  const out: RaceDeath[] = [];
  for (const e of snap.events) {
    if (e.tMs > tMs) break;
    if (e.teamIdx === undefined) continue;
    const row = status[e.teamIdx];
    if (e.type === 'climber_fall' && e.climberIdx !== undefined) {
      if (row[e.climberIdx] !== 'turned-back' && row[e.climberIdx] !== 'fallen') {
        row[e.climberIdx] = 'fallen';
        out.push({ teamIdx: e.teamIdx, climberIdx: e.climberIdx, tMs: e.tMs, cause: e.cause });
      }
    } else if (e.type === 'climber_turned_back' && e.climberIdx !== undefined) {
      if (row[e.climberIdx] !== 'fallen') row[e.climberIdx] = 'turned-back';
    } else if (e.type === 'team_wipeout') {
      row.forEach((c, ci) => {
        if (c === 'turned-back' || c === 'fallen') return;
        row[ci] = 'fallen';
        out.push({ teamIdx: e.teamIdx!, climberIdx: ci, tMs: e.tMs, cause: e.cause });
      });
    }
  }
  return out;
}

/** Per-team, per-segment edge choices from delivered fork_choice events. */
export function edgeChoicesAt(
  snap: JourneySnapshot,
  nTeams: number,
  tMs: number,
  segIdxByEdgeId: Map<string, number>,
): (string | null)[][] {
  const nSegs = Math.max(0, ...Array.from(segIdxByEdgeId.values())) + 1;
  const out: (string | null)[][] = Array.from({ length: nTeams }, () =>
    new Array(nSegs).fill(null),
  );
  for (const e of snap.events) {
    if (e.tMs > tMs) break;
    if (e.type === 'fork_choice' && e.teamIdx !== undefined && e.edgeId) {
      const segIdx = segIdxByEdgeId.get(e.edgeId);
      if (segIdx !== undefined) out[e.teamIdx][segIdx] = e.edgeId;
    }
  }
  return out;
}

const TAG_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'de', 'la', 'le', 'los', 'el']);

/**
 * Short display tags for team markers, made unique. Built from the name's
 * distinctive words — "The Yak Attack" earns YAK, not the article THE.
 */
export function teamTags(names: string[]): string[] {
  const tags: string[] = [];
  const used = new Set<string>();
  for (const name of names) {
    const words = name
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 0 && !TAG_STOPWORDS.has(w.toLowerCase()));
    const candidates = words.map((w) => w.slice(0, 3).toUpperCase());
    if (candidates.length === 0) {
      candidates.push(name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3).toUpperCase() || 'TM');
    }
    let tag = candidates.find((c) => !used.has(c)) ?? candidates[0];
    let i = 2;
    while (used.has(tag)) tag = candidates[0].slice(0, 2) + String(i++);
    used.add(tag);
    tags.push(tag);
  }
  return tags;
}

/** The race phase label shown in the banner. */
export function phaseAt(tMs: number, durationMs: number): number {
  const u = tMs / durationMs;
  const bounds = [0.1, 0.3, 0.55, 0.72, 0.87];
  for (let i = 0; i < bounds.length; i++) {
    if (u < bounds[i]) return i;
  }
  return bounds.length;
}
