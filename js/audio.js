// AI Parabellum audio: recorded CC0 effects (assets/sfx, about 250 KB, credits in the game) layered over Web Audio synthesis.
// The music, rain and UI sounds are synthesised; if a sample has not loaded (or fails), the old synthesised sound plays instead.
let ctx = null, master = null, sfx = null, music = null, noiseBuf = null, muted = false;

// recording: sound calls are logged with game time, then rendered offline in sync with captured frames
let rec = null, clockFn = null, offT = null, scoreEnd = 0;
const now = () => offT ?? ctx.currentTime;
export function startRecording(clock) { clockFn = clock; rec = []; }
export function initAudio({rain = true} = {}) {
  if (rec) return;
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  build(new AC(), rain);
}
function build(c, rain) {
  ctx = c;
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
  master.connect(comp).connect(ctx.destination);
  sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(master);
  music = ctx.createGain(); music.gain.value = 0.28; music.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  if (rain) startRain(); startScore();
}
export function setMuted(v) { muted = v; if (master) master.gain.setTargetAtTime(v ? 0 : 0.8, ctx.currentTime, 0.05); }
export const isMuted = () => muted;

function noise(dur, {type = 'lowpass', f = 1000, f2 = null, q = 0.7, gain = 1, attack = 0.002, out = sfx, when = 0} = {}) {
  if (!ctx) return; const t = now() + when;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl).connect(g).connect(out); src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
function tone(dur, {f = 80, f2 = 40, type = 'sine', gain = 1, attack = 0.003, out = sfx, when = 0} = {}) {
  if (!ctx) return; const t = now() + when;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
}
const att = d => Math.max(0.04, Math.min(1, 18 / (d + 6)));
// far sounds lose their top end
const lpD = d => d > 15 ? Math.max(900, 16000 * 15 / d) : 0;

// ---- recorded samples ----
const SFX = {cannon: ['cannon_a', 'cannon_b', 'cannon_c'], bolt: ['bolt_a', 'bolt_b'], rocket: ['rocket'],
  boom: ['boom_a', 'boom_b', 'boom_c', 'boom_d'], rumble: ['rumble_a', 'rumble_b'], hit: ['hit_a', 'hit_b', 'hit_c'],
  stomp: ['stomp_a', 'stomp_b'], hijack: ['hijack'], shutdown: ['shutdown']};
const bufs = {}; let sfxLoad = null;
export function loadSfx() {
  if (sfxLoad) return sfxLoad;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OAC || !window.fetch) return (sfxLoad = Promise.resolve());
  const dec = new OAC(1, 1, 44100), dir = new URL('../assets/sfx/', import.meta.url);
  return (sfxLoad = Promise.all(Object.entries(SFX).flatMap(([k, ns]) => ns.map(async (n, i) => {
    try { const r = await fetch(new URL(n + '.mp3', dir)); if (!r.ok) return; const data = await r.arrayBuffer();
      const b = await new Promise((ok, no) => { const p = dec.decodeAudioData(data, ok, no); if (p && p.then) p.then(ok, no); });
      (bufs[k] = bufs[k] || [])[i] = b; } catch (e) {}
  }))));
}
loadSfx();
const pick = k => { const a = (bufs[k] || []).filter(Boolean); return a.length ? a[Math.floor(Math.random() * a.length)] : null; };
// play one variant of sample k; returns false when no sample is ready (callers then fall back to synthesis)
function sample(k, {gain = 1, rate = 1, out = sfx, when = 0, lp = 0, len = 0} = {}) {
  const b = ctx && pick(k); if (!b) return false; const t = now() + when;
  const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); let node = s;
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
  node.connect(g).connect(out); s.start(t);
  if (len) { g.gain.setValueAtTime(gain, t + len * 0.6); g.gain.linearRampToValueAtTime(0.0001, t + len); s.stop(t + len + 0.02); }
  return true;
}

export const sound = {
  // each sound keeps a short synthesised low end for weight; the recorded sample carries the character
  cannon(d = 0) { const a = att(d); if (!sample('cannon', {gain: 0.8 * a, rate: 0.8, lp: lpD(d)})) noise(0.16, {f: 2600, f2: 500, gain: 0.55 * a}); tone(0.18, {f: 130, f2: 42, gain: 0.55 * a}); },
  enemyCannon(d) { const a = att(d) * 0.8; if (!sample('cannon', {gain: 0.65 * a, rate: 0.68, lp: lpD(d)})) noise(0.14, {f: 1800, f2: 400, gain: 0.45 * a}); tone(0.14, {f: 105, f2: 38, gain: 0.4 * a}); },
  bolt(d) { const a = att(d) * 0.6; if (!sample('bolt', {gain: 0.2 * a, lp: lpD(d)})) { tone(0.12, {f: 1400, f2: 300, type: 'sawtooth', gain: 0.18 * a}); noise(0.08, {type: 'bandpass', f: 3000, gain: 0.2 * a}); } },
  rocket(d = 0) { const a = att(d); if (!sample('rocket', {gain: 0.38 * a, len: 1.2, lp: lpD(d)})) noise(0.7, {type: 'bandpass', f: 600, f2: 2400, q: 1.2, gain: 0.5 * a, attack: 0.04}); tone(0.25, {f: 90, f2: 50, gain: 0.35 * a}); },
  explosion(d = 0, big = 1) { const a = att(d) * Math.min(1.4, big), lp = lpD(d);
    const ok = sample('boom', {gain: 0.58 * a, rate: big > 1.3 ? 0.8 : 1, lp}); sample('rumble', {gain: 0.5 * a, rate: big > 1.3 ? 0.75 : 1, lp: lp ? Math.min(lp, 1200) : 0});
    if (!ok) { noise(1.6 * big, {f: 1400, f2: 90, gain: 0.95 * a, attack: 0.005}); noise(0.3, {type: 'highpass', f: 2500, gain: 0.3 * a}); }
    tone(1.0 * big, {f: 65, f2: 22, gain: 0.75 * a}); },
  hit(d = 0) { const a = att(d); if (!sample('hit', {gain: 0.18 * a, rate: 1.1, lp: lpD(d)})) { tone(0.09, {f: 900 + Math.random() * 300, f2: 500, type: 'square', gain: 0.12 * a}); noise(0.06, {type: 'highpass', f: 3500, gain: 0.25 * a}); } },
  hurt() { if (!sample('stomp', {gain: 0.7, rate: 0.9})) noise(0.25, {f: 900, f2: 200, gain: 0.55}); tone(0.3, {f: 60, f2: 35, gain: 0.7}); },
  stomp(d = 0, heavy = 1) { const a = att(d) * heavy; if (!sample('stomp', {gain: 0.4 * a, rate: heavy > 1.2 ? 0.5 : 0.62, lp: lpD(d) || 2500})) noise(0.18, {f: 400, f2: 80, gain: 0.35 * a}); tone(0.3, {f: 55, f2: 28, gain: 0.75 * a}); },
  servo(d = 0) { const a = att(d) * 0.5; tone(0.35, {f: 220, f2: 330, type: 'sawtooth', gain: 0.05 * a}); },
  overheat() { tone(0.6, {f: 900, f2: 200, type: 'square', gain: 0.08}); noise(0.8, {type: 'highpass', f: 4000, f2: 1500, gain: 0.25}); },
  shutdown(d = 0) { const a = att(d); sample('shutdown', {gain: 0.11 * a, rate: 0.55, lp: lpD(d)}); tone(1.4, {f: 400, f2: 30, type: 'sawtooth', gain: 0.18 * a}); noise(1.2, {type: 'bandpass', f: 1500, f2: 200, gain: 0.25 * a}); },
  hijack() { if (sample('hijack', {gain: 0.38})) { tone(1.6, {f: 60, f2: 480, type: 'sawtooth', gain: 0.1}); tone(0.5, {f: 880, f2: 880, type: 'sine', gain: 0.15, when: 1.55}); return; }
    tone(1.6, {f: 60, f2: 480, type: 'sawtooth', gain: 0.2}); tone(1.6, {f: 61, f2: 485, type: 'square', gain: 0.08, when: 0.02}); noise(0.6, {type: 'bandpass', f: 400, f2: 5000, q: 2, gain: 0.25, when: 1.0}); tone(0.5, {f: 880, f2: 880, type: 'sine', gain: 0.15, when: 1.55}); },
  alarm() { for (let i = 0; i < 3; i++) tone(0.22, {f: 760, f2: 520, type: 'square', gain: 0.07, when: i * 0.3}); },
  ui() { tone(0.06, {f: 1200, f2: 1600, type: 'triangle', gain: 0.08}); },
  thunder() { if (!sample('rumble', {gain: 0.09, rate: 0.5, lp: 700})) noise(4.5, {f: 260, f2: 50, gain: 0.5, attack: 0.25}); },
};

function startRain() {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.4;
  const g = ctx.createGain(); g.gain.value = 0.09; src.connect(f).connect(g).connect(master); src.start();
}
// a slow, dark score: two detuned saw drones under a moving low-pass, plus a distant pulse
function startScore() {
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 4; lp.connect(music);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05; const lg = ctx.createGain(); lg.gain.value = 180; lfo.connect(lg).connect(lp.frequency); lfo.start();
  for (const [f, det] of [[36.7, -8], [36.7, 9], [55, 4], [43.65, -3]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; const g = ctx.createGain(); g.gain.value = 0.22; o.connect(g).connect(lp); o.start(); }
  let next = ctx.currentTime + 1;
  if (scoreEnd) { while (next < scoreEnd) { tone(0.5, {f: 48, f2: 40, gain: 0.5, out: music, when: next - ctx.currentTime}); next += 1.6; } return; }
  const pulse = () => { if (!ctx) return; while (next < ctx.currentTime + 2) { tone(0.5, {f: 48, f2: 40, gain: 0.5, out: music, when: next - ctx.currentTime}); next += 1.6; } setTimeout(pulse, 800); };
  pulse();
}
export function scoreIntensity(k) { if (rec) { rec.push([clockFn(), 'score', [k]]); return; } if (music) music.gain.setTargetAtTime(0.22 + k * 0.25, now(), 1.5); }
// log every sound call while recording
for (const name of Object.keys(sound)) { const fn = sound[name]; sound[name] = (...args) => { if (rec) { rec.push([clockFn(), name, args]); return; } fn(...args); }; }
// render the log from game time t0 for dur seconds; returns a 16-bit stereo WAV as base64
export async function renderRecording(t0, dur, {rain = true, intensity = 0.6} = {}) {
  await loadSfx();
  const log = rec, sr = 48000, off = new OfflineAudioContext(2, Math.ceil(sr * dur), sr); rec = null; scoreEnd = dur; build(off, rain);
  music.gain.value = 0.22 + intensity * 0.25;
  for (const [t, name, args] of log) { if (t < t0 - 0.05 || t > t0 + dur) continue; offT = Math.max(0, t - t0);
    if (name === 'score') music.gain.setTargetAtTime(0.22 + args[0] * 0.25, offT, 1.5); else sound[name](...args); }
  offT = null; const buf = await off.startRendering(); ctx = null;
  const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1), out = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o, str) => { for (let i = 0; i < str.length; i++) out.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
  let bin = ''; const u8 = new Uint8Array(out.buffer); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
