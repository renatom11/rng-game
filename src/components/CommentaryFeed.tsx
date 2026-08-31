'use client';

import { useMemo, useState } from 'react';
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

/**
 * The dispatches feed. Defaults to the dramatic register — deaths, failed
 * attempts, gambles, overtakes, storms — because that's what someone
 * checking in wants to know. Ambient camp chatter stays one tap away.
 */
const FILTERS: [label: string, minSeverity: number][] = [
  ['Drama', 2],
  ['Everything', 0],
  ['Headlines', 3],
];

export function CommentaryFeed({ events, colors, tMs, teamNames, compact }: Props) {
  const [filter, setFilter] = useState(0);
  const minSev = FILTERS[filter][1];

  const visible = useMemo(
    () => {
      const list: FeedEvent[] = [];
      for (const e of events) {
        if (e.tMs > tMs) break;
        if (e.severity >= minSev) list.push(e);
      }
      return list.slice(-250).reverse();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, Math.floor(tMs / 1000), minSev],
  );

  return (
    <div className={`feed${compact ? ' feed-compact' : ''}`}>
      <div className="feed-head">
        {!compact && <h2 className="panel-title">Dispatches</h2>}
        <div className="feed-filter" role="group" aria-label="Dispatch filter">
          {FILTERS.map(([label], i) => (
            <button
              key={label}
              className={`feed-filter-btn${filter === i ? ' active' : ''}`}
              onClick={() => setFilter(i)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
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
