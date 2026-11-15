/* What overload looks like.
 *
 * Everything here is driven by the solver's own numbers - junction
 * temperature, dissipation, the failure record - rather than triggered by an
 * event. That distinction is the whole reason the piece works: a part that
 * browns gradually as it climbs toward its limit is telling you something
 * while you can still act on it, whereas a part that is fine until it
 * suddenly is not just reports a result.
 */

import * as THREE from '../libs/three.module.js';

/* Incandescence, from the real blackbody curve rather than an art-directed
 * gradient. Nothing visible below about 480 degC - which is why a resistor
 * that chars and fails at 155 degC never glows, and a fuse element at 900
 * does. Getting that threshold from physics means the two look different
 * without anyone deciding they should. */
const GLOW = [
  [480, 0.25, 0.02, 0.00],
  [650, 0.65, 0.12, 0.01],
  [800, 1.00, 0.33, 0.04],
  [1000, 1.00, 0.62, 0.18],
  [1300, 1.00, 0.88, 0.55],
];

export function incandescence(T, out = new THREE.Color()) {
  if (T <= GLOW[0][0]) return out.setRGB(0, 0, 0);
  let a = GLOW[0], b = GLOW[GLOW.length - 1];
  for (let i = 0; i < GLOW.length - 1; i++) {
    if (T >= GLOW[i][0] && T <= GLOW[i + 1][0]) { a = GLOW[i]; b = GLOW[i + 1]; break; }
  }
  const t = Math.min(1, (T - a[0]) / (b[0] - a[0] || 1));
  return out.setRGB(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t);
}

/* Charring. The progression is not linear in temperature: lacquer discolours
 * slowly over a wide band and then the body blackens quickly once it is
 * actually burning, so the curve is squared at the top. */
const CHAR = new THREE.Color(0x100b07);

export function char(mat, base, f) {
  const k = Math.min(1, Math.max(0, f));
  mat.color.copy(base).lerp(CHAR, k * k * 0.55 + k * 0.45);
  mat.roughness = Math.min(1, (mat.userData.baseRough ?? 0.6) + k * 0.35);
}

/** Soft round sprite, generated rather than shipped. */
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

let PUFF = null;

/* Smoke.
 *
 * One Points cloud per station, recycled from a fixed pool. Particles are
 * cheap; allocating them is not, and a part that smokes for thirty seconds
 * would otherwise churn through thousands of objects.
 */
export class Smoke {
  /* `size` is in metres, and it is not cosmetic. The default suits a puff off
   * a quarter-watt resistor seen from 40 cm. The rig is framed from well over
   * two metres away, and at 12 mm a particle lands on about five pixels: the
   * plume was firing correctly, thirty-one particles alive and visible, and
   * nothing whatsoever appeared on screen. Smoke has to be scaled to the
   * machine it comes off, not to the emitter that wrote it. */
  constructor(parent, count = 90, { size = 0.012, rise = 1, opacity = 0.4, color = 0x8d8c8a } = {}) {
    PUFF = PUFF || puffTexture();
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.size = new Float32Array(count);
    this.next = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.PointsMaterial({
      map: PUFF, color, transparent: true, opacity,
      depthWrite: false, blending: THREE.NormalBlending,
      size, sizeAttenuation: true,
    });
    this.rise = rise;
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    parent.add(this.points);
    this.geo = geo;
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -99;
  }

  /** Clear every particle: a replaced card should not keep the old smoke. */
  reset() {
    this.life.fill(0);
    for (let i = 0; i < this.count; i++) this.pos[i * 3 + 1] = -99;
    this._rate = 0;
    this.points.visible = false;
    this.geo.attributes.position.needsUpdate = true;
  }

  emit(local, rate) {
    this._rate = (this._rate ?? 0) + rate;
    while (this._rate >= 1) {
      this._rate -= 1;
      const i = this.next; this.next = (this.next + 1) % this.count;
      this.pos[i * 3] = local.x + (Math.random() - 0.5) * 0.004 * this.rise;
      this.pos[i * 3 + 1] = local.y + 0.003;
      this.pos[i * 3 + 2] = local.z + (Math.random() - 0.5) * 0.004 * this.rise;
      const r = this.rise;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.012 * r;
      this.vel[i * 3 + 1] = (0.018 + Math.random() * 0.022) * r;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.012 * r;
      this.life[i] = 1;
    }
  }

  step(dt) {
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt * 0.33;
      // slows as it rises and spreads, the way a thin plume actually behaves
      this.vel[i * 3 + 1] *= 1 - dt * 0.55;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -99;
    }
    this.points.visible = any;
    if (any) this.geo.attributes.position.needsUpdate = true;
  }
}

/* Thermal view.
 *
 * A false-colour ramp from ambient to the part's own rating, so "hot" means
 * hot FOR THIS PART rather than hot in absolute terms. A 1/4 W resistor at
 * 140 degC is nearly dead; a fuse element at 140 degC is idling. An absolute
 * scale would show those identically and teach the wrong thing.
 */
const THERMAL = [
  [0.0, 0.07, 0.11, 0.26],
  [0.35, 0.10, 0.45, 0.45],
  [0.6, 0.85, 0.80, 0.18],
  [0.85, 0.95, 0.42, 0.06],
  [1.0, 1.00, 0.16, 0.12],
];

export function thermalColour(frac, out = new THREE.Color()) {
  const f = Math.max(0, Math.min(1, frac));
  let a = THERMAL[0], b = THERMAL[THERMAL.length - 1];
  for (let i = 0; i < THERMAL.length - 1; i++) {
    if (f >= THERMAL[i][0] && f <= THERMAL[i + 1][0]) { a = THERMAL[i]; b = THERMAL[i + 1]; break; }
  }
  const t = (f - a[0]) / (b[0] - a[0] || 1);
  return out.setRGB(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t);
}
