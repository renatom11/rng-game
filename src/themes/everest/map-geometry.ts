import { NODES, SEGMENTS, type Risk } from './route';

/**
 * SVG geometry for the mountain map. viewBox 0 0 1000 1400 (portrait).
 * Edge polylines are generated programmatically: parallel edges get lane
 * separation, and the line SHAPE communicates risk — risky lines run
 * straight and steep, safe lines switchback.
 */

export const VIEW_W = 1000;
export const VIEW_H = 1400;

export const NODE_XY: Record<string, [number, number]> = {
  BC: [175, 1265],
  C1: [340, 1030],
  C2: [520, 855],
  C3: [645, 640],
  C4: [762, 455],
  BALC: [828, 338],
  SSUM: [884, 232],
  HILL: [912, 180],
  SUMMIT: [936, 118],
};

export interface EdgeGeometry {
  id: string;
  risk: Risk;
  segIdx: number;
  points: [number, number][];
  path: string;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Generate a polyline for an edge with a given lane and risk shape. */
function edgePoints(
  from: [number, number],
  to: [number, number],
  risk: Risk,
  lane: number, // -1, 0, +1 — lateral separation between parallel edges
  samples = 36,
): [number, number][] {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular unit vector.
  const px = -dy / len;
  const py = dx / len;

  const laneAmp = 20;
  const pts: [number, number][] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    // Base point with slight vertical easing so lines feel like terrain.
    const bx = x0 + dx * t;
    const by = y0 + dy * smoothstep(t) * 0.15 + dy * t * 0.85;

    // Lane separation, tapered to zero at the endpoints.
    const taper = Math.sin(Math.PI * t);
    let off = lane * laneAmp * taper;

    // Risk shape.
    if (risk === 'risky') {
      // Direct, slightly bowed into the slope.
      off += -8 * taper;
    } else if (risk === 'medium') {
      // Gentle S.
      off += 8 * Math.sin(2 * Math.PI * t) * taper;
    } else {
      // Switchbacks: visible zigzag, eased at the ends.
      const zig = Math.sin(t * Math.PI * 5);
      off += 14 * zig * taper;
    }

    pts.push([
      Math.round((bx + px * off) * 10) / 10,
      Math.round((by + py * off) * 10) / 10,
    ]);
  }
  return pts;
}

function toPath(points: [number, number][]): string {
  return points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`)
    .join(' ');
}

function buildEdges(): EdgeGeometry[] {
  const out: EdgeGeometry[] = [];
  SEGMENTS.forEach((seg, segIdx) => {
    const from = NODE_XY[seg.from];
    const to = NODE_XY[seg.to];
    const lanes =
      seg.edges.length === 1 ? [0] : seg.edges.length === 2 ? [-1, 1] : [-1, 0, 1];
    seg.edges.forEach((e, i) => {
      const points = edgePoints(from, to, e.risk, lanes[i]);
      out.push({ id: e.id, risk: e.risk, segIdx, points, path: toPath(points) });
    });
  });
  return out;
}

export const EDGE_GEOMETRY: EdgeGeometry[] = buildEdges();
export const edgeGeometryById = new Map(EDGE_GEOMETRY.map((e) => [e.id, e]));

/** Default edge (medium if present) per segment, for teams with no explicit choice. */
export const DEFAULT_EDGE_BY_SEG: string[] = SEGMENTS.map((seg) => {
  const med = seg.edges.find((e) => e.risk === 'medium');
  return (med ?? seg.edges[0]).id;
});

/**
 * Position a team marker: map route-display pos ∈ [0,1] to segment-local
 * progress along the chosen edge's polyline.
 */
export function markerXY(
  pos: number,
  edgeIdBySeg: (string | null)[],
): [number, number] {
  // Find the segment.
  let segIdx = 0;
  for (let i = 0; i < SEGMENTS.length; i++) {
    const toNode = NODES.find((n) => n.id === SEGMENTS[i].to)!;
    if (pos <= toNode.frac + 1e-9) {
      segIdx = i;
      break;
    }
    segIdx = i;
  }
  const fromNode = NODES.find((n) => n.id === SEGMENTS[segIdx].from)!;
  const toNode = NODES.find((n) => n.id === SEGMENTS[segIdx].to)!;
  const s = Math.max(
    0,
    Math.min(1, (pos - fromNode.frac) / (toNode.frac - fromNode.frac || 1)),
  );

  const edgeId = edgeIdBySeg[segIdx] ?? DEFAULT_EDGE_BY_SEG[segIdx];
  const geo = edgeGeometryById.get(edgeId) ?? edgeGeometryById.get(DEFAULT_EDGE_BY_SEG[segIdx])!;
  const idx = s * (geo.points.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(geo.points.length - 1, lo + 1);
  const f = idx - lo;
  const [x0, y0] = geo.points[lo];
  const [x1, y1] = geo.points[hi];
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
}

/** Layered mountain silhouette paths (background → foreground). */
export const SILHOUETTES: { path: string; fill: string }[] = [
  {
    // far ridge
    path: `M0 1400 L0 760 L120 700 L260 780 L420 640 L560 720 L700 560 L840 660 L1000 540 L1000 1400 Z`,
    fill: 'var(--mtn-far, #0b1322)',
  },
  {
    // the mountain itself: a single mass rising to the summit
    path: `M0 1400 L60 1330 L175 1272 L300 1140 L360 1080 L480 930 L540 880 L620 720 L660 655 L740 500 L775 445 L845 320 L890 225 L940 112 L968 190 L1000 330 L1000 1400 Z`,
    fill: 'var(--mtn-main, #101b30)',
  },
  {
    // foreground glacier / icefall tumble
    path: `M0 1400 L0 1330 L90 1305 L200 1330 L330 1290 L470 1330 L620 1300 L780 1345 L1000 1310 L1000 1400 Z`,
    fill: 'var(--mtn-fore, #0d1526)',
  },
];

/** Deterministic star field (no RNG — fixed hash pattern). */
export const STARS: [number, number, number][] = Array.from({ length: 90 }, (_, i) => {
  // unsigned shifts: a signed >> here once produced negative radii
  const h = (i * 2654435761) >>> 0;
  const x = h % 1000;
  const y = (h >>> 10) % 520;
  const r = 0.5 + ((h >>> 20) % 10) / 12;
  return [x, y, Math.round(r * 10) / 10];
});
