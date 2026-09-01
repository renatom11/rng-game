import type { CoreTimeline } from '@/engine/types';
import type { RNG } from '@/engine/prng';
import { randInt, weightedPick } from '@/engine/prng';
import { NODES, SEGMENTS, type RouteEdge, type RouteSegment } from './route';
import { METER_INDEX } from './meters';

/** Route shape for traversal detection, reusable by other journey themes. */
export interface TraversalRoute {
  segments: RouteSegment[];
  fracById: Map<string, number>;
}

const EVEREST_TRAVERSAL_ROUTE: TraversalRoute = {
  segments: SEGMENTS,
  fracById: new Map(NODES.map((n) => [n.id, n.frac])),
};

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
  /**
   * Appetite for the dangerous line when the call was made, 0..1. Recorded so
   * the narration and the tests can see WHY a line was taken.
   */
  appetite: number;
}

/** Meter rows on the display grid: [team][meterIdx][step]. */
export type MeterRows = number[][][];

/**
 * Condition bands on the readiness scale, mirroring the choreography's own
 * brake so the fork and the climb can never contradict each other: at
 * BRAKE_STOP a squad has stopped climbing at all, and by RISK_FREE it is fit
 * enough to pick a line for speed rather than for survival.
 */
const BRAKE_STOP = 12;
const RISK_FREE = 88;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const clamp11 = (x: number) => Math.max(-1, Math.min(1, x));

/**
 * Condition on the 0-100 readiness scale, pulled toward raw energy because
 * "have they got the legs for this line" is the question a fork actually
 * asks. Callers with no meters read an even 55 and the fork becomes a purely
 * positional call.
 */
function conditionAt(meters: MeterRows | undefined, team: number, i: number): number {
  const rows = meters?.[team];
  const ready = rows?.[METER_INDEX.READY]?.[i];
  const energy = rows?.[METER_INDEX.ENERGY]?.[i];
  if (ready === undefined || energy === undefined) return 55;
  return 0.6 * ready + 0.4 * energy;
}

function spreadStats(vals: number[], minSpread: number): { mean: number; spread: number } {
  let sum = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of vals) {
    sum += v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { mean: sum / vals.length, spread: Math.max(minSpread, hi - lo) };
}

/** What a squad can see about itself and the field at one grid step. */
interface FieldRead {
  /** +1 = at the back of the field, 0 = mid-pack, -1 = way out front. */
  gap: number;
  /** 0 = nothing left, 1 = fit to gamble. */
  strength: number;
}

function readField(
  pos: number[][],
  meters: MeterRows | undefined,
  team: number,
  i: number,
): FieldRead {
  const n = pos.length;
  const posVals = new Array<number>(n);
  const condVals = new Array<number>(n);
  for (let t = 0; t < n; t++) {
    posVals[t] = pos[t][i];
    condVals[t] = conditionAt(meters, t, i);
  }
  // Normalised by how spread THIS field is: the read is "behind the pack",
  // not "behind by 0.07 of a mountain".
  const p = spreadStats(posVals, 0.05);
  const gap = clamp11(((p.mean - posVals[team]) / p.spread) * 2);
  // The absolute read says whether they CAN gamble, on the same band the
  // choreography brakes in; the relative read says whether they are the one
  // in shape to. Keeping a relative term means the hard lines never vanish
  // if the meter tuning as a whole ever moves.
  const c = spreadStats(condVals, 8);
  const abs = clamp01((condVals[team] - BRAKE_STOP) / (RISK_FREE - BRAKE_STOP));
  const rel = clamp11(((condVals[team] - c.mean) / c.spread) * 2);
  return { gap, strength: clamp01(0.65 * abs + 0.35 * (0.5 + 0.5 * rel)) };
}

/**
 * Appetite for the dangerous line, 0..1 — the whole rule in one expression:
 *
 *   behind AND something left  -> go for it. Being behind only buys the
 *     appetite a squad has the condition to spend, which is what makes
 *     "chasing, and still strong" the one state that really gambles.
 *   behind and spent -> take the safe line, rest, and come back for the hard
 *     one at the next fork once the rest has bought something back.
 *   way ahead and spent -> protect it; the safest line on offer.
 *   ahead but strong -> the standard line, the risky one still live.
 */
export function riskAppetite({ gap, strength }: FieldRead): number {
  const behind = Math.max(0, gap);
  const ahead = Math.max(0, -gap);
  return clamp01(
    0.16 + 0.5 * strength + 0.42 * behind * strength - 0.34 * ahead * (1 - 0.5 * strength),
  );
}

/** Appetite -> weights over whatever grades this segment actually offers. */
function edgeWeights(edges: RouteEdge[], a: number): number[] {
  return edges.map((e) =>
    e.risk === 'risky'
      ? 0.12 + 3.6 * a * a
      : e.risk === 'safe'
        ? 0.12 + 3.6 * (1 - a) * (1 - a)
        : 1.15 + 0.85 * (1 - Math.abs(2 * a - 1)),
  );
}

/** Rank of a team in a standings order array (1-based). */
function rankIn(order: number[], teamIdx: number): number {
  return order.indexOf(teamIdx) + 1;
}

/**
 * Detect upward segment entries from the display track and choose an edge for
 * each from the squad's OWN STATE at that instant: what it has left (its
 * meters, on this same grid) and how far behind the field it is (the display
 * positions, on this same grid). No personality, no dial, and no look-ahead.
 *
 * The rank move across the stretch is still RECORDED, but only so the event
 * layer can narrate the payoff or the punishment after the fact. It used to
 * DRIVE the choice, which read the standings from the checkpoint AFTER the
 * fork — so "took the risky line" was a weak forward signal of a rank gain
 * sitting in a payload served at the moment of the fork.
 */
export function buildTraversals(
  rng: RNG,
  core: CoreTimeline,
  displayTrack: { tMs: number[]; pos: number[][] },
  meters?: MeterRows,
  route: TraversalRoute = EVEREST_TRAVERSAL_ROUTE,
): Traversal[] {
  const nTeams = displayTrack.pos.length;
  const SEGS = route.segments;
  const out: Traversal[] = [];

  for (let team = 0; team < nTeams; team++) {
    const row = displayTrack.pos[team];
    for (let s = 0; s < SEGS.length; s++) {
      const fromFrac = route.fracById.get(SEGS[s].from)!;
      // Find each upward crossing of the segment start.
      for (let i = 1; i < row.length; i++) {
        if (!(row[i - 1] <= fromFrac + 1e-9 && row[i] > fromFrac + 1e-9)) continue;
        const tMs = displayTrack.tMs[i];

        // Recorded for the event layer only. The CHOICE below never sees it.
        const before = lastCheckpointBefore(core, tMs);
        const after = nextCheckpointAfter(core, tMs);
        let rankDelta = 0;
        if (before && after) {
          rankDelta = rankIn(after.order, team) - rankIn(before.order, team);
        }

        const edges = SEGS[s].edges;
        let edge: RouteEdge;
        let appetite = 0.5;
        if (edges.length === 1) {
          edge = edges[0];
        } else {
          appetite = riskAppetite(readField(displayTrack.pos, meters, team, i));
          // The WEIGHTS are the squad's state; the draw stays stochastic so two
          // identical situations do not always produce the identical line.
          edge = weightedPick(rng, edges, edgeWeights(edges, appetite));
        }
        out.push({ teamIdx: team, segIdx: s, edge, tMs, rankDelta, appetite });
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
  /** individual climber deaths: teamIdx -> times (climber identities and causes assigned later). */
  falls: { teamIdx: number; tMs: number; zone?: 'icefall' | 'mid' | 'push' }[];
  injuries: { teamIdx: number; tMs: number }[];
  turnedBack: { teamIdx: number; tMs: number }[];
}

/** Storm windows: narrative weather used for death-cause flavor and ambient
 * lines. Never serialized — generation-side only. */
export interface WeatherPlan {
  storms: { startMs: number; endMs: number }[];
}

export function buildWeather(rng: RNG, durationMs: number): WeatherPlan {
  const nStorms = durationMs < 7_200_000 ? randInt(rng, 1, 2) : randInt(rng, 2, 3);
  const storms: WeatherPlan['storms'] = [];
  for (let k = 0; k < nStorms; k++) {
    const len = durationMs * (0.04 + rng() * 0.04);
    let placed = false;
    for (let attempt = 0; attempt < 12 && !placed; attempt++) {
      const start = durationMs * (0.15 + rng() * 0.75 * (1 - len / durationMs));
      const end = start + len;
      if (storms.every((s) => end < s.startMs - durationMs * 0.03 || start > s.endMs + durationMs * 0.03)) {
        storms.push({ startMs: Math.round(start), endMs: Math.round(end) });
        placed = true;
      }
    }
  }
  storms.sort((a, b) => a.startMs - b.startMs);
  return { storms };
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

  // Wipe count: only with enough teams that "last place = lost on the
  // mountain" doesn't dominate small races. Brutal tuning: a quarter of
  // races lose an expedition whole.
  const r = rng();
  let wipeCount = 0;
  if (nTeams >= 4 && r < 0.25) wipeCount = 1;
  if (nTeams >= 6 && r < 0.08) wipeCount = 2;

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
        // Foreshadowing falls draw from EXACTLY the same pre-push time
        // windows as everyone else's falls. A distinct window here once
        // created a spoiler side channel: any fall in the wiped-only band
        // identified its team as the last-place finisher hours early.
        const zone = rng();
        const zoneName = zone < 0.58 ? 'icefall' : 'mid';
        const t =
          zoneName === 'icefall'
            ? durationMs * (0.04 + rng() * 0.2)
            : durationMs * (0.35 + rng() * 0.3);
        falls.push({ teamIdx: team, tMs: Math.round(t), zone: zoneName });
      }
      continue;
    }
    // Non-wiped teams: brutal — most squads bleed, and the lone-survivor
    // summit (everyone else gone, one climber carries the flag up) is a
    // recurring legend rather than a rarity. At least one climber always
    // remains to finish.
    let maxFalls = Math.max(0, size - 2);
    if (rng() < 0.25) maxFalls = size - 1;
    const nFalls = weightedPick(rng, [0, 1, 2, 3], [0.15, 0.4, 0.3, 0.15]);
    const actual = Math.min(nFalls, maxFalls);
    for (let f = 0; f < actual; f++) {
      // Falls cluster where it's dangerous: icefall early, faces late.
      const zone = rng();
      const zoneName = zone < 0.35 ? 'icefall' : zone < 0.6 ? 'mid' : 'push';
      const t =
        zone < 0.35
          ? durationMs * (0.04 + rng() * 0.2)
          : zone < 0.6
            ? durationMs * (0.35 + rng() * 0.3)
            : core.pushStartMs + rng() * (core.summitTimesMs[team] - core.pushStartMs) * 0.8;
      falls.push({ teamIdx: team, tMs: Math.round(t), zone: zoneName });
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
