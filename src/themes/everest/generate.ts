import { forkRng } from '@/engine/prng';
import { generateCore } from '@/engine/generate';
import { buildDisplayTrack, summitBidStartMs } from './rotations';
import { createTeamMeters, recomputeReadiness, type TeamMeters } from './meters';
import { buildFate, buildTraversals, buildWeather } from './decorate';
import { assignColors, buildSquads } from './names';
import { buildEvents } from './events';
import { SEGMENTS } from './route';
import type { EverestConfig, EverestTimeline } from './types';

/**
 * Everest theme orchestrator.
 *
 * Fairness-critical ordering: generateCore() runs FIRST and reads nothing
 * from team identities — names and colors only influence the decoration
 * streams below, and route risk is read from the display state, so nothing
 * here can provably shift the outcome.
 */
export function generateEverest(
  seedHex: string,
  config: EverestConfig,
): EverestTimeline {
  const nTeams = config.teams.length;
  const { durationMs } = config;

  const core = generateCore(seedHex, { nTeams, durationMs });

  const { colors, colorNames } = assignColors(
    nTeams,
    config.teams.map((t) => t.color),
  );
  const { climbers, cast } = buildSquads(
    forkRng(seedHex, 'cast'),
    nTeams,
    colorNames,
  );

  // Fate comes before the display track so already-scheduled deaths can
  // decorate the choreography (short-handed teams visibly lag). forkRng is
  // order-independent, so this reorder changes neither stream's values —
  // and the coupling only ever runs fate → display, never anything → core.
  const fate = buildFate(
    forkRng(seedHex, 'fate'),
    core,
    durationMs,
    climbers.map((squad) => squad.length),
  );

  const weather = buildWeather(forkRng(seedHex, 'weather'), durationMs);

  // The climb and the squads' condition are ONE simulation, stepped together:
  // the choreography asks each team how much it has left before deciding where
  // that team goes next, and reports back the step it settled on. So the
  // readiness bar is a cause, not a caption — a spent squad sits the storm
  // out, gets turned around short of the height it wanted, drops further to
  // recover, and near the floor stops climbing until rest has bought it
  // something back. (Built after it instead, the number on the card and the
  // behaviour it was supposed to explain drifted apart by up to 99 points.)
  //
  // Readings only ever depend on steps already committed, so there is no
  // circularity — and none of it can touch `core`: the ending was drawn
  // before any of this ran.
  const metersRng = forkRng(seedHex, 'meters');
  const teamMeters: TeamMeters[] = [];
  const choreo = buildDisplayTrack(
    forkRng(seedHex, 'rotations'),
    core,
    durationMs,
    undefined,
    fate.falls,
    weather.storms,
    (team) => {
      const m = createTeamMeters(
        metersRng,
        durationMs,
        core.pushStartMs,
        summitBidStartMs(durationMs),
      );
      teamMeters[team] = m;
      return m;
    },
    fate.wipeouts,
  );
  // Beats stay generation-side (the event layer narrates them); the stored
  // track keeps its lean shape.
  const displayTrack = { tMs: choreo.tMs, pos: choreo.pos };
  const meters = teamMeters.map((m) => m.rows);

  // Route risk is read off the mountain, not off a personality. Both inputs
  // are finished and frozen by now — the display track and the meters share one
  // grid — so a fork can ask what this squad has left and how far behind it is
  // AT THAT INSTANT.
  //
  // This call must stay exactly here: after the meters are integrated and
  // BEFORE buildEvents, which nudges those same meters and is itself built from
  // these traversals. Below buildEvents it would close a real loop
  // (traversals -> events -> meters -> traversals); above, there is nothing to
  // read, since the meters do not exist until the track has been walked.
  const traversals = buildTraversals(
    forkRng(seedHex, 'decor'),
    core,
    displayTrack,
    meters,
  );

  const events = buildEvents({
    rng: forkRng(seedHex, 'events'),
    core,
    durationMs,
    displayTrack,
    meters,
    traversals,
    fate,
    weather,
    beats: choreo.beats,
    climbers,
    cast,
    teamNames: config.teams.map((t) => t.name),
  });

  recomputeReadiness(meters);

  const edgeRisk: EverestTimeline['edgeRisk'] = {};
  for (const seg of SEGMENTS) {
    for (const e of seg.edges) edgeRisk[e.id] = e.risk;
  }

  return {
    version: 1,
    core,
    climbers,
    colors,
    displayTrack,
    meters: { tMs: displayTrack.tMs, values: meters },
    events,
    wipeouts: fate.wipeouts,
    edgeRisk,
    storms: weather.storms,
  };
}
