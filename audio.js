// Synthesized classic-pinball sound effects via the Web Audio API.
// No audio files: every sound is generated from oscillators/noise so the
// game stays a static, asset-light page.

let ctx = null;
let master = null;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
  }
  return ctx;
}

// Browsers block audio until a user gesture; call this from input handlers.
export function unlockAudio() {
  const c = getCtx();
  if (c.state === 'suspended') c.resume();
}

function envGain(c, t0, peakGain, attack, dur) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peakGain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  return g;
}

function tone(freq, { type = 'sine', dur = 0.12, gain = 0.4, attack = 0.004, glideTo = null } = {}) {
  const c = getCtx();
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), t0 + dur);
  const g = envGain(c, t0, gain, attack, dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBurst({ dur = 0.06, gain = 0.3, filterFreq = 1200, filterType = 'lowpass' } = {}) {
  const c = getCtx();
  const t0 = c.currentTime;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  const g = envGain(c, t0, gain, 0.002, dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function chime(freqs, { dur = 0.1, gap = 0.06, type = 'triangle', gain = 0.3 } = {}) {
  freqs.forEach((f, i) => setTimeout(() => tone(f, { type, dur, gain }), i * gap * 1000));
}

// Cuts down rapid-fire retriggering when a collision lingers across several
// physics steps (e.g. a ball briefly pinned against a wall or bumper).
function throttle(fn, ms) {
  let last = -Infinity;
  return (...args) => {
    const now = performance.now();
    if (now - last < ms) return;
    last = now;
    fn(...args);
  };
}

const wallThud = throttle(() => noiseBurst({ dur: 0.04, gain: 0.16, filterFreq: 550, filterType: 'lowpass' }), 70);
const bumperPing = throttle(
  () => tone(880, { type: 'sine', dur: 0.11, gain: 0.45, glideTo: 220 }),
  80
);
const flipperHitBall = throttle(() => {
  noiseBurst({ dur: 0.03, gain: 0.3, filterFreq: 3000, filterType: 'highpass' });
  tone(260, { type: 'square', dur: 0.07, gain: 0.3, glideTo: 120 });
}, 60);

export const Sfx = {
  // mechanical solenoid click when a flipper button is pressed (whether or not it touches the ball)
  flipperPress() {
    noiseBurst({ dur: 0.03, gain: 0.35, filterFreq: 2600, filterType: 'highpass' });
  },
  // the ball actually striking a flipper
  flipperHit: flipperHitBall,
  bumper: bumperPing,
  wall: wallThud,
  dataNode() {
    chime([1046, 1568], { dur: 0.09, gap: 0.05, type: 'triangle', gain: 0.32 });
  },
  dataNodeRepeat() {
    tone(1320, { type: 'triangle', dur: 0.07, gain: 0.22 });
  },
  overload() {
    chime([523, 659, 784, 1046, 1318], { dur: 0.12, gap: 0.07, type: 'sawtooth', gain: 0.3 });
  },
  firewallJackpot() {
    chime([784, 988, 1176, 1568], { dur: 0.1, gap: 0.06, type: 'square', gain: 0.32 });
  },
  warpRamp() {
    tone(160, { type: 'sawtooth', dur: 0.5, gain: 0.28, glideTo: 1400 });
    noiseBurst({ dur: 0.5, gain: 0.1, filterFreq: 2000, filterType: 'bandpass' });
  },
  slowMo() {
    tone(700, { type: 'sine', dur: 0.4, gain: 0.3, glideTo: 240 });
  },
  ghostBallSave() {
    chime([660, 880, 1100, 1320], { dur: 0.09, gap: 0.045, type: 'triangle', gain: 0.34 });
  },
  launch() {
    tone(140, { type: 'sawtooth', dur: 0.18, gain: 0.4, glideTo: 520 });
  },
  drain() {
    tone(300, { type: 'sine', dur: 0.35, gain: 0.3, glideTo: 80 });
  },
  gameOver() {
    chime([392, 330, 262, 196], { dur: 0.22, gap: 0.18, type: 'sawtooth', gain: 0.3 });
  },
  uiClick() {
    tone(440, { type: 'square', dur: 0.05, gain: 0.2 });
  },
};
