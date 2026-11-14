// AI Parabellum audio: every sound is synthesised with Web Audio, so nothing extra is downloaded.
let ctx = null, master = null, sfx = null, music = null, noiseBuf = null, muted = false;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
  master.connect(comp).connect(ctx.destination);
  sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(master);
  music = ctx.createGain(); music.gain.value = 0.28; music.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startRain(); startScore();
}
export function setMuted(v) { muted = v; if (master) master.gain.setTargetAtTime(v ? 0 : 0.8, ctx.currentTime, 0.05); }
export const isMuted = () => muted;

function noise(dur, {type = 'lowpass', f = 1000, f2 = null, q = 0.7, gain = 1, attack = 0.002, out = sfx, when = 0} = {}) {
  if (!ctx) return; const t = ctx.currentTime + when;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl).connect(g).connect(out); src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
function tone(dur, {f = 80, f2 = 40, type = 'sine', gain = 1, attack = 0.003, out = sfx, when = 0} = {}) {
  if (!ctx) return; const t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
}
const att = d => Math.max(0.04, Math.min(1, 18 / (d + 6)));

export const sound = {
  cannon(d = 0) { const a = att(d); noise(0.16, {f: 2600, f2: 500, gain: 0.55 * a}); tone(0.18, {f: 140, f2: 45, gain: 0.7 * a}); },
  enemyCannon(d) { const a = att(d) * 0.8; noise(0.14, {f: 1800, f2: 400, gain: 0.45 * a}); tone(0.14, {f: 110, f2: 40, gain: 0.5 * a}); },
  bolt(d) { const a = att(d) * 0.6; tone(0.12, {f: 1400, f2: 300, type: 'sawtooth', gain: 0.18 * a}); noise(0.08, {type: 'bandpass', f: 3000, gain: 0.2 * a}); },
  rocket(d = 0) { const a = att(d); noise(0.7, {type: 'bandpass', f: 600, f2: 2400, q: 1.2, gain: 0.5 * a, attack: 0.04}); tone(0.25, {f: 90, f2: 50, gain: 0.4 * a}); },
  explosion(d = 0, big = 1) { const a = att(d) * Math.min(1.4, big); noise(1.6 * big, {f: 1400, f2: 90, gain: 0.95 * a, attack: 0.005}); tone(1.0 * big, {f: 70, f2: 22, gain: 1.0 * a}); noise(0.3, {type: 'highpass', f: 2500, gain: 0.3 * a}); },
  hit(d = 0) { const a = att(d); tone(0.09, {f: 900 + Math.random() * 300, f2: 500, type: 'square', gain: 0.12 * a}); noise(0.06, {type: 'highpass', f: 3500, gain: 0.25 * a}); },
  hurt() { noise(0.25, {f: 900, f2: 200, gain: 0.55}); tone(0.3, {f: 60, f2: 35, gain: 0.8}); },
  stomp(d = 0, heavy = 1) { const a = att(d) * heavy; tone(0.3, {f: 55, f2: 28, gain: 0.85 * a}); noise(0.18, {f: 400, f2: 80, gain: 0.35 * a}); },
  servo(d = 0) { const a = att(d) * 0.5; tone(0.35, {f: 220, f2: 330, type: 'sawtooth', gain: 0.05 * a}); },
  overheat() { tone(0.6, {f: 900, f2: 200, type: 'square', gain: 0.08}); noise(0.8, {type: 'highpass', f: 4000, f2: 1500, gain: 0.25}); },
  shutdown(d = 0) { const a = att(d); tone(1.4, {f: 400, f2: 30, type: 'sawtooth', gain: 0.22 * a}); noise(1.2, {type: 'bandpass', f: 1500, f2: 200, gain: 0.3 * a}); },
  hijack() { tone(1.6, {f: 60, f2: 480, type: 'sawtooth', gain: 0.2}); tone(1.6, {f: 61, f2: 485, type: 'square', gain: 0.08, when: 0.02}); noise(0.6, {type: 'bandpass', f: 400, f2: 5000, q: 2, gain: 0.25, when: 1.0}); tone(0.5, {f: 880, f2: 880, type: 'sine', gain: 0.15, when: 1.55}); },
  alarm() { for (let i = 0; i < 3; i++) tone(0.22, {f: 760, f2: 520, type: 'square', gain: 0.07, when: i * 0.3}); },
  ui() { tone(0.06, {f: 1200, f2: 1600, type: 'triangle', gain: 0.08}); },
  thunder() { noise(4.5, {f: 260, f2: 50, gain: 0.5, attack: 0.25}); },
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
  const pulse = () => { if (!ctx) return; while (next < ctx.currentTime + 2) { tone(0.5, {f: 48, f2: 40, gain: 0.5, out: music, when: next - ctx.currentTime}); next += 1.6; } setTimeout(pulse, 800); };
  pulse();
}
export function scoreIntensity(k) { if (music) music.gain.setTargetAtTime(0.22 + k * 0.25, ctx.currentTime, 1.5); }
