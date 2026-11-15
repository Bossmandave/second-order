/* Station sound, synthesised. No files.
 *
 * The wake fade is the moment the whole mechanic rests on, and silent it
 * still reads as a UI state change rather than as a machine coming up. What
 * sells it is the order of events: a contactor clack, then a tube striking
 * twice, then the mains hum settling in behind. That sequence is recognisable
 * to anyone who has switched on an old bench, and it is about forty lines of
 * oscillators - far less trouble than sourcing, licensing and shipping audio
 * files, and it costs nothing in payload.
 *
 * Everything is gated behind the first gesture because browsers will not
 * start an AudioContext before one.
 */

export class Hum {
  constructor() {
    this.ctx = null;
    this.ready = false;
    const unlock = () => { this._init(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  _init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    const ctx = this.ctx;

    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 420;
    this.bus.connect(tone).connect(ctx.destination);

    // Mains hum: the fundamental plus the third harmonic, which is what makes
    // a transformer sound like iron rather than like a sine wave.
    for (const [f, g] of [[50, 0.5], [100, 0.26], [150, 0.1]]) {
      const o = ctx.createOscillator();
      const gn = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      gn.gain.value = g;
      o.connect(gn).connect(this.bus);
      o.start();
    }
    this.ready = true;
  }

  /** Follow a station's wake level, 0..1. */
  level(v) {
    if (!this.ready) return;
    this.bus.gain.setTargetAtTime(v * 0.05, this.ctx.currentTime, 0.25);
  }

  /** The contactor, then the tube striking. Called once as a station wakes. */
  strike() {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    this._clack(t0, 0.22);
    this._clack(t0 + 0.19, 0.08);
    this._clack(t0 + 0.34, 0.05);
  }

  _clack(at, amp) {
    const ctx = this.ctx;
    // short burst of filtered noise: a click with body, not a tick
    const n = ctx.createBufferSource();
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    n.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    n.connect(bp).connect(g).connect(ctx.destination);
    n.start(at); n.stop(at + 0.08);
  }
}
