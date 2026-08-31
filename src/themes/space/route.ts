/**
 * The Mars run: a chain of waypoints with parallel risk-graded trajectories.
 * Same `frac` semantics as the Everest route (0 = launch pad, 1 = Mars
 * surface), so the journey machinery — display track, traversals, marker
 * math — works unchanged.
 *
 * `alt` here is distance flown in thousands of km (Mars at opposition,
 * cinematic license): the UI formats it as "xx.xM km".
 */

import type { Risk, RouteEdge, RouteSegment } from '@/themes/everest/route';

export interface SpaceNode {
  id: string;
  label: string;
  /** thousands of km flown */
  alt: number;
  frac: number;
}

const MARS_KKM = 78_340; // ~78.34M km, a close opposition

function kkmAt(frac: number): number {
  return Math.round(MARS_KKM * frac);
}

export const NODES: SpaceNode[] = [
  { id: 'PAD', label: 'Launch Complex', alt: 0, frac: 0.0 },
  { id: 'LEO', label: 'Low Earth Orbit', alt: kkmAt(0.14), frac: 0.14 },
  { id: 'LUNA', label: 'Lunar Slingshot', alt: kkmAt(0.3), frac: 0.3 },
  { id: 'RELAY', label: 'Deep Space Relay', alt: kkmAt(0.5), frac: 0.5 },
  { id: 'CORONA', label: 'Solar Corridor', alt: kkmAt(0.62), frac: 0.62 },
  { id: 'STAGING', label: 'Mars Approach Staging', alt: kkmAt(0.7), frac: 0.7 },
  { id: 'BRAKE', label: 'Braking Ellipse', alt: kkmAt(0.82), frac: 0.82 },
  { id: 'HMO', label: 'High Mars Orbit', alt: kkmAt(0.92), frac: 0.92 },
  { id: 'ENTRY', label: 'Entry Interface', alt: kkmAt(0.96), frac: 0.96 },
  { id: 'MARS', label: 'Touchdown', alt: MARS_KKM, frac: 1.0 },
];

export const SEGMENTS: RouteSegment[] = [
  {
    from: 'PAD',
    to: 'LEO',
    edges: [
      { id: 'ascent-nominal', risk: 'medium', label: 'the nominal ascent profile' },
      { id: 'ascent-hot', risk: 'risky', label: 'a hot full-throttle ascent' },
      { id: 'ascent-gentle', risk: 'safe', label: 'the long shallow ascent' },
    ],
  },
  {
    from: 'LEO',
    to: 'LUNA',
    edges: [
      { id: 'tli-direct', risk: 'medium', label: 'the direct trans-lunar injection' },
      { id: 'tli-tight', risk: 'risky', label: 'a razor-thin slingshot over the lunar farside' },
    ],
  },
  {
    from: 'LUNA',
    to: 'RELAY',
    edges: [
      { id: 'cruise-lane', risk: 'safe', label: 'the surveyed cruise lane' },
      { id: 'cruise-cutoff', risk: 'risky', label: 'the debris-field shortcut' },
    ],
  },
  {
    from: 'RELAY',
    to: 'CORONA',
    edges: [
      { id: 'corridor-shielded', risk: 'safe', label: 'the shielded outer corridor' },
      { id: 'corridor-solar', risk: 'risky', label: 'the solar-storm corridor, straight through' },
      { id: 'corridor-middle', risk: 'medium', label: 'the middle transit lane' },
    ],
  },
  {
    from: 'CORONA',
    to: 'STAGING',
    edges: [
      { id: 'approach-ballistic', risk: 'medium', label: 'the ballistic approach' },
      { id: 'approach-burn', risk: 'risky', label: 'a fuel-hungry constant burn' },
    ],
  },
  {
    from: 'STAGING',
    to: 'BRAKE',
    edges: [
      { id: 'brake-aerocapture', risk: 'risky', label: 'a single-pass aerocapture' },
      { id: 'brake-retro', risk: 'safe', label: 'the long retro-burn series' },
    ],
  },
  {
    from: 'BRAKE',
    to: 'HMO',
    edges: [
      { id: 'orbit-spiral', risk: 'medium', label: 'the descending spiral' },
      { id: 'orbit-plunge', risk: 'risky', label: 'the steep orbital plunge' },
    ],
  },
  {
    from: 'HMO',
    to: 'ENTRY',
    edges: [{ id: 'entry-window', risk: 'medium', label: 'the entry window' }],
  },
  {
    from: 'ENTRY',
    to: 'MARS',
    edges: [{ id: 'final-descent', risk: 'medium', label: 'the powered final descent' }],
  },
];

export type { Risk, RouteEdge, RouteSegment };

export const nodeById = new Map(NODES.map((n) => [n.id, n]));

/** Distance flown at display position pos, in thousands of km. */
export function distanceKkmAt(pos: number): number {
  return Math.round(MARS_KKM * Math.max(0, Math.min(1, pos)));
}

/** Format a display position as a distance label, e.g. "42.3M km". */
export function distanceLabel(pos: number): string {
  const mkm = (distanceKkmAt(pos) / 1000);
  return `${mkm.toFixed(1)}M km`;
}

/** Nearest waypoint at or below pos (the last checkpoint passed). */
export function nodeAtOrBelow(pos: number): SpaceNode {
  let best = NODES[0];
  for (const n of NODES) {
    if (n.frac <= pos + 1e-9) best = n;
    else break;
  }
  return best;
}

/**
 * Strain scale for the shared meter dynamics: maps route position onto the
 * Everest-altitude range the drain math is calibrated to. Deep space is
 * "high altitude" — far from resupply, everything rationed.
 */
export function strainAt(pos: number): number {
  return Math.round(5364 + (8849 - 5364) * Math.max(0, Math.min(1, pos)));
}

/** Resupply drones only operate in near-Earth space. */
export function canRestockAt(pos: number): boolean {
  return pos < 0.52;
}
