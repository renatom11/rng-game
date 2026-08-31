/**
 * The Everest route: a chain of waypoints with parallel risk-graded edges.
 * `frac` is route-display space (where a node sits along the full route,
 * 0 = Base Camp, 1 = Summit). The engine's scalar p maps onto this space
 * via the display track (rotations pre-push, the race line during the push).
 */

export type Risk = 'safe' | 'medium' | 'risky';

export interface RouteNode {
  id: string;
  label: string;
  alt: number; // metres
  frac: number; // position along the route, 0..1
}

export interface RouteEdge {
  id: string;
  risk: Risk;
  label: string; // reads naturally after "takes/commits to", e.g. "the direct line through the seracs"
}

export interface RouteSegment {
  from: string;
  to: string;
  edges: RouteEdge[];
}

export const NODES: RouteNode[] = [
  { id: 'BC', label: 'Base Camp', alt: 5364, frac: 0.0 },
  { id: 'C1', label: 'Camp I', alt: 6065, frac: 0.16 },
  { id: 'C2', label: 'Camp II', alt: 6400, frac: 0.32 },
  { id: 'C3', label: 'Camp III', alt: 7160, frac: 0.52 },
  { id: 'C4', label: 'Camp IV', alt: 7950, frac: 0.7 },
  { id: 'BALC', label: 'The Balcony', alt: 8400, frac: 0.82 },
  { id: 'SSUM', label: 'South Summit', alt: 8749, frac: 0.92 },
  { id: 'HILL', label: 'Hillary Step', alt: 8790, frac: 0.96 },
  { id: 'SUMMIT', label: 'Summit', alt: 8849, frac: 1.0 },
];

export const SEGMENTS: RouteSegment[] = [
  {
    from: 'BC',
    to: 'C1',
    edges: [
      { id: 'icefall-ladders', risk: 'medium', label: 'the fixed ladders through the Khumbu Icefall' },
      { id: 'icefall-direct', risk: 'risky', label: 'the direct line under the seracs' },
      { id: 'icefall-flagged', risk: 'safe', label: 'the long flagged line, far right of the Icefall' },
    ],
  },
  {
    from: 'C1',
    to: 'C2',
    edges: [
      { id: 'cwm-centre', risk: 'medium', label: 'the centre of the Western Cwm' },
      { id: 'cwm-wall', risk: 'risky', label: 'the shaded line under the Nuptse wall' },
    ],
  },
  {
    from: 'C2',
    to: 'C3',
    edges: [
      { id: 'face-ropes', risk: 'safe', label: 'the fixed ropes on the Lhotse Face' },
      { id: 'face-direct', risk: 'risky', label: 'the bare ice line up the Face' },
    ],
  },
  {
    from: 'C3',
    to: 'C4',
    edges: [
      { id: 'geneva-spur', risk: 'medium', label: 'the Geneva Spur traverse' },
      { id: 'yellow-band', risk: 'risky', label: 'the Yellow Band direct' },
      { id: 'long-traverse', risk: 'safe', label: 'the low traverse to the Col' },
    ],
  },
  {
    from: 'C4',
    to: 'BALC',
    edges: [
      { id: 'triangle-face', risk: 'safe', label: 'the Triangular Face trail' },
      { id: 'couloir', risk: 'risky', label: 'the couloir direct' },
    ],
  },
  {
    from: 'BALC',
    to: 'SSUM',
    edges: [
      { id: 'se-ridge', risk: 'medium', label: 'the Southeast Ridge proper' },
      { id: 'cornice', risk: 'risky', label: 'the traverse under the cornice' },
    ],
  },
  {
    from: 'SSUM',
    to: 'HILL',
    edges: [{ id: 'knife-ridge', risk: 'medium', label: 'the knife-edge ridge' }],
  },
  {
    from: 'HILL',
    to: 'SUMMIT',
    edges: [{ id: 'final-slope', risk: 'medium', label: 'the final snow slope' }],
  },
];

export const nodeById = new Map(NODES.map((n) => [n.id, n]));
export const nodeIndexById = new Map(NODES.map((n, i) => [n.id, i]));

/** Find the segment index containing route-display position pos ∈ [0,1]. */
export function segmentAt(pos: number): number {
  for (let i = 0; i < SEGMENTS.length; i++) {
    const to = nodeById.get(SEGMENTS[i].to)!;
    if (pos <= to.frac) return i;
  }
  return SEGMENTS.length - 1;
}

/** Altitude in metres at route-display position pos. */
export function altitudeAt(pos: number): number {
  for (let i = 1; i < NODES.length; i++) {
    if (pos <= NODES[i].frac) {
      const a = NODES[i - 1];
      const b = NODES[i];
      const f = (pos - a.frac) / (b.frac - a.frac || 1);
      return Math.round(a.alt + f * (b.alt - a.alt));
    }
  }
  return NODES[NODES.length - 1].alt;
}

/** Nearest node at or below pos (the camp a climber last left). */
export function nodeAtOrBelow(pos: number): RouteNode {
  let best = NODES[0];
  for (const n of NODES) {
    if (n.frac <= pos + 1e-9) best = n;
    else break;
  }
  return best;
}
