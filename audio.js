// Synthesized classic-pinball sound effects via the Web Audio API.
// No audio files: every sound is generated from oscillators/noise so the
// game stays a static, asset-light page.

let ctx = null;
let master = null;
const MASTER_VOL = 0.45;
let muted = false;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOL;
    master.connect(ctx.destination);
  }
  return ctx;
}

// Browsers block audio until a user gesture; call this from input handlers.
export function unlockAudio() {
  const c = getCtx();
  if (c.state === 'suspended') c.resume();
}

// Mute affects both music and SFX (the whole master bus). Returns new state.
export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : MASTER_VOL;
  return muted;
}
export function isMuted() {
  return muted;
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
  tilt() {
    tone(90, { type: 'square', dur: 0.5, gain: 0.4, glideTo: 60 });
    noiseBurst({ dur: 0.45, gain: 0.18, filterFreq: 400, filterType: 'lowpass' });
  },
  multiball() {
    chime([523, 659, 784, 1046, 784, 1046, 1318], { dur: 0.12, gap: 0.06, type: 'square', gain: 0.32 });
  },
  skillShot() {
    chime([1046, 1318, 1568, 2093], { dur: 0.1, gap: 0.05, type: 'triangle', gain: 0.34 });
  },
  rift() {
    tone(1200, { type: 'sawtooth', dur: 0.14, gain: 0.22, glideTo: 400 });
  },
  mission() {
    chime([784, 1046, 1318], { dur: 0.12, gap: 0.07, type: 'triangle', gain: 0.3 });
  },
  uiClick() {
    tone(440, { type: 'square', dur: 0.05, gain: 0.2 });
  },
  // sharp rubber "thwack" of a slingshot kicker
  slingshot() {
    noiseBurst({ dur: 0.05, gain: 0.4, filterFreq: 1800, filterType: 'bandpass' });
    tone(180, { type: 'square', dur: 0.08, gain: 0.32, glideTo: 90 });
  },
  // rapid metallic ticking as the spinner whirls
  spinnerTick() {
    tone(1900 + Math.random() * 300, { type: 'square', dur: 0.03, gain: 0.14 });
  },
  // a drop target collapsing into the playfield
  dropTarget() {
    noiseBurst({ dur: 0.06, gain: 0.32, filterFreq: 900, filterType: 'lowpass' });
    tone(520, { type: 'triangle', dur: 0.09, gain: 0.26, glideTo: 260 });
  },
  // full bank completed: targets reset with a rising sweep
  bankComplete() {
    chime([659, 880, 1174, 1568], { dur: 0.1, gap: 0.055, type: 'square', gain: 0.3 });
  },
  // kickback firing the ball out of the outlane
  kickback() {
    tone(120, { type: 'sawtooth', dur: 0.22, gain: 0.4, glideTo: 700 });
    noiseBurst({ dur: 0.12, gain: 0.22, filterFreq: 2400, filterType: 'highpass' });
  },
  jackpot() {
    chime([784, 1046, 1318, 1568, 2093], { dur: 0.12, gap: 0.06, type: 'square', gain: 0.34 });
  },
  superJackpot() {
    chime([523, 784, 1046, 1318, 1568, 2093, 2637], { dur: 0.13, gap: 0.055, type: 'sawtooth', gain: 0.32 });
  },
  modeStart() {
    tone(220, { type: 'sawtooth', dur: 0.4, gain: 0.3, glideTo: 880 });
    chime([880, 1174, 1568], { dur: 0.1, gap: 0.08, type: 'square', gain: 0.26 });
  },
  modeComplete() {
    chime([1046, 1318, 1568, 2093, 1568, 2093], { dur: 0.11, gap: 0.06, type: 'triangle', gain: 0.32 });
  },
  modeFail() {
    chime([440, 349, 293], { dur: 0.16, gap: 0.12, type: 'sawtooth', gain: 0.26 });
  },
  wizardStart() {
    tone(110, { type: 'sawtooth', dur: 1.0, gain: 0.34, glideTo: 1760 });
    chime([523, 659, 784, 1046, 1318, 1568, 2093], { dur: 0.14, gap: 0.07, type: 'square', gain: 0.3 });
  },
  // one tick of the end-of-ball bonus count-up
  bonusTick() {
    tone(980 + Math.random() * 120, { type: 'triangle', dur: 0.05, gain: 0.22 });
  },
  extraBall() {
    chime([784, 784, 1174, 1174, 1568], { dur: 0.1, gap: 0.07, type: 'square', gain: 0.34 });
  },
  // classic end-of-game match sequence: knocker thump on a hit
  matchHit() {
    noiseBurst({ dur: 0.08, gain: 0.5, filterFreq: 700, filterType: 'lowpass' });
    tone(90, { type: 'square', dur: 0.2, gain: 0.4, glideTo: 55 });
  },
  matchMiss() {
    tone(340, { type: 'sine', dur: 0.2, gain: 0.2, glideTo: 180 });
  },
  comboShot() {
    chime([1318, 1760], { dur: 0.08, gap: 0.04, type: 'triangle', gain: 0.3 });
  },
};

// =====================================================================
// BACKGROUND MUSIC — a looping minor-key synth arpeggio over a low drone.
// Built entirely from oscillators so there are still no audio assets.
// =====================================================================
let musicGain = null;
let droneNodes = null;
let musicTimer = null;
let musicStep = 0;
let musicIntense = false;

// During modes/multiball the arpeggio doubles up an octave for urgency.
export function setMusicIntensity(intense) {
  musicIntense = !!intense;
}

// Two bars of an A-minor-ish cyberpunk arpeggio (Hz). null = rest.
const MUSIC_SEQ = [
  220, 261.6, 329.6, 440, 329.6, 261.6, 220, 329.6,
  196, 246.9, 329.6, 392, 329.6, 246.9, 196, 293.7,
];
const STEP_MS = 220;

export function startMusic() {
  const c = getCtx();
  if (musicGain) return; // already running
  musicGain = c.createGain();
  musicGain.gain.value = 0.16;
  musicGain.connect(master);

  // continuous low drone (two detuned saws through a lowpass)
  const droneGain = c.createGain();
  droneGain.gain.value = 0.12;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 380;
  droneGain.connect(lp);
  lp.connect(musicGain);
  const oscs = [55, 55.4, 82.4].map((f) => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(droneGain);
    o.start();
    return o;
  });
  droneNodes = { oscs, droneGain };

  musicStep = 0;
  musicTimer = setInterval(() => {
    const cc = getCtx();
    const f = MUSIC_SEQ[musicStep % MUSIC_SEQ.length];
    musicStep++;
    if (!f) return;
    const t0 = cc.currentTime;
    const osc = cc.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = cc.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.5, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    osc.connect(g);
    g.connect(musicGain);
    osc.start(t0);
    osc.stop(t0 + 0.33);
    // intensity layer: echo the note an octave up on the off-beat
    if (musicIntense) {
      const osc2 = cc.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = f * 2;
      const g2 = cc.createGain();
      g2.gain.setValueAtTime(0.0001, t0 + 0.11);
      g2.gain.linearRampToValueAtTime(0.22, t0 + 0.13);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      osc2.connect(g2);
      g2.connect(musicGain);
      osc2.start(t0 + 0.11);
      osc2.stop(t0 + 0.31);
    }
  }, STEP_MS);
}

export function stopMusic() {
  if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
  if (droneNodes) {
    droneNodes.oscs.forEach((o) => { try { o.stop(); } catch (e) {} });
    droneNodes = null;
  }
  if (musicGain) {
    try { musicGain.disconnect(); } catch (e) {}
    musicGain = null;
  }
}
