'use client';

import { useMemo } from 'react';
import type { OlympicsSnapshot } from '@/lib/slice';
import {
  currentEventIdx,
  liveScoresAt,
  nextEventIdx,
} from '@/lib/client/olympicsState';
import { teamTags } from '@/lib/client/raceState';
import { sportAt } from '@/themes/olympics/build';
import { fmtClock } from '../useRaceClock';

interface Props {
  snap: OlympicsSnapshot;
  teamNames: string[];
  tMs: number;
  selected: number | null;
  onSelect: (i: number | null) => void;
  finale: boolean;
}

/** The venue centerpiece: live lanes for the event in progress. */
export function LiveEventBoard({ snap, teamNames, tMs, selected, onSelect, finale }: Props) {
  const n = teamNames.length;
  const tags = useMemo(() => teamTags(teamNames), [teamNames]);
  const evIdx = currentEventIdx(snap, tMs);
  const nxIdx = nextEventIdx(snap, tMs);
  const tick = Math.floor(tMs / 500);

  const scores = useMemo(
    () => (evIdx >= 0 ? liveScoresAt(snap, evIdx, tMs) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, evIdx, tick],
  );

  const board = useMemo(() => {
    if (!scores) return null;
    const idx = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => scores[b] - scores[a] || a - b,
    );
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const span = Math.max(0.001, max - min);
    return idx.map((teamIdx, rank0) => ({
      teamIdx,
      rank0,
      frac: (scores[teamIdx] - min) / span,
    }));
  }, [scores, n]);

  const ev = evIdx >= 0 ? snap.schedule[evIdx] : null;
  const sport = ev ? sportAt(ev.sportIdx) : null;
  const next = nxIdx >= 0 ? snap.schedule[nxIdx] : null;
  const nextSport = next ? sportAt(next.sportIdx) : null;

  return (
    <div className={`oly-board${finale ? ' oly-finale' : ''}`}>
      {ev && sport && board ? (
        <>
          <div className="oly-board-head">
            <span className="oly-live-dot" aria-hidden />
            <h2 className="oly-event-name">
              {sport.emoji} {sport.name}
              {ev.marquee && <span className="oly-marquee-badge">MARQUEE</span>}
            </h2>
            <span className="oly-venue">{sport.venue}</span>
          </div>
          <div className="oly-lanes">
            {board.map(({ teamIdx, rank0, frac }) => (
              <button
                key={teamIdx}
                className={`oly-lane${selected === teamIdx ? ' selected' : ''}`}
                onClick={() => onSelect(selected === teamIdx ? null : teamIdx)}
                style={{ order: rank0 }}
              >
                <span className="oly-lane-rank">{rank0 + 1}</span>
                <span className="oly-lane-track">
                  <span
                    className="oly-lane-fill"
                    style={{
                      width: `${8 + frac * 88}%`,
                      background: snap.colors[teamIdx],
                    }}
                  />
                  <span
                    className="oly-lane-runner"
                    style={{
                      left: `calc(${8 + frac * 88}% - 11px)`,
                      background: snap.colors[teamIdx],
                    }}
                  >
                    {tags[teamIdx]}
                  </span>
                </span>
                <span className="oly-lane-name">{teamNames[teamIdx]}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="oly-between">
          <p className="oly-between-line">
            {nextSport
              ? `Up next: ${nextSport.emoji} ${nextSport.name} at the ${nextSport.venue} — ${fmtClock(Math.max(0, (next?.startMs ?? 0) - tMs))} away.`
              : 'The programme is complete.'}
          </p>
        </div>
      )}
      {next && nextSport && ev && (
        <p className="oly-upnext">
          Up next: {nextSport.emoji} {nextSport.name} · {nextSport.venue}
        </p>
      )}
    </div>
  );
}
