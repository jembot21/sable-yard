// audio.js — every sound in Sable Yard is synthesised with WebAudio: noise
// bursts through filters for gunfire, short tones for beeps and dings. The
// game ships no audio files. Sounds are placed by distance and bearing from
// the listener (the player), so a shot across the yard sounds across the
// yard — the bots "hear" through state.js's noise events, the player hears
// through this.

let ctx = null;
let master = null;
let noiseBuffer = null;
const listener = { x: 0, z: 0, yaw: 0 };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.45;
  master.connect(ctx.destination);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  startAmbience();
}

export function setListener(x, z, yaw) {
  listener.x = x; listener.z = z; listener.yaw = yaw;
}

// Gain and stereo pan for a sound at (x, z): full and centred at the
// listener, gone by 70 m, panned by bearing.
function place(x, z, out) {
  const dx = x - listener.x, dz = z - listener.z;
  const dist = Math.hypot(dx, dz);
  const gain = Math.max(0, 1 - dist / 70) ** 1.5;
  const bearing = Math.atan2(dx, dz) - (Math.atan2(Math.sin(listener.yaw), Math.cos(listener.yaw)) + Math.PI);
  out.gain = gain;
  out.pan = Math.max(-0.9, Math.min(0.9, -Math.sin(bearing) * Math.min(1, 12 / (dist + 4))));
  out.dist = dist;
  return out;
}

const scratchPlace = { gain: 0, pan: 0, dist: 0 };

function chain(gainValue, pan) {
  const g = ctx.createGain();
  g.gain.value = gainValue;
  let node = g;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    node = p;
  }
  node.connect(master);
  return g;
}

function noise(dur, { gain = 0.5, pan = 0, freq = 1800, q = 0.8, type = 'lowpass', sweepTo = null, delay = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t0 + dur);
  filter.Q.value = q;
  const g = chain(0, pan);
  const env = g.gain;
  env.setValueAtTime(gain, t0);
  env.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter); filter.connect(g);
  src.start(t0, Math.random() * 0.4);
  src.stop(t0 + dur + 0.05);
}

function tone(freq, dur, { gain = 0.2, pan = 0, type = 'sine', slideTo = null, delay = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  const g = chain(0, pan);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const SHOT_SHAPES = {
  p9:      { dur: 0.14, freq: 2600, gain: 0.50, crack: 900 },
  kestrel: { dur: 0.11, freq: 3000, gain: 0.42, crack: 1100 },
  mule:    { dur: 0.30, freq: 1500, gain: 0.75, crack: 500 },
  ar57:    { dur: 0.16, freq: 2300, gain: 0.58, crack: 800 },
  longbow: { dur: 0.42, freq: 1200, gain: 0.85, crack: 350 },
};

export function shotAt(defId, x, z) {
  if (!ctx) return;
  const p = place(x, z, scratchPlace);
  if (p.gain <= 0.01) return;
  const shape = SHOT_SHAPES[defId] || SHOT_SHAPES.ar57;
  const near = Math.max(0, 1 - p.dist / 26); // distant shots lose their body
  noise(shape.dur, { gain: shape.gain * p.gain * (0.35 + 0.65 * near), pan: p.pan, freq: shape.freq * (0.5 + 0.5 * near) + 300, sweepTo: shape.crack });
  tone(150 - p.dist, 0.07, { gain: 0.25 * p.gain * near, pan: p.pan, type: 'triangle', slideTo: 60 });
}

export function dryFire(x, z) {
  const p = place(x, z, scratchPlace);
  tone(1900, 0.04, { gain: 0.12 * p.gain + 0.03, pan: p.pan, type: 'square' });
}

export function reloadSound(x, z, long = false) {
  const p = place(x, z, scratchPlace);
  const g = 0.10 * p.gain + 0.02;
  tone(700, 0.05, { gain: g, pan: p.pan, type: 'square' });
  tone(420, 0.05, { gain: g, pan: p.pan, type: 'square', delay: long ? 0.55 : 0.3 });
  tone(950, 0.06, { gain: g * 1.2, pan: p.pan, type: 'square', delay: long ? 1.05 : 0.55 });
}

export function hitmark(head) {
  tone(head ? 1560 : 1180, 0.06, { gain: 0.16, type: 'square' });
  if (head) tone(2093, 0.09, { gain: 0.14, type: 'square', delay: 0.03 });
}

export function killConfirm() {
  tone(880, 0.08, { gain: 0.15, type: 'triangle' });
  tone(1318, 0.12, { gain: 0.15, type: 'triangle', delay: 0.07 });
}

export function hurt() {
  noise(0.16, { gain: 0.3, freq: 500, sweepTo: 140 });
}

export function footstep(x, z, run) {
  const p = place(x, z, scratchPlace);
  if (p.gain <= 0.02) return;
  noise(0.07, { gain: (run ? 0.13 : 0.06) * p.gain, pan: p.pan, freq: 700, sweepTo: 220 });
}

export function explosionAt(x, z) {
  const p = place(x, z, scratchPlace);
  noise(1.1, { gain: 0.95 * Math.max(0.25, p.gain), pan: p.pan, freq: 900, sweepTo: 60 });
  tone(64, 0.9, { gain: 0.7 * Math.max(0.25, p.gain), pan: p.pan, type: 'sine', slideTo: 30 });
}

export function flashPop(x, z) {
  const p = place(x, z, scratchPlace);
  noise(0.2, { gain: 0.4 * p.gain + 0.05, pan: p.pan, freq: 5200, type: 'highpass' });
  tone(3400, 0.35, { gain: 0.05, type: 'sine', slideTo: 2600 }); // the ring in your ears
}

export function smokeHiss(x, z) {
  const p = place(x, z, scratchPlace);
  noise(1.4, { gain: 0.12 * p.gain + 0.02, pan: p.pan, freq: 3800, type: 'bandpass' });
}

export function throwSound(x, z) {
  const p = place(x, z, scratchPlace);
  noise(0.16, { gain: 0.08 * p.gain + 0.01, pan: p.pan, freq: 1200, type: 'bandpass', sweepTo: 2400 });
}

export function plantBeep(final = false) {
  tone(final ? 1568 : 1046, final ? 0.22 : 0.09, { gain: 0.14, type: 'square' });
}

export function uiClick() { tone(660, 0.05, { gain: 0.1, type: 'square' }); }
export function buyConfirm() { tone(784, 0.07, { gain: 0.12, type: 'triangle' }); tone(1175, 0.1, { gain: 0.12, type: 'triangle', delay: 0.06 }); }
export function denyBuzz() { tone(160, 0.14, { gain: 0.12, type: 'sawtooth' }); }

export function roundStinger(won) {
  if (won) {
    tone(523, 0.16, { gain: 0.14, type: 'triangle' });
    tone(784, 0.26, { gain: 0.14, type: 'triangle', delay: 0.13 });
  } else {
    tone(392, 0.16, { gain: 0.14, type: 'triangle' });
    tone(262, 0.3, { gain: 0.14, type: 'triangle', delay: 0.13 });
  }
}

function startAmbience() {
  // low wind over the yard, always there once audio starts
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 320;
  const g = ctx.createGain();
  g.gain.value = 0.035;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.015;
  lfo.connect(lfoGain); lfoGain.connect(g.gain);
  src.connect(filter); filter.connect(g); g.connect(master);
  src.start();
  lfo.start();
}
