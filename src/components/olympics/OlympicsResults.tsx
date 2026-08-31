'use client';

import type { OlympicsSnapshot } from '@/lib/slice';
import { medalsAt } from '@/lib/client/olympicsState';
import { fmtClock } from '../useRaceClock';
import { ShareLink } from '../Countdown';

interface Props {
  snap: OlympicsSnapshot;
  teamNames: string[];
  title: string;
  onReplay: () => void;
}

export function OlympicsResults({ snap, teamNames, title, onReplay }: Props) {
  if (!snap.finalOrder) {
    return (
      <div className="results">
        <h1 className="race-title">{title}</h1>
        <p>Certifying the final table…</p>
      </div>
    );
  }
  const lastFrame = snap.pointsKeyframes[snap.pointsKeyframes.length - 1];
  const medals = medalsAt(snap, teamNames.length, Number.POSITIVE_INFINITY);
  const keyMoments = snap.events.filter((e) => e.severity >= 3);

  return (
    <div className="results">
      <h1 className="race-title">{title}</h1>
      <p className="results-sub">The Games are closed. Final standings:</p>

      <ol className="results-list">
        {snap.finalOrder.map((teamIdx, i) => {
          const m = medals[teamIdx];
          return (
            <li
              key={teamIdx}
              className={`results-row${i < 3 ? ` podium podium-${i + 1}` : ''}`}
            >
              <span className="results-place">{i + 1}</span>
              <span className="feed-team-dot" style={{ background: snap.colors[teamIdx] }} />
              <span className="results-name">{teamNames[teamIdx]}</span>
              <span className="results-time">
                {lastFrame ? `${lastFrame.points[teamIdx]} pts` : ''} · {m.gold}🥇{' '}
                {m.silver}🥈 {m.bronze}🥉
              </span>
            </li>
          );
        })}
      </ol>

      <div className="results-actions">
        <button className="share-btn" onClick={onReplay}>
          ▶ Replay the Games
        </button>
        <ShareLink />
      </div>

      <h2 className="panel-title">How it happened</h2>
      <ol className="feed-list results-moments">
        {keyMoments.map((e, i) => (
          <li key={i} className="feed-item sev-3">
            <span className="feed-time">{fmtClock(e.tMs)}</span>
            {e.teamIdx !== undefined && (
              <span className="feed-team-dot" style={{ background: snap.colors[e.teamIdx] }} />
            )}
            <span className="feed-text">{e.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
