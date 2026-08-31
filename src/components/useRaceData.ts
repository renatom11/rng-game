'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RaceView } from '@/lib/races';
import type { PublicSnapshot } from '@/lib/slice';
import { preLookaheadMs } from '@/lib/slice';
import { pushStartFor } from '@/lib/chunking';
import { mergeSnapshot } from '@/lib/client/mergeSnapshot';

/**
 * Fetch + poll under the chunk protocol. Each poll asks "chunks after my
 * cursor"; the server answers with raw chunk bodies embedded in the JSON
 * envelope (so res.json() hands us parsed snapshots), and we chain-merge
 * them with the same mergeSnapshot the delta protocol always used. Finals
 * (order, times, the seed for verification) arrive only once the clock says
 * finished.
 */

interface Envelope {
  slug: string;
  status: RaceView['status'];
  serverNow: number;
  startAt: number;
  durationMs: number;
  config: RaceView['config'];
  cursor: number;
  complete: boolean;
  chunks: PublicSnapshot[];
  finals: {
    finalOrder: number[];
    finalRank: number[];
    summitTimesMs?: number[];
  } | null;
  seed: string | null;
}

export interface LiveRaceView extends Omit<RaceView, 'snapshot'> {
  snapshot: PublicSnapshot | null;
  seed: string | null;
}

export function useRaceData(slug: string): {
  view: LiveRaceView | null;
  error: string | null;
  offsetMs: number;
  refresh: () => void;
} {
  const [view, setView] = useState<LiveRaceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offsetsRef = useRef<number[]>([]);
  const offsetRef = useRef(0);
  const [offsetMs, setOffsetMs] = useState(0);
  const viewRef = useRef<LiveRaceView | null>(null);
  const cursorRef = useRef(-1);
  const seqRef = useRef(0);
  const lastFetchRef = useRef(0);

  const fetchOnce = useCallback(
    async (forceFull = false) => {
      const seq = ++seqRef.current;
      const t0 = Date.now();
      lastFetchRef.current = t0;
      if (forceFull) {
        cursorRef.current = -1;
      }
      const cursor = cursorRef.current;
      try {
        const res = await fetch(`/api/races/${slug}?cursor=${cursor}`, {
          cache: 'no-store',
        });
        const t1 = Date.now();
        if (seq !== seqRef.current) return; // a newer request superseded us
        if (!res.ok) {
          setError(res.status === 404 ? 'not-found' : `error ${res.status}`);
          return;
        }
        const data = (await res.json()) as Envelope;
        if (seq !== seqRef.current) return;

        // Chain-merge the new chunks onto what we hold.
        let snapshot = forceFull ? null : (viewRef.current?.snapshot ?? null);
        for (const chunk of data.chunks) {
          if (snapshot === null) {
            if (chunk.sinceMs !== -1) {
              // We joined mid-stream without the statics chunk — restart.
              void fetchOnce(true);
              return;
            }
            snapshot = chunk;
          } else {
            const merged = mergeSnapshot(snapshot, chunk);
            if (!merged) {
              void fetchOnce(true);
              return;
            }
            snapshot = merged;
          }
        }
        if (data.chunks.length > 0) cursorRef.current = data.cursor;

        if (snapshot && data.finals && data.complete) {
          snapshot = {
            ...snapshot,
            complete: true,
            horizonMs: data.durationMs,
            finalOrder: data.finals.finalOrder,
            finalRank: data.finals.finalRank,
            ...(data.finals.summitTimesMs
              ? { summitTimesMs: data.finals.summitTimesMs }
              : {}),
          } as PublicSnapshot;
        }

        // Half-RTT clock offset estimate; keep the median of the last 5.
        const sample = data.serverNow - (t0 + t1) / 2;
        const arr = offsetsRef.current;
        arr.push(sample);
        if (arr.length > 5) arr.shift();
        const sorted = [...arr].sort((a, b) => a - b);
        offsetRef.current = sorted[Math.floor(sorted.length / 2)];
        setOffsetMs(offsetRef.current);

        const nextView: LiveRaceView = {
          slug: data.slug,
          status: data.status,
          serverNow: data.serverNow,
          startAt: data.startAt,
          durationMs: data.durationMs,
          config: data.config,
          snapshot,
          seed: data.seed,
        };
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
      if (v && v.snapshot?.complete) return; // nothing more to learn
      const cadence = (() => {
        if (!v) return 5_000;
        if (v.status === 'preparing') return 3_000; // host is charting
        const t = Date.now() + offsetRef.current - v.startAt;
        if (t < -10_000) return 10_000; // countdown, no rush
        if (t < 0) return 2_000; // about to start
        const pushStart =
          v.snapshot?.pushStartMs ?? pushStartFor(v.durationMs);
        if (t > pushStart - 30_000) return 2_000; // finale
        return Math.max(4_000, Math.min(30_000, preLookaheadMs(v.durationMs) / 2));
      })();
      if (Date.now() - lastFetchRef.current >= cadence) void fetchOnce();
    }, 1_000);
    const onFocus = () => {
      const v = viewRef.current;
      if (v && v.snapshot?.complete) return;
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
