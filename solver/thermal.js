/* Heating and failure.
 *
 * The thermal model is a single lump per part: power in, heat out to ambient
 * through one thermal resistance, with one time constant.
 *
 *     T_inf = Tamb + P*theta          where it ends up
 *     dT/dt = (T_inf - T) / tau       how fast it gets there
 *
 * One lump is crude - a real part has a junction, a case and a board, each
 * with its own path - but the single time constant buys the one behaviour the
 * whole piece depends on: that a brief overload is survivable and a sustained
 * one is not. Without it, failure is a threshold and there is nothing to
 * decide; with it, you can watch the curve climb and back off the knob.
 *
 * Integrated with the exact exponential rather than Euler, so the step size
 * can be the renderer's frame time without the temperature drifting.
 */

import { AMBIENT } from './parts.js';

export class Thermal {
  constructor(ambient = AMBIENT) {
    this.ambient = ambient;
    this.state = new Map();      // element -> { T, peakT, i2t, elapsed }
  }

  of(el) {
    let s = this.state.get(el);
    if (!s) {
      s = { T: this.ambient, peakT: this.ambient, i2t: 0, elapsed: 0 };
      this.state.set(el, s);
    }
    return s;
  }

  reset() { this.state.clear(); }

  /**
   * Advance every part by h seconds and fail whatever has run out of margin.
   * Returns the forensic records of anything that died this step.
   */
  step(elements, h) {
    const dead = [];
    for (const el of elements) {
      const spec = el.spec;
      if (!spec) continue;
      const s = this.of(el);
      s.elapsed += h;

      if (!el.failed) {
        const P = Math.abs(el.v * el.i);
        if (spec.theta != null) {
          const Tinf = this.ambient + P * spec.theta;
          s.T = Tinf + (s.T - Tinf) * Math.exp(-h / spec.tau);
          s.peakT = Math.max(s.peakT, s.T);
          el._T = s.T;        // so a probe can plot it
        }
        if (spec.iRated != null) {
          const over = el.i * el.i - spec.iRated * spec.iRated;
          if (over > 0) s.i2t += over * h;
        }

        const why = this._verdict(el, spec, s, P);
        if (why) {
          el.failed = { mode: spec.mode, ...why };
          dead.push(this.forensics(el, spec, s, P, why));
        }
      }
    }
    return dead;
  }

  /** What killed it, if anything. Order matters: the fastest mechanism wins. */
  _verdict(el, spec, s, P) {
    if (spec.iMax != null && Math.abs(el.i) > spec.iMax)
      return { cause: 'overcurrent', at: s.elapsed, value: Math.abs(el.i), limit: spec.iMax, unit: 'A' };
    if (spec.vRev != null && -el.v > spec.vRev)
      return { cause: 'reverse voltage', at: s.elapsed, value: -el.v, limit: spec.vRev, unit: 'V' };
    if (spec.vMax != null && Math.abs(el.v) > spec.vMax)
      return { cause: 'overvoltage', at: s.elapsed, value: Math.abs(el.v), limit: spec.vMax, unit: 'V' };
    if (spec.i2t != null && s.i2t > spec.i2t)
      return { cause: 'I²t exceeded', at: s.elapsed, value: s.i2t, limit: spec.i2t, unit: 'A²s' };
    if (spec.tMax != null && s.T > spec.tMax)
      return { cause: 'overheated', at: s.elapsed, value: s.T, limit: spec.tMax, unit: '°C' };
    if (spec.xMax != null && Math.abs(el.x ?? 0) > spec.xMax)
      return { cause: 'travel exceeded', at: s.elapsed, value: Math.abs(el.x), limit: spec.xMax, unit: 'm' };
    if (spec.fMax != null && Math.abs(el.f ?? 0) > spec.fMax)
      return { cause: 'overload', at: s.elapsed, value: Math.abs(el.f), limit: spec.fMax, unit: 'N' };
    if (spec.sigMax != null && Math.abs(el.sigma ?? 0) > spec.sigMax)
      return { cause: 'yielded', at: s.elapsed, value: Math.abs(el.sigma) / 1e6,
               limit: spec.sigMax / 1e6, unit: 'MPa' };
    /* Fatigue is the odd one out: everything else here is a threshold you
     * are either over or under, and this is a running total. A beam can sit
     * at half its yield stress all day and still crack, which is the whole
     * reason resonance is dangerous in the field - the failures are not one
     * big swing, they are ten million small ones. el.damage is Miner's sum;
     * the part owns the arithmetic, this only reads the verdict. */
    if (spec.dMax != null && (el.damage ?? 0) > spec.dMax)
      return { cause: 'fatigue crack', at: s.elapsed, value: el.damage,
               limit: spec.dMax, unit: 'of life' };
    return null;
  }

  /** The autopsy card: everything the analysis panel needs, already computed. */
  forensics(el, spec, s, P, why) {
    return {
      part: spec.label,
      ref: el.ref ?? el.type,
      cause: why.cause,
      mode: spec.mode,
      value: why.value,
      limit: why.limit,
      unit: why.unit,
      // For a thermal death the interesting ratio is the power it was asked
      // to dissipate against its rating, not temperature against temperature
      // - the latter is always 100% by definition, since that is the threshold
      // that just tripped. "312 degC of a 155 degC part" says what happened;
      // "200% of rating" says why.
      overBy: why.cause === 'overheated' && spec.pMax
        ? P / spec.pMax
        : (why.limit ? why.value / why.limit : null),
      dissipated: P,
      pMax: spec.pMax ?? null,
      peakT: spec.theta != null ? s.peakT : null,
      tMax: spec.tMax ?? null,
      survived: s.elapsed,
    };
  }
}

/** One line of plain English, for the panel and for the console. */
export function describe(f) {
  const over = f.overBy ? ` (${(f.overBy * 100).toFixed(0)}% of rating)` : '';
  const heat = f.peakT != null ? `, peaked at ${f.peakT.toFixed(0)}°C of ${f.tMax}°C` : '';
  return `${f.ref} — ${f.part}: ${f.cause} at ${f.value.toPrecision(3)} ${f.unit}${over}${heat}. `
       + `Survived ${f.survived.toFixed(2)} s, failed ${f.mode}.`;
}
