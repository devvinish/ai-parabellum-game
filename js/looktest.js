// AI Parabellum look test: Fallen City at night. One scene, cinematic camera, no gameplay yet.
// Assets load from window.AIP_ASSETS (the GitHub Pages copy when embedded elsewhere) or ./assets/.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const Q = new URLSearchParams(location.search);
const BASE = window.AIP_ASSETS || 'assets/';
const DEBUG = Q.has('debug');
let HIGH = Q.get('q') !== 'low';
const FIXED = Q.has('cam') ? Q.get('cam').split(',').map(Number) : null; // debug: fixed camera x,y,z,tx,ty,tz

/* ---------- renderer, scene, camera ---------- */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({canvas, antialias: false, powerPreference: 'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, HIGH ? 1.75 : 1));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const FOG = new THREE.Color(0x0d131c);
scene.fog = new THREE.FogExp2(FOG, 0.0095);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 900);
camera.position.set(8, 1.6, 12);

/* ---------- loading ---------- */
const manager = new THREE.LoadingManager();
const bar = document.getElementById('bar'), msg = document.getElementById('msg');
manager.onProgress = (url, done, total) => { bar.style.width = (done / total * 100).toFixed(0) + '%'; };
const gltfLoader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader(manager);
const loadGLB = name => gltfLoader.loadAsync(BASE + 'models/' + name + '.glb');
const loadTex = (name, srgb) => texLoader.loadAsync(BASE + 'tex/' + name + '.webp').then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; });

function prep(root, {cast = true, receive = true} = {}) {
  root.traverse(o => {
    if (o.isMesh) {
      o.castShadow = cast; o.receiveShadow = receive;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) { if (m.map) m.map.anisotropy = 8; if (m.transparent && m.alphaTest === 0 && m.map) { m.alphaTest = 0.4; m.transparent = false; } }
    }
  });
  return root;
}
// scale a model so its height is h metres and its feet sit at y=0, centred on x/z
function fit(root, h, {center = true} = {}) {
  root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(root, true), size = b.getSize(new THREE.Vector3());
  const s = h / size.y; root.scale.multiplyScalar(s); root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root, true), c = b2.getCenter(new THREE.Vector3());
  const pivot = new THREE.Group(); pivot.add(root);
  root.position.y -= b2.min.y; if (center) { root.position.x -= c.x; root.position.z -= c.z; }
  if (DEBUG) console.log('fit', root.name, 'native', size.toArray().map(v => v.toFixed(2)).join(' x '), 'scale', s.toFixed(4));
  return pivot;
}

/* ---------- world ---------- */
const W = {mixers: [], fires: [], t: 0};
async function build() {
  // sky and image-based light
  msg.textContent = 'LIGHTING THE SKY';
  const hdr = await new RGBELoader(manager).loadAsync(BASE + 'sky/night.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr; scene.environment = hdr;
  scene.backgroundIntensity = 0.1; scene.environmentIntensity = 0.45; const ROT = Number(Q.get('rot') ?? 0); scene.backgroundRotation.y = ROT; scene.environmentRotation.y = ROT;

  // moonlight with shadows across the street
  const moon = new THREE.DirectionalLight(0x9db4e0, 1.5);
  moon.position.set(-35, 70, 25); moon.target.position.set(7, 0, -25);
  moon.castShadow = true; moon.shadow.mapSize.set(HIGH ? 4096 : 2048, HIGH ? 4096 : 2048);
  Object.assign(moon.shadow.camera, {left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 220});
  moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.04;
  scene.add(moon, moon.target); W.moon = moon;
  const hemi = new THREE.HemisphereLight(0x3a4a66, 0x0b0907, 0.55); scene.add(hemi); W.hemi = hemi;

  // wet asphalt beyond the city block
  const [ad, an, ar] = await Promise.all([loadTex('asphalt_02_diff', true), loadTex('asphalt_02_nor'), loadTex('asphalt_02_rough')]);
  for (const t of [ad, an, ar]) t.repeat.set(90, 90);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), new THREE.MeshStandardMaterial({map: ad, normalMap: an, roughnessMap: ar, roughness: 0.42, metalness: 0.05, color: 0x8a8a8a}));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.22; ground.receiveShadow = true; scene.add(ground);

  msg.textContent = 'RAISING THE CITY';
  const [city, ruins, cars, striker, heavy, cyborg, biped, barrier, barrel, crate] = await Promise.all(
    ['city', 'ruins', 'police_cars', 'mech_striker', 'mech_heavy', 'cyborg', 'biped', 'road_barrier', 'barrel', 'crate'].map(loadGLB));

  // the street block (already in metres)
  prep(city.scene); scene.add(city.scene); W.city = city.scene;
  city.scene.traverse(o => {
    if (!o.isMesh) return; const m = o.material, n = (m.name || '').toLowerCase();
    if (n.startsWith('route') || n.startsWith('trottoir')) { m.roughness = Math.min(m.roughness ?? 1, 0.45); m.envMapIntensity = 1.2; }
    if (n.includes('gravas') || n.includes('paves')) { m.color.multiplyScalar(0.75); m.roughness = 0.85; m.envMapIntensity = 1.6; m.side = THREE.DoubleSide; }
    if (n.includes('glass')) { m.transparent = true; m.opacity = 0.35; }
    // open the far end of the street: drop the backdrop walls so the ruined skyline shows through
    if (HIDE.some(h => n === h)) o.visible = false;
    if (/plants0052|plants0005|plants0038|metalfences0005|roadsbarriers0011/.test(n)) o.visible = false;
    if (/plants|ivy-leaves|grass/.test(n)) { m.alphaTest = 0.5; m.transparent = false; m.depthWrite = true; m.side = THREE.DoubleSide; m.color.multiplyScalar(0.7); }
  });

  // destroyed towers as the skyline beyond the street
  // native metres: five ruined towers spread over ~300 m, kept far beyond the street
  prep(ruins.scene, {cast: false}); const sky = fit(ruins.scene, 47);
  sky.position.set(10, -1.5, -250); scene.add(sky);
  const sky2 = sky.clone(); sky2.position.set(-230, -1.5, -40); sky2.rotation.y = 1.7; scene.add(sky2);
  const sky3 = sky.clone(); sky3.position.set(250, -1.5, -60); sky3.rotation.y = -1.4; scene.add(sky3);
  if (Q.has('noruins')) sky.visible = sky2.visible = sky3.visible = false;

  // burned police cars with fires
  prep(cars.scene); const carPile = fit(cars.scene, 1.9); carPile.position.set(2.6, -0.15, -27); carPile.rotation.y = 1.35; scene.add(carPile);
  addFire(new THREE.Vector3(2.4, 0.6, -26), 1.2); addFire(new THREE.Vector3(3.2, 0.5, -29.5), 0.8);

  // foreground cover: scanned concrete barriers, barrels and ammo crates
  prep(barrier.scene); const bar1 = fit(barrier.scene, 1.0);
  [[4.6, -4.2, 0.05], [7.4, -4.5, -0.08], [10.6, -4.0, 0.2], [1.6, -19, 1.3], [11.6, -36, -0.4]].forEach(([x, z, r]) => { const b = bar1.clone(); b.position.set(x, -0.12, z); b.rotation.y = r; scene.add(b); });
  prep(barrel.scene); const brl = fit(barrel.scene, 0.95);
  [[9.4, -3.1], [10.1, -2.5], [1.2, -22.5]].forEach(([x, z]) => { const b = brl.clone(); b.position.set(x, -0.1, z); b.rotation.y = x; scene.add(b); });
  prep(crate.scene); const crt = fit(crate.scene, 0.32);
  [[5.6, -3.0, 0.3], [6.2, -2.8, -0.2]].forEach(([x, z, r]) => { const c = crt.clone(); c.position.set(x, -0.1, z); c.rotation.y = r; scene.add(c); });

  // the 7.5 m walker coming down the street
  prep(striker.scene); warPaint(striker.scene, 0.4, 0.7); const mech = fit(striker.scene, 7.5); scene.add(mech); W.mech = mech;
  const mx = new THREE.AnimationMixer(striker.scene); W.mixers.push(mx);
  const clip = n => striker.animations.find(a => a.name === n);
  if (DEBUG) console.log('striker clips', striker.animations.map(a => a.name).join(' '));
  W.mechWalk = mx.clipAction(clip('a5WalkCycle')); W.mechIdle = mx.clipAction(clip('a4IdlePose'));
  W.mechSpeed = measureStride(striker, 'a5WalkCycleRootMotion', mech) || 2.6;
  W.mechWalk.timeScale = 0.62; W.mechSpeed *= 0.62; W.mechWalk.play();
  addSearchlight(mech);

  // the parked cockpit mech: hatch open, the hijack target
  prep(heavy.scene); warPaint(heavy.scene, 0.35, 1.25); const hv = fit(heavy.scene, 6.2); hv.position.set(2.4, -0.15, -12.5); hv.rotation.y = Number(Q.get('hvr') ?? 0.9); scene.add(hv); W.heavy = hv;
  const hmx = new THREE.AnimationMixer(heavy.scene); W.mixers.push(hmx);
  if (DEBUG) console.log('heavy clips', heavy.animations.map(a => a.name).join(' '));
  const open = hmx.clipAction(heavy.animations.find(a => a.name === 'Open')); open.setLoop(THREE.LoopOnce); open.clampWhenFinished = true;
  const openIdle = hmx.clipAction(heavy.animations.find(a => a.name === 'Open-Idle'));
  open.play(); hmx.addEventListener('finished', () => openIdle.play());
  const flood = new THREE.SpotLight(0xffd2a0, 260, 30, 0.5, 0.6, 1.5); flood.position.set(9.5, 7.5, -6); flood.target.position.set(2.4, 2.5, -12.5);
  flood.castShadow = HIGH; flood.shadow.mapSize.set(1024, 1024); scene.add(flood, flood.target);
  const lamp = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTexture('rgba(255,240,215,1)', 'rgba(255,170,90,0.45)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
  lamp.position.copy(flood.position); lamp.scale.setScalar(1.1); scene.add(lamp);

  // AI troopers escorting the walker
  prep(cyborg.scene); const cy = fit(cyborg.scene, 2.15);
  if (DEBUG) console.log('cyborg clips', cyborg.animations.map(a => a.name).join(' '));
  [[4.2, -27.5, 0.25], [11.4, -28.5, -0.3], [3.4, -31, 0.15], [12.0, -32.5, -0.2]].forEach(([x, z, r], i) => {
    const t = SkeletonUtils.clone(cy); t.position.set(x, -0.15, z); t.rotation.y = r; scene.add(t);
    const m = new THREE.AnimationMixer(t); const a = m.clipAction(cyborg.animations[0]); a.time = i * 0.7; a.play(); W.mixers.push(m);
  });
  prep(biped.scene); const bp = fit(biped.scene, 2.5);
  if (DEBUG) console.log('biped clips', biped.animations.map(a => a.name).join(' '));
  [[5.2, -35, 0.2], [11.0, -37, -0.25]].forEach(([x, z, r], i) => {
    const t = SkeletonUtils.clone(bp); t.position.set(x, -0.15, z); t.rotation.y = r; scene.add(t);
    const m = new THREE.AnimationMixer(t); const a = m.clipAction(biped.animations[0]); a.time = i * 1.1; a.play(); W.mixers.push(m);
  });

  addRain(); addEmbers();
  if (Q.has('grid')) { for (let x = -30; x <= 50; x += 10) for (let z = -70; z <= 30; z += 10) { const m = new THREE.Mesh(new THREE.SphereGeometry(x === 0 && z === 0 ? 1.6 : 0.8), new THREE.MeshBasicMaterial({color: x === 0 ? 0xff2020 : z === 0 ? 0x20ff20 : 0xffff00, fog: false})); m.position.set(x, 30, z); scene.add(m); } }
  if (Q.has('lit')) { scene.fog = null; scene.add(new THREE.AmbientLight(0xffffff, 2.5)); W.moon.intensity = 3; }
  resetMarch();
}

// how far the root moves over one cycle of a root-motion clip, in world metres per second
function measureStride(gltf, clipName, pivot) {
  const c = gltf.animations.find(a => a.name === clipName); if (!c) return 0;
  const m = new THREE.AnimationMixer(gltf.scene), a = m.clipAction(c); a.play();
  let best = null, bestD = 0;
  for (const tr of c.tracks) if (tr.name.endsWith('.position')) {
    const v = tr.values, n = v.length / 3, d = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2], v[(n - 1) * 3 + 1] - v[1]);
    if (d > bestD) { bestD = d; best = tr.name.split('.')[0]; }
  }
  if (!best) return 0;
  const bone = gltf.scene.getObjectByName(best); if (!bone) return 0;
  pivot.updateMatrixWorld(true);
  m.setTime(0); pivot.updateMatrixWorld(true); const p0 = bone.getWorldPosition(new THREE.Vector3());
  m.setTime(c.duration - 0.001); pivot.updateMatrixWorld(true); const p1 = bone.getWorldPosition(new THREE.Vector3());
  a.stop(); m.uncacheRoot(gltf.scene);
  const d = p1.sub(p0); W.mechForward = Math.atan2(d.x, d.z);
  const sp = Math.hypot(d.x, d.z) / c.duration;
  if (DEBUG) console.log('stride bone', best, 'speed m/s', sp.toFixed(2), 'forward', W.mechForward.toFixed(2));
  return sp;
}

/* ---------- effects ---------- */
// desaturate and darken a model's paint toward worn gunmetal, and give it a wet metallic sheen
function warPaint(root, keep, dark) {
  root.traverse(o => { if (!o.isMesh) return; for (const m of [].concat(o.material)) {
    m.metalness = Math.max(m.metalness ?? 0, 0.55); m.roughness = Math.min(m.roughness ?? 1, 0.55); m.envMapIntensity = 1.3;
    m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(vec3(lum) * vec3(0.92, 0.96, 1.0), diffuseColor.rgb, ${keep.toFixed(2)}) * ${dark.toFixed(2)};`); };
    m.needsUpdate = true; } });
}

function glowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, inner); r.addColorStop(0.35, outer); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const FIRE_TEX = glowTexture('rgba(255,236,190,1)', 'rgba(255,120,30,0.55)');
const SMOKE_TEX = glowTexture('rgba(40,40,44,0.55)', 'rgba(30,30,34,0.25)');
function addFire(pos, size) {
  const light = new THREE.PointLight(0xff7a2a, 26 * size, 16, 1.6); light.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0)); scene.add(light);
  const flames = [], smoke = [];
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map: FIRE_TEX, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true}));
    s.userData = {life: Math.random(), sp: 0.8 + Math.random() * 0.8, ox: (Math.random() - 0.5) * size, oz: (Math.random() - 0.5) * size};
    scene.add(s); flames.push(s);
  }
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map: SMOKE_TEX, depthWrite: false, transparent: true, fog: true}));
    s.userData = {life: Math.random(), sp: 0.3 + Math.random() * 0.3, ox: (Math.random() - 0.5) * size, oz: (Math.random() - 0.5) * size};
    scene.add(s); smoke.push(s);
  }
  W.fires.push({pos, size, light, flames, smoke});
}
function updateFires(dt, t) {
  for (const f of W.fires) {
    f.light.intensity = 26 * f.size * (0.75 + 0.25 * Math.sin(t * 17 + f.size * 9) * Math.sin(t * 7.3));
    for (const s of f.flames) { const u = s.userData; u.life += dt * u.sp; if (u.life > 1) { u.life = 0; u.ox = (Math.random() - 0.5) * f.size; u.oz = (Math.random() - 0.5) * f.size; }
      const k = u.life; s.position.set(f.pos.x + u.ox * (1 - k * 0.6), f.pos.y + k * 2.2 * f.size, f.pos.z + u.oz * (1 - k * 0.6));
      const sc = (1.3 - k) * 1.1 * f.size; s.scale.set(sc, sc * 1.4, 1); s.material.opacity = Math.sin(k * Math.PI) * 0.95; }
    for (const s of f.smoke) { const u = s.userData; u.life += dt * u.sp * 0.5; if (u.life > 1) u.life = 0;
      const k = u.life; s.position.set(f.pos.x + u.ox + k * 2.5, f.pos.y + 1.6 * f.size + k * 9, f.pos.z + u.oz + k * 0.8);
      const sc = (1 + k * 5) * f.size; s.scale.set(sc, sc, 1); s.material.opacity = Math.sin(k * Math.PI) * 0.55; }
  }
}
function addSearchlight(mech) {
  const spot = new THREE.SpotLight(0xdfe9ff, 420, 70, 0.32, 0.45, 1.4);
  spot.position.set(0, 6.3, 1.2); spot.castShadow = HIGH; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0006;
  const tgt = new THREE.Object3D(); tgt.position.set(0, 0, 18); mech.add(spot, tgt); spot.target = tgt; W.spotTarget = tgt;
  // visible beam: an additive cone fading along its length
  const geo = new THREE.ConeGeometry(7.5, 26, 40, 1, true); geo.translate(0, -13, 0); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {uFade: {value: 1}},
    vertexShader: 'varying float vL; varying vec3 vN; varying vec3 vV; void main(){ vL = position.z/26.0; vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform float uFade; varying float vL; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN,vV)),1.6); float a = (1.0-vL)*(1.0-vL)*edge*0.16*uFade; gl_FragColor = vec4(vec3(0.75,0.82,1.0)*a, a); }'});
  const beam = new THREE.Mesh(geo, mat); beam.position.copy(spot.position); mech.add(beam); W.beam = beam;
  const lens = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTexture('rgba(255,255,255,1)', 'rgba(170,200,255,0.5)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
  lens.position.copy(spot.position).add(new THREE.Vector3(0, 0, 0.3)); lens.scale.setScalar(0.9); mech.add(lens);
  // two red sensor eyes
  for (const x of [-0.45, 0.45]) { const e = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTexture('rgba(255,210,200,1)', 'rgba(255,40,30,0.7)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true})); e.position.set(x, 6.9, 1.0); e.scale.setScalar(0.55); mech.add(e); }
}
function addRain() {
  const N = HIGH ? 9000 : 4000, pos = new Float32Array(N * 6), R = 34;
  for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * R * 2, y = Math.random() * 30, z = (Math.random() - 0.5) * R * 2; pos.set([x, y, z, x + 0.06, y - 0.75, z + 0.02], i * 6); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({color: 0x9fb4cc, transparent: true, opacity: 0.32, depthWrite: false, fog: true}));
  rain.frustumCulled = false; scene.add(rain); W.rain = {mesh: rain, N, R};
}
function updateRain(dt) {
  const {mesh, N, R} = W.rain, p = mesh.geometry.attributes.position.array, cx = camera.position.x, cz = camera.position.z, v = 26 * dt;
  for (let i = 0; i < N; i++) { const o = i * 6; p[o + 1] -= v; p[o + 4] -= v; p[o] += v * 0.08; p[o + 3] += v * 0.08;
    if (p[o + 1] < -0.3) { const x = cx + (Math.random() - 0.5) * R * 2, z = cz + (Math.random() - 0.5) * R * 2, y = 24 + Math.random() * 8; p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = x + 0.06; p[o + 4] = y - 0.75; p[o + 5] = z + 0.02; } }
  mesh.geometry.attributes.position.needsUpdate = true;
}
function addEmbers() {
  const N = 260, g = new THREE.BufferGeometry(), p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) p.set([1 + Math.random() * 5, Math.random() * 12, -30 + Math.random() * 6], i * 3);
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({color: 0xffa050, size: 0.07, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false});
  const pts = new THREE.Points(g, m); scene.add(pts); W.embers = pts;
}
function updateEmbers(dt) {
  const p = W.embers.geometry.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) { p[i + 1] += dt * (0.8 + (i % 7) * 0.15); p[i] += dt * 0.6; if (p[i + 1] > 13) { p[i] = 1.5 + Math.random() * 3; p[i + 1] = 0.5; p[i + 2] = -30 + Math.random() * 5; } }
  W.embers.geometry.attributes.position.needsUpdate = true;
}
// lightning: a double flash every 9 to 16 seconds
let nextFlash = 5, flashT = -1;
function updateLightning(dt) {
  nextFlash -= dt; if (nextFlash < 0) { flashT = 0; nextFlash = 9 + Math.random() * 7; }
  let k = 0; if (flashT >= 0) { flashT += dt; k = flashT < 0.08 ? 1 : flashT < 0.16 ? 0.15 : flashT < 0.26 ? 0.8 : Math.max(0, 1 - (flashT - 0.26) * 3); if (flashT > 0.7) flashT = -1; }
  if (Q.has('lit')) return; W.moon.intensity = 1.5 + k * 5; W.hemi.intensity = 0.55 + k * 1.6; scene.backgroundIntensity = 0.1 + k * 0.9;
}

/* ---------- the march ---------- */
const HIDE = (Q.get('hide') ?? 'wall,wall.001,wall.002,wall.003').split(',');
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const STREET_X = 8.4, START_Z = -92, STOP_Z = -21;
function resetMarch() { W.mechZ = START_Z; W.mechState = 'walk'; W.mechWalk.reset().play(); W.mechIdle.stop(); W.marchT = 0; }
function updateMarch(dt) {
  if (W.mechState === 'walk') { W.mechZ += W.mechSpeed * dt; if (W.mechZ >= STOP_Z) { W.mechState = 'idle'; W.mechIdle.reset().play(); W.mechWalk.crossFadeTo(W.mechIdle, 0.6, false); } }
  W.marchT += dt; if (W.marchT > CYCLE) resetMarch();
  W.mech.position.set(STREET_X, -0.15, W.mechZ);
  W.mech.rotation.y = -(W.mechForward || 0);
  const sweep = Math.sin(W.t * 0.45) * 7; W.spotTarget.position.set(sweep, 0, 18);
  // hide the beam's cone when the camera looks straight down it; the lens flare carries that view
  const ax = W.spotTarget.getWorldPosition(_v1).sub(W.beam.getWorldPosition(_v2)).normalize(), cv = camera.getWorldDirection(_v3);
  W.beam.material.uniforms.uFade.value = THREE.MathUtils.smoothstep(-ax.dot(cv), 0.92, 0.55);
  W.beam.lookAt(W.spotTarget.getWorldPosition(_v1));
}

/* ---------- camera: cinematic shots or free orbit ---------- */
const CYCLE = 34;
const SHOTS = [ // camera glides from a to b while looking at a moving target
  {d: 9, cap: 'FALLEN CITY', a: [6.4, 1.15, -1.2], b: [5.6, 1.35, -3.6], look: () => [STREET_X, 4.4, W.mechZ]},
  {d: 8, cap: '', a: [5.2, 0.42, -19.5], b: [5.6, 0.5, -17], look: () => [STREET_X, 6.4, W.mechZ]},
  {d: 9, cap: 'HOLD THE LINE', a: [4.6, 1.5, -3.2], b: [5.6, 1.55, -5.0], look: () => [STREET_X - 0.5, 4.6, W.mechZ]},
  {d: 8, cap: 'TAKE THEIR MACHINES', a: [9.6, 2.2, -3.2], b: [8.4, 1.9, -5.6], look: () => [2.4, 3.4, -12.5]},
];
let freeCam = false, controls = null;
const capEl = document.getElementById('cap');
function cineCamera() {
  let t = W.marchT % CYCLE, i = 0; while (i < SHOTS.length - 1 && t > SHOTS[i].d) { t -= SHOTS[i].d; i++; }
  const s = SHOTS[i], k = Math.min(1, t / s.d), e = k * k * (3 - 2 * k);
  camera.position.set(...s.a.map((v, j) => v + (s.b[j] - v) * e));
  const L = s.look(); camera.lookAt(L[0], L[1], L[2]);
  const want = s.cap && t < s.d - 1.5 ? s.cap : ''; if (capEl.dataset.c !== want) { capEl.dataset.c = want; capEl.style.opacity = want ? 1 : 0; if (want) capEl.textContent = want; }
}

/* ---------- post-processing ---------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.5, 0.9); composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({uniforms: {tDiffuse: {value: null}, uTime: {value: 0}, uAspect: {value: innerWidth / innerHeight}},
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uAspect; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){ vec2 d = vUv-0.5; float r = length(d*vec2(uAspect,1.0));
      vec3 c = vec3(texture2D(tDiffuse, vUv - d*0.0025).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + d*0.0025).b);
      float l = dot(c, vec3(0.299,0.587,0.114));
      c = mix(c, c*vec3(0.86,0.97,1.12), smoothstep(0.35,0.0,l)*0.6); c = mix(c, c*vec3(1.08,1.0,0.9), smoothstep(0.4,0.9,l)*0.4);
      c = (c-0.5)*1.07+0.5; c *= smoothstep(1.05, 0.32, r);
      c += (h(vUv*vec2(1920.0,1080.0)+uTime*61.0)-0.5)*0.035; gl_FragColor = vec4(c,1.0); }`});
composer.addPass(grade);

/* ---------- loop ---------- */
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); W.t += dt;
  for (const m of W.mixers) m.update(dt);
  updateMarch(dt); updateFires(dt, W.t); updateRain(dt); updateEmbers(dt); updateLightning(dt);
  if (FIXED) { camera.position.set(FIXED[0], FIXED[1], FIXED[2]); camera.lookAt(FIXED[3], FIXED[4], FIXED[5]); } else if (freeCam) controls.update(); else cineCamera();
  grade.uniforms.uTime.value = W.t;
  composer.render();
}
function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); grade.uniforms.uAspect.value = camera.aspect; }
addEventListener('resize', resize);

/* ---------- buttons ---------- */
const $ = id => document.getElementById(id);
function setFree(v) {
  freeCam = v; $('bFree').classList.toggle('on', v); $('bCine').classList.toggle('on', !v); document.body.classList.toggle('free', v);
  capEl.style.opacity = 0; capEl.dataset.c = '';
  if (v && !controls) { controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 2; controls.maxDistance = 90; }
  if (controls) { controls.enabled = v; if (v) { controls.target.set(STREET_X, 3, W.mechZ); controls.update(); } }
}
$('bCine').onclick = () => setFree(false); $('bFree').onclick = () => setFree(true);
$('bQual').onclick = () => { HIGH = !HIGH; $('bQual').textContent = 'QUALITY: ' + (HIGH ? 'HIGH' : 'LOW'); renderer.setPixelRatio(Math.min(devicePixelRatio, HIGH ? 1.75 : 1)); bloom.enabled = HIGH; resize(); };
$('bFull').onclick = () => { (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {}); };
if (!HIGH) $('bQual').textContent = 'QUALITY: LOW';
$('bCred').onclick = async () => {
  const box = $('cred'); box.hidden = !box.hidden; $('bCred').classList.toggle('on', !box.hidden);
  if (!box.hidden && !$('credList').children.length) {
    const list = await fetch(BASE + 'credits.json').then(r => r.json()).catch(() => []);
    for (const c of list) { const li = document.createElement('li'); const a = document.createElement('a'); a.href = c.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = c.name; li.append(c.use + ': ', a, ' by ' + c.author); $('credList').append(li); }
  }
};

build().then(() => {
  if (Q.has('t')) { const t = +Q.get('t'); W.marchT = 0; resetMarch(); for (let s = 0; s < t; s += 1 / 30) { for (const m of W.mixers) m.update(1 / 30); updateMarch(1 / 30); } }
  if (Q.has('free')) setFree(true);
  $('load').classList.add('done'); renderer.setAnimationLoop(frame);
  window.__lt = {scene, camera, W, THREE, setFree, ready: true};
}).catch(e => { msg.textContent = 'COULD NOT LOAD: ' + e.message; console.error(e); });
// debug: name of the mesh at the screen centre
window.__pick = () => { const r = new THREE.Raycaster(); r.setFromCamera({x: 0, y: 0}, camera); const h = r.intersectObjects(scene.children, true).find(x => x.object.isMesh && x.object.visible && !x.object.isSprite && x.object.material.type !== "ShaderMaterial"); return h && (h.object.name + ' | ' + [].concat(h.object.material)[0].name + ' | ' + h.point.toArray().map(v => v.toFixed(1)).join(',')); };
