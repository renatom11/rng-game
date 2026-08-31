'use client';

import { useMemo } from 'react';
import type { JourneySnapshot } from '@/lib/slice';
import {
  displayPosAt,
  heightOrderAt,
  metersAt,
  momentum,
  teamStatesAt,
  teamTags,
  type ClimberDeath,
} from '@/lib/client/raceState';
import { climberVitalsAt } from '@/lib/client/climberVitals';
import { deathCauseLabel } from '@/lib/client/causeLabels';
import type { ClimberStatus } from '@/themes/everest/types';
import type { JourneyTheme } from '@/lib/client/journeyTheme';
import ClimberPortrait from './ClimberPortrait';
import { fmtClock } from './useRaceClock';

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

  // Live height order: the board shows who is actually highest right now,
  // churning as teams rotate, hold, and get repulsed.
  const order = useMemo(
    () => heightOrderAt(snap, n, tMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick],
  );
  const states = useMemo(
    () => teamStatesAt(snap, n, tMs, jt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick, jt],
  );
  const mom = useMemo(
    () => momentum(snap, n, tMs, Math.max(120_000, durationMs / 15), heightOrderAt),
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
                  teamName={teamNames[teamIdx]}
                  tMs={tMs}
                  climberStatus={st.climberStatus}
                  deaths={st.deaths}
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
  teamName,
  tMs,
  climberStatus,
  deaths,
  wiped,
}: {
  snap: JourneySnapshot;
  jt: JourneyTheme;
  teamIdx: number;
  teamName: string;
  tMs: number;
  climberStatus: ClimberStatus[];
  deaths: (ClimberDeath | null)[];
  wiped: boolean;
}) {
  const m = metersAt(snap, teamIdx, tMs);
  const squad = snap.climbers[teamIdx];
  // Dossier squads (generated people with looks) get the full treatment;
  // squads from before dossiers existed — and other themes — keep the
  // original compact roster.
  const dossier = squad.length > 0 && squad[0].look !== undefined;
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
      <div className={`team-card-cols${dossier ? ' dossier-cols' : ''}`}>
        <div>
          <h3>
            {dossier
              ? `Sponsored by ${teamName} · ${snap.styles[teamIdx]}`
              : `${jt.squadTitle} · ${snap.styles[teamIdx]}`}
          </h3>
          {dossier ? (
            <ul className="roster dossier">
              {squad.map((c, ci) => {
                const status = climberStatus[ci];
                const death = deaths[ci];
                const dead = status === 'fallen';
                const v = climberVitalsAt(snap, teamIdx, ci, tMs, status, death);
                return (
                  <li
                    key={ci}
                    className={`dossier-row chip-${STATUS_CHIP[status]}${dead ? ' dossier-dead' : ''}`}
                  >
                    <ClimberPortrait
                      look={c.look}
                      accent={snap.colors[teamIdx]}
                      dead={dead}
                    />
                    <span className="dossier-main">
                      <span className="dossier-name">
                        {c.flag && <span className="dossier-flag">{c.flag}</span>}
                        {c.name}
                        <span className="dossier-status">{jt.statusLabels[status]}</span>
                      </span>
                      <span className="dossier-meta">
                        {c.role}
                        {c.age !== undefined && ` · ${c.age}`}
                        {c.hometown && ` · ${c.hometown}`}
                      </span>
                      {c.bio && !dead && <span className="dossier-bio">{c.bio}</span>}
                      {dead && death ? (
                        <span className="dossier-death">
                          {deathCauseLabel(death.cause)} · {fmtClock(death.tMs)} ·{' '}
                          {jt.positionLabel(displayPosAt(snap, teamIdx, death.tMs))}
                        </span>
                      ) : (
                        <span className="dossier-vitals">
                          {v.alive && status !== 'turned-back' ? (
                            <>
                              SpO₂ <strong>{v.spo2}</strong> · output{' '}
                              <strong>{v.output}</strong> · {v.note}
                            </>
                          ) : (
                            v.note || jt.statusLabels[status]
                          )}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
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
          )}
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
