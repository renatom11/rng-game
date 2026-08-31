import type { EverestSnapshot } from '@/lib/slice';
import type { ClimberStatus, RaceEvent } from '@/themes/everest/types';
import { METER_KEYS } from '@/themes/everest/types';

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
  snap: EverestSnapshot,
  teamIdx: number,
  tMs: number,
): number {
  return interpAt(snap.displayTrack.tMs, snap.displayTrack.pos[teamIdx], tMs);
}

/** Engine progress for a team at time t (drives push-phase ranking). */
export function progressAt(
  snap: EverestSnapshot,
  teamIdx: number,
  tMs: number,
): number {
  return interpAt(snap.grid.tMs, snap.grid.p[teamIdx], tMs);
}

export function metersAt(
  snap: EverestSnapshot,
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

export function eventsUpTo(snap: EverestSnapshot, tMs: number): RaceEvent[] {
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
  snap: EverestSnapshot,
  nTeams: number,
  tMs: number,
): number[] {
  if (tMs > snap.pushStartMs && snap.grid.tMs.length > 0) {
    const summited = summitedOrder(snap, tMs);
    const summitedSet = new Set(summited);
    const rest = Array.from({ length: nTeams }, (_, i) => i)
      .filter((i) => !summitedSet.has(i))
      .sort((a, b) => progressAt(snap, b, tMs) - progressAt(snap, a, tMs) || a - b);
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

/** Teams that have summited by t, in arrival order (from delivered events). */
export function summitedOrder(snap: EverestSnapshot, tMs: number): number[] {
  const out: number[] = [];
  for (const e of snap.events) {
    if (e.tMs > tMs) break;
    if (e.type === 'summit' && e.teamIdx !== undefined) out.push(e.teamIdx);
  }
  return out;
}

/** Standings a short while ago, for momentum arrows. */
export function momentum(
  snap: EverestSnapshot,
  nTeams: number,
  tMs: number,
  windowMs: number,
): number[] {
  const now = standingsAt(snap, nTeams, tMs);
  const before = standingsAt(snap, nTeams, tMs - windowMs);
  const rankNow = new Map(now.map((t, i) => [t, i]));
  const rankBefore = new Map(before.map((t, i) => [t, i]));
  return Array.from({ length: nTeams }, (_, i) => {
    return (rankBefore.get(i) ?? 0) - (rankNow.get(i) ?? 0); // + = gained places
  });
}

export interface TeamLiveState {
  activity: string;
  edgeId: string | null;
  wiped: boolean;
  climberStatus: ClimberStatus[];
}

/** Fold events up to t into per-team live state (activity, roster, edge). */
export function teamStatesAt(
  snap: EverestSnapshot,
  nTeams: number,
  tMs: number,
): TeamLiveState[] {
  const states: TeamLiveState[] = Array.from({ length: nTeams }, (_, i) => ({
    activity: 'Preparing at Base Camp',
    edgeId: null,
    wiped: false,
    climberStatus: snap.climbers[i].map(() => 'climbing' as ClimberStatus),
  }));
  for (const e of snap.events) {
    if (e.tMs > tMs) break;
    if (e.teamIdx === undefined) continue;
    const s = states[e.teamIdx];
    if (e.activity) s.activity = e.activity;
    if (e.type === 'fork_choice' && e.edgeId) s.edgeId = e.edgeId;
    if (e.type === 'climber_fall' && e.climberIdx !== undefined) {
      s.climberStatus[e.climberIdx] = 'fallen';
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
      s.climberStatus = s.climberStatus.map((c) =>
        c === 'turned-back' ? c : 'fallen',
      );
    }
    if (e.type === 'summit') s.activity = 'Summited';
  }
  return states;
}

/** Per-team, per-segment edge choices from delivered fork_choice events. */
export function edgeChoicesAt(
  snap: EverestSnapshot,
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

/** Short display tags for team markers, made unique. */
export function teamTags(names: string[]): string[] {
  const tags: string[] = [];
  const used = new Set<string>();
  for (const name of names) {
    const base = name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3).toUpperCase() || 'TM';
    let tag = base;
    let i = 2;
    while (used.has(tag)) tag = base.slice(0, 2) + String(i++);
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
