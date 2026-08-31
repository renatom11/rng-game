import type { EverestTimeline, RaceEvent } from '@/themes/everest/types';
import type { Checkpoint } from '@/engine/types';

/**
 * Spoiler-proof truncation. While a race is running, viewers receive only
 * what has already happened (plus a small lookahead so rendering stays
 * smooth between polls). Everything that would reveal the future — the
 * final order, summit times, future events/curves/checkpoints/wipeouts —
 * never leaves the server. Demo races and finished races get everything.
 */

export const LOOKAHEAD_MS = 60_000;

export interface PublicSnapshot {
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

export function toPublicSnapshot(
  timeline: EverestTimeline,
  elapsedMs: number,
  opts: { complete: boolean },
): PublicSnapshot {
  const { core } = timeline;
  const durationMs = core.grid.tMs[core.grid.tMs.length - 1];

  if (opts.complete) {
    return {
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
