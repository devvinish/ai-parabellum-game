// AI Parabellum: third-person mech combat with the hijack mechanic. The mission comes from js/levels.js (?level=<id>).
import {THREE, Q, BASE, settings, createView, manager, loadGLB, loadTex, loadHDR, prep, fit, warPaint, TEX, sprite, glowTexture, FX, makeRain, makeParticles, Fire} from './core.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {initAudio, sound, setMuted, isMuted, scoreIntensity, startRecording, renderRecording} from './audio.js';
import {LEVELS, levelById} from './levels.js';

const $ = id => document.getElementById(id);
const LV = levelById(Q.get('level') || 'city'), LI = LEVELS.indexOf(LV);
const {renderer, scene, camera, composer, grade, setQuality} = createView($('c'));
renderer.toneMappingExposure = LV.exposure ?? 1; scene.fog.color.setHex(LV.fog[0]); scene.fog.density = LV.fog[1];
const fx = new FX(scene);
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp, rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const turnTo = (a, b, max) => a + clamp(angDiff(a, b), -max, max);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const fwdOf = yaw => V3(Math.sin(yaw), 0, Math.cos(yaw));
const rightOf = yaw => V3(-Math.cos(yaw), 0, Math.sin(yaw));
const GROUND = -0.15;
const GOD = Q.has('god');

/* ---------- level geometry ---------- */
const BOUNDS = LV.bounds;
const BOXES = (LV.boxes || []).map(b => ({...b})); // solid blocks: x0, x1, z0, z1, height (ent = a target that owns the box)
const CIRCLES = []; // static obstacles for mechs: {x, z, r}
const CAMBOXES = []; // extra boxes only the camera stays out of (big models with trimmed hitboxes)

function inBox(x, z, pad = 0) { for (const b of BOXES) if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) return b; return null; }
// segment a->b against the solid boxes; returns the hit fraction or null (segBoxes.box = the box hit)
function segBoxes(a, b, list = BOXES) {
  let best = null; segBoxes.box = null;
  for (const bx of list) {
    let t0 = 0, t1 = 1; const d = [b.x - a.x, b.y - a.y, b.z - a.z], o = [a.x, a.y, a.z], mn = [bx.x0, -5, bx.z0], mx = [bx.x1, bx.h, bx.z1]; let ok = true;
    for (let i = 0; i < 3 && ok; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) ok = false; }
      else { let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i]; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) ok = false; }
    }
    if (ok && (best === null || t0 < best)) { best = t0; segBoxes.box = bx; }
  }
  return best;
}
const losClear = (a, b) => segBoxes(a, b) === null;
// the Core's own hitbox is a box too: a sight line that first meets it is a clear view of it
const coreSeen = a => { const c = coreEnt.center, t = segBoxes(a, c); if (t === null) return true; const p = a.clone().lerp(c, t); return Math.abs(p.x - coreEnt.pos.x) <= coreEnt.hx && Math.abs(p.z - coreEnt.pos.z) <= coreEnt.hz; };
// closest distance between segment p1q1 and segment p2q2; returns [distance, fraction along the first]
function segSeg(p1, q1, p2, q2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z, d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s, t; const c = d1x * rx + d1y * ry + d1z * rz, b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
  s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0; t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  const x = p1.x + d1x * s - (p2.x + d2x * t), y = p1.y + d1y * s - (p2.y + d2y * t), z = p1.z + d1z * s - (p2.z + d2z * t);
  return [Math.sqrt(x * x + y * y + z * z), s];
}

/* ---------- assets ---------- */
const A = {tex: {}};
let FWD = 0; const STRIDE = {walk: 5.4, run: 9, back: 3.5};
const bar = $('bar'), msg = $('msg');
manager.onProgress = (url, done, total) => { bar.style.width = (done / total * 100).toFixed(0) + '%'; };
const usesDrones = LV.waves.some(w => w.drones) || !!LV.core;

async function loadAll() {
  msg.textContent = 'LIGHTING THE SKY';
  const hdr = await loadHDR(LV.sky.hdr); hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = LV.sky.color != null ? new THREE.Color(LV.sky.color) : hdr; scene.environment = hdr; scene.backgroundIntensity = LV.sky.bg; scene.environmentIntensity = LV.sky.env;
  msg.textContent = 'BUILDING ' + LV.name.toUpperCase();
  const names = [...new Set(['mech_striker', 'cyborg', 'biped', ...(usesDrones ? ['drone'] : []), ...LV.assets])];
  const g = await Promise.all(names.map(loadGLB)); names.forEach((n, i) => A[n] = g[i]);
  await Promise.all(LV.tex.map(async t => { A.tex[t] = await Promise.all([loadTex(t + '_diff', true), loadTex(t + '_nor'), loadTex(t + '_rough')]); }));
}

/* ---------- world ---------- */
const W = {t: 0, fires: [], mixers: [], ticks: []};
const timers = []; const later = (sec, fn) => timers.push({at: W.t + sec, fn});
function runTimers() { for (let i = timers.length - 1; i >= 0; i--) if (W.t >= timers[i].at) { const f = timers[i].fn; timers.splice(i, 1); f(); } }
let moon, hemi, weather, headlight;
const clip = n => A.mech_striker.animations.find(a => a.name === n);

// material from a Poly Haven texture set; cell = metres per texture tile on blocks, repeat = tiling on planes
const matCache = new Map();
function texMat(name, {repeat = null, color = 0xffffff, rough = 0.8, metal = 0, cell = 6} = {}) {
  const key = [name, repeat, color, rough, metal, cell].join(); if (matCache.has(key)) return matCache.get(key);
  const [d, n, r] = A.tex[name].map(t => { if (!repeat) return t; const c = t.clone(); c.repeat.set(...repeat); c.needsUpdate = true; return c; });
  const m = new THREE.MeshStandardMaterial({map: d, normalMap: n, roughnessMap: r, color, roughness: rough, metalness: metal}); m.userData.cell = cell;
  matCache.set(key, m); return m;
}
// procedural facade: dark concrete with rows of windows, a few of them lit
function windowsMat() {
  if (matCache.has('win')) return matCache.get('win');
  const S = 512, B = 8, cv = document.createElement('canvas'), ev = document.createElement('canvas'); cv.width = cv.height = ev.width = ev.height = S;
  const g = cv.getContext('2d'), e = ev.getContext('2d'); g.fillStyle = '#4a4743'; g.fillRect(0, 0, S, S); e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) { const v = 40 + Math.random() * 30; g.fillStyle = `rgba(${v},${v - 2},${v - 5},0.35)`; g.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 5, 2 + Math.random() * 5); }
  const c = S / B;
  for (let y = 0; y < B; y++) { g.fillStyle = 'rgba(20,19,18,0.6)'; g.fillRect(0, y * c + c - 5, S, 5);
    for (let x = 0; x < B; x++) { const wx = x * c + c * 0.22, wy = y * c + c * 0.2, ww = c * 0.56, wh = c * 0.52, r = Math.random();
      g.fillStyle = '#5c5852'; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6); g.fillStyle = '#68635c'; g.fillRect(wx - 5, wy + wh + 2, ww + 10, 5);
      g.fillStyle = r < 0.12 ? '#c89a5a' : r < 0.35 ? '#1c1f23' : '#101215'; g.fillRect(wx, wy, ww, wh);
      if (r < 0.12) { e.fillStyle = '#ffb060'; e.fillRect(wx, wy, ww, wh); } else if (r > 0.85) { g.fillStyle = '#060606'; g.fillRect(wx - 2, wy - 2, ww + 4, wh + 4); } } }
  const t = new THREE.CanvasTexture(cv), te = new THREE.CanvasTexture(ev); for (const x of [t, te]) { x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = 8; } t.colorSpace = te.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({map: t, emissiveMap: te, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.88, metalness: 0.05}); m.userData.cell = 28;
  matCache.set('win', m); return m;
}
// server rack / pylon panels with glowing strips
function rackMat(color) {
  const key = 'rack' + color; if (matCache.has(key)) return matCache.get(key);
  const S = 256, cv = document.createElement('canvas'), ev = document.createElement('canvas'); cv.width = cv.height = ev.width = ev.height = S;
  const g = cv.getContext('2d'), e = ev.getContext('2d'); g.fillStyle = '#16191d'; g.fillRect(0, 0, S, S); e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  const col = '#' + new THREE.Color(color).getHexString();
  for (let x = 0; x < S; x += 32) { g.fillStyle = '#0d0f12'; g.fillRect(x, 0, 3, S); }
  for (let y = 0; y < S; y += 16) { g.fillStyle = '#1e2227'; g.fillRect(0, y, S, 2); }
  for (let x = 14; x < S; x += 64) { e.fillStyle = col; e.fillRect(x, 8, 4, S - 16); g.fillStyle = col; g.fillRect(x, 8, 4, S - 16); }
  for (let i = 0; i < 160; i++) { const x = Math.random() * S, y = Math.random() * S; e.fillStyle = Math.random() < 0.8 ? col : '#ffffff'; e.fillRect(x, y, 3, 2); }
  const t = new THREE.CanvasTexture(cv), te = new THREE.CanvasTexture(ev); for (const x of [t, te]) { x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = 8; x.colorSpace = THREE.SRGBColorSpace; }
  const m = new THREE.MeshStandardMaterial({map: t, emissiveMap: te, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.45, metalness: 0.6}); m.userData.cell = 5; m.userData.pulse = true;
  matCache.set(key, m); return m;
}
// stretch box UVs so textures keep their real size on any block
function scaleBoxUV(g, w, h, d, cell) {
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / cell, uv.getY(k) * dims[f][1] / cell); }
}
// one static mesh per material, so a scene of a thousand parts costs a handful of draw calls
function mergeStatic(root) {
  root.updateMatrixWorld(true); const inv = root.matrixWorld.clone().invert(), groups = new Map(), drop = [];
  root.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material) || !o.visible) return;
    const src = o.geometry, g = new THREE.BufferGeometry();
    for (const n of ['position', 'normal', 'uv']) { const a = src.attributes[n]; if (!a) continue; const f = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) f[i * a.itemSize + k] = a.getComponent(i, k); g.setAttribute(n, new THREE.BufferAttribute(f, a.itemSize)); }
    g.setIndex(src.index ? Array.from(src.index.array) : [...Array(src.attributes.position.count).keys()]);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const key = o.material.uuid + Object.keys(g.attributes).sort().join();
    if (!groups.has(key)) groups.set(key, {mat: o.material, list: []}); groups.get(key).list.push(g); drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
  for (const {mat, list} of groups.values()) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = m.receiveShadow = true; root.add(m); }
}
// solid footprints of a model's parts, merged where they touch (template space)
function partBoxes(root, minH, skip) {
  root.updateMatrixWorld(true); const inv = root.matrixWorld.clone().invert(), bx = [];
  root.traverse(o => { if (!o.isMesh || (skip && skip(o))) return; const b = new THREE.Box3().setFromObject(o).applyMatrix4(inv); if (b.max.y - b.min.y < minH && b.max.y < minH) return; bx.push(b); });
  const P = bx.map((_, i) => i), f = i => P[i] === i ? i : (P[i] = f(P[i])), tol = 0.25;
  for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) { const a = bx[i], b = bx[j];
    if (a.min.x - tol < b.max.x && b.min.x - tol < a.max.x && a.min.z - tol < b.max.z && b.min.z - tol < a.max.z) P[f(j)] = f(i); }
  const out = new Map(); bx.forEach((b, i) => { const k = f(i); if (!out.has(k)) out.set(k, b.clone()); else out.get(k).union(b); });
  return [...out.values()];
}
const tplCache = new Map();
const countMeshes = r => { let n = 0; r.traverse(o => { if (o.isMesh) n++; }); return n; };
function template(name, h, {scale = 0, solid, minH = 0.6, hide, emissive, emissivePower = 1, merge} = {}) {
  const key = [name, h, scale, emissive].join(); if (tplCache.has(key)) return tplCache.get(key);
  const src = A[name].scene, skinned = (() => { let s = false; src.traverse(o => { if (o.isSkinnedMesh) s = true; }); return s; })();
  const root = skinned ? SkeletonUtils.clone(src) : src.clone(true); prep(root);
  if (hide) root.traverse(o => { if (o.isMesh && hide(o)) o.visible = false; });
  if (emissive) root.traverse(o => { if (!o.isMesh) return; o.material = o.material.clone(); const m = o.material; m.emissive = new THREE.Color(emissive); m.emissiveMap = m.emissiveMap || m.map; m.emissiveIntensity = 0.55 * emissivePower; });
  let piv; if (scale) { root.scale.setScalar(scale); root.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(root, true), c = b.getCenter(V3()); piv = new THREE.Group(); piv.add(root); root.position.set(-c.x, -b.min.y, -c.z); }
  else piv = fit(root, h);
  piv.updateMatrixWorld(true);
  const t = {piv, skinned, parts: solid === 'parts' ? partBoxes(piv, minH, o => !o.visible) : null};
  if (merge ?? (!skinned && countMeshes(piv) > 40)) mergeStatic(piv);
  tplCache.set(key, t); return t;
}
function addBox(b, ent) { const box = {x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, h: b.max.y}; if (ent) box.ent = ent; BOXES.push(box); return box; }
let snowM = null; const snowMat = () => snowM || (snowM = new THREE.MeshStandardMaterial({color: 0xc6ced8, roughness: 0.9}));

// helpers handed to each level's build()
const C = {
  THREE, scene, A, V3, GROUND, prep, fit, SkeletonUtils,
  mat: texMat, rackMat, windows: windowsMat,
  box(x0, x1, z0, z1, h) { BOXES.push({x0, x1, z0, z1, h}); },
  circle(x, z, r) { CIRCLES.push({x, z, r}); },
  fire(x, y, z, size, light = true) { const f = new Fire(scene, V3(x, y, z), size, light); W.fires.push(f); return f; },
  tick(fn) { W.ticks.push(fn); },
  // a model fitted to height h (or a fixed scale), placed and made solid
  place(name, h, x, z, {rot = 0, y = GROUND, solid = true, minH, scale, hide, emissive, emissivePower} = {}) {
    const t = template(name, h, {scale, solid, minH, hide, emissive, emissivePower});
    const o = t.skinned ? SkeletonUtils.clone(t.piv) : t.piv.clone(); o.position.set(x, y, z); o.rotation.y = rot; scene.add(o); o.updateMatrixWorld(true);
    if (solid === 'parts') for (const b of t.parts) addBox(b.clone().applyMatrix4(o.matrixWorld));
    else if (solid) addBox(new THREE.Box3().setFromObject(o));
    return o;
  },
  // n containers stacked, each tinted a different colour
  stack(name, h, x, z, rot, n) {
    const cols = [0xb8503a, 0x3a7290, 0x4c8048, 0xc89040, 0x8a8a90, 0x9a3a3a];
    const g = new THREE.Group(); g.position.set(x, GROUND, z); g.rotation.y = rot; scene.add(g);
    for (let i = 0; i < n; i++) { const o = template(name, h).piv.clone(); o.position.y = i * h; o.rotation.y = (i % 2) * Math.PI; const tint = cols[Math.floor(Math.random() * cols.length)];
      o.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.multiply(new THREE.Color(tint)).multiplyScalar(1.6); } }); g.add(o); }
    g.updateMatrixWorld(true); addBox(new THREE.Box3().setFromObject(g)); return g;
  },
  // a building block: windowed facade by default, any material with userData.cell otherwise
  block(x0, x1, z0, z1, h, {mat, roof, solid = true, y0 = GROUND - 0.1, snowTop = false} = {}) {
    const m = mat || windowsMat(), w = x1 - x0, d = z1 - z0, H = h - y0, cell = m.userData.cell || 6;
    const g = new THREE.BoxGeometry(w, H, d); scaleBoxUV(g, w, H, d, cell);
    const r = roof || (mat ? m : texMat(LV.tex.includes('cracked_concrete_wall') ? 'cracked_concrete_wall' : LV.tex[0], {color: 0x3a3a3a, cell: 8}));
    const mesh = new THREE.Mesh(g, [m, m, r, r, m, m]); mesh.position.set((x0 + x1) / 2, y0 + H / 2, (z0 + z1) / 2); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
    if (snowTop) { const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.35, d + 0.3), snowMat()); s.position.set(mesh.position.x, h + 0.12, mesh.position.z); s.receiveShadow = true; scene.add(s); }
    if (solid) BOXES.push({x0, x1, z0, z1, h});
    return mesh;
  },
  // a ring of windowed buildings around the play area, merged into one mesh; solid so the camera never slips behind them
  ring(list) {
    const m = windowsMat(), cell = m.userData.cell, geos = [];
    for (const [x0, x1, z0, z1, h] of list) {
      const w = x1 - x0, d = z1 - z0, y0 = GROUND - 0.1, H = h - y0, g = new THREE.BoxGeometry(w, H, d); scaleBoxUV(g, w, H, d, cell);
      const uv = g.attributes.uv; for (let k = 8; k < 16; k++) uv.setXY(k, 0.02, 0.02); // roofs and floors take plain wall colour
      g.translate((x0 + x1) / 2, y0 + H / 2, (z0 + z1) / 2); geos.push(g.toNonIndexed()); BOXES.push({x0, x1, z0, z1, h});
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos), m); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh); return mesh;
  },
  glow(color, size) { const s = sprite(glowTexture('rgba(255,255,255,1)', '#' + new THREE.Color(color).getHexString() + '99')); s.scale.setScalar(size); scene.add(s); return s; },
  beam(x, z, color, r) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.6, 420, 24, 1, true), new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false}));
    m.position.set(x, 200, z); scene.add(m); const l = new THREE.PointLight(color, 900, 90, 1.4); l.position.set(x, 22, z); scene.add(l);
    W.ticks.push(() => { m.material.opacity = 0.18 + 0.06 * Math.sin(W.t * 2.2 + x); });
  },
  // collapse film-set facade cards that stand in the way (world x/z rects)
  dropCards(mesh, rects) {
    mesh.updateMatrixWorld(true); const p = mesh.geometry.attributes.position, v = V3(), hits = [];
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); if (rects.some(([x0, x1, z0, z1]) => v.x > x0 && v.x < x1 && v.z > z0 && v.z < z1)) hits.push(i); }
    for (const i of hits) p.setXYZ(i, p.getX(hits[0]), p.getY(hits[0]), p.getZ(hits[0])); p.needsUpdate = true;
  },
  // the human cockpit mech parked with its hatch open
  cockpitMech(name, x, z, rot, paint, lightColor, lp) {
    const heavy = A[name]; prep(heavy.scene); warPaint(heavy.scene, paint);
    const hv = fit(heavy.scene, 6.2); hv.position.set(x, GROUND, z); hv.rotation.y = rot; scene.add(hv); CIRCLES.push({x, z, r: 2.6});
    const mx = new THREE.AnimationMixer(heavy.scene); W.mixers.push(mx); mx.clipAction(heavy.animations.find(a => a.name === 'Open-Idle')).play();
    const flood = new THREE.SpotLight(lightColor, 220, 30, 0.5, 0.6, 1.5); flood.position.set(...lp); flood.target.position.set(x, 2.5, z); scene.add(flood, flood.target);
    const lamp = sprite(glowTexture('rgba(255,240,215,1)', 'rgba(255,170,90,0.45)')); lamp.position.copy(flood.position); lamp.scale.setScalar(1.1); scene.add(lamp);
  },
  // a striker the AI lost earlier, still smoking
  deadStriker(x, z, rot) {
    const dead = SkeletonUtils.clone(A.mech_striker.scene); prep(dead); warPaint(dead, {keep: 0.3, dark: 0.35, clone: true});
    const dp = fit(dead, 7.5); dp.rotation.y = -FWD + rot; dp.position.set(x, GROUND, z); scene.add(dp);
    const dmx = new THREE.AnimationMixer(dead); dmx.clipAction(clip('b2DeathPose1')).play(); dmx.update(0.01);
    CIRCLES.push({x, z, r: 3}); W.fires.push(new Fire(scene, V3(x, 1.2, z), 1.0));
  },
  // an AI gunship circling the map with spinning rotors
  gunship(cx, cz, r, alt) {
    const root = A.hind.scene.clone(true); prep(root, {receive: false}); const piv = fit(root, 5.6); scene.add(piv); piv.updateMatrixWorld(true);
    const rotors = [];
    root.traverse(o => { if (o.isMesh && /rotorblades/.test(o.name)) rotors.push(o); });
    const spin = rotors.map(o => { const b = new THREE.Box3().setFromObject(o), s = b.getSize(V3()), c = b.getCenter(V3());
      const axisW = s.x < s.y && s.x < s.z ? V3(1, 0, 0) : s.z < s.y ? V3(0, 0, 1) : V3(0, 1, 0);
      const parent = o.parent, g = new THREE.Group(); g.position.copy(parent.worldToLocal(c.clone())); parent.add(g); g.updateMatrixWorld(true); g.attach(o);
      const q = parent.getWorldQuaternion(new THREE.Quaternion()).invert(); return {g, axis: axisW.applyQuaternion(q).normalize(), speed: /tail/.test(o.name) ? 40 : 24}; });
    let a = 0;
    W.ticks.push(dt => { a += dt * 20 / r; piv.position.set(cx + Math.sin(a) * r, alt + Math.sin(W.t * 0.5) * 3, cz + Math.cos(a) * r); piv.rotation.set(0, a + Math.PI / 2, 0); piv.rotateZ(-0.22); piv.rotateX(0.08);
      for (const s of spin) s.g.rotateOnAxis(s.axis, s.speed * dt); });
  },
};

function buildWorld() {
  moon = new THREE.DirectionalLight(LV.sun.color, LV.sun.power); moon.castShadow = true;
  moon.shadow.mapSize.set(settings.high ? 4096 : 2048, settings.high ? 4096 : 2048);
  Object.assign(moon.shadow.camera, {left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 260}); moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.04;
  scene.add(moon, moon.target);
  hemi = new THREE.HemisphereLight(...LV.hemi); scene.add(hemi);

  const G = LV.ground, gm = texMat(G.tex, {repeat: [G.repeat, G.repeat], color: G.color, rough: G.rough, metal: G.metal});
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(G.size, G.size), gm);
  ground.rotation.x = -Math.PI / 2; ground.position.set(G.at[0], -0.22, G.at[1]); ground.receiveShadow = true; scene.add(ground);

  LV.build(C);
  if (LV.core) makeCore();

  const B = BOUNDS; buildGrid(LV.grid || [[[B.x0, B.z0], [B.x1, B.z0]], [[B.x0, B.z0], [B.x0, B.z1]], [[B.x1, B.z0], [B.x1, B.z1]], [[B.x0, B.z1], [B.x1, B.z1]]]);
  const hi = settings.high;
  weather = {rain: () => makeRain(scene, hi),
    snow: () => makeParticles(scene, hi, {count: 7000, color: 0xffffff, size: 0.16, fall: 1.7, drift: [0.9, 0.3], opacity: 0.9}),
    dust: () => makeParticles(scene, hi, {count: 3500, color: 0xd9b98f, size: 0.09, fall: 0.15, drift: [7, 2], H: 8, opacity: 0.5}),
    motes: () => makeParticles(scene, hi, {count: 2500, color: 0xcfe8ff, size: 0.07, fall: 0.12, drift: [0.3, 0.2], opacity: 0.55, add: true}),
    embers: () => makeParticles(scene, hi, {count: 2600, color: 0xff6a3a, size: 0.13, fall: -0.9, drift: [0.5, 0.2], opacity: 0.95, add: true}),
  }[LV.weather]?.() || (() => {});
  headlight = new THREE.SpotLight(0xfff1dc, LV.headlight, 85, 0.36, 0.55, 1.3); headlight.castShadow = settings.high; headlight.shadow.mapSize.set(1024, 1024); headlight.shadow.bias = -0.0006;
  scene.add(headlight, headlight.target);
  W.titanLight = new THREE.SpotLight(0xff4030, 0, 90, 0.35, 0.5, 1.3); scene.add(W.titanLight, W.titanLight.target);
  for (const m of matCache.values()) if (m.userData.pulse) W.ticks.push(() => { m.emissiveIntensity = 1.3 + 0.35 * Math.sin(W.t * 1.7); });
}
// the AI defense grid: a red energy wall at the edge of the playable area, brightest near the player, hidden from outside
const gridU = {uP: {value: new THREE.Vector3()}, uT: {value: 0}};
function buildGrid(segs) {
  const cx = (BOUNDS.x0 + BOUNDS.x1) / 2, cz = (BOUNDS.z0 + BOUNDS.z1) / 2;
  for (const [[ax, az], [bx, bz]] of segs) {
    const len = Math.hypot(bx - ax, bz - az); let nx = -(bz - az) / len, nz = (bx - ax) / len; if ((cx - ax) * nx + (cz - az) * nz < 0) { nx = -nx; nz = -nz; }
    const mat = new THREE.ShaderMaterial({uniforms: {...gridU, uA: {value: new THREE.Vector2(ax, az)}, uN: {value: new THREE.Vector2(nx, nz)}}, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `uniform vec3 uP; uniform float uT; uniform vec2 uA, uN; varying vec3 vW;
        float ln(float v, float w){ float f = abs(fract(v) - 0.5); return smoothstep(0.5 - w, 0.5, f); }
        void main(){ float d = distance(vW.xz, uP.xz); float near = smoothstep(24.0, 5.0, d), far = smoothstep(170.0, 30.0, d);
          float side = smoothstep(0.5, 4.0, dot(cameraPosition.xz - uA, uN));
          float along = (vW.x + vW.z) / 3.0, up = vW.y / 3.0;
          float g = max(ln(along, 0.022), ln(up, 0.022)); float scan = smoothstep(0.92, 1.0, sin(vW.y * 0.5 - uT * 3.0));
          float base = pow(1.0 - clamp(vW.y / 26.0, 0.0, 1.0), 3.0);
          float a = ((g * 0.6 + scan * 0.25 + 0.04) * near * (1.0 - vW.y / 32.0) + base * 0.22 * far) * side;
          gl_FragColor = vec4(vec3(1.0, 0.24, 0.1) * a, a); }`});
    const g = new THREE.PlaneGeometry(len, 30); g.translate(0, 15 - 0.2, 0);
    const w = new THREE.Mesh(g, mat); w.position.set((ax + bx) / 2, 0, (az + bz) / 2); w.rotation.y = Math.atan2(bz - az, bx - ax) * -1; w.frustumCulled = false; scene.add(w);
  }
}

// how far the root travels per second in a root-motion clip, for a 7.5 m striker; also the model's forward angle
function measure(name) {
  const tmp = SkeletonUtils.clone(A.mech_striker.scene); const piv = fit(tmp, 7.5);
  const c = clip(name); const m = new THREE.AnimationMixer(tmp); m.clipAction(c).play();
  let best = null, bestD = 0;
  for (const tr of c.tracks) if (tr.name.endsWith('.position')) { const v = tr.values, n = v.length / 3; const d = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2]); if (d > bestD) { bestD = d; best = tr.name.split('.')[0]; } }
  const bone = best && tmp.getObjectByName(best); if (!bone) return null;
  m.setTime(0); piv.updateMatrixWorld(true); const p0 = bone.getWorldPosition(V3());
  m.setTime(c.duration - 0.001); piv.updateMatrixWorld(true); const p1 = bone.getWorldPosition(V3());
  const d = p1.sub(p0); return {speed: Math.hypot(d.x, d.z) / c.duration, fwd: Math.atan2(d.x, d.z)};
}

/* ---------- mechs ---------- */
const PAINT = {
  player: {keep: 0.18, dark: 0.92, tint: [0.98, 0.86, 0.62]},
  enemy: {keep: 0.4, dark: 0.7, tint: [0.92, 0.96, 1.0]},
  titan: {keep: 0.22, dark: 0.5, tint: [1.0, 0.86, 0.84]},
};
const mechs = [], droids = [], rockets = [];
let uid = 0;
class Mech {
  constructor(kind, team, x, z, heading) {
    this.id = ++uid; this.kind = kind; this.team = team; this.titan = kind === 'titan';
    this.H = this.titan ? 11 : 7.5; this.s = this.H / 7.5; this.r = 2.1 * this.s;
    const model = SkeletonUtils.clone(A.mech_striker.scene); prep(model); this.model = model;
    this.u = warPaint(model, {...PAINT[team === 'player' ? 'player' : this.titan ? 'titan' : 'enemy'], clone: true});
    const piv = fit(model, this.H); piv.rotation.y = -FWD;
    this.root = new THREE.Group(); this.root.add(piv); scene.add(this.root);
    this.pos = V3(x, GROUND, z); this.heading = heading; this.aimYaw = heading; this.aimPitch = 0; this.speed = 0; this.vel = V3();
    this.maxArmor = this.titan ? 3200 : team === 'player' ? 1000 : 680; this.armor = this.maxArmor; this.wreck = this.titan ? 700 : 240;
    this.state = 'active'; this.hitT = 0; this.downT = 0;
    this.mixer = new THREE.AnimationMixer(model);
    const act = n => this.mixer.clipAction(clip(n));
    this.act = {idle: act('a4IdlePose'), walk: act('a5WalkCycle'), run: act('a7RunCycle'), back: act('a6WalkCycleBack'), over: act('a2ShutdownOverheat'), boot: act('a3StartupSequence'), hitF: act('b1HitFront2'), death: act('b2DeathFallDown1')};
    for (const k of ['over', 'boot', 'hitF', 'death']) { this.act[k].setLoop(THREE.LoopOnce); this.act[k].clampWhenFinished = true; }
    this.gait = null; this.setGait('idle', 0);
    this.torso = model.getObjectByName('UpperTorso_011'); this.arms = [model.getObjectByName('LowerArm_L_014'), model.getObjectByName('LowerArm_R_017')];
    // sensor eyes ride on a head group that follows the torso's aim
    this.head = new THREE.Group(); this.head.position.y = 0; this.root.add(this.head);
    this.eyes = [];
    for (const ex of [-0.45, 0.45]) { const e = sprite(team === 'player' ? TEX.amber : TEX.red); e.position.set(ex * this.s, 6.9 * this.s, 1.0 * this.s); e.scale.setScalar((this.titan ? 0.9 : 0.55) * this.s); this.head.add(e); this.eyes.push(e); }
    this.fireCD = rand(1, 2.5); this.burst = 0; this.burstT = 0; this.rocketCD = rand(5, 8); this.salvo = 0; this.thinkT = 0; this.mode = 'close'; this.strafe = 1; this.armIdx = 0;
    this.stepPhase = 0; this.smokeT = 0; this.wave = 0;
    mechs.push(this); this.place();
  }
  setGait(g, fade = 0.3) {
    if (this.gait === g) return; const n = this.act[g], o = this.gait && this.act[this.gait];
    n.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play(); if (o) o.fadeOut(fade); this.gait = g;
  }
  setPaint(team) { // fade toward a new colour scheme (used when a mech changes sides)
    const p = PAINT[team === 'player' ? 'player' : this.titan ? 'titan' : 'enemy']; this.paintTo = {k: p.keep, d: p.dark, t: new THREE.Color(...p.tint), f: 0};
    for (const e of this.eyes) e.material.map = team === 'player' ? TEX.amber : TEX.red;
  }
  get center() { return V3(this.pos.x, this.pos.y + this.H * 0.55, this.pos.z); }
  get eye() { return V3(this.pos.x, this.pos.y + this.H * 0.85, this.pos.z); }
  place() { this.root.position.copy(this.pos); this.root.rotation.y = this.heading; this.head.rotation.y = clamp(angDiff(this.heading, this.aimYaw), -1.1, 1.1); }
  muzzle(i) {
    const arm = this.arms[i], dir = this.aimDir();
    const p = arm ? arm.getWorldPosition(V3()) : this.eye.add(rightOf(this.aimYaw).multiplyScalar((i ? 1 : -1) * 1.6 * this.s));
    return p.addScaledVector(dir, 1.9 * this.s);
  }
  aimDir() { const c = Math.cos(this.aimPitch); return V3(Math.sin(this.aimYaw) * c, Math.sin(this.aimPitch), Math.cos(this.aimYaw) * c); }
  // walk at speed v (m/s) using gait g; time scales match the stride so feet don't slide
  locomote(g, v) {
    this.setGait(g, 0.3);
    const base = (g === 'run' ? STRIDE.run : g === 'back' ? STRIDE.back : STRIDE.walk) * this.s;
    if (g !== 'idle') this.act[g].setEffectiveTimeScale(clamp(v / base, 0.25, 1.6));
  }
  update(dt) {
    this.mixer.update(dt); this.place(); this.root.updateMatrixWorld(true);
    // twist the upper torso toward the aim
    if (this.torso && (this.state === 'active')) {
      const dy = clamp(angDiff(this.heading, this.aimYaw), -1.15, 1.15), dp = clamp(this.aimPitch, -0.35, 0.4);
      const qy = new THREE.Quaternion().setFromAxisAngle(UP, dy), qp = new THREE.Quaternion().setFromAxisAngle(rightOf(this.heading + dy), dp);
      const qw = qp.multiply(qy), pq = this.torso.parent.getWorldQuaternion(new THREE.Quaternion());
      this.torso.quaternion.premultiply(pq.clone().invert().multiply(qw).multiply(pq)); this.torso.updateMatrixWorld(true);
    }
    // footfalls
    const g = this.gait; if (g === 'walk' || g === 'run' || g === 'back') {
      const a = this.act[g], ph = (a.time / a.getClip().duration) % 1, half = ph >= 0.5 ? 1 : 0;
      if (half !== this.stepPhase) { this.stepPhase = half; const d = camera.position.distanceTo(this.pos); sound.stomp(d, this.titan ? 1.4 : 1); if (this === player.mech) fx.shake = Math.max(fx.shake, 0.05); else if (d < 30) fx.shake = Math.max(fx.shake, (this.titan ? 0.5 : 0.25) * (1 - d / 30)); }
    }
    if (this.paintTo) { const p = this.paintTo; p.f = Math.min(1, p.f + dt / 1.6); this.u.uKeep.value = lerp(this.u.uKeep.value, p.k, p.f); this.u.uDark.value = lerp(this.u.uDark.value, p.d, p.f); this.u.uTint.value.lerp(p.t, p.f); if (p.f >= 1) this.paintTo = null; }
    if (this.state === 'down') { // an overheated core glows and smokes
      this.downT += dt; this.u.uHeat.value = 0.1 + 0.07 * Math.sin(this.downT * 4);
      this.smokeT -= dt; if (this.smokeT < 0) { this.smokeT = 0.12; fx.emit(TEX.smoke, this.eye.add(V3(rand(-1, 1), -0.8 * this.s, rand(-1, 1))), {vel: [rand(-0.5, 0.5), 2.2, rand(-0.5, 0.5)], life: 2.4, size: 1.4 * this.s, grow: 1.6, opacity: 0.55, add: false});
        if (Math.random() < 0.25) fx.sparks(this.eye.add(V3(rand(-1, 1), -1.5, rand(-1, 1))), 5, 6); }
    } else if (this.state !== 'dead') this.u.uHeat.value = Math.max(0, this.u.uHeat.value - dt);
    if (this.hitT > 0) this.hitT -= dt;
  }
  damage(n, from, heavy) {
    if (this.state === 'dead' || this.state === 'boot') return;
    if (this.state === 'down') { this.wreck -= n * 0.35; if (this.wreck <= 0) this.destroy(); return; }
    if (this === player.mech && GOD) n = 0;
    this.armor -= n; this.u.uHeat.value = Math.min(0.5, this.u.uHeat.value + 0.05);
    if (heavy && this.hitT <= 0 && this.team !== 'player') { this.hitT = 1.2; this.act.hitF.reset().setEffectiveWeight(1).fadeIn(0.05).play(); later(0.35, () => this.act.hitF.fadeOut(0.3)); }
    if (this === player.mech) onPlayerHit(n, from);
    if (this.armor <= 0) { this.armor = 0; if (this === player.mech) playerDestroyed(); else this.goDown(); }
  }
  goDown() {
    this.state = 'down'; this.downT = 0; this.speed = 0;
    for (const k of ['walk', 'run', 'back', 'idle', 'hitF']) this.act[k].fadeOut(0.25);
    this.act.over.reset().setEffectiveWeight(1).fadeIn(0.2).play(); this.gait = null;
    for (const e of this.eyes) e.visible = false; if (this.titan && this.team === 'enemy' && this.hasLight) W.titanLight.intensity = 0;
    sound.shutdown(camera.position.distanceTo(this.pos)); fx.sparks(this.eye, 30, 14);
    mission.onDown(this);
  }
  destroy() {
    this.state = 'dead'; this.act.death.reset().setEffectiveWeight(1).fadeIn(0.2).play(); this.act.over.fadeOut(0.2);
    for (const e of this.eyes) e.visible = false; this.u.uHeat.value = 0; this.u.uDark.value *= 0.45;
    const c = this.center; fx.explosion(c, this.titan ? 2.2 : 1.5); sound.explosion(camera.position.distanceTo(c), this.titan ? 1.6 : 1.2);
    fx.shake = Math.max(fx.shake, 1.2 * clamp(1 - camera.position.distanceTo(c) / 70, 0.15, 1));
    later(0.6, () => W.fires.push(new Fire(scene, this.pos.clone().add(V3(0, 1.2, 0)), 1.0 * this.s, false)));
    mission.onDestroyed(this);
  }
}

/* ---------- AI androids and drones ---------- */
const DROID = {cyborg: {H: 2.15, hp: 85, hr: 0.7}, biped: {H: 2.5, hp: 85, hr: 0.7}, drone: {H: 1.7, hp: 60, hr: 1.15}};
class Droid {
  constructor(kind, x, z, yaw) {
    this.id = ++uid; this.kind = kind; const D = DROID[kind]; this.H = D.H; this.hr = D.hr; this.hp = D.hp; this.fly = kind === 'drone';
    this.root = SkeletonUtils.clone(A.tpl[kind]); this.root.position.set(x, GROUND, z); this.root.rotation.order = 'YXZ'; this.root.rotation.y = yaw; scene.add(this.root);
    const anims = A[kind].animations; this.mixer = new THREE.AnimationMixer(this.root.children[0]);
    const clipD = anims.find(a => a.name === 'Idle') || anims[0]; if (clipD) { const a = this.mixer.clipAction(clipD); a.time = Math.random() * 2; a.play(); }
    this.pos = this.root.position; this.yaw = yaw; this.state = 'active'; this.fireCD = rand(1.5, 3.5); this.fallT = 0; this.r = 0.6; this.wave = 0;
    if (this.fly) { this.alt = rand(6, 9.5); this.pos.y = this.alt; this.vel = V3(); this.strafe = Math.random() < 0.5 ? 1 : -1; this.flipT = rand(2, 4); this.t = rand(0, 10); }
    droids.push(this);
  }
  get center() { return V3(this.pos.x, this.pos.y + this.H * 0.6, this.pos.z); }
  update(dt) {
    if (this.state === 'dead') {
      if (this.fly) { if (!this.crashed) { this.vel.y -= 16 * dt; this.pos.addScaledVector(this.vel, dt); this.root.rotation.z += 5 * dt;
        if (this.pos.y <= GROUND + 0.3) { this.pos.y = GROUND + 0.3; this.crashed = true; fx.explosion(this.center, 0.55); sound.explosion(camera.position.distanceTo(this.pos), 0.6); } } return; }
      if (this.fallT < 1) { this.fallT = Math.min(1, this.fallT + dt * 2.2); this.root.rotation.x = -1.5 * this.fallT * this.fallT; } return;
    }
    this.mixer.update(dt);
    const P = player.mech; if (!P || P.state === 'dead' || mission.phase === 'intro') return;
    const c = this.center, tgt = P.center, d = c.distanceTo(tgt), want = Math.atan2(tgt.x - c.x, tgt.z - c.z);
    if (this.fly) this.flyTo(dt, P);
    if (d < (this.fly ? 85 : 70)) {
      this.yaw = turnTo(this.yaw, want, (this.fly ? 3.5 : 2.5) * dt); this.root.rotation.y = this.yaw;
      this.fireCD -= dt;
      if (this.fireCD <= 0 && Math.abs(angDiff(this.yaw, want)) < 0.25 && losClear(c, tgt)) {
        this.fireCD = this.fly ? rand(1.1, 2.0) : rand(1.4, 2.6);
        const from = c.clone().add(fwdOf(this.yaw).multiplyScalar(this.fly ? 1.0 : 0.6)).add(V3(0, this.fly ? -0.3 : 0.2, 0));
        const aim = tgt.clone().add(V3(rand(-1.5, 1.5), rand(-1.5, 2), rand(-1.5, 1.5)));
        shoot(from, aim.sub(from).normalize(), 'enemy', this.fly ? 3.5 : 4, 120, 3); sound.bolt(camera.position.distanceTo(from));
        fx.emit(TEX.red, from, {life: 0.08, size: 0.8});
      }
    }
  }
  // drones keep a stand-off distance, circle the player and stay out of buildings
  flyTo(dt, P) {
    this.t += dt; this.flipT -= dt; if (this.flipT < 0) { this.flipT = rand(2, 4.5); this.strafe *= -1; }
    const to = V3(P.pos.x - this.pos.x, 0, P.pos.z - this.pos.z), d = to.length(); to.normalize();
    const goal = d > 34 ? to : d < 16 ? to.clone().negate() : V3(-to.z, 0, to.x).multiplyScalar(this.strafe);
    this.vel.lerp(goal.multiplyScalar(7.5), Math.min(1, dt * 1.4));
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y = lerp(this.pos.y, this.alt + Math.sin(this.t * 1.7) * 0.4, Math.min(1, dt * 1.5));
    this.pos.x = clamp(this.pos.x, BOUNDS.x0 + 3, BOUNDS.x1 - 3); this.pos.z = clamp(this.pos.z, BOUNDS.z0 + 3, BOUNDS.z1 - 3);
    for (const b of BOXES) { if (b.h < this.pos.y - 1.5) continue; const p = this.pos, pad = 1.8; if (p.x > b.x0 - pad && p.x < b.x1 + pad && p.z > b.z0 - pad && p.z < b.z1 + pad) {
      const o = [[b.x0 - pad - p.x, 0], [b.x1 + pad - p.x, 0], [0, b.z0 - pad - p.z], [0, b.z1 + pad - p.z]].sort((u, v) => Math.hypot(...u) - Math.hypot(...v))[0]; p.x += o[0]; p.z += o[1]; } }
    const fwd = fwdOf(this.yaw); this.root.rotation.x = clamp((this.vel.x * fwd.x + this.vel.z * fwd.z) * 0.035, -0.3, 0.3);
  }
  damage(n) {
    if (this.state === 'dead') return; this.hp -= n;
    if (this.hp <= 0) { this.state = 'dead'; fx.sparks(this.center, 24, 10); fx.emit(TEX.flash, this.center, {life: 0.12, size: 2.5, grow: 10}); sound.hit(camera.position.distanceTo(this.pos)); if (this.fly) this.vel.y = 0; mission.onDroid(this); }
  }
}

/* ---------- the AI Core (last mission) ---------- */
let coreEnt = null;
function makeCore() {
  const m = C.core; m.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(m), c = b.getCenter(V3()), s = b.getSize(V3());
  // a fair hitbox: the visible machine, trimmed a little
  const hb = new THREE.Box3(V3(c.x - s.x * 0.42, b.min.y, c.z - s.z * 0.42), V3(c.x + s.x * 0.42, b.max.y * 0.92, c.z + s.z * 0.42));
  coreEnt = {state: 'active', shielded: true, hp: LV.core.hp, maxHp: LV.core.hp, pos: V3(c.x, GROUND, c.z), get center() { return V3(c.x, b.max.y * 0.45, c.z); }, spawnT: 6, warned: false, hx: s.x * 0.42 + 0.5, hz: s.z * 0.42 + 0.5,
    damage(n) {
      if (this.state !== 'active') return;
      if (this.shielded) { if (!this.warned) { this.warned = true; showHint('The Core is shielded while its Titans stand. Bring them down first.', 5); } return; }
      this.hp -= n; mission.coreHud(); if (this.hp <= 0) { this.hp = 0; this.state = 'dead'; mission.onCoreDestroyed(); }
    }};
  addBox(hb, coreEnt); CAMBOXES.push({x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, h: b.max.y});
  const mats = []; m.traverse(o => { if (o.isMesh) mats.push(o.material); });
  W.ticks.push(dt => { const k = coreEnt.state === 'dead' ? 0 : coreEnt.shielded ? 0.6 : 1.0 + 0.6 * Math.max(0, Math.sin(W.t * 6));
    for (const mt of mats) mt.emissiveIntensity = (0.55 + 0.35 * Math.sin(W.t * 2.4)) * k;
    if (C.shield) C.shield.material.opacity = coreEnt.shielded ? 0.1 + 0.04 * Math.sin(W.t * 3) : Math.max(0, C.shield.material.opacity - dt * 0.2);
    if (mission.coreOpen && coreEnt.state === 'active') { coreEnt.spawnT -= dt; if (coreEnt.spawnT <= 0) { coreEnt.spawnT = 12;
      if (droids.filter(d => d.fly && d.state === 'active').length < 6) for (const sx of [-10, 10]) { const d = new Droid('drone', c.x + sx, c.z + s.z * 0.55, 0); d.pos.y = 18; } } } });
}

/* ---------- weapons ---------- */
// ray/segment hit test against everything solid; skip = an entity to ignore
function hitTest(a, b, team, skip) {
  let best = 1.01, hit = null;
  const bx = segBoxes(a, b); if (bx !== null && bx < best) { best = bx; const box = segBoxes.box; hit = box.ent ? {kind: 'core', obj: box.ent} : {kind: 'wall'}; }
  if (b.y < -0.1 && a.y > -0.1) { const t = (a.y + 0.1) / (a.y - b.y); if (t < best) { best = t; hit = {kind: 'ground'}; } }
  for (const m of mechs) {
    if (m === skip || m.state === 'dead') continue; if (team === 'enemy' && m.team === 'enemy') continue; if (team === 'player' && m === player.mech) continue;
    const [d, s] = segSeg(a, b, V3(m.pos.x, m.pos.y + 0.9 * m.s, m.pos.z), V3(m.pos.x, m.pos.y + 6.7 * m.s, m.pos.z));
    if (d < m.r * 0.9 && s < best) { best = s; hit = {kind: 'mech', obj: m}; }
  }
  if (team === 'player') for (const r of droids) {
    if (r.state === 'dead') continue;
    const [d, s] = segSeg(a, b, V3(r.pos.x, r.pos.y + 0.3, r.pos.z), V3(r.pos.x, r.pos.y + r.H, r.pos.z));
    if (d < r.hr && s < best) { best = s; hit = {kind: 'droid', obj: r}; }
  }
  if (!hit) return null; hit.t = best; hit.point = a.clone().lerp(b, best); return hit;
}
function shoot(from, dir, team, dmg, speed, len) {
  fx.tracer(from, dir, speed, len, team, (p, q) => {
    const h = hitTest(p, q, team, null); if (!h) return false;
    fx.impact(h.point, h.kind === 'mech' || h.kind === 'core');
    if (h.kind === 'mech') { h.obj.damage(dmg, from, false); if (team === 'player') { hitMarker(); stats.hits++; sound.hit(camera.position.distanceTo(h.point)); } }
    if (h.kind === 'droid') { h.obj.damage(dmg * 2.2); if (team === 'player') { hitMarker(); stats.hits++; } }
    if (h.kind === 'core' && team === 'player') { h.obj.damage(dmg); if (!h.obj.shielded) { hitMarker(); stats.hits++; } }
    return true;
  });
}
const rocketGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.9, 8).rotateX(Math.PI / 2), rocketMat = new THREE.MeshStandardMaterial({color: 0x3a3d40, metalness: 0.6, roughness: 0.4});
function launchRocket(from, dir, team, target) {
  const m = new THREE.Mesh(rocketGeo, rocketMat); m.position.copy(from); m.lookAt(from.clone().add(dir)); scene.add(m);
  const g = sprite(team === 'player' ? TEX.fire : TEX.red); g.scale.setScalar(1.4); m.add(g); g.position.z = -0.6;
  rockets.push({m, vel: dir.clone().multiplyScalar(team === 'player' ? 75 : 55), team, life: 4, trail: 0, target});
  sound.rocket(camera.position.distanceTo(from)); fx.emit(TEX.flash, from, {life: 0.12, size: 2.2, grow: 8});
}
function updateRockets(dt) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i], p = r.m.position.clone(); r.life -= dt;
    if (r.target && r.target.state === 'active') { const want = r.target.center.sub(p).normalize().multiplyScalar(r.vel.length()); r.vel.lerp(want, Math.min(1, dt * (r.team === 'enemy' ? 0.9 : 1.6))); }
    r.m.position.addScaledVector(r.vel, dt); r.m.lookAt(r.m.position.clone().add(r.vel));
    r.trail -= dt; if (r.trail < 0) { r.trail = 0.016; fx.emit(TEX.smoke, p, {vel: [rand(-0.3, 0.3), rand(0.2, 0.6), rand(-0.3, 0.3)], life: 1.4, size: 0.45, grow: 1.3, opacity: 0.5, add: false}); fx.emit(TEX.fire, p, {life: 0.09, size: 0.7}); }
    const h = hitTest(p, r.m.position, r.team, null);
    if (h || r.life <= 0) { const direct = h && (h.kind === 'mech' || h.kind === 'droid' || (h.kind === 'core' && r.team === 'player')) ? h.obj : null; explode(h ? h.point : r.m.position.clone(), r.team, direct); scene.remove(r.m); rockets.splice(i, 1); }
  }
}
function explode(at, team, direct) {
  fx.explosion(at, 0.8); sound.explosion(camera.position.distanceTo(at), 0.8);
  fx.shake = Math.max(fx.shake, 0.7 * clamp(1 - camera.position.distanceTo(at) / 50, 0, 1));
  const R = 7, dmgDirect = team === 'player' ? 150 : 45, dmgSplash = team === 'player' ? 80 : 25;
  if (direct) { direct.damage(dmgDirect, at, true); if (team === 'player' && !direct.shielded) { hitMarker(); stats.hits++; } }
  for (const m of mechs) { if (m === direct || m.state === 'dead') continue; if (team === 'player' && m === player.mech) continue; if (team === 'enemy' && m.team === 'enemy') continue;
    const d = m.center.distanceTo(at) - m.r; if (d < R) m.damage(dmgSplash * (1 - Math.max(0, d) / R), at, true); }
  if (team === 'player') for (const r of droids) { if (r === direct || r.state === 'dead') continue; const d = r.center.distanceTo(at); if (d < 4.5) r.damage(110 * (1 - d / 4.5)); }
}

/* ---------- collision ---------- */
function resolve(m) {
  const p = m.pos;
  const ex = p.x, ez = p.z; p.x = clamp(p.x, BOUNDS.x0 + m.r, BOUNDS.x1 - m.r); p.z = clamp(p.z, BOUNDS.z0 + m.r, BOUNDS.z1 - m.r); m.edge = ex !== p.x || ez !== p.z;
  for (const b of BOXES) { // push a circle out of a box
    const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1), dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
    if (d < m.r) { if (d > 1e-4) { p.x = cx + dx / d * m.r; p.z = cz + dz / d * m.r; } else { const opts = [[b.x0 - m.r - p.x, 0], [b.x1 + m.r - p.x, 0], [0, b.z0 - m.r - p.z], [0, b.z1 + m.r - p.z]].sort((u, v) => Math.hypot(...u) - Math.hypot(...v)); p.x += opts[0][0]; p.z += opts[0][1]; } }
  }
  for (const c of CIRCLES) { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + m.r * 0.8; if (d < min && d > 1e-4) { p.x = c.x + dx / d * min; p.z = c.z + dz / d * min; } }
  for (const o of mechs) { if (o === m || o.state === 'dead') continue; const dx = p.x - o.pos.x, dz = p.z - o.pos.z, d = Math.hypot(dx, dz), min = (m.r + o.r) * 0.9; if (d < min && d > 1e-4) { const k = (min - d) * (o.state === 'active' ? 0.5 : 1); p.x += dx / d * k; p.z += dz / d * k; } }
}
function freeAt(x, z, r, self) {
  if (x < BOUNDS.x0 + r || x > BOUNDS.x1 - r || z < BOUNDS.z0 + r || z > BOUNDS.z1 - r) return false;
  if (inBox(x, z, r)) return false;
  for (const c of CIRCLES) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return false;
  for (const o of mechs) if (o !== self && o.state !== 'dead' && Math.hypot(x - o.pos.x, z - o.pos.z) < o.r + r) return false;
  return true;
}
function steer(m, yaw) {
  for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0]) { const y = yaw + off * (m.strafe || 1), f = fwdOf(y); if (freeAt(m.pos.x + f.x * (m.r + 5), m.pos.z + f.z * (m.r + 5), m.r * 0.8, m)) return y; }
  return yaw;
}

/* ---------- enemy mech brain ---------- */
function think(m, dt) {
  const P = player.mech; if (!P || P.state === 'dead' || mission.phase === 'intro' || mission.phase === 'transfer') { m.locomote('idle', 0); return; }
  const to = P.pos.clone().sub(m.pos), dist = Math.hypot(to.x, to.z), yawTo = Math.atan2(to.x, to.z);
  const eye = m.eye, tgt = P.center, los = losClear(eye, tgt);
  m.aimYaw = turnTo(m.aimYaw, yawTo, (m.titan ? 1.3 : 2.0) * dt);
  m.aimPitch = Math.atan2(tgt.y - (m.pos.y + m.H * 0.72), dist);
  const near = m.titan ? 26 : 20, far = m.titan ? 55 : 44;
  m.thinkT -= dt;
  if (m.thinkT <= 0) { m.thinkT = rand(1.6, 3.2); m.strafe = Math.random() < 0.5 ? 1 : -1;
    m.mode = !los || dist > far ? 'close' : dist < near ? 'back' : Math.random() < (m.titan ? 0.35 : 0.6) ? 'strafe' : 'hold'; }
  let moveYaw = null, gait = 'walk', v = (m.titan ? 2.6 : 3.4) * m.s * 0.75;
  if (m.mode === 'close') moveYaw = steer(m, yawTo);
  else if (m.mode === 'strafe') moveYaw = steer(m, yawTo + m.strafe * 1.45);
  else if (m.mode === 'back') { moveYaw = yawTo; gait = 'back'; v = 2.2 * m.s * 0.7; }
  if (moveYaw === null) { m.speed = lerp(m.speed, 0, dt * 3); m.heading = turnTo(m.heading, yawTo, 0.8 * dt); m.locomote(Math.abs(angDiff(m.heading, yawTo)) > 0.6 ? 'walk' : 'idle', 1.2); }
  else if (gait === 'back') { m.heading = turnTo(m.heading, yawTo, 1.2 * dt); m.speed = lerp(m.speed, v, dt * 2); const f = fwdOf(m.heading); m.pos.addScaledVector(f, -m.speed * dt); m.locomote('back', m.speed); }
  else { m.heading = turnTo(m.heading, moveYaw, 1.4 * dt); const align = Math.max(0, Math.cos(angDiff(m.heading, moveYaw))); m.speed = lerp(m.speed, v * align, dt * 2); m.pos.addScaledVector(fwdOf(m.heading), m.speed * dt); m.locomote('walk', Math.max(m.speed, 1)); }
  resolve(m);
  // cannons: short bursts when the target is in sight
  const slow = m.wave === 1 ? 1.5 : 1;
  m.fireCD -= dt;
  if (m.burst > 0) { m.burstT -= dt; if (m.burstT <= 0) { m.burst--; m.burstT = 0.13; enemyShot(m, tgt, dist); } }
  else if (m.fireCD <= 0 && los && dist < 85 && Math.abs(angDiff(m.aimYaw, yawTo)) < 0.18) { m.burst = m.titan ? 8 : 5; m.fireCD = rand(2.2, 3.6) * slow; }
  if (m.titan || m.wave >= 2) { m.rocketCD -= dt;
    if (m.salvo > 0) { m.burstT -= dt; if (m.burstT <= 0) { m.salvo--; m.burstT = 0.28; const from = m.eye.add(V3(0, 1.0 * m.s, 0)).add(rightOf(m.heading).multiplyScalar((m.salvo % 2 ? 1 : -1) * 1.2 * m.s)); launchRocket(from, tgt.clone().add(V3(0, 4, 0)).sub(from).normalize(), 'enemy', P); } }
    else if (m.rocketCD <= 0 && los && dist < 80) { m.salvo = m.titan ? 4 : 2; m.rocketCD = m.titan ? rand(7, 10) : rand(11, 16); } }
}
function enemyShot(m, tgt, dist) {
  const i = (m.armIdx ^= 1), from = m.muzzle(i), spread = 0.7 + dist * 0.03 + player.mech.speed * 0.25;
  const aim = tgt.clone().add(V3(rand(-1, 1) * spread, rand(-0.6, 1) * spread, rand(-1, 1) * spread));
  shoot(from, aim.sub(from).normalize(), 'enemy', m.titan ? 13 : 6.5, 150, 5);
  fx.emit(TEX.flash, from, {life: 0.06, size: 1.8 * m.s}); fx.flashLight(from, 0xff6040, 30, 0.06, 14);
  sound.enemyCannon(camera.position.distanceTo(from));
}

/* ---------- player ---------- */
const player = {mech: null, camYaw: Math.PI, camPitch: 0.06, heat: 0, lock: false, fireT: 0, rockets: 6, rocketT: 0, reloadT: 0, holdE: 0, hurt: 0, aim: V3(), aimTarget: null};
const stats = {shots: 0, hits: 0, kills: 0, hijacks: 0, start: 0, time: 0, armorLost: 0};
const keys = {}; let mouseFire = false, mouseRocket = false, locked = false;
const tap = {fire: false, rocket: false, reload: false}; // presses shorter than a frame still count
const bot_ = {stuck: 0, side: 0, last: V3(), route: null, routeT: 0, routeTo: null, tgt: null, ban: null, banT: 0, aimO: null, aimT: 0, aimHp: 0};
const hpOf = o => o.armor ?? o.hp ?? 0;
function bot(dt) { // test autopilot: face the nearest enemy, close in, fire, hijack when possible
  const m = player.mech; let best = null, bd = 1e9;
  const cands = [...mechs, ...droids]; if (coreEnt && mission.coreOpen && coreEnt.state === 'active') cands.push(coreEnt);
  // prefer the nearest target in line of sight; otherwise walk toward the nearest one
  let near = null, nd = 1e9;
  for (const o of cands) { if (o === m || o.state !== 'active' || o.team === 'player' || o.team === 'neutral') continue; const d = o.pos.distanceTo(m.pos);
    if (d < nd) { nd = d; near = o; } if (o === bot_.ban && bot_.banT > 0) continue; if (d < bd && losClear(camera.position, o.center) && losClear(m.eye, o.center)) { bd = d; best = o; } }
  const keep = bot_.tgt; if (best && keep && keep !== best && keep.state === 'active' && keep.team !== 'player' && keep.team !== 'neutral' && losClear(camera.position, keep.center) && losClear(m.eye, keep.center)) { const kd = keep.pos.distanceTo(m.pos); if (kd < bd * 1.6) { best = keep; bd = kd; } }
  // like a player told to burn the Core: once it is open and in sight, it is the target
  if (coreEnt && mission.coreOpen && coreEnt.state === 'active' && coreSeen(camera.position) && coreSeen(m.eye)) { best = coreEnt; bd = coreEnt.pos.distanceTo(m.pos); }
  const blind = !best && near; if (blind) { best = near; bd = nd; } bot_.tgt = blind ? null : best;
  for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'KeyQ', 'KeyE', 'ShiftLeft']) keys[k] = false; bot_.banT -= dt;
  // unstick: if the walk is blocked, sidestep for a moment
  if (bot_.side > 0) { bot_.side -= dt; keys[bot_.dir > 0 ? 'KeyD' : 'KeyA'] = true; keys.KeyW = true; return; }
  const cand = hijackCandidate(); if (cand && cand.team === 'enemy' && (m.armor / m.maxArmor < 0.7 || cand.titan || !stats.hijacks)) { const d = cand.pos.clone().sub(m.pos); player.camYaw = Math.atan2(d.x, d.z); keys.KeyE = true; keys.KeyW = d.length() > cand.r + m.r + 3; return; }
  const down = mechs.find(o => o.state === 'down' && o.team === 'enemy' && (o.titan || !stats.hijacks)); if (down) { const d = down.pos.clone().sub(m.pos); bot_.routeT -= dt; if (bot_.routeT <= 0 || bot_.routeTo !== down) { bot_.route = botRoute(m, down.pos); bot_.routeT = 0.8; bot_.routeTo = down; }
    player.camYaw = turnTo(player.camYaw, d.length() < 14 || bot_.route === null ? Math.atan2(d.x, d.z) : bot_.route, 0.12); keys.KeyW = true; botMove(dt); return; }
  if (!best) { const d = V3(LV.rally[0] - m.pos.x, 0, LV.rally[1] - m.pos.z); keys.KeyW = mission.mode !== 'survival' && d.length() > 12; if (keys.KeyW) player.camYaw = turnTo(player.camYaw, Math.atan2(d.x, d.z), 0.08); botMove(dt); return; }
  if (blind) { const d = best.pos.clone().sub(m.pos); bot_.routeT -= dt; if (bot_.routeT <= 0 || bot_.routeTo !== best) { bot_.route = botRoute(m, best.pos); bot_.routeT = 0.8; bot_.routeTo = best; }
    player.camYaw = turnTo(player.camYaw, bot_.route ?? steer(m, Math.atan2(d.x, d.z)), 0.08); keys.KeyW = true; keys.ShiftLeft = d.length() > 25; botMove(dt); return; }
  // shots not landing (target on a ledge, behind a lip): stop wasting fire and walk to a new angle for a while
  if (best === bot_.aimO) { bot_.aimT += dt; if (hpOf(best) < bot_.aimHp - 0.5) { bot_.aimT = 0; bot_.aimHp = hpOf(best); } if (bot_.aimT > 4) { bot_.ban = best; bot_.banT = 6; bot_.aimO = null; } }
  else { bot_.aimO = best; bot_.aimT = 0; bot_.aimHp = hpOf(best); }
  const d = best.center.sub(camera.position); player.camYaw = turnTo(player.camYaw, Math.atan2(d.x, d.z), 0.08); player.camPitch += (clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)) + 0.02, -0.42, 0.5) - player.camPitch) * 0.15;
  keys.KeyW = bd > (best === coreEnt ? 45 : 30); keys.KeyS = bd < 11 && best !== coreEnt; keys.Space = bd < 110 && !player.lock; keys.KeyQ = (best instanceof Mech || best === coreEnt) && bd < 80 && Math.random() < 0.3;
  botMove(dt);
}
// test autopilot route: breadth-first search over a 2.5 m grid, returns the heading to the next waypoint (null if no route)
function botRoute(m, goal) {
  const S = 2.5, x0 = BOUNDS.x0, z0 = BOUNDS.z0, W = Math.ceil((BOUNDS.x1 - x0) / S), H = Math.ceil((BOUNDS.z1 - z0) / S);
  const cell = (x, z) => clamp(Math.floor((z - z0) / S), 0, H - 1) * W + clamp(Math.floor((x - x0) / S), 0, W - 1);
  const cx = i => x0 + (i % W + 0.5) * S, cz = i => z0 + (Math.floor(i / W) + 0.5) * S;
  const a = cell(m.pos.x, m.pos.z), b = cell(goal.x, goal.z), prev = new Int32Array(W * H).fill(-1), seen = new Uint8Array(W * H);
  const q = [a]; seen[a] = 1; let found = false;
  for (let h = 0; h < q.length && !found; h++) { const i = q[h], x = i % W, z = Math.floor(i / W);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const j = nz * W + nx; if (seen[j]) continue; seen[j] = 1;
      if (j !== b && !freeAt(cx(j), cz(j), m.r * 1.1, m)) continue; prev[j] = i; if (j === b) { found = true; break; } q.push(j); } }
  if (!found) return null;
  let j = b, wp = b; while (prev[j] !== -1 && prev[j] !== a) { j = prev[j]; if (Math.hypot(cx(j) - m.pos.x, cz(j) - m.pos.z) > 7) wp = j; } if (wp === b) wp = j;
  return Math.atan2(cx(wp) - m.pos.x, cz(wp) - m.pos.z);
}
function botMove(dt) { const m = player.mech; if (keys.KeyW) { const moved = Math.hypot(m.pos.x - bot_.last.x, m.pos.z - bot_.last.z); bot_.stuck = moved < 0.6 * dt ? bot_.stuck + dt : 0; if (bot_.stuck > 1.2) { bot_.stuck = 0; bot_.side = 1.4; bot_.dir = Math.random() < 0.5 ? 1 : -1; bot_.routeT = 0; } } bot_.last.copy(m.pos); }
function playerControl(dt) {
  const m = player.mech; if (!m || m.state !== 'active') return;
  if (Q.has('bot')) bot(dt);
  const k = c => keys[c] ? 1 : 0;
  if (!locked) player.camYaw += (k('ArrowLeft') - k('ArrowRight')) * 1.9 * dt;
  const f = k('KeyW') + (locked ? k('ArrowUp') : k('ArrowUp')) - k('KeyS') - k('ArrowDown'), sd = k('KeyD') - k('KeyA') + (locked ? k('ArrowRight') - k('ArrowLeft') : 0);
  const run = keys.ShiftLeft || keys.ShiftRight, cy = player.camYaw, s = m.s;
  m.aimYaw = cy; m.aimPitch = player.camPitch * 0.9 + 0.02;
  // aim the torso at whatever the crosshair is on
  if (player.aim) { const mz = m.eye; const d = player.aim.clone().sub(mz); m.aimYaw = Math.atan2(d.x, d.z); m.aimPitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); }
  const p0 = m.pos.clone();
  if (f < -0.2 && Math.abs(sd) < 0.6) { // back away while facing the fight
    m.heading = turnTo(m.heading, cy, 1.6 * dt); m.speed = lerp(m.speed, 2.6 * s, dt * 3);
    m.pos.addScaledVector(fwdOf(m.heading), -m.speed * dt).addScaledVector(rightOf(cy), sd * 1.2 * dt); m.locomote('back', m.speed);
  } else if (f || sd) {
    const mv = fwdOf(cy).multiplyScalar(Math.max(f, 0)).add(rightOf(cy).multiplyScalar(sd)), want = Math.atan2(mv.x, mv.z);
    m.heading = turnTo(m.heading, want, (run ? 1.7 : 2.3) * dt);
    const align = Math.max(0, Math.cos(angDiff(m.heading, want))), top = (run ? 7.8 : 4.4) * s;
    m.speed = lerp(m.speed, top * (0.25 + 0.75 * align), dt * 2.5); m.pos.addScaledVector(fwdOf(m.heading), m.speed * dt);
    m.locomote(run && m.speed > 5 ? 'run' : 'walk', m.speed);
  } else {
    m.speed = lerp(m.speed, 0, dt * 4);
    if (Math.abs(angDiff(m.heading, cy)) > 1.0) { m.heading = turnTo(m.heading, cy, 1.1 * dt); m.locomote('walk', 1.3); }
    else { if (m.speed > 0.4) m.pos.addScaledVector(fwdOf(m.heading), m.speed * dt); m.locomote(m.speed > 0.6 ? 'walk' : 'idle', Math.max(m.speed, 0.6)); }
  }
  resolve(m);
  // pushing against a wall: stop the walk cycle instead of marching on the spot
  const moved = Math.hypot(m.pos.x - p0.x, m.pos.z - p0.z) / dt;
  if ((f || sd) && m.speed > 1 && moved < m.speed * 0.3) { m.speed = Math.max(moved, 0); m.locomote('idle', 0.6);
    if (m.edge && W.t - (player.edgeWarn || -99) > 6) { player.edgeWarn = W.t; showHint('AI defense grid. Machines cannot cross it. Turn back to the fight.', 3.5); sound.overheat(); } }
  // cannons with heat
  player.fireT -= dt;
  const firing = keys.Space || keys.KeyF || mouseFire || tap.fire; tap.fire = false;
  if (firing && !player.lock && player.fireT <= 0) {
    player.fireT = 0.1; const i = (m.armIdx ^= 1), from = m.muzzle(i), dir = player.aim.clone().sub(from).normalize();
    dir.add(V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.006)).normalize();
    shoot(from, dir, 'player', 14, 190, 7); stats.shots++;
    fx.emit(TEX.flash, from, {life: 0.05, size: 2.4}); fx.flashLight(from, 0xffc070, 45, 0.05, 16); sound.cannon(0);
    player.heat += 2.4; fx.shake = Math.max(fx.shake, 0.06);
    if (player.heat >= 100) { player.heat = 100; player.lock = true; sound.overheat(); showHint('Cannons overheated. Let them cool or switch to rockets.', 2.2); }
  } else player.heat = Math.max(0, player.heat - (firing ? 6 : 30) * dt);
  if (player.lock && player.heat < 35) player.lock = false;
  // rockets
  player.rocketT -= dt;
  if (player.reloadT > 0) { player.reloadT -= dt; if (player.reloadT <= 0) { player.rockets = 6; sound.servo(0); } }
  const wantRocket = keys.KeyQ || mouseRocket || tap.rocket; tap.rocket = false;
  if (wantRocket && player.rockets > 0 && player.rocketT <= 0 && player.reloadT <= 0) {
    player.rocketT = 0.22; player.rockets--; const side = player.rockets % 2 ? 1 : -1;
    const from = m.eye.add(V3(0, 0.9 * s, 0)).add(rightOf(m.aimYaw).multiplyScalar(side * 1.3 * s));
    launchRocket(from, player.aim.clone().sub(from).normalize(), 'player', player.aimTarget && player.aimTarget.state !== 'dead' ? player.aimTarget : null); stats.shots++;
    if (player.rockets === 0) player.reloadT = 5;
  }
  const wantReload = keys.KeyR || tap.reload; tap.reload = false;
  if (wantReload && player.rockets < 6 && player.reloadT <= 0) player.reloadT = 5 * (1 - player.rockets / 12);
  // hijack: hold E next to an overheated mech
  const cand = hijackCandidate();
  if (cand && keys.KeyE) { player.holdE += dt; if (player.holdE >= 1.3) { player.holdE = 0; hijack(cand); } } else player.holdE = Math.max(0, player.holdE - dt * 2);
}
function hijackCandidate() {
  const m = player.mech; if (!m || m.state !== 'active') return null;
  let best = null, bd = 1e9;
  for (const o of mechs) if (o !== m && o.state === 'down') { const d = Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z) - o.r - m.r; if (d < 6 && d < bd) { bd = d; best = o; } }
  return best;
}
function hijack(target) {
  const old = player.mech; stats.hijacks++;
  mission.transfer = {t: 0, from: {pos: camera.position.clone(), dir: camRig(old).dir}, old, target}; mission.phase = 'transfer';
  sound.hijack(); grade.uniforms.uGlitch.value = 1;
  // the abandoned mech powers down where it stands
  old.state = 'down'; old.team = 'neutral'; old.armor = Math.max(old.armor, 1); old.downT = 0; old.u.uHeat.value = 0;
  for (const k of ['walk', 'run', 'back', 'idle']) old.act[k].fadeOut(0.4); old.act.over.reset().fadeIn(0.3).play(); old.gait = null;
  for (const e of old.eyes) e.visible = false;
  // the captured one reboots on our side, armor patched by the override
  target.team = 'player'; target.state = 'boot';
  target.maxArmor = target.titan ? 3200 : 1000; target.armor = target.titan ? 3200 : 850;
  target.u.uHeat.value = 0; target.setPaint('player'); target.act.over.fadeOut(0.3); target.act.boot.reset().fadeIn(0.3).play(); target.gait = null;
  for (const e of target.eyes) e.visible = true;
  player.mech = target; player.warned = false; player.camYaw = target.heading; player.heat = 0; player.lock = false; player.rockets = 6; player.reloadT = 0;
  $('unit').textContent = (target.titan ? 'TITAN' : 'STRIKER') + ' · HIJACKED';
  mission.onHijack(target);
}

/* ---------- camera ---------- */
function camRig(m, dt) { // dt: the live camera, which eases back out after a wall pushes it in
  const s = m.s, pivot = m.pos.clone().add(V3(0, (m.titan ? 8.6 : 6.4), 0)), yaw = player.camYaw, pitch = player.camPitch;
  const dir = V3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const dist = m.titan ? 18 : 13.5;
  let pos = pivot.clone().addScaledVector(dir, -dist).addScaledVector(rightOf(yaw), (m.titan ? 5.2 : 4.0)).add(V3(0, 1.0 * s, 0));
  const t = segBoxes(pivot, pos, CAMBOXES.length ? BOXES.concat(CAMBOXES) : BOXES); let k = t !== null ? Math.max(0.15, t - 0.06) : 1;
  if (dt !== undefined) { player.camK = k < (player.camK ?? 1) ? k : Math.min(k, (player.camK ?? 1) + dt * 1.2); k = player.camK; }
  if (k < 1) pos = pivot.clone().lerp(pos, k);
  pos.y = Math.max(pos.y, 1.2);
  return {pos, dir};
}
function updateAim() {
  const r = camRig(player.mech), far = camera.position.clone().addScaledVector(r.dir, 420);
  // start the ray just past our own mech, so the machine we left behind (or anything beside us) never steals the crosshair
  const h = hitTest(camera.position.clone().addScaledVector(r.dir, Math.max(4, camera.position.distanceTo(player.mech.eye) + 2.5)), far, 'player', player.mech);
  player.aim = h ? h.point : far; player.aimTarget = h && (h.kind === 'mech' || h.kind === 'droid' || (h.kind === 'core' && !h.obj.shielded)) && h.obj.team !== 'player' ? h.obj : null;
  if (player.aim.distanceTo(player.mech.eye) < 9) player.aim = player.mech.eye.addScaledVector(r.dir, 60);
  $('xhair').classList.toggle('on', !!player.aimTarget);
}
const DBGCAM = Q.get('cam') ? Q.get('cam').split(',').map(Number) : null; // test views: cam=x,y,z,tx,ty,tz[,fov]
function applyCamera(dt) {
  if (DBGCAM) { camera.position.set(DBGCAM[0], DBGCAM[1], DBGCAM[2]); camera.lookAt(DBGCAM[3], DBGCAM[4], DBGCAM[5]); if (DBGCAM[6] && camera.fov !== DBGCAM[6]) { camera.fov = DBGCAM[6]; camera.far = 2000; camera.updateProjectionMatrix(); } return; }
  const ph = mission.phase;
  if (ph === 'title') { const t = W.t * 0.08, m = player.mech, c = m.pos, piv = V3(c.x, 4.5, c.z - 4);
    // slow orbit around the mech; a building in the way pulls the camera in instead of filling the screen
    let p = V3(c.x + Math.sin(t) * 19, 4.2 + Math.sin(t * 0.7) * 0.8, c.z + Math.cos(t) * 19 - 4); const hit = segBoxes(piv, p); if (hit !== null) p = piv.clone().lerp(p, Math.max(0.3, hit - 0.08));
    player.titleK = player.titleK === undefined ? p.distanceTo(piv) : player.titleK + (Math.min(p.distanceTo(piv), player.titleK + dt * 2) - player.titleK) * (p.distanceTo(piv) < player.titleK ? 1 : 0.5);
    camera.position.copy(piv).addScaledVector(p.sub(piv).normalize(), player.titleK); camera.lookAt(piv); return; }
  if (ph === 'intro') { const k = clamp(mission.t / mission.introLen, 0, 1), e = k * k * (3 - 2 * k), m = player.mech, c = m.pos;
    // crane shot: from low in front, up and over the mech's head (never through it or the street walls), down to the shoulder camera
    const r = camRig(m), a = V3(c.x - 3.5, 1.1, c.z - 9), p = a.clone().lerp(r.pos, e); p.y += Math.sin(e * Math.PI) * 13 * m.s;
    camera.position.copy(p); camera.lookAt(V3(c.x, 5.5 * m.s, c.z).lerp(r.pos.clone().addScaledVector(r.dir, 40), e * e)); return; }
  if (ph === 'transfer') { const T = mission.transfer, k = clamp(T.t / 2.4, 0, 1), e = k * k * (3 - 2 * k), to = camRig(player.mech);
    let mid = T.from.pos.clone().lerp(to.pos, e).add(V3(0, Math.sin(k * Math.PI) * 2.5, 0));
    const piv = player.mech.pos.clone().add(V3(0, player.mech.titan ? 8.6 : 6.4, 0)), hitT = segBoxes(piv, mid); if (hitT !== null) mid = piv.lerp(mid, Math.max(0.15, hitT - 0.06)); // keep the swing out of walls
    // the view turns from where we were looking, to the new machine, then out along its aim: no snap on the first frame
    const a = clamp(k / 0.35, 0, 1), look = T.from.pos.clone().addScaledVector(T.from.dir, 40).lerp(player.mech.center, a * a * (3 - 2 * a)).lerp(to.pos.clone().addScaledVector(to.dir, 40), e * e);
    camera.position.copy(mid); camera.lookAt(look); return; }
  const r = camRig(player.mech, dt); camera.position.copy(r.pos); camera.lookAt(r.pos.clone().add(r.dir));
  // smooth rumble rather than a new random jump every frame
  if (fx.shake > 0) { const s = Math.min(fx.shake, 1.2) * 0.22, t = W.t; camera.position.add(V3(Math.sin(t * 31) + 0.5 * Math.sin(t * 53 + 1.7), Math.sin(t * 37 + 0.9) + 0.5 * Math.sin(t * 61 + 2.3), Math.sin(t * 29 + 2.1)).multiplyScalar(s * 0.67)); }
}

/* ---------- mission ---------- */
// saved progress, kept per browser; the game works the same if storage is blocked
const save = {get() { try { const v = JSON.parse(localStorage.getItem('aipGame') || '{}'); v.done = v.done || {}; if (v.m1) v.done.city = true; return v; } catch (e) { return {done: {}}; } },
  set(v) { try { localStorage.setItem('aipGame', JSON.stringify({...save.get(), ...v})); } catch (e) {} }};
const faceStart = (x, z) => Math.atan2(LV.start[0] - x, LV.start[1] - z);
const mission = {
  phase: 'title', t: 0, wave: 0, introLen: 5, hijackHinted: false, ended: false, mode: 'campaign', score: 0, titans: [], titansTotal: 0, coreOpen: false,
  start() { this.phase = 'intro'; this.t = 0; stats.start = W.t;
    if (this.mode === 'survival') { this.introLen = 3.5; showBanner('SURVIVAL', 'HOLD THE SQUARE AS LONG AS YOU CAN', 3.2); }
    else showBanner(LV.name.toUpperCase(), LV.sub, 4);
    scoreIntensity(0.4); },
  // survival: endless waves that grow, a Titan every fifth wave
  svNext() {
    const SV = LV.survival, n = ++this.wave, titanWave = n % 5 === 0; this.done = 0;
    for (let i = droids.length - 1; i >= 0; i--) if (droids[i].state === 'dead') { scene.remove(droids[i].root); droids.splice(i, 1); }
    for (let i = mechs.length - 1; i >= 0; i--) if (mechs[i].state === 'dead' && mechs[i].wave < n - 1) { scene.remove(mechs[i].root); mechs.splice(i, 1); }
    const downs = mechs.filter(m => m.state === 'down'); while (downs.length > 5) downs.shift().destroy();
    showBanner('WAVE ' + n, titanWave ? 'TITAN INBOUND' : n === 1 ? 'HERE THEY COME' : 'MORE OF THEM', 3.2, n > 1); if (n > 1) sound.alarm(); scoreIntensity(Math.min(1, 0.4 + n * 0.08));
    const [fx_, fz] = SV.face, nd = Math.min(3 + n, 10), spots = SV.droids.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < nd; i++) { const [x, z] = spots[i]; const d = new Droid(Math.random() < 0.5 ? 'cyborg' : 'biped', x + rand(-2, 2), z + rand(-2, 2), Math.atan2(fx_ - x, fz - z)); d.wave = n; }
    const ns = Math.min(1 + Math.floor(n / 2), 4) - (titanWave ? 1 : 0);
    for (let i = 0; i < ns; i++) later(1 + i * 7, () => { const [x, z] = SV.mechs[Math.floor(Math.random() * SV.mechs.length)]; const m = new Mech('striker', 'enemy', x, z, Math.atan2(fx_ - x, fz - z)); m.wave = n; m.armor = m.maxArmor = 680 + n * 25; });
    if (titanWave) later(4, () => { this.spawnTitan(SV.titan[0], SV.titan[1], n); });
    this.need = nd + ns + (titanWave ? 1 : 0); this.svHud();
  },
  svHud() { $('objText').textContent = 'Survive · wave ' + this.wave; $('objSub').textContent = `Score ${this.score.toLocaleString('en-US')} · ${Math.min(this.done, this.need)} / ${this.need} this wave`; },
  addScore(base) { if (this.mode !== 'survival') return; this.score += Math.round(base * (1 + 0.15 * (this.wave - 1))); this.svHud(); },
  spawnTitan(x, z, wave) {
    const t = new Mech('titan', 'enemy', x, z, faceStart(x, z)); t.wave = wave;
    const tl = W.titanLight; if (tl.intensity === 0) { const tt = tl.target; tl.position.set(0, 9.6, 1.5); tt.position.set(0, 0, 25); t.root.add(tl, tt); tl.intensity = 300; t.hasLight = true; }
    return t;
  },
  // campaign waves come from the level data
  startWave(i) {
    if (this.ended) return;
    const w = LV.waves[i], n = i + 1; this.wave = n; this.done = 0; let need = 0;
    if (w.banner) { showBanner(w.banner[0], w.banner[1], 3.6, true); sound.alarm(); if (w.titans) later(1.2, () => sound.alarm()); }
    scoreIntensity(Math.min(1, 0.4 + i * 0.3));
    for (const [k, x, z] of w.droids || []) { const d = new Droid(k, x, z, faceStart(x, z)); d.wave = n; need++; }
    for (const [x, z] of w.drones || []) { const d = new Droid('drone', x, z, faceStart(x, z)); d.wave = n; need++; }
    for (const [x, z, delay = 0] of w.strikers || []) { need++; later(delay, () => { if (this.ended) return; const s = new Mech('striker', 'enemy', x, z, faceStart(x, z)); s.wave = n; }); }
    for (const [x, z, delay = 0] of w.titans || []) { need++; this.titansTotal++; later(delay, () => { if (this.ended) return; const t = this.spawnTitan(x, z, n); this.titans.push(t); }); }
    this.need = need; setObjective(...w.obj); if (w.hint) showHint(w.hint, 6.5);
  },
  progress() {
    if (this.mode === 'survival') { this.svHud(); if (this.done >= this.need && !this.ended) { this.need = 1e9; const pm = player.mech; if (pm && pm.state === 'active') pm.armor = Math.min(pm.maxArmor, pm.armor + pm.maxArmor * 0.15);
      showBanner('WAVE ' + this.wave + ' CLEARED', 'FIELD REPAIR +15% ARMOR', 3); later(7, () => !this.ended && this.svNext()); } return; }
    const last = this.wave >= LV.waves.length;
    if (!last) $('objSub').textContent = `${Math.min(this.done, this.need)} / ${this.need} neutralised`;
    if (!last && this.done >= this.need) { this.need = 1e9; const i = this.wave;
      showBanner('WAVE ' + i + ' CLEARED', 'NEXT WAVE INCOMING', 2.6); setObjective('Wave ' + i + ' cleared', 'Next wave in 4');
      for (const n of [3, 2, 1]) later(4 - n, () => { if (this.wave === i && !this.ended) $('objSub').textContent = 'Next wave in ' + n; });
      later(4, () => this.startWave(i)); } },
  titanHud() { if (this.titansTotal > 1) setObjective('Bring down the Titans', `${this.titans.filter(t => t.resolved).length} / ${this.titansTotal} taken or destroyed`); },
  onDroid(d) { stats.kills++; this.addScore(d.fly ? 80 : 50); if (d.wave === this.wave) { this.done++; this.progress(); } },
  onDown(m) {
    if (m.team === 'enemy') { this.addScore(m.titan ? 1500 : 250); if (m.wave === this.wave && !m.counted) { m.counted = true; this.done++; this.progress(); }
      if (!this.hijackHinted) { this.hijackHinted = true; showHint('Its core overheated. Walk up to it and HOLD E to take it over. Its armor comes back patched.', 9); }
      if (m.titan && this.mode === 'campaign') { if (this.titansTotal > 1) { this.titanHud(); showBanner('TITAN DOWN', 'TAKE IT OR FINISH IT', 3); } else { setObjective('Hijack the Titan', 'Hold E beside it, or destroy it'); showBanner('TITAN DOWN', 'TAKE IT', 3); } } }
  },
  onDestroyed(m) {
    if (m.team === 'enemy' || m.team === 'neutral') { if (m.team === 'enemy') stats.kills++; this.addScore(100); if (m.wave === this.wave && !m.counted) { m.counted = true; this.done++; this.progress(); } }
    if (m.titan && this.titans.includes(m) && !m.resolved) { m.resolved = true; this.titanResolved('destroy'); }
  },
  onHijack(m) {
    showBanner('HIJACK COMPLETE', m.titan ? 'TITAN UNDER YOUR CONTROL' : 'NEW MACHINE ONLINE', 3); this.addScore(300);
    if (m.titan && this.titans.includes(m) && !m.resolved) { m.resolved = true; this.titanResolved('hijack'); }
  },
  titanResolved(how) {
    if (this.ended || this.mode !== 'campaign') return; this.titanHud();
    if (this.titans.length < this.titansTotal || !this.titans.every(t => t.resolved)) return;
    if (LV.core) return later(how === 'hijack' ? 3.2 : 2.5, () => this.openCore());
    this.ended = true;
    if (how === 'hijack') later(5.2, () => endGame(true, LV.win.hijack));
    else { showBanner('TITAN DESTROYED', LV.win.destroy[0], 4); later(4.2, () => endGame(true, LV.win.destroy[1])); }
  },
  openCore() { if (this.ended) return; this.coreOpen = true; coreEnt.shielded = false; showBanner('THE SHIELD IS DOWN', 'BURN THE CORE', 4, true); sound.alarm(); scoreIntensity(1); this.coreHud(); showHint('Pour everything into the Core. It will keep sending drones.', 6); },
  coreHud() { if (this.coreOpen) setObjective('Destroy the Core', `Core integrity ${Math.ceil(coreEnt.hp / coreEnt.maxHp * 100)}%`); },
  onCoreDestroyed() {
    this.ended = true; const c = coreEnt.center; showBanner('THE CORE IS DOWN', 'IT IS OVER', 5);
    for (let i = 0; i < 9; i++) later(i * 0.35, () => { const p = c.clone().add(V3(rand(-14, 14), rand(-8, 14), rand(-14, 14))); fx.explosion(p, 2.2); sound.explosion(camera.position.distanceTo(p), 1.6); fx.shake = Math.max(fx.shake, 1.2); });
    later(3.4, () => { grade.uniforms.uGlitch.value = 0.8; later(0.6, () => { grade.uniforms.uGlitch.value = 0; }); });
    for (const d of droids) if (d.state === 'active') later(rand(0.5, 3), () => d.damage(999));
    for (const m of mechs) if (m.team === 'enemy' && m.state === 'active') later(rand(0.5, 3), () => m.goDown());
    later(6, () => endGame(true, LV.win.core));
  },
  update(dt) {
    this.t += dt;
    if (this.phase === 'intro' && this.t > this.introLen) { this.phase = 'fight'; this.t = 0; if (this.mode === 'survival') { this.svNext(); showHint('Aim with the mouse, left click fires the cannons, right click or Q fires rockets. Overheated AI mechs can be hijacked with E.', 7); } else this.startWave(0); }
    if (this.phase === 'transfer') { const T = this.transfer; T.t += dt; grade.uniforms.uGlitch.value = Math.max(0, 1 - T.t / 1.2) + (T.t > 1.9 && T.t < 2.1 ? 0.6 : 0);
      if (T.t > 1.35 && player.mech.state === 'boot') { player.mech.state = 'active'; player.mech.act.boot.fadeOut(0.4); player.mech.setGait('idle', 0.4); }
      if (T.t > 2.4) { this.phase = 'fight'; grade.uniforms.uGlitch.value = 0; } }
  },
};
function playerDestroyed() {
  const m = player.mech; m.state = 'dead'; m.act.death.reset().fadeIn(0.2).play(); for (const k of ['walk', 'run', 'back', 'idle']) m.act[k].fadeOut(0.2);
  fx.explosion(m.center, 1.6); sound.explosion(0, 1.5); fx.shake = 1.5; for (const e of m.eyes) e.visible = false; m.u.uDark.value *= 0.45;
  if (!mission.ended) { mission.ended = true; later(3.2, () => endGame(false, mission.mode === 'survival' ? 'Your machine was destroyed.' : 'Your machine was destroyed. Next time, take one of theirs before your armor runs out.')); }
}

/* ---------- HUD ---------- */
let bannerTimer = 0, hintTimer = 0;
function showBanner(big, small, dur = 3, red = false) { const b = $('banner'); b.querySelector('b').textContent = big; b.querySelector('span').textContent = small; b.classList.toggle('red', red); b.style.opacity = 1; bannerTimer = dur; }
function showHint(t, dur = 5) { const h = $('hint'); h.textContent = t; h.style.opacity = 1; hintTimer = dur; }
function setObjective(t, s) { $('objText').textContent = t; $('objSub').textContent = s; }
let hitT = 0; function hitMarker() { hitT = 0.12; }
function onPlayerHit(n, from) {
  if (!n) return; stats.armorLost += n; player.hurt = Math.min(1, player.hurt + n / 60); sound.hurt();
  const to = from.clone().sub(player.mech.pos), rel = angDiff(player.camYaw, Math.atan2(to.x, to.z));
  const el = Math.abs(rel) < 0.8 ? 'dmgF' : Math.abs(rel) > 2.3 ? 'dmgB' : rel > 0 ? 'dmgL' : 'dmgR'; const e = $(el); e.style.opacity = 1; clearTimeout(e._t); e._t = setTimeout(() => e.style.opacity = 0, 380);
  if (player.mech.armor / player.mech.maxArmor < 0.25 && !player.warned) { player.warned = true; sound.alarm(); showHint('Armor critical. Overheat an AI mech and hijack it to get a fresh machine.', 6); }
}
const markEls = new Map();
const rk = $('rk'); for (let i = 0; i < 6; i++) rk.append(document.createElement('i'));
let lastHud = '';
const MARKS = []; let markWave = 0;
const markName = o => o.titan ? 'TITAN' : o.kind === 'striker' ? 'STRIKER' : o.kind === 'drone' ? 'DRONE' : 'ANDROID';
// the last one or two enemies of a wave get a red marker with their distance (clamped to the screen edge when out of view)
function updateMarks() {
  const box = $('marks'); if (!box) return; const pm = player.mech;
  const left = mission.mode === 'campaign' && mission.phase === 'fight' && !mission.ended && mission.need < 1e8 ? mission.need - mission.done : 0;
  const list = left > 0 && left <= 2 ? [...mechs, ...droids].filter(o => o.wave === mission.wave && o.state === 'active' && o.team !== 'player' && o.team !== 'neutral') : [];
  if (list.length && markWave !== mission.wave) { markWave = mission.wave; showHint((left === 1 ? 'One enemy left: ' : 'Two enemies left: ') + list.map(o => markName(o).toLowerCase()).join(' and ') + '. Follow the red marker' + (list.length > 1 ? 's.' : '.'), 6); }
  while (MARKS.length < list.length) { const e = document.createElement('div'); e.className = 'mk'; e.innerHTML = '<i></i><b></b>'; box.appendChild(e); MARKS.push(e); }
  const w = innerWidth, h = innerHeight;
  MARKS.forEach((e, i) => { const o = list[i]; if (!o) { e.style.display = 'none'; return; }
    const v = o.center.clone(); v.y += (o.H || 2) * 0.55; v.project(camera); let x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
    const behind = v.z > 1, off = behind || x < 40 || x > w - 40 || y < 80 || y > h - 190;
    if (behind) { x = w - x; y = h - 190; } x = clamp(x, 40, w - 40); y = clamp(y, 80, h - 190); // stays above the armor panel and radar
    e.style.display = ''; e.style.left = x + 'px'; e.style.top = y + 'px'; e.classList.toggle('edge', off);
    e.lastChild.textContent = markName(o) + ' \u00b7 ' + Math.round(o.pos.distanceTo(pm.pos)) + ' m'; });
}
function updateHud(dt) {
  const m = player.mech; if (!m) return; updateMarks();
  const a = m.armor / m.maxArmor, hud = [Math.round(a * 100), Math.round(player.heat), player.lock, player.rockets, player.reloadT > 0].join();
  if (hud !== lastHud) { lastHud = hud;
    $('armor').firstChild.style.width = (a * 100) + '%'; $('armorN').textContent = Math.round(a * 100) + '%'; $('armor').classList.toggle('low', a < 0.25);
    $('heat').firstChild.style.width = player.heat + '%'; $('heatN').textContent = player.lock ? 'LOCKED' : Math.round(player.heat) + '%'; $('heat').classList.toggle('lock', player.lock);
    [...rk.children].forEach((e, i) => e.classList.toggle('off', i >= player.rockets)); $('rkN').textContent = player.reloadT > 0 ? 'RELOADING' : player.rockets; }
  if (hitT > 0) { hitT -= dt; $('hitmark').style.opacity = 1; } else $('hitmark').style.opacity = 0;
  player.hurt = Math.max(0, player.hurt - dt * 0.9); grade.uniforms.uHurt.value = Math.max(player.hurt, a < 0.25 ? 0.25 + 0.15 * Math.sin(W.t * 6) : 0);
  const cand = mission.phase === 'fight' ? hijackCandidate() : null;
  $('prompt').classList.toggle('hidden', !cand); if (cand) $('promptBar').firstChild.style.width = (player.holdE / 1.3 * 100) + '%';
  // world markers: hijack targets and enemy armor bars
  const seen = new Set(), w = innerWidth, h = innerHeight;
  for (const o of mechs) {
    if (o === m || o.state === 'dead') continue;
    const isDown = o.state === 'down', isEnemy = o.team === 'enemy' && o.state === 'active';
    if (!isDown && !isEnemy) continue;
    const p = o.pos.clone().add(V3(0, o.H * 1.08, 0)), dist = p.distanceTo(camera.position); p.project(camera);
    if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1 || dist > (isDown ? 160 : 95)) continue;
    const key = o.id + (isDown ? 'd' : 'e'); seen.add(key);
    let el = markEls.get(key); if (!el) { el = document.createElement('div'); el.className = isDown ? 'mk pulse' : 'hb' + (o.titan ? ' titan' : ''); if (!isDown) el.append(document.createElement('i')); $('markers').append(el); markEls.set(key, el); }
    el.style.left = ((p.x + 1) / 2 * w) + 'px'; el.style.top = ((1 - p.y) / 2 * h) + 'px';
    if (isDown) el.textContent = 'HIJACK · ' + Math.round(dist) + ' M'; else el.firstChild.style.width = (o.armor / o.maxArmor * 100) + '%';
  }
  for (const [k, el] of markEls) if (!seen.has(k)) { el.remove(); markEls.delete(k); }
  drawRadar();
}
const radar = $('radar'), rc = radar.getContext('2d');
function drawRadar() {
  const m = player.mech, S = 340, R = 160, range = 90, c = S / 2; rc.clearRect(0, 0, S, S);
  rc.strokeStyle = 'rgba(127,214,230,0.18)'; rc.lineWidth = 2; for (const k of [0.33, 0.66, 1]) { rc.beginPath(); rc.arc(c, c, R * k, 0, TAU); rc.stroke(); }
  const cy = player.camYaw, cos = Math.cos(cy), sin = Math.sin(cy);
  const pt = (x, z) => { const dx = x - m.pos.x, dz = z - m.pos.z; const rx = -dx * cos + dz * sin, rz = dx * sin + dz * cos; return [c + rx / range * R, c - rz / range * R]; };
  rc.save(); rc.beginPath(); rc.arc(c, c, R, 0, TAU); rc.clip();
  for (const b of BOXES) { rc.strokeStyle = b.ent ? 'rgba(255,90,70,0.6)' : 'rgba(233,237,240,0.25)'; rc.beginPath(); [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]].forEach(([x, z], i) => { const [px, py] = pt(x, z); i ? rc.lineTo(px, py) : rc.moveTo(px, py); }); rc.closePath(); rc.stroke(); }
  rc.restore();
  for (const d of droids) if (d.state !== 'dead') { const [x, y] = pt(d.pos.x, d.pos.z); if (Math.hypot(x - c, y - c) < R) { rc.fillStyle = d.fly ? '#ffa04a' : '#ff6a5a'; if (d.fly) { rc.beginPath(); rc.arc(x, y, 4, 0, TAU); rc.fill(); } else rc.fillRect(x - 3, y - 3, 6, 6); } }
  for (const o of mechs) { if (o === m || o.state === 'dead') continue; const [x, y] = pt(o.pos.x, o.pos.z), r = Math.hypot(x - c, y - c);
    const px = r > R ? c + (x - c) / r * R : x, py = r > R ? c + (y - c) / r * R : y;
    if (o.state === 'down') { if (Math.sin(W.t * 8) > -0.3) { rc.fillStyle = '#f2a541'; rc.beginPath(); rc.moveTo(px, py - 10); rc.lineTo(px + 10, py); rc.lineTo(px, py + 10); rc.lineTo(px - 10, py); rc.fill(); } }
    else if (o.team === 'enemy') { rc.fillStyle = '#ff4a3d'; rc.beginPath(); rc.arc(px, py, o.titan ? 13 : 8, 0, TAU); rc.fill(); } }
  rc.fillStyle = '#e9edf0'; rc.beginPath(); rc.moveTo(c, c - 12); rc.lineTo(c + 8, c + 9); rc.lineTo(c - 8, c + 9); rc.fill();
}

/* ---------- input ---------- */
const canvas = $('c');
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true; if (playing() && !e.repeat) { if (e.code === 'KeyQ') tap.rocket = true; if (e.code === 'KeyR') tap.reload = true; if (e.code === 'Space' || e.code === 'KeyF') tap.fire = true; }
  if (mission.phase === 'intro' && mission.t > 0.8 && !['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) mission.t = mission.introLen;
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Escape' && playing()) setPause(true); if (e.code === 'KeyP' && playing()) setPause(!paused);
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseFire = mouseRocket = false; });
canvas.addEventListener('mousedown', e => {
  if (!playing() || paused) return;
  if (!locked) lockPointer();
  if (e.button === 0) { mouseFire = true; tap.fire = true; } if (e.button === 2) { mouseRocket = true; tap.rocket = true; }
});
addEventListener('mouseup', e => { if (e.button === 0) mouseFire = false; if (e.button === 2) mouseRocket = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { const was = locked; locked = document.pointerLockElement === canvas; $('lockHint').classList.toggle('hidden', locked || !playing());
  if (was && !locked && playing() && !mission.ended) setPause(true); });
addEventListener('mousemove', e => { if (!locked || paused) return; player.camYaw -= e.movementX * 0.0022; player.camPitch = clamp(player.camPitch - e.movementY * 0.0018, -0.42, 0.5); });
function lockPointer() { try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch (e) {} }
const playing = () => ['intro', 'fight', 'transfer'].includes(mission.phase) && !mission.ended;

/* ---------- menus ---------- */
let paused = false;
function setPause(v) { paused = v; $('pause').classList.toggle('hidden', !v); if (v) { mouseFire = mouseRocket = false; if (document.pointerLockElement) document.exitPointerLock(); } else lockPointer(); }
function toggleMute() { setMuted(!isMuted()); $('bMute').textContent = 'SOUND: ' + (isMuted() ? 'OFF' : 'ON'); }
const qualLabel = () => 'QUALITY: ' + (settings.high ? 'HIGH' : 'LOW');
for (const id of ['bQual', 'bQual2']) $(id).onclick = () => { setQuality(!settings.high); $('bQual').textContent = $('bQual2').textContent = qualLabel(); };
$('bQual').textContent = $('bQual2').textContent = qualLabel();
$('bResume').onclick = () => setPause(false); $('bMute').onclick = toggleMute; $('bRestart').onclick = $('bAgain').onclick = () => location.reload();
async function openCredits() { const box = $('cred'); box.hidden = false; if (!$('credList').children.length) { const list = await fetch(BASE + 'credits.json').then(r => r.json()).catch(() => []);
  for (const c of list) { const li = document.createElement('li'), a = document.createElement('a'); a.href = c.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = c.name; li.append(c.use + ': ', a, ' by ' + c.author); $('credList').append(li); } } }
for (const id of ['bCredT', 'bCredP', 'bCredE']) $(id).onclick = openCredits; $('bCredX').onclick = () => $('cred').hidden = true;
const goLevel = id => { const u = new URL(location.href); u.search = id === 'city' ? '' : '?level=' + id; location.href = u.toString(); };
$('bPlay').onclick = () => deploy('campaign'); $('bSurv').onclick = () => deploy('survival');
function deploy(mode = 'campaign') {
  mission.mode = mode;
  if (mode === 'survival') { const m = player.mech, [x, z] = LV.survivalStart; m.pos.set(x, GROUND, z); m.heading = Math.PI; player.camYaw = Math.PI; m.place(); }
  initAudio({rain: LV.weather === 'rain'}); sound.ui(); $('title').classList.add('hidden'); $('hud').classList.remove('hidden'); lockPointer();
  mission.start();
}
function endGame(win, text) {
  stats.time = W.t - stats.start; if (document.pointerLockElement) document.exitPointerLock();
  const last = LI === LEVELS.length - 1;
  $('endT').textContent = win ? (last ? 'CAMPAIGN COMPLETE' : 'MISSION COMPLETE') : mission.mode === 'survival' ? 'SURVIVAL OVER' : 'MISSION FAILED'; $('endT').className = win ? 'win' : 'lose'; $('endP').textContent = text;
  const mm = Math.floor(stats.time / 60), ss = String(Math.floor(stats.time % 60)).padStart(2, '0');
  let extra = '';
  if (mission.mode === 'survival') { const best = save.get().best || {score: 0, wave: 0}, isBest = mission.score > best.score; if (isBest) save.set({best: {score: mission.score, wave: mission.wave}});
    extra = `<span>Score</span><b>${mission.score.toLocaleString('en-US')}${isBest ? ' · NEW BEST' : ''}</b><span>Waves reached</span><b>${mission.wave}</b>`; }
  if (win && mission.mode === 'campaign') save.set({done: {...save.get().done, [LV.id]: true}});
  const next = LEVELS[LI + 1];
  if (win && mission.mode === 'campaign' && next) { $('bNext').hidden = false; $('bNext').textContent = 'NEXT · ' + next.name.toUpperCase(); $('bNext').onclick = () => goLevel(next.id); $('bAgain').classList.remove('primary'); }
  $('endS').innerHTML = extra + `<span>Time</span><b>${mm}:${ss}</b><span>Enemies neutralised</span><b>${stats.kills}</b><span>Machines hijacked</span><b>${stats.hijacks}</b><span>Accuracy</span><b>${stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0}%</b>`;
  $('end').classList.remove('hidden'); $('hud').classList.add('hidden'); scoreIntensity(0.2);
}
function buildMenu() {
  document.title = 'AI Parabellum: ' + LV.name; $('msg').textContent = 'LOADING ' + LV.name.toUpperCase();
  const label = `MISSION ${LV.n} · ${LV.name.toUpperCase()}`; $('tag').textContent = label; $('bPlay').textContent = label; $('brief').textContent = LV.brief;
  $('bSurv').hidden = !LV.survival; $('pauseName').textContent = LV.name;
  const sv = save.get(), ol = $('campList'); ol.textContent = '';
  for (const l of LEVELS) { const li = document.createElement('li'), b = document.createElement('button'), s = document.createElement('span');
    b.type = 'button'; b.textContent = l.name; b.onclick = () => l === LV ? deploy('campaign') : goLevel(l.id);
    s.textContent = sv.done[l.id] ? 'COMPLETED' : l === LV ? 'READY' : 'PLAY'; li.className = (l === LV ? 'on' : '') + (sv.done[l.id] ? ' done' : ''); li.append(b, s); ol.append(li); }
  if (sv.best && LV.survival) $('bestLine').textContent = `Best survival: wave ${sv.best.wave} · score ${sv.best.score.toLocaleString('en-US')}`;
}
buildMenu();
if (matchMedia('(pointer: coarse)').matches) $('touchNote').hidden = false;

/* ---------- loop ---------- */
let nextFlash = 6, flashT = -1;
function lightning(dt) {
  if (!LV.lightning) return;
  nextFlash -= dt; if (nextFlash < 0) { flashT = 0; nextFlash = 10 + Math.random() * 9; later(0.6 + Math.random() * 0.9, () => sound.thunder()); }
  let k = 0; if (flashT >= 0) { flashT += dt; k = flashT < 0.08 ? 1 : flashT < 0.16 ? 0.15 : flashT < 0.26 ? 0.8 : Math.max(0, 1 - (flashT - 0.26) * 3); if (flashT > 0.7) flashT = -1; }
  moon.intensity = LV.sun.power + k * 5; hemi.intensity = LV.hemi[2] + k * 1.6; scene.backgroundIntensity = LV.sky.bg + k * 0.9;
}
function step(dt) {
  W.t += dt;
  if (!paused) {
    runTimers(); mission.update(dt);
    if (mission.phase === 'fight') playerControl(dt);
    for (const m of mechs) { if (m.team === 'enemy' && m.state === 'active') think(m, dt); m.update(dt); }
    for (const d of droids) d.update(dt);
    for (const m of W.mixers) m.update(dt);
    updateRockets(dt); fx.update(dt);
    if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) $('banner').style.opacity = 0; }
    if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) $('hint').style.opacity = 0; }
  }
  for (const f of W.fires) f.update(dt, W.t);
  for (const t of W.ticks) t(dt);
  lightning(dt);
}
const clock = new THREE.Clock();
const frame = () => render(Math.min(clock.getDelta(), 0.05));
function render(dt) {
  step(dt);
  applyCamera(dt); camera.updateMatrixWorld();
  if (player.mech && mission.phase !== 'title' && !DBGCAM) updateAim();
  // sun shadows and the headlight follow the action
  const pm = player.mech; if (pm) { const [dx, dy, dz] = LV.sun.dir; moon.target.position.set(pm.pos.x, 0, pm.pos.z - 18); moon.position.set(pm.pos.x + dx, dy, pm.pos.z - 18 + dz);
    const hp = pm.eye.add(fwdOf(pm.aimYaw).multiplyScalar(1.4 * pm.s)); headlight.position.copy(hp); headlight.target.position.copy(player.aim && mission.phase === 'fight' ? player.aim : hp.clone().add(fwdOf(pm.heading).multiplyScalar(30)).setY(0)); headlight.intensity = pm.state === 'active' && mission.phase !== 'transfer' ? LV.headlight * clamp(hp.distanceTo(headlight.target.position) / 28, 0.12, 1) : 0; }
  weather(dt, camera); if (pm) { if (mission.phase === 'title' || mission.phase === 'intro') gridU.uP.value.set(0, 0, 9999); else gridU.uP.value.copy(pm.pos); } gridU.uT.value = W.t;
  if (mission.phase !== 'title') updateHud(dt);
  grade.uniforms.uTime.value = W.t;
  composer.render();
}

// development check: report spawn points that sit inside solid geometry
function checkSpawns() {
  const bad = [], chk = (x, z, r, what) => { if (inBox(x, z, r) || x < BOUNDS.x0 || x > BOUNDS.x1 || z < BOUNDS.z0 || z > BOUNDS.z1) bad.push(what + '@' + x + ',' + z); };
  chk(LV.start[0], LV.start[1], 2, 'start');
  LV.waves.forEach((w, i) => { for (const [, x, z] of w.droids || []) chk(x, z, 0.6, 'droid' + (i + 1)); for (const [x, z] of w.strikers || []) chk(x, z, 2.1, 'striker' + (i + 1)); for (const [x, z] of w.titans || []) chk(x, z, 3, 'titan' + (i + 1)); });
  if (bad.length) console.warn('SPAWN BLOCKED ' + LV.id + ': ' + bad.join(' '));
}

/* ---------- boot ---------- */
loadAll().then(() => {
  const w = measure('a5WalkCycleRootMotion'); if (w) { FWD = w.fwd; STRIDE.walk = w.speed; }
  const r = measure('a7RunCycleRootMotion'); if (r) STRIDE.run = r.speed;
  const b = measure('a6WalkCycleBackRootMotion'); if (b) STRIDE.back = b.speed;
  A.tpl = {}; prep(A.cyborg.scene); A.tpl.cyborg = fit(A.cyborg.scene, 2.15); prep(A.biped.scene); A.tpl.biped = fit(A.biped.scene, 2.5);
  if (A.drone) { prep(A.drone.scene); A.tpl.drone = fit(A.drone.scene, 1.7); }
  buildWorld(); checkSpawns();
  const [sx, sz, sh] = LV.start; player.mech = new Mech('striker', 'player', sx, sz, sh); player.camYaw = sh;
  $('load').classList.add('done'); $('title').classList.toggle('hidden', !!DBGCAM); if (DBGCAM && DBGCAM[6]) scene.fog = null;
  if (Q.has('boxes')) for (const bx of BOXES) { const m = new THREE.Mesh(new THREE.BoxGeometry(bx.x1 - bx.x0, bx.h + 0.2, bx.z1 - bx.z0), new THREE.MeshBasicMaterial({color: bx.ent ? 0xff3020 : 0x30ff60, wireframe: true, fog: false})); m.position.set((bx.x0 + bx.x1) / 2, bx.h / 2, (bx.z0 + bx.z1) / 2); scene.add(m); }
  const REC = Q.has('rec'); // video capture: the page advances one fixed 1/30 s frame per call instead of running in real time
  if (REC) { startRecording(() => W.t); for (const id of ['hint', 'lockHint']) $(id).style.visibility = 'hidden'; } else renderer.setAnimationLoop(frame);
  window.__lt = {ready: true, scene, camera, THREE, renderer};
  window.__g = {mission, player, mechs, droids, stats, keys, deploy, step, fx, BOXES, LV, endGame, save, bot_, get core() { return coreEnt; }};
  if (REC) window.__g.rec = {get t() { return W.t; }, frame: () => render(1 / 30), audio: (t0, dur, o) => renderRecording(t0, dur, {rain: LV.weather === 'rain', ...o}),
    // fast-forward without drawing, until cond() holds or max seconds pass
    ff(max, cond) { for (let s = 0; s < max; s += 1 / 30) { if (cond && cond()) return true; step(1 / 30); applyCamera(1 / 30); camera.updateMatrixWorld(); updateAim(); updateHud(1 / 30); } return !cond; }};
  if (Q.has('play')) { deploy(Q.get('mode') || 'campaign'); if (Q.has('t')) { const T = +Q.get('t'); for (let s = 0; s < T; s += 1 / 30) { step(1 / 30); applyCamera(1 / 30); camera.updateMatrixWorld(); updateAim(); updateHud(1 / 30); }
    const pm = player.mech; console.log('SIM', JSON.stringify({level: LV.id, phase: mission.phase, wave: mission.wave, done: mission.done, need: mission.need, armor: Math.round(pm.armor), kind: pm.kind, state: pm.state, pos: [Math.round(pm.pos.x), Math.round(pm.pos.z)], kills: stats.kills, hijacks: stats.hijacks, mechs: mechs.map(m => m.kind[0] + ':' + m.team[0] + ':' + m.state + ':' + Math.round(m.armor)).join(' '), droids: droids.filter(d => d.state !== 'dead').length, core: coreEnt ? Math.round(coreEnt.hp) : null, ended: mission.ended, endT: $('endT').textContent})); } }
}).catch(e => { msg.textContent = 'COULD NOT LOAD: ' + e.message; console.error(e); });
