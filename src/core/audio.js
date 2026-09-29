// Fully procedural audio: sea & wind ambience, cannon fire with distance delay, swords, pistols,
// thunder, and a small generative score (sailing jig, battle drums, tavern tune).

function noiseBuffer(ctx, seconds = 2, type = 'white') {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (type === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    } else if (type === 'brown') {
      last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
    this.volumes = { master: 0.8, music: 0.55, sfx: 0.9 };
    this.musicMode = 'none';
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.volumes.sfx; this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.volumes.music; this.musicBus.connect(this.master);
    // shared reverb for music & distant booms
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.4);
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.white = noiseBuffer(ctx, 3, 'white');
    this.pink = noiseBuffer(ctx, 4, 'pink');
    this.brown = noiseBuffer(ctx, 4, 'brown');
    this.buildAmbience();
    this.music = new Music(this);
    this.ready = true;
  }

  impulse(sec) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.musicBus.gain.value = this.volumes.music;
    this.sfx.gain.value = this.volumes.sfx;
  }

  loop(buffer, filterType, freq, q = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    src.loopStart = Math.random();
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.sfx);
    src.start(0, Math.random() * 2);
    return { src, f, g };
  }

  buildAmbience() {
    this.amb = {
      sea: this.loop(this.brown, 'lowpass', 500, 0.5),
      surf: this.loop(this.pink, 'bandpass', 900, 0.6),
      wind: this.loop(this.pink, 'bandpass', 600, 2.5),
      rain: this.loop(this.white, 'highpass', 2500, 0.5),
      crowd: this.loop(this.pink, 'bandpass', 380, 1.5),
    };
    this.creakTimer = 2;
    this.gullTimer = 5;
  }

  // Ambient levels each frame
  update(dt, s) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const A = this.amb;
    const swell = 0.5 + 0.5 * Math.sin(t * 0.35) * Math.sin(t * 0.13 + 1);
    A.sea.g.gain.setTargetAtTime((0.18 + 0.12 * swell) * s.seaLevel, t, 0.3);
    A.sea.f.frequency.setTargetAtTime(300 + 400 * swell * s.seaState, t, 0.3);
    A.surf.g.gain.setTargetAtTime(0.05 * s.surf * (0.6 + swell), t, 0.3);
    A.wind.g.gain.setTargetAtTime(0.02 + 0.07 * s.wind, t, 0.5);
    A.wind.f.frequency.setTargetAtTime(420 + 500 * s.wind + 180 * Math.sin(t * 0.7), t, 0.4);
    A.rain.g.gain.setTargetAtTime(0.12 * s.rain, t, 0.8);
    A.crowd.g.gain.setTargetAtTime(0.05 * s.town, t, 1);
    this.creakTimer -= dt;
    if (s.onShip && this.creakTimer <= 0) {
      this.creakTimer = 1.5 + Math.random() * 4;
      this.creak(0.3 + s.seaState * 0.25);
    }
    this.gullTimer -= dt;
    if (s.nearLand > 0.3 && s.day && this.gullTimer <= 0) {
      this.gullTimer = 4 + Math.random() * 10;
      this.gull(s.nearLand);
    }
    if (this.music) this.music.update();
  }

  setListener(pos, camRight) {
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    this.listener.rx = camRight.x; this.listener.rz = camRight.z;
  }

  // Spatial routing: returns {node, delay} for a sound at pos
  spatial(pos, ref = 120, maxDelay = 2.5) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    let d = 0, pan = 0, vol = 1;
    if (pos) {
      const dx = pos.x - this.listener.x, dy = (pos.y || 0) - this.listener.y, dz = pos.z - this.listener.z;
      d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      vol = 1 / (1 + (d / ref) * (d / ref) * 0.5 + d / ref * 0.5);
      if (d > 1) pan = Math.max(-1, Math.min(1, (dx * this.listener.rx + dz * this.listener.rz) / d)) * 0.8;
    }
    g.gain.value = vol;
    p.pan.value = pan;
    g.connect(p).connect(this.sfx);
    const delay = Math.min(maxDelay, d / 343);
    return { node: g, delay, vol, dist: d };
  }

  burst(buffer, { pos, ref, dur = 0.5, attack = 0.005, filter = 'lowpass', freq = 1000, q = 0.7, gain = 1, freqEnd, rate = 1, reverb = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const sp = this.spatial(pos, ref);
    if (sp.vol < 0.004) return;
    const t0 = ctx.currentTime + sp.delay;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = filter; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(sp.node);
    if (reverb > 0) {
      const rg = ctx.createGain(); rg.gain.value = reverb * sp.vol; g.connect(rg).connect(this.reverb);
    }
    src.start(t0, Math.random() * 1.5, dur + 0.1);
  }

  tone(freq, { pos, ref, dur = 0.3, type = 'sine', gain = 0.3, freqEnd, attack = 0.005, delay = 0, dest }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const sp = pos !== undefined ? this.spatial(pos, ref) : { node: dest || this.sfx, delay: 0, vol: 1 };
    const t0 = ctx.currentTime + sp.delay + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(sp.node);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // ---------------------------------------------------------------- effects
  cannon(pos, big = 1) {
    this.burst(this.brown, { pos, ref: 260, dur: 1.8 * big, filter: 'lowpass', freq: 900, freqEnd: 90, gain: 1.0, reverb: 0.8 });
    this.burst(this.white, { pos, ref: 180, dur: 0.35, filter: 'bandpass', freq: 1800, q: 0.5, gain: 0.5 });
    this.tone(70, { pos, ref: 260, dur: 0.9, type: 'sine', gain: 0.9, freqEnd: 28 });
  }

  broadside(pos, n, isPlayer) {
    if (!this.ready) return;
    for (let i = 0; i < Math.min(n, 8); i++) {
      setTimeout(() => this.cannon(pos, 1), i * 75 + Math.random() * 40);
    }
  }

  musket(pos) {
    this.burst(this.white, { pos, ref: 90, dur: 0.25, filter: 'highpass', freq: 900, gain: 0.8, reverb: 0.3 });
    this.burst(this.brown, { pos, ref: 90, dur: 0.6, filter: 'lowpass', freq: 500, freqEnd: 80, gain: 0.7 });
  }

  pistol(pos) { this.musket(pos); }

  clang(pos) {
    const base = 900 + Math.random() * 400;
    for (const [m, g] of [[1, 0.25], [2.76, 0.15], [5.4, 0.08], [8.9, 0.05]]) this.tone(base * m, { pos, ref: 40, dur: 0.6 / Math.sqrt(m), type: 'sine', gain: g });
    this.burst(this.white, { pos, ref: 40, dur: 0.08, filter: 'highpass', freq: 3000, gain: 0.3 });
  }

  swoosh(pos) {
    this.burst(this.pink, { pos, ref: 30, dur: 0.25, attack: 0.08, filter: 'bandpass', freq: 800, freqEnd: 2500, q: 1.5, gain: 0.25 });
  }

  thud(pos) {
    this.tone(120, { pos, ref: 30, dur: 0.2, gain: 0.4, freqEnd: 60 });
    this.burst(this.brown, { pos, ref: 30, dur: 0.2, filter: 'lowpass', freq: 400, gain: 0.4 });
  }

  grunt(pos) {
    this.tone(160 + Math.random() * 60, { pos, ref: 30, dur: 0.25, type: 'sawtooth', gain: 0.08, freqEnd: 90 });
  }

  splash(pos) {
    this.burst(this.white, { pos, ref: 120, dur: 0.9, filter: 'bandpass', freq: 1200, freqEnd: 400, q: 0.8, gain: 0.5 });
  }

  impact(pos, kind) {
    if (kind === 'wood') {
      this.burst(this.brown, { pos, ref: 150, dur: 0.6, filter: 'lowpass', freq: 1400, freqEnd: 200, gain: 0.9 });
      this.burst(this.white, { pos, ref: 150, dur: 0.18, filter: 'bandpass', freq: 2400, q: 2, gain: 0.35 });
    } else this.burst(this.pink, { pos, ref: 100, dur: 0.3, filter: 'bandpass', freq: 700, gain: 0.3 });
  }

  crunch(pos) { this.burst(this.brown, { pos, ref: 60, dur: 1.4, filter: 'lowpass', freq: 600, freqEnd: 100, gain: 0.9 }); }

  explosion(pos) {
    this.burst(this.brown, { pos, ref: 500, dur: 3.5, filter: 'lowpass', freq: 1500, freqEnd: 60, gain: 1.2, reverb: 1 });
    this.tone(50, { pos, ref: 500, dur: 2, gain: 1, freqEnd: 20 });
  }

  thunder(dist = 800) {
    if (!this.ready) return;
    const pos = { x: this.listener.x + dist, y: 200, z: this.listener.z };
    this.burst(this.brown, { pos, ref: 2000, dur: 4.5, attack: 0.2, filter: 'lowpass', freq: 400, freqEnd: 60, gain: 1.2, reverb: 1 });
  }

  creak(v) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 70 + Math.random() * 90;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.linearRampToValueAtTime(f0 * (0.8 + Math.random() * 0.5), t0 + 0.6);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 800; bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.03 * v, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    // amplitude "stick-slip" modulation
    const lfo = ctx.createOscillator(); lfo.frequency.value = 18 + Math.random() * 20;
    const lg = ctx.createGain(); lg.gain.value = 0.02 * v;
    lfo.connect(lg).connect(g.gain);
    o.connect(bp).connect(g).connect(this.sfx);
    o.start(t0); o.stop(t0 + 0.8); lfo.start(t0); lfo.stop(t0 + 0.8);
  }

  gull(v) {
    if (!this.ready) return;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const f = 1400 + Math.random() * 500;
      this.tone(f, { dur: 0.35, type: 'triangle', gain: 0.035 * v, freqEnd: f * 0.6, delay: i * 0.4, attack: 0.05 });
    }
  }

  coins() {
    for (let i = 0; i < 7; i++) this.tone(2400 + Math.random() * 2400, { dur: 0.25, type: 'sine', gain: 0.08, delay: i * 0.05 + Math.random() * 0.03 });
  }

  bell(n = 2) {
    for (let i = 0; i < n; i++) {
      const d = Math.floor(i / 2) * 1.2 + (i % 2) * 0.35;
      for (const [m, g] of [[1, 0.12], [2.0, 0.06], [2.76, 0.04], [5.4, 0.02]]) this.tone(620 * m, { dur: 2.2 / m, gain: g, delay: d });
    }
  }

  ui(kind = 'click') {
    if (kind === 'click') this.tone(900, { dur: 0.06, type: 'triangle', gain: 0.06 });
    else if (kind === 'open') this.burst(this.pink, { dur: 0.3, filter: 'bandpass', freq: 1500, freqEnd: 600, gain: 0.12 });
    else if (kind === 'fanfare') {
      [62, 66, 69, 74].forEach((n, i) => this.tone(midi(n), { dur: 0.5, type: 'triangle', gain: 0.12, delay: i * 0.12 }));
    } else if (kind === 'fail') {
      [62, 61, 58].forEach((n, i) => this.tone(midi(n), { dur: 0.45, type: 'triangle', gain: 0.1, delay: i * 0.18 }));
    }
  }

  dig() { this.burst(this.brown, { dur: 0.3, filter: 'lowpass', freq: 800, gain: 0.3 }); }

  setMusic(mode) {
    if (!this.ready || this.musicMode === mode) return;
    this.musicMode = mode;
    this.music.setMode(mode);
  }
}

// ---------------------------------------------------------------- generative score
const SAIL_TUNE = [
  // [midi, eighths]  D dorian jig in 6/8
  [69, 2], [74, 1], [74, 2], [76, 1], [77, 2], [76, 1], [74, 2], [72, 1],
  [69, 2], [67, 1], [69, 2], [72, 1], [74, 3], [69, 3],
  [69, 2], [74, 1], [74, 2], [76, 1], [77, 2], [79, 1], [81, 2], [77, 1],
  [76, 2], [72, 1], [74, 2], [76, 1], [74, 6],
  [81, 2], [79, 1], [77, 2], [76, 1], [77, 2], [76, 1], [74, 2], [72, 1],
  [70, 2], [72, 1], [74, 2], [69, 1], [67, 3], [65, 3],
  [67, 2], [69, 1], [70, 2], [72, 1], [74, 2], [72, 1], [70, 2], [69, 1],
  [67, 2], [65, 1], [64, 2], [65, 1], [62, 6],
];
const SAIL_CHORDS = [50, 48, 50, 45, 50, 53, 48, 50, 53, 46, 43, 45, 43, 45, 46, 50];
const BATTLE_TUNE = [
  [62, 1], [62, 1], [65, 1], [62, 1], [67, 1], [65, 1], [64, 1], [61, 1],
  [62, 1], [62, 1], [69, 1], [67, 1], [65, 2], [64, 2],
  [70, 1], [69, 1], [67, 1], [65, 1], [64, 1], [65, 1], [67, 1], [61, 1],
  [62, 2], [57, 2], [62, 4],
];
const TAVERN_TUNE = [
  [67, 1], [71, 1], [74, 1], [79, 2], [78, 1], [76, 2], [74, 1], [71, 2], [72, 1],
  [74, 2], [71, 1], [67, 2], [69, 1], [71, 3], [67, 3],
  [67, 1], [71, 1], [74, 1], [79, 2], [81, 1], [83, 2], [81, 1], [79, 2], [76, 1],
  [78, 2], [74, 1], [76, 2], [78, 1], [79, 6],
];

class Music {
  constructor(audio) {
    this.a = audio;
    this.ctx = audio.ctx;
    this.mode = 'none';
    this.nextTime = 0;
    this.step = 0;
    this.noteIdx = 0;
    this.noteLeft = 0;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(audio.musicBus);
    const rv = this.ctx.createGain(); rv.gain.value = 0.4;
    this.gain.connect(rv).connect(audio.reverb);
  }

  setMode(mode) {
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, 0.6);
    this.pending = mode;
    this.switchAt = t + 1.6;
  }

  update() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (this.pending !== undefined && t >= this.switchAt) {
      this.mode = this.pending;
      this.pending = undefined;
      this.noteIdx = 0; this.noteLeft = 0; this.step = 0;
      this.nextTime = t + 0.1;
      if (this.mode !== 'none') this.gain.gain.setTargetAtTime(1, t, 1.2);
    }
    if (this.mode === 'none') return;
    const cfg = this.mode === 'battle'
      ? { tune: BATTLE_TUNE, eighth: 0.16, chords: [38, 38, 41, 36], bar: 8, drums: true, lead: 'sawtooth', leadGain: 0.05 }
      : this.mode === 'tavern'
        ? { tune: TAVERN_TUNE, eighth: 0.17, chords: [43, 43, 48, 50], bar: 6, drums: 'bodhran', lead: 'square', leadGain: 0.035 }
        : { tune: SAIL_TUNE, eighth: 0.24, chords: SAIL_CHORDS, bar: 6, drums: 'soft', lead: 'sawtooth', leadGain: 0.04 };
    while (this.nextTime < t + 0.3) {
      const time = this.nextTime;
      // lead line
      if (this.noteLeft <= 0) {
        const [n, len] = cfg.tune[this.noteIdx % cfg.tune.length];
        this.noteIdx++;
        this.noteLeft = len;
        this.fiddle(midi(n), len * cfg.eighth * 0.95, time, cfg.lead, cfg.leadGain);
      }
      this.noteLeft--;
      // bar-level accompaniment
      if (this.step % cfg.bar === 0) {
        const bar = Math.floor(this.step / cfg.bar);
        const root = cfg.chords[bar % cfg.chords.length];
        this.pad(midi(root), midi(root + 7), cfg.eighth * cfg.bar, time);
      }
      if (this.step % 3 === 0 || cfg.bar === 8) {
        const bar = Math.floor(this.step / cfg.bar);
        const root = cfg.chords[bar % cfg.chords.length];
        if (cfg.bar === 8 || this.step % 3 === 0) this.bass(midi(root - 12 + ((this.step % cfg.bar) === 3 ? 7 : 0)), cfg.eighth * 1.5, time);
      }
      if (cfg.drums === true) {
        if (this.step % 2 === 0) this.drum(time, this.step % 4 === 0 ? 1 : 0.6);
        if (this.step % 8 === 6) this.snare(time);
      } else if (cfg.drums === 'bodhran') {
        this.drum(time, this.step % 3 === 0 ? 0.6 : 0.25);
      } else if (cfg.drums === 'soft' && this.step % 6 === 0) {
        this.drum(time, 0.3);
      }
      this.step++;
      this.nextTime += cfg.eighth;
    }
  }

  fiddle(f, dur, time, type, gain) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = type; o2.frequency.value = f * 1.004;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
    const vg = ctx.createGain(); vg.gain.value = f * 0.006;
    vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.03);
    g.gain.setValueAtTime(gain * 0.8, time + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.08);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(this.gain);
    for (const x of [o, o2, vib]) { x.start(time); x.stop(time + dur + 0.1); }
  }

  pad(f1, f2, dur, time) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.022, time + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    lp.connect(g).connect(this.gain);
    for (const f of [f1, f2, f1 * 2]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
      o.connect(lp); o.start(time); o.stop(time + dur + 0.05);
    }
  }

  bass(f, dur, time) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.09, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g).connect(this.gain);
    o.start(time); o.stop(time + dur + 0.05);
  }

  drum(time, v) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, time); o.frequency.exponentialRampToValueAtTime(45, time + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.25 * v, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
    o.connect(g).connect(this.gain);
    o.start(time); o.stop(time + 0.35);
  }

  snare(time) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.a.white;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.12, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    src.connect(f).connect(g).connect(this.gain);
    src.start(time, Math.random(), 0.2);
  }
}
