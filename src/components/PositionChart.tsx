'use client';

import { useMemo, useState } from 'react';
import { teamTags } from '@/lib/client/raceState';
import { fmtClock } from './useRaceClock';

/**
 * Rank-over-time bump chart. One 2px line per team in its identity color,
 * direct-labeled at the line end (the standings panel doubles as the full
 * legend). Single rank axis; hover crosshair with per-time tooltip.
 * Theme-agnostic: the caller supplies orderAt(t).
 */

const W = 720;
const H = 260;
const PAD_L = 28;
const PAD_R = 52;
const PAD_T = 10;
const PAD_B = 24;

interface Props {
  orderAt: (tMs: number) => number[];
  colors: string[];
  teamNames: string[];
  tMs: number;
  selected: number | null;
  onSelect: (i: number | null) => void;
}

export function PositionChart({ orderAt, colors, teamNames, tMs, selected, onSelect }: Props) {
  const n = teamNames.length;
  const [hoverX, setHoverX] = useState<number | null>(null);
  const tags = useMemo(() => teamTags(teamNames), [teamNames]);

  const { samples, series } = useMemo(() => {
    const count = 60;
    const upTo = Math.max(1, tMs);
    const samples: number[] = [];
    for (let i = 0; i <= count; i++) samples.push((upTo * i) / count);
    const series: number[][] = Array.from({ length: n }, () => []);
    for (const t of samples) {
      const order = orderAt(t);
      order.forEach((teamIdx, rank0) => series[teamIdx].push(rank0 + 1));
    }
    return { samples, series };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderAt, n, Math.floor(tMs / 5000)]);

  const x = (i: number) => PAD_L + ((W - PAD_L - PAD_R) * i) / (samples.length - 1);
  const y = (rank: number) =>
    PAD_T + ((H - PAD_T - PAD_B) * (rank - 1)) / Math.max(1, n - 1);

  const hoverIdx =
    hoverX === null
      ? null
      : Math.max(
          0,
          Math.min(
            samples.length - 1,
            Math.round(((hoverX - PAD_L) / (W - PAD_L - PAD_R)) * (samples.length - 1)),
          ),
        );

  return (
    <div className="poschart">
      <h2 className="panel-title">The race so far</h2>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="poschart-svg"
        role="img"
        aria-label="Team positions over time"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverX(((e.clientX - rect.left) / rect.width) * W);
        }}
        onPointerLeave={() => setHoverX(null)}
      >
        {Array.from({ length: n }, (_, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(i + 1)}
              y2={y(i + 1)}
              stroke="var(--line)"
              strokeWidth={i === 0 ? 1 : 0.5}
              opacity={0.6}
            />
            <text x={PAD_L - 8} y={y(i + 1) + 3.5} textAnchor="end" className="chart-tick">
              {i + 1}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((f) => (
          <text
            key={f}
            x={PAD_L + (W - PAD_L - PAD_R) * f}
            y={H - 8}
            textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
            className="chart-tick"
          >
            {fmtClock(tMs * f)}
          </text>
        ))}

        {series.map((ranks, teamIdx) => {
          const dim = selected !== null && selected !== teamIdx;
          const pts = ranks.map((r, i) => `${x(i)},${y(r)}`).join(' ');
          return (
            <g key={teamIdx} opacity={dim ? 0.18 : 1} style={{ cursor: 'pointer' }}>
              <polyline
                points={pts}
                fill="none"
                stroke={colors[teamIdx]}
                strokeWidth={selected === teamIdx ? 3 : 2}
                strokeLinejoin="round"
                onClick={() => onSelect(selected === teamIdx ? null : teamIdx)}
              />
              <text
                x={W - PAD_R + 6}
                y={y(ranks[ranks.length - 1]) + 3.5}
                className="chart-endlabel"
                fill={colors[teamIdx]}
                onClick={() => onSelect(selected === teamIdx ? null : teamIdx)}
              >
                {tags[teamIdx]}
              </text>
            </g>
          );
        })}

        {hoverIdx !== null && (
          <g pointerEvents="none">
            <line
              x1={x(hoverIdx)}
              x2={x(hoverIdx)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="var(--snow-dim)"
              strokeWidth={1}
              opacity={0.6}
            />
          </g>
        )}
      </svg>
      {hoverIdx !== null && (
        <div className="chart-tooltip">
          <span className="chart-tooltip-time">{fmtClock(samples[hoverIdx])}</span>
          {[...Array(Math.min(3, n))].map((_, place) => {
            const team = series.findIndex((ranks) => ranks[hoverIdx] === place + 1);
            if (team < 0) return null;
            return (
              <span key={place} className="chart-tooltip-row">
                <span className="feed-team-dot" style={{ background: colors[team] }} />
                {place + 1}. {teamNames[team]}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
