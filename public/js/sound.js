// Game sounds, synthesised with WebAudio (no audio files to load or license).
// Browsers only allow audio after a user gesture, so the AudioContext is
// created lazily on the first click/tap.

const MUTE_KEY = 'zd_muted';

let ctx = null;
let master = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  muted = false;
}

function ensureContext() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.35;
  master.connect(ctx.destination);
  return ctx;
}

window.addEventListener('pointerdown', () => {
  ensureContext()?.resume?.();
}, { capture: true });

function tone(freq, start, duration, { type = 'sine', volume = 1, slideTo = null } = {}) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function noise(start, duration, { volume = 0.5, filter = 1200 } = {}) {
  const length = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = filter;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(bp).connect(gain).connect(master);
  src.start(start);
}

const SOUNDS = {
  step: (t) => noise(t, 0.08, { volume: 0.35, filter: 500 }),
  question: (t) => {
    tone(660, t, 0.18, { type: 'triangle', volume: 0.6 });
    tone(990, t + 0.12, 0.3, { type: 'triangle', volume: 0.5 });
  },
  correct: (t) => [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.08, 0.25, { type: 'triangle', volume: 0.55 })),
  wrong: (t) => {
    tone(220, t, 0.35, { type: 'sawtooth', volume: 0.3, slideTo: 140 });
    tone(165, t + 0.18, 0.4, { type: 'sawtooth', volume: 0.25, slideTo: 110 });
  },
  alarm: (t) => [0, 0.22].forEach((d) => tone(880, t + d, 0.16, { type: 'square', volume: 0.25, slideTo: 620 })),
  duel: (t) => {
    noise(t, 0.25, { volume: 0.7, filter: 3500 });
    tone(1760, t, 0.4, { type: 'triangle', volume: 0.3, slideTo: 1500 });
    noise(t + 0.18, 0.2, { volume: 0.5, filter: 4200 });
  },
  upgrade: (t) => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.06, 0.3, { type: 'sine', volume: 0.45 })),
  victory: (t) => [[523, 0], [523, 0.15], [523, 0.3], [698, 0.45], [880, 0.75], [1047, 1.0]]
    .forEach(([f, d]) => tone(f, t + d, d === 1.0 ? 0.8 : 0.2, { type: 'triangle', volume: 0.55 })),
  defeat: (t) => [392, 349, 311, 262].forEach((f, i) => tone(f, t + i * 0.25, 0.4, { type: 'triangle', volume: 0.45 })),
};

export function play(name) {
  if (muted || !SOUNDS[name] || !ensureContext() || ctx.state !== 'running') return;
  SOUNDS[name](ctx.currentTime + 0.01);
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Storage may be unavailable (private mode); the choice then lasts for this page only.
  }
  if (master) master.gain.value = muted ? 0 : 0.35;
}
