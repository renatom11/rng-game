'use client';

import { useMemo } from 'react';
import type { JourneySnapshot } from '@/lib/slice';
import {
  displayPosAt,
  eventsUpTo,
  standingsAt,
  summitedOrder,
  teamStatesAt,
} from '@/lib/client/raceState';
import type { JourneyTheme } from '@/lib/client/journeyTheme';

interface Props {
  snap: JourneySnapshot;
  jt: JourneyTheme;
  teamNames: string[];
  tMs: number;
}

/** The live final-act board: order, positions, arrivals, latest headline. */
export function FinaleSidebar({ snap, jt, teamNames, tMs }: Props) {
  const n = teamNames.length;
  const tick = Math.floor(tMs / 1000);

  const order = useMemo(
    () => standingsAt(snap, n, tMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick],
  );
  const summited = useMemo(
    () => new Set(summitedOrder(snap, tMs)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, tick],
  );
  const states = useMemo(
    () => teamStatesAt(snap, n, tMs, jt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick, jt],
  );
  const headline = useMemo(() => {
    const evs = eventsUpTo(snap, tMs);
    for (let i = evs.length - 1; i >= 0; i--) {
      if (evs[i].severity >= 3) return evs[i];
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, tick]);

  return (
    <div className="finale-board">
      <h2 className="finale-title">{jt.finaleTitle}</h2>
      {headline && <p className="finale-headline">{headline.text}</p>}
      <ol className="finale-list">
        {order.map((teamIdx, i) => {
          const isUp = summited.has(teamIdx);
          const st = states[teamIdx];
          const wiped = st.wiped;
          return (
            <li
              key={teamIdx}
              className={`finale-row${isUp ? ' summited' : ''}${wiped ? ' wiped' : ''}`}
            >
              <span className="finale-rank">{isUp ? '✓' : i + 1}</span>
              <span className="feed-team-dot" style={{ background: snap.colors[teamIdx] }} />
              <span className="finale-name">{teamNames[teamIdx]}</span>
              <span
                className="finale-pips"
                title={`${st.climberStatus.filter((c) => c === 'climbing' || c === 'injured' || c === 'resting').length} still climbing`}
              >
                {st.climberStatus.map((c, ci) => (
                  <span
                    key={ci}
                    className={`pip ${
                      c === 'fallen' ? 'pip-lost' : c === 'turned-back' ? 'pip-out' : 'pip-on'
                    }`}
                  >
                    {c === 'fallen' ? '✕' : ''}
                  </span>
                ))}
              </span>
              <span className="finale-alt">
                {wiped
                  ? jt.lostShort
                  : isUp
                    ? jt.positionLabel(1)
                    : jt.positionLabel(displayPosAt(snap, teamIdx, tMs))}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
