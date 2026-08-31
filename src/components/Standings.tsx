'use client';

import { useMemo } from 'react';
import type { JourneySnapshot } from '@/lib/slice';
import {
  displayPosAt,
  metersAt,
  momentum,
  standingsAt,
  teamStatesAt,
  teamTags,
} from '@/lib/client/raceState';
import type { ClimberStatus } from '@/themes/everest/types';
import type { JourneyTheme } from '@/lib/client/journeyTheme';

const STATUS_CHIP: Record<ClimberStatus, string> = {
  climbing: 'ok',
  resting: 'ok',
  injured: 'warn',
  'turned-back': 'dim',
  fallen: 'bad',
};

interface Props {
  snap: JourneySnapshot;
  jt: JourneyTheme;
  teamNames: string[];
  tMs: number;
  durationMs: number;
  selected: number | null;
  onSelect: (i: number | null) => void;
}

export function Standings({ snap, jt, teamNames, tMs, durationMs, selected, onSelect }: Props) {
  const n = teamNames.length;
  const tick = Math.floor(tMs / 2000);

  const order = useMemo(
    () => standingsAt(snap, n, tMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick],
  );
  const states = useMemo(
    () => teamStatesAt(snap, n, tMs, jt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick, jt],
  );
  const mom = useMemo(
    () => momentum(snap, n, tMs, Math.max(120_000, durationMs / 15)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick, durationMs],
  );
  const tags = useMemo(() => teamTags(teamNames), [teamNames]);

  return (
    <div className="standings">
      <h2 className="panel-title">{jt.standingsTitle}</h2>
      <ol className="standings-list">
        {order.map((teamIdx, i) => {
          const st = states[teamIdx];
          const m = metersAt(snap, teamIdx, tMs);
          const pos = displayPosAt(snap, teamIdx, tMs);
          const wp = jt.waypointAt(pos + 0.01);
          const nearWp = Math.abs(wp.frac - pos) < 0.02;
          const where = st.wiped
            ? jt.lostWhere
            : st.activity === jt.finishedActivity
              ? jt.finishedWhere
              : nearWp
                ? wp.label
                : jt.positionLabel(pos);
          const isSel = selected === teamIdx;
          const arrow = mom[teamIdx] > 0 ? '▲' : mom[teamIdx] < 0 ? '▼' : '·';
          return (
            <li key={teamIdx}>
              <button
                className={`standing-row${isSel ? ' selected' : ''}${st.wiped ? ' wiped' : ''}`}
                onClick={() => onSelect(isSel ? null : teamIdx)}
                aria-expanded={isSel}
              >
                <span className="standing-rank">{i + 1}</span>
                <span className="team-chip" style={{ background: snap.colors[teamIdx] }}>
                  {tags[teamIdx]}
                </span>
                <span className="standing-main">
                  <span className="standing-name">{teamNames[teamIdx]}</span>
                  <span className="standing-where">
                    {where} · {st.activity}
                  </span>
                </span>
                <span
                  className={`standing-mom ${mom[teamIdx] > 0 ? 'up' : mom[teamIdx] < 0 ? 'down' : ''}`}
                  title="movement over the last stretch"
                >
                  {arrow}
                </span>
                <span className="standing-ready" title={`Readiness ${m.readiness}%`}>
                  <span className="ready-bar">
                    <span style={{ width: `${m.readiness}%` }} />
                  </span>
                </span>
              </button>
              {isSel && (
                <TeamCard
                  snap={snap}
                  jt={jt}
                  teamIdx={teamIdx}
                  tMs={tMs}
                  climberStatus={st.climberStatus}
                  wiped={st.wiped}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TeamCard({
  snap,
  jt,
  teamIdx,
  tMs,
  climberStatus,
  wiped,
}: {
  snap: JourneySnapshot;
  jt: JourneyTheme;
  teamIdx: number;
  tMs: number;
  climberStatus: ClimberStatus[];
  wiped: boolean;
}) {
  const m = metersAt(snap, teamIdx, tMs);
  const squad = snap.climbers[teamIdx];
  const [l1, l2, l3, l4, l5, l6, l7] = jt.meterLabels;
  const bars: [string, number][] = [
    [l1, m.o2],
    [l2, m.food],
    [l3, m.rope],
    [l4, m.med],
    [l5, m.energy],
    [l6, m.morale],
    [l7, m.accl],
  ];
  return (
    <div className="team-card">
      {wiped && <div className="team-card-wiped">{jt.wipedCard}</div>}
      <div className="team-card-cols">
        <div>
          <h3>{jt.squadTitle} · {snap.styles[teamIdx]}</h3>
          <ul className="roster">
            {squad.map((c, ci) => (
              <li key={ci} className={`roster-row chip-${STATUS_CHIP[climberStatus[ci]]}`}>
                <span className="roster-dot" aria-hidden />
                <span className="roster-name">{c.name}</span>
                <span className="roster-role">{c.role}</span>
                <span className="roster-status">{jt.statusLabels[climberStatus[ci]]}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Supplies & condition</h3>
          <ul className="meterlist">
            {bars.map(([label, v]) => (
              <li key={label}>
                <span className="meter-label">{label}</span>
                <span className="meter-bar">
                  <span
                    style={{ width: `${v}%` }}
                    className={v < 30 ? 'low' : v < 60 ? 'mid' : ''}
                  />
                </span>
                <span className="meter-val">{v}</span>
              </li>
            ))}
          </ul>
          <div className="readiness-line">
            {jt.readinessLabel}: <strong>{m.readiness}%</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
