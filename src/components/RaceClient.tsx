'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  EverestSnapshot,
  JourneySnapshot,
  OlympicsSnapshot,
  SpaceSnapshot,
} from '@/lib/slice';

type AnyJourneySnapshot = EverestSnapshot | SpaceSnapshot;
import { standingsAt } from '@/lib/client/raceState';
import { EVEREST_JOURNEY, type JourneyTheme } from '@/lib/client/journeyTheme';
import { SPACE_JOURNEY } from '@/lib/client/spaceTheme';
import { olyPhaseLabel, olyStandingsAt } from '@/lib/client/olympicsState';
import { useRaceData } from './useRaceData';
import { useRaceClock } from './useRaceClock';
import { MountainMap } from './MountainMap';
import { SpaceMap } from './SpaceMap';
import { Standings } from './Standings';
import { CommentaryFeed } from './CommentaryFeed';
import { PositionChart } from './PositionChart';
import { PhaseBanner } from './PhaseBanner';
import { Countdown } from './Countdown';
import { PlaybackBar } from './PlaybackBar';
import { FinaleSidebar } from './FinaleSidebar';
import { ResultsRecap } from './ResultsRecap';
import { MedalTable } from './olympics/MedalTable';
import { LiveEventBoard } from './olympics/LiveEventBoard';
import { OlympicsResults } from './olympics/OlympicsResults';

export function RaceClient({ slug }: { slug: string }) {
  const { view, error, offsetMs, refresh } = useRaceData(slug);
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

  // The instant the clock crosses the finish, fetch the full payload so the
  // recap doesn't sit on a placeholder until the next scheduled poll.
  const needsFullPayload =
    !!view &&
    !view.snapshot.complete &&
    (virtual ? clock.tMs : Date.now() + offsetMs - startAt) >= durationMs;
  useEffect(() => {
    if (needsFullPayload) {
      void refresh();
      const retry = setInterval(() => void refresh(), 3_000);
      return () => clearInterval(retry);
    }
  }, [needsFullPayload, refresh]);

  if (error === 'not-found') {
    return (
      <main className="race-shell center">
        <h1 className="race-title">No such race</h1>
        <p>
          This link doesn&apos;t match anything. <Link href="/new">Plan a new one?</Link>
        </p>
      </main>
    );
  }
  if (!view) {
    return (
      <main className="race-shell center">
        <p className="loading-line">Contacting the officials…</p>
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
  const finale = !finished && tMs >= snap.pushStartMs;
  const showRecap = finished;

  const onReplay = () => {
    clock.scrubTo(0);
    // Aim for a ~90s replay regardless of the original duration.
    clock.setSpeed(
      Math.min(600, Math.max(1, Math.round(durationMs / 90_000))),
    );
    clock.setPlaying(true);
    setReplaying(true);
  };

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
        snap.theme === 'olympics' ? (
          <OlympicsResults
            snap={snap}
            teamNames={teamNames}
            title={view.config.title}
            onReplay={onReplay}
          />
        ) : (
          <ResultsRecap
            snap={snap}
            jt={journeyThemeFor(snap.theme)}
            teamNames={teamNames}
            title={view.config.title}
            onReplay={onReplay}
          />
        )
      ) : snap.theme === 'olympics' ? (
        <OlympicsView
          snap={snap}
          title={view.config.title}
          teamNames={teamNames}
          tMs={tMs}
          durationMs={durationMs}
          demo={demo}
          finale={finale}
          selected={selected}
          setSelected={setSelected}
        />
      ) : (
        <JourneyView
          snap={snap}
          jt={journeyThemeFor(snap.theme)}
          title={view.config.title}
          teamNames={teamNames}
          tMs={tMs}
          durationMs={durationMs}
          demo={demo}
          finale={finale}
          selected={selected}
          setSelected={setSelected}
        />
      )}

      {virtual && !scheduled && (
        <PlaybackBar
          tMs={tMs}
          durationMs={durationMs}
          pushStartMs={snap.pushStartMs}
          finaleLabel={
            snap.theme === 'olympics'
              ? 'Closing marquee'
              : journeyThemeFor(snap.theme).finaleJumpLabel
          }
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

interface ViewProps<S> {
  snap: S;
  title: string;
  teamNames: string[];
  tMs: number;
  durationMs: number;
  demo: boolean;
  finale: boolean;
  selected: number | null;
  setSelected: (i: number | null) => void;
}

/** Resolve the client vocabulary for a journey theme id. */
function journeyThemeFor(theme: string): JourneyTheme {
  return theme === 'space' ? SPACE_JOURNEY : EVEREST_JOURNEY;
}

/** The map component contract every journey theme's map satisfies. */
export interface JourneyMapProps {
  snap: JourneySnapshot;
  teamNames: string[];
  tMs: number;
  selected: number | null;
  onSelect: (teamIdx: number | null) => void;
  finale: boolean;
}

function journeyMapFor(theme: string): React.ComponentType<JourneyMapProps> {
  return theme === 'space' ? SpaceMap : MountainMap;
}

function JourneyView({
  snap, jt, title, teamNames, tMs, durationMs, demo, finale, selected, setSelected,
}: ViewProps<AnyJourneySnapshot> & { jt: JourneyTheme }) {
  const MapComponent = journeyMapFor(snap.theme);
  const n = teamNames.length;
  const orderAt = useCallback(
    (t: number) => standingsAt(snap, n, t),
    [snap, n],
  );
  const label = jt.phaseLabel(tMs, durationMs);

  return (
    <>
      <header className="race-header">
        <h1 className="race-title-sm">{title}</h1>
        <PhaseBanner tMs={tMs} durationMs={durationMs} demo={demo} label={label} />
      </header>

      <div className="race-grid">
        <section className="map-pane">
          <MapComponent
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
              <FinaleSidebar snap={snap} jt={jt} teamNames={teamNames} tMs={tMs} />
              <CommentaryFeed
                events={snap.events}
                colors={snap.colors}
                tMs={tMs}
                teamNames={teamNames}
                compact
              />
            </>
          ) : (
            <Standings
              snap={snap}
              jt={jt}
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
          <CommentaryFeed
            events={snap.events}
            colors={snap.colors}
            tMs={tMs}
            teamNames={teamNames}
          />
          <PositionChart
            orderAt={orderAt}
            colors={snap.colors}
            teamNames={teamNames}
            tMs={tMs}
            selected={selected}
            onSelect={setSelected}
          />
        </div>
      )}
    </>
  );
}

function OlympicsView({
  snap, title, teamNames, tMs, durationMs, demo, finale, selected, setSelected,
}: ViewProps<OlympicsSnapshot>) {
  const n = teamNames.length;
  const orderAt = useCallback(
    (t: number) => olyStandingsAt(snap, n, t),
    [snap, n],
  );

  return (
    <>
      <header className="race-header">
        <h1 className="race-title-sm">{title}</h1>
        <PhaseBanner
          tMs={tMs}
          durationMs={durationMs}
          demo={demo}
          label={olyPhaseLabel(tMs, durationMs)}
        />
      </header>

      <div className="race-grid">
        <section className="oly-pane">
          <LiveEventBoard
            snap={snap}
            teamNames={teamNames}
            tMs={tMs}
            selected={selected}
            onSelect={setSelected}
            finale={finale}
          />
        </section>
        <aside className="side-pane">
          <MedalTable
            snap={snap}
            teamNames={teamNames}
            tMs={tMs}
            selected={selected}
            onSelect={setSelected}
          />
        </aside>
      </div>

      <div className="race-lower">
        <CommentaryFeed
          events={snap.events}
          colors={snap.colors}
          tMs={tMs}
          teamNames={teamNames}
        />
        <PositionChart
          orderAt={orderAt}
          colors={snap.colors}
          teamNames={teamNames}
          tMs={tMs}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
    </>
  );
}
