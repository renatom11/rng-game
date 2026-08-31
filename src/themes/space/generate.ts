import { forkRng } from '@/engine/prng';
import { generateCore } from '@/engine/generate';
import { buildDisplayTrack } from '@/themes/everest/rotations';
import { buildMeters, recomputeReadiness } from '@/themes/everest/meters';
import { assignStyles, buildFate, buildTraversals } from '@/themes/everest/decorate';
import { assignColors } from '@/themes/everest/names';
import type { EverestConfig, EverestTimeline } from '@/themes/everest/types';
import { buildCrews } from './names';
import { buildSpaceEvents } from './events';
import { NODES, SEGMENTS, canRestockAt, strainAt } from './route';

/**
 * Space Race orchestrator: the journey machinery with the Mars route.
 * Fairness-critical ordering is identical to Everest — generateCore() runs
 * first and reads nothing from team identities.
 *
 * The timeline is structurally an EverestTimeline (the journey shape);
 * only the stored theme id and the words differ.
 */
export function generateSpace(
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
  const { crews, cast } = buildCrews(
    forkRng(seedHex, 'space-cast'),
    nTeams,
    colorNames,
  );

  // Spacecraft loop back to rendezvous, they don't fly home: shallow dips
  // only, resting at the mission waypoints.
  const orbits = buildDisplayTrack(
    forkRng(seedHex, 'space-orbits'),
    core,
    durationMs,
    {
      restFracs: NODES.filter((wp) => wp.frac <= 0.7).map((wp) => wp.frac),
      forceShallow: true,
    },
  );
  // Aborted-approach loops read naturally in space, but the beats and storm
  // machinery are Everest's; the stored track keeps its lean shape.
  const displayTrack = { tMs: orbits.tMs, pos: orbits.pos };

  const fate = buildFate(
    forkRng(seedHex, 'space-fate'),
    core,
    durationMs,
    crews.map((crew) => crew.length),
  );

  // Dark ships freeze where contact was lost.
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
    forkRng(seedHex, 'space-meters'),
    displayTrack,
    durationMs,
    core.pushStartMs,
    { strainAt, canRestockAt },
  );

  const traversals = buildTraversals(
    forkRng(seedHex, 'space-decor'),
    core,
    displayTrack,
    styles,
    {
      segments: SEGMENTS,
      fracById: new Map(NODES.map((wp) => [wp.id, wp.frac])),
    },
  );

  const events = buildSpaceEvents({
    rng: forkRng(seedHex, 'space-events'),
    core,
    durationMs,
    displayTrack,
    meters,
    traversals,
    fate,
    crews,
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
    climbers: crews,
    styles,
    colors,
    displayTrack,
    meters: { tMs: displayTrack.tMs, values: meters },
    events,
    wipeouts: fate.wipeouts,
    edgeRisk,
  };
}
