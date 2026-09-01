'use client';

/**
 * The mountain in three dimensions. This view replaces the painted profile
 * with a navigable massif: cartographic at distance (cream contours over
 * cold terrain), matte at altitude (the high mountain goes abstract as it
 * gets dangerous), teams as lights with vertical beams, and a sun driven
 * by the race clock so the summit push happens under stars and alpenglow
 * arrives exactly when it should.
 *
 * Everything rendered here derives from already-served race data: display
 * positions, storm windows, and (elapsed / duration). Nothing can leak or
 * bend the outcome — the mountain is a stage, not a referee.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { JourneySnapshot } from '@/lib/slice';
import { displayPosAt, edgeChoicesAt, teamStatesAt, teamTags } from '@/lib/client/raceState';
import { sceneLight } from '@/themes/everest/scene';
import {
  buildBranches,
  buildContours,
  buildFarRange,
  buildTerrain,
  CAM_PRESETS,
  CAM_SUMMIT_WIDE,
  heightAt,
  posToXYZ,
  ROUTE3,
  sunDir,
  WP3,
} from '@/themes/everest/terrain3d';

interface Props {
  snap: JourneySnapshot;
  teamNames: string[];
  tMs: number;
  durationMs: number;
  selected: number | null;
  onSelect: (i: number | null) => void;
  finale: boolean;
}

/** Waypoint labels: id → [world point, tier]. Tier 0 always shows. */
const LABELS: { id: string; name: string; alt: string; tier: 0 | 1 }[] = [
  { id: 'BC', name: 'Base Camp', alt: '5,364 m', tier: 0 },
  { id: 'C1', name: 'Camp I', alt: '6,065 m', tier: 1 },
  { id: 'C2', name: 'Camp II', alt: '6,400 m', tier: 0 },
  { id: 'C3', name: 'Camp III', alt: '7,160 m', tier: 1 },
  { id: 'C4', name: 'South Col', alt: '7,950 m', tier: 0 },
  { id: 'BALC', name: 'The Balcony', alt: '8,400 m', tier: 1 },
  { id: 'SSUM', name: 'South Summit', alt: '8,749 m', tier: 1 },
  { id: 'SUMMIT', name: 'Summit', alt: '8,849 m', tier: 0 },
];

/** Start frac of each route segment, for "which leg is this team on". */
const ROUTE_SEG_FRACS = [0, 0.16, 0.32, 0.52, 0.7, 0.82, 0.92, 0.96];

/** A team is a light, not a badge: bright core, color ring, soft falloff. */
function lightTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const soft = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  soft.addColorStop(0, color);
  soft.addColorStop(0.45, color + '66');
  soft.addColorStop(1, color + '00');
  g.fillStyle = soft;
  g.fillRect(0, 0, 128, 128);
  g.beginPath();
  g.arc(64, 64, 26, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(6, 10, 20, 0.8)';
  g.stroke();
  g.beginPath();
  g.arc(64, 64, 13, 0, Math.PI * 2);
  g.fillStyle = '#fdfefe';
  g.fill();
  return new THREE.CanvasTexture(c);
}

function glowTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color + 'aa');
  grad.addColorStop(1, color + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** The moon is a body, not a blur: a crisp disc inside a tight bloom. */
function moonTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const bloom = g.createRadialGradient(64, 64, 18, 64, 64, 64);
  bloom.addColorStop(0, 'rgba(226, 234, 250, 0.55)');
  bloom.addColorStop(1, 'rgba(226, 234, 250, 0)');
  g.fillStyle = bloom;
  g.fillRect(0, 0, 128, 128);
  g.beginPath();
  g.arc(64, 64, 20, 0, Math.PI * 2);
  g.fillStyle = '#eef3fd';
  g.fill();
  // A hint of maria so the disc reads lunar, not lamp.
  g.globalAlpha = 0.16;
  g.fillStyle = '#9fb0cf';
  g.beginPath(); g.arc(57, 58, 7, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(70, 68, 5, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  return new THREE.CanvasTexture(c);
}

function beamTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, color + '99');
  grad.addColorStop(1, color + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 128);
  return new THREE.CanvasTexture(c);
}

export function MountainMap3D(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [mode, setMode] = useState<'ambient' | 'manual'>('ambient');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const presetReq = useRef<string | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const labelHost = labelsRef.current;
    if (!wrap || !labelHost) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    // Filmic response: highlights roll off instead of clipping, so sunlit
    // snow keeps its form. The sky shader applies the same curve itself.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    wrap.appendChild(renderer.domElement);
    renderer.domElement.className = 'm3d-canvas';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, 1, 40, 90000);
    camera.position.set(...CAM_PRESETS[0].pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...CAM_PRESETS[0].target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 650;
    controls.maxDistance = 16000;
    controls.maxPolarAngle = 1.48;
    controls.enablePan = false;
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = 0.32;

    // --- sky dome -------------------------------------------------------
    // The sky is a shader, not a gradient: three star layers and the Milky
    // Way wheel slowly overhead at night, a warm mound of light gathers
    // around the sun at dawn and dusk, and a storm drains it all to murk.
    const skyUniforms = {
      topC: { value: new THREE.Color('#0b1530') },
      midC: { value: new THREE.Color('#27436b') },
      horC: { value: new THREE.Color('#8ea6c8') },
      glowC: { value: new THREE.Color('#ffb46b') },
      uSun: { value: new THREE.Vector3(1, 0.2, 0) },
      uStars: { value: 0 },
      uStorm: { value: 0 },
      uBand: { value: 0 },
      uDay: { value: 1 },
      uTime: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(46000, 48, 28),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: skyUniforms,
        vertexShader:
          'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          varying vec3 vP;
          uniform vec3 topC; uniform vec3 midC; uniform vec3 horC; uniform vec3 glowC;
          uniform vec3 uSun;
          uniform float uStars; uniform float uStorm; uniform float uBand;
          uniform float uDay; uniform float uTime;
          float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float h31(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float n2(vec2 p){
            vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
                       mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
          }
          float fbm(vec2 p){ return n2(p) * 0.55 + n2(p * 2.13 + 7.7) * 0.28 + n2(p * 4.41 + 3.1) * 0.17; }
          float starLayer(vec3 p, float density, float sharp){
            vec3 id = floor(p);
            float m = h31(id);
            if (m > density) return 0.0;
            vec3 f = fract(p) - 0.5;
            vec3 jit = vec3(h31(id + 17.1), h31(id + 31.7), h31(id + 47.3)) - 0.5;
            float d = length(f - jit * 0.7);
            float mag = pow(h31(id + 3.7), 5.0);
            float tw = 0.72 + 0.28 * sin(uTime * (1.5 + h31(id + 9.1) * 4.0) + h31(id + 13.0) * 40.0);
            return smoothstep(sharp * (0.6 + mag), 0.0, d) * (0.3 + mag * 2.2) * tw;
          }
          vec3 aces(vec3 x){
            return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
          }
          void main(){
            vec3 d = normalize(vP);
            float h = d.y;
            float lo = smoothstep(-0.04, 0.11, h);
            float hi = smoothstep(0.06, mix(0.55, 0.36, uBand), h);
            vec3 c = mix(horC, mix(midC, topC, hi), lo);
            // At dusk the fire stays low: the upper sky cools toward night
            // fast, so alpenglow reads as a band, not a ceiling.
            float coolUp = uBand * smoothstep(0.10, 0.32, h) * 0.4;
            c = mix(c, vec3(dot(c, vec3(0.3, 0.42, 0.28))) * 0.72, coolUp);

            // Dawn and dusk gather around the sun's azimuth, not everywhere.
            vec3 sunN = normalize(uSun);
            float az = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunN.x, 0.0, sunN.z))), 0.0);
            float mound = pow(az, 3.0) * exp(-max(h, 0.0) * 5.5);
            c += glowC * uBand * mound * 0.45;

            // The sun: a hot core inside the sprite bloom.
            float sd = max(dot(d, sunN), 0.0);
            float sunVis = smoothstep(-0.02, 0.06, sunN.y) * uDay;
            c += vec3(1.0, 0.86, 0.62) * (pow(sd, 2600.0) * 3.0 + pow(sd, 220.0) * 0.5 + pow(sd, 18.0) * 0.10) * sunVis;

            // Night: the whole sky comes out.
            float sv = uStars * (1.0 - uStorm) * smoothstep(0.0, 0.14, h);
            if (sv > 0.004) {
              float ca = cos(uTime * 0.004); float sa = sin(uTime * 0.004);
              vec3 r = vec3(d.x * ca - d.z * sa, d.y, d.x * sa + d.z * ca);
              vec3 M = normalize(vec3(0.42, 0.30, 0.86));
              vec3 T1 = normalize(cross(M, vec3(0.0, 1.0, 0.0)));
              vec3 T2 = cross(M, T1);
              float bc = dot(r, M);
              vec2 q = vec2(dot(r, T1), dot(r, T2)) * 3.0;
              float core = exp(-bc * bc * 26.0);
              float cloud = fbm(q * 2.2 + 11.0);
              float lane = smoothstep(0.42, 0.78, fbm(q * 3.1 + 4.7)) * exp(-bc * bc * 110.0);
              float mw = core * (0.30 + 0.75 * cloud) * (1.0 - 0.78 * lane);
              c += (vec3(0.55, 0.64, 0.82) + vec3(0.25, 0.16, 0.05) * cloud) * mw * 0.58 * sv;
              float s1 = starLayer(r * 60.0, 0.11, 0.22);
              float s2 = starLayer(r * 130.0 + 31.0, 0.2, 0.3);
              float s3 = starLayer(r * 260.0 + 77.0, 0.27 + core * 0.25, 0.38);
              vec3 warm = vec3(1.0, 0.90, 0.78);
              vec3 cold = vec3(0.78, 0.86, 1.0);
              c += mix(cold, warm, h31(floor(r * 60.0) + 29.0)) * s1 * 1.15 * sv;
              c += mix(cold, vec3(1.0), 0.5) * s2 * 0.8 * sv;
              c += vec3(0.9, 0.94, 1.0) * s3 * 0.5 * sv;
            }

            // Storm: color drains, the sky closes.
            float g = dot(c, vec3(0.333));
            c = mix(c, vec3(g) * 0.82 + vec3(0.05, 0.06, 0.08), uStorm * 0.55);

            // The palette is authored in display space and passed through
            // unconverted — write it raw so dusk stays the color it was
            // painted, with only the additive layers riding on top.
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    sky.position.y = 4000;
    scene.add(sky);

    // --- lights ---------------------------------------------------------
    const sun = new THREE.DirectionalLight('#ffe9c2', 1.6);
    scene.add(sun);
    scene.add(sun.target);
    const moon = new THREE.DirectionalLight('#b9c9e8', 0);
    scene.add(moon);
    scene.add(moon.target);
    // Ground colour is the GLACIER, not dirt. Snow throws a huge amount of
    // light back up onto the walls above it — the reason shaded faces in
    // Everest photographs read as cold blue-grey rather than black. Left at a
    // near-black navy, every shadowed rock face crushed to nothing and its
    // edge against the lit snow tore into a hard serrated line.
    const hemi = new THREE.HemisphereLight('#31507c', '#42566f', 0.7);
    scene.add(hemi);
    const amb = new THREE.AmbientLight('#1a2440', 0.25);
    scene.add(amb);
    scene.fog = new THREE.FogExp2('#8ea6c8', 0.000016);

    // --- terrain --------------------------------------------------------
    const tData = buildTerrain();
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tData.positions, 3));
    tGeo.setAttribute('color', new THREE.BufferAttribute(tData.colors, 3));
    tGeo.setIndex(new THREE.BufferAttribute(tData.indices, 1));
    tGeo.computeVertexNormals();
    const terrainMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      // Smooth normals: flat shading made every grid-aliased crest facet
      // flash light/dark; the color noise keeps the painterly variation.
      flatShading: false,
      // Give contours and the route room on the surface.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    // Surface character: wind-carved sastrugi on snow, striation on rock,
    // and a faint daylight glint — micro-relief the geometry can't afford,
    // faked in the normal before lighting runs.
    const hazeColor = new THREE.Color('#8ea6c8');
    const terrainUniforms = {
      uDay: { value: 1 },
      uSky: { value: new THREE.Color('#27436b') },
      uHaze: { value: hazeColor },
      uHazeK: { value: 1 / 30000 },
      uGlow: { value: new THREE.Color('#ff8a5e') },
      uBand: { value: 0 },
    };
    terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.uDay = terrainUniforms.uDay;
      shader.uniforms.uSky = terrainUniforms.uSky;
      shader.uniforms.uHaze = terrainUniforms.uHaze;
      shader.uniforms.uHazeK = terrainUniforms.uHazeK;
      shader.uniforms.uGlow = terrainUniforms.uGlow;
      shader.uniforms.uBand = terrainUniforms.uBand;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform float uDay;
uniform vec3 uSky;
uniform vec3 uHaze;
uniform float uHazeK;
uniform vec3 uGlow;
uniform float uBand;
float thash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(thash(i), thash(i + vec2(1.0, 0.0)), u.x),
             mix(thash(i + vec2(0.0, 1.0)), thash(i + vec2(1.0, 1.0)), u.x), u.y);
}`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
{
  float steep = 1.0 - abs(normal.y);
  vec2 pSnow = vec2(vWPos.x * 0.020, vWPos.z * 0.052);
  vec2 pRock = vec2(vWPos.x * 0.024, vWPos.y * 0.019);
  float nS = tnoise(pSnow) + 0.5 * tnoise(pSnow * 2.7 + 13.1) + 0.28 * tnoise(pSnow * 6.1 + 31.7);
  float nR = tnoise(pRock) + 0.5 * tnoise(pRock * 3.1 + 7.7);
  // Micro-relief must MODULATE the shading, not swing it. At mix(0.26, 0.5)
  // this tilted the normal by up to ~27 degrees at a 16 m period, and did it
  // hardest on steep ground — so along every ridge, where the face turns away
  // from the sun, fragments flipped in and out of sunlight and the terminator
  // grew a band of high-contrast fur.
  float amt = mix(0.15, 0.2, steep);
  vec2 g = vec2(
    tnoise(pSnow + vec2(0.13, 0.0)) - nS * 0.66,
    tnoise(pSnow + vec2(0.0, 0.13)) - nS * 0.66
  );
  vec2 gr = vec2(
    tnoise(pRock + vec2(0.11, 0.0)) - nR * 0.66,
    tnoise(pRock + vec2(0.0, 0.11)) - nR * 0.66
  );
  vec2 gm = mix(g, gr, smoothstep(0.35, 0.75, steep));
  normal = normalize(normal + vec3(gm.x, 0.0, gm.y) * amt);
  float glint = step(0.985, thash(floor(vWPos.xz * 0.9))) * (1.0 - steep) * uDay;
  diffuseColor.rgb += glint * 0.18;
  // Sky bounce: snow scatters the sky back at grazing angles, which is
  // what keeps real snowfields from ever reading as flat grey.
  vec3 V = normalize(vViewPosition);
  float rim = pow(1.0 - max(dot(normal, V), 0.0), 3.0);
  float snowMask = smoothstep(0.5, 0.8, dot(diffuseColor.rgb, vec3(0.3333)));
  diffuseColor.rgb += uSky * rim * snowMask * 0.16;
  // Alpenglow strikes the summits first: the last light climbs the peak.
  float blush = smoothstep(0.5, 1.0, (vWPos.y - 4750.0) / 4100.0);
  diffuseColor.rgb += uGlow * uBand * blush * snowMask * 0.3;
}`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
#ifdef USE_FOG
{
  float fh = 1.0 - exp(-pow(vFogDepth * uHazeK, 1.35));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, min(0.9, fh));
}
#endif`);
      terrainMat.userData.shader = shader;
    };
    const terrain = new THREE.Mesh(tGeo, terrainMat);
    scene.add(terrain);

    // Contours: the cartographic layer, fading out at altitude.
    const contourGroup = new THREE.Group();
    for (const level of buildContours(tData)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(level.segments, 3));
      const fade = Math.max(0, Math.min(1, (7900 - level.level) / 1500));
      const m = new THREE.LineBasicMaterial({
        color: '#77809b',
        transparent: true,
        opacity: 0.12 + fade * 0.26,
        depthWrite: false,
      });
      contourGroup.add(new THREE.LineSegments(g, m));
    }
    scene.add(contourGroup);

    // The far Himalaya: range upon range out to the horizon, dissolving
    // into the sky's own color with distance. Dawn happens behind Makalu;
    // the west holds Pumori and Cho Oyu; nothing out there is a cone.
    const farData = buildFarRange();
    const farGeo = new THREE.BufferGeometry();
    farGeo.setAttribute('position', new THREE.BufferAttribute(farData.positions, 3));
    farGeo.setAttribute('color', new THREE.BufferAttribute(farData.colors, 3));
    farGeo.setIndex(new THREE.BufferAttribute(farData.indices, 1));
    farGeo.computeVertexNormals();
    const farUniforms = {
      uHaze: { value: hazeColor },
      uHazeK: { value: 1 / 15500 },
    };
    const farMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    farMat.onBeforeCompile = (shader) => {
      shader.uniforms.uHaze = farUniforms.uHaze;
      shader.uniforms.uHazeK = farUniforms.uHazeK;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHaze;\nuniform float uHazeK;')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
#ifdef USE_FOG
{
  float fh = 1.0 - exp(-pow(vFogDepth * uHazeK, 1.35));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, min(0.86, fh));
}
#endif`);
    };
    scene.add(new THREE.Mesh(farGeo, farMat));

    // A sea of clouds fills the valleys below Base Camp: two drifting
    // decks with parallax, dense at dawn, burning off through the day,
    // gathering again at dusk and in storm.
    const mkCloudDeck = (y: number, scale: number, seed: number) => {
      const uniforms = {
        uTime: { value: 0 },
        uCov: { value: 0.5 },
        uCol: { value: new THREE.Color('#dfe7f2') },
        uOp: { value: 0.85 },
        uSeed: { value: seed },
      };
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms,
        vertexShader:
          'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          varying vec2 vUv;
          uniform float uTime; uniform float uCov; uniform vec3 uCol; uniform float uOp; uniform float uSeed;
          float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n2(vec2 p){
            vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
                       mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
          }
          float fbm(vec2 p){
            float a = 0.5; float s = 0.0;
            for (int k = 0; k < 4; k++) { s += a * n2(p); p = p * 2.17 + 13.7; a *= 0.5; }
            return s;
          }
          void main(){
            vec2 p = vUv * ${scale.toFixed(1)} + uSeed;
            p.x += uTime * 0.011;
            float n = fbm(p + fbm(p * 0.5 + uTime * 0.004) * 1.3);
            float a = smoothstep(1.0 - uCov, 1.0 - uCov + 0.34, n);
            vec2 e = abs(vUv - 0.5) * 2.0;
            a *= 1.0 - smoothstep(0.7, 1.0, max(e.x, e.y));
            float shade = 0.7 + 0.3 * smoothstep(0.2, 0.9, n);
            gl_FragColor = vec4(uCol * shade, a * uOp);
          }`,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(56000, 50000), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(-2000, y, 1000);
      mesh.renderOrder = 4;
      scene.add(mesh);
      return uniforms;
    };
    const cloudDecks = [mkCloudDeck(5010, 24, 3.7), mkCloudDeck(5120, 15, 91.3)];
    // Storm scud: a ragged ceiling that swallows the upper mountain when
    // the weather closes in, and does not exist otherwise.
    const scudDeck = mkCloudDeck(8750, 9, 47.9);

    // The signature: Everest's snow plume, streaming off the summit ridge.
    const PLUME_N = 320;
    const plumeGeo = new THREE.BufferGeometry();
    const plumePos = new Float32Array(PLUME_N * 3);
    const plumeAge = new Float32Array(PLUME_N);
    const plumeLane = new Float32Array(PLUME_N);
    for (let i = 0; i < PLUME_N; i++) {
      plumeAge[i] = Math.pow(i / PLUME_N, 1.5);
      plumeLane[i] = Math.sin(i * 12.9898) * 0.5 + Math.sin(i * 3.233) * 0.5;
    }
    plumeGeo.setAttribute('position', new THREE.BufferAttribute(plumePos, 3));
    const plumeMat = new THREE.PointsMaterial({
      color: '#e8f0fb', size: 84, sizeAttenuation: true, map: glowTexture('#ffffff'),
      transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const plume = new THREE.Points(plumeGeo, plumeMat);
    scene.add(plume);

    // --- the route and its choices --------------------------------------
    // Every leg offers a safe, a normal and a risky line. They are drawn as
    // three distinct paths on the mountain so the choice each team makes is
    // visible in the world, not just in the feed.
    const routePts = ROUTE3.map((p) => new THREE.Vector3(p.x, p.y + 14, p.z));
    const fixedLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(routePts),
      new THREE.LineBasicMaterial({ color: '#8a7a52', transparent: true, opacity: 0.3, depthWrite: false }),
    );
    scene.add(fixedLine);

    const RISK_COLOR: Record<string, string> = {
      safe: '#5fd0a8',
      medium: '#e8b957',
      risky: '#ef6a5c',
    };
    // Ribbons, not lines: GL clamps line width to one pixel on nearly every
    // driver, so a hairline vanishes at altitude. A flat strip laid on the
    // snow reads like a marked climbing line from any distance.
    const ribbonGeo = (pts: [number, number, number][], halfWidth: number) => {
      const pos = new Float32Array(pts.length * 2 * 3);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const len = Math.hypot(dx, dz) || 1;
        const nx = (-dz / len) * halfWidth;
        const nz = (dx / len) * halfWidth;
        const p = pts[i];
        pos[i * 6] = p[0] - nx; pos[i * 6 + 1] = p[1]; pos[i * 6 + 2] = p[2] - nz;
        pos[i * 6 + 3] = p[0] + nx; pos[i * 6 + 4] = p[1]; pos[i * 6 + 5] = p[2] + nz;
      }
      const idx: number[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const branchLines = buildBranches().map((br) => {
      const mat = new THREE.MeshBasicMaterial({
        color: RISK_COLOR[br.risk],
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ribbon = new THREE.Mesh(ribbonGeo(br.points, 17), mat);
      ribbon.renderOrder = 6;
      scene.add(ribbon);
      // A wider, softer twin so an active line reads as lit rope after dark.
      const glowMat = new THREE.MeshBasicMaterial({
        color: RISK_COLOR[br.risk],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const glow = new THREE.Mesh(ribbonGeo(br.points, 40), glowMat);
      glow.renderOrder = 7;
      glow.position.y = 6;
      scene.add(glow);
      return { br, mat, glowMat };
    });

    // --- camps ----------------------------------------------------------
    const campGroup = new THREE.Group();
    const tentMats: THREE.MeshLambertMaterial[] = [];
    const campSpec: [string, number, string[]][] = [
      ['BC', 8, ['#d9a13a', '#c5522e', '#b8862f', '#a34a2a']],
      ['C2', 5, ['#c9963a', '#b04c2c']],
      ['C3', 2, ['#a88a4a']],
      ['C4', 4, ['#8d7a55', '#7a6a4c']],
    ];
    for (const [id, count, palette] of campSpec) {
      const [cx, , cz] = WP3[id];
      for (let i = 0; i < count; i++) {
        const a = (i * 2.4) % (Math.PI * 2);
        const r = 40 + (i % 3) * 46;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r * 0.8;
        const mat = new THREE.MeshLambertMaterial({
          color: palette[i % palette.length],
          emissive: '#000000',
        });
        tentMats.push(mat);
        const tent = new THREE.Mesh(new THREE.ConeGeometry(26, 30, 4, 1), mat);
        tent.position.set(x, heightAt(x, z) + 15, z);
        tent.rotation.y = i * 1.1;
        campGroup.add(tent);
      }
    }
    scene.add(campGroup);

    // --- sun disc, moon, summit glow ------------------------------------
    // (Stars live in the sky shader now — thousands of them, twinkling.)
    const sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('#ffedc4'), blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0.95,
      }),
    );
    sunSprite.scale.set(9000, 9000, 1);
    scene.add(sunSprite);

    const moonSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: moonTexture(), blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0,
      }),
    );
    moonSprite.scale.set(1700, 1700, 1);
    scene.add(moonSprite);

    // The goal is the brightest thing in the scene, day or night.
    const summitGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('#ffe9c9'), blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0.6,
      }),
    );
    summitGlow.position.set(WP3.SUMMIT[0], WP3.SUMMIT[1] + 60, WP3.SUMMIT[2]);
    summitGlow.scale.set(620, 620, 1);
    scene.add(summitGlow);

    // --- snow (storm) ---------------------------------------------------
    const SNOW_N = 900;
    const snowGeo = new THREE.BufferGeometry();
    const snowPos = new Float32Array(SNOW_N * 3);
    for (let i = 0; i < SNOW_N; i++) {
      snowPos[i * 3] = (Math.sin(i * 12.9898) * 0.5 + 0.5) * 4200 - 2100;
      snowPos[i * 3 + 1] = (Math.sin(i * 78.233) * 0.5 + 0.5) * 2600;
      snowPos[i * 3 + 2] = (Math.sin(i * 39.425) * 0.5 + 0.5) * 4200 - 2100;
    }
    snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
    const snowMat = new THREE.PointsMaterial({
      color: '#e8f1fb', size: 3.4, sizeAttenuation: false,
      map: glowTexture('#ffffff'),
      transparent: true, opacity: 0, depthWrite: false,
    });
    const snow = new THREE.Points(snowGeo, snowMat);
    scene.add(snow);

    // --- team markers ---------------------------------------------------
    const n = propsRef.current.teamNames.length;
    const tags = teamTags(propsRef.current.teamNames);
    const colors = propsRef.current.snap.colors;
    const teamGroups: THREE.Group[] = [];
    const dotSprites: THREE.Sprite[] = [];
    const haloMats: THREE.SpriteMaterial[] = [];
    const beamMeshes: THREE.Mesh[] = [];
    const trailLines: THREE.Line[] = [];
    const ringMat = new THREE.SpriteMaterial({
      map: glowTexture('#ffffff'), transparent: true, opacity: 0.0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const selRing = new THREE.Sprite(ringMat);
    selRing.scale.set(280, 280, 1);
    scene.add(selRing);

    for (let i = 0; i < n; i++) {
      const grp = new THREE.Group();
      const dot = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: lightTexture(colors[i]),
          transparent: true, depthWrite: false, depthTest: false,
          sizeAttenuation: false,
        }),
      );
      dot.renderOrder = 30;
      dotSprites.push(dot);
      grp.add(dot);

      const haloMat = new THREE.SpriteMaterial({
        map: glowTexture(colors[i]), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0.5,
      });
      haloMats.push(haloMat);
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(74, 74, 1);
      grp.add(halo);

      const beam = new THREE.Mesh(
        new THREE.PlaneGeometry(42, 280),
        new THREE.MeshBasicMaterial({
          map: beamTexture(colors[i]), transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0.8,
        }),
      );
      beam.position.y = 165;
      beamMeshes.push(beam);
      grp.add(beam);

      const trail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]),
        new THREE.LineBasicMaterial({
          color: colors[i], transparent: true, opacity: 0.42, depthWrite: false,
        }),
      );
      trailLines.push(trail);
      scene.add(trail);

      teamGroups.push(grp);
      scene.add(grp);
    }

    // --- DOM labels -----------------------------------------------------
    // Tiny mono team tags beside each light, suppressed when teams bunch.
    const tagEls = Array.from({ length: n }, (_, i) => {
      const el = document.createElement('div');
      el.className = 'm3d-tag';
      el.innerHTML = `<i style="background:${colors[i]}"></i>${tags[i]}`;
      el.style.opacity = '0';
      labelHost.appendChild(el);
      return el;
    });
    const labelEls = LABELS.map((l) => {
      const el = document.createElement('div');
      el.className = 'm3d-label';
      el.innerHTML = `<span class="m3d-label-name">${l.name}</span><span class="m3d-label-alt">${l.alt}</span>`;
      labelHost.appendChild(el);
      return el;
    });

    // --- interaction ----------------------------------------------------
    let lastInteract = -1e9;
    const onStart = () => {
      lastInteract = performance.now();
      if (modeRef.current !== 'manual') setMode('manual');
    };
    controls.addEventListener('start', onStart);

    const ray = new THREE.Raycaster();
    const clickPos = new THREE.Vector2();
    let downAt: [number, number] | null = null;
    const onDown = (e: PointerEvent) => { downAt = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
      downAt = null;
      if (moved > 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      clickPos.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(clickPos, camera);
      const hits = ray.intersectObjects(dotSprites, false);
      const p = propsRef.current;
      if (hits.length > 0) {
        const idx = dotSprites.indexOf(hits[0].object as THREE.Sprite);
        p.onSelect(p.selected === idx ? null : idx);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    // --- camera tweens --------------------------------------------------
    let tween: {
      t0: number; dur: number;
      fromP: THREE.Vector3; toP: THREE.Vector3;
      fromT: THREE.Vector3; toT: THREE.Vector3;
    } | null = null;
    const flyTo = (pos: [number, number, number], target: [number, number, number], dur = 1500) => {
      tween = {
        t0: performance.now(), dur,
        fromP: camera.position.clone(), toP: new THREE.Vector3(...pos),
        fromT: controls.target.clone(), toT: new THREE.Vector3(...target),
      };
    };

    // --- sizing ---------------------------------------------------------
    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // --- per-second caches ---------------------------------------------
    let lastTick = -1;
    let states: ReturnType<typeof teamStatesAt> = [];
    let stormNow = 0;
    let finaleStage = -1;
    const segByEdge = new Map(branchLines.map(({ br }) => [br.id, br.segIdx]));
    let liveEdges = new Set<string>();

    const stormAt = (tMs: number) => {
      let best = 0;
      for (const st of propsRef.current.snap.storms ?? []) {
        const len = st.endMs - st.startMs;
        const edge = Math.max(2000, Math.min(60_000, len * 0.2));
        best = Math.max(
          best,
          Math.min(
            1,
            Math.max(0, (tMs - (st.startMs - edge)) / edge),
            Math.max(0, (st.endMs + edge - tMs) / edge),
          ),
        );
      }
      return best;
    };

    // --- the frame loop -------------------------------------------------
    const tmpV = new THREE.Vector3();
    const tmpColor = new THREE.Color();
    let lastNow = performance.now();
    const focus = new THREE.Vector3(...CAM_PRESETS[0].target);
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const p = propsRef.current;
      const now = performance.now();
      const tick = Math.floor(p.tMs / 1000);
      if (tick !== lastTick) {
        lastTick = tick;
        states = teamStatesAt(p.snap, p.teamNames.length, p.tMs);
        stormNow = stormAt(p.tMs);
        // Which lines are carrying climbers right now.
        const choices = edgeChoicesAt(p.snap, p.teamNames.length, p.tMs, segByEdge);
        const live = new Set<string>();
        for (let i = 0; i < choices.length; i++) {
          if (states[i]?.wiped) continue;
          const pos = displayPosAt(p.snap, i, p.tMs);
          const segNow = ROUTE_SEG_FRACS.findIndex((f, k) => pos >= f && pos < (ROUTE_SEG_FRACS[k + 1] ?? 2));
          const id = choices[i][segNow < 0 ? 0 : segNow];
          if (id) live.add(id);
        }
        liveEdges = live;
      }

      // Light of the hour.
      const u = p.durationMs > 0 ? p.tMs / p.durationMs : 0;
      const L = sceneLight(u, stormNow);
      // Sky colors bypass the linear conversion: the dome shader writes
      // display-space values raw, so the palette shows as authored.
      skyUniforms.topC.value.setStyle(L.skyTop, THREE.LinearSRGBColorSpace);
      skyUniforms.midC.value.setStyle(L.skyMid, THREE.LinearSRGBColorSpace);
      skyUniforms.horC.value.setStyle(L.horizon, THREE.LinearSRGBColorSpace);
      const sd = sunDir(L.sunU);
      const dayness = 1 - L.darkness;
      skyUniforms.glowC.value.setStyle(L.glow, THREE.LinearSRGBColorSpace);
      skyUniforms.uSun.value.set(sd[0], sd[1], sd[2]);
      skyUniforms.uStars.value = L.stars;
      skyUniforms.uStorm.value = stormNow;
      skyUniforms.uDay.value = dayness;
      skyUniforms.uTime.value = now * 0.001;
      // Low sun near the horizon: the warm mound gathers; gone by midday.
      skyUniforms.uBand.value =
        Math.pow(Math.max(0, 1 - sd[1] * 2.4), 2) * Math.max(0, dayness * 1.15 - 0.05);
      // Aerial perspective targets what the sky actually renders at the
      // horizon — same curve as the dome shader, computed here once.
      {
        // Ranges dissolve toward the sky but stay a shade darker and less
        // saturated than it — silhouettes, never a wall of horizon color.
        const hc = tmpColor.setStyle(L.horizon, THREE.LinearSRGBColorSpace);
        const lum = hc.r * 0.35 + hc.g * 0.5 + hc.b * 0.15;
        const ds = 0.3;
        hazeColor.setRGB(
          (hc.r + (lum - hc.r) * ds) * 0.86,
          (hc.g + (lum - hc.g) * ds) * 0.86,
          (hc.b + (lum - hc.b) * ds) * 0.88,
        );
      }
      sun.position.set(sd[0] * 30000, sd[1] * 30000, sd[2] * 30000);
      sun.target.position.set(0, 6500, 1000);
      // Low sun goes warm amber, not blood red, and loses power — real
      // alpenglow is a blush on the faces, never a flood.
      sun.color.set(L.glow).lerp(tmpColor.set('#ffd9b0'), Math.min(1, 0.3 + sd[1] * 1.6));
      sun.intensity = (0.12 + dayness * 2.6) * 1.35 * (0.55 + 0.45 * Math.min(1, sd[1] * 2.6));
      moon.position.set(-sd[0] * 22000, 14000, -sd[2] * 22000);
      moon.target.position.set(0, 6500, 1000);
      moon.intensity = L.darkness * (0.24 + L.moon * 0.22);
      hemi.color.set(L.skyMid);
      hemi.groundColor.set('#10141f');
      hemi.intensity = (0.26 + dayness * 0.85) * 1.2;
      amb.intensity = 0.18 + L.darkness * 0.18;
      // Snow faintly luminous under starlight — the mountain keeps its form.
      terrainMat.emissive.setScalar(0).lerp(tmpColor.set('#141e38'), L.darkness);
      terrainUniforms.uDay.value = dayness;
      terrainUniforms.uSky.value.set(L.skyMid);
      terrainUniforms.uGlow.value.set(L.glow);
      terrainUniforms.uBand.value = skyUniforms.uBand.value;
      moon.intensity = Math.max(moon.intensity, L.darkness * 0.62);
      (scene.fog as THREE.FogExp2).color.set(L.horizon);
      (scene.fog as THREE.FogExp2).density =
        0.000013 + L.haze * 0.000012 + stormNow * 0.00021;
      // Cloud sea: dense at dawn, burning off toward midday, back at dusk.
      {
        const daily = 0.5 + 0.5 * Math.cos((u - 0.03) * Math.PI * 2.3);
        const cov = Math.min(0.8, 0.3 + 0.3 * daily + stormNow * 0.24);
        const cloudLum = 0.16 + dayness * 0.84;
        for (let ci = 0; ci < cloudDecks.length; ci++) {
          const cd = cloudDecks[ci];
          cd.uTime.value = now * 0.001 + ci * 40;
          cd.uCov.value = cov - ci * 0.08;
          cd.uCol.value
            .setRGB(0.86 * cloudLum, 0.9 * cloudLum, 0.97 * cloudLum)
            .lerp(tmpColor.set(L.glow), skyUniforms.uBand.value * 0.35);
          cd.uOp.value = 0.66 + stormNow * 0.2;
        }
        // The scud ceiling belongs to the storm alone.
        scudDeck.uTime.value = now * 0.0014 + 200;
        scudDeck.uCov.value = stormNow * 0.62;
        scudDeck.uCol.value.setRGB(0.5 * cloudLum + 0.06, 0.53 * cloudLum + 0.065, 0.6 * cloudLum + 0.075);
        scudDeck.uOp.value = stormNow * 0.85;
      }
      sunSprite.position.set(sd[0] * 40000, Math.max(800, sd[1] * 40000), sd[2] * 40000);
      // The bloom shrinks and dims as the sun sinks — no red wall at dusk.
      const sunScale = 3800 + Math.min(1, sd[1] * 2.4) * 5600;
      sunSprite.scale.set(sunScale, sunScale, 1);
      sunSprite.material.opacity = Math.max(0, Math.min(0.72, sd[1] * 2.0)) * dayness;
      moonSprite.position.set(-sd[0] * 36000, 17000, -sd[2] * 36000);
      moonSprite.material.opacity = L.moon * 0.9;
      summitGlow.material.opacity = 0.14 + L.darkness * 0.3;
      const sgScale = 360 + L.darkness * 140;
      summitGlow.scale.set(sgScale, sgScale, 1);
      contourGroup.visible = true;

      // Tents glow from inside after dark.
      const tentEm = L.darkness * 0.85;
      for (const m of tentMats) m.emissive.setRGB(tentEm * 0.9, tentEm * 0.55, tentEm * 0.18);

      // Whiteout: at the top of a storm you cannot see the field. The rail
      // still knows; the mountain does not.
      const white = Math.max(0, (stormNow - 0.8) / 0.2);
      const lampAmt = Math.max(0, Math.min(1, (L.darkness - 0.45) * 1.8));

      // Route choices: all three grades stay legible, and the lines
      // carrying climbers right now glow.
      {
        const vis = 1 - white;
        for (const { br, mat, glowMat } of branchLines) {
          const on = liveEdges.has(br.id);
          mat.opacity = vis * (on ? 0.95 : 0.4 + L.darkness * 0.14);
          glowMat.opacity = on ? vis * (0.28 + L.darkness * 0.3) : 0;
        }
      }
      // Spindrift is the mountain's resting pulse; storms turn it feral.
      snowMat.opacity = 0.16 + stormNow * 0.72;
      snow.visible = true;
      {
        snow.position.copy(controls.target);
        const arr = snowGeo.getAttribute('position') as THREE.BufferAttribute;
        const fall = 4 + stormNow * 26;
        const drift = 2.5 + stormNow * 28;
        for (let i = 0; i < SNOW_N; i++) {
          let y = arr.getY(i) - fall;
          let x = arr.getX(i) - drift;
          if (y < -1300) y += 2600;
          if (x < -2100) x += 4200;
          arr.setY(i, y);
          arr.setX(i, x);
        }
        arr.needsUpdate = true;
      }

      // The plume streams leeward off the summit, longer and wilder in wind.
      {
        const dt = Math.min(0.1, (now - lastNow) * 0.001);
        const rate = 0.05 + stormNow * 0.09;
        const len = 950 + stormNow * 1500;
        const arr = plumeGeo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < PLUME_N; i++) {
          let a = plumeAge[i] + dt * rate * (0.7 + (plumeLane[i] + 1) * 0.3);
          if (a > 1) a -= 1;
          plumeAge[i] = a;
          const spread = a * a * 320;
          arr.setXYZ(
            i,
            WP3.SUMMIT[0] + 60 + a * len,
            WP3.SUMMIT[1] + 40 + Math.sin(a * 5.2 + plumeLane[i] * 8) * (14 + a * 90) - a * a * 260,
            WP3.SUMMIT[2] - 30 + a * len * 0.22 + plumeLane[i] * spread,
          );
        }
        arr.needsUpdate = true;
        plumeMat.opacity = (0.05 + dayness * 0.09 + stormNow * 0.15) * (1 - white);
        plumeMat.size = 62 + stormNow * 60;
      }
      lastNow = now;

      // Team lights.
      const px = renderer.domElement.clientHeight || 1;
      // A light stays a light at every viewport: 16 CSS px, hard-capped.
      const dotScale = Math.min(0.055, (2 * 16) / px);
      let leadFrac = 0;
      let spread = 0;
      let minF = 1;
      let maxF = 0;
      // Arrived teams park in arrival order along the northwest ridge —
      // a victorious line under the flag, not a pile on one point.
      const summitOrder: number[] = [];
      for (const e of p.snap.events) {
        if (e.tMs > p.tMs) break;
        if (e.type === 'summit' && e.teamIdx !== undefined && !summitOrder.includes(e.teamIdx)) {
          summitOrder.push(e.teamIdx);
        }
      }
      for (let i = 0; i < teamGroups.length; i++) {
        const pos = displayPosAt(p.snap, i, p.tMs);
        let [x, y, z] = posToXYZ(pos);
        // A team that has topped out leaves the mountain: its light, beam
        // and tag are removed rather than parked on the summit, where a
        // growing pile of dots buried the peak it just earned. The summit
        // label carries the count, and the rail carries the arrival time.
        const parked = pos >= 0.9999;
        const grp = teamGroups[i];
        grp.visible = !parked;
        grp.userData.parked = parked;
        if (parked) {
          (trailLines[i].material as THREE.LineBasicMaterial).opacity = 0;
          tagEls[i].style.opacity = '0';
          continue;
        }
        grp.position.set(x, y + 26, z);
        grp.userData.parked = parked;
        const st = states[i];
        const wiped = st?.wiped ?? false;
        const visMul = (1 - white) * (wiped ? 0.35 : 1);
        dotSprites[i].scale.set(dotScale, dotScale, 1);
        dotSprites[i].material.opacity = 0.25 + visMul * 0.75;
        // Brightness is condition; warmth is a headlamp after dark.
        haloMats[i].opacity = visMul * (0.24 + lampAmt * 0.42);
        haloMats[i].color.setStyle(lampAmt > 0.4 ? '#ffdf9e' : '#ffffff');
        const beamM = beamMeshes[i].material as THREE.MeshBasicMaterial;
        beamM.opacity = wiped ? 0 : visMul * (0.1 + L.darkness * 0.36);
        beamMeshes[i].lookAt(camera.position.x, beamMeshes[i].getWorldPosition(tmpV).y, camera.position.z);
        if (!wiped) {
          leadFrac = Math.max(leadFrac, pos);
          minF = Math.min(minF, pos);
          maxF = Math.max(maxF, pos);
        }
        // Trail: the last stretch of movement, fading behind the light.
        // Windowed in route space so it hugs the line instead of cutting
        // straight across the mountain between sparse samples.
        if (tick !== (grp.userData.trailTick ?? -1)) {
          grp.userData.trailTick = tick;
          const step = Math.max(6_000, p.durationMs / 1800);
          const pts: THREE.Vector3[] = [];
          if (!parked) {
            for (let k = 16; k >= 0; k--) {
              const tp = displayPosAt(p.snap, i, Math.max(0, p.tMs - k * step));
              if (Math.abs(pos - tp) > 0.04) continue;
              const [tx, ty, tz] = posToXYZ(tp);
              pts.push(new THREE.Vector3(tx, ty + 22, tz));
            }
          }
          if (pts.length >= 2) {
            trailLines[i].geometry.dispose();
            trailLines[i].geometry = new THREE.BufferGeometry().setFromPoints(pts);
          }
          (trailLines[i].material as THREE.LineBasicMaterial).opacity =
            pts.length >= 2 ? 0.42 * visMul : 0;
        }
      }
      spread = maxF - minF;

      // Fan out co-located climbing markers along the camera's right axis
      // so a shared camp never becomes one unreadable pile of chips.
      {
        const right = tmpV.setFromMatrixColumn(camera.matrixWorld, 0).clone();
        const buckets = new Map<string, number>();
        for (const g of teamGroups) {
          if (g.userData.parked) continue;
          const key = `${Math.round(g.position.x / 150)}:${Math.round(g.position.y / 150)}:${Math.round(g.position.z / 150)}`;
          const k = buckets.get(key) ?? 0;
          buckets.set(key, k + 1);
          if (k > 0) {
            const side = k % 2 === 1 ? 1 : -1;
            const mag = Math.ceil(k / 2) * 58;
            g.position.addScaledVector(right, side * mag);
          }
        }
      }

      // Selection ring.
      if (p.selected !== null && p.selected < teamGroups.length) {
        selRing.visible = true;
        selRing.position.copy(teamGroups[p.selected].position);
        ringMat.opacity = 0.5;
        ringMat.color.setStyle(colors[p.selected]);
      } else {
        selRing.visible = false;
      }

      // Finale choreography: the authored sequence. It takes the camera —
      // this is the part everyone is watching — unless the viewer is
      // actively driving right now.
      if (p.finale) {
        let stage = 0;
        if (leadFrac > 0.905) stage = 1; // leader past South Summit: to the ridge
        const anySummit = p.snap.events.some(
          (e) => e.type === 'summit' && e.tMs <= p.tMs,
        );
        if (anySummit) stage = 2; // the top of the world: pull back and hold
        if (stage !== finaleStage && now - lastInteract > 8000) {
          finaleStage = stage;
          if (modeRef.current !== 'ambient') setMode('ambient');
          if (stage === 0) flyTo([-700, 9100, 2600], [340, 8150, 950], 2400);
          else if (stage === 1) flyTo(CAM_PRESETS[6].pos, CAM_PRESETS[6].target, 2600);
          else flyTo(CAM_SUMMIT_WIDE.pos, CAM_SUMMIT_WIDE.target, 3000);
        }
      } else {
        finaleStage = -1;
      }

      // Camera: tween > manual > ambient focus.
      if (tween) {
        const k = Math.min(1, (now - tween.t0) / tween.dur);
        const e = k * k * (3 - 2 * k);
        camera.position.lerpVectors(tween.fromP, tween.toP, e);
        controls.target.lerpVectors(tween.fromT, tween.toT, e);
        if (k >= 1) tween = null;
      } else if (modeRef.current === 'ambient' && !p.finale) {
        // Frame the action: target drifts to the field's centroid, distance
        // fits the spread — the camera itself is a leaderboard readout.
        let cx = 0, cy = 0, cz = 0, cn = 0;
        for (const g of teamGroups) {
          if (!g.visible) continue; // summited teams have left the mountain
          cx += g.position.x; cy += g.position.y; cz += g.position.z; cn++;
        }
        if (cn > 0) {
          // Bias the frame toward the goal: the summit should stay in shot.
          focus.set(
            (cx / cn) * 0.72 + WP3.SUMMIT[0] * 0.28,
            (cy / cn) * 0.72 + WP3.SUMMIT[1] * 0.28 + 200,
            (cz / cn) * 0.72 + WP3.SUMMIT[2] * 0.28,
          );
          controls.target.lerp(focus, 0.006);
          const want = Math.min(12000, Math.max(5400, 4600 + spread * 16000));
          const cur = camera.position.distanceTo(controls.target);
          const dir = tmpV.copy(camera.position).sub(controls.target).normalize();
          // Keep the ambient eye above the field: never sink toward the
          // horizon where the massif becomes an incomprehensible wall.
          dir.y = Math.max(dir.y, 0.42);
          dir.normalize();
          const nd = cur + (want - cur) * 0.006;
          camera.position.copy(controls.target).addScaledVector(dir, nd);
        }
      }
      if (modeRef.current === 'manual' && now - lastInteract > 16000) {
        setMode('ambient');
      }
      controls.autoRotate = !reduced && modeRef.current === 'ambient' && !tween;
      controls.update();

      // Preset requests from the snap row.
      if (presetReq.current) {
        const pr =
          presetReq.current === 'wide'
            ? CAM_SUMMIT_WIDE
            : CAM_PRESETS.find((c) => c.id === presetReq.current);
        presetReq.current = null;
        if (pr) {
          lastInteract = now;
          if (modeRef.current !== 'manual') setMode('manual');
          flyTo(pr.pos, pr.target, 1500);
        }
      }

      // Team tags: one per screen cell, so a bunched field never becomes
      // a pile of text — the rail carries full identity.
      {
        const cells = new Set<string>();
        for (let i = 0; i < teamGroups.length; i++) {
          const el = tagEls[i];
          if (!teamGroups[i].visible) { el.style.opacity = '0'; continue; }
          tmpV.copy(teamGroups[i].position).project(camera);
          const lx = ((tmpV.x + 1) / 2) * wrap.clientWidth;
          const ly = ((-tmpV.y + 1) / 2) * wrap.clientHeight;
          const cell = `${Math.round(lx / 58)}:${Math.round(ly / 25)}`;
          const tWiped = states[i]?.wiped ?? false;
          const ok =
            tmpV.z <= 1 && !cells.has(cell) && white < 0.6 && !tWiped &&
            lx > 20 && lx < wrap.clientWidth - 20 && ly > 20 && ly < wrap.clientHeight - 56;
          if (ok) cells.add(cell);
          el.style.opacity = ok ? '0.92' : '0';
          if (ok) el.style.transform = `translate(-50%, 9px) translate(${lx}px, ${ly}px)`;
        }
      }

      // Labels: project, tier by distance, fade behind-camera ones.
      const dist = camera.position.distanceTo(controls.target);
      for (let i = 0; i < LABELS.length; i++) {
        const l = LABELS[i];
        const [x, y, z] = WP3[l.id];
        tmpV.set(x, y + 30, z).project(camera);
        const el = labelEls[i];
        // The summit keeps the tally the vanished dots used to carry.
        if (l.id === 'SUMMIT') {
          const n = summitOrder.length;
          const line = n === 0 ? l.alt : `${n} summited`;
          if (el.dataset.line !== line) {
            el.dataset.line = line;
            const altEl = el.querySelector('.m3d-label-alt');
            if (altEl) altEl.textContent = line;
          }
        }
        const behind = tmpV.z > 1;
        const lx = ((tmpV.x + 1) / 2) * wrap.clientWidth;
        const ly = ((-tmpV.y + 1) / 2) * wrap.clientHeight;
        const inFrame =
          lx > 46 && lx < wrap.clientWidth - 46 && ly > 40 && ly < wrap.clientHeight - 70;
        const show =
          !behind && inFrame && (l.tier === 0 || dist < 5200) && white < 0.7;
        el.style.opacity = show ? String(0.92 - white * 0.9) : '0';
        if (show) {
          el.style.transform = `translate(-50%, -100%) translate(${lx}px, ${ly}px)`;
        }
      }

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.removeEventListener('start', onStart);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      renderer.dispose();
      labelEls.forEach((el) => el.remove());
      tagEls.forEach((el) => el.remove());
      renderer.domElement.remove();
      scene.traverse((o) => {
        const anyO = o as unknown as { geometry?: { dispose?: () => void }; material?: { dispose?: () => void } };
        anyO.geometry?.dispose?.();
        anyO.material?.dispose?.();
      });
    };
    // The scene builds once per race; live updates flow through propsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.teamNames.join('|')]);

  return (
    <div className="m3d-wrap" ref={wrapRef}>
      <div className="m3d-labels" ref={labelsRef} aria-hidden />
      <div className="m3d-legend" aria-hidden>
        <span><i style={{ background: '#5fd0a8' }} />safe</span>
        <span><i style={{ background: '#e8b957' }} />normal</span>
        <span><i style={{ background: '#ef6a5c' }} />risky</span>
      </div>
      <div className="m3d-snap" role="group" aria-label="Camera views">
        {CAM_PRESETS.map((c) => (
          <button key={c.id} className="m3d-snap-btn" onClick={() => { presetReq.current = c.id; }}>
            {c.label}
          </button>
        ))}
        {mode === 'manual' && (
          <button
            className="m3d-snap-btn m3d-return"
            onClick={() => setMode('ambient')}
          >
            ⟲ Follow the action
          </button>
        )}
      </div>
    </div>
  );
}

export default MountainMap3D;
