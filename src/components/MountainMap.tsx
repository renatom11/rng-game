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
  VIEW_H,
  VIEW_W,
  markerXY,
} from '@/themes/everest/map-geometry';
import { NODES } from '@/themes/everest/route';
import { deathCauseLabel } from '@/lib/client/causeLabels';
import { MountainScene, sceneLight } from '@/themes/everest/scene';

const SEG_BY_EDGE = new Map(EDGE_GEOMETRY.map((e) => [e.id, e.segIdx]));

const RISK_COLOR: Record<string, string> = {
  safe: '#7396bc',
  medium: '#9db9da',
  risky: '#d2a05e',
};

interface Props {
  snap: JourneySnapshot;
  teamNames: string[];
  tMs: number;
  durationMs: number;
  selected: number | null;
  onSelect: (teamIdx: number | null) => void;
  finale: boolean;
}

export function MountainMap({ snap, teamNames, tMs, durationMs, selected, onSelect, finale }: Props) {
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

  // Storm intensity right now, eased in/out at the edges, for the blizzard.
  const stormIntensity = useMemo(() => {
    let best = 0;
    for (const st of snap.storms ?? []) {
      const len = st.endMs - st.startMs;
      const edge = Math.max(2_000, Math.min(60_000, len * 0.2));
      const ramp = Math.min(
        1,
        Math.max(0, (tMs - (st.startMs - edge)) / edge),
        Math.max(0, (st.endMs + edge - tMs) / edge),
      );
      best = Math.max(best, ramp);
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.storms, Math.floor(tMs / 1000)]);

  // The hour on the mountain: race progress drives the light.
  const light = useMemo(
    () => sceneLight(durationMs > 0 ? tMs / durationMs : 0, stormIntensity),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.floor(tMs / 1000), durationMs, stormIntensity],
  );
  const lampAmt = Math.max(0, Math.min(1, (light.darkness - 0.45) * 1.8));

  // Deterministic flake field (no randomness at render time).
  const flakes = useMemo(
    () =>
      Array.from({ length: 64 }, (_, i) => ({
        x: (i * 173) % (VIEW_W + 200) - 100,
        y: ((i * 97) % (VIEW_H + 300)) - 150,
        len: 7 + (i % 5) * 3,
        dur: 2.4 + ((i * 31) % 17) / 10,
        delay: -(((i * 53) % 40) / 10),
      })),
    [],
  );

  // Marker positions with fan-out for genuinely overlapping dots.
  const markers = useMemo(() => {
    const raw = Array.from({ length: n }, (_, i) => {
      const pos = displayPosAt(snap, i, tMs);
      const [x, y] = markerXY(pos, choices[i]);
      return { teamIdx: i, pos, x, y };
    });

    // Summited teams park in a tidy cluster under the peak, in arrival
    // order — a victorious pile fanned across the whole ridge read as
    // chaos, not triumph.
    const summitOrder: number[] = [];
    for (const e of snap.events) {
      if (e.tMs > tMs) break;
      if (e.type === 'summit' && e.teamIdx !== undefined && !summitOrder.includes(e.teamIdx)) {
        summitOrder.push(e.teamIdx);
      }
    }
    const atTop = raw.filter((m) => m.pos >= 0.9999);
    for (const m of atTop) {
      if (!summitOrder.includes(m.teamIdx)) summitOrder.push(m.teamIdx);
    }
    const parked = new Set<number>();
    const [sx, sy] = NODE_XY['SUMMIT'];
    for (const m of atTop) {
      const k = summitOrder.indexOf(m.teamIdx);
      const row = Math.ceil(k / 2);
      m.x = sx + (k === 0 ? 0 : (k % 2 === 1 ? -1 : 1) * (8 + row * 7));
      m.y = sy + (k === 0 ? -2 : 3 + row * 7);
      parked.add(m.teamIdx);
    }

    // Fan out only dots that genuinely overlap ON SCREEN.
    const buckets = new Map<string, typeof raw>();
    for (const m of raw) {
      if (parked.has(m.teamIdx)) continue;
      const key = `${Math.round(m.x / 24)}:${Math.round(m.y / 18)}`;
      const arr = buckets.get(key) ?? [];
      arr.push(m);
      buckets.set(key, arr);
    }
    for (const arr of buckets.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => a.teamIdx - b.teamIdx);
      arr.forEach((m, i) => {
        const spread = i - (arr.length - 1) / 2;
        m.x += spread * Math.min(16, 120 / arr.length);
        m.y += Math.abs(spread) * 3;
      });
    }
    return raw;
  }, [snap, n, tMs, choices]);

  // Where people were lost — hover (or tap) for who, which team, and how.
  const deathMarks = useMemo(() => {
    const out: {
      x: number; y: number; big: boolean; key: string;
      color: string; teamIdx: number; label: string;
    }[] = [];
    for (const e of snap.events) {
      if (e.tMs > tMs) break;
      if (e.type !== 'climber_fall' && e.type !== 'team_wipeout') continue;
      if (e.teamIdx === undefined) continue;
      const pos = displayPosAt(snap, e.teamIdx, e.tMs);
      const ch = edgeChoicesAt(snap, n, e.tMs, SEG_BY_EDGE)[e.teamIdx];
      const [x, y] = markerXY(pos, ch);
      const idx = out.length;
      const team = teamNames[e.teamIdx] ?? `Team ${e.teamIdx + 1}`;
      const cause = deathCauseLabel(e.cause);
      const label =
        e.type === 'team_wipeout'
          ? `${team} — the whole expedition, lost. ${cause}`
          : `${snap.climbers[e.teamIdx]?.[e.climberIdx ?? -1]?.name ?? 'A climber'} · ${team} — ${cause}`;
      out.push({
        x: x + ((idx % 3) - 1) * 9,
        y: y + (idx % 2) * 7 - 3,
        big: e.type === 'team_wipeout',
        key: `${e.tMs}-${e.teamIdx}-${e.climberIdx ?? 'w'}`,
        color: snap.colors[e.teamIdx],
        teamIdx: e.teamIdx,
        label,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, n, teamNames, Math.floor(tMs / 2000)]);

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
        <filter id="routeGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <radialGradient id="campGlowG" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ffd9a0" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#ffd9a0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lampConeG" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#ffe9b0" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#ffe9b0" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${s})`,
          transition: 'transform 1600ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* the painted mountain, lit by the hour of the race */}
        <MountainScene light={light} />

        {/* Route edges: quiet unless someone is on them */}
        {EDGE_GEOMETRY.map((e) => {
          const active = activeEdges.has(e.id);
          return (
            <g key={e.id}>
              {active && (
                <path
                  d={e.path}
                  fill="none"
                  stroke={lampAmt > 0.4 ? '#9fd9ff' : '#e8f2ff'}
                  strokeWidth={5.5}
                  opacity={0.22 + lampAmt * 0.16}
                  filter="url(#routeGlow)"
                  strokeLinecap="round"
                />
              )}
              <path
                d={e.path}
                fill="none"
                stroke={active ? '#dcebfb' : RISK_COLOR[e.risk]}
                strokeWidth={active ? 2.3 : 1.3}
                strokeDasharray={e.risk === 'risky' ? '7 5' : e.risk === 'safe' ? '2 4' : undefined}
                opacity={active ? 0.95 : 0.34}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {/* Camps and landmarks */}
        {NODES.map((node) => {
          const [x, y] = NODE_XY[node.id];
          const major = !['BALC', 'SSUM', 'HILL'].includes(node.id);
          const summit = node.id === 'SUMMIT';
          return (
            <g key={node.id}>
              {major && !summit && (
                <>
                  <circle cx={x} cy={y} r={20} fill="url(#campGlowG)" opacity={lampAmt} />
                  <g transform={`translate(${x}, ${y})`}>
                    <path
                      d="M-8 5 L0 -7 L8 5 Z"
                      fill={lampAmt > 0.4 ? '#2c3450' : '#111b2e'}
                      stroke="#aebfda"
                      strokeWidth={1.6}
                      strokeLinejoin="round"
                    />
                    <path d="M-2.4 5 L0 1 L2.4 5 Z" fill={lampAmt > 0.2 ? '#ffd9a0' : '#3a4864'} />
                  </g>
                </>
              )}
              {!major && (
                <circle cx={x} cy={y} r={3.6} fill="#101b30" stroke="#8ea3c4" strokeWidth={1.4} />
              )}
              {summit && (
                <circle cx={x} cy={y} r={7} fill="#f6ecce" stroke="#c9b273" strokeWidth={1.6} />
              )}
            </g>
          );
        })}

        {/* Snowfall is always breathing; a storm closes the sky on top */}
        {(
          <g className="mtn-blizzard" opacity={0.22 + stormIntensity * 0.78} aria-hidden>
            <rect x={-100} y={-100} width={VIEW_W + 200} height={VIEW_H + 200} fill="#aebfd6" opacity={0.16 * stormIntensity} />
            {flakes.map((fl, i) => (
              <line
                key={i}
                x1={fl.x}
                y1={fl.y}
                x2={fl.x - fl.len * 0.7}
                y2={fl.y + fl.len}
                className="mtn-flake"
                style={{ animationDuration: `${fl.dur}s`, animationDelay: `${fl.delay}s` }}
              />
            ))}
          </g>
        )}

        {/* Death sites — hover (or tap) for who, which team, and how */}
        {deathMarks.map((d) => (
          <g
            key={d.key}
            className="mtn-death-site"
            onClick={(ev) => {
              ev.stopPropagation();
              onSelect(selected === d.teamIdx ? null : d.teamIdx);
            }}
          >
            <title>{d.label}</title>
            <circle cx={d.x} cy={d.y - 3} r={9} fill="transparent" />
            <text
              x={d.x}
              y={d.y}
              textAnchor="middle"
              style={{ fill: d.color }}
              className={`mtn-death${d.big ? ' mtn-death-big' : ''}`}
            >
              ✕
            </text>
          </g>
        ))}

        {/* A quiet cheer: brief expanding halos at the peak as teams arrive */}
        {(() => {
          const rings: { key: string; color: string }[] = [];
          for (const e of snap.events) {
            if (e.tMs > tMs) break;
            if (e.type === 'summit' && e.teamIdx !== undefined && tMs - e.tMs < 3600) {
              rings.push({ key: `${e.teamIdx}-${e.tMs}`, color: snap.colors[e.teamIdx] });
            }
          }
          const [sx, sy] = NODE_XY['SUMMIT'];
          return rings.map((c) => (
            <g key={c.key} aria-hidden pointerEvents="none">
              <circle cx={sx} cy={sy} r={10} className="mtn-cheer" style={{ stroke: c.color }} />
              <circle cx={sx} cy={sy} r={10} className="mtn-cheer mtn-cheer-b" style={{ stroke: c.color }} />
            </g>
          ));
        })()}

        {/* Team markers — headlamps on after dark */}
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
              {!wiped && lampAmt > 0.05 && (
                <g opacity={lampAmt} className="mtn-headlamp" transform="rotate(24)">
                  <path d="M0 -5 L-9 -36 L9 -36 Z" fill="url(#lampConeG)" />
                  <circle cy={-7} r={2.8} fill="#ffe9b0" />
                </g>
              )}
              <ellipse cy={6} rx={9} ry={2.6} fill="#02050a" opacity={0.35} />
              {isSel && <circle r={17} fill="none" stroke={color} strokeWidth={2} opacity={0.75} />}
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

        {/* Place names ride above the traffic — a chip never swallows one */}
        <g pointerEvents="none">
          {NODES.map((node) => {
            const [x, y] = NODE_XY[node.id];
            const major = !['BALC', 'SSUM', 'HILL'].includes(node.id);
            const summit = node.id === 'SUMMIT';
            return (
              <g key={`lbl-${node.id}`}>
                <text
                  x={x + (summit ? -12 : 14)}
                  y={y - (summit ? 16 : major ? 3 : 2)}
                  textAnchor={summit ? 'end' : 'start'}
                  className={major ? 'mtn-label' : 'mtn-label mtn-label-minor'}
                >
                  {node.label}
                </text>
                <text
                  x={x + (summit ? -12 : 14)}
                  y={y + (summit ? -2 : major ? 15 : 12)}
                  textAnchor={summit ? 'end' : 'start'}
                  className="mtn-alt"
                >
                  {node.alt.toLocaleString()} m
                </text>
              </g>
            );
          })}
        </g>
      </g>

      {/* Route legend (fixed — does not zoom) */}
      <g transform={`translate(16, ${VIEW_H - 78})`} aria-hidden>
        <rect x={-8} y={-18} width={208} height={72} rx={10} fill="#060b14" opacity={0.78} />
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
