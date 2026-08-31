import { forkRng } from '@/engine/prng';
import { generateCore } from '@/engine/generate';
import { buildDisplayTrack } from './rotations';
import { buildMeters, recomputeReadiness } from './meters';
import { assignStyles, buildFate, buildTraversals, buildWeather } from './decorate';
import { assignColors, buildSquads } from './names';
import { buildEvents } from './events';
import { SEGMENTS } from './route';
import type { EverestConfig, EverestTimeline } from './types';

/**
 * Everest theme orchestrator.
 *
 * Fairness-critical ordering: generateCore() runs FIRST and reads nothing
 * from team identities — names, colors, and styles only influence the
 * decoration streams below, so they provably cannot shift the outcome.
 */
export function generateEverest(
  seedHex: string,
  config: EverestConfig,
): EverestTimeline {
  const nTeams = config.teams.length;
  const { durationMs } = config;

  const core = generateCore(seedHex, { nTeams, durationMs });

  const styles = assignStyles(
    forkRng(seedHex, 'styles'),
    nTeams,
    config.teams.map((t) => t.style),
  );
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

  const displayTrack = buildDisplayTrack(
    forkRng(seedHex, 'rotations'),
    core,
    durationMs,
    undefined,
    fate.falls,
  );

  // Freeze wiped teams where they were lost: the mountain keeps them.
  for (const w of fate.wipeouts) {
    const row = displayTrack.pos[w.teamIdx];
    let frozen: number | null = null;
    for (let i = 0; i < displayTrack.tMs.length; i++) {
      if (displayTrack.tMs[i] >= w.tMs) {
        if (frozen === null) frozen = row[Math.max(0, i - 1)];
        row[i] = frozen;
      }
    }
  }

  const meters = buildMeters(
    forkRng(seedHex, 'meters'),
    displayTrack,
    durationMs,
    core.pushStartMs,
  );

  const traversals = buildTraversals(
    forkRng(seedHex, 'decor'),
    core,
    displayTrack,
    styles,
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
    styles,
    colors,
    displayTrack,
    meters: { tMs: displayTrack.tMs, values: meters },
    events,
    wipeouts: fate.wipeouts,
    edgeRisk,
  };
}
