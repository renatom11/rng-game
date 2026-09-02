/**
 * The mountain in space: pure geometry + math for the 3D expedition view.
 * No three.js imports here — everything returns plain arrays and numbers so
 * it stays unit-testable and the renderer stays a thin consumer.
 *
 * World space: +X east, +Y up (meters), +Z south. The massif itself is a
 * terrain model rather than a stack of analytic cones (see THE HEIGHTFIELD
 * below), and the route is not drawn over it but fitted TO it: a ridge-walk
 * descending from the model's own summit along the crest, sampled where it
 * crosses each camp's altitude. So Base Camp sits in the southwest on real
 * moraine, and every camp above it stands on a real spur.
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
  BC: [-4563, 5364, 2435],
  C1: [-3288, 6065, 1878],
  C2: [-2853, 6400, 1688],
  C3: [-2048, 7160, 1325],
  C4: [-1230, 7950, 845],
  BALC: [-931, 8400, 666],
  SSUM: [-266, 8749, 303],
  HILL: [-162, 8790, 231],
  SUMMIT: [22, 8849, 108],
};

export const WP_FRAC: Record<string, number> = Object.fromEntries(
  NODES.map((n) => [n.id, n.frac]),
);

/**
 * Horizontal shape points per leg (x, z) — altitudes are interpolated.
 * These are not drawn by hand: they are the line a ridge-walk found on the
 * heightfield, descending from the summit along the crest and sampled where
 * it crosses each camp's altitude. So the route lies on a real spur of the
 * real mountain rather than on a plausible-looking curve laid over it.
 */
const LEG_SHAPES: Record<string, [number, number][]> = {
  'BC-C1': [[-4563, 2435], [-4389, 2359], [-4186, 2271], [-4012, 2195], [-3838, 2119], [-3664, 2043], [-3462, 1954], [-3288, 1878]],
  'C1-C2': [[-3288, 1878], [-3143, 1815], [-2998, 1751], [-2853, 1688]],
  'C2-C3': [[-2853, 1688], [-2679, 1612], [-2532, 1553], [-2361, 1475], [-2219, 1405], [-2048, 1325]],
  'C3-C4': [[-2048, 1325], [-1912, 1244], [-1775, 1165], [-1637, 1088], [-1502, 1007], [-1366, 926], [-1230, 845]],
  'C4-BALC': [[-1230, 845], [-1121, 780], [-1040, 731], [-931, 666]],
  'BALC-SSUM': [[-931, 666], [-790, 596], [-651, 519], [-541, 458], [-403, 379], [-266, 303]],
  'SSUM-HILL': [[-266, 303], [-214, 267], [-162, 231]],
  'HILL-SUMMIT': [[-162, 231], [-60, 157], [22, 108]],
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
 * THE HEIGHTFIELD
 *
 * The massif is no longer a stack of analytic cones and ridges. It is a real
 * terrain model: a 4097x4097 DEM, cropped so its summit sits where the route
 * model puts the summit, resampled to a 768x549 heightfield and shipped as
 * public/terrain/massif.png. Elevation is packed into 12 bits across two 8-bit
 * channels (red carries the high byte, green the low nibble), which survives a
 * canvas round-trip exactly and quantises to about a metre.
 *
 * Everything here is still decoration over already-served data — the mountain
 * has no idea who wins.
 */
export const HF = {
  url: '/terrain/massif.png',
  width: 896,
  height: 640,
  /** Elevations the packed range maps onto. */
  altFloor: 4550,
  altPeak: 8849,
};

let hfData: Float32Array | null = null;
let hfPromise: Promise<void> | null = null;

export function heightfieldReady(): boolean {
  return hfData !== null;
}

/**
 * Decode the heightfield once. `createImageBitmap` with colour management off
 * matters: a colour-managed decode would rewrite the very byte values the
 * elevation is packed into.
 */
export function loadHeightfield(): Promise<void> {
  if (hfData) return Promise.resolve();
  if (hfPromise) return hfPromise;
  hfPromise = (async () => {
    const res = await fetch(HF.url);
    if (!res.ok) throw new Error(`heightfield ${res.status}`);
    const bmp = await createImageBitmap(await res.blob(), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const n = bmp.width * bmp.height;
    const out = new Float32Array(n);
    const span = HF.altPeak - HF.altFloor;
    for (let i = 0; i < n; i++) {
      const v = (px[i * 4] << 4) | (px[i * 4 + 1] >> 4);
      out[i] = HF.altFloor + (v / 4095) * span;
    }
    hfData = out;
    bmp.close();
  })();
  return hfPromise;
}

/** For tests and any Node-side use: install a heightfield directly. */
export function setHeightfield(data: Float32Array): void {
  hfData = data;
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

/** Bilinear sample of the DEM, clamped at the edges. */
function sampleHF(x: number, z: number): number {
  const d = hfData;
  if (!d) return HF.altFloor;
  const u = ((x - GRID.x0) / (GRID.x1 - GRID.x0)) * (HF.width - 1);
  const v = ((z - GRID.z0) / (GRID.z1 - GRID.z0)) * (HF.height - 1);
  const cu = Math.min(HF.width - 1, Math.max(0, u));
  const cv = Math.min(HF.height - 1, Math.max(0, v));
  const i0 = Math.floor(cu);
  const j0 = Math.floor(cv);
  const i1 = Math.min(HF.width - 1, i0 + 1);
  const j1 = Math.min(HF.height - 1, j0 + 1);
  const fx = cu - i0;
  const fz = cv - j0;
  const a = d[j0 * HF.width + i0];
  const b = d[j0 * HF.width + i1];
  const c = d[j1 * HF.width + i0];
  const e = d[j1 * HF.width + i1];
  return (a + (b - a) * fx) * (1 - fz) + (c + (e - c) * fx) * fz;
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
  const base = sampleHF(x, z);
  // The DEM resolves to about 10 m. Below that the surface would be flat under
  // a close camera, so a small amount of relief is added back — enough to give
  // the snow tooth, far too little to invent a landform. Kept low on purpose:
  // high-frequency height detail on steep ground is what used to make the
  // rock/snow boundary comb.
  const fine =
    (vnoise(x + 311, z - 97, 210) - 0.5) * 6 +
    (vnoise(x - 733, z + 451, 78) - 0.5) * 3;
  let h = base + fine;
  // Below the snowline the ground is the glacier's own moraine — hummocks and
  // medial ridges a few tens of metres across, which the DEM resolves at none
  // of its scales. Without them Base Camp stands on a blank pale pan.
  const lowT = 1 - smoothStep(5250, 6050, base);
  if (lowT > 0) {
    h += lowT * (
      (vnoise(x - 121, z + 349, 320) - 0.5) * 26
      + (vnoise(x + 517, z - 233, 130) - 0.5) * 12
    );
  }
  // The climbing line lies ON the mountain: blend the surface to the route
  // altitude in a corridor around it, so lights sit on snow, not in air. The
  // route was fitted to this very heightfield, so the correction is small —
  // it only has to absorb the fine layer and the resampling.
  const [d, ra] = routePull(x, z);
  if (d < 260) {
    const t = 1 - d / 260;
    h += (ra - 14 - h) * (t * t * (3 - 2 * t)) * 0.9;
  }
  return h;
}

/**
 * Local steepness in degrees, measured across a wide baseline so it describes
 * the FACE rather than the fine layer riding on it. Used by the albedo.
 */
export function slopeAt(x: number, z: number, b = 120): number {
  const gx = (sampleHF(x + b, z) - sampleHF(x - b, z)) / (2 * b);
  const gz = (sampleHF(x, z + b) - sampleHF(x, z - b)) / (2 * b);
  return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
}

/**
 * How much this point stands above its own neighbourhood, 0..1 — a rib reads
 * high, a couloir reads zero.
 *
 * The window is measured, not guessed: across this model's snow-covered ground
 * the relief above a 150 m neighbourhood runs about -44 m to +69 m, so the old
 * 10..130 m window sat almost entirely off the top of the distribution and the
 * function returned ~0.05 everywhere, silently switching off every term that
 * depended on it.
 */
export function crestAt(x: number, z: number, b = 150): number {
  const c = sampleHF(x, z);
  const avg =
    (sampleHF(x + b, z) + sampleHF(x - b, z) + sampleHF(x, z + b) + sampleHF(x, z - b)) / 4;
  return smoothStep(-5, 42, c - avg);
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

/**
 * The branch set, built once. Decoration only: a lookup over geometry derived
 * from already-served data — nothing here can reach `core`.
 */
let _branches: Branch3D[] | null = null;
let _branchById: Map<string, Branch3D> | null = null;

export function branches3D(): Branch3D[] {
  if (!_branches) _branches = buildBranches();
  return _branches;
}

function branchById(id: string): Branch3D | undefined {
  if (!_branchById) _branchById = new Map(branches3D().map((b) => [b.id, b]));
  return _branchById.get(id);
}

/** [startFrac, endFrac] of each route segment, from the shared route model. */
export const SEG_FRACS: [number, number][] = SEGMENTS.map((s) => [
  WP_FRAC[s.from],
  WP_FRAC[s.to],
]);

/** Index of the segment containing a route-display position. */
export function segIndexAt(pos: number): number {
  for (let i = 0; i < SEG_FRACS.length; i++) {
    if (pos <= SEG_FRACS[i][1] + 1e-9) return i;
  }
  return SEG_FRACS.length - 1;
}

/**
 * A point on the line a team is ACTUALLY on: the chosen branch's polyline when
 * the fork choice is known, the canonical route otherwise.
 *
 * These are different curves. posToXYZ walks ROUTE3, the canonical
 * switchbacking polyline; the ribbons come from buildBranches, which offsets
 * lanes off the straight chord between waypoints. In the Western Cwm that put
 * the canonical line exactly down the empty middle between the two drawn
 * ribbons — every marker 210 m from both, touching neither, which is what
 * "the dots don't follow the paths" was. Branches taper to zero at both
 * waypoints, so this stays continuous across segment boundaries and when a
 * team changes line between legs.
 */
export function posToXYZOn(
  pos: number,
  edgeId: string | null | undefined,
): [number, number, number] {
  const br = edgeId ? branchById(edgeId) : undefined;
  if (!br) return posToXYZ(pos);
  const [f0, f1] = SEG_FRACS[br.segIdx];
  const t = Math.max(0, Math.min(1, (pos - f0) / (f1 - f0 || 1)));
  const pts = br.points;
  const u = t * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.max(0, Math.floor(u)));
  const k = u - i;
  const a = pts[i];
  const b = pts[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}


// ---------------------------------------------------------------------------
// Terrain mesh data: positions + per-vertex albedo, ready for BufferGeometry.
// ---------------------------------------------------------------------------

export const GRID = {
  // The world box is the crop's own footprint at a fixed 14.1 m per DEM pixel.
  // Scale is not free here: squeezing more of the model into the same box
  // steepens every slope in it, and the first attempt — the whole massif
  // packed into an 7.9 x 5.7 km world — came out a bloated dome with every
  // drainage cut into a gorge. Widening the world with the crop keeps the
  // model's own gradients and simply shows more of it.
  x0: -8640, x1: 4000, z0: -2780, z1: 6260,
  // Just under the heightfield's own 896x640, so the mesh resolves what the
  // DEM actually carries and no more; height lookup is an array read, so the
  // grid costs far less than the old analytic terrain's did.
  nx: 768, nz: 549,
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
  // Near-neutral, and dark. At #53607b the exposed rock was bluer than the
  // snow's own shadows, so every rib read as one more shadow instead of as
  // the mountain's bones.
  rock: hex('#4b4f5a'),
  // A warm grey, not a yellow. This used to be #c2a668 painted straight over
  // the snow at 7,350-7,680 m, and on a real heightfield an altitude window
  // is a CONTOUR — so it wrapped the entire massif in a mustard sash.
  band: hex('#9d8a63'),
  spur: hex('#2f333d'),
  moraine: hex('#66655f'),
  rubble: hex('#74716b'),
  scree: hex('#565550'),
  glacier: hex('#9fabb0'),
};

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Albedo for a vertex, read off the terrain rather than off a map of named
 * places. The old version blended in a hand-placed Lhotse Face, Western Cwm
 * and Geneva Spur, each a line segment drawn against the analytic massif that
 * no longer exists — on a real heightfield they landed on whatever happened to
 * be there. Snow line, glacier flats, ice faces and rock walls now all fall
 * out of altitude, steepness and whether the ground is a crest or a gully,
 * which is what actually decides them on a mountain.
 */
export function albedoAt(
  x: number, z: number, y: number, slopeDeg: number,
  /** 0..1, how much this point stands above its neighbourhood (a crest). */
  crest = 0,
): [number, number, number] {
  const n = vnoise(x + 57, z + 991, 300);
  // Every boundary below is a smooth blend, not a threshold: a hard cut
  // across noisy terrain fringes into a scratchy band that reads as a
  // rendering glitch rather than a geological contact.

  // Rock stands on the RIBS, snow lies in the couloirs between them — that is
  // what a Himalayan face looks like, and it is the whole large-scale value
  // structure of the mountain. Backwards (rock in the gullies) every drainage
  // on the model got a dark outline and the massif came out looking furred.
  // The 30-48 deg window is where this surface's slopes actually live: median
  // 34, ninetieth percentile 46.
  // The altitude weight is what gives the massif its large-scale read: a dark
  // summit pyramid over a white middle over grey moraine. Without it the ribs
  // carry the same rock at every height and the whole flank textures evenly,
  // which at a distance is indistinguishable from noise.
  const rockAmt = smoothStep(28, 46, slopeDeg) * (0.22 + 0.78 * crest)
    * (0.3 + 0.7 * smoothStep(6500, 8200, y));
  // Hard blue ice: steep, high, and down in the couloirs — wherever rock has
  // not already taken the ground.
  const faceAmt =
    smoothStep(31, 44, slopeDeg) * smoothBand(y, 6300, 8300, 380)
    * (1 - crest * 0.5) * (1 - rockAmt);
  // Glacier flats: high ground that is nearly level is a snowfield or a cwm
  // floor, and it is the brightest thing on the mountain.
  const flat =
    (1 - smoothStep(9, 20, slopeDeg)) * smoothStep(5700, 6400, y) * (1 - crest * 0.35);
  // The Yellow Band is a stratum IN the rock, so it warms the rock instead of
  // being painted over whatever the altitude window crosses.
  const bandAmt = smoothBand(y, 7380, 7660, 130);

  const ice = mix(ALB.ice, ALB.snowA, n * 0.35);
  let snow = mix(ALB.snowA, ALB.snowB, 0.25 + n * 0.5);
  if (y > 8050) snow = mix(snow, ALB.ice, Math.min(0.35, (y - 8050) / 2400));
  // The darkest rock is the wall in the back of a gully, where nothing lies.
  const rock = mix(
    mix(ALB.rock, ALB.spur, smoothStep(42, 58, slopeDeg) * 0.75),
    ALB.band, bandAmt * 0.6,
  );
  let base = mix(snow, ice, faceAmt);
  base = mix(base, ALB.cwm, flat);
  base = mix(base, mix(rock, ALB.ice, Math.max(0, n - 0.62)), rockAmt);
  // Below the snowline: glacier rubble and moraine. Feathered over altitude —
  // as a hard cut it saws a serrated ledge wherever the relief crosses it.
  const nearBC = Math.max(0, 1 - Math.hypot(x - WP3.BC[0], z - WP3.BC[2]) / 1400);
  const ground = mix(groundAlbedo(x, z, slopeDeg, crest), ALB.rubble, nearBC * 0.45);
  return mix(base, ground, 1 - snowAmt(y, vnoise(x + 77, z - 13, 1100)));
}

/**
 * The ground below the snowline, shared by the hero terrain and the far range
 * so the two cannot disagree along the seam. It used to be one flat wash of
 * moraine, which across several square kilometres of frame read as a slab; it
 * now takes the same rib/gully treatment as the snow above it — scree in the
 * hollows, paler rubble on the spurs — plus dirty glacier ice on the flats,
 * which is what actually fills these valleys.
 */
function groundAlbedo(
  x: number, z: number, slopeDeg: number, crest: number,
): [number, number, number] {
  const n = vnoise(x + 77, z - 13, 1100);
  const valleyFlat = (1 - smoothStep(6, 16, slopeDeg)) * (1 - crest);
  let g = mix(ALB.scree, ALB.rubble, 0.25 + 0.5 * n + 0.35 * crest);
  g = mix(g, ALB.moraine, vnoise(x - 233, z + 617, 480) * 0.5);
  return mix(g, ALB.glacier, valleyFlat * 0.45);
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
      const xj = edge ? x : x + (h1 - Math.floor(h1) - 0.5) * 0.12 * dx;
      const zj = edge ? z : z + (h2 - Math.floor(h2) - 0.5) * 0.12 * dz;
      const y = heightAt(xj, zj);
      positions[k * 3] = xj;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = zj;
      heights[k] = heightAt(x, z);
      // Geology is asked of the DEM directly, not of heightAt: the fine
      // relief layer riding on the surface would throw vertex after vertex
      // onto opposite sides of the rock cutoff and comb every steep face,
      // and routePull would run the whole route polyline four more times per
      // vertex. Lighting still uses the true per-vertex normal, so the relief
      // keeps all of its bite — it just stops deciding the geology.
      const slope = slopeAt(xj, zj);
      const crest = crestAt(xj, zj);
      const [r, g, b] = albedoAt(xj, zj, y, slope, crest);
      colors[k * 3] = r;
      colors[k * 3 + 1] = g;
      colors[k * 3 + 2] = b;
    }
  }
  // Soften the albedo across neighbours before AO goes on. Geological
  // contacts are gradual over tens of metres; a per-vertex decision is not,
  // and any speckle left in it reads at distance as a rendering fault rather
  // than as rock. AO is applied after, so relief stays crisp.
  {
    const src = colors.slice();
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) src.set(colors);
      for (let j = 1; j < nz - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const k = j * nx + i;
          for (let c = 0; c < 3; c++) {
            const mid = src[k * 3 + c];
            const nb =
              src[(k - 1) * 3 + c] + src[(k + 1) * 3 + c] +
              src[(k - nx) * 3 + c] + src[(k + nx) * 3 + c];
            colors[k * 3 + c] = mid * 0.44 + nb * 0.14;
          }
        }
      }
    }
  }
  // Baked ambient occlusion: concavities sit below their neighborhood and
  // catch less sky — darkening them gives the relief real depth for free.
  // Computed into its own field and blurred before it is applied: measured
  // per vertex on fluted ground it combs along the ribs exactly the way the
  // albedo did, and re-speckles the surface the blur above just cleaned.
  const ao = new Float32Array(nx * nz);
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
      ao[k] = cnt ? Math.max(0, Math.min(1, (sum / cnt - heights[k]) / 130)) : 0;
    }
  }
  {
    const src = new Float32Array(ao.length);
    for (let pass = 0; pass < 2; pass++) {
      src.set(ao);
      for (let j = 1; j < nz - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const k = j * nx + i;
          ao[k] =
            src[k] * 0.44 +
            (src[k - 1] + src[k + 1] + src[k - nx] + src[k + nx]) * 0.14;
        }
      }
    }
  }
  for (let k = 0; k < nx * nz; k++) {
    const f = 1 - ao[k] * 0.28;
    colors[k * 3] *= f;
    colors[k * 3 + 1] *= f;
    colors[k * 3 + 2] *= f;
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

/**
 * Distant peaks — silhouettes that give the sky a horizon. Positions and radii
 * moved out with the world box (same bearings, same apparent size), because
 * half of them ended up standing INSIDE the wider hero grid, where the massif
 * simply swallows them.
 */
export const IMPOSTORS = [
  { name: 'Pumori', x: -10080, z: 1920, alt: 7161, r: 1840 },
  { name: 'Ama Dablam', x: -2560, z: 8960, alt: 6812, r: 1440 },
  { name: 'Makalu', x: 8960, z: 4160, alt: 8485, r: 3040 }, // dawn comes up here
  { name: 'Cho Oyu', x: -11520, z: -1440, alt: 8188, r: 3360 },
  { name: 'Kangchenjunga', x: 16800, z: 5760, alt: 8586, r: 4160 },
  { name: 'Baruntse', x: 5440, z: 7680, alt: 7129, r: 1760 },
  { name: 'Taboche', x: -10240, z: 6080, alt: 6495, r: 1600 },
];

/**
 * The named horizon plus anonymous ranges: the Himalaya is a sea of
 * mountains, not seven cones on a plain. These fill the gaps between the
 * named silhouettes so every compass direction has a skyline.
 */
export const FAR_PEAKS = [
  ...IMPOSTORS,
  { name: '', x: 2880, z: -15200, alt: 7050, r: 2720 },
  { name: '', x: -5440, z: -20000, alt: 6900, r: 3520 },
  { name: '', x: 12480, z: -10880, alt: 7350, r: 3040 },
  { name: '', x: -15680, z: -9920, alt: 6750, r: 3200 },
  { name: '', x: -21600, z: 5440, alt: 6600, r: 3360 },
  { name: '', x: -13760, z: 14080, alt: 6580, r: 2880 },
  { name: '', x: 8640, z: 15360, alt: 6880, r: 3040 },
  { name: '', x: 20480, z: -3840, alt: 7500, r: 3840 },
  { name: '', x: -3840, z: 20480, alt: 6400, r: 3680 },
  { name: '', x: 26400, z: 13120, alt: 7300, r: 4160 },
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
  // Inside the hero rectangle the far mesh follows the hero surface at the
  // boundary — anything else leaves the edge triangles standing as a cliff,
  // the plinth the massif appeared to sit on — then dives away beneath it.
  //
  // The dive is what makes it safe. This mesh samples every ~240 m where the
  // hero grid samples every ~15 m, so on fluted ridges it cuts straight
  // across gullies the hero surface actually carves; tucked a token 8 m under,
  // its dark rock stabbed up through every ridge line as a row of black
  // sawteeth. Sinking it far below within one cell of the boundary buries the
  // error under the hero mesh, and buildFarRange drops the interior entirely.
  if (dOut < 1e-6) {
    const dIn = Math.min(x - GRID.x0, GRID.x1 - x, z - GRID.z0, GRID.z1 - z);
    const s = Math.min(1, Math.max(0, dIn / 1120));
    return heightAt(x, z) - 30 - 900 * (s * s * (3 - 2 * s));
  }
  // Ridged noise: fold value noise into sharp crests, two octaves, with
  // the domain skewed so ranges run with the Himalaya's grain.
  const sx = x * 0.82 + z * 0.42;
  const sz = z * 0.86 - x * 0.30;
  const r1 = 1 - Math.abs(vnoise(sx, sz, 4960) * 2 - 1);
  const r2 = 1 - Math.abs(vnoise(sx + 913, sz + 411, 2160) * 2 - 1);
  const rangeMask = Math.pow(vnoise(x - 511, z + 733, 13120), 1.5);
  const dist = Math.hypot(x, z);
  // Ranges grow with distance from the massif. Without this ramp the far
  // terrain reaches full height the instant it leaves the hero grid, and
  // the grid reads as a flat pan sunk inside a ring of peaks.
  // Every ramp out here is a function of dOut, and dOut is the distance to a
  // RECTANGLE — so every contour it draws, the snowline included, comes out
  // rectangular, and the massif ends up sitting on a visible tan slab the exact
  // shape of the hero grid. Warping the distance breaks that: the terrain
  // still rises away from the massif, but along an irregular front, so nothing
  // traces the grid. The warp vanishes at dOut = 0, so the seam stays matched.
  const warp = 0.55 + 0.95 * vnoise(x + 4400, z - 2100, 8320)
    + 0.34 * (vnoise(x - 900, z + 1750, 3040) - 0.5);
  const dW = dOut * warp;
  // Hold the ranges down for the first few kilometres. Inside the grid the
  // terrain is the massif's low outwash plain; if the far ranges start rising
  // the instant they leave it, the plain's edge IS the grid's edge and the
  // whole thing reads as a slab the mountain was placed on. Letting the plain
  // run on — along a warped, irregular front — puts the rise somewhere that
  // has nothing to do with the rectangle.
  const grow = Math.min(1, Math.max(0, dW - 2200) / 14000);
  const farAmp = (950 + Math.min(1, dist / 35000) * 1500) * 2.1 * (grow * grow * (3 - 2 * grow));
  const base = 4150 + (vnoise(x + 31, z - 87, 9920) - 0.5) * 650;
  let h = base + (r1 * 0.66 + r2 * 0.34) * rangeMask * farAmp;
  for (const p of FAR_PEAKS) {
    const t = Math.max(0, 1 - Math.hypot(x - p.x, z - p.z) / (p.r * 2.1));
    if (t > 0) {
      const serr = 0.84 + 0.16 * r2;
      h = Math.max(h, 4300 + (p.alt - 4300) * Math.pow(t, 1.55) * serr);
    }
  }
  // The hero grid is a rectangle sitting ~600 m above the far terrain's
  // base. Blended over a kilometre that edge reads as a floating slab, so
  // the transition is a 4 km apron instead: the massif's outwash plain
  // running down into the valley system, which is what is actually there.
  const t = Math.min(1, dW / 6400);
  // Tucked under the hero mesh so the two never z-fight at the seam. 30 m is
  // invisible across a 4 km apron and clears the coarse mesh's sampling error.
  const edgeH = heightAt(cx, cz) - 30;
  return edgeH * (1 - t) + h * (t * t * (3 - 2 * t));
}

const FAR_ALB = {
  snow: hex('#dfe9f6'), snowHi: hex('#edf3fb'),
  rock: hex('#464b57'),
};

export function farAlbedoAt(x: number, z: number, y: number, slopeDeg: number): [number, number, number] {
  const n = vnoise(x + 77, z - 13, 1100);
  const rock = mix(FAR_ALB.rock, FAR_ALB.snow, Math.max(0, n - 0.55));
  const snow = mix(FAR_ALB.snow, FAR_ALB.snowHi, 0.2 + n * 0.6);
  // This mesh samples every ~280 m, so its slopes are a fraction of the hero
  // terrain's; asking for 46-62 degrees out here meant the far ranges never
  // showed any rock at all and the whole horizon read as a white blanket.
  let base = mix(snow, rock, smoothStep(24, 42, slopeDeg));
  // Feathered, and on the SAME snowline the hero terrain uses. A hard cut here
  // put a crisp tan/white contour across the far range; a snowline 400 m below
  // the hero's put that contour right where the two meshes meet, so it traced
  // the grid boundary. The ground below it is the hero terrain's own, for the
  // same reason: any constant offset paints the grid as a rectangle.
  base = mix(base, groundAlbedo(x, z, slopeDeg, 0), 1 - snowAmt(y, n));
  return base;
}

/**
 * How much snow lies at this altitude, 0..1 — shared by the hero terrain and
 * the far range so the two never disagree about where the snowline is.
 */
function snowAmt(y: number, n: number): number {
  const line = SNOWLINE + (n - 0.5) * 260;
  return smoothStep(line, line + 420, y);
}

const SNOWLINE = 5320;

export interface FarRangeData {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** Build the far-range mesh: coarse, jittered, AO-shaded, huge. */
export function buildFarRange(): FarRangeData {
  const fx0 = -46000, fx1 = 42000, fz0 = -38000, fz1 = 42000;
  const nx = 314, nz = 286;
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
      // Jitter breaks up the grid's regularity, but not at the outer rim (it
      // would tear the horizon) and not near the hero rectangle, where a
      // 195 m nudge would drag seam vertices across the boundary and buckle
      // the join.
      const nearHero =
        x > GRID.x0 - dx * 1.5 && x < GRID.x1 + dx * 1.5 &&
        z > GRID.z0 - dz * 1.5 && z < GRID.z1 + dz * 1.5;
      const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1 || nearHero;
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
  // Cut a hole where the hero terrain lives. The far range is a SURROUND, not
  // a second copy of the mountain: any triangle it draws inside the hero
  // rectangle is a coarse guess at a surface already drawn properly, and it
  // only ever shows up as an artefact poking through. One straddling ring is
  // kept so the two meshes still meet with no gap at the seam.
  const inside = (k: number) => {
    const x = positions[k * 3];
    const z = positions[k * 3 + 2];
    return x > GRID.x0 && x < GRID.x1 && z > GRID.z0 && z < GRID.z1;
  };
  const tris: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (inside(a) && inside(b) && inside(c) && inside(d)) continue;
      tris.push(a, c, b, b, c, d);
    }
  }
  return { positions, colors, indices: Uint32Array.from(tris) };
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

/**
 * Every preset frames a leg of the route on the real surface: the target sits
 * ON the terrain, and the camera stands DOWN-ROUTE of it, so the shot looks up
 * the mountain with the massif behind its subject and the sightline clears the
 * ground between. Aiming by the local downhill alone is not enough — at Base
 * Camp that points out along the flat glacier, and the camera framed a blank
 * pan with the mountain behind its back. Hand-chosen positions could not
 * survive a terrain swap; these were derived from the heightfield itself.
 */
export const CAM_PRESETS: CamPreset[] = [
  { id: 'overview', label: 'Massif', target: [-2600, 6614, 1600], pos: [-9604, 10814, 6591] },
  { id: 'bc', label: 'Base Camp', target: [-4563, 5350, 2435], pos: [-6312, 5440, 2484] },
  { id: 'icefall', label: 'Icefall', target: [-3925, 5694, 2157], pos: [-5235, 5814, 3240] },
  { id: 'cwm', label: 'Cwm', target: [-3070, 6216, 1783], pos: [-4550, 6356, 2033] },
  { id: 'face', label: 'Lhotse Face', target: [-2450, 6768, 1507], pos: [-4103, 6968, 2633] },
  { id: 'col', label: 'South Col', target: [-1230, 7936, 845], pos: [-3011, 8176, 1507] },
  { id: 'ridge', label: 'Summit Ridge', target: [-407, 8670, 359], pos: [-1585, 8850, 1441] },
];

/** The finale pull-back: the whole Himalaya below the winner. */
export const CAM_SUMMIT_WIDE: CamPreset = {
  id: 'wide', label: 'The Top of the World',
  target: [-900, 8263, 800], pos: [-8086, 13863, 7014],
};
