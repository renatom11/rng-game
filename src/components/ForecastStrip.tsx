'use client';

import { fmtClock } from './useRaceClock';

/**
 * The weather forecast: the race's full storm schedule as translucent bands
 * on a timeline, with a "now" marker. Spoiler-safe by construction — storms
 * are drawn from their own stream, independent of the outcome — and the
 * whole point is that viewers can see the tradeoff coming: push before the
 * window closes, or wait it out and climb rested.
 */
export function ForecastStrip({
  storms,
  durationMs,
  tMs,
}: {
  storms: { startMs: number; endMs: number }[];
  durationMs: number;
  tMs: number;
}) {
  if (!storms.length) return null;
  const active = storms.find((s) => tMs >= s.startMs && tMs <= s.endMs);
  const next = storms.find((s) => s.startMs > tMs);
  const hint = active
    ? `Storm on the mountain until ${fmtClock(active.endMs)}`
    : next
      ? `Storm forecast ${fmtClock(next.startMs)}–${fmtClock(next.endMs)}`
      : 'Skies clear from here';
  return (
    <div className="forecast" aria-label="Weather forecast">
      <span className="forecast-label">Forecast</span>
      <span className="forecast-track">
        {storms.map((s, i) => (
          <span
            key={i}
            className="forecast-storm"
            style={{
              left: `${(s.startMs / durationMs) * 100}%`,
              width: `${(Math.max(0, s.endMs - s.startMs) / durationMs) * 100}%`,
            }}
          />
        ))}
        <span
          className="forecast-now"
          style={{ left: `${Math.min(100, (tMs / durationMs) * 100)}%` }}
        />
      </span>
      <span className={`forecast-hint${active ? ' storm-on' : ''}`}>{hint}</span>
    </div>
  );
}
