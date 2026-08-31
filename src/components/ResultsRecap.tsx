'use client';

import type { PublicSnapshot } from '@/lib/slice';
import { fmtClock } from './useRaceClock';
import { ShareLink } from './Countdown';

interface Props {
  snap: PublicSnapshot;
  teamNames: string[];
  title: string;
  onReplay: () => void;
}

export function ResultsRecap({ snap, teamNames, title, onReplay }: Props) {
  if (!snap.finalOrder || !snap.summitTimesMs) {
    return (
      <div className="results">
        <h1 className="race-title">{title}</h1>
        <p>Compiling the final results…</p>
      </div>
    );
  }
  const wipedSet = new Set(snap.wipeouts.map((w) => w.teamIdx));
  const keyMoments = snap.events.filter((e) => e.severity >= 3);

  return (
    <div className="results">
      <h1 className="race-title">{title}</h1>
      <p className="results-sub">The mountain has decided. Final order:</p>

      <ol className="results-list">
        {snap.finalOrder.map((teamIdx, i) => {
          const wiped = wipedSet.has(teamIdx);
          return (
            <li
              key={teamIdx}
              className={`results-row${i < 3 ? ` podium podium-${i + 1}` : ''}${wiped ? ' wiped' : ''}`}
            >
              <span className="results-place">{i + 1}</span>
              <span className="feed-team-dot" style={{ background: snap.colors[teamIdx] }} />
              <span className="results-name">{teamNames[teamIdx]}</span>
              <span className="results-time">
                {wiped
                  ? 'Lost on the mountain — did not summit'
                  : `summited at ${fmtClock(snap.summitTimesMs![teamIdx])}`}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="results-actions">
        <button className="share-btn" onClick={onReplay}>
          ▶ Replay the expedition
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
