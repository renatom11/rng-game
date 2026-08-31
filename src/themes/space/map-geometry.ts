import { NODES, SEGMENTS } from './route';
import type { Risk } from './route';

/**
 * SVG geometry for the Mars-run map. Portrait viewBox 0 0 1000 1400 (same
 * frame as the mountain, so the marker/zoom mechanics carry over): Earth
 * bottom-left, Mars top-right, trajectories sweeping between them. Risk
 * shows in the line: risky runs straight and tight, safe takes the wide
 * surveyed arc.
 */

export const VIEW_W = 1000;
export const VIEW_H = 1400;

export const NODE_XY: Record<string, [number, number]> = {
  PAD: [195, 1245],
  LEO: [320, 1105],
  LUNA: [480, 965],
  RELAY: [605, 790],
  CORONA: [665, 615],
  STAGING: [725, 465],
  BRAKE: [795, 345],
  HMO: [845, 255],
  ENTRY: [862, 200],
  MARS: [872, 148],
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

function edgePoints(
  from: [number, number],
  to: [number, number],
  risk: Risk,
  lane: number,
  samples = 36,
): [number, number][] {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;

  const laneAmp = 26;
  const pts: [number, number][] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const bx = x0 + dx * t;
    const by = y0 + dy * smoothstep(t) * 0.1 + dy * t * 0.9;
    const taper = Math.sin(Math.PI * t);
    let off = lane * laneAmp * taper;

    if (risk === 'risky') {
      off += -8 * taper; // the tight direct line
    } else if (risk === 'medium') {
      off += 14 * Math.sin(2 * Math.PI * t) * taper; // a corrected transfer
    } else {
      off += 42 * taper; // the wide surveyed arc
    }

    pts.push([
      Math.round((bx + px * off) * 10) / 10,
      Math.round((by + py * off) * 10) / 10,
    ]);
  }
  return pts;
}

function toPath(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
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

export const DEFAULT_EDGE_BY_SEG: string[] = SEGMENTS.map((seg) => {
  const med = seg.edges.find((e) => e.risk === 'medium');
  return (med ?? seg.edges[0]).id;
});

/** Position a ship marker along its chosen trajectory. */
export function markerXY(
  pos: number,
  edgeIdBySeg: (string | null)[],
): [number, number] {
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
  const geo =
    edgeGeometryById.get(edgeId) ?? edgeGeometryById.get(DEFAULT_EDGE_BY_SEG[segIdx])!;
  const idx = s * (geo.points.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(geo.points.length - 1, lo + 1);
  const f = idx - lo;
  const [x0, y0] = geo.points[lo];
  const [x1, y1] = geo.points[hi];
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
}

/** Deterministic star field (denser than the mountain's — it IS the terrain). */
export const STARS: [number, number, number][] = Array.from({ length: 220 }, (_, i) => {
  const h = (i * 2654435761) >>> 0;
  const x = h % 1000;
  const y = (h >>> 9) % 1400;
  const r = 0.4 + ((h >>> 20) % 10) / 14;
  return [x, y, Math.round(r * 10) / 10];
});
