'use client';

import { useEffect, useRef, useState } from 'react';

export interface PlaybackState {
  playing: boolean;
  speed: number; // 1, 10, 60, 600
  /** current virtual race time, ms since start */
  tMs: number;
}

/**
 * The race clock, ticking at ~10fps (CSS transitions smooth the rest).
 *
 * Real races: race time = wall clock + server offset − startAt.
 * Virtual mode (demo / replay): a controllable clock with play/pause,
 * speed multiplier, and scrubbing.
 */
export function useRaceClock(opts: {
  startAt: number;
  durationMs: number;
  offsetMs: number;
  virtual: boolean;
}): {
  tMs: number;
  playback: PlaybackState;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  scrubTo: (tMs: number) => void;
} {
  const { startAt, durationMs, offsetMs, virtual } = opts;
  const [tMs, setTMs] = useState(0);
  const playbackRef = useRef<PlaybackState>({ playing: true, speed: 60, tMs: 0 });
  const [, forceRender] = useState(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastSet = 0;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      let t: number;
      if (virtual) {
        const pb = playbackRef.current;
        if (pb.playing) {
          pb.tMs = Math.min(durationMs, pb.tMs + dt * pb.speed);
        }
        t = pb.tMs;
      } else {
        t = Math.max(0, Math.min(durationMs, Date.now() + offsetMs - startAt));
      }
      if (now - lastSet > 100) {
        lastSet = now;
        setTMs(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [virtual, durationMs, offsetMs, startAt]);

  return {
    tMs,
    playback: playbackRef.current,
    setPlaying: (p) => {
      playbackRef.current.playing = p;
      forceRender((x) => x + 1);
    },
    setSpeed: (s) => {
      playbackRef.current.speed = s;
      forceRender((x) => x + 1);
    },
    scrubTo: (t) => {
      playbackRef.current.tMs = Math.max(0, Math.min(durationMs, t));
      setTMs(playbackRef.current.tMs);
    },
  };
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
