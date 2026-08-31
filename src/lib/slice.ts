import type { EverestTimeline, RaceEvent } from '@/themes/everest/types';
import type {
  OlympicsRaceEvent,
  OlympicsTimeline,
  PointsKeyframe,
  ScheduledEvent,
} from '@/themes/olympics/types';
import type { Checkpoint } from '@/engine/types';

/**
 * Spoiler-proof truncation. While a race is running, viewers receive only
 * what has already happened (plus a small lookahead so rendering stays
 * smooth between polls). Everything that would reveal the future — the
 * final order, summit times, future events/curves/checkpoints/results —
 * never leaves the server. Demo races and finished races get everything.
 *
 * The lookahead is the leak budget, so it is duration-aware and phased —
 * a fixed 60s lookahead once equaled the minimum race duration (whole
 * timeline served at t=0) and exceeded the entire convergence window of
 * short races (the ending shipped before it played out):
 *
 * - scheduled races serve nothing but static config;
 * - pre-push, the horizon may run a modest lookahead ahead but is HARD
 *   CAPPED at pushStartMs — no convergence-phase data ever ships early;
 * - during the push, the lookahead shrinks to a few seconds (clients poll
 *   fast in the finale), so a devtools reader gains seconds, not the race.
 */

/**
 * Pre-push lookahead: 5–60s depending on duration. A bigger window is safe
 * for long races because the spoiler guarantee is the hard cap at
 * pushStartMs, not the lookahead size — this only trades a little weak-
 * signal earliness for far fewer polls on all-day races.
 */
export function preLookaheadMs(durationMs: number): number {
  return Math.min(60_000, Math.max(5_000, durationMs / 60));
}

/** Push-phase lookahead: 2.5–6s depending on duration. */
export function pushLookaheadMs(durationMs: number): number {
  return Math.max(2_500, Math.min(6_000, durationMs * 0.004));
}

/**
 * The horizon: the latest timeline instant a running race's snapshot may
 * include. `elapsedMs < 0` means the race has not started (serve nothing).
 */
export function horizonFor(
  elapsedMs: number,
  durationMs: number,
  pushStartMs: number,
): number {
  if (elapsedMs < 0) return -1;
  if (elapsedMs < pushStartMs) {
    return Math.min(pushStartMs, elapsedMs + preLookaheadMs(durationMs));
  }
  return Math.min(durationMs, elapsedMs + pushLookaheadMs(durationMs));
}

/**
 * Journey-shaped snapshot: shared by every theme built on the Everest
 * skeleton (route + display track + squads + meters). The theme literal is
 * the only difference between Everest and Space at the data level.
 */
export interface JourneySnapshot {
  horizonMs: number;
  /** -1 = full snapshot; otherwise a delta covering (sinceMs, horizonMs]. */
  sinceMs: number;
  complete: boolean;
  climbers: EverestTimeline['climbers'];
  styles: EverestTimeline['styles'];
  colors: EverestTimeline['colors'];
  edgeRisk: EverestTimeline['edgeRisk'];
  pushStartMs: number;
  events: RaceEvent[];
  checkpoints: Checkpoint[];
  grid: { tMs: number[]; p: number[][] };
  displayTrack: { tMs: number[]; pos: number[][] };
  meters: { tMs: number[]; values: number[][][] };
  wipeouts: EverestTimeline['wipeouts'];
  /**
   * Full storm schedule (forecast). Static and spoiler-safe: storms are
   * drawn from their own stream, independent of the outcome.
   */
  storms: { startMs: number; endMs: number }[];
  /** Present only when complete. */
  finalOrder?: number[];
  finalRank?: number[];
  summitTimesMs?: number[];
}

export type EverestSnapshot = JourneySnapshot & { theme: 'everest' };
export type SpaceSnapshot = JourneySnapshot & { theme: 'space' };

export interface OlympicsSnapshot {
  theme: 'olympics';
  horizonMs: number;
  /** -1 = full snapshot; otherwise a delta covering (sinceMs, horizonMs]. */
  sinceMs: number;
  complete: boolean;
  athletes: OlympicsTimeline['athletes'];
  colors: string[];
  pushStartMs: number;
  /** Full schedule metadata is public — only results are spoilers. */
  schedule: ScheduledEvent[];
  pointsKeyframes: PointsKeyframe[];
  live: { tMs: number[]; score: number[][] }[];
  events: OlympicsRaceEvent[];
  finalOrder?: number[];
  finalRank?: number[];
}

export type PublicSnapshot = EverestSnapshot | SpaceSnapshot | OlympicsSnapshot;

/** Index of the last entry in sorted `times` that is <= tMs (or -1). */
function lastIndexAtOrBefore(times: number[], tMs: number): number {
  let lo = -1;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= tMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Slice window over sorted `times` covering (sinceMs, horizonMs]. */
function windowRange(
  times: number[],
  sinceMs: number,
  horizonMs: number,
): [number, number] {
  const lo = sinceMs < 0 ? 0 : lastIndexAtOrBefore(times, sinceMs) + 1;
  const hi = lastIndexAtOrBefore(times, horizonMs) + 1;
  return [lo, Math.max(lo, hi)];
}

export function toJourneySnapshot<T extends 'everest' | 'space'>(
  theme: T,
  timeline: EverestTimeline,
  elapsedMs: number,
  opts: { complete: boolean; sinceMs?: number },
): JourneySnapshot & { theme: T } {
  const { core } = timeline;
  const durationMs = core.grid.tMs[core.grid.tMs.length - 1];

  if (opts.complete) {
    return {
      theme,
      horizonMs: durationMs,
      sinceMs: -1,
      complete: true,
      climbers: timeline.climbers,
      styles: timeline.styles,
      colors: timeline.colors,
      edgeRisk: timeline.edgeRisk,
      pushStartMs: core.pushStartMs,
      events: timeline.events,
      checkpoints: core.checkpoints,
      grid: core.grid,
      displayTrack: timeline.displayTrack,
      meters: timeline.meters,
      wipeouts: timeline.wipeouts,
      storms: timeline.storms ?? [],
      finalOrder: core.finalOrder,
      finalRank: core.finalRank,
      summitTimesMs: core.summitTimesMs,
    };
  }

  const horizonMs = horizonFor(elapsedMs, durationMs, core.pushStartMs);
  // Delta mode: serve only (sinceMs, horizonMs] and omit static fields —
  // the client already holds them and concatenates the rest.
  const sinceMs =
    opts.sinceMs !== undefined && opts.sinceMs >= 0 && opts.sinceMs <= horizonMs
      ? opts.sinceMs
      : -1;
  return toJourneyWindow(theme, timeline, sinceMs, horizonMs);
}

/**
 * Exact-window slice covering (sinceMs, horizonMs] — the primitive both the
 * classic horizon serving and the chunk protocol build on. sinceMs = -1
 * includes the static fields (climbers, colors, storms, ...).
 */
export function toJourneyWindow<T extends 'everest' | 'space'>(
  theme: T,
  timeline: EverestTimeline,
  sinceMs: number,
  horizonMs: number,
): JourneySnapshot & { theme: T } {
  const { core } = timeline;
  const delta = sinceMs >= 0;
  const [glo, ghi] = windowRange(core.grid.tMs, sinceMs, horizonMs);
  const [slo, shi] = windowRange(timeline.displayTrack.tMs, sinceMs, horizonMs);
  const inWindow = (t: number) => t > sinceMs && t <= horizonMs;

  return {
    theme,
    horizonMs,
    sinceMs,
    complete: false,
    climbers: delta ? [] : timeline.climbers,
    styles: delta ? [] : timeline.styles,
    colors: delta ? [] : timeline.colors,
    edgeRisk: delta ? {} : timeline.edgeRisk,
    pushStartMs: core.pushStartMs,
    events: timeline.events.filter((e) => inWindow(e.tMs)),
    checkpoints: core.checkpoints.filter((c) => inWindow(c.tMs)),
    grid: {
      tMs: core.grid.tMs.slice(glo, ghi),
      p: core.grid.p.map((row) => row.slice(glo, ghi)),
    },
    displayTrack: {
      tMs: timeline.displayTrack.tMs.slice(slo, shi),
      pos: timeline.displayTrack.pos.map((row) => row.slice(slo, shi)),
    },
    meters: {
      tMs: timeline.meters.tMs.slice(slo, shi),
      values: timeline.meters.values.map((teamRows) =>
        teamRows.map((row) => row.slice(slo, shi)),
      ),
    },
    wipeouts: timeline.wipeouts.filter((w) => inWindow(w.tMs)),
    storms: delta ? [] : (timeline.storms ?? []),
  };
}

export function toEverestSnapshot(
  timeline: EverestTimeline,
  elapsedMs: number,
  opts: { complete: boolean; sinceMs?: number },
): EverestSnapshot {
  return toJourneySnapshot('everest', timeline, elapsedMs, opts);
}

export function toSpaceSnapshot(
  timeline: EverestTimeline,
  elapsedMs: number,
  opts: { complete: boolean; sinceMs?: number },
): SpaceSnapshot {
  return toJourneySnapshot('space', timeline, elapsedMs, opts);
}

export function toOlympicsSnapshot(
  timeline: OlympicsTimeline,
  elapsedMs: number,
  opts: { complete: boolean; sinceMs?: number },
): OlympicsSnapshot {
  const { core } = timeline;
  const durationMs = core.grid.tMs[core.grid.tMs.length - 1];

  if (opts.complete) {
    return {
      theme: 'olympics',
      horizonMs: durationMs,
      sinceMs: -1,
      complete: true,
      athletes: timeline.athletes,
      colors: timeline.colors,
      pushStartMs: core.pushStartMs,
      schedule: timeline.schedule,
      pointsKeyframes: timeline.pointsKeyframes,
      live: timeline.live,
      events: timeline.events,
      finalOrder: core.finalOrder,
      finalRank: core.finalRank,
    };
  }

  const horizonMs = horizonFor(elapsedMs, durationMs, core.pushStartMs);
  const sinceMs =
    opts.sinceMs !== undefined && opts.sinceMs >= 0 && opts.sinceMs <= horizonMs
      ? opts.sinceMs
      : -1;
  return toOlympicsWindow(timeline, sinceMs, horizonMs);
}

/** Exact-window slice for the Olympics shape; see toJourneyWindow. */
export function toOlympicsWindow(
  timeline: OlympicsTimeline,
  sinceMs: number,
  horizonMs: number,
): OlympicsSnapshot {
  const { core } = timeline;
  const delta = sinceMs >= 0;
  const inWindow = (t: number) => t > sinceMs && t <= horizonMs;

  return {
    theme: 'olympics',
    horizonMs,
    sinceMs,
    complete: false,
    athletes: delta ? [] : timeline.athletes,
    colors: delta ? [] : timeline.colors,
    pushStartMs: core.pushStartMs,
    schedule: delta ? [] : timeline.schedule,
    pointsKeyframes: timeline.pointsKeyframes.filter((f) => inWindow(f.tMs)),
    live: timeline.live.map((lv) => {
      const [lo, hi] = windowRange(lv.tMs, sinceMs, horizonMs);
      return {
        tMs: lv.tMs.slice(lo, hi),
        score: lv.score.map((row) => row.slice(lo, hi)),
      };
    }),
    events: timeline.events.filter((e) => inWindow(e.tMs)),
  };
}
