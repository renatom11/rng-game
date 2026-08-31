'use client';

import { useMemo } from 'react';
import type { EverestSnapshot } from '@/lib/slice';
import {
  displayPosAt,
  metersAt,
  momentum,
  standingsAt,
  teamStatesAt,
  teamTags,
} from '@/lib/client/raceState';
import { nodeAtOrBelow, altitudeAt } from '@/themes/everest/route';
import type { ClimberStatus } from '@/themes/everest/types';

const STATUS_ICON: Record<ClimberStatus, { chip: string; label: string }> = {
  climbing: { chip: 'ok', label: 'climbing' },
  resting: { chip: 'ok', label: 'resting' },
  injured: { chip: 'warn', label: 'injured' },
  'turned-back': { chip: 'dim', label: 'turned back' },
  fallen: { chip: 'bad', label: 'fallen' },
};

interface Props {
  snap: EverestSnapshot;
  teamNames: string[];
  tMs: number;
  durationMs: number;
  selected: number | null;
  onSelect: (i: number | null) => void;
}

export function Standings({ snap, teamNames, tMs, durationMs, selected, onSelect }: Props) {
  const n = teamNames.length;
  const tick = Math.floor(tMs / 2000);

  const order = useMemo(
    () => standingsAt(snap, n, tMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick],
  );
  const states = useMemo(
    () => teamStatesAt(snap, n, tMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick],
  );
  const mom = useMemo(
    () => momentum(snap, n, tMs, Math.max(120_000, durationMs / 15)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick, durationMs],
  );
  const tags = useMemo(() => teamTags(teamNames), [teamNames]);

  return (
    <div className="standings">
      <h2 className="panel-title">Expedition standings</h2>
      <ol className="standings-list">
        {order.map((teamIdx, i) => {
          const st = states[teamIdx];
          const m = metersAt(snap, teamIdx, tMs);
          const pos = displayPosAt(snap, teamIdx, tMs);
          const camp = nodeAtOrBelow(pos + 0.01);
          const nearCamp = Math.abs(camp.frac - pos) < 0.02;
          const where = st.wiped
            ? 'Lost on the mountain'
            : st.activity === 'Summited'
              ? 'Summit'
              : nearCamp
                ? camp.label
                : `${altitudeAt(pos).toLocaleString()} m`;
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
  teamIdx,
  tMs,
  climberStatus,
  wiped,
}: {
  snap: EverestSnapshot;
  teamIdx: number;
  tMs: number;
  climberStatus: ClimberStatus[];
  wiped: boolean;
}) {
  const m = metersAt(snap, teamIdx, tMs);
  const squad = snap.climbers[teamIdx];
  const bars: [string, number][] = [
    ['Oxygen', m.o2],
    ['Food & fuel', m.food],
    ['Rope', m.rope],
    ['Medical', m.med],
    ['Energy', m.energy],
    ['Morale', m.morale],
    ['Acclimatization', m.accl],
  ];
  return (
    <div className="team-card">
      {wiped && <div className="team-card-wiped">The mountain keeps them. Expedition over.</div>}
      <div className="team-card-cols">
        <div>
          <h3>Squad · {snap.styles[teamIdx]}</h3>
          <ul className="roster">
            {squad.map((c, ci) => {
              const s = STATUS_ICON[climberStatus[ci]];
              return (
                <li key={ci} className={`roster-row chip-${s.chip}`}>
                  <span className="roster-dot" aria-hidden />
                  <span className="roster-name">{c.name}</span>
                  <span className="roster-role">{c.role}</span>
                  <span className="roster-status">{s.label}</span>
                </li>
              );
            })}
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
            Readiness for next push: <strong>{m.readiness}%</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
