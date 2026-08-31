'use client';

import { useMemo } from 'react';
import type { JourneySnapshot } from '@/lib/slice';
import {
  displayPosAt,
  edgeChoicesAt,
  teamStatesAt,
  teamTags,
} from '@/lib/client/raceState';
import {
  EDGE_GEOMETRY,
  NODE_XY,
  SILHOUETTES,
  STARS,
  VIEW_H,
  VIEW_W,
  markerXY,
} from '@/themes/everest/map-geometry';
import { NODES } from '@/themes/everest/route';

const SEG_BY_EDGE = new Map(EDGE_GEOMETRY.map((e) => [e.id, e.segIdx]));

const RISK_COLOR: Record<string, string> = {
  safe: '#3d5f86',
  medium: '#4b6a8f',
  risky: '#8a6a3d',
};

interface Props {
  snap: JourneySnapshot;
  teamNames: string[];
  tMs: number;
  selected: number | null;
  onSelect: (teamIdx: number | null) => void;
  finale: boolean;
}

export function MountainMap({ snap, teamNames, tMs, selected, onSelect, finale }: Props) {
  const n = teamNames.length;
  const tags = useMemo(() => teamTags(teamNames), [teamNames]);

  const choices = useMemo(
    () => edgeChoicesAt(snap, n, tMs, SEG_BY_EDGE),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, Math.floor(tMs / 5000)],
  );
  const states = useMemo(
    () => teamStatesAt(snap, n, tMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, Math.floor(tMs / 2000)],
  );

  // Marker positions with fan-out for co-located teams.
  const markers = useMemo(() => {
    const raw = Array.from({ length: n }, (_, i) => {
      const pos = displayPosAt(snap, i, tMs);
      const [x, y] = markerXY(pos, choices[i]);
      return { teamIdx: i, pos, x, y };
    });
    const buckets = new Map<number, typeof raw>();
    for (const m of raw) {
      const key = Math.round(m.pos * 160);
      const arr = buckets.get(key) ?? [];
      arr.push(m);
      buckets.set(key, arr);
    }
    for (const arr of buckets.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => a.teamIdx - b.teamIdx);
      arr.forEach((m, i) => {
        const spread = i - (arr.length - 1) / 2;
        m.x += spread * 30;
        m.y += Math.abs(spread) * 4;
      });
    }
    return raw;
  }, [snap, n, tMs, choices]);

  // Where people were lost: a small red ✕ stays on the mountain at each
  // death site (delivered events only — the map can never foreshadow).
  const deathMarks = useMemo(() => {
    const out: { x: number; y: number; big: boolean; key: string }[] = [];
    for (const e of snap.events) {
      if (e.tMs > tMs) break;
      if (e.type !== 'climber_fall' && e.type !== 'team_wipeout') continue;
      if (e.teamIdx === undefined) continue;
      const pos = displayPosAt(snap, e.teamIdx, e.tMs);
      const ch = edgeChoicesAt(snap, n, e.tMs, SEG_BY_EDGE)[e.teamIdx];
      const [x, y] = markerXY(pos, ch);
      const idx = out.length;
      out.push({
        x: x + ((idx % 3) - 1) * 9,
        y: y + (idx % 2) * 7 - 3,
        big: e.type === 'team_wipeout',
        key: `${e.tMs}-${e.teamIdx}-${e.climberIdx ?? 'w'}`,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, n, Math.floor(tMs / 2000)]);

  // An edge is lit when some team's current-segment choice matches it.
  const activeEdges = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < n; i++) {
      const pos = markers[i].pos;
      let segIdx = 0;
      for (let s = 0; s < NODES.length - 1; s++) {
        if (pos > NODES[s].frac + 1e-9) segIdx = s;
      }
      const chosen = choices[i][segIdx];
      if (chosen) set.add(chosen);
    }
    return set;
  }, [markers, choices, n]);

  // Finale zoom: show the Col -> Summit portion.
  const zoom = finale
    ? { bx: 660, by: 30, bw: 360, bh: 560 }
    : { bx: 0, by: 0, bw: VIEW_W, bh: VIEW_H };
  const s = Math.min(VIEW_W / zoom.bw, VIEW_H / zoom.bh);
  const tx = -zoom.bx * s + (VIEW_W - zoom.bw * s) / 2;
  const ty = -zoom.by * s + (VIEW_H - zoom.bh * s) / 2;

  return (
    <svg
      className="mtn-map"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="Live map of the mountain with team positions"
      onClick={() => onSelect(null)}
    >
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#050810" />
          <stop offset="55%" stopColor="#0a1220" />
          <stop offset="100%" stopColor="#0f1a2e" />
        </linearGradient>
        <radialGradient id="summitGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#cfe8ff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#cfe8ff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#skyGrad)" />

      <g
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${s})`,
          transition: 'transform 1600ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {STARS.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="#dfe9f7" opacity={0.5} />
        ))}
        <circle cx={936} cy={118} r={90} fill="url(#summitGlow)" />

        {SILHOUETTES.map((sil, i) => (
          <path key={i} d={sil.path} fill={sil.fill} />
        ))}

        {/* Route edges */}
        {EDGE_GEOMETRY.map((e) => {
          const active = activeEdges.has(e.id);
          return (
            <path
              key={e.id}
              d={e.path}
              fill="none"
              stroke={RISK_COLOR[e.risk]}
              strokeWidth={active ? 3 : 1.6}
              strokeDasharray={e.risk === 'risky' ? '7 5' : e.risk === 'safe' ? '2 4' : undefined}
              opacity={active ? 0.95 : 0.45}
              strokeLinecap="round"
            />
          );
        })}

        {/* Camps and landmarks */}
        {NODES.map((node) => {
          const [x, y] = NODE_XY[node.id];
          const major = !['BALC', 'SSUM', 'HILL'].includes(node.id);
          return (
            <g key={node.id}>
              <circle
                cx={x}
                cy={y}
                r={major ? 7 : 4}
                fill={node.id === 'SUMMIT' ? '#f4e9c9' : '#101b30'}
                stroke="#7c93b5"
                strokeWidth={1.5}
              />
              <text
                x={x + (node.id === 'SUMMIT' ? -12 : 14)}
                y={y - (node.id === 'SUMMIT' ? 14 : major ? -4 : -2)}
                textAnchor={node.id === 'SUMMIT' ? 'end' : 'start'}
                className={major ? 'mtn-label' : 'mtn-label mtn-label-minor'}
              >
                {node.label}
              </text>
              <text
                x={x + (node.id === 'SUMMIT' ? -12 : 14)}
                y={y + (node.id === 'SUMMIT' ? 0 : major ? 12 : 10)}
                textAnchor={node.id === 'SUMMIT' ? 'end' : 'start'}
                className="mtn-alt"
              >
                {node.alt.toLocaleString()} m
              </text>
            </g>
          );
        })}

        {/* Death sites */}
        {deathMarks.map((d) => (
          <text
            key={d.key}
            x={d.x}
            y={d.y}
            textAnchor="middle"
            className={`mtn-death${d.big ? ' mtn-death-big' : ''}`}
          >
            ✕
          </text>
        ))}

        {/* Team markers */}
        {markers.map((m) => {
          const state = states[m.teamIdx];
          const color = snap.colors[m.teamIdx];
          const isSel = selected === m.teamIdx;
          const wiped = state.wiped;
          return (
            <g
              key={m.teamIdx}
              style={{
                transform: `translate(${m.x}px, ${m.y}px)`,
                transition: 'transform 900ms linear',
                cursor: 'pointer',
              }}
              opacity={wiped ? 0.45 : 1}
              onClick={(ev) => {
                ev.stopPropagation();
                onSelect(isSel ? null : m.teamIdx);
              }}
            >
              {isSel && <circle r={17} fill="none" stroke={color} strokeWidth={2} opacity={0.7} />}
              <circle r={10} fill={color} stroke="#0a1220" strokeWidth={2.5} />
              {wiped ? (
                <text y={4.5} textAnchor="middle" className="mtn-tag" fill="#0a1220">✕</text>
              ) : (
                <text y={3.5} textAnchor="middle" className="mtn-tag" fill="#0a1220">
                  {tags[m.teamIdx]}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Route legend (fixed — does not zoom) */}
      <g transform={`translate(16, ${VIEW_H - 78})`} aria-hidden>
        <rect x={-8} y={-18} width={208} height={72} rx={8} fill="#0a1220" opacity={0.72} />
        {(
          [
            ['risky', 'Risky — faster', '7 5'],
            ['medium', 'Standard', undefined],
            ['safe', 'Safe — slower', '2 4'],
          ] as const
        ).map(([risk, label, dash], i) => (
          <g key={risk} transform={`translate(4, ${i * 21})`}>
            <path
              d="M0 0 H34"
              stroke={RISK_COLOR[risk]}
              strokeWidth={2.5}
              strokeDasharray={dash}
              strokeLinecap="round"
              fill="none"
            />
            <text x={44} y={4.5} className="mtn-legend-label">
              {label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
