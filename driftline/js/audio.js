// Procedural Web Audio sound engine: engine, tires, wind, nitro, siren, impacts and UI cues.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.muted = false;
    this.ready = false;
  }

  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // iPhone: play game sound even when the ring/silent switch is on
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.master);
    this.loops = ctx.createGain(); this.loops.gain.value = 0; this.loops.connect(this.master);

    // white noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.engine = this._makeEngine(this.loops, 1.0);
    this.opp = this._makeEngine(this.loops, 0.5, true);
    this.tire = this._noiseVoice('bandpass', 1800, 2.5, this.loops);
    this.wind = this._noiseVoice('lowpass', 600, 0.7, this.loops);
    this.nitroV = this._noiseVoice('bandpass', 900, 1.2, this.loops);
    this.scrape = this._noiseVoice('bandpass', 3200, 3, this.loops);
    this.rain = this._noiseVoice('highpass', 2500, 0.5, this.loops);
    this.siren = this._makeSiren(this.loops);
    this.ready = true;
    this.resume();
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05); }
  toggleMute() { this.muted = !this.muted; this.setVolume(this.volume); return this.muted; }

  /** fade continuous loops in/out (race vs menus) */
  setRaceAudio(on) {
    if (!this.ctx) return;
    this.loops.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, on ? 0.3 : 0.15);
  }

  _makeEngine(dest, level, simple = false) {
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = 0;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 800; filt.Q.value = 3;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.4); }
    shaper.curve = curve;
    const am = ctx.createGain(); am.gain.value = 0.75;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const o3 = ctx.createOscillator(); o3.type = 'sawtooth';
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = simple ? 0.2 : 0.35;
    const g3 = ctx.createGain(); g3.gain.value = simple ? 0 : 0.18;
    o1.connect(g1).connect(shaper); o2.connect(g2).connect(shaper); o3.connect(g3).connect(shaper);
    shaper.connect(am).connect(filt).connect(out).connect(dest);
    // firing-rate amplitude modulation for a lumpy V8 burble
    const lfo = ctx.createOscillator(); lfo.type = 'sine';
    const lfoG = ctx.createGain(); lfoG.gain.value = simple ? 0.1 : 0.28;
    lfo.connect(lfoG).connect(am.gain);
    let pan = null;
    if (simple && ctx.createStereoPanner) { pan = ctx.createStereoPanner(); out.disconnect(); out.connect(pan).connect(dest); }
    [o1, o2, o3, lfo].forEach(o => o.start());
    return { o1, o2, o3, lfo, filt, out, level, pan };
  }

  _noiseVoice(type, freq, q, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(dest);
    src.start(0, Math.random() * 1.5);
    return { src, f, g };
  }

  _makeSiren(dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 900;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 900;
    const g2 = ctx.createGain(); g2.gain.value = 0.15;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.42;
    const lfoG = ctx.createGain(); lfoG.gain.value = 380;
    lfo.connect(lfoG); lfoG.connect(o.frequency); lfoG.connect(o2.frequency);
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.connect(g); o2.connect(g2).connect(g);
    if (pan) g.connect(pan).connect(dest); else g.connect(dest);
    [o, o2, lfo].forEach(x => x.start());
    return { o, g, pan };
  }

  /** called every frame with the player's state */
  update(s) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, k = 0.035;
    const e = this.engine;
    const rpm = s.rpm;
    const f0 = 36 + rpm * 150;
    e.o1.frequency.setTargetAtTime(f0, t, k);
    e.o2.frequency.setTargetAtTime(f0 * 0.5, t, k);
    e.o3.frequency.setTargetAtTime(f0 * 2.01, t, k);
    e.lfo.frequency.setTargetAtTime(f0 * 0.5, t, k);
    e.filt.frequency.setTargetAtTime(380 + s.throttle * 1900 + rpm * 1600 + (s.boost ? 900 : 0), t, k);
    const eg = s.engineOn ? (0.085 + s.throttle * 0.13 + rpm * 0.05) * (s.shiftCut > 0 ? 0.35 : 1) : 0;
    e.out.gain.setTargetAtTime(eg, t, s.shiftCut > 0 ? 0.01 : 0.05);

    this.tire.g.gain.setTargetAtTime(Math.min(0.28, s.slip * 0.32), t, 0.05);
    this.tire.f.frequency.setTargetAtTime(1300 + s.slip * 900 + Math.sin(t * 13) * 120, t, 0.05);
    const sp = s.speed / 90;
    this.wind.g.gain.setTargetAtTime(Math.min(0.2, sp * sp * 0.22), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + sp * 900, t, 0.1);
    this.nitroV.g.gain.setTargetAtTime(s.boost ? 0.16 : 0, t, s.boost ? 0.04 : 0.15);
    this.nitroV.f.frequency.setTargetAtTime(s.boost ? 1300 : 700, t, 0.3);
    this.scrape.g.gain.setTargetAtTime(Math.min(0.22, s.scrape * 0.02), t, 0.03);
    this.rain.g.gain.setTargetAtTime(s.rain ? 0.035 : 0, t, 0.5);

    // nearest opponent engine
    const o = this.opp;
    const of = 36 + (s.oppRpm || 0.5) * 150;
    o.o1.frequency.setTargetAtTime(of * (s.oppDoppler || 1), t, 0.06);
    o.o2.frequency.setTargetAtTime(of * 0.5 * (s.oppDoppler || 1), t, 0.06);
    o.lfo.frequency.setTargetAtTime(of * 0.5, t, 0.06);
    o.filt.frequency.setTargetAtTime(700 + (s.oppRpm || 0) * 1200, t, 0.06);
    o.out.gain.setTargetAtTime((s.oppLevel || 0) * 0.09, t, 0.08);
    if (o.pan) o.pan.pan.setTargetAtTime(s.oppPan || 0, t, 0.08);

    this.siren.g.gain.setTargetAtTime((s.siren || 0) * 0.07, t, 0.1);
    if (this.siren.pan) this.siren.pan.pan.setTargetAtTime(s.sirenPan || 0, t, 0.1);
  }

  // ------------------------------------------------------------ one-shots
  _env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  tone(freq, dur = 0.15, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    this._env(g, t, 0.008, vol, dur);
    o.connect(g).connect(this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noiseBurst(dur, type, freq, vol, q = 1, slideTo = null, delay = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    this._env(g, t, 0.005, vol, dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  click() { this.tone(1200, 0.05, 'square', 0.05, 900); }
  hover() { this.tone(2400, 0.03, 'sine', 0.025); }
  countdown() { this.tone(520, 0.22, 'square', 0.12); }
  go() { this.tone(1040, 0.5, 'square', 0.14); this.tone(1560, 0.5, 'sine', 0.08); }
  shift() { this.noiseBurst(0.08, 'bandpass', 500, 0.12, 2); }
  backfire() { this.noiseBurst(0.06, 'lowpass', 900, 0.25, 1); this.tone(70, 0.08, 'square', 0.12, 40); }
  crash(intensity) {
    const v = Math.min(0.6, 0.12 + intensity * 0.03);
    this.noiseBurst(0.35, 'lowpass', 1400, v, 0.7, 200);
    this.tone(90, 0.3, 'sine', v * 0.9, 40);
    if (intensity > 10) this.noiseBurst(0.5, 'highpass', 3000, v * 0.4, 0.5);
  }
  nearMiss() { this.noiseBurst(0.35, 'bandpass', 600, 0.22, 1.5, 3000); }
  nitroStart() { this.noiseBurst(0.6, 'bandpass', 300, 0.3, 0.8, 2400); this.tone(60, 0.4, 'sawtooth', 0.12, 120); }
  nitroFull() { this.tone(880, 0.12, 'sine', 0.1); this.tone(1320, 0.18, 'sine', 0.1, null, 0.08); }
  driftBank() { this.tone(988, 0.1, 'triangle', 0.1); this.tone(1480, 0.2, 'triangle', 0.1, null, 0.07); }
  lap() { [660, 880, 1100].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.12, null, i * 0.09)); }
  finish() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.35, 'square', 0.08, null, i * 0.11)); }
  busted() { [440, 330, 220].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.12, null, i * 0.22)); }
  escaped() { [523, 784, 1046].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.12, null, i * 0.1)); }
  heatUp() { this.tone(300, 0.25, 'sawtooth', 0.08, 600); }
}
