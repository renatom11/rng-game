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
 */

export const LOOKAHEAD_MS = 60_000;

export interface EverestSnapshot {
  theme: 'everest';
  horizonMs: number;
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
  /** Present only when complete. */
  finalOrder?: number[];
  finalRank?: number[];
  summitTimesMs?: number[];
}

export interface OlympicsSnapshot {
  theme: 'olympics';
  horizonMs: number;
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

export type PublicSnapshot = EverestSnapshot | OlympicsSnapshot;

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

export function toEverestSnapshot(
  timeline: EverestTimeline,
  elapsedMs: number,
  opts: { complete: boolean },
): EverestSnapshot {
  const { core } = timeline;
  const durationMs = core.grid.tMs[core.grid.tMs.length - 1];

  if (opts.complete) {
    return {
      theme: 'everest',
      horizonMs: durationMs,
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
      finalOrder: core.finalOrder,
      finalRank: core.finalRank,
      summitTimesMs: core.summitTimesMs,
    };
  }

  const horizonMs = Math.min(durationMs, Math.max(0, elapsedMs) + LOOKAHEAD_MS);
  const gi = lastIndexAtOrBefore(core.grid.tMs, horizonMs);
  const si = lastIndexAtOrBefore(timeline.displayTrack.tMs, horizonMs);

  return {
    theme: 'everest',
    horizonMs,
    complete: false,
    climbers: timeline.climbers,
    styles: timeline.styles,
    colors: timeline.colors,
    edgeRisk: timeline.edgeRisk,
    pushStartMs: core.pushStartMs,
    events: timeline.events.filter((e) => e.tMs <= horizonMs),
    checkpoints: core.checkpoints.filter((c) => c.tMs <= horizonMs),
    grid: {
      tMs: core.grid.tMs.slice(0, gi + 1),
      p: core.grid.p.map((row) => row.slice(0, gi + 1)),
    },
    displayTrack: {
      tMs: timeline.displayTrack.tMs.slice(0, si + 1),
      pos: timeline.displayTrack.pos.map((row) => row.slice(0, si + 1)),
    },
    meters: {
      tMs: timeline.meters.tMs.slice(0, si + 1),
      values: timeline.meters.values.map((teamRows) =>
        teamRows.map((row) => row.slice(0, si + 1)),
      ),
    },
    wipeouts: timeline.wipeouts.filter((w) => w.tMs <= horizonMs),
  };
}

export function toOlympicsSnapshot(
  timeline: OlympicsTimeline,
  elapsedMs: number,
  opts: { complete: boolean },
): OlympicsSnapshot {
  const { core } = timeline;
  const durationMs = core.grid.tMs[core.grid.tMs.length - 1];

  if (opts.complete) {
    return {
      theme: 'olympics',
      horizonMs: durationMs,
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

  const horizonMs = Math.min(durationMs, Math.max(0, elapsedMs) + LOOKAHEAD_MS);

  return {
    theme: 'olympics',
    horizonMs,
    complete: false,
    athletes: timeline.athletes,
    colors: timeline.colors,
    pushStartMs: core.pushStartMs,
    schedule: timeline.schedule,
    pointsKeyframes: timeline.pointsKeyframes.filter((f) => f.tMs <= horizonMs),
    live: timeline.live.map((lv) => {
      const li = lastIndexAtOrBefore(lv.tMs, horizonMs);
      return {
        tMs: lv.tMs.slice(0, li + 1),
        score: lv.score.map((row) => row.slice(0, li + 1)),
      };
    }),
    events: timeline.events.filter((e) => e.tMs <= horizonMs),
  };
}
