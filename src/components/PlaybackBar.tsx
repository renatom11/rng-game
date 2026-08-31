'use client';

import { fmtClock } from './useRaceClock';

const SPEEDS = [1, 10, 60, 600];

interface Props {
  tMs: number;
  durationMs: number;
  pushStartMs: number;
  finaleLabel: string;
  playing: boolean;
  speed: number;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  scrubTo: (t: number) => void;
}

export function PlaybackBar({
  tMs, durationMs, pushStartMs, finaleLabel, playing, speed, setPlaying, setSpeed, scrubTo,
}: Props) {
  return (
    <div className="playback">
      <button
        className="playback-btn"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="playback-speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`playback-speed${speed === s ? ' active' : ''}`}
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
      <input
        className="playback-scrub"
        type="range"
        min={0}
        max={durationMs}
        step={Math.max(1000, durationMs / 2000)}
        value={Math.round(tMs)}
        onChange={(e) => scrubTo(Number(e.target.value))}
        aria-label="Scrub race time"
      />
      <span className="playback-time">{fmtClock(tMs)}</span>
      <button
        className="playback-jump"
        onClick={() => scrubTo(Math.max(0, pushStartMs - durationMs * 0.005))}
        title="Jump to the decisive final act"
      >
        {finaleLabel} →
      </button>
    </div>
  );
}
