'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRaceData } from './useRaceData';
import { useRaceClock } from './useRaceClock';
import { MountainMap } from './MountainMap';
import { Standings } from './Standings';
import { CommentaryFeed } from './CommentaryFeed';
import { PositionChart } from './PositionChart';
import { PhaseBanner } from './PhaseBanner';
import { Countdown } from './Countdown';
import { PlaybackBar } from './PlaybackBar';
import { FinaleSidebar } from './FinaleSidebar';
import { ResultsRecap } from './ResultsRecap';

export function RaceClient({ slug }: { slug: string }) {
  const { view, error, offsetMs } = useRaceData(slug);
  const [replaying, setReplaying] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const demo = view?.config.demo ?? false;
  const virtual = demo || replaying;
  const durationMs = view?.durationMs ?? 1;
  const startAt = view?.startAt ?? 0;

  const clock = useRaceClock({ startAt, durationMs, offsetMs, virtual });

  const teamNames = useMemo(
    () => view?.config.teams.map((t) => t.name) ?? [],
    [view],
  );

  if (error === 'not-found') {
    return (
      <main className="race-shell center">
        <h1 className="race-title">No such expedition</h1>
        <p>
          This link doesn&apos;t match any race. <Link href="/new">Plan a new one?</Link>
        </p>
      </main>
    );
  }
  if (!view) {
    return (
      <main className="race-shell center">
        <p className="loading-line">Contacting Base Camp…</p>
        {error && <p className="loading-err">Connection trouble — retrying.</p>}
      </main>
    );
  }

  const snap = view.snapshot;
  const realNow = Date.now() + offsetMs;
  const realT = Math.max(0, Math.min(durationMs, realNow - startAt));
  const tMs = virtual ? clock.tMs : realT;

  const scheduled = !virtual && realNow < startAt;
  const finished = tMs >= durationMs;
  const finale = !finished && tMs >= snap.pushStartMs && snap.grid.tMs.length > 0;
  const showRecap = finished && (!virtual || clock.tMs >= durationMs);

  return (
    <main className={`race-shell${finale ? ' is-finale' : ''}`}>
      {scheduled ? (
        <Countdown
          startAt={startAt}
          offsetMs={offsetMs}
          teamNames={teamNames}
          colors={snap.colors}
          title={view.config.title}
        />
      ) : showRecap ? (
        <>
          <ResultsRecap
            snap={snap}
            teamNames={teamNames}
            title={view.config.title}
            onReplay={() => {
              clock.scrubTo(0);
              clock.setSpeed(demo ? 60 : Math.max(60, Math.round(durationMs / 90_000)));
              clock.setPlaying(true);
              setReplaying(true);
            }}
          />
        </>
      ) : (
        <>
          <header className="race-header">
            <h1 className="race-title-sm">{view.config.title}</h1>
            <PhaseBanner tMs={tMs} durationMs={durationMs} demo={demo} />
          </header>

          <div className="race-grid">
            <section className="map-pane">
              <MountainMap
                snap={snap}
                teamNames={teamNames}
                tMs={tMs}
                selected={selected}
                onSelect={setSelected}
                finale={finale}
              />
            </section>
            <aside className="side-pane">
              {finale ? (
                <>
                  <FinaleSidebar snap={snap} teamNames={teamNames} tMs={tMs} />
                  <CommentaryFeed snap={snap} tMs={tMs} teamNames={teamNames} compact />
                </>
              ) : (
                <Standings
                  snap={snap}
                  teamNames={teamNames}
                  tMs={tMs}
                  durationMs={durationMs}
                  selected={selected}
                  onSelect={setSelected}
                />
              )}
            </aside>
          </div>

          {!finale && (
            <div className="race-lower">
              <CommentaryFeed snap={snap} tMs={tMs} teamNames={teamNames} />
              <PositionChart
                snap={snap}
                teamNames={teamNames}
                tMs={tMs}
                selected={selected}
                onSelect={setSelected}
              />
            </div>
          )}
        </>
      )}

      {virtual && !scheduled && (
        <PlaybackBar
          tMs={tMs}
          durationMs={durationMs}
          pushStartMs={snap.pushStartMs}
          playing={clock.playback.playing}
          speed={clock.playback.speed}
          setPlaying={clock.setPlaying}
          setSpeed={clock.setSpeed}
          scrubTo={clock.scrubTo}
        />
      )}
    </main>
  );
}
