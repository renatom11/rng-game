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

import { NODES, SEGMENTS, type Risk } from './route';

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
  // primitives cross. A wide blend rounds every crest and, more
  // importantly, gives the massif broad shoulders instead of thin blades.
  const K = 150;
  const put = (v: number) => {
    const m = Math.max(h, v);
    const n = Math.min(h, v);
    h = m + K * Math.log1p(Math.exp((n - m) / K));
  };

  // Everest: summit pyramid, Southeast Ridge, West Shoulder, north bulk.
  // Wide footprints with gentler exponents: the real mountain is an
  // enormous broad pyramid, and steep narrow cones read as spikes.
  put(cone(x, z, 0, 100, 8849, 2750, 1.45));
  put(ridge(x, z, 0, 100, 8849, 120, 380, 8749, 1050, 1.5));
  put(ridge(x, z, 120, 380, 8749, 240, 700, 8400, 1050, 1.5));
  put(ridge(x, z, 240, 700, 8400, 380, 1050, 7950, 1100, 1.45));
  put(ridge(x, z, 0, 100, 8849, -1450, 880, 7300, 1500, 1.35)); // West Shoulder
  put(ridge(x, z, -1450, 880, 7300, -2600, 1500, 6400, 1400, 1.3));
  put(cone(x, z, -150, -750, 7950, 2400, 1.3)); // north bulk
  put(cone(x, z, 350, -1350, 7543, 1850, 1.4)); // Changtse-ish backside

  // Lhotse: the head of the Cwm; its NW flank is the Lhotse Face.
  put(cone(x, z, 950, 1700, 8516, 2150, 1.5));
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

  // Geneva Spur: a broad rock buttress angling up to the Col. Kept wide
  // deliberately — a narrow, tall rib soft-maxes into a standing blade.
  put(ridge(x, z, 300, 1460, 7620, 435, 1290, 7780, 700, 1.5));

  // Secondary buttresses: shoulders and ribs hanging off the main faces.
  // Without these the big flanks stay planar no matter how much noise
  // rides on top — a mountain is built of subsidiary structure.
  //
  // Every altitude here is set BELOW the parent pyramid's height at that
  // footprint. A rib that asserts more height than the face it hangs on
  // does not read as a rib: it stands up as a pillar at its endpoint.
  put(ridge(x, z, -420, 480, 7600, -1180, 60, 6500, 760, 1.45)); // NW rib
  put(ridge(x, z, 620, 620, 7150, 1180, 220, 6450, 700, 1.45)); // NE rib
  put(ridge(x, z, -260, 1180, 6620, -880, 1720, 5900, 660, 1.4)); // SW spur
  put(ridge(x, z, -1980, 1180, 6850, -2620, 780, 6200, 780, 1.35)); // W shoulder step
  put(cone(x, z, -1620, 300, 6080, 1100, 1.5)); // west satellite
  put(cone(x, z, 1350, 900, 6380, 1200, 1.5)); // Lhotse north shoulder
  put(ridge(x, z, 780, 2350, 6620, 180, 2760, 6150, 700, 1.45)); // Lhotse-Nuptse rib
  put(cone(x, z, -1750, 2600, 6260, 1000, 1.45)); // Nuptse west top

  return h;
}

/**
 * Peaks that shed ribs. Real mountains are not cones: spurs and buttresses
 * radiate from every summit with couloirs between them, and that radial
 * corrugation — not the outline — is what makes a face read as rock and
 * snow instead of a shaded triangle. [x, z, reach].
 */
const FLUTE_PEAKS: [number, number, number][] = [
  [0, 100, 2300], // Everest
  [950, 1700, 1900], // Lhotse
  [-950, 2930, 1500], // Nuptse
  [-150, -750, 2100], // north bulk
  [350, -1350, 1650], // Changtse
];

/**
 * Radial fluting: noise sampled in each peak's polar frame, so ribs run
 * downhill from the summit at irregular spacing rather than as a clean
 * sine comb. Ridged (1 - |2n-1|) so spurs are sharp and the gullies
 * between them are broad — the real asymmetry of an eroded face.
 */
function fluting(x: number, z: number): number {
  let f = 0;
  for (const [px, pz, R] of FLUTE_PEAKS) {
    const dx = x - px;
    const dz = z - pz;
    const d = Math.hypot(dx, dz);
    if (d > R || d < 40) continue;
    // True arc length, not raw angle: near a summit the angular coordinate
    // spins far faster than the grid can sample it, and that aliasing
    // spikes into needles. Arc length changes at most one grid step per
    // step, so ribs stay ~200 m wide and band-limited everywhere.
    const s = Math.atan2(dz, dx) * d;
    // Broad ribs: Everest's spurs are hundreds of metres wide, and the
    // faces between them are vast smooth snowfields. Sharp, closely
    // spaced corrugation would read as a spiky prop, not a mountain.
    const a = 1 - Math.abs(vnoise(s, d * 0.45, 520) * 2 - 1);
    const b = 1 - Math.abs(vnoise(s * 2.3 + 517, d * 0.45, 380) * 2 - 1);
    const rib = a * 0.82 + b * 0.18;
    // Ribs die at the summit point and fade into the valley floor.
    const t = d / R;
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, t)), 0.75);
    f += (rib - 0.52) * env;
  }
  return f;
}

/**
 * Domain warp: bends the whole coordinate field before the primitives are
 * evaluated, so ridgelines meander and no crest runs ruler-straight from
 * summit to base. Two scales — a long bend and a shorter wobble.
 */
function warpXZ(x: number, z: number): [number, number] {
  const wx =
    (vnoise(x + 1013, z - 77, 2100) - 0.5) * 320 +
    (vnoise(x - 289, z + 613, 760) - 0.5) * 110;
  const wz =
    (vnoise(x - 431, z + 917, 2100) - 0.5) * 320 +
    (vnoise(x + 733, z - 205, 760) - 0.5) * 110;
  return [x + wx, z + wz];
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
  // The structural primitives are evaluated in a warped frame, so the
  // massif keeps its real geography while every ridgeline wanders.
  const [wx, wz] = warpXZ(x, z);
  const bones = boneHeight(wx, wz);
  const alt01 = Math.max(0, Math.min(1, (bones - 5000) / 3800));
  const ice = icefallMask(x, z);

  // Radial spurs and couloirs — the layer that breaks planar faces.
  // Strongest on the high flanks, gone by the glacier floor.
  // Relief eases off toward the summit: the high ridges are wind-scoured
  // and smooth, and corrugating them reads as serration on a knife edge.
  const flute = fluting(wx, wz) * (52 + 30 * alt01 * (1 - alt01)) * (1 - ice * 0.7);

  // Ridged erosion: long shallow drainages, not chatter. Low frequency
  // and low amplitude keep the great faces broad and smooth.
  const rg =
    (1 - Math.abs(vnoise(wx * 1.0 + 71, wz * 1.0 - 233, 1250) * 2 - 1)) * 0.66 +
    (1 - Math.abs(vnoise(wx * 1.0 - 517, wz * 1.0 + 89, 520) * 2 - 1)) * 0.34;
  const erosion = (rg - 0.55) * (34 + 24 * alt01 * (1 - alt01)) * (1 - ice * 0.5);

  // Faceting noise: calm on the high ridge, chaotic in the Icefall. Cells
  // stay several grid steps wide — near-Nyquist noise reads as spikes.
  const amp = 18 * (1 - alt01 * 0.85) + 55 * ice;
  const n =
    (vnoise(wx, wz, 920) - 0.5) * 0.65 +
    (vnoise(wx + 913, wz - 417, 330) - 0.5) * 0.35 +
    (vnoise(wx - 311, wz + 731, 150) - 0.5) * 0.45 * ice;
  let h = bones + flute + erosion + n * amp;
  // The climbing line lies ON the mountain: blend the surface to the route
  // altitude in a corridor around it, so lights sit on snow, not in air.
  const [d, ra] = routePull(x, z);
  if (d < 430) {
    const t = 1 - d / 430;
    // The climbing line lies ON the mountain: the surface is blended all
    // the way to the route altitude, so camps and lights sit on snow
    // rather than floating over a face the primitives left too low.
    h += (ra - 18 - h) * (t * t * (3 - 2 * t)) * 0.95;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Route branches in 3D: the safe / normal / risky lines, as real geometry
// lying on the mountain, so a viewer can see the choice each team faces.
// ---------------------------------------------------------------------------

export interface Branch3D {
  id: string;
  risk: Risk;
  segIdx: number;
  /** Dense polyline on the surface, ready for a LineGeometry. */
  points: [number, number, number][];
}

/**
 * One lane per edge, offset perpendicular to the leg and tapered to zero at
 * the waypoints (every option starts and ends at the same camp). The risk
 * grade shapes the line the way it shapes the climb: the risky line runs
 * direct and bows into the slope, the normal line eases across it, the safe
 * line switchbacks and takes the long way round.
 */
export function buildBranches(): Branch3D[] {
  const out: Branch3D[] = [];
  const SAMPLES = 26;
  SEGMENTS.forEach((seg, segIdx) => {
    const a = WP3[seg.from];
    const b = WP3[seg.to];
    if (!a || !b) return;
    const fa = WP_FRAC[seg.from];
    const fb = WP_FRAC[seg.to];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    // Perpendicular in the ground plane.
    const px = -dz / len;
    const pz = dx / len;
    const lanes =
      seg.edges.length === 1 ? [0] : seg.edges.length === 2 ? [-1, 1] : [-1, 0, 1];
    const laneAmp = Math.min(210, Math.max(90, len * 0.14));
    seg.edges.forEach((e, i) => {
      const lane = lanes[i];
      const points: [number, number, number][] = [];
      for (let k = 0; k <= SAMPLES; k++) {
        const t = k / SAMPLES;
        const taper = Math.sin(Math.PI * t);
        let off = lane * laneAmp * taper;
        if (e.risk === 'risky') off += -0.1 * laneAmp * taper;
        else if (e.risk === 'medium') off += 0.12 * laneAmp * Math.sin(2 * Math.PI * t) * taper;
        else off += 0.2 * laneAmp * Math.sin(t * Math.PI * 5) * taper;
        const x = a[0] + dx * t + px * off;
        const z = a[2] + dz * t + pz * off;
        // Sit on the snow: the surface, or the route altitude where the
        // corridor has pinned it — whichever is higher, plus a hair.
        const routeY = posToXYZ(fa + (fb - fa) * t)[1];
        const y = Math.max(heightAt(x, z), routeY - 40) + 22;
        points.push([x, y, z]);
      }
      out.push({ id: e.id, risk: e.risk, segIdx, points });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Terrain mesh data: positions + per-vertex albedo, ready for BufferGeometry.
// ---------------------------------------------------------------------------

export const GRID = {
  x0: -5400, x1: 2500, z0: -1700, z1: 3950, nx: 520, nz: 370,
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
  // Every boundary below is a smooth blend, not a threshold: a hard cut
  // across noisy terrain fringes into a scratchy band that reads as a
  // rendering glitch rather than a geological contact.
  const band = smoothBand(y, 7330, 7660, 90) * smoothStep(0.2, 0.42, fm) * smoothStep(20, 34, slopeDeg);
  const rockAmt = smoothStep(50, 64, slopeDeg);
  const faceAmt =
    smoothStep(0.24, 0.42, fm) * smoothStep(26, 38, slopeDeg) * smoothBand(y, 6350, 8000, 260);

  let base: [number, number, number];
  // The Lhotse Face is hard blue-grey ice, not snow.
  const ice = mix(ALB.ice, ALB.snowA, n * 0.35);
  // The Cwm floor: blinding glacier white.
  if (cwmMask(x, z) > 0.35 && slopeDeg < 26) base = ALB.cwm;
  else {
    let snow = mix(ALB.snowA, ALB.snowB, 0.25 + n * 0.5);
    if (y > 8050) snow = mix(snow, ALB.ice, Math.min(0.35, (y - 8050) / 2400));
    base = mix(snow, ice, faceAmt);
  }
  // Yellow Band: pale limestone cutting across the upper face.
  base = mix(base, mix(ALB.band, ALB.snowA, Math.max(0, (slopeDeg - 48) / 22)), band);
  // Steep ground sheds snow: rock walls.
  base = mix(base, mix(ALB.rock, ALB.ice, Math.max(0, n - 0.6)), rockAmt);
  // Geneva Spur: near-black rock rib against the ice.
  const spur =
    Math.max(0, 1 - distToSeg(x, z, 300, 1460, 435, 1290) / 190) * smoothStep(7450, 7620, y);
  return mix(base, ALB.spur, Math.min(1, spur));
}

function smoothStep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
}

/** 1 inside [lo, hi], easing to 0 across `feather` on both sides. */
function smoothBand(x: number, lo: number, hi: number, feather: number): number {
  return smoothStep(lo - feather, lo + feather, x) * (1 - smoothStep(hi - feather, hi + feather, x));
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
      const xj = edge ? x : x + (h1 - Math.floor(h1) - 0.5) * 0.45 * dx;
      const zj = edge ? z : z + (h2 - Math.floor(h2) - 0.5) * 0.45 * dz;
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
          segs.push(pts[0][0], level + 8, pts[0][1], pts[1][0], level + 8, pts[1][1]);
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

/** Distant peaks — silhouettes that give the sky a horizon. */
export const IMPOSTORS = [
  { name: 'Pumori', x: -6300, z: 1200, alt: 7161, r: 1150 },
  { name: 'Ama Dablam', x: -1600, z: 5600, alt: 6812, r: 900 },
  { name: 'Makalu', x: 5600, z: 2600, alt: 8485, r: 1900 }, // dawn comes up here
  { name: 'Cho Oyu', x: -7200, z: -900, alt: 8188, r: 2100 },
  { name: 'Kangchenjunga', x: 10500, z: 3600, alt: 8586, r: 2600 },
  { name: 'Baruntse', x: 3400, z: 4800, alt: 7129, r: 1100 },
  { name: 'Taboche', x: -6400, z: 3800, alt: 6495, r: 1000 },
];

/**
 * The named horizon plus anonymous ranges: the Himalaya is a sea of
 * mountains, not seven cones on a plain. These fill the gaps between the
 * named silhouettes so every compass direction has a skyline.
 */
export const FAR_PEAKS = [
  ...IMPOSTORS,
  { name: '', x: 1800, z: -9500, alt: 7050, r: 1700 },
  { name: '', x: -3400, z: -12500, alt: 6900, r: 2200 },
  { name: '', x: 7800, z: -6800, alt: 7350, r: 1900 },
  { name: '', x: -9800, z: -6200, alt: 6750, r: 2000 },
  { name: '', x: -13500, z: 3400, alt: 6600, r: 2100 },
  { name: '', x: -8600, z: 8800, alt: 6580, r: 1800 },
  { name: '', x: 5400, z: 9600, alt: 6880, r: 1900 },
  { name: '', x: 12800, z: -2400, alt: 7500, r: 2400 },
  { name: '', x: -2400, z: 12800, alt: 6400, r: 2300 },
  { name: '', x: 16500, z: 8200, alt: 7300, r: 2600 },
];

/**
 * The far Himalaya heightfield. Inside the hero grid it ducks below the
 * main terrain; at the boundary it continues the hero edge downhill so
 * there is never a trench; beyond, ridged noise with a NW–SE structural
 * grain builds range upon range out to the horizon, anchored by the
 * named peaks.
 */
export function farHeightAt(x: number, z: number): number {
  const cx = Math.min(Math.max(x, GRID.x0), GRID.x1);
  const cz = Math.min(Math.max(z, GRID.z0), GRID.z1);
  const dOut = Math.hypot(x - cx, z - cz);
  if (dOut < 1e-6) return 4200;
  // Ridged noise: fold value noise into sharp crests, two octaves, with
  // the domain skewed so ranges run with the Himalaya's grain.
  const sx = x * 0.82 + z * 0.42;
  const sz = z * 0.86 - x * 0.30;
  const r1 = 1 - Math.abs(vnoise(sx, sz, 3100) * 2 - 1);
  const r2 = 1 - Math.abs(vnoise(sx + 913, sz + 411, 1350) * 2 - 1);
  const rangeMask = Math.pow(vnoise(x - 511, z + 733, 8200), 1.5);
  const dist = Math.hypot(x, z);
  const farAmp = (950 + Math.min(1, dist / 22000) * 1500) * 2.1;
  const base = 4150 + (vnoise(x + 31, z - 87, 6200) - 0.5) * 650;
  let h = base + (r1 * 0.66 + r2 * 0.34) * rangeMask * farAmp;
  for (const p of FAR_PEAKS) {
    const t = Math.max(0, 1 - Math.hypot(x - p.x, z - p.z) / (p.r * 2.1));
    if (t > 0) {
      const serr = 0.84 + 0.16 * r2;
      h = Math.max(h, 4300 + (p.alt - 4300) * Math.pow(t, 1.55) * serr);
    }
  }
  const t = Math.min(1, dOut / 1000);
  const edgeH = heightAt(cx, cz) - 30;
  return edgeH * (1 - t) + h * (t * t * (3 - 2 * t));
}

const FAR_ALB = {
  snow: hex('#dfe9f6'), snowHi: hex('#edf3fb'),
  rock: hex('#46506b'),
  valley: hex('#5d5a52'), valleyB: hex('#6c6a61'),
};

function farAlbedoAt(x: number, z: number, y: number, slopeDeg: number): [number, number, number] {
  const n = vnoise(x + 77, z - 13, 1100);
  const snowline = 5250 + n * 350;
  if (y < snowline) return mix(FAR_ALB.valley, FAR_ALB.valleyB, n);
  if (slopeDeg > 52) return mix(FAR_ALB.rock, FAR_ALB.snow, Math.max(0, n - 0.55));
  return mix(FAR_ALB.snow, FAR_ALB.snowHi, 0.2 + n * 0.6);
}

export interface FarRangeData {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** Build the far-range mesh: coarse, jittered, AO-shaded, huge. */
export function buildFarRange(): FarRangeData {
  const fx0 = -30000, fx1 = 26000, fz0 = -24000, fz1 = 26000;
  const nx = 230, nz = 205;
  const dx = (fx1 - fx0) / (nx - 1);
  const dz = (fz1 - fz0) / (nz - 1);
  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = fx0 + i * dx;
      const z = fz0 + j * dz;
      const k = j * nx + i;
      const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
      const h1 = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
      const h2 = Math.sin(i * 269.5 + j * 183.3) * 28001.8384;
      const xj = edge ? x : x + (h1 - Math.floor(h1) - 0.5) * 0.8 * dx;
      const zj = edge ? z : z + (h2 - Math.floor(h2) - 0.5) * 0.8 * dz;
      const y = farHeightAt(xj, zj);
      positions[k * 3] = xj;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = zj;
      heights[k] = y;
      const gx = (farHeightAt(xj + dx * 0.5, zj) - farHeightAt(xj - dx * 0.5, zj)) / dx;
      const gz = (farHeightAt(xj, zj + dz * 0.5) - farHeightAt(xj, zj - dz * 0.5)) / dz;
      const slope = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
      const [r, g, b] = farAlbedoAt(xj, zj, y, slope);
      colors[k * 3] = r;
      colors[k * 3 + 1] = g;
      colors[k * 3 + 2] = b;
    }
  }
  // Concavity AO, as on the hero terrain — valleys hold shadow.
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let sum = 0;
      let cnt = 0;
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        sum += heights[jj * nx + ii];
        cnt++;
      }
      if (!cnt) continue;
      const occ = Math.max(0, Math.min(1, (sum / cnt - heights[k]) / 420));
      const f = 1 - occ * 0.3;
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
      indices[q++] = a; indices[q++] = c; indices[q++] = b;
      indices[q++] = b; indices[q++] = c; indices[q++] = d;
    }
  }
  return { positions, colors, indices };
}

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
