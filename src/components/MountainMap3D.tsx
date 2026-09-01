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
import { displayPosAt, teamStatesAt, teamTags } from '@/lib/client/raceState';
import { sceneLight } from '@/themes/everest/scene';
import {
  buildContours,
  buildStars,
  buildTerrain,
  CAM_PRESETS,
  CAM_SUMMIT_WIDE,
  heightAt,
  IMPOSTORS,
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

function circleTexture(color: string, tag: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(64, 64, 54, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(8, 14, 26, 0.95)';
  g.stroke();
  g.fillStyle = '#0a1220';
  g.font = '700 44px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(tag, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 2;
  return t;
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
    renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
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
    const skyUniforms = {
      topC: { value: new THREE.Color('#0b1530') },
      midC: { value: new THREE.Color('#27436b') },
      horC: { value: new THREE.Color('#8ea6c8') },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(46000, 32, 18),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: skyUniforms,
        vertexShader:
          'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          varying vec3 vP;
          uniform vec3 topC; uniform vec3 midC; uniform vec3 horC;
          void main(){
            float h = normalize(vP).y;
            float lo = smoothstep(-0.06, 0.22, h);
            float hi = smoothstep(0.16, 0.85, h);
            vec3 c = mix(horC, mix(midC, topC, hi), lo);
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
    const hemi = new THREE.HemisphereLight('#31507c', '#131a2a', 0.7);
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

    // Distant peaks as impostors — a horizon for dawn to happen behind.
    const impostorMat = new THREE.MeshLambertMaterial({ color: '#3b4a68', flatShading: true });
    for (const p of IMPOSTORS) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(p.r, p.alt - 4300, 7, 1),
        impostorMat,
      );
      cone.position.set(p.x, 4300 + (p.alt - 4300) / 2, p.z);
      cone.rotation.y = (p.x * 13.37) % Math.PI;
      scene.add(cone);
    }

    // --- the route ------------------------------------------------------
    const routePts = ROUTE3.map((p) => new THREE.Vector3(p.x, p.y + 14, p.z));
    const fixedLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(routePts),
      new THREE.LineBasicMaterial({ color: '#b8933f', transparent: true, opacity: 0.75, depthWrite: false }),
    );
    scene.add(fixedLine);

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

    // --- stars, sun disc, moon, summit glow -----------------------------
    const starData = buildStars(38000);
    const starGeo = new THREE.BufferGeometry();
    {
      const pos = new Float32Array((starData.length / 4) * 3);
      for (let i = 0; i < starData.length / 4; i++) {
        pos[i * 3] = starData[i * 4];
        pos[i * 3 + 1] = starData[i * 4 + 1];
        pos[i * 3 + 2] = starData[i * 4 + 2];
      }
      starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    }
    const starMat = new THREE.PointsMaterial({
      color: '#dfe9fb', size: 2.1, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false,
    });
    scene.add(new THREE.Points(starGeo, starMat));

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
        map: glowTexture('#d5e1f5'), blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0,
      }),
    );
    moonSprite.scale.set(3000, 3000, 1);
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
      color: '#e8f1fb', size: 2.6, sizeAttenuation: false,
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
          map: circleTexture(colors[i], tags[i]),
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
      halo.scale.set(120, 120, 1);
      grp.add(halo);

      const beam = new THREE.Mesh(
        new THREE.PlaneGeometry(64, 300),
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
      }

      // Light of the hour.
      const u = p.durationMs > 0 ? p.tMs / p.durationMs : 0;
      const L = sceneLight(u, stormNow);
      skyUniforms.topC.value.set(L.skyTop);
      skyUniforms.midC.value.set(L.skyMid);
      skyUniforms.horC.value.set(L.horizon);
      const sd = sunDir(L.sunU);
      const dayness = 1 - L.darkness;
      sun.position.set(sd[0] * 30000, sd[1] * 30000, sd[2] * 30000);
      sun.target.position.set(0, 6500, 1000);
      sun.color.set(L.glow).lerp(new THREE.Color('#fff7ea'), Math.min(1, sd[1] * 1.7));
      sun.intensity = 0.12 + dayness * 2.6;
      moon.position.set(-sd[0] * 22000, 14000, -sd[2] * 22000);
      moon.target.position.set(0, 6500, 1000);
      moon.intensity = L.darkness * (0.24 + L.moon * 0.22);
      hemi.color.set(L.skyMid);
      hemi.groundColor.set('#10141f');
      hemi.intensity = 0.26 + dayness * 0.85;
      amb.intensity = 0.16 + L.darkness * 0.16;
      // Snow faintly luminous under starlight — the mountain keeps its form.
      terrainMat.emissive.setScalar(0).lerp(new THREE.Color('#1a2540'), L.darkness);
      moon.intensity = Math.max(moon.intensity, L.darkness * 0.45);
      (scene.fog as THREE.FogExp2).color.set(L.horizon);
      (scene.fog as THREE.FogExp2).density =
        0.000013 + L.haze * 0.000012 + stormNow * 0.00021;
      starMat.opacity = L.stars * 0.9;
      const sunV = sunSprite.position.set(sd[0] * 40000, Math.max(800, sd[1] * 40000), sd[2] * 40000);
      void sunV;
      sunSprite.material.opacity = Math.max(0, Math.min(0.95, sd[1] * 3)) * dayness;
      moonSprite.position.set(-sd[0] * 36000, 17000, -sd[2] * 36000);
      moonSprite.material.opacity = L.moon * 0.9;
      summitGlow.material.opacity = 0.16 + L.darkness * 0.55;
      const sgScale = 380 + L.darkness * 260;
      summitGlow.scale.set(sgScale, sgScale, 1);
      contourGroup.visible = true;

      // Tents glow from inside after dark.
      const tentEm = L.darkness * 0.85;
      for (const m of tentMats) m.emissive.setRGB(tentEm * 0.9, tentEm * 0.55, tentEm * 0.18);

      // Whiteout: at the top of a storm you cannot see the field. The rail
      // still knows; the mountain does not.
      const white = Math.max(0, (stormNow - 0.8) / 0.2);
      const lampAmt = Math.max(0, Math.min(1, (L.darkness - 0.45) * 1.8));
      snowMat.opacity = stormNow * 0.85;
      if (stormNow > 0.02) {
        snow.position.copy(controls.target);
        snow.position.y = controls.target.y;
        const arr = snowGeo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < SNOW_N; i++) {
          let y = arr.getY(i) - 14 - stormNow * 22;
          let x = arr.getX(i) - stormNow * 26;
          if (y < -1300) y += 2600;
          if (x < -2100) x += 4200;
          arr.setY(i, y);
          arr.setX(i, x);
        }
        arr.needsUpdate = true;
        snow.visible = true;
      } else snow.visible = false;

      // Team lights.
      const px = renderer.domElement.clientHeight || 1;
      const dotScale = (26 / (px * 0.5));
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
        const parked = pos >= 0.9999;
        if (parked) {
          // Down the northwest shoulder in arrival order, feet on snow,
          // spaced so constant-size chips stay separate even from afar.
          const k = Math.max(0, summitOrder.indexOf(i));
          x += -k * 112 - 16;
          z += -k * 62 - 9;
          y = heightAt(x, z);
        }
        const grp = teamGroups[i];
        grp.position.set(x, y + 26, z);
        grp.userData.parked = parked;
        const st = states[i];
        const wiped = st?.wiped ?? false;
        const visMul = (1 - white) * (wiped ? 0.35 : 1);
        dotSprites[i].scale.set(dotScale, dotScale, 1);
        dotSprites[i].material.opacity = 0.25 + visMul * 0.75;
        // Brightness is condition; warmth is a headlamp after dark.
        haloMats[i].opacity = visMul * (0.28 + lampAmt * 0.5);
        haloMats[i].color.setStyle(lampAmt > 0.4 ? '#ffdf9e' : '#ffffff');
        const beamM = beamMeshes[i].material as THREE.MeshBasicMaterial;
        beamM.opacity = wiped ? 0 : visMul * (0.12 + L.darkness * 0.42);
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

      // Labels: project, tier by distance, fade behind-camera ones.
      const dist = camera.position.distanceTo(controls.target);
      for (let i = 0; i < LABELS.length; i++) {
        const l = LABELS[i];
        const [x, y, z] = WP3[l.id];
        tmpV.set(x, y + 30, z).project(camera);
        const el = labelEls[i];
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
