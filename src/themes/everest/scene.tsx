'use client';

/**
 * The painted mountain: a faceted Everest massif under a race-long lighting
 * arc. The race begins at first light, climbs through hard alpine day,
 * catches fire at alpenglow as the field converges on the Col, and the
 * summit push happens under stars. Storms grey the world out on top of
 * whatever hour it is.
 *
 * Pure presentation: everything here is derived from (u = t/duration,
 * storm intensity) — data the client already renders — and repaints the
 * same geometry the markers have always moved on.
 */

import { memo } from 'react';
import { VIEW_W, VIEW_H } from './map-geometry';

/* ------------------------------------------------------------------ */
/* lighting                                                            */
/* ------------------------------------------------------------------ */

export interface SceneLight {
  skyTop: string;
  skyMid: string;
  horizon: string;
  glow: string;      // horizon bloom / sun tint
  snowLit: string;
  snowShade: string;
  rockLit: string;
  rockShade: string;
  stars: number;     // 0..1
  sunU: number;      // 0..1 across its arc; outside (0,1) = below the ridge
  moon: number;      // 0..1 visibility
  darkness: number;  // 0..1 — headlamps, camp lights, route glow
  haze: number;      // 0..1 — atmospheric perspective strength
  cloud: number;     // 0..1 — drifting cloud opacity
}

interface Key extends Omit<SceneLight, 'sunU'> { u: number; sunU: number }

const KEYS: Key[] = [
  // first light — cold violet, a rose seam on the horizon
  { u: 0.0, skyTop: '#070a18', skyMid: '#1c2544', horizon: '#5c3a55', glow: '#d06a72',
    snowLit: '#c9d4ec', snowShade: '#5e7099', rockLit: '#3e4b68', rockShade: '#242e47',
    stars: 0.55, sunU: -0.06, moon: 0, darkness: 0.5, haze: 0.34, cloud: 0.5 },
  // morning — the world switches on
  { u: 0.16, skyTop: '#0a1428', skyMid: '#28476f', horizon: '#7fa2c2', glow: '#f2ba6e',
    snowLit: '#eff5fe', snowShade: '#92a7cb', rockLit: '#566580', rockShade: '#2d3955',
    stars: 0, sunU: 0.2, moon: 0, darkness: 0.08, haze: 0.22, cloud: 0.75 },
  // high alpine day — thin air, deep zenith
  { u: 0.44, skyTop: '#081124', skyMid: '#20406a', horizon: '#6f96ba', glow: '#ece0ab',
    snowLit: '#f5f9ff', snowShade: '#9fb4d6', rockLit: '#5b6b86', rockShade: '#313d59',
    stars: 0, sunU: 0.55, moon: 0, darkness: 0, haze: 0.15, cloud: 0.9 },
  // late afternoon — light goes long and warm
  { u: 0.68, skyTop: '#0b102a', skyMid: '#31406b', horizon: '#97819c', glow: '#f2a76e',
    snowLit: '#f2eef3', snowShade: '#95a2c6', rockLit: '#556180', rockShade: '#2e3854',
    stars: 0, sunU: 0.84, moon: 0, darkness: 0.06, haze: 0.2, cloud: 0.7 },
  // alpenglow — the Col approach; the mountain catches fire
  { u: 0.8, skyTop: '#130d28', skyMid: '#402e58', horizon: '#b25a58', glow: '#ff8a5e',
    snowLit: '#f7cdb2', snowShade: '#7e6f9f', rockLit: '#514769', rockShade: '#2a2444',
    stars: 0.18, sunU: 0.97, moon: 0.1, darkness: 0.3, haze: 0.27, cloud: 0.55 },
  // nightfall — headlamps come on at the Col
  { u: 0.885, skyTop: '#05070f', skyMid: '#141b38', horizon: '#283351', glow: '#8fa6cf',
    snowLit: '#a9bcdc', snowShade: '#485a80', rockLit: '#2c3a58', rockShade: '#161e33',
    stars: 0.8, sunU: 1.2, moon: 0.7, darkness: 0.92, haze: 0.24, cloud: 0.35 },
  // deep night — the summit push under stars
  { u: 1.0, skyTop: '#03050c', skyMid: '#0d1329', horizon: '#1c2540', glow: '#7e96c2',
    snowLit: '#9fb2d4', snowShade: '#3f5076', rockLit: '#25324e', rockShade: '#12192c',
    stars: 1, sunU: 1.2, moon: 0.9, darkness: 1, haze: 0.2, cloud: 0.3 },
];

const STORM: Omit<Key, 'u'> = {
  skyTop: '#0b0e15', skyMid: '#222936', horizon: '#3a4350', glow: '#68717f',
  snowLit: '#c9cfda', snowShade: '#69748a', rockLit: '#454e5f', rockShade: '#252b38',
  stars: 0, sunU: 1.2, moon: 0, darkness: 0.55, haze: 0.85, cloud: 1,
};

function hexToRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${[c(ar, br), c(ag, bg), c(ab, bb)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
const mixNum = (a: number, b: number, t: number) => a + (b - a) * t;

export function sceneLight(u: number, storm: number): SceneLight {
  const cu = Math.max(0, Math.min(1, u));
  let i = 0;
  while (i < KEYS.length - 2 && cu > KEYS[i + 1].u) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const span = b.u - a.u || 1;
  const t0 = Math.max(0, Math.min(1, (cu - a.u) / span));
  const t = t0 * t0 * (3 - 2 * t0);

  const pick = (k: keyof Omit<Key, 'u'>): string | number => {
    const av = a[k] as string | number;
    const bv = b[k] as string | number;
    return typeof av === 'string' ? mixHex(av, bv as string, t) : mixNum(av, bv as number, t);
  };

  const base: SceneLight = {
    skyTop: pick('skyTop') as string,
    skyMid: pick('skyMid') as string,
    horizon: pick('horizon') as string,
    glow: pick('glow') as string,
    snowLit: pick('snowLit') as string,
    snowShade: pick('snowShade') as string,
    rockLit: pick('rockLit') as string,
    rockShade: pick('rockShade') as string,
    stars: pick('stars') as number,
    sunU: pick('sunU') as number,
    moon: pick('moon') as number,
    darkness: pick('darkness') as number,
    haze: pick('haze') as number,
    cloud: pick('cloud') as number,
  };

  const s = Math.max(0, Math.min(1, storm)) * 0.9;
  if (s === 0) return base;
  return {
    skyTop: mixHex(base.skyTop, STORM.skyTop, s),
    skyMid: mixHex(base.skyMid, STORM.skyMid, s),
    horizon: mixHex(base.horizon, STORM.horizon, s),
    glow: mixHex(base.glow, STORM.glow, s),
    snowLit: mixHex(base.snowLit, STORM.snowLit, s),
    snowShade: mixHex(base.snowShade, STORM.snowShade, s),
    rockLit: mixHex(base.rockLit, STORM.rockLit, s),
    rockShade: mixHex(base.rockShade, STORM.rockShade, s),
    stars: mixNum(base.stars, 0, s),
    sunU: base.sunU,
    moon: mixNum(base.moon, 0, s),
    darkness: Math.max(base.darkness, mixNum(base.darkness, STORM.darkness, s)),
    haze: mixNum(base.haze, STORM.haze, s),
    cloud: mixNum(base.cloud, STORM.cloud, s),
  };
}

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

/** The main ridgeline, base-camp valley to summit (the route hugs this). */
const RIDGE: [number, number][] = [
  [60, 1330], [175, 1272], [300, 1140], [360, 1080], [480, 930], [540, 880],
  [620, 720], [660, 655], [740, 500], [775, 445], [845, 320], [890, 225], [940, 112],
];

/** Interior spine: one anchor under each ridge vertex, into the SW face. */
const SPINE: [number, number][] = [
  [195, 1398], [305, 1332], [418, 1218], [472, 1152], [588, 1004], [648, 952],
  [728, 792], [768, 727], [842, 572], [872, 517], [922, 392], [946, 300], [962, 216],
];

type Mat = 'snowLit' | 'snowShade' | 'rockLit' | 'rockShade';

interface Facet { pts: [number, number][]; mat: Mat; edge?: boolean }

/** Facet the SW face: two triangles per ridge segment, alternating light,
 *  with a rock band through the Lhotse-face altitudes (segments 6–9). */
function buildFacets(): Facet[] {
  const out: Facet[] = [];
  for (let i = 0; i < RIDGE.length - 1; i++) {
    const rock = i >= 6 && i <= 8;
    const upper: Mat = rock ? (i % 2 ? 'rockLit' : 'snowLit') : i % 2 ? 'snowLit' : 'snowLit';
    const lower: Mat = rock ? 'rockShade' : i % 3 === 1 ? 'snowShade' : 'snowShade';
    out.push({ pts: [RIDGE[i], RIDGE[i + 1], SPINE[i]], mat: upper, edge: true });
    out.push({ pts: [RIDGE[i + 1], SPINE[i + 1], SPINE[i]], mat: lower });
  }
  return out;
}
const FACETS = buildFacets();

/** Second, deeper band of shadow facets under the spine. */
const UNDER: Facet[] = SPINE.slice(0, -1).map((p, i) => ({
  pts: [p, SPINE[i + 1], [Math.min(1000, SPINE[i + 1][0] + 150), Math.min(1400, SPINE[i + 1][1] + 210)], [Math.min(1000, p[0] + 150), Math.min(1400, p[1] + 230)]],
  mat: (i % 3 === 2 ? 'rockShade' : 'snowShade') as Mat,
}));

/** Full massif silhouette (paint first, beneath the facets). */
const MASSIF_PATH =
  'M0 1400 L0 1352 L60 1330 L175 1272 L300 1140 L360 1080 L480 930 L540 880 ' +
  'L620 720 L660 655 L740 500 L775 445 L845 320 L890 225 L940 112 ' +
  'L968 190 L1000 330 L1000 1400 Z';

/** East face (right of the summit): mostly in shadow, catches alpenglow. */
const EAST_FACE = 'M940 112 L968 190 L1000 330 L1000 640 L952 430 L928 288 Z';

/** Far ranges (atmospheric perspective layers). */
const FAR_A =
  'M0 1400 L0 828 L88 758 L176 812 L288 700 L378 768 L468 688 L558 758 L642 698 L758 778 L858 718 L1000 788 L1000 1400 Z';
const FAR_B =
  'M0 1400 L0 982 L118 902 L238 958 L358 862 L468 928 L598 850 L718 928 L848 868 L1000 938 L1000 1400 Z';

/** Most distant ridge, just over the horizon line. */
const FAR_C =
  'M0 1400 L0 742 L96 700 L210 742 L330 668 L442 726 L556 660 L668 716 L788 662 L900 712 L1000 676 L1000 1400 Z';

/** Foreground glacier tumble. */
const GLACIER =
  'M0 1400 L0 1330 L90 1305 L200 1330 L330 1290 L470 1330 L620 1300 L780 1345 L1000 1310 L1000 1400 Z';

/** Snow streaks on the lit face (painterly detail, very low opacity). */
const STREAKS = [
  'M310 1135 Q360 1190 372 1240', 'M492 926 Q540 980 548 1030',
  'M628 716 Q668 770 676 820', 'M748 498 Q788 550 794 600',
  'M852 318 Q884 360 890 402', 'M212 1258 Q262 1300 274 1338',
];

/** Crevasse marks in the icefall. */
const CREVASSES = [
  'M150 1300 l38 -8', 'M205 1318 l34 -10', 'M258 1272 l30 -9',
  'M118 1332 l30 -6', 'M304 1300 l26 -8',
];

/** Deterministic star field. */
const STARS: [number, number, number][] = Array.from({ length: 110 }, (_, i) => {
  const h = (i * 2654435761) >>> 0;
  const x = h % 1000;
  const y = (h >>> 10) % 560;
  const r = 0.4 + ((h >>> 20) % 10) / 14;
  return [x, y, Math.round(r * 10) / 10];
});

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

function sunXY(sunU: number): [number, number] {
  const x = 110 + sunU * 780;
  const y = 470 - Math.sin(Math.PI * Math.max(0, Math.min(1, sunU))) * 340;
  return [x, y];
}

export const MountainScene = memo(function MountainScene({ light }: { light: SceneLight }) {
  const L = light;
  const sunVisible = L.sunU > 0.01 && L.sunU < 0.99;
  const [sx, sy] = sunXY(L.sunU);
  const matFill: Record<Mat, string> = {
    snowLit: L.snowLit,
    snowShade: L.snowShade,
    rockLit: L.rockLit,
    rockShade: L.rockShade,
  };

  return (
    <g aria-hidden>
      <defs>
        <linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={L.skyTop} />
          <stop offset="58%" stopColor={L.skyMid} />
          <stop offset="86%" stopColor={L.horizon} />
          <stop offset="100%" stopColor={L.horizon} />
        </linearGradient>
        <radialGradient id="sunG" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor={L.glow} stopOpacity="0.85" />
          <stop offset="35%" stopColor={L.glow} stopOpacity="0.28" />
          <stop offset="100%" stopColor={L.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hazeG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={L.horizon} stopOpacity="0" />
          <stop offset="100%" stopColor={L.horizon} stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="massBaseG" x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0%" stopColor={L.snowShade} />
          <stop offset="55%" stopColor={mixHex(L.snowShade, L.skyTop, 0.4)} />
          <stop offset="100%" stopColor={mixHex(L.snowShade, L.skyTop, 0.62)} />
        </linearGradient>
        <radialGradient id="summitGlowG" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ffe9c9" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#ffe9c9" stopOpacity="0" />
        </radialGradient>
        <filter id="softBlur" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
        <filter id="cloudBlur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
      </defs>

      {/* sky */}
      <rect x="-120" y="-120" width={VIEW_W + 240} height={VIEW_H + 240} fill="url(#skyG)" />

      {/* stars */}
      {L.stars > 0.02 && (
        <g opacity={L.stars}>
          {STARS.map(([x, y, r], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={r}
              fill="#e6eefb"
              className={i % 7 === 0 ? 'mtn-star-twinkle' : undefined}
              opacity={0.4 + ((i * 37) % 10) / 16}
            />
          ))}
        </g>
      )}

      {/* sun */}
      {sunVisible && (
        <g>
          <circle cx={sx} cy={sy} r={95} fill="url(#sunG)" />
          <circle cx={sx} cy={sy} r={20} fill={L.glow} opacity={0.5} />
          <circle cx={sx} cy={sy} r={13} fill="#fff8e9" />
        </g>
      )}
      {/* horizon bloom at dawn/dusk even while the sun itself is hidden */}
      {!sunVisible && L.stars < 0.6 && (
        <ellipse cx={L.sunU < 0.5 ? 170 : 830} cy={760} rx={330} ry={150} fill="url(#sunG)" opacity={0.5} />
      )}

      {/* moon */}
      {L.moon > 0.02 && (
        <g opacity={L.moon} transform="translate(212, 168)">
          <circle r={40} fill="#cfe0f5" opacity={0.1} filter="url(#softBlur)" />
          <circle r={14} fill="#e8eefc" />
          <circle cx={5.5} cy={-3.5} r={12} fill={mixHex(L.skyTop, L.skyMid, 0.5)} />
        </g>
      )}

      {/* far ranges, hazed */}
      <path d={FAR_C} fill={mixHex(L.skyMid, L.horizon, 0.42)} opacity={0.85} />
      <path d={FAR_A} fill={mixHex(L.skyMid, L.horizon, 0.28)} />
      <rect x="0" y="660" width={VIEW_W} height="220" fill="url(#hazeG)" opacity={L.haze * 0.45} />
      <path d={FAR_B} fill={mixHex(L.horizon, L.snowShade, 0.55)} />
      <rect x="0" y="850" width={VIEW_W} height="230" fill="url(#hazeG)" opacity={L.haze * 0.6} />

      {/* drifting clouds */}
      <g opacity={L.cloud * 0.6} className="mtn-cloud mtn-cloud-a" filter="url(#cloudBlur)">
        <ellipse cx="240" cy="470" rx="150" ry="30" fill={mixHex(L.horizon, '#ffffff', 0.35)} />
        <ellipse cx="330" cy="452" rx="100" ry="22" fill={mixHex(L.horizon, '#ffffff', 0.3)} />
      </g>
      <g opacity={L.cloud * 0.45} className="mtn-cloud mtn-cloud-b" filter="url(#cloudBlur)">
        <ellipse cx="700" cy="580" rx="180" ry="26" fill={mixHex(L.horizon, '#ffffff', 0.3)} />
        <ellipse cx="600" cy="600" rx="110" ry="20" fill={mixHex(L.horizon, '#ffffff', 0.25)} />
      </g>

      {/* the massif */}
      <path d={MASSIF_PATH} fill="url(#massBaseG)" />
      {UNDER.map((f, i) => (
        <polygon key={`u${i}`} points={f.pts.map((p) => p.join(',')).join(' ')} fill={matFill[f.mat]} opacity={0.55} />
      ))}
      {FACETS.map((f, i) => (
        <polygon
          key={`f${i}`}
          points={f.pts.map((p) => p.join(',')).join(' ')}
          fill={matFill[f.mat]}
          opacity={f.mat.startsWith('rock') ? 0.96 : 0.92}
        />
      ))}
      <path d={EAST_FACE} fill={L.rockShade} opacity={0.9} />

      {/* rock spurs running down the big face */}
      <g fill={L.rockShade} opacity={0.4}>
        <polygon points="620,720 648,952 700,1080 660,1140 610,960" />
        <polygon points="740,500 800,700 860,900 820,940 750,700" />
        <polygon points="845,320 900,470 950,640 918,660 862,470" />
      </g>

      {/* painterly snow streaks + icefall crevasses */}
      <g stroke={mixHex(L.snowLit, '#ffffff', 0.4)} strokeWidth={2} fill="none" opacity={0.2} strokeLinecap="round">
        {STREAKS.map((d, i) => <path key={i} d={d} />)}
      </g>
      <g stroke={mixHex(L.snowShade, '#0a1428', 0.5)} strokeWidth={2.5} fill="none" opacity={0.5} strokeLinecap="round">
        {CREVASSES.map((d, i) => <path key={i} d={d} />)}
      </g>

      {/* summit: wind plume + glow */}
      <path
        d="M940 112 Q1000 96 1052 108"
        stroke={mixHex(L.snowLit, '#ffffff', 0.5)}
        strokeWidth={7}
        strokeLinecap="round"
        fill="none"
        opacity={0.3}
        filter="url(#softBlur)"
        className="mtn-plume"
      />
      <circle cx={936} cy={118} r={58} fill="url(#summitGlowG)" className="mtn-beacon" opacity={0.4 + L.darkness * 0.3} />

      {/* foreground glacier */}
      <path d={GLACIER} fill={mixHex(L.snowShade, L.skyTop, 0.35)} />

      {/* valley haze at the very bottom */}
      <rect x="0" y="1240" width={VIEW_W} height="160" fill="url(#hazeG)" opacity={L.haze * 0.7} />
    </g>
  );
});
