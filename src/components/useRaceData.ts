'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RaceView } from '@/lib/races';

const POLL_MS = 20_000;

/**
 * Fetch + poll the race view. Keeps a server-clock offset (median of recent
 * samples) so all rendering runs on server time regardless of device clocks.
 * Polling stops once the payload is complete (demo/finished).
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
  const [offsetMs, setOffsetMs] = useState(0);
  const viewRef = useRef<RaceView | null>(null);

  const fetchOnce = useCallback(async () => {
    const t0 = Date.now();
    try {
      const res = await fetch(`/api/races/${slug}`, { cache: 'no-store' });
      const t1 = Date.now();
      if (!res.ok) {
        setError(res.status === 404 ? 'not-found' : `error ${res.status}`);
        return;
      }
      const data = (await res.json()) as RaceView;
      // Half-RTT clock offset estimate; keep the median of the last 5.
      const sample = data.serverNow - (t0 + t1) / 2;
      const arr = offsetsRef.current;
      arr.push(sample);
      if (arr.length > 5) arr.shift();
      const sorted = [...arr].sort((a, b) => a - b);
      setOffsetMs(sorted[Math.floor(sorted.length / 2)]);
      viewRef.current = data;
      setView(data);
      setError(null);
    } catch {
      setError('network');
    }
  }, [slug]);

  useEffect(() => {
    void fetchOnce();
    const interval = setInterval(() => {
      const v = viewRef.current;
      if (v && v.snapshot.complete) return; // nothing more to learn
      void fetchOnce();
    }, POLL_MS);
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
