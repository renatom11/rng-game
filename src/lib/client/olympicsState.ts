import type { OlympicsSnapshot } from '@/lib/slice';
import type { PointsKeyframe } from '@/themes/olympics/types';

/** Latest concluded points keyframe at time t (null before the first). */
export function latestFrame(
  snap: OlympicsSnapshot,
  tMs: number,
): PointsKeyframe | null {
  let latest: PointsKeyframe | null = null;
  for (const f of snap.pointsKeyframes) {
    if (f.tMs <= tMs) latest = f;
    else break;
  }
  return latest;
}

/** Standings order at time t: latest concluded event's cumulative table. */
export function olyStandingsAt(
  snap: OlympicsSnapshot,
  nTeams: number,
  tMs: number,
): number[] {
  const f = latestFrame(snap, tMs);
  if (f) return f.order;
  return Array.from({ length: nTeams }, (_, i) => i);
}

/** Index of the event in progress at t (or -1). */
export function currentEventIdx(snap: OlympicsSnapshot, tMs: number): number {
  for (let i = 0; i < snap.schedule.length; i++) {
    const ev = snap.schedule[i];
    if (tMs >= ev.startMs && tMs < ev.endMs) return i;
  }
  return -1;
}

/** Index of the next event to start after t (or -1). */
export function nextEventIdx(snap: OlympicsSnapshot, tMs: number): number {
  for (let i = 0; i < snap.schedule.length; i++) {
    if (snap.schedule[i].startMs > tMs) return i;
  }
  return -1;
}

/** Live within-event scores at t for event k (interpolated). */
export function liveScoresAt(
  snap: OlympicsSnapshot,
  k: number,
  tMs: number,
): number[] | null {
  const lv = snap.live[k];
  if (!lv || lv.tMs.length === 0) return null;
  const times = lv.tMs;
  if (tMs <= times[0]) return lv.score.map((row) => row[0]);
  const last = times.length - 1;
  if (tMs >= times[last]) return lv.score.map((row) => row[last]);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= tMs) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  const f = span <= 0 ? 1 : (tMs - times[lo]) / span;
  return lv.score.map((row) => row[lo] + (row[hi] - row[lo]) * f);
}

export interface MedalCount {
  gold: number;
  silver: number;
  bronze: number;
}

/** Medal counts per team from events concluded by t. */
export function medalsAt(
  snap: OlympicsSnapshot,
  nTeams: number,
  tMs: number,
): MedalCount[] {
  const out: MedalCount[] = Array.from({ length: nTeams }, () => ({
    gold: 0,
    silver: 0,
    bronze: 0,
  }));
  for (const f of snap.pointsKeyframes) {
    if (f.tMs > tMs) break;
    const byEarned = Array.from({ length: nTeams }, (_, i) => i).sort(
      (a, b) => f.earned[b] - f.earned[a] || a - b,
    );
    if (byEarned[0] !== undefined) out[byEarned[0]].gold++;
    if (byEarned[1] !== undefined) out[byEarned[1]].silver++;
    if (byEarned[2] !== undefined) out[byEarned[2]].bronze++;
  }
  return out;
}

/** Momentum: rank change between now and one event ago. */
export function olyMomentum(
  snap: OlympicsSnapshot,
  nTeams: number,
  tMs: number,
): number[] {
  const frames = snap.pointsKeyframes.filter((f) => f.tMs <= tMs);
  const now = frames[frames.length - 1];
  const before = frames[frames.length - 2];
  if (!now || !before) return new Array(nTeams).fill(0);
  return Array.from({ length: nTeams }, (_, i) => {
    return before.order.indexOf(i) - now.order.indexOf(i);
  });
}

export function olyPhaseLabel(tMs: number, durationMs: number): string {
  const u = tMs / durationMs;
  if (u < 0.1) return 'Opening days';
  if (u < 0.3) return 'Heats and qualifiers';
  if (u < 0.55) return 'Medal rounds';
  if (u < 0.72) return 'The middle Saturday';
  if (u < 0.87) return 'Finals week';
  return 'The closing marquee';
}
