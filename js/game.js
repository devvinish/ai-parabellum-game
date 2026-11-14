// AI Parabellum, mission 1: Fallen City. Third-person mech combat with the hijack mechanic.
import {THREE, Q, BASE, settings, createView, manager, loadGLB, loadTex, loadHDR, prep, fit, warPaint, TEX, sprite, glowTexture, FX, makeRain, Fire} from './core.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {initAudio, sound, setMuted, isMuted, scoreIntensity} from './audio.js';

const $ = id => document.getElementById(id);
const {renderer, scene, camera, composer, grade, setQuality} = createView($('c'));
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

/* ---------- level geometry: hand-measured from the city model ---------- */
const BOUNDS = {x0: -46, x1: 60, z0: -130, z1: 7};
const BOXES = [ // solid building blocks: x0, x1, z0, z1, height
  {x0: -60, x1: 0.6, z0: -32, z1: 12, h: 13},
  {x0: 14.8, x1: 80, z0: -39.5, z1: 12, h: 26},
];
const CIRCLES = []; // static obstacles for mechs: {x, z, r}

function inBox(x, z, pad = 0) { for (const b of BOXES) if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) return b; return null; }
// segment a->b against the building boxes; returns the hit fraction or null
function segBoxes(a, b) {
  let best = null;
  for (const bx of BOXES) {
    let t0 = 0, t1 = 1; const d = [b.x - a.x, b.y - a.y, b.z - a.z], o = [a.x, a.y, a.z], mn = [bx.x0, -5, bx.z0], mx = [bx.x1, bx.h, bx.z1]; let ok = true;
    for (let i = 0; i < 3 && ok; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) ok = false; }
      else { let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i]; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) ok = false; }
    }
    if (ok && (best === null || t0 < best)) best = t0;
  }
  return best;
}
const losClear = (a, b) => segBoxes(a, b) === null;
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
const A = {};
let FWD = 0; const STRIDE = {walk: 5.4, run: 9, back: 3.5};
const bar = $('bar'), msg = $('msg');
manager.onProgress = (url, done, total) => { bar.style.width = (done / total * 100).toFixed(0) + '%'; };

async function loadAll() {
  msg.textContent = 'LIGHTING THE SKY';
  const hdr = await loadHDR('night'); hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr; scene.environment = hdr; scene.backgroundIntensity = 0.1; scene.environmentIntensity = 0.45;
  msg.textContent = 'RAISING THE CITY';
  const names = ['city', 'ruins', 'police_cars', 'mech_striker', 'mech_heavy', 'cyborg', 'biped', 'road_barrier', 'barrel', 'crate'];
  const g = await Promise.all(names.map(loadGLB)); names.forEach((n, i) => A[n] = g[i]);
  A.ground = await Promise.all([loadTex('asphalt_02_diff', true), loadTex('asphalt_02_nor'), loadTex('asphalt_02_rough')]);
}

/* ---------- world ---------- */
const W = {t: 0, fires: [], mixers: []};
const timers = []; const later = (sec, fn) => timers.push({at: W.t + sec, fn});
function runTimers() { for (let i = timers.length - 1; i >= 0; i--) if (W.t >= timers[i].at) { const f = timers[i].fn; timers.splice(i, 1); f(); } }
let moon, hemi, rain, headlight;
function buildWorld() {
  moon = new THREE.DirectionalLight(0x9db4e0, 1.5); moon.castShadow = true;
  moon.shadow.mapSize.set(settings.high ? 4096 : 2048, settings.high ? 4096 : 2048);
  Object.assign(moon.shadow.camera, {left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 240}); moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.04;
  scene.add(moon, moon.target);
  hemi = new THREE.HemisphereLight(0x3a4a66, 0x0b0907, 0.6); scene.add(hemi);

  const [ad, an, ar] = A.ground; for (const t of [ad, an, ar]) t.repeat.set(110, 110);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(640, 640), new THREE.MeshStandardMaterial({map: ad, normalMap: an, roughnessMap: ar, roughness: 0.42, metalness: 0.05, color: 0x8a8a8a}));
  ground.rotation.x = -Math.PI / 2; ground.position.set(7, -0.22, -60); ground.receiveShadow = true; scene.add(ground);

  const city = A.city.scene; prep(city); scene.add(city);
  const HIDE = ['wall', 'wall.001', 'wall.002', 'wall.003'];
  city.traverse(o => {
    if (!o.isMesh) return; const m = o.material, n = (m.name || '').toLowerCase();
    if (n.startsWith('route') || n.startsWith('trottoir')) { m.roughness = Math.min(m.roughness ?? 1, 0.45); m.envMapIntensity = 1.2; }
    if (n.includes('gravas') || n.includes('paves')) { m.color.multiplyScalar(0.75); m.roughness = 0.85; m.envMapIntensity = 1.6; m.side = THREE.DoubleSide; }
    if (n.includes('glass')) { m.transparent = true; m.opacity = 0.35; }
    if (n === 'monticule') { m.color.multiplyScalar(0.42); m.roughness = 0.5; }
    if (HIDE.includes(n) || /plants0052|plants0005|plants0038|metalfences0005|roadsbarriers0011/.test(n)) o.visible = false;
    if (/plants|ivy-leaves|grass/.test(n)) { m.alphaTest = 0.5; m.transparent = false; m.side = THREE.DoubleSide; m.color.multiplyScalar(0.7); }
  });

  // ruined towers close the square in on three sides
  prep(A.ruins.scene, {cast: false}); const ru = fit(A.ruins.scene, 47);
  ru.position.set(10, -1.5, -215); scene.add(ru);
  const r2 = ru.clone(); r2.position.set(-215, -1.5, -95); r2.rotation.y = 1.7; scene.add(r2);
  const r3 = ru.clone(); r3.position.set(230, -1.5, -95); r3.rotation.y = -1.4; scene.add(r3);

  // wrecks, cover and fires across the street and the square
  prep(A.police_cars.scene); const cars = fit(A.police_cars.scene, 1.9);
  const carAt = (x, z, r, fire) => { const c = cars.clone(); c.position.set(x, -0.15, z); c.rotation.y = r; scene.add(c); CIRCLES.push({x, z, r: 2.6}); if (fire) W.fires.push(new Fire(scene, V3(x - 0.2, 0.6, z + 1), fire)); };
  carAt(2.6, -27, 1.35, 1.2); carAt(-14, -50, 0.4, 0.9); carAt(25, -72, 2.1, 0); carAt(-26, -90, -0.6, 1.0); carAt(19, -100, 1.0, 0.8); carAt(40, -52, -1.1, 0);
  prep(A.road_barrier.scene); const bar1 = fit(A.road_barrier.scene, 1.0);
  const barriers = [[4.6, -4.2, 0.05], [7.4, -4.5, -0.08], [10.6, -4.0, 0.2], [1.6, -19, 1.3], [11.6, -36, -0.4],
    [-4, -54, 0.1], [-1, -54.4, 0.05], [2, -54.2, -0.1], [12, -58, 0.3], [15, -58.6, 0.2], [30, -80, 1.4], [30.3, -83, 1.5], [-18, -70, -0.9], [-20, -72, -1.0], [6, -88, 0.0], [9, -88, 0.1]];
  for (const [x, z, r] of barriers) { const b = bar1.clone(); b.position.set(x, -0.12, z); b.rotation.y = r; scene.add(b); }
  prep(A.barrel.scene); const brl = fit(A.barrel.scene, 0.95);
  for (const [x, z] of [[9.4, -3.1], [10.1, -2.5], [1.2, -22.5], [-3, -56], [13, -60], [28, -78], [-16, -68], [-15.2, -68.6]]) { const b = brl.clone(); b.position.set(x, -0.1, z); b.rotation.y = x; scene.add(b); }
  prep(A.crate.scene); const crt = fit(A.crate.scene, 0.32);
  for (const [x, z, r] of [[5.6, -3.0, 0.3], [6.2, -2.8, -0.2], [16, -57, 0.4], [-19, -73, 1.1]]) { const c = crt.clone(); c.position.set(x, -0.1, z); c.rotation.y = r; scene.add(c); }
  W.fires.push(new Fire(scene, V3(3.2, 0.5, -29.5), 0.8), new Fire(scene, V3(-30, 0.4, -110), 1.6), new Fire(scene, V3(44, 0.4, -96), 1.3));

  // the human cockpit mech left in the street, hatch open
  const heavy = A.mech_heavy; prep(heavy.scene); warPaint(heavy.scene, {keep: 0.35, dark: 1.25});
  const hv = fit(heavy.scene, 6.2); hv.position.set(2.4, -0.15, -12.5); hv.rotation.y = 0.9; scene.add(hv); CIRCLES.push({x: 2.4, z: -12.5, r: 2.6});
  const hmx = new THREE.AnimationMixer(heavy.scene); W.mixers.push(hmx);
  hmx.clipAction(heavy.animations.find(a => a.name === 'Open-Idle')).play();
  const flood = new THREE.SpotLight(0xffd2a0, 220, 30, 0.5, 0.6, 1.5); flood.position.set(9.5, 7.5, -6); flood.target.position.set(2.4, 2.5, -12.5); scene.add(flood, flood.target);
  const lamp = sprite(glowTexture('rgba(255,240,215,1)', 'rgba(255,170,90,0.45)')); lamp.position.copy(flood.position); lamp.scale.setScalar(1.1); scene.add(lamp);

  // a striker the AI lost earlier, still smoking
  const dead = SkeletonUtils.clone(A.mech_striker.scene); prep(dead); warPaint(dead, {keep: 0.3, dark: 0.35, clone: true});
  const dp = fit(dead, 7.5); dp.rotation.y = -FWD + 2.2; dp.position.set(-6, -0.15, -74); scene.add(dp);
  const dmx = new THREE.AnimationMixer(dead); dmx.clipAction(clip('b2DeathPose1')).play(); dmx.update(0.01);
  CIRCLES.push({x: -6, z: -74, r: 3}); W.fires.push(new Fire(scene, V3(-6, 1.2, -74), 1.0));

  rain = makeRain(scene, settings.high);
  headlight = new THREE.SpotLight(0xfff1dc, 260, 85, 0.36, 0.55, 1.3); headlight.castShadow = settings.high; headlight.shadow.mapSize.set(1024, 1024); headlight.shadow.bias = -0.0006;
  scene.add(headlight, headlight.target);
  W.titanLight = new THREE.SpotLight(0xff4030, 0, 90, 0.35, 0.5, 1.3); scene.add(W.titanLight, W.titanLight.target);
}
const clip = n => A.mech_striker.animations.find(a => a.name === n);

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
      if (half !== this.stepPhase) { this.stepPhase = half; const d = camera.position.distanceTo(this.pos); sound.stomp(d, this.titan ? 1.4 : 1); if (this === player.mech) fx.shake = Math.max(fx.shake, 0.12); else if (d < 30) fx.shake = Math.max(fx.shake, (this.titan ? 0.5 : 0.25) * (1 - d / 30)); }
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
    for (const e of this.eyes) e.visible = false; if (this.titan && this.team === 'enemy') W.titanLight.intensity = 0;
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

/* ---------- AI androids ---------- */
class Droid {
  constructor(kind, x, z, yaw) {
    this.id = ++uid; this.kind = kind; const tpl = kind === 'cyborg' ? A.cyTpl : A.bpTpl; this.H = kind === 'cyborg' ? 2.15 : 2.5;
    this.root = SkeletonUtils.clone(tpl); this.root.position.set(x, -0.15, z); this.root.rotation.order = 'YXZ'; this.root.rotation.y = yaw; scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.root.children[0]); const a = this.mixer.clipAction((kind === 'cyborg' ? A.cyborg : A.biped).animations[0]); a.time = Math.random() * 2; a.play();
    this.pos = this.root.position; this.yaw = yaw; this.hp = 85; this.state = 'active'; this.fireCD = rand(1.5, 3.5); this.fallT = 0; this.r = 0.6; this.wave = 0;
    droids.push(this);
  }
  get center() { return V3(this.pos.x, this.pos.y + this.H * 0.6, this.pos.z); }
  update(dt) {
    if (this.state === 'dead') { if (this.fallT < 1) { this.fallT = Math.min(1, this.fallT + dt * 2.2); this.root.rotation.x = -1.5 * this.fallT * this.fallT; } return; }
    this.mixer.update(dt);
    const P = player.mech; if (!P || P.state === 'dead' || mission.phase === 'intro') return;
    const c = this.center, tgt = P.center, d = c.distanceTo(tgt);
    if (d < 70) {
      const want = Math.atan2(tgt.x - c.x, tgt.z - c.z); this.yaw = turnTo(this.yaw, want, 2.5 * dt); this.root.rotation.y = this.yaw;
      this.fireCD -= dt;
      if (this.fireCD <= 0 && Math.abs(angDiff(this.yaw, want)) < 0.2 && losClear(c, tgt)) {
        this.fireCD = rand(1.4, 2.6);
        const from = c.clone().add(fwdOf(this.yaw).multiplyScalar(0.6)).add(V3(0, 0.2, 0));
        const aim = tgt.clone().add(V3(rand(-1.5, 1.5), rand(-1.5, 2), rand(-1.5, 1.5)));
        shoot(from, aim.sub(from).normalize(), 'enemy', 4, 120, 3); sound.bolt(camera.position.distanceTo(from));
        fx.emit(TEX.red, from, {life: 0.08, size: 0.8});
      }
    }
  }
  damage(n) {
    if (this.state === 'dead') return; this.hp -= n;
    if (this.hp <= 0) { this.state = 'dead'; fx.sparks(this.center, 24, 10); fx.emit(TEX.flash, this.center, {life: 0.12, size: 2.5, grow: 10}); sound.hit(camera.position.distanceTo(this.pos)); mission.onDroid(this); }
  }
}

/* ---------- weapons ---------- */
// ray/segment hit test against everything solid; skip = an entity to ignore
function hitTest(a, b, team, skip) {
  let best = 1.01, hit = null;
  const bx = segBoxes(a, b); if (bx !== null && bx < best) { best = bx; hit = {kind: 'wall'}; }
  if (b.y < -0.1 && a.y > -0.1) { const t = (a.y + 0.1) / (a.y - b.y); if (t < best) { best = t; hit = {kind: 'ground'}; } }
  for (const m of mechs) {
    if (m === skip || m.state === 'dead') continue; if (team === 'enemy' && m.team === 'enemy') continue; if (team === 'player' && m === player.mech) continue;
    const [d, s] = segSeg(a, b, V3(m.pos.x, m.pos.y + 0.9 * m.s, m.pos.z), V3(m.pos.x, m.pos.y + 6.7 * m.s, m.pos.z));
    if (d < m.r * 0.9 && s < best) { best = s; hit = {kind: 'mech', obj: m}; }
  }
  if (team === 'player') for (const r of droids) {
    if (r.state === 'dead') continue;
    const [d, s] = segSeg(a, b, V3(r.pos.x, r.pos.y + 0.3, r.pos.z), V3(r.pos.x, r.pos.y + r.H, r.pos.z));
    if (d < 0.7 && s < best) { best = s; hit = {kind: 'droid', obj: r}; }
  }
  if (!hit) return null; hit.t = best; hit.point = a.clone().lerp(b, best); return hit;
}
function shoot(from, dir, team, dmg, speed, len) {
  fx.tracer(from, dir, speed, len, team, (p, q) => {
    const h = hitTest(p, q, team, null); if (!h) return false;
    fx.impact(h.point, h.kind === 'mech');
    if (h.kind === 'mech') { h.obj.damage(dmg, from, false); if (team === 'player') { hitMarker(); stats.hits++; sound.hit(camera.position.distanceTo(h.point)); } }
    if (h.kind === 'droid') { h.obj.damage(dmg * 2.2); if (team === 'player') { hitMarker(); stats.hits++; } }
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
    if (h || r.life <= 0) { explode(h ? h.point : r.m.position.clone(), r.team, h && (h.kind === 'mech' || h.kind === 'droid') ? h.obj : null); scene.remove(r.m); rockets.splice(i, 1); }
  }
}
function explode(at, team, direct) {
  fx.explosion(at, 0.8); sound.explosion(camera.position.distanceTo(at), 0.8);
  fx.shake = Math.max(fx.shake, 0.7 * clamp(1 - camera.position.distanceTo(at) / 50, 0, 1));
  const R = 7, dmgDirect = team === 'player' ? 150 : 45, dmgSplash = team === 'player' ? 80 : 25;
  if (direct) { direct.damage(dmgDirect, at, true); if (team === 'player') { hitMarker(); stats.hits++; } }
  for (const m of mechs) { if (m === direct || m.state === 'dead') continue; if (team === 'player' && m === player.mech) continue; if (team === 'enemy' && m.team === 'enemy') continue;
    const d = m.center.distanceTo(at) - m.r; if (d < R) m.damage(dmgSplash * (1 - Math.max(0, d) / R), at, true); }
  if (team === 'player') for (const r of droids) { if (r === direct || r.state === 'dead') continue; const d = r.center.distanceTo(at); if (d < 4.5) r.damage(110 * (1 - d / 4.5)); }
}

/* ---------- collision ---------- */
function resolve(m) {
  const p = m.pos;
  p.x = clamp(p.x, BOUNDS.x0 + m.r, BOUNDS.x1 - m.r); p.z = clamp(p.z, BOUNDS.z0 + m.r, BOUNDS.z1 - m.r);
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
function bot() { // test autopilot: face the nearest enemy, close in, fire, hijack when possible
  const m = player.mech; let best = null, bd = 1e9;
  for (const o of [...mechs, ...droids]) { if (o === m || o.state !== 'active' || o.team === 'player' || o.team === 'neutral') continue; const d = o.pos.distanceTo(m.pos); if (d < bd) { bd = d; best = o; } }
  for (const k of ['KeyW', 'Space', 'KeyQ', 'KeyE']) keys[k] = false;
  const cand = hijackCandidate(); if (cand && (m.armor / m.maxArmor < 0.7 || cand.titan || !stats.hijacks)) { const d = cand.pos.clone().sub(m.pos); player.camYaw = Math.atan2(d.x, d.z); keys.KeyE = true; keys.KeyW = d.length() > cand.r + m.r + 3; return; }
  const down = mechs.find(o => o.state === 'down' && o.team === 'enemy'); if (down && !stats.hijacks) { const d = down.pos.clone().sub(m.pos); player.camYaw = Math.atan2(d.x, d.z); keys.KeyW = true; return; }
  if (!best) { keys.KeyW = m.pos.z > -60; player.camYaw = Math.PI; return; }
  const d = best.center.sub(camera.position); player.camYaw = turnTo(player.camYaw, Math.atan2(d.x, d.z), 0.08); player.camPitch = clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)) + 0.02, -0.42, 0.5);
  keys.KeyW = bd > 30; keys.Space = bd < 110 && !player.lock; keys.KeyQ = best instanceof Mech && bd < 80 && Math.random() < 0.3;
}
function playerControl(dt) {
  const m = player.mech; if (!m || m.state !== 'active') return;
  if (Q.has('bot')) bot();
  const k = c => keys[c] ? 1 : 0;
  if (!locked) player.camYaw += (k('ArrowLeft') - k('ArrowRight')) * 1.9 * dt;
  const f = k('KeyW') + (locked ? k('ArrowUp') : k('ArrowUp')) - k('KeyS') - k('ArrowDown'), sd = k('KeyD') - k('KeyA') + (locked ? k('ArrowRight') - k('ArrowLeft') : 0);
  const run = keys.ShiftLeft || keys.ShiftRight, cy = player.camYaw, s = m.s;
  m.aimYaw = cy; m.aimPitch = player.camPitch * 0.9 + 0.02;
  // aim the torso at whatever the crosshair is on
  if (player.aim) { const mz = m.eye; const d = player.aim.clone().sub(mz); m.aimYaw = Math.atan2(d.x, d.z); m.aimPitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); }
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
  // cannons with heat
  player.fireT -= dt;
  const firing = keys.Space || keys.KeyF || mouseFire;
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
  if ((keys.KeyQ || mouseRocket) && player.rockets > 0 && player.rocketT <= 0 && player.reloadT <= 0) {
    player.rocketT = 0.22; player.rockets--; const side = player.rockets % 2 ? 1 : -1;
    const from = m.eye.add(V3(0, 0.9 * s, 0)).add(rightOf(m.aimYaw).multiplyScalar(side * 1.3 * s));
    launchRocket(from, player.aim.clone().sub(from).normalize(), 'player', player.aimTarget && player.aimTarget.state !== 'dead' ? player.aimTarget : null); stats.shots++;
    if (player.rockets === 0) player.reloadT = 5;
  }
  if (keys.KeyR && player.rockets < 6 && player.reloadT <= 0) player.reloadT = 5 * (1 - player.rockets / 12);
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
  mission.transfer = {t: 0, from: camRig(old), old, target}; mission.phase = 'transfer';
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
function camRig(m) {
  const s = m.s, pivot = m.pos.clone().add(V3(0, (m.titan ? 8.6 : 6.4), 0)), yaw = player.camYaw, pitch = player.camPitch;
  const dir = V3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const dist = m.titan ? 18 : 13.5;
  let pos = pivot.clone().addScaledVector(dir, -dist).addScaledVector(rightOf(yaw), (m.titan ? 5.2 : 4.0)).add(V3(0, 1.0 * s, 0));
  const t = segBoxes(pivot, pos); if (t !== null) pos = pivot.clone().lerp(pos, Math.max(0.15, t - 0.06));
  pos.y = Math.max(pos.y, 1.2);
  return {pos, dir};
}
function updateAim() {
  const r = camRig(player.mech), far = camera.position.clone().addScaledVector(r.dir, 420);
  const h = hitTest(camera.position.clone().addScaledVector(r.dir, 4), far, 'player', player.mech);
  player.aim = h ? h.point : far; player.aimTarget = h && (h.kind === 'mech' || h.kind === 'droid') && h.obj.team !== 'player' ? h.obj : null;
  if (player.aim.distanceTo(player.mech.eye) < 9) player.aim = player.mech.eye.addScaledVector(r.dir, 60);
  $('xhair').classList.toggle('on', !!player.aimTarget);
}
function applyCamera(dt) {
  const ph = mission.phase;
  if (ph === 'title') { const t = W.t * 0.08, m = player.mech, c = m.pos; camera.position.set(c.x + Math.sin(t) * 19, 4.2 + Math.sin(t * 0.7) * 0.8, c.z + Math.cos(t) * 19 - 4); camera.lookAt(c.x, 4.5, c.z - 4); return; }
  if (ph === 'intro') { const k = clamp(mission.t / mission.introLen, 0, 1), e = k * k * (3 - 2 * k), m = player.mech, c = m.pos;
    const a = V3(c.x - 3.5, 1.1, c.z - 9), b = camRig(m).pos; camera.position.copy(a.lerp(b, e)); const look = V3(c.x, 5.5, c.z).lerp(camRig(m).pos.addScaledVector(camRig(m).dir, 40), e); camera.lookAt(look); return; }
  if (ph === 'transfer') { const T = mission.transfer, k = clamp(T.t / 2.4, 0, 1), e = k * k * (3 - 2 * k), to = camRig(player.mech);
    const mid = T.from.pos.clone().lerp(to.pos, e).add(V3(0, Math.sin(k * Math.PI) * 6, 0)); camera.position.copy(mid); camera.lookAt(player.mech.center.lerp(to.pos.clone().addScaledVector(to.dir, 40), e * e)); return; }
  const r = camRig(player.mech); camera.position.copy(r.pos); camera.lookAt(r.pos.clone().add(r.dir));
  if (fx.shake > 0) { const s = fx.shake * 0.35; camera.position.add(V3(rand(-s, s), rand(-s, s), rand(-s, s))); }
}

/* ---------- mission ---------- */
const STREET_DROIDS = [['cyborg', 4.2, -27.5], ['cyborg', 11.4, -28.5], ['cyborg', 3.4, -31], ['cyborg', 12.0, -32.5], ['biped', 5.2, -35], ['biped', 11.0, -37]];
const SQUARE_DROIDS = [['biped', -12, -60], ['cyborg', -8, -64], ['cyborg', 27, -58], ['biped', 32, -63], ['cyborg', 6, -86], ['cyborg', 10, -86.5]];
const mission = {
  phase: 'title', t: 0, wave: 0, introLen: 5, hijackHinted: false, ended: false, titan: null,
  start() { this.phase = 'intro'; this.t = 0; stats.start = W.t; showBanner('FALLEN CITY', '02:14 · AI CONTROLLED DISTRICT', 4); scoreIntensity(0.4); },
  wave1() {
    this.wave = 1; for (const [k, x, z] of STREET_DROIDS) { const d = new Droid(k, x, z, 0.0); d.wave = 1; }
    const s = new Mech('striker', 'enemy', 8, -78, 0); s.wave = 1; s.mode = 'close';
    this.need = 7; this.done = 0; setObjective('Clear the street', 'Androids and one AI striker hold the road');
    showHint('Aim with the mouse, fire the arm cannons with left click. Rockets on right click or Q.', 6);
  },
  wave2() {
    this.wave = 2; showBanner('WAVE 2', 'STRIKER SQUAD INBOUND', 3.5, true); sound.alarm(); scoreIntensity(0.7);
    for (const [k, x, z] of SQUARE_DROIDS) { const d = new Droid(k, x, z, 0.0); d.wave = 2; }
    [[-14, -116], [10, -122], [32, -114]].forEach(([x, z], i) => later(i * 9, () => { const s = new Mech('striker', 'enemy', x, z, 0); s.wave = 2; }));
    this.need = 9; this.done = 0; setObjective('Break the striker squad', 'Push into the square');
  },
  wave3() {
    this.wave = 3; showBanner('TITAN INBOUND', 'BRING IT DOWN', 4, true); sound.alarm(); later(1.2, () => sound.alarm()); scoreIntensity(1);
    this.titan = new Mech('titan', 'enemy', 10, -124, 0); this.titan.wave = 3;
    [[-24, -118], [38, -112]].forEach(([x, z], i) => later(8 + i * 12, () => { const s = new Mech('striker', 'enemy', x, z, 0); s.wave = 3; }));
    const tl = W.titanLight, tt = tl.target; tl.position.set(0, 9.6, 1.5); tt.position.set(0, 0, 25); this.titan.root.add(tl, tt); tl.intensity = 300;
    setObjective('Bring down the Titan', 'Overheat its core, then take it or finish it');
  },
  progress() { $('objSub').textContent = this.wave === 3 ? $('objSub').textContent : `${Math.min(this.done, this.need)} / ${this.need} neutralised`; if (this.wave < 3 && this.done >= this.need) { this.wave === 1 ? later(2.5, () => this.wave2()) : later(3, () => this.wave3()); this.need = 1e9; } },
  onDroid(d) { stats.kills++; if (d.wave === this.wave) { this.done++; this.progress(); } },
  onDown(m) {
    if (m.team === 'enemy') { if (m.wave === this.wave && !m.counted) { m.counted = true; this.done++; this.progress(); }
      if (!this.hijackHinted) { this.hijackHinted = true; showHint('Its core overheated. Walk up to it and HOLD E to take it over. Its armor comes back patched.', 9); }
      if (m === this.titan) { setObjective('Hijack the Titan', 'Hold E beside it, or destroy it'); showBanner('TITAN DOWN', 'TAKE IT', 3); } }
  },
  onDestroyed(m) {
    if (m.team === 'enemy' || m.team === 'neutral') { if (m.team === 'enemy') stats.kills++; if (m.wave === this.wave && !m.counted) { m.counted = true; this.done++; this.progress(); } }
    if (m === this.titan && !this.ended) { this.ended = true; showBanner('TITAN DESTROYED', 'THE DISTRICT IS OURS', 4); later(4.2, () => endGame(true, 'You destroyed the Titan. The AI lost Fallen City.')); }
  },
  onHijack(m) {
    showBanner('HIJACK COMPLETE', m.titan ? 'TITAN UNDER YOUR CONTROL' : 'NEW MACHINE ONLINE', 3);
    if (m === this.titan && !this.ended) { this.ended = true; later(5.2, () => endGame(true, 'You turned their Titan against them. Fallen City is yours.')); }
  },
  update(dt) {
    this.t += dt;
    if (this.phase === 'intro' && this.t > this.introLen) { this.phase = 'fight'; this.t = 0; this.wave1(); }
    if (this.phase === 'transfer') { const T = this.transfer; T.t += dt; grade.uniforms.uGlitch.value = Math.max(0, 1 - T.t / 1.2) + (T.t > 1.9 && T.t < 2.1 ? 0.6 : 0);
      if (T.t > 1.35 && player.mech.state === 'boot') { player.mech.state = 'active'; player.mech.act.boot.fadeOut(0.4); player.mech.setGait('idle', 0.4); }
      if (T.t > 2.4) { this.phase = 'fight'; grade.uniforms.uGlitch.value = 0; } }
  },
};
function playerDestroyed() {
  const m = player.mech; m.state = 'dead'; m.act.death.reset().fadeIn(0.2).play(); for (const k of ['walk', 'run', 'back', 'idle']) m.act[k].fadeOut(0.2);
  fx.explosion(m.center, 1.6); sound.explosion(0, 1.5); fx.shake = 1.5; for (const e of m.eyes) e.visible = false; m.u.uDark.value *= 0.45;
  if (!mission.ended) { mission.ended = true; later(3.2, () => endGame(false, 'Your machine was destroyed. Next time, take one of theirs before your armor runs out.')); }
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
function updateHud(dt) {
  const m = player.mech; if (!m) return;
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
  rc.strokeStyle = 'rgba(233,237,240,0.25)'; for (const b of BOXES) { rc.beginPath(); [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]].forEach(([x, z], i) => { const [px, py] = pt(x, z); i ? rc.lineTo(px, py) : rc.moveTo(px, py); }); rc.closePath(); rc.stroke(); }
  for (const d of droids) if (d.state !== 'dead') { const [x, y] = pt(d.pos.x, d.pos.z); if (Math.hypot(x - c, y - c) < R) { rc.fillStyle = '#ff6a5a'; rc.fillRect(x - 3, y - 3, 6, 6); } }
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
  keys[e.code] = true;
  if (mission.phase === 'intro' && mission.t > 0.8 && !['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) mission.t = mission.introLen;
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Escape' && playing()) setPause(true); if (e.code === 'KeyP' && playing()) setPause(!paused);
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseFire = mouseRocket = false; });
canvas.addEventListener('mousedown', e => {
  if (!playing() || paused) return;
  if (!locked) lockPointer();
  if (e.button === 0) mouseFire = true; if (e.button === 2) mouseRocket = true;
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
$('bPlay').onclick = () => deploy();
function deploy() {
  initAudio(); sound.ui(); $('title').classList.add('hidden'); $('hud').classList.remove('hidden'); lockPointer();
  mission.start();
}
function endGame(win, text) {
  stats.time = W.t - stats.start; if (document.pointerLockElement) document.exitPointerLock();
  $('endT').textContent = win ? 'MISSION COMPLETE' : 'MISSION FAILED'; $('endT').className = win ? 'win' : 'lose'; $('endP').textContent = text;
  const mm = Math.floor(stats.time / 60), ss = String(Math.floor(stats.time % 60)).padStart(2, '0');
  $('endS').innerHTML = `<span>Time</span><b>${mm}:${ss}</b><span>Enemies neutralised</span><b>${stats.kills}</b><span>Machines hijacked</span><b>${stats.hijacks}</b><span>Accuracy</span><b>${stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0}%</b>`;
  $('end').classList.remove('hidden'); $('hud').classList.add('hidden'); scoreIntensity(0.2);
}
if (matchMedia('(pointer: coarse)').matches) $('touchNote').hidden = false;

/* ---------- loop ---------- */
let nextFlash = 6, flashT = -1;
function lightning(dt) {
  nextFlash -= dt; if (nextFlash < 0) { flashT = 0; nextFlash = 10 + Math.random() * 9; setTimeout(() => sound.thunder(), 600 + Math.random() * 900); }
  let k = 0; if (flashT >= 0) { flashT += dt; k = flashT < 0.08 ? 1 : flashT < 0.16 ? 0.15 : flashT < 0.26 ? 0.8 : Math.max(0, 1 - (flashT - 0.26) * 3); if (flashT > 0.7) flashT = -1; }
  moon.intensity = 1.5 + k * 5; hemi.intensity = 0.6 + k * 1.6; scene.backgroundIntensity = 0.1 + k * 0.9;
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
  lightning(dt);
}
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  step(dt);
  applyCamera(dt); camera.updateMatrixWorld();
  if (player.mech && mission.phase !== 'title') updateAim();
  // moonlight shadows and the headlight follow the action
  const pm = player.mech; if (pm) { moon.target.position.set(pm.pos.x, 0, pm.pos.z - 18); moon.position.set(pm.pos.x - 35, 70, pm.pos.z + 7);
    const hp = pm.eye.add(fwdOf(pm.aimYaw).multiplyScalar(1.4 * pm.s)); headlight.position.copy(hp); headlight.target.position.copy(player.aim && mission.phase === 'fight' ? player.aim : hp.clone().add(fwdOf(pm.heading).multiplyScalar(30)).setY(0)); headlight.intensity = pm.state === 'active' || pm.state === 'boot' ? 260 : 0; }
  rain(dt, camera);
  if (mission.phase !== 'title') updateHud(dt);
  grade.uniforms.uTime.value = W.t;
  composer.render();
}

/* ---------- boot ---------- */
loadAll().then(() => {
  const w = measure('a5WalkCycleRootMotion'); if (w) { FWD = w.fwd; STRIDE.walk = w.speed; }
  const r = measure('a7RunCycleRootMotion'); if (r) STRIDE.run = r.speed;
  const b = measure('a6WalkCycleBackRootMotion'); if (b) STRIDE.back = b.speed;
  prep(A.cyborg.scene); A.cyTpl = fit(A.cyborg.scene, 2.15); prep(A.biped.scene); A.bpTpl = fit(A.biped.scene, 2.5);
  buildWorld();
  player.mech = new Mech('striker', 'player', 7.5, 3, Math.PI); player.camYaw = Math.PI;
  $('load').classList.add('done'); $('title').classList.remove('hidden');
  renderer.setAnimationLoop(frame);
  window.__lt = {ready: true, scene, camera, THREE};
  window.__g = {mission, player, mechs, droids, stats, keys, deploy, step, fx};
  if (Q.has('play')) { deploy(); if (Q.has('t')) { const T = +Q.get('t'); for (let s = 0; s < T; s += 1 / 30) { step(1 / 30); applyCamera(1 / 30); camera.updateMatrixWorld(); updateAim(); updateHud(1 / 30); }
    const pm = player.mech; console.log('SIM', JSON.stringify({phase: mission.phase, wave: mission.wave, done: mission.done, need: mission.need, armor: Math.round(pm.armor), kind: pm.kind, state: pm.state, kills: stats.kills, hijacks: stats.hijacks, mechs: mechs.map(m => m.kind[0] + ':' + m.team[0] + ':' + m.state + ':' + Math.round(m.armor)).join(' '), droids: droids.filter(d => d.state !== 'dead').length, ended: mission.ended})); } }
}).catch(e => { msg.textContent = 'COULD NOT LOAD: ' + e.message; console.error(e); });
