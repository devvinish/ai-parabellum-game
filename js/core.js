// AI Parabellum core: renderer, post-processing, loaders, model helpers and pooled effects.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';

export {THREE};
export const Q = new URLSearchParams(location.search);
export const BASE = window.AIP_ASSETS || 'assets/';
export const settings = {high: Q.get('q') !== 'low' && !(matchMedia('(pointer: coarse)').matches && Q.get('q') !== 'high')};

/* ---------- renderer and post ---------- */
export function createView(canvas) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: false, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, settings.high ? 1.5 : 1));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0d131c, 0.0085);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 900);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.65, 0.5, 0.88); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass({uniforms: {tDiffuse: {value: null}, uTime: {value: 0}, uAspect: {value: innerWidth / innerHeight}, uHurt: {value: 0}, uGlitch: {value: 0}},
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uAspect, uHurt, uGlitch; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){ vec2 uv = vUv;
        if (uGlitch > 0.0) { float band = step(0.82, h(vec2(floor(uv.y*40.0), floor(uTime*24.0)))); uv.x += (h(vec2(floor(uv.y*40.0), uTime))-0.5)*0.08*uGlitch*band; }
        vec2 d = uv-0.5; float r = length(d*vec2(uAspect,1.0)); float ca = 0.0025 + uGlitch*0.012;
        vec3 c = vec3(texture2D(tDiffuse, uv - d*ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + d*ca).b);
        float l = dot(c, vec3(0.299,0.587,0.114));
        c = mix(c, c*vec3(0.86,0.97,1.12), smoothstep(0.35,0.0,l)*0.6); c = mix(c, c*vec3(1.08,1.0,0.9), smoothstep(0.4,0.9,l)*0.4);
        c = (c-0.5)*1.07+0.5; c *= smoothstep(1.05, 0.32, r);
        c = mix(c, vec3(0.55,0.02,0.0), uHurt*smoothstep(0.25,0.95,r)*0.85);
        c += (h(uv*vec2(1920.0,1080.0)+uTime*61.0)-0.5)*0.035; gl_FragColor = vec4(c,1.0); }`});
  composer.addPass(grade);
  const resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); grade.uniforms.uAspect.value = camera.aspect; };
  addEventListener('resize', resize);
  const setQuality = high => { settings.high = high; renderer.setPixelRatio(Math.min(devicePixelRatio, high ? 1.5 : 1)); bloom.enabled = high; resize(); };
  return {renderer, scene, camera, composer, bloom, grade, resize, setQuality};
}

/* ---------- loading ---------- */
export const manager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader(manager);
export const loadGLB = name => gltfLoader.loadAsync(BASE + 'models/' + name + '.glb');
export const loadGLBOptional = path => gltfLoader.loadAsync(BASE + path).catch(() => null);
export const loadTex = (name, srgb) => texLoader.loadAsync(BASE + 'tex/' + name + '.webp').then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; });
// skies load as float data with the sun or moon disc clamped, so it can't bloom into a white haze on the horizon
export const loadHDR = async (name, peak = 5) => {
  const t = await new RGBELoader(manager).setDataType(THREE.FloatType).loadAsync(BASE + 'sky/' + name + '.hdr'), d = t.image.data, n = d.length / 4;
  for (let i = 0; i < n; i++) { const k = i * 4, m = Math.max(d[k], d[k + 1], d[k + 2]); if (m > peak) { const f = peak / m; d[k] *= f; d[k + 1] *= f; d[k + 2] *= f; } }
  t.needsUpdate = true; return t;
};

/* ---------- model helpers ---------- */
export function prep(root, {cast = true, receive = true} = {}) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = cast; o.receiveShadow = receive;
    for (const m of [].concat(o.material)) { if (m.map) m.map.anisotropy = 8; if (m.transparent && m.alphaTest === 0 && m.map) { m.alphaTest = 0.4; m.transparent = false; } }
  });
  return root;
}
// scale so the model is h metres tall with its feet at y=0, centred on x/z; returns a pivot group
export function fit(root, h, {center = true} = {}) {
  root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(root, true), size = b.getSize(new THREE.Vector3());
  root.scale.multiplyScalar(h / size.y); root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root, true), c = b2.getCenter(new THREE.Vector3());
  const pivot = new THREE.Group(); pivot.add(root);
  root.position.y -= b2.min.y; if (center) { root.position.x -= c.x; root.position.z -= c.z; }
  return pivot;
}
// worn gunmetal paint with per-material uniforms, so each mech can carry its own colours
export function warPaint(root, {keep = 0.4, dark = 0.7, tint = [0.92, 0.96, 1.0], clone = false} = {}) {
  const u = {uKeep: {value: keep}, uDark: {value: dark}, uTint: {value: new THREE.Color(...tint)}, uHeat: {value: 0}};
  root.traverse(o => {
    if (!o.isMesh) return;
    if (clone) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
    for (const m of [].concat(o.material)) {
      m.metalness = Math.max(m.metalness ?? 0, 0.55); m.roughness = Math.min(m.roughness ?? 1, 0.55); m.envMapIntensity = 1.3;
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, u);
        sh.fragmentShader = 'uniform float uKeep; uniform float uDark; uniform vec3 uTint; uniform float uHeat;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(vec3(lum) * uTint, diffuseColor.rgb, uKeep) * uDark;`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(1.0, 0.28, 0.05) * uHeat;`);
      };
      m.customProgramCacheKey = () => 'warpaint';
      m.needsUpdate = true;
    }
  });
  return u;
}

export function glowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, inner); r.addColorStop(0.35, outer); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const TEX = {
  fire: glowTexture('rgba(255,236,190,1)', 'rgba(255,120,30,0.55)'),
  smoke: glowTexture('rgba(48,46,48,0.6)', 'rgba(30,30,34,0.28)'),
  spark: glowTexture('rgba(255,250,230,1)', 'rgba(255,170,60,0.8)'),
  flash: glowTexture('rgba(255,255,240,1)', 'rgba(255,190,110,0.6)'),
  red: glowTexture('rgba(255,210,200,1)', 'rgba(255,40,30,0.7)'),
  amber: glowTexture('rgba(255,240,200,1)', 'rgba(255,160,40,0.7)'),
  cyan: glowTexture('rgba(220,250,255,1)', 'rgba(60,200,255,0.7)'),
  white: glowTexture('rgba(255,255,255,1)', 'rgba(170,200,255,0.5)'),
};
export const sprite = (tex, {add = true, opacity = 1} = {}) => new THREE.Sprite(new THREE.SpriteMaterial({map: tex, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, transparent: true, opacity, fog: true}));

/* ---------- pooled particle effects ---------- */
export class FX {
  constructor(scene) {
    this.scene = scene; this.parts = []; this.free = {}; this.lights = []; this.tracers = []; this.shake = 0;
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffa050, 0, 30, 1.6); l.userData.t = 0; scene.add(l); this.lights.push(l); }
    const tg = new THREE.BoxGeometry(1, 1, 1); tg.translate(0, 0, -0.5);
    this.tracerGeo = tg;
    this.tracerMat = {player: new THREE.MeshBasicMaterial({color: 0xffd28a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false}),
      enemy: new THREE.MeshBasicMaterial({color: 0xff5040, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false})};
    for (const m of Object.values(this.tracerMat)) m.color.multiplyScalar(3);
  }
  get(tex, add = true) {
    const key = tex.uuid + add; const pool = this.free[key] || (this.free[key] = []);
    let s = pool.pop(); if (!s) { s = sprite(tex, {add}); s.userData.key = key; }
    s.visible = true; this.scene.add(s); return s;
  }
  // a particle: sprite with velocity, life, size curve
  emit(tex, pos, {vel = [0, 0, 0], life = 0.5, size = 1, grow = 0, gravity = 0, drag = 0, opacity = 1, add = true, stretch = 1, fade = 'out'} = {}) {
    const s = this.get(tex, add); s.position.copy(pos);
    s.userData.p = {v: new THREE.Vector3(...vel), life, t: 0, size, grow, gravity, drag, opacity, stretch, fade};
    s.material.opacity = opacity; s.scale.set(size, size * stretch, 1); this.parts.push(s); return s;
  }
  flashLight(pos, color = 0xffa050, power = 60, dur = 0.12, dist = 30) {
    const l = this.lights.reduce((a, b) => (a.userData.t < b.userData.t ? a : b));
    l.position.copy(pos); l.color.setHex(color); l.distance = dist; l.userData = {t: dur, dur, power}; l.intensity = power;
  }
  sparks(pos, n = 10, speed = 9, color = TEX.spark) {
    for (let i = 0; i < n; i++) { const v = [(Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed];
      this.emit(color, pos, {vel: v, life: 0.25 + Math.random() * 0.35, size: 0.14 + Math.random() * 0.12, gravity: 18, drag: 1.5}); }
  }
  impact(pos, big = false) {
    this.emit(TEX.flash, pos, {life: 0.08, size: big ? 2.6 : 1.3, grow: 6});
    this.sparks(pos, big ? 16 : 7, big ? 12 : 8);
    this.emit(TEX.smoke, pos, {vel: [0, 1.2, 0], life: 1.2, size: big ? 1.6 : 0.8, grow: 1.6, opacity: 0.5, add: false});
    if (big) this.flashLight(pos, 0xffb070, 40, 0.1, 18);
  }
  explosion(pos, scale = 1) {
    this.flashLight(pos, 0xff8a3a, 260 * scale, 0.45, 45 * scale);
    this.emit(TEX.flash, pos, {life: 0.22, size: 5 * scale, grow: 30 * scale});
    for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, r = Math.random() * 1.6 * scale;
      this.emit(TEX.fire, pos.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.random() * 2 * scale, Math.sin(a) * r)), {vel: [Math.cos(a) * 3 * scale, 2 + Math.random() * 4 * scale, Math.sin(a) * 3 * scale], life: 0.5 + Math.random() * 0.4, size: (2 + Math.random() * 2) * scale, grow: 3 * scale, drag: 2}); }
    for (let i = 0; i < 12; i++) { const a = Math.random() * 6.28;
      this.emit(TEX.smoke, pos.clone().add(new THREE.Vector3(0, 1 * scale, 0)), {vel: [Math.cos(a) * 2.5, 2 + Math.random() * 3, Math.sin(a) * 2.5], life: 2.5 + Math.random() * 1.5, size: 2.5 * scale, grow: 2.2 * scale, opacity: 0.65, add: false, drag: 0.8}); }
    this.sparks(pos.clone().add(new THREE.Vector3(0, 1, 0)), 40, 22 * Math.sqrt(scale));
  }
  tracer(from, dir, speed, len, team, onStep) {
    const m = new THREE.Mesh(this.tracerGeo, this.tracerMat[team]); m.scale.set(0.09 * (team === 'player' ? 1.4 : 1.2), 0.09 * (team === 'player' ? 1.4 : 1.2), len);
    m.position.copy(from); m.lookAt(from.clone().add(dir)); m.frustumCulled = false; this.scene.add(m);
    this.tracers.push({m, dir: dir.clone(), speed, len, t: 0, onStep, prev: from.clone()});
  }
  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const s = this.parts[i], p = s.userData.p; p.t += dt; const k = p.t / p.life;
      if (k >= 1) { s.visible = false; this.scene.remove(s); (this.free[s.userData.key] ||= []).push(s); this.parts.splice(i, 1); continue; }
      p.v.y -= p.gravity * dt; if (p.drag) p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      s.position.addScaledVector(p.v, dt);
      const sz = p.size + p.grow * p.t; s.scale.set(sz, sz * p.stretch, 1);
      s.material.opacity = p.opacity * (p.fade === 'out' ? (1 - k) : Math.sin(k * Math.PI));
    }
    for (const l of this.lights) { if (l.userData.t > 0) { l.userData.t -= dt; l.intensity = Math.max(0, l.userData.power * l.userData.t / l.userData.dur); } else l.intensity = 0; }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]; t.t += dt; t.prev.copy(t.m.position);
      t.m.position.addScaledVector(t.dir, t.speed * dt);
      const done = t.onStep(t.prev, t.m.position) || t.t > 3;
      if (done) { this.scene.remove(t.m); this.tracers.splice(i, 1); }
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }
}

/* ---------- weather and ambience ---------- */
export function makeRain(scene, high) {
  const N = high ? 9000 : 3500, pos = new Float32Array(N * 6), R = 40;
  for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * R * 2, y = Math.random() * 34, z = (Math.random() - 0.5) * R * 2; pos.set([x, y, z, x + 0.06, y - 0.8, z + 0.02], i * 6); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({color: 0x9fb4cc, transparent: true, opacity: 0.22, depthWrite: false}));
  mesh.frustumCulled = false; scene.add(mesh);
  return (dt, cam) => {
    const p = g.attributes.position.array, cx = cam.position.x, cz = cam.position.z, cy = cam.position.y, v = 26 * dt;
    for (let i = 0; i < N; i++) { const o = i * 6; p[o + 1] -= v; p[o + 4] -= v; p[o] += v * 0.08; p[o + 3] += v * 0.08;
      if (p[o + 1] < -0.3 || Math.abs(p[o] - cx) > R || Math.abs(p[o + 2] - cz) > R) { const x = cx + (Math.random() - 0.5) * R * 2, z = cz + (Math.random() - 0.5) * R * 2, y = Math.max(0, cy - 10) + 8 + Math.random() * 26; p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = x + 0.06; p[o + 4] = y - 0.8; p[o + 5] = z + 0.02; } }
    g.attributes.position.needsUpdate = true;
  };
}
export class Fire {
  constructor(scene, pos, size, withLight = true) {
    this.pos = pos; this.size = size; this.light = new THREE.PointLight(0xff7a2a, 26 * size, 16 * Math.sqrt(size), 1.6);
    this.light.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0)); if (withLight) scene.add(this.light);
    this.flames = []; this.smoke = [];
    for (let i = 0; i < 22; i++) { const s = sprite(TEX.fire); s.userData = {life: Math.random(), sp: 0.8 + Math.random() * 0.8, ox: (Math.random() - 0.5) * size, oz: (Math.random() - 0.5) * size}; scene.add(s); this.flames.push(s); }
    for (let i = 0; i < 12; i++) { const s = sprite(TEX.smoke, {add: false}); s.userData = {life: Math.random(), sp: 0.3 + Math.random() * 0.3, ox: (Math.random() - 0.5) * size, oz: (Math.random() - 0.5) * size}; scene.add(s); this.smoke.push(s); }
  }
  update(dt, t) {
    const f = this; f.light.intensity = 26 * f.size * (0.75 + 0.25 * Math.sin(t * 17 + f.size * 9) * Math.sin(t * 7.3));
    for (const s of f.flames) { const u = s.userData; u.life += dt * u.sp; if (u.life > 1) { u.life = 0; u.ox = (Math.random() - 0.5) * f.size; u.oz = (Math.random() - 0.5) * f.size; }
      const k = u.life; s.position.set(f.pos.x + u.ox * (1 - k * 0.6), f.pos.y + k * 2.2 * f.size, f.pos.z + u.oz * (1 - k * 0.6));
      const sc = (1.3 - k) * 1.1 * f.size; s.scale.set(sc, sc * 1.4, 1); s.material.opacity = Math.sin(k * Math.PI) * 0.95; }
    for (const s of f.smoke) { const u = s.userData; u.life += dt * u.sp * 0.5; if (u.life > 1) u.life = 0;
      const k = u.life; s.position.set(f.pos.x + u.ox + k * 2.5, f.pos.y + 1.6 * f.size + k * 9, f.pos.z + u.oz + k * 0.8);
      const sc = (1 + k * 5) * f.size; s.scale.set(sc, sc, 1); s.material.opacity = Math.sin(k * Math.PI) * 0.55; }
  }
}
// snow, blowing sand or rising embers: soft points that follow the camera
export function makeParticles(scene, high, {count = 5000, color = 0xffffff, size = 0.14, fall = 1.4, drift = [0.5, 0.2], R = 42, H = 28, opacity = 0.85, add = false} = {}) {
  const N = Math.round(high ? count : count * 0.4), pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos.set([(Math.random() - 0.5) * R * 2, Math.random() * H, (Math.random() - 0.5) * R * 2], i * 3); seed[i] = Math.random() * 100; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({color, size, map: glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.35)'), transparent: true, opacity, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending});
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
  let t = 0;
  return (dt, cam) => {
    t += dt; const p = g.attributes.position.array, cx = cam.position.x, cz = cam.position.z, base = Math.max(0, cam.position.y - 12);
    for (let i = 0; i < N; i++) { const o = i * 3, s = seed[i], w = 0.6 + (s % 1) * 0.8;
      p[o] += (drift[0] + Math.sin(t * 0.9 + s) * 0.5) * w * dt; p[o + 1] -= fall * w * dt; p[o + 2] += (drift[1] + Math.cos(t * 0.7 + s) * 0.5) * w * dt;
      const out = fall > 0 ? p[o + 1] < -0.2 : p[o + 1] > base + H;
      if (out || Math.abs(p[o] - cx) > R || Math.abs(p[o + 2] - cz) > R) { p[o] = cx + (Math.random() - 0.5) * R * 2; p[o + 2] = cz + (Math.random() - 0.5) * R * 2; p[o + 1] = fall > 0 ? base + Math.random() * H : Math.random() * 3; } }
    g.attributes.position.needsUpdate = true;
  };
}
