'use client';

import { fmtClock } from './useRaceClock';

interface Props {
  tMs: number;
  durationMs: number;
  demo: boolean;
  label: string;
}

export function PhaseBanner({ tMs, durationMs, demo, label }: Props) {
  const frac = Math.min(1, tMs / durationMs);
  return (
    <div className="phase-banner">
      <div className="phase-name">
        {demo && <span className="demo-badge">DEMO</span>}
        <span className="phase-label">Now:</span> {label}
      </div>
      <div className="phase-progress" aria-hidden>
        <span style={{ width: `${frac * 100}%` }} />
      </div>
      <div className="phase-clock">
        {fmtClock(tMs)} <span className="phase-clock-total">/ {fmtClock(durationMs)}</span>
      </div>
    </div>
  );
}
