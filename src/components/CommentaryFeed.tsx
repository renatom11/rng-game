'use client';

import { useMemo } from 'react';
import { fmtClock } from './useRaceClock';

export interface FeedEvent {
  tMs: number;
  severity: number;
  text: string;
  teamIdx?: number;
}

interface Props {
  events: readonly FeedEvent[];
  colors: string[];
  tMs: number;
  teamNames: string[];
  compact?: boolean;
}

export function CommentaryFeed({ events, colors, tMs, teamNames, compact }: Props) {
  const visible = useMemo(
    () => {
      const list: FeedEvent[] = [];
      for (const e of events) {
        if (e.tMs > tMs) break;
        list.push(e);
      }
      return list.slice(-250).reverse();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, Math.floor(tMs / 1000)],
  );

  return (
    <div className={`feed${compact ? ' feed-compact' : ''}`}>
      {!compact && <h2 className="panel-title">Dispatches</h2>}
      <ol className="feed-list">
        {visible.map((e, i) => (
          <li
            key={`${e.tMs}-${e.teamIdx ?? 'x'}-${i}`}
            className={`feed-item sev-${e.severity}`}
          >
            <span className="feed-time">{fmtClock(e.tMs)}</span>
            {e.teamIdx !== undefined && (
              <span
                className="feed-team-dot"
                style={{ background: colors[e.teamIdx] }}
                title={teamNames[e.teamIdx]}
              />
            )}
            <span className="feed-text">{e.text}</span>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="feed-item sev-0">
            <span className="feed-text">Waiting for the first dispatch…</span>
          </li>
        )}
      </ol>
    </div>
  );
}
