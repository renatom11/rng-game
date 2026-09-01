/**
 * The mountain in space: pure geometry + math for the 3D expedition view.
 * No three.js imports here — everything returns plain arrays and numbers so
 * it stays unit-testable and the renderer stays a thin consumer.
 *
 * World space: +X east, +Y up (meters), +Z south. The South Col route runs
 * from Base Camp in the southwest, up the Icefall, east along the Western
 * Cwm, up the Lhotse Face, over the Geneva Spur to the South Col, and up
 * the Southeast Ridge to the summit. The Everest–Lhotse–Nuptse horseshoe
 * encloses the Cwm, and the West Shoulder genuinely blocks the summit from
 * Base Camp — the goal is not visible from the lowest camera.
 *
 * Fairness note: everything here is decoration over already-served data.
 * Positions come from displayPosAt, light from (elapsed/duration, storm).
 */

import { NODES } from './route';

// ---------------------------------------------------------------------------
// Route waypoints in 3D (x, alt, z). Fracs come from the shared route model
// so the 3D mountain, the 2D profile, and the commentary always agree.
// ---------------------------------------------------------------------------

export const WP3: Record<string, [number, number, number]> = {
  BC: [-3600, 5364, 2600],
  C1: [-2350, 6065, 2350],
  C2: [-700, 6400, 2050],
  C3: [150, 7160, 1800],
  C4: [380, 7950, 1050],
  BALC: [240, 8400, 700],
  SSUM: [120, 8749, 380],
  HILL: [80, 8790, 260],
  SUMMIT: [0, 8849, 100],
};

export const WP_FRAC: Record<string, number> = Object.fromEntries(
  NODES.map((n) => [n.id, n.frac]),
);

/** Horizontal shape points per leg (x, z) — altitudes are interpolated. */
const LEG_SHAPES: Record<string, [number, number][]> = {
  // Khumbu Icefall: a thread that switches back constantly.
  'BC-C1': [
    [-3600, 2600], [-3390, 2515], [-3195, 2575], [-2990, 2465],
    [-2830, 2540], [-2650, 2430], [-2495, 2475], [-2350, 2350],
  ],
  // Western Cwm: broad, nearly flat, and it bends.
  'C1-C2': [
    [-2350, 2350], [-1930, 2290], [-1480, 2270], [-1040, 2150], [-700, 2050],
  ],
  // Lower Lhotse Face, climbed diagonally.
  'C2-C3': [[-700, 2050], [-340, 1975], [-60, 1895], [150, 1800]],
  // Upper face: Yellow Band, then the Geneva Spur, then the Col.
  'C3-C4': [[150, 1800], [285, 1615], [345, 1465], [425, 1295], [380, 1050]],
  // Triangular Face above the Col — climbed in the dark.
  'C4-BALC': [[380, 1050], [325, 895], [240, 700]],
  // Southeast Ridge.
  'BALC-SSUM': [[240, 700], [185, 545], [120, 380]],
  // Cornice Traverse: a knife-edge, single file.
  'SSUM-HILL': [[120, 380], [98, 318], [80, 260]],
  'HILL-SUMMIT': [[80, 260], [38, 178], [0, 100]],
};

const LEG_ORDER = [
  'BC-C1', 'C1-C2', 'C2-C3', 'C3-C4', 'C4-BALC', 'BALC-SSUM', 'SSUM-HILL', 'HILL-SUMMIT',
] as const;

export interface RoutePoint {
  x: number;
  y: number;
  z: number;
  frac: number; // position along the route in shared route-display space
}

/** The full route as a dense polyline with frac at every vertex. */
export const ROUTE3: RoutePoint[] = (() => {
  const pts: RoutePoint[] = [];
  for (const leg of LEG_ORDER) {
    const [fromId, toId] = leg.split('-');
    const shape = LEG_SHAPES[leg];
    const [, y0] = WP3[fromId];
    const [, y1] = WP3[toId];
    const f0 = WP_FRAC[fromId];
    const f1 = WP_FRAC[toId];
    // Arc-length parameterize the horizontal shape.
    const cum = [0];
    for (let i = 1; i < shape.length; i++) {
      cum.push(
        cum[i - 1] + Math.hypot(shape[i][0] - shape[i - 1][0], shape[i][1] - shape[i - 1][1]),
      );
    }
    const total = cum[cum.length - 1] || 1;
    shape.forEach(([x, z], i) => {
      if (pts.length > 0 && i === 0) return; // legs share endpoints
      const t = cum[i] / total;
      pts.push({ x, y: y0 + (y1 - y0) * t, z, frac: f0 + (f1 - f0) * t });
    });
  }
  return pts;
})();

/** Map a route position (0..1, shared display space) to a 3D point. */
export function posToXYZ(pos: number): [number, number, number] {
  const p = Math.max(0, Math.min(1, pos));
  for (let i = 1; i < ROUTE3.length; i++) {
    if (p <= ROUTE3[i].frac + 1e-9) {
      const a = ROUTE3[i - 1];
      const b = ROUTE3[i];
      const t = (p - a.frac) / (b.frac - a.frac || 1);
      return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t];
    }
  }
  const last = ROUTE3[ROUTE3.length - 1];
  return [last.x, last.y, last.z];
}

// ---------------------------------------------------------------------------
// Terrain height: max-composition of peak and ridge primitives, plus
// deterministic faceting noise. Units are meters everywhere.
// ---------------------------------------------------------------------------

/**
 * Primitives are BASE-relative: they rise from the valley floor to the
 * peak altitude and fall back to the floor, so footprint width directly
 * sets slope. (Absolute-height falloff produced 7 km vertical cliffs.)
 */
const FLOOR = 4750;

function cone(x: number, z: number, px: number, pz: number, h: number, r: number, e: number) {
  const t = Math.max(0, 1 - Math.hypot(x - px, z - pz) / r);
  return FLOOR + (h - FLOOR) * Math.pow(t, e);
}

function ridge(
  x: number, z: number,
  ax: number, az: number, ah: number,
  bx: number, bz: number, bh: number,
  w: number, e: number,
) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  const s = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
  const hx = ax + dx * s;
  const hz = az + dz * s;
  const d = Math.hypot(x - hx, z - hz);
  const t = Math.max(0, 1 - d / w);
  return FLOOR + (ah + (bh - ah) * s - FLOOR) * Math.pow(t, e);
}

function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 100000) / 100000;
}

/** Smooth 2D value noise, deterministic, one octave. */
function vnoise(x: number, z: number, cell: number): number {
  const gx = x / cell;
  const gz = z / cell;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

function distToSeg(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  const s = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
  return Math.hypot(x - (ax + dx * s), z - (az + dz * s));
}

/** Bare structural height (no noise) — the massif's bones. */
function boneHeight(x: number, z: number): number {
  let h = FLOOR;
  // Soft-max: hard max() creases alias into sawtooth silhouettes where
  // primitives cross; a 75 m blend rounds every crest painterly-smooth.
  const K = 75;
  const put = (v: number) => {
    const m = Math.max(h, v);
    const n = Math.min(h, v);
    h = m + K * Math.log1p(Math.exp((n - m) / K));
  };

  // Everest: summit pyramid, Southeast Ridge, West Shoulder, north bulk.
  put(cone(x, z, 0, 100, 8849, 2300, 1.7));
  put(ridge(x, z, 0, 100, 8849, 120, 380, 8749, 900, 1.7));
  put(ridge(x, z, 120, 380, 8749, 240, 700, 8400, 900, 1.7));
  put(ridge(x, z, 240, 700, 8400, 380, 1050, 7950, 950, 1.6));
  put(ridge(x, z, 0, 100, 8849, -1450, 880, 7300, 1300, 1.5)); // West Shoulder
  put(ridge(x, z, -1450, 880, 7300, -2600, 1500, 6400, 1250, 1.4));
  put(cone(x, z, -150, -750, 7950, 2100, 1.4)); // north bulk
  put(cone(x, z, 350, -1350, 7543, 1650, 1.5)); // Changtse-ish backside

  // Lhotse: the head of the Cwm; its NW flank is the Lhotse Face.
  put(cone(x, z, 950, 1700, 8516, 1900, 1.6));
  put(ridge(x, z, 380, 1050, 7950, 950, 1700, 8516, 1050, 1.6));

  // Lhotse → Nuptse wall: the south rampart of the Cwm.
  put(ridge(x, z, 950, 1700, 8516, -150, 2780, 7500, 1150, 1.6));
  put(ridge(x, z, -150, 2780, 7500, -950, 2930, 7861, 1100, 1.7)); // Nuptse
  put(ridge(x, z, -950, 2930, 7861, -2100, 2870, 6850, 1150, 1.5));

  // Western Cwm glacier floor — a broad, enclosed, gently rising valley.
  put(ridge(x, z, -2350, 2350, 6020, -1450, 2260, 6200, 950, 0.5));
  put(ridge(x, z, -1450, 2260, 6200, -650, 2060, 6420, 900, 0.5));

  // Khumbu Icefall ramp and the glacier down past Base Camp.
  put(ridge(x, z, -3650, 2620, 5300, -2350, 2350, 6050, 900, 0.65));
  put(ridge(x, z, -4700, 3400, 5050, -3650, 2620, 5320, 1000, 0.65));

  // Geneva Spur: a dark rib angling up to the Col.
  put(ridge(x, z, 300, 1460, 7690, 435, 1290, 7840, 320, 1.2));

  return h;
}

const ICE_A = WP3.BC;
const ICE_B = WP3.C1;

function icefallMask(x: number, z: number): number {
  const d = distToSeg(x, z, ICE_A[0], ICE_A[2], ICE_B[0], ICE_B[2]);
  return Math.max(0, 1 - d / 720);
}

function faceMask(x: number, z: number): number {
  const d = distToSeg(x, z, -650, 2050, 400, 1150);
  return Math.max(0, 1 - d / 950);
}

function cwmMask(x: number, z: number): number {
  const d = Math.min(
    distToSeg(x, z, -2350, 2350, -1450, 2260),
    distToSeg(x, z, -1450, 2260, -650, 2060),
  );
  return Math.max(0, 1 - d / 820);
}

/** Nearest route point: [distance, altitude there]. Build-time only. */
function routePull(x: number, z: number): [number, number] {
  let bd = 1e9;
  let ba = 0;
  for (let i = 1; i < ROUTE3.length; i++) {
    const a = ROUTE3[i - 1];
    const b = ROUTE3[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const s = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const d = Math.hypot(x - (a.x + dx * s), z - (a.z + dz * s));
    if (d < bd) {
      bd = d;
      ba = a.y + (b.y - a.y) * s;
    }
  }
  return [bd, ba];
}

export function heightAt(x: number, z: number): number {
  const bones = boneHeight(x, z);
  // Faceting noise: calm on the high ridge, chaotic in the Icefall. Cells
  // stay several grid steps wide — near-Nyquist noise reads as spikes.
  const alt01 = Math.max(0, Math.min(1, (bones - 5000) / 3800));
  const amp = 42 * (1 - alt01 * 0.8) + 60 * icefallMask(x, z);
  const n =
    (vnoise(x, z, 920) - 0.5) * 0.65 +
    (vnoise(x + 913, z - 417, 330) - 0.5) * 0.35 +
    (vnoise(x - 311, z + 731, 150) - 0.5) * 0.45 * icefallMask(x, z);
  let h = bones + n * amp;
  // The climbing line lies ON the mountain: blend the surface to the route
  // altitude in a corridor around it, so lights sit on snow, not in air.
  const [d, ra] = routePull(x, z);
  if (d < 320) {
    const t = 1 - d / 320;
    h = h + (ra - 18 - h) * (t * t * (3 - 2 * t)) * 0.9;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Terrain mesh data: positions + per-vertex albedo, ready for BufferGeometry.
// ---------------------------------------------------------------------------

export const GRID = {
  x0: -5400, x1: 2500, z0: -1700, z1: 3950, nx: 440, nz: 320,
};

function hex(c: string): [number, number, number] {
  return [
    parseInt(c.slice(1, 3), 16) / 255,
    parseInt(c.slice(3, 5), 16) / 255,
    parseInt(c.slice(5, 7), 16) / 255,
  ];
}

const ALB = {
  snowA: hex('#e9f0fa'), snowB: hex('#f7fafe'),
  cwm: hex('#f4f8ff'),
  ice: hex('#b6cfe7'),
  rock: hex('#3d4a63'),
  band: hex('#c2a668'),
  spur: hex('#39415a'),
  moraine: hex('#66655f'),
  rubble: hex('#74716b'),
};

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Albedo for a vertex, from altitude, slope (degrees) and region masks. */
export function albedoAt(x: number, z: number, y: number, slopeDeg: number): [number, number, number] {
  const n = vnoise(x + 57, z + 991, 300);
  // Below the snowline: glacier rubble and moraine.
  if (y < 5820) {
    const nearBC = Math.max(0, 1 - Math.hypot(x - WP3.BC[0], z - WP3.BC[2]) / 900);
    return mix(mix(ALB.moraine, ALB.rubble, n), ALB.rubble, nearBC * 0.5);
  }
  const fm = faceMask(x, z);
  // Yellow Band: pale limestone cutting across the upper face.
  if (fm > 0.25 && y > 7400 && y < 7590 && slopeDeg > 26) {
    return mix(ALB.band, ALB.snowA, Math.max(0, (slopeDeg - 48) / 22));
  }
  // Geneva Spur: near-black rock rib against the ice.
  if (distToSeg(x, z, 300, 1460, 435, 1290) < 150 && y > 7550) return ALB.spur;
  // Steep ground sheds snow: rock walls.
  if (slopeDeg > 58) return mix(ALB.rock, ALB.ice, Math.max(0, n - 0.6));
  // The Lhotse Face is hard blue-grey ice, not snow.
  if (fm > 0.3 && slopeDeg > 30 && y > 6450 && y < 7900) {
    return mix(ALB.ice, ALB.snowA, n * 0.35);
  }
  // The Cwm floor: blinding glacier white.
  if (cwmMask(x, z) > 0.35 && slopeDeg < 26) return ALB.cwm;
  let snow = mix(ALB.snowA, ALB.snowB, 0.25 + n * 0.5);
  // Matte at altitude: the mountain grows more abstract as it gets dangerous.
  if (y > 8050) snow = mix(snow, ALB.ice, Math.min(0.35, (y - 8050) / 2400));
  return snow;
}

export interface TerrainData {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  heights: Float32Array; // row-major nz×nx, for contours
}

export function buildTerrain(): TerrainData {
  const { x0, x1, z0, z1, nx, nz } = GRID;
  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  const heights = new Float32Array(nx * nz);
  const dx = (x1 - x0) / (nx - 1);
  const dz = (z1 - z0) / (nz - 1);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * dx;
      const z = z0 + j * dz;
      const k = j * nx + i;
      // Jittering interior vertices breaks the regular grid's sawtooth
      // aliasing along sharp ridge crests; heights[] stays on the regular
      // grid so contour extraction is unaffected.
      const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
      const h1 = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
      const h2 = Math.sin(i * 269.5 + j * 183.3) * 28001.8384;
      const xj = edge ? x : x + (h1 - Math.floor(h1) - 0.5) * 0.82 * dx;
      const zj = edge ? z : z + (h2 - Math.floor(h2) - 0.5) * 0.82 * dz;
      const y = heightAt(xj, zj);
      positions[k * 3] = xj;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = zj;
      heights[k] = heightAt(x, z);
      const sx = (heightAt(xj + dx, zj) - heightAt(xj - dx, zj)) / (2 * dx);
      const sz = (heightAt(xj, zj + dz) - heightAt(xj, zj - dz)) / (2 * dz);
      const slope = (Math.atan(Math.hypot(sx, sz)) * 180) / Math.PI;
      const [r, g, b] = albedoAt(xj, zj, y, slope);
      colors[k * 3] = r;
      colors[k * 3 + 1] = g;
      colors[k * 3 + 2] = b;
    }
  }
  // Baked ambient occlusion: concavities sit below their neighborhood and
  // catch less sky — darkening them gives the relief real depth for free.
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let sum = 0;
      let cnt = 0;
      for (const [di, dj] of [[-3, 0], [3, 0], [0, -3], [0, 3], [-3, -3], [3, 3], [-3, 3], [3, -3]]) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        sum += heights[jj * nx + ii];
        cnt++;
      }
      if (!cnt) continue;
      const occ = Math.max(0, Math.min(1, (sum / cnt - heights[k]) / 130));
      const f = 1 - occ * 0.28;
      colors[k * 3] *= f;
      colors[k * 3 + 1] *= f;
      colors[k * 3 + 2] *= f;
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // One consistent diagonal: alternating them saws steep silhouettes
      // into teeth.
      indices[q++] = a; indices[q++] = c; indices[q++] = b;
      indices[q++] = b; indices[q++] = c; indices[q++] = d;
    }
  }
  return { positions, colors, indices, heights };
}

// ---------------------------------------------------------------------------
// Contour lines (the cartographic layer): marching squares at 250 m.
// ---------------------------------------------------------------------------

export interface ContourLevel {
  level: number;
  segments: Float32Array; // [x1,y1,z1, x2,y2,z2] * n, y lifted slightly
}

export function buildContours(t: TerrainData): ContourLevel[] {
  const { x0, z0, nx, nz } = GRID;
  const dx = (GRID.x1 - x0) / (nx - 1);
  const dz = (GRID.z1 - z0) / (nz - 1);
  const out: ContourLevel[] = [];
  for (let level = 5250; level <= 8750; level += 250) {
    const segs: number[] = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const h = [
          t.heights[j * nx + i],
          t.heights[j * nx + i + 1],
          t.heights[(j + 1) * nx + i + 1],
          t.heights[(j + 1) * nx + i],
        ];
        const px = [x0 + i * dx, x0 + (i + 1) * dx, x0 + (i + 1) * dx, x0 + i * dx];
        const pz = [z0 + j * dz, z0 + j * dz, z0 + (j + 1) * dz, z0 + (j + 1) * dz];
        const pts: [number, number][] = [];
        for (let e = 0; e < 4; e++) {
          const f = (e + 1) % 4;
          const a = h[e] - level;
          const b = h[f] - level;
          if ((a > 0) !== (b > 0)) {
            const s = a / (a - b);
            pts.push([px[e] + (px[f] - px[e]) * s, pz[e] + (pz[f] - pz[e]) * s]);
          }
        }
        if (pts.length === 2) {
          segs.push(pts[0][0], level + 14, pts[0][1], pts[1][0], level + 14, pts[1][1]);
        }
      }
    }
    if (segs.length) out.push({ level, segments: new Float32Array(segs) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Skyline impostors, star dome, sun path, camera presets.
// ---------------------------------------------------------------------------

/** Distant peaks — low-detail shapes that give the sky a horizon. */
export const IMPOSTORS = [
  { name: 'Pumori', x: -5300, z: 1500, alt: 7161, r: 1150 },
  { name: 'Ama Dablam', x: -1600, z: 5600, alt: 6812, r: 900 },
  { name: 'Makalu', x: 5600, z: 2600, alt: 8485, r: 1900 }, // dawn comes up here
  { name: 'Cho Oyu', x: -7200, z: -900, alt: 8188, r: 2100 },
  { name: 'Kangchenjunga', x: 10500, z: 3600, alt: 8586, r: 2600 },
  { name: 'Baruntse', x: 3400, z: 4800, alt: 7129, r: 1100 },
  { name: 'Taboche', x: -6400, z: 3800, alt: 6495, r: 1000 },
];

/** Deterministic star dome: [x, y, z, size01] on a big sphere. */
export function buildStars(radius: number): Float32Array {
  const n = 640;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const u = hash2(i * 7 + 1, i * 13 + 5);
    const v = hash2(i * 3 + 11, i * 17 + 2);
    const az = u * Math.PI * 2;
    const el = 0.06 + v * v * 1.35; // cluster toward the horizon less
    out[i * 4] = radius * Math.cos(el) * Math.cos(az);
    out[i * 4 + 1] = 5200 + radius * Math.sin(el);
    out[i * 4 + 2] = radius * Math.cos(el) * Math.sin(az);
    out[i * 4 + 3] = 0.35 + hash2(i, i * 31) * 0.65;
  }
  return out;
}

/**
 * Sun direction from the scene-light arc position (0 = rise, 1 = set).
 * Rises east over Makalu, arcs through the southern sky, sets west —
 * matching the Nepal-side geography the camera lives in.
 */
export function sunDir(sunU: number): [number, number, number] {
  const az = Math.PI * sunU; // 0 = east (+X), π/2 = south (+Z), π = west
  const el = Math.max(0.02, Math.sin(Math.PI * sunU)) * 0.92; // radians-ish
  const c = Math.cos(el);
  return [Math.cos(az) * c, Math.sin(el), Math.sin(az) * c];
}

export interface CamPreset {
  id: string;
  label: string;
  target: [number, number, number];
  pos: [number, number, number];
}

export const CAM_PRESETS: CamPreset[] = [
  { id: 'overview', label: 'Massif', target: [-900, 6900, 1500], pos: [-3100, 8600, 6400] },
  { id: 'bc', label: 'Base Camp', target: [-3550, 5500, 2580], pos: [-5000, 6300, 4300] },
  { id: 'icefall', label: 'Icefall', target: [-2950, 5850, 2470], pos: [-3600, 6350, 4100] },
  { id: 'cwm', label: 'Cwm', target: [-1400, 6350, 2180], pos: [-3200, 7600, 4300] },
  { id: 'face', label: 'Lhotse Face', target: [-100, 6950, 1830], pos: [-2350, 7550, 2950] },
  { id: 'col', label: 'South Col', target: [380, 7960, 1050], pos: [-900, 9300, 2700] },
  { id: 'ridge', label: 'Summit Ridge', target: [140, 8560, 470], pos: [-1250, 8720, 1500] },
];

/** The finale pull-back: the whole Himalaya below the winner. */
export const CAM_SUMMIT_WIDE: CamPreset = {
  id: 'wide', label: 'The Top of the World',
  target: [-100, 8200, 800], pos: [-3400, 11200, 5600],
};
