'use client';

import { useMemo } from 'react';
import type { PublicSnapshot } from '@/lib/slice';
import { eventsUpTo } from '@/lib/client/raceState';
import { fmtClock } from './useRaceClock';

interface Props {
  snap: PublicSnapshot;
  tMs: number;
  teamNames: string[];
  compact?: boolean;
}

export function CommentaryFeed({ snap, tMs, teamNames, compact }: Props) {
  const events = useMemo(
    () => {
      const list = eventsUpTo(snap, tMs);
      return list.slice(-250).reverse();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, Math.floor(tMs / 1000)],
  );

  return (
    <div className={`feed${compact ? ' feed-compact' : ''}`}>
      {!compact && <h2 className="panel-title">Dispatches</h2>}
      <ol className="feed-list">
        {events.map((e, i) => (
          <li
            key={`${e.tMs}-${e.type}-${e.teamIdx ?? 'x'}-${i}`}
            className={`feed-item sev-${e.severity}`}
          >
            <span className="feed-time">{fmtClock(e.tMs)}</span>
            {e.teamIdx !== undefined && (
              <span
                className="feed-team-dot"
                style={{ background: snap.colors[e.teamIdx] }}
                title={teamNames[e.teamIdx]}
              />
            )}
            <span className="feed-text">{e.text}</span>
          </li>
        ))}
        {events.length === 0 && (
          <li className="feed-item sev-0">
            <span className="feed-text">Waiting for the first dispatch from Base Camp…</span>
          </li>
        )}
      </ol>
    </div>
  );
}
