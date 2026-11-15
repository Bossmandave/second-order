/* Modified nodal analysis with trapezoidal integration.
 *
 * Second-order systems are the whole point of this project, so the integrator
 * matters more than usual. Backward Euler is unconditionally stable and would
 * never blow up, but it is also artificially lossy: it damps an undamped LC
 * tank that should ring forever, which would quietly falsify the one thing the
 * piece exists to show. Trapezoidal is second-order accurate and energy-
 * neutral on a lossless element, so an undamped oscillator keeps its amplitude.
 *
 * The cost is trapezoidal ringing on a step into a stiff node. For the fixed
 * set of circuits here that has not shown up; if it ever does the fix is to
 * start each step with a half-step of backward Euler (the standard TR-BDF2
 * dodge) rather than to abandon trapezoidal and lose the physics.
 *
 * Node 0 is ground and carries no unknown. Unknowns are laid out as
 * [v1..vN, i_through_each_voltage_source].
 */

import { solve, zeros, zeroMatrix } from './linalg.js';

const VT = 0.025852;          // kT/q at 300K

export class Circuit {
  constructor() {
    this.elements = [];
    this.nodeCount = 0;       // highest node index seen; ground excluded below
  }

  add(el) {
    this.elements.push(el);
    this.nodeCount = Math.max(this.nodeCount, el.n1 | 0, el.n2 | 0);
    return el;
  }

  // ---- element constructors -------------------------------------------
  /* R_MIN exists because a resistor of zero ohms is not a resistor, it is a
   * wire, and 1/0 stamped into the conductance matrix poisons the whole
   * solution with NaN. It surfaced through the mechanical rig, where the
   * damping lever legitimately reaches zero: an undamped mass-spring is a
   * perfectly sensible machine to ask for, and it should ring forever rather
   * than return nothing. A microhm is far below anything the rest of the
   * bench can resolve, so nothing visible changes, and no caller can hand us
   * a short by accident again. */
  static R_MIN = 1e-6;

  R(n1, n2, ohms, opts = {}) {
    const el = this.add({ type: 'R', n1, n2, value: Math.max(Circuit.R_MIN, ohms), ...opts });
    Object.defineProperty(el, 'value', {
      get() { return this._r; },
      set(v) { this._r = Math.max(Circuit.R_MIN, v); },
      enumerable: true, configurable: true,
    });
    el.value = Math.max(Circuit.R_MIN, ohms);
    return el;
  }
  C(n1, n2, farads, opts = {}){ return this.add({ type: 'C', n1, n2, value: farads, v: opts.ic ?? 0, i: 0, ...opts }); }
  L(n1, n2, henries, opts = {}){ return this.add({ type: 'L', n1, n2, value: henries, v: 0, i: opts.ic ?? 0, ...opts }); }
  V(n1, n2, volts, opts = {}) { return this.add({ type: 'V', n1, n2, value: volts, i: 0, ...opts }); }
  D(n1, n2, opts = {})        { return this.add({ type: 'D', n1, n2, Is: opts.Is ?? 1e-14, N: opts.N ?? 1, v: 0, i: 0, ...opts }); }

  /** Source value at time t: a number, or a function of t. */
  static _src(el, t) { return typeof el.value === 'function' ? el.value(t) : el.value; }

  get size() {
    const vsrc = this.elements.filter((e) => e.type === 'V').length;
    return this.nodeCount + vsrc;
  }

  /** Build and solve one timestep. h = 0 means a DC operating point. */
  step(t, h) {
    const n = this.nodeCount;
    const vs = this.elements.filter((e) => e.type === 'V');
    const size = n + vs.length;
    const nonlinear = this.elements.some((e) => e.type === 'D');

    // Newton-Raphson. A linear circuit converges on the first pass; the loop
    // only turns more than once when a diode is present.
    let x = this._lastX ? this._lastX.slice() : zeros(size);
    const maxIter = nonlinear ? 100 : 1;

    for (let iter = 0; iter < maxIter; iter++) {
      const A = zeroMatrix(size);
      const b = zeros(size);
      const V = (k) => (k === 0 ? 0 : x[k - 1]);   // node voltage from the guess

      const stampG = (n1, n2, g) => {
        if (n1) A[n1 - 1][n1 - 1] += g;
        if (n2) A[n2 - 1][n2 - 1] += g;
        if (n1 && n2) { A[n1 - 1][n2 - 1] -= g; A[n2 - 1][n1 - 1] -= g; }
      };
      // a current source of `amps` flowing n1 -> n2 through the element
      const stampI = (n1, n2, amps) => {
        if (n1) b[n1 - 1] -= amps;
        if (n2) b[n2 - 1] += amps;
      };

      // gmin: a vanishing conductance from every node to ground. Standard
      // SPICE practice, and here it is what stops a node whose only other
      // path has just burned open from floating off to a junk voltage.
      for (let j = 0; j < n; j++) A[j][j] += 1e-12;

      let k = 0;
      for (const el of this.elements) {
        // A failed part is still in the circuit, just not doing its job. Open
        // gets a tiny conductance rather than nothing at all: removing it
        // outright can leave a node with no path to ground, and the matrix
        // goes singular on a part that in reality just stopped conducting.
        /* A part that has taken a permanent set has NOT stopped working - a
         * yielded spring still pushes, it just no longer returns to its free
         * length. Treating every failure as an open circuit sent the
         * mechanical rig to 138 metres of travel in a tenth of a second. */
        if (el.failed && el.failed.mode !== 'set') {
          if (el.type !== 'V') {
            // 1 GOhm rather than a true open. An inductor carrying current
            // into a genuinely open branch produces an unbounded voltage -
            // which is real (that is what an arc is) but useless on a screen,
            // and it pins the node at a nonsense value forever.
            stampG(el.n1, el.n2, el.failed.mode === 'short' ? 1e6 : 1e-9);
            continue;
          }
        }
        switch (el.type) {
          case 'R':
            stampG(el.n1, el.n2, 1 / el.value);
            break;

          case 'C': {
            // i = Geq*v - Ieq   (trapezoidal companion)
            if (h > 0) {
              const Geq = (2 * el.value) / h;
              const Ieq = Geq * el.v + el.i;
              stampG(el.n1, el.n2, Geq);
              stampI(el.n1, el.n2, -Ieq);
            }
            // h == 0: open circuit at DC, so nothing is stamped
            break;
          }

          case 'L': {
            if (h > 0) {
              // i = Geq*v + Ieq
              const Geq = h / (2 * el.value);
              const Ieq = el.i + Geq * el.v;
              stampG(el.n1, el.n2, Geq);
              stampI(el.n1, el.n2, Ieq);
            } else {
              stampG(el.n1, el.n2, 1e9);   // short at DC
            }
            break;
          }

          case 'D': {
            /* Shockley, linearised about the current guess.
             *
             * The guess has to be limited or exp() overflows long before
             * Newton would have settled. A flat clamp is the obvious way and
             * it is wrong: it caps the forward voltage, so a part whose real
             * drop is above the clamp - an LED at 1.9 V, say - can never be
             * solved and simply reports no current. This is SPICE's pnjlim:
             * it limits how far one iteration may move once past the critical
             * voltage, logarithmically, rather than limiting where it may end
             * up. Convergence is bounded; the answer is not. */
            const vt = el.N * VT;
            const vcrit = vt * Math.log(vt / (Math.SQRT2 * el.Is));
            let v = V(el.n1) - V(el.n2);
            const vold = el._vold ?? 0;
            if (v > vcrit && Math.abs(v - vold) > 2 * vt) {
              if (vold > 0) {
                const arg = 1 + (v - vold) / vt;
                v = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
              } else {
                v = vt * Math.log(v / vt);
              }
            }
            v = Math.max(-80 * vt, v);
            el._vold = v;
            const e = Math.exp(v / (el.N * VT));
            const i = el.Is * (e - 1);
            const gd = (el.Is / (el.N * VT)) * e + 1e-12;   // +gmin keeps it solvable
            stampG(el.n1, el.n2, gd);
            stampI(el.n1, el.n2, i - gd * v);
            el._v = v; el._i = i;
            break;
          }

          case 'V': {
            const idx = n + k;
            const E = Circuit._src(el, t);
            if (el.n1) { A[el.n1 - 1][idx] += 1; A[idx][el.n1 - 1] += 1; }
            if (el.n2) { A[el.n2 - 1][idx] -= 1; A[idx][el.n2 - 1] -= 1; }
            b[idx] = E;
            el._row = idx;
            k++;
            break;
          }
        }
      }

      const next = solve(A, b);
      if (!next) throw new Error('singular matrix — check for a floating node');

      if (!nonlinear) { x = next; break; }
      let delta = 0;
      for (let i = 0; i < size; i++) delta = Math.max(delta, Math.abs(next[i] - x[i]));
      x = next;
      if (delta < 1e-9) break;
    }

    this._lastX = x;
    this._commit(x, h, n);
    return x;
  }

  /** Record each element's terminal state, which the next step integrates from. */
  _commit(x, h, n) {
    const V = (k) => (k === 0 ? 0 : x[k - 1]);
    for (const el of this.elements) {
      const v = V(el.n1) - V(el.n2);
      if (el.failed && el.failed.mode !== 'set' && el.type !== 'V') {
        el.v = v;
        el.i = el.failed.mode === 'short' ? v * 1e6 : 0;
        continue;
      }
      switch (el.type) {
        case 'R': el.v = v; el.i = v / el.value; break;
        case 'C': {
          if (h > 0) {
            const Geq = (2 * el.value) / h;
            el.i = Geq * v - (Geq * el.v + el.i);
          } else el.i = 0;
          el.v = v;
          break;
        }
        case 'L': {
          if (h > 0) {
            const Geq = h / (2 * el.value);
            el.i = Geq * v + (el.i + Geq * el.v);
          }
          el.v = v;
          break;
        }
        case 'D': el.v = el._v ?? v; el.i = el._i ?? 0; break;
        case 'V': el.v = v; el.i = x[el._row]; break;
      }
    }
  }

  /**
   * Consistent initial conditions.
   *
   * Trapezoidal integration needs each energy-storage element's current AND
   * voltage at t=0, and those are not free to choose independently. A
   * capacitor starting at 0 V across a live 10 V source through 1 k is
   * already passing 10 mA; recording its initial current as zero states that
   * no current flows into an uncharged capacitor being charged, which is
   * false, and trapezoidal carries that error forward instead of damping it
   * out the way backward Euler would hide it.
   *
   * So before the first step, solve the network once with each capacitor held
   * at its initial voltage (a voltage source) and each inductor at its
   * initial current (a current source). That yields the branch currents and
   * node voltages that actually coexist with those stored states.
   */
  _solveIC() {
    const n = this.nodeCount;
    const caps = this.elements.filter((e) => e.type === 'C');
    const vs = this.elements.filter((e) => e.type === 'V');
    const extra = caps.length + vs.length;      // each contributes a current unknown
    const size = n + extra;
    const A = zeroMatrix(size);
    const b = zeros(size);

    const stampG = (n1, n2, g) => {
      if (n1) A[n1 - 1][n1 - 1] += g;
      if (n2) A[n2 - 1][n2 - 1] += g;
      if (n1 && n2) { A[n1 - 1][n2 - 1] -= g; A[n2 - 1][n1 - 1] -= g; }
    };
    const stampI = (n1, n2, amps) => {
      if (n1) b[n1 - 1] -= amps;
      if (n2) b[n2 - 1] += amps;
    };
    const stampE = (n1, n2, idx, E) => {
      if (n1) { A[n1 - 1][idx] += 1; A[idx][n1 - 1] += 1; }
      if (n2) { A[n2 - 1][idx] -= 1; A[idx][n2 - 1] -= 1; }
      b[idx] = E;
    };

    for (let j = 0; j < n; j++) A[j][j] += 1e-12;      // gmin, as above

    let k = 0;
    for (const el of this.elements) {
      if (el.failed && el.failed.mode !== 'set' && el.type !== 'V') { stampG(el.n1, el.n2, el.failed.mode === 'short' ? 1e6 : 1e-12); continue; }
      if (el.type === 'R') stampG(el.n1, el.n2, 1 / el.value);
      else if (el.type === 'L') stampI(el.n1, el.n2, el.i);         // held at its current
      else if (el.type === 'D') stampG(el.n1, el.n2, 1e-9);          // effectively open at t=0
      else if (el.type === 'C') { el._icRow = n + k; stampE(el.n1, el.n2, n + k, el.v); k++; }
      else if (el.type === 'V') { el._icRow = n + k; stampE(el.n1, el.n2, n + k, Circuit._src(el, 0)); k++; }
    }

    const x = solve(A, b);
    if (!x) throw new Error('singular matrix solving initial conditions');

    const V = (j) => (j === 0 ? 0 : x[j - 1]);
    for (const el of this.elements) {
      if (el.type === 'C') el.i = x[el._icRow];        // the current that really flows
      else if (el.type === 'L') el.v = V(el.n1) - V(el.n2);
      else if (el.type === 'R') { el.v = V(el.n1) - V(el.n2); el.i = el.v / el.value; }
    }
    this._lastX = null;
  }

  /**
   * Run a transient analysis, calling back once per step.
   *
   * Starts from each element's initial condition, NOT from the DC operating
   * point. That distinction is the whole difference between watching a
   * capacitor charge and finding it already charged before the first frame:
   * the DC solution of an RC driven by a DC source IS the fully-charged
   * state, so biasing first would skip the only part anyone wants to see.
   * SPICE calls this UIC. Pass dcStart to get the other behaviour.
   */
  transient({ h, tEnd, onStep, dcStart = false }) {
    if (dcStart) this.step(0, 0);
    else this._solveIC();
    const steps = Math.round(tEnd / h);
    for (let s = 1; s <= steps; s++) {
      const t = s * h;
      const x = this.step(t, h);
      if (onStep) onStep(t, x, this);
    }
  }

  node(x, k) { return k === 0 ? 0 : x[k - 1]; }
}
