/* The light pool.
 *
 * The workshop is dark and only the station you are at is lit. That is the
 * look, but it is also the budget: with a fixed number of lights reassigned
 * to whichever stations are nearest, the shader cost is constant no matter
 * how many stations the room grows to. Station nine costs the same as station
 * two. Lighting every station and letting distance attenuation hide the far
 * ones would do the opposite - each addition would make the whole room slower,
 * and WebGL recompiles every material when the light count changes.
 *
 * Only the focused station casts a shadow; there is one shadow map and it
 * moves. Shadows are the single most expensive thing here and nobody is
 * looking at the dark corners.
 */

import * as THREE from '../libs/three.module.js';

export const POOL_SIZE = 3;

export class LightPool {
  constructor(scene) {
    this.slots = [];
    /* Spot lights, not point lights, and the reason is the shadow.
     *
     * A point light's shadow is a CUBE: six depth maps, so every caster is
     * drawn six times, every frame. Measured at 334-596 draw calls a frame,
     * most of them shadow passes into directions where nothing is - straight
     * up at the ceiling, sideways at empty floor.
     *
     * A spot is also the honest fixture. These hang above a bench and point
     * down at it; a point light is a bare bulb radiating everywhere, which is
     * not what the room is pretending to be. And because the cone is aimed at
     * the station, the whole 1024 map lands on what actually casts, instead
     * of a sixth of it going to each face of a sphere.
     */
    for (let i = 0; i < POOL_SIZE; i++) {
      /* Cone angle 1.25 rad (72 deg) with a soft penumbra. Narrower reads
       * as a stage light with a visible edge; this is wide enough that the
       * pool fades out like a bulb's would while the shadow frustum still
       * only covers the station. */
      const l = new THREE.SpotLight(0xffd9a8, 0, 7.5, 1.25, 0.62, 1.5);
      l.castShadow = false;
      scene.add(l);
      scene.add(l.target);
      this.slots.push({ light: l, station: null, level: 0, target: 0 });
    }
    // One shadow caster for the whole room, parked on whatever is focused.
    const s = this.slots[0].light;
    s.castShadow = true;
    s.shadow.mapSize.set(1024, 1024);
    s.shadow.camera.near = 0.3;
    s.shadow.camera.far = 9;
    s.shadow.bias = -0.0015;
    s.shadow.normalBias = 0.02;
    this.shadowSlot = this.slots[0];
  }

  /**
   * Assign slots to the nearest stations and set each one's target level.
   * Called every frame; the assignment only changes when you move far enough
   * for the ranking to change, and a slot being reassigned fades out first.
   */
  update(stations, cameraPos, focused, dt) {
    const ranked = stations
      .map((st) => ({ st, d: st.position.distanceTo(cameraPos) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, POOL_SIZE);

    // keep the focused station in the pool even if you have walked away
    if (focused && !ranked.some((r) => r.st === focused)) {
      ranked[ranked.length - 1] = { st: focused, d: 0 };
    }

    const wanted = new Set(ranked.map((r) => r.st));
    for (const slot of this.slots) {
      if (slot.station && !wanted.has(slot.station)) {
        slot.target = 0;
        if (slot.level < 0.02) slot.station = null;   // only release once dark
      }
    }
    for (const { st } of ranked) {
      if (this.slots.some((s) => s.station === st)) continue;
      const free = this.slots.find((s) => !s.station);
      if (free) { free.station = st; free.light.position.copy(st.lampPosition); free.light.target.position.copy(st.position); }
    }

    for (const slot of this.slots) {
      const st = slot.station;
      if (st) slot.target = st.wake;
      // ~0.75 s to come up, which is the whole point: a hard switch feels
      // like a UI toggle, a fade feels like something waking up
      const k = 1 - Math.exp(-dt / 0.26);
      slot.level += (slot.target - slot.level) * k;
      slot.light.intensity = slot.level * (st?.lampPower ?? 9);
      if (st) {
        slot.light.position.copy(st.lampPosition);
        // aim a little below the station's origin, where the work is
        slot.light.target.position.set(st.position.x, st.position.y + 0.55, st.position.z);
        slot.light.target.updateMatrixWorld();
      }
    }

    // park the shadow on whatever is focused and brightest
    if (focused) {
      const holder = this.slots.find((s) => s.station === focused);
      if (holder && holder !== this.shadowSlot) this._moveShadow(holder);
    }
  }

  _moveShadow(to) {
    this.shadowSlot.light.castShadow = false;
    const src = this.shadowSlot.light.shadow;
    to.light.castShadow = true;
    to.light.shadow.mapSize.copy(src.mapSize);
    to.light.shadow.camera.near = src.camera.near;
    to.light.shadow.camera.far = src.camera.far;
    to.light.shadow.focus = 1;
    to.light.shadow.bias = src.bias;
    to.light.shadow.normalBias = src.normalBias;
    this.shadowSlot = to;
  }
}
