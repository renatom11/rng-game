'use client';

import { useEffect, useState } from 'react';
import { fmtClock } from './useRaceClock';

interface Props {
  startAt: number;
  offsetMs: number;
  teamNames: string[];
  colors: string[];
  title: string;
}

export function Countdown({ startAt, offsetMs, teamNames, colors, title }: Props) {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offsetMs), 500);
    return () => clearInterval(id);
  }, [offsetMs]);
  const remaining = Math.max(0, startAt - now);

  return (
    <div className="countdown">
      <h1 className="race-title">{title}</h1>
      <p className="countdown-sub">The expedition departs Base Camp in</p>
      <div className="countdown-clock">{fmtClock(remaining)}</div>
      <ShareLink />
      <ul className="countdown-roster">
        {teamNames.map((name, i) => (
          <li key={i}>
            <span className="feed-team-dot" style={{ background: colors[i] }} />
            {name}
          </li>
        ))}
      </ul>
      <p className="countdown-hint">
        Keep this link — check in any time to see how your team is doing.
      </p>
    </div>
  );
}

export function ShareLink() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="share-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // clipboard unavailable — show the URL for manual copy
          window.prompt('Copy this link:', window.location.href);
        }
      }}
    >
      {copied ? 'Link copied ✓' : 'Copy share link'}
    </button>
  );
}
