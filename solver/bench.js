/* A station: one circuit, its parts' thermal state, and the record of what
 * died. This is the object the UI talks to - it owns the clock, so the
 * renderer only has to say "advance by this frame's dt" and read values back.
 */

import { Circuit } from './mna.js';
import { Thermal, describe } from './thermal.js';

export class Bench {
  constructor({ circuit = new Circuit(), ambient } = {}) {
    this.ckt = circuit;
    this.thermal = new Thermal(ambient);
    this.t = 0;
    this.failures = [];
    this.onFailure = null;
  }

  /** Advance by dt seconds, in substeps no larger than hMax. */
  advance(dt, hMax = 1e-4) {
    const n = Math.max(1, Math.ceil(dt / hMax));
    const h = dt / n;
    if (this.t === 0) this.ckt._solveIC();
    for (let i = 0; i < n; i++) {
      this.t += h;
      this.ckt.step(this.t, h);
      /* A hook on the substep, not the frame.
       *
       * Some state has to be integrated at the solver's own rate rather than
       * the renderer's: fatigue is the case that forces it, because damage
       * accumulates per CYCLE and a beam at 193 Hz goes through three cycles
       * between two frames. Doing it per frame would make the damage rate
       * depend on the viewer's refresh, which is not a property of steel. */
      this.onStep?.(this.t, h);
      const dead = this.thermal.step(this.ckt.elements, h);
      for (const f of dead) {
        this.failures.push({ ...f, t: this.t });
        if (this.onFailure) this.onFailure(f);
      }
    }
  }

  get alive() { return !this.ckt.elements.some((e) => e.failed); }
  temperature(el) { return this.thermal.of(el).T; }
  report() { return this.failures.map(describe); }
}
