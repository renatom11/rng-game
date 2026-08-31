'use client';

import type { JourneySnapshot } from '@/lib/slice';
import type { JourneyTheme } from '@/lib/client/journeyTheme';
import { displayPosAt, raceDeaths } from '@/lib/client/raceState';
import { deathCauseLabel } from '@/lib/client/causeLabels';
import { fmtClock } from './useRaceClock';
import { ShareLink } from './Countdown';
import ClimberPortrait from './ClimberPortrait';

interface Props {
  snap: JourneySnapshot;
  jt: JourneyTheme;
  teamNames: string[];
  title: string;
  onReplay: () => void;
}

export function ResultsRecap({ snap, jt, teamNames, title, onReplay }: Props) {
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
  const deaths = jt.memorialTitle ? raceDeaths(snap, Number.MAX_SAFE_INTEGER) : [];

  return (
    <div className="results">
      <h1 className="race-title">{title}</h1>
      <p className="results-sub">The result is in. Final order:</p>

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
                  ? jt.resultsLostLine
                  : jt.resultsFinishLine(fmtClock(snap.summitTimesMs![teamIdx]))}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="results-actions">
        <button className="share-btn" onClick={onReplay}>
          ▶ Replay it
        </button>
        <ShareLink />
      </div>

      {deaths.length > 0 && (
        <>
          <h2 className="panel-title memorial-title">{jt.memorialTitle}</h2>
          <ul className="memorial">
            {deaths.map((d, i) => {
              const c = snap.climbers[d.teamIdx][d.climberIdx];
              return (
                <li key={i} className="memorial-row">
                  <ClimberPortrait
                    look={c.look}
                    accent={snap.colors[d.teamIdx]}
                    dead
                    size={36}
                  />
                  <span className="memorial-main">
                    <span className="memorial-name">
                      {c.flag && <span className="dossier-flag">{c.flag}</span>}
                      {c.name}
                      {c.age !== undefined && <span className="memorial-age">· {c.age}</span>}
                    </span>
                    <span className="memorial-meta">
                      <span
                        className="feed-team-dot"
                        style={{ background: snap.colors[d.teamIdx] }}
                      />
                      {teamNames[d.teamIdx]} · {c.role}
                    </span>
                  </span>
                  <span className="memorial-cause">
                    {deathCauseLabel(d.cause)}
                    <span className="memorial-when">
                      {fmtClock(d.tMs)} · {jt.positionLabel(displayPosAt(snap, d.teamIdx, d.tMs))}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

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
