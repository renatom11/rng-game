'use client';

import { phaseAt } from '@/lib/client/raceState';
import { PHASE_NAMES } from '@/themes/everest/commentary/templates';
import { fmtClock } from './useRaceClock';

interface Props {
  tMs: number;
  durationMs: number;
  demo: boolean;
}

export function PhaseBanner({ tMs, durationMs, demo }: Props) {
  const phase = phaseAt(tMs, durationMs);
  const frac = Math.min(1, tMs / durationMs);
  return (
    <div className="phase-banner">
      <div className="phase-name">
        {demo && <span className="demo-badge">DEMO</span>}
        <span className="phase-label">Now:</span> {capitalize(PHASE_NAMES[phase])}
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
