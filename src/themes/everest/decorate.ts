import type { CoreTimeline } from '@/engine/types';
import type { RNG } from '@/engine/prng';
import { randInt, weightedPick } from '@/engine/prng';
import { NODES, SEGMENTS, type RouteEdge } from './route';
import type { Style } from './types';

/**
 * Narrative decoration: route choices, individual falls, team wipeouts.
 * Everything here is generated AFTER the core outcome is fixed and reads
 * only its own RNG streams — it explains the story, it never writes it.
 */

export interface Traversal {
  teamIdx: number;
  segIdx: number;
  edge: RouteEdge;
  tMs: number; // when the team committed to the segment (upward crossing)
  /** rank delta across this stretch: negative = gained places */
  rankDelta: number;
}

export function assignStyles(
  rng: RNG,
  nTeams: number,
  given: (Style | undefined)[],
): Style[] {
  const styles: Style[] = [];
  for (let i = 0; i < nTeams; i++) {
    styles.push(
      given[i] ??
        weightedPick(rng, ['bold', 'balanced', 'cautious'] as const, [0.3, 0.4, 0.3]),
    );
  }
  return styles;
}

const STYLE_BIAS: Record<Style, Record<string, number>> = {
  bold: { risky: 2.2, medium: 1, safe: 0.5 },
  balanced: { risky: 1, medium: 1.6, safe: 1 },
  cautious: { risky: 0.45, medium: 1, safe: 2.2 },
};

/** Rank of a team in a standings order array (1-based). */
function rankIn(order: number[], teamIdx: number): number {
  return order.indexOf(teamIdx) + 1;
}

/**
 * Detect upward segment entries from the display track and choose an edge
 * for each, correlated with the team's rank move around that stretch so the
 * story reads causally (risky + big gain = payoff, risky + big loss = punished).
 */
export function buildTraversals(
  rng: RNG,
  core: CoreTimeline,
  displayTrack: { tMs: number[]; pos: number[][] },
  styles: Style[],
): Traversal[] {
  const nTeams = displayTrack.pos.length;
  const out: Traversal[] = [];
  const moveThresh = Math.max(2, Math.round(nTeams / 6));

  for (let team = 0; team < nTeams; team++) {
    const row = displayTrack.pos[team];
    for (let s = 0; s < SEGMENTS.length; s++) {
      const fromFrac = NODES.find((n) => n.id === SEGMENTS[s].from)!.frac;
      // Find each upward crossing of the segment start.
      for (let i = 1; i < row.length; i++) {
        if (!(row[i - 1] <= fromFrac + 1e-9 && row[i] > fromFrac + 1e-9)) continue;
        const tMs = displayTrack.tMs[i];

        // Rank move across the surrounding stretch, from checkpoint standings.
        const before = lastCheckpointBefore(core, tMs);
        const after = nextCheckpointAfter(core, tMs);
        let rankDelta = 0;
        if (before && after) {
          rankDelta = rankIn(after.order, team) - rankIn(before.order, team);
        }

        const edges = SEGMENTS[s].edges;
        let edge: RouteEdge;
        if (edges.length === 1) {
          edge = edges[0];
        } else {
          const bias = STYLE_BIAS[styles[team]];
          let weights: number[];
          if (rankDelta <= -moveThresh) {
            weights = edges.map((e) => ({ risky: 3, medium: 1, safe: 0.3 })[e.risk] * bias[e.risk]);
          } else if (rankDelta >= moveThresh) {
            const gamble = rng() < (styles[team] === 'bold' ? 0.7 : styles[team] === 'cautious' ? 0.3 : 0.5);
            weights = gamble
              ? edges.map((e) => ({ risky: 4, medium: 0.8, safe: 0.2 })[e.risk] * bias[e.risk])
              : edges.map((e) => ({ risky: 0.2, medium: 0.9, safe: 3 })[e.risk] * bias[e.risk]);
          } else {
            weights = edges.map((e) => ({ risky: 1, medium: 2, safe: 1 })[e.risk] * bias[e.risk]);
          }
          edge = weightedPick(rng, edges, weights);
        }
        out.push({ teamIdx: team, segIdx: s, edge, tMs, rankDelta });
      }
    }
  }
  out.sort((a, b) => a.tMs - b.tMs || a.teamIdx - b.teamIdx || a.segIdx - b.segIdx);
  // One display step can cross several segment boundaries in a short race —
  // a team must not "commit" to three forks simultaneously. Keep only the
  // highest segment per (team, instant).
  const deduped: Traversal[] = [];
  for (const tr of out) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.teamIdx === tr.teamIdx && prev.tMs === tr.tMs) {
      deduped[deduped.length - 1] = tr; // later sort order = higher segIdx
    } else {
      deduped.push(tr);
    }
  }
  return deduped;
}

function lastCheckpointBefore(core: CoreTimeline, tMs: number) {
  let best = null;
  for (const cp of core.checkpoints) {
    if (cp.tMs <= tMs) best = cp;
    else break;
  }
  return best;
}

function nextCheckpointAfter(core: CoreTimeline, tMs: number) {
  for (const cp of core.checkpoints) {
    if (cp.tMs > tMs) return cp;
  }
  return core.checkpoints[core.checkpoints.length - 1] ?? null;
}

export interface FatePlan {
  /** teams losing their entire squad, with when. Bottom placements only. */
  wipeouts: { teamIdx: number; tMs: number }[];
  /** individual climber falls: teamIdx -> times (climber indices assigned later). */
  falls: { teamIdx: number; tMs: number }[];
  injuries: { teamIdx: number; tMs: number }[];
  turnedBack: { teamIdx: number; tMs: number }[];
}

/**
 * Falls and wipeouts. Individual falls can hit anyone at any time — they
 * never lock a placement. Full wipeouts are only ever assigned to the
 * bottom-most placements and only in the push window BEFORE summits start,
 * with the lower placement wiping earlier (consistent with the ordering).
 */
export function buildFate(
  rng: RNG,
  core: CoreTimeline,
  durationMs: number,
  squadSizes: number[],
): FatePlan {
  const nTeams = squadSizes.length;
  const wipeouts: FatePlan['wipeouts'] = [];
  const falls: FatePlan['falls'] = [];
  const injuries: FatePlan['injuries'] = [];
  const turnedBack: FatePlan['turnedBack'] = [];

  // Wipe count: rare, and only with enough teams that "last place = lost on
  // the mountain" doesn't dominate small races.
  const r = rng();
  let wipeCount = 0;
  if (nTeams >= 4 && r < 0.1) wipeCount = 1;
  if (nTeams >= 6 && r < 0.02) wipeCount = 2;

  const firstSummit = Math.min(...core.summitTimesMs);
  for (let k = 0; k < wipeCount; k++) {
    const teamIdx = core.finalOrder[nTeams - 1 - k]; // bottom placements
    const lo = core.pushStartMs + (0.15 + 0.25 * k) * (firstSummit - core.pushStartMs);
    const hi = core.pushStartMs + (0.35 + 0.25 * k) * (firstSummit - core.pushStartMs);
    wipeouts.push({ teamIdx, tMs: Math.round(lo + rng() * (hi - lo)) });
  }
  const wipedSet = new Map(wipeouts.map((w) => [w.teamIdx, w.tMs]));

  for (let team = 0; team < nTeams; team++) {
    const size = squadSizes[team];
    const wipeAt = wipedSet.get(team);
    if (wipeAt !== undefined) {
      // 1–2 falls foreshadow the wipeout; the rest are lost at the wipe.
      const pre = randInt(rng, 1, Math.min(2, size - 1));
      for (let f = 0; f < pre; f++) {
        // Foreshadowing falls land well before the wipeout itself.
        const t = core.pushStartMs * (0.55 + 0.4 * rng());
        falls.push({ teamIdx: team, tMs: Math.round(t) });
      }
      continue;
    }
    // Non-wiped teams: falls are dramatic but leave at least 2 climbing
    // (or 1, rarely — the lone-survivor summit is legendary).
    let maxFalls = Math.max(0, size - 2);
    if (rng() < 0.08) maxFalls = size - 1;
    const nFalls = weightedPick(rng, [0, 1, 2], [0.52, 0.36, 0.12]);
    const actual = Math.min(nFalls, maxFalls);
    for (let f = 0; f < actual; f++) {
      // Falls cluster where it's dangerous: icefall early, faces late.
      const zone = rng();
      const t =
        zone < 0.35
          ? durationMs * (0.04 + rng() * 0.2)
          : zone < 0.6
            ? durationMs * (0.35 + rng() * 0.3)
            : core.pushStartMs + rng() * (core.summitTimesMs[team] - core.pushStartMs) * 0.8;
      falls.push({ teamIdx: team, tMs: Math.round(t) });
    }
    if (rng() < 0.35) {
      injuries.push({ teamIdx: team, tMs: Math.round(durationMs * (0.15 + rng() * 0.6)) });
    }
    if (rng() < 0.22) {
      turnedBack.push({ teamIdx: team, tMs: Math.round(durationMs * (0.45 + rng() * 0.35)) });
    }
  }

  falls.sort((a, b) => a.tMs - b.tMs);
  return { wipeouts, falls, injuries, turnedBack };
}
