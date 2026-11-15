/* A beam with a spectrum.
 *
 * The rig across the room has one resonance. A real body has many, and each
 * one moves it in a different SHAPE - which is the thing a graph cannot show
 * you and a room can.
 *
 * The trick that makes this cheap is modal decomposition. In modal
 * coordinates the modes do not talk to each other: each one is an
 * independent second-order system
 *
 *     m_i q_i'' + c_i q_i' + k_i q_i = phi_i(x_drive) * F(t)
 *
 * and the deflection anywhere on the beam is just the sum of the mode shapes
 * weighted by their coordinates:
 *
 *     w(x,t) = SUM phi_i(x) q_i(t)
 *
 * So this is N copies of the mass-spring rig, in one circuit, sharing a
 * ground - N series RLC loops, block diagonal, no new solver machinery at
 * all. The same force-voltage analogy as mechanical.js: L is modal mass, R
 * is modal damping, C is one over modal stiffness, and the source is the
 * force the mode actually feels, which is the applied force scaled by the
 * mode shape AT THE POINT YOU PUSH. That last factor is where the physics
 * gets interesting: push on a node of a mode and phi_i is zero, so the mode
 * cannot be excited at all, however hard you drive it.
 *
 * Simply supported, so the mode shapes are pure sines and the nodes land on
 * exact fractions of the span. A cantilever's eigenfunctions are messier and
 * its nodes sit at irrational positions; sines make "the middle is standing
 * still" something you can see and point at.
 */

import { Circuit } from './mna.js';

const PI = Math.PI;

export class Beam {
  /**
   * @param {object} o
   * @param {number} o.L     span, m
   * @param {number} o.b     width, m
   * @param {number} o.h     thickness, m
   * @param {number} o.E     Young's modulus, Pa
   * @param {number} o.rho   density, kg/m^3
   * @param {number} o.modes how many modes to carry
   * @param {number} o.zeta  damping ratio, same for every mode
   * @param {number} o.drive fraction of the span the shaker sits at, 0..1
   * @param {number} o.force drive amplitude, N
   * @param {number} o.freq  drive frequency, Hz
   */
  constructor({
    L = 0.8, b = 0.04, h = 0.006, E = 200e9, rho = 7850,
    modes = 3, zeta = 0.02, drive = 0.5, force = 0, freq = 20,
  } = {}) {
    Object.assign(this, { L, b, h, E, rho, nModes: modes });

    const A = b * h;
    const I = (b * h ** 3) / 12;
    this.EI = E * I;
    this.mbar = rho * A;                       // mass per unit length
    this.c = Math.sqrt(this.EI / this.mbar);   // wave speed group

    /* Phase is carried, not recomputed from t. The drive frequency is a live
     * control and sin(2*pi*f*t) steps the instant f changes - a step into a
     * high-Q structure rings every mode at once, which looks exactly like
     * the resonance you were hunting for. */
    this.d = { f: freq, A: force, phase0: 0, t0: 0, pos: drive };

    const ckt = new Circuit();
    this.ckt = ckt;
    this.modes = [];

    for (let n = 1; n <= modes; n++) {
      const beta = (n * PI) / L;
      const omega = beta * beta * this.c;        // rad/s; note omega ~ n^2
      const m = (this.mbar * L) / 2;             // modal mass, same for all n
      const k = omega * omega * m;
      const cc = 2 * zeta * Math.sqrt(k * m);

      const a = n * 3;                            // one isolated loop per mode
      const mode = { n, beta, omega, m, k, zeta };
      mode.src = ckt.V(a + 1, 0, (t) => this.modalForce(n, t), { ref: `M${n}` });
      mode.ind = ckt.L(a + 1, a + 2, m);
      mode.res = ckt.R(a + 2, a + 3, cc);
      mode.cap = ckt.C(a + 3, 0, 1 / k);
      this.modes.push(mode);
    }
  }

  /** Mode shape n at fraction u of the span. */
  phi(n, u) { return Math.sin(n * PI * u); }

  /* phi is a CONSTANT. It depends on the mode number and the position, and
   * neither moves - yet the stress and deflection scans were calling
   * Math.sin for every mode at every one of 41 sample points, at every one
   * of 80 solver substeps, every frame. About twenty thousand sines a frame
   * for a table that never changes. These are built once per sample count
   * and reused; on a mid-range phone that was a third of the station's
   * entire CPU budget spent recomputing the same numbers. */
  _shapes(samples) {
    let t = this._shapeCache?.[samples];
    if (t) return t;
    this._shapeCache = this._shapeCache ?? {};
    t = { phi: [], curv: [] };
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      const row = [], crow = [];
      for (const m of this.modes) {
        const v = Math.sin(m.n * PI * u);
        row.push(v);
        crow.push(-m.beta * m.beta * v);
      }
      t.phi.push(row); t.curv.push(crow);
    }
    this._shapeCache[samples] = t;
    return t;
  }

  /** What mode n actually feels: the force, scaled by the shape where you push. */
  modalForce(n, t) {
    const d = this.d;
    return this.phi(n, d.pos) * d.A
      * Math.sin(d.phase0 + 2 * PI * d.f * (t - d.t0));
  }

  /** Modal coordinate of mode n (metres). */
  q(i) { return this.modes[i].cap.v / this.modes[i].k; }

  /** Deflection at fraction u of the span, metres. */
  w(u) {
    let s = 0;
    for (let i = 0; i < this.modes.length; i++) s += this.phi(i + 1, u) * this.q(i);
    return s;
  }

  /** Curvature at fraction u, 1/m. phi'' = -(n pi / L)^2 sin(n pi u). */
  curvature(u) {
    let s = 0;
    for (let i = 0; i < this.modes.length; i++) {
      const m = this.modes[i];
      s -= m.beta * m.beta * this.phi(m.n, u) * this.q(i);
    }
    return s;
  }

  /** Bending stress at fraction u, Pa. Surface fibre, so h/2 from neutral. */
  stress(u) { return this.E * (this.h / 2) * this.curvature(u); }

  /**
   * Peak stress and where it is.
   *
   * Scanned rather than solved, because with several modes superposed the
   * maximum is not at a nice closed-form place - and WHERE it is matters
   * more here than the number: mode 1 cracks a simply supported beam at
   * mid-span, mode 2 cracks it at the quarter points, so the crack position
   * tells you which mode killed it.
   */
  peakStress(samples = 81) {
    const { curv } = this._shapes(samples);
    const k = this.E * (this.h / 2);
    const q = this._q ?? (this._q = []);
    for (let m = 0; m < this.modes.length; m++) q[m] = this.q(m);
    let best = 0, at = 0.5;
    for (let i = 0; i <= samples; i++) {
      const row = curv[i];
      let c = 0;
      for (let m = 0; m < row.length; m++) c += row[m] * q[m];
      const s = Math.abs(c * k);
      if (s > best) { best = s; at = i / samples; }
    }
    return { sigma: best, at };
  }

  /** Largest deflection anywhere on the span, metres. */
  peakDeflection(samples = 81) {
    const { phi } = this._shapes(samples);
    const q = this._q2 ?? (this._q2 = []);
    for (let m = 0; m < this.modes.length; m++) q[m] = this.q(m);
    let best = 0;
    for (let i = 0; i <= samples; i++) {
      const row = phi[i];
      let v = 0;
      for (let m = 0; m < row.length; m++) v += row[m] * q[m];
      const a = v < 0 ? -v : v;
      if (a > best) best = a;
    }
    return best;
  }

  /** Natural frequencies, Hz. */
  get frequencies() { return this.modes.map((m) => m.omega / (2 * PI)); }

  /** Which mode is carrying the most energy right now, 1-based. */
  get dominant() {
    let best = 0, idx = 1;
    this.modes.forEach((m, i) => {
      const e = Math.abs(this.q(i)) * m.omega;      // modal velocity scale
      if (e > best) { best = e; idx = m.n; }
    });
    return idx;
  }

  /** Change the machine while it is running. */
  tune({ freq, force, pos, zeta }, now = 0) {
    const d = this.d;
    if (freq != null && freq !== d.f) {
      d.phase0 += 2 * PI * d.f * (now - d.t0);
      d.t0 = now;
      d.f = freq;
    }
    if (force != null) d.A = force;
    if (pos != null) d.pos = pos;
    if (zeta != null) {
      for (const m of this.modes) {
        m.zeta = zeta;
        m.res.value = 2 * zeta * Math.sqrt(m.k * m.m);
      }
    }
  }
}

/**
 * Miner's rule, compressed.
 *
 * Real fatigue is millions of cycles and nobody is going to sit here for
 * three weeks, so the S-N curve is scaled to minutes: N0 cycles at yield,
 * and an exponent steep enough that backing the amplitude off genuinely
 * saves the part. The SHAPE is what matters and the shape is right - damage
 * per cycle goes as stress to a high power, so half the stress is not half
 * the damage but a sixty-fourth of it, and a part can sit below its
 * endurance limit indefinitely.
 *
 * Two real effects fall out of this for free, and they are the reason it is
 * worth modelling at all rather than just checking yield:
 *
 *   - a small, quiet high mode can be more destructive than a dramatic low
 *     one, because curvature scales with n^2 for the same deflection;
 *   - and it racks up cycles n^2 times faster, because that is where its
 *     frequency is.
 */
export class Fatigue {
  constructor({ yieldStress, N0 = 120, exponent = 6, endurance = 0.42 } = {}) {
    this.sy = yieldStress;
    this.N0 = N0;
    this.m = exponent;
    this.se = endurance * yieldStress;   // below this, no damage accrues
    this.damage = 0;
    this.cycles = 0;
  }

  /** Accrue damage for h seconds at stress amplitude sigma and frequency f. */
  step(sigma, f, h) {
    if (!(f > 0)) return this.damage;
    this.cycles += f * h;
    if (sigma <= this.se) return this.damage;
    const N = this.N0 * (this.sy / sigma) ** this.m;
    this.damage += (f * h) / N;
    return this.damage;
  }

  reset() { this.damage = 0; this.cycles = 0; }
}
