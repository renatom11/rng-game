'use client';

import { useMemo } from 'react';
import type { PublicSnapshot } from '@/lib/slice';
import {
  displayPosAt,
  eventsUpTo,
  standingsAt,
  summitedOrder,
  teamStatesAt,
} from '@/lib/client/raceState';
import { altitudeAt } from '@/themes/everest/route';

interface Props {
  snap: PublicSnapshot;
  teamNames: string[];
  tMs: number;
}

/** The live summit-push board: order, altitudes, arrivals, latest headline. */
export function FinaleSidebar({ snap, teamNames, tMs }: Props) {
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
    () => teamStatesAt(snap, n, tMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, n, tick],
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
      <h2 className="finale-title">SUMMIT PUSH</h2>
      {headline && <p className="finale-headline">{headline.text}</p>}
      <ol className="finale-list">
        {order.map((teamIdx, i) => {
          const isUp = summited.has(teamIdx);
          const wiped = states[teamIdx].wiped;
          const alt = isUp
            ? 8849
            : altitudeAt(displayPosAt(snap, teamIdx, tMs));
          return (
            <li
              key={teamIdx}
              className={`finale-row${isUp ? ' summited' : ''}${wiped ? ' wiped' : ''}`}
            >
              <span className="finale-rank">{isUp ? '✓' : i + 1}</span>
              <span className="feed-team-dot" style={{ background: snap.colors[teamIdx] }} />
              <span className="finale-name">{teamNames[teamIdx]}</span>
              <span className="finale-alt">
                {wiped ? 'lost' : `${alt.toLocaleString()} m`}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
