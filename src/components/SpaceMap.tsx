'use client';

import { useMemo } from 'react';
import type { JourneyMapProps } from './RaceClient';
import {
  displayPosAt,
  edgeChoicesAt,
  teamStatesAt,
  teamTags,
} from '@/lib/client/raceState';
import { SPACE_JOURNEY } from '@/lib/client/spaceTheme';
import {
  EDGE_GEOMETRY,
  NODE_XY,
  STARS,
  VIEW_H,
  VIEW_W,
  markerXY,
} from '@/themes/space/map-geometry';
import { NODES } from '@/themes/space/route';
import { distanceLabel } from '@/themes/space/route';

const SEG_BY_EDGE = new Map(EDGE_GEOMETRY.map((e) => [e.id, e.segIdx]));

const RISK_COLOR: Record<string, string> = {
  safe: '#3d5f86',
  medium: '#4b6a8f',
  risky: '#8a5a4a',
};

export function SpaceMap({ snap, teamNames, tMs, selected, onSelect, finale }: JourneyMapProps) {
  const n = teamNames.length;
  const tags = useMemo(() => teamTags(teamNames), [teamNames]);

  const choices = useMemo(
    () => edgeChoicesAt(snap, n, tMs, SEG_BY_EDGE),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, Math.floor(tMs / 5000)],
  );
  const states = useMemo(
    () => teamStatesAt(snap, n, tMs, SPACE_JOURNEY),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, Math.floor(tMs / 2000)],
  );

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

  // Finale zoom: the Mars approach.
  const zoom = finale
    ? { bx: 620, by: 60, bw: 340, bh: 500 }
    : { bx: 0, by: 0, bw: VIEW_W, bh: VIEW_H };
  const s = Math.min(VIEW_W / zoom.bw, VIEW_H / zoom.bh);
  const tx = -zoom.bx * s + (VIEW_W - zoom.bw * s) / 2;
  const ty = -zoom.by * s + (VIEW_H - zoom.bh * s) / 2;

  return (
    <svg
      className="mtn-map"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="Live map of the fleet between Earth and Mars"
      onClick={() => onSelect(null)}
    >
      <defs>
        <radialGradient id="spaceBg" cx="0.2" cy="0.9" r="1.4">
          <stop offset="0%" stopColor="#0b1428" />
          <stop offset="55%" stopColor="#060a16" />
          <stop offset="100%" stopColor="#04060d" />
        </radialGradient>
        <radialGradient id="earthGrad" cx="0.35" cy="0.3" r="0.9">
          <stop offset="0%" stopColor="#7fc2ff" />
          <stop offset="55%" stopColor="#2a6fbe" />
          <stop offset="100%" stopColor="#123a6e" />
        </radialGradient>
        <radialGradient id="marsGrad" cx="0.35" cy="0.3" r="0.9">
          <stop offset="0%" stopColor="#ff9d6f" />
          <stop offset="60%" stopColor="#c1502e" />
          <stop offset="100%" stopColor="#7a2e18" />
        </radialGradient>
        <radialGradient id="marsGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ff8a5c" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#ff8a5c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sunGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ffd27f" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#ffd27f" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#spaceBg)" />

      <g
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${s})`,
          transition: 'transform 1600ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {STARS.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="#dfe9f7" opacity={0.55} />
        ))}

        {/* the sun, far stage left of the solar corridor */}
        <circle cx={40} cy={620} r={200} fill="url(#sunGlow)" />

        {/* Earth + Moon */}
        <circle cx={150} cy={1290} r={95} fill="url(#earthGrad)" />
        <circle cx={492} cy={935} r={16} fill="#b9bdc7" opacity={0.9} />
        {/* Mars */}
        <circle cx={872} cy={148} r={110} fill="url(#marsGlow)" />
        <circle cx={872} cy={148} r={46} fill="url(#marsGrad)" />

        {/* Trajectories */}
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

        {/* Waypoints */}
        {NODES.map((node) => {
          const [x, y] = NODE_XY[node.id];
          const minor = ['HMO', 'ENTRY'].includes(node.id);
          const labelLeft = ['BRAKE', 'HMO', 'ENTRY', 'MARS', 'STAGING'].includes(node.id);
          return (
            <g key={node.id}>
              <circle
                cx={x}
                cy={y}
                r={minor ? 4 : 7}
                fill={node.id === 'MARS' ? '#ffd9c4' : '#0d1526'}
                stroke="#7c93b5"
                strokeWidth={1.5}
              />
              <text
                x={x + (labelLeft ? -14 : 14)}
                y={y - (minor ? 2 : -4)}
                textAnchor={labelLeft ? 'end' : 'start'}
                className={minor ? 'mtn-label mtn-label-minor' : 'mtn-label'}
              >
                {node.label}
              </text>
              <text
                x={x + (labelLeft ? -14 : 14)}
                y={y + (minor ? 10 : 12)}
                textAnchor={labelLeft ? 'end' : 'start'}
                className="mtn-alt"
              >
                {distanceLabel(node.frac)}
              </text>
            </g>
          );
        })}

        {/* Ship markers */}
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
              <circle r={10} fill={color} stroke="#04060d" strokeWidth={2.5} />
              {wiped ? (
                <text y={4.5} textAnchor="middle" className="mtn-tag" fill="#04060d">✕</text>
              ) : (
                <text y={3.5} textAnchor="middle" className="mtn-tag" fill="#04060d">
                  {tags[m.teamIdx]}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
