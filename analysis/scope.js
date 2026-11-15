/* Traces.
 *
 * The solver runs at tens of thousands of steps a second and the panel is a
 * few hundred pixels wide, so something has to throw samples away. Sampling
 * every nth value is the obvious choice and it is the one that ruins this
 * particular piece: the event worth seeing is almost always a single short
 * spike, and point sampling walks straight past it. The trace then looks calm
 * right up to the failure marker and the forensics underneath appear to be
 * describing a different circuit.
 *
 * So each pixel column keeps the MINIMUM and MAXIMUM of everything that fell
 * in it and is drawn as a vertical span. Nothing is lost, whatever the ratio.
 *
 * The time base doubles when the window fills, merging column pairs as it
 * goes. The whole history stays on screen at constant memory, and because
 * merging min/max pairs is exact, the spike survives every doubling.
 */

export class Trace {
  constructor(columns = 600, window = 0.02) {
    this.n = columns;
    this.window = window;
    this.min = new Float64Array(columns).fill(Infinity);
    this.max = new Float64Array(columns).fill(-Infinity);
    this.used = 0;
    this.t = 0;
  }

  reset(window = this.window) {
    this.window = window;
    this.min.fill(Infinity);
    this.max.fill(-Infinity);
    this.used = 0;
    this.t = 0;
  }

  push(t, v) {
    if (!Number.isFinite(v)) return;
    while (t >= this.window) this._stretch();
    const i = Math.min(this.n - 1, Math.floor((t / this.window) * this.n));
    if (v < this.min[i]) this.min[i] = v;
    if (v > this.max[i]) this.max[i] = v;
    this.used = Math.max(this.used, i + 1);
    this.t = t;
  }

  /** Double the time base, merging column pairs. Exact for min/max. */
  _stretch() {
    const { min, max, n } = this;
    for (let i = 0; i < n / 2; i++) {
      min[i] = Math.min(min[2 * i], min[2 * i + 1]);
      max[i] = Math.max(max[2 * i], max[2 * i + 1]);
    }
    min.fill(Infinity, n / 2);
    max.fill(-Infinity, n / 2);
    this.used = Math.ceil(this.used / 2);
    this.window *= 2;
  }

  range() {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < this.used; i++) {
      if (this.min[i] < lo) lo = this.min[i];
      if (this.max[i] > hi) hi = this.max[i];
    }
    if (!Number.isFinite(lo)) return [-1, 1];
    if (hi - lo < 1e-12) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }
}

/** A phase-plane path, decimated by distance so curvature survives. */
export class PhasePath {
  constructor(limit = 4000) { this.pts = []; this.limit = limit; }
  reset() { this.pts.length = 0; }
  push(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const last = this.pts[this.pts.length - 1];
    if (last) {
      // skip points that add nothing; keeps the path cheap without
      // straightening the tight part of the spiral, which is the bit worth
      // looking at
      const sx = this._sx || 1, sy = this._sy || 1;
      const dx = (x - last[0]) / sx, dy = (y - last[1]) / sy;
      if (dx * dx + dy * dy < 1e-6) return;
    }
    this.pts.push([x, y]);
    if (this.pts.length > this.limit) this.pts.splice(0, this.limit / 4);
  }
  bounds() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of this.pts) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!Number.isFinite(x0)) return [-1, 1, -1, 1];
    const px = Math.max((x1 - x0) * 0.1, 1e-9), py = Math.max((y1 - y0) * 0.1, 1e-9);
    this._sx = x1 - x0 || 1; this._sy = y1 - y0 || 1;
    return [x0 - px, x1 + px, y0 - py, y1 + py];
  }
}
