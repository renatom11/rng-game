'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RaceView } from '@/lib/races';
import { preLookaheadMs } from '@/lib/slice';
import { mergeSnapshot } from '@/lib/client/mergeSnapshot';

/**
 * Fetch + poll the race view. Keeps a server-clock offset (median of recent
 * samples) so all rendering runs on server time regardless of device clocks.
 *
 * Poll cadence is phase-aware to match the server's phased lookahead:
 * relaxed pre-push, fast (2s) through the finale so the live view keeps up
 * with the shrunken spoiler window. Polling stops once the payload is
 * complete (demo/finished).
 */

export function useRaceData(slug: string): {
  view: RaceView | null;
  error: string | null;
  offsetMs: number;
  refresh: () => void;
} {
  const [view, setView] = useState<RaceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offsetsRef = useRef<number[]>([]);
  const offsetRef = useRef(0);
  const [offsetMs, setOffsetMs] = useState(0);
  const viewRef = useRef<RaceView | null>(null);
  const seqRef = useRef(0);
  const lastFetchRef = useRef(0);

  const fetchOnce = useCallback(
    async (forceFull = false) => {
      const seq = ++seqRef.current;
      const t0 = Date.now();
      lastFetchRef.current = t0;
      // Delta cursor: ask only for what we don't have yet.
      const prevAtSend = viewRef.current;
      const since =
        !forceFull &&
        prevAtSend &&
        !prevAtSend.snapshot.complete &&
        prevAtSend.snapshot.horizonMs >= 0
          ? prevAtSend.snapshot.horizonMs
          : undefined;
      try {
        const url =
          since === undefined
            ? `/api/races/${slug}`
            : `/api/races/${slug}?since=${since}`;
        const res = await fetch(url, { cache: 'no-store' });
        const t1 = Date.now();
        if (seq !== seqRef.current) return; // a newer request superseded us
        if (!res.ok) {
          setError(res.status === 404 ? 'not-found' : `error ${res.status}`);
          return;
        }
        const data = (await res.json()) as RaceView;
        if (seq !== seqRef.current) return;
        const prev = viewRef.current;

        let snapshot = data.snapshot;
        if (prev && snapshot.sinceMs >= 0) {
          const merged = mergeSnapshot(prev.snapshot, snapshot);
          if (!merged) {
            // Cursor didn't chain (we changed underneath, or skew) — recover
            // with a full fetch.
            void fetchOnce(true);
            return;
          }
          snapshot = merged;
        } else if (
          prev &&
          !snapshot.complete &&
          snapshot.horizonMs < prev.snapshot.horizonMs
        ) {
          // Never regress: a stale full response must not shrink our data.
          return;
        }

        // Half-RTT clock offset estimate; keep the median of the last 5.
        const sample = data.serverNow - (t0 + t1) / 2;
        const arr = offsetsRef.current;
        arr.push(sample);
        if (arr.length > 5) arr.shift();
        const sorted = [...arr].sort((a, b) => a - b);
        offsetRef.current = sorted[Math.floor(sorted.length / 2)];
        setOffsetMs(offsetRef.current);
        const nextView = { ...data, snapshot };
        viewRef.current = nextView;
        setView(nextView);
        setError(null);
      } catch {
        if (seq === seqRef.current) setError('network');
      }
    },
    [slug],
  );

  useEffect(() => {
    void fetchOnce();
    // A 1s scheduler decides when a real fetch is due, based on race phase.
    const interval = setInterval(() => {
      const v = viewRef.current;
      if (v && v.snapshot.complete) return; // nothing more to learn
      const cadence = (() => {
        if (!v) return 5_000;
        const t = Date.now() + offsetRef.current - v.startAt;
        if (t < -10_000) return 10_000; // countdown, no rush
        if (t < 0) return 2_000; // about to start
        if (t > v.snapshot.pushStartMs - 30_000) return 2_000; // finale
        return Math.max(4_000, Math.min(30_000, preLookaheadMs(v.durationMs) / 2));
      })();
      if (Date.now() - lastFetchRef.current >= cadence) void fetchOnce();
    }, 1_000);
    const onFocus = () => {
      const v = viewRef.current;
      if (v && v.snapshot.complete) return;
      void fetchOnce();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchOnce]);

  return { view, error, offsetMs, refresh: fetchOnce };
}
