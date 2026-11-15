/* A mass-spring-damper, solved by the circuit engine.
 *
 * This file is deliberately thin, because the thesis of the whole project is
 * that there is nothing to implement here:
 *
 *     m·ẍ + c·ẋ + k·x = F(t)          mechanical
 *     L·q̈ + R·q̇ + q/C = V(t)          series RLC
 *
 * Under the force-voltage analogy — m↔L, c↔R, k↔1/C, F↔V, velocity↔current,
 * displacement↔charge — those are one equation. So the rig is not simulated by
 * analogous code; it is a series RLC built with the mechanical numbers, run
 * through the same stepper as every circuit on the bench, and read back with
 * the units swapped.
 *
 * If this ever stops agreeing with the electrical side, the equivalence is
 * broken and the project's central claim with it. test/analogy.test.mjs is
 * what guards that.
 */

import { Circuit } from './mna.js';

export class MassSpringDamper {
  /** @param m kg, @param c N·s/m, @param k N/m, @param force N (number or fn of t) */
  constructor({ m, c, k, force = 0, x0 = 0, v0 = 0 }) {
    this.m = m; this.c = c; this.k = k;

    const ckt = new Circuit();
    ckt.V(1, 0, force);              // force source
    this.ind = ckt.L(1, 2, m, { ic: v0 });   // inertia; its current is velocity
    this.res = ckt.R(2, 3, c);       // damping
    // compliance. Charge is displacement, so the capacitor starts at v = k·x0.
    this.cap = ckt.C(3, 0, 1 / k, { ic: k * x0 });

    this.ckt = ckt;
  }

  /** Natural frequency, rad/s. */
  get omegaN() { return Math.sqrt(this.k / this.m); }
  /** Damping ratio. */
  get zeta() { return this.c / (2 * Math.sqrt(this.k * this.m)); }

  get displacement() { return this.cap.v / this.k; }   // x = q/… ; q = C·v = v/k
  get velocity() { return this.cap.i; }                 // loop current is ẋ

  /* Change the machine while it is running.
   *
   * Every one of these is a physical act you could perform on a real rig, and
   * the state each one must preserve is different:
   *
   *   mass      - bolting on more mass keeps the velocity you already had,
   *               so the inductor keeps its current. Momentum changes; that
   *               is what adding mass to a moving body does.
   *   damping   - the damper is memoryless, so there is nothing to preserve.
   *   stiffness - swapping the spring keeps the DISPLACEMENT, not the force.
   *               Charge is displacement, so q must survive: q = C·v, and
   *               C changes, therefore v must be rewritten as k_new·x_old.
   *               Leaving v alone instead would teleport the mass, which is
   *               exactly the kind of silent nonsense the thermal pass would
   *               then report as a travel failure.
   */
  tune({ m, c, k, force }) {
    if (m != null && m !== this.m) { this.m = m; this.ind.value = m; }
    if (c != null && c !== this.c) { this.c = c; this.res.value = c; }
    if (k != null && k !== this.k) {
      const x = this.displacement;      // read BEFORE k moves
      this.k = k;
      this.cap.value = 1 / k;
      this.cap.v = k * x;               // same displacement, new force
    }
    if (force != null) {
      const src = this.ckt.elements.find((e) => e.type === 'V');
      if (src) src.value = force;
    }
  }

  run({ h, tEnd, onStep }) {
    this.ckt.transient({
      h, tEnd,
      onStep: (t) => onStep && onStep(t, this.displacement, this.velocity),
    });
  }
}
