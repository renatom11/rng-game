import type { JourneySnapshot, PublicSnapshot } from '@/lib/slice';

/**
 * Merge a delta snapshot (sinceMs >= 0, series covering (since, horizon])
 * onto the snapshot the client already holds. Pure — the merge-equivalence
 * test asserts full(t2) === merge(full(t1), delta(t1→t2)) byte-for-byte.
 *
 * Returns null when the delta doesn't chain onto `prev` (cursor mismatch,
 * theme mismatch) — the caller should refetch a full snapshot.
 */
export function mergeSnapshot(
  prev: PublicSnapshot,
  next: PublicSnapshot,
): PublicSnapshot | null {
  if (next.sinceMs < 0 || next.complete) return next; // full replaces
  if (prev.theme !== next.theme) return null;
  if (next.sinceMs !== prev.horizonMs) return null; // gap or overlap — refetch

  return { ...mergeJourney(prev, next), theme: prev.theme };
}

function mergeJourney(
  prev: JourneySnapshot,
  next: JourneySnapshot,
): JourneySnapshot {
  return {
    horizonMs: next.horizonMs,
    sinceMs: prev.sinceMs, // merged result covers what prev covered
    complete: false,
    climbers: prev.climbers,
    colors: prev.colors,
    edgeRisk: prev.edgeRisk,
    storms: prev.storms,
    pushStartMs: next.pushStartMs,
    events: [...prev.events, ...next.events],
    checkpoints: [...prev.checkpoints, ...next.checkpoints],
    grid: {
      tMs: [...prev.grid.tMs, ...next.grid.tMs],
      p: prev.grid.p.map((row, i) => [...row, ...(next.grid.p[i] ?? [])]),
    },
    displayTrack: {
      tMs: [...prev.displayTrack.tMs, ...next.displayTrack.tMs],
      pos: prev.displayTrack.pos.map((row, i) => [
        ...row,
        ...(next.displayTrack.pos[i] ?? []),
      ]),
    },
    meters: {
      tMs: [...prev.meters.tMs, ...next.meters.tMs],
      values: prev.meters.values.map((teamRows, i) =>
        teamRows.map((row, m) => [
          ...row,
          ...(next.meters.values[i]?.[m] ?? []),
        ]),
      ),
    },
    wipeouts: [...prev.wipeouts, ...next.wipeouts],
  };
}
