'use client';

import { useMemo } from 'react';
import type { OlympicsSnapshot } from '@/lib/slice';
import {
  latestFrame,
  medalsAt,
  olyMomentum,
  olyStandingsAt,
} from '@/lib/client/olympicsState';
import { teamTags } from '@/lib/client/raceState';

interface Props {
  snap: OlympicsSnapshot;
  teamNames: string[];
  tMs: number;
  selected: number | null;
  onSelect: (i: number | null) => void;
}

export function MedalTable({ snap, teamNames, tMs, selected, onSelect }: Props) {
  const n = teamNames.length;
  const tick = Math.floor(tMs / 2000);

  const order = useMemo(
    () => olyStandingsAt(snap, n, tMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick],
  );
  const frame = useMemo(
    () => latestFrame(snap, tMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, tick],
  );
  const medals = useMemo(
    () => medalsAt(snap, n, tMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick],
  );
  const mom = useMemo(
    () => olyMomentum(snap, n, tMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick],
  );
  const tags = useMemo(() => teamTags(teamNames), [teamNames]);

  return (
    <div className="standings">
      <h2 className="panel-title">Games standings</h2>
      <ol className="standings-list">
        {order.map((teamIdx, i) => {
          const isSel = selected === teamIdx;
          const m = medals[teamIdx];
          const arrow = mom[teamIdx] > 0 ? '▲' : mom[teamIdx] < 0 ? '▼' : '·';
          return (
            <li key={teamIdx}>
              <button
                className={`standing-row${isSel ? ' selected' : ''}`}
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
                    {m.gold}🥇 {m.silver}🥈 {m.bronze}🥉
                  </span>
                </span>
                <span
                  className={`standing-mom ${mom[teamIdx] > 0 ? 'up' : mom[teamIdx] < 0 ? 'down' : ''}`}
                >
                  {arrow}
                </span>
                <span className="oly-points">{frame ? frame.points[teamIdx] : 0}</span>
              </button>
              {isSel && (
                <div className="team-card">
                  <h3>Delegation</h3>
                  <ul className="roster">
                    {snap.athletes[teamIdx].map((a, ai) => (
                      <li key={ai} className="roster-row chip-ok">
                        <span className="roster-dot" aria-hidden />
                        <span className="roster-name">{a.name}</span>
                        <span className="roster-role">{a.specialty}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
