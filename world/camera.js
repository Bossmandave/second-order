/* Two camera modes.
 *
 * Walk for presence, click to work. They are not alternatives - each is bad
 * at the other's job. Walking to a bench and then trying to read a meter by
 * shuffling is miserable; orbiting a room you are supposed to inhabit feels
 * like inspecting a model.
 *
 * Focusing eases to a fixed working position rather than flying freely,
 * because the instruments have a correct viewing angle and letting people
 * arrive at the wrong one is a worse experience than taking the control away
 * for a second.
 */

import * as THREE from '../libs/three.module.js';
import { BAY } from './bay.js';

const EYE = 1.62, RADIUS = 0.3, SPEED = 2.0;

export class Navigator {
  constructor(camera, dom) {
    this.cam = camera;
    this.dom = dom;
    this.mode = 'walk';
    // yaw 0 looks down -Z, which is where the benches are. Starting at PI
    // faced the back wall: a black screen on load, and no way to tell the
    // room from a failed render.
    this.yaw = 0;
    this.pitch = -0.05;
    this.pos = new THREE.Vector3(0, EYE, 1.75);
    this.keys = new Set();
    this.focus = null;
    this.blend = 0;                 // 0 walking, 1 fully at the station
    this.obstacles = [];
    this._bind();
  }

  _bind() {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Escape') this.release();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));

    let dragging = false, lx = 0, ly = 0;
    const down = (x, y) => { dragging = true; lx = x; ly = y; };
    const move = (x, y) => {
      if (!dragging || this.focus || this.grabbed) return;
      // Touch has no movementX, so deltas are tracked by hand. Using
      // movementX here silently does nothing on a phone.
      this.yaw -= (x - lx) * 0.0032;
      this.pitch = Math.max(-1.1, Math.min(0.9, this.pitch - (y - ly) * 0.0032));
      lx = x; ly = y;
    };
    const up = () => { dragging = false; };

    this.dom.addEventListener('pointerdown', (e) => down(e.clientX, e.clientY));
    addEventListener('pointermove', (e) => move(e.clientX, e.clientY));
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  /* Stand back far enough that the whole subject fits.
   *
   * camera.fov in three.js is the VERTICAL field of view; horizontal comes
   * out of it and the aspect ratio. At 62 degrees vertical that is a 91
   * degree horizontal view on a desktop and THIRTY-ONE on a portrait phone -
   * the bench is three times wider than what you can see, and the narrower
   * the screen the worse it gets.
   *
   * Locking horizontal FOV instead just inverts the problem: holding 85
   * degrees horizontal on a portrait phone needs 126 vertical, which is a
   * fish-eye. So the framing is not an angle at all. Given how wide the
   * subject is, work out where you would have to stand:
   *
   *     d = width / (2 * tan(vfov/2) * aspect)
   *
   * On a wide screen you are close; on a phone you step back. Which is what a
   * person does.
   */
  /* Widen the lens a little on a narrow screen before stepping back.
   *
   * A portrait phone at 62 degrees vertical sees barely 31 degrees across, so
   * framing a bench by distance alone put the camera three metres back -
   * through the rig standing in the middle of the room. Going the other way
   * and locking horizontal FOV needs 126 degrees vertical, which is a
   * fish-eye. Neither extreme is right; a partial widen is.
   *
   * So: open up to 78 degrees as the screen narrows, then let distance take
   * the rest, capped so the camera cannot reverse out of the room.
   */
  _fovFor() {
    const a = this.cam.aspect;
    const want = a < 1 ? THREE.MathUtils.lerp(78, 62, Math.max(0, (a - 0.45) / 0.55)) : 62;
    if (Math.abs(this.cam.fov - want) > 0.25) {
      this.cam.fov = want;
      this.cam.updateProjectionMatrix();
    }
    return (want * Math.PI) / 180;
  }

  distanceFor(width, height = 0, pad = 1.1, cap = 2.0) {
    const vfov = this._fovFor();
    const t = 2 * Math.tan(vfov / 2);
    // Width is divided by aspect, height is not. Whichever needs you further
    // back wins - framing on width alone put the camera INSIDE a rig that is
    // 1.9 m tall and 1.15 m wide.
    const dW = (width * pad) / (t * this.cam.aspect);
    const dH = (height * pad) / t;
    return Math.min(cap, Math.max(0.55, dW, dH));
  }

  goTo(station) { this.focus = station; this.leaning = null; this.blend = 0; }
  release() { this.focus = null; this.leaning = null; }

  /* Leaning in on a component. The target is derived from the part's own
   * world position rather than authored per station, so a card with a new
   * part on it needs no extra data to be inspectable. */
  lean(mesh) {
    const p = new THREE.Vector3();
    mesh.getWorldPosition(p);
    // frame the part by its own size rather than a fixed 12 cm
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    this._leanWidth = Math.max(size.x, size.y, size.z, 0.05);
    this.leaning = p;
    this._from = this.cam.position.clone();
    this._lookFrom = p.clone();
    this.blend = 0;
  }
  unlean() { this.leaning = null; this._from = this.cam.position.clone(); this.blend = 0; }

  update(dt) {
    if (this.leaning && this.focus) {
      // close enough to read a colour band: about 12 cm back and slightly above
      const aim = this.leaning;
      const back = new THREE.Vector3().subVectors(this.focus.viewPos, aim).normalize();
      const want = aim.clone()
        .add(back.multiplyScalar(this.distanceFor(this._leanWidth ?? 0.16, this._leanWidth ?? 0.16, 1.6, 1.2)))
        .add(new THREE.Vector3(0, 0.05, 0));
      this.blend = Math.min(1, this.blend + dt / 0.6);
      const e = ease(this.blend);
      this.cam.position.lerpVectors(this._from, want, e);
      this.cam.lookAt(_look.lerpVectors(this._lookFrom, aim, e));
      return;
    }

    if (this.focus) {
      if (this.blend === 0) {
        // snapshot where the move starts, once, so the easing has a fixed
        // origin. Re-reading the camera every frame makes it chase its own
        // tail and never arrive.
        this._from = this.cam.position.clone();
        this._lookFrom = new THREE.Vector3(
          -Math.sin(this.yaw), Math.sin(this.pitch), -Math.cos(this.yaw),
        ).multiplyScalar(2).add(this.cam.position);
      }
      this.blend = Math.min(1, this.blend + dt / 0.85);
      const e = ease(this.blend);
      const want = this.focus.standAt(
        this.distanceFor(this.focus.subjectWidth, this.focus.subjectHeight,
                         1.1, this.focus.maxStand ?? 2.35));
      this.cam.position.lerpVectors(this._from, want, e);
      this.cam.lookAt(_look.lerpVectors(this._lookFrom, this.focus.viewTarget, e));
      // leave the walker standing where the camera ended up, so stepping back
      // does not teleport you across the room
      this.pos.set(this.focus.viewPos.x, EYE, this.focus.viewPos.z + 0.55);
      return;
    }

    this.blend = 0;

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    /* right = forward x up, and the signs matter: written the other way round
     * this is inverted at every heading, which swaps A and D on the keyboard
     * and mirrors the thumbstick's X axis. Both came from this one line. */
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.add(fwd);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.sub(fwd);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.add(right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.sub(right);
    if (this.stick) move.add(fwd.clone().multiplyScalar(-this.stick.y)).add(right.clone().multiplyScalar(this.stick.x));

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(SPEED * dt);
      this.pos.add(move);
      this._collide();
    }
    this.cam.position.copy(this.pos);
    this.cam.rotation.set(0, 0, 0);
    this.cam.rotateY(this.yaw);
    this.cam.rotateX(this.pitch);
  }

  /** Keep inside the bay and out of the benches. Axis-aligned is enough here. */
  _collide() {
    const hx = BAY.w / 2 - RADIUS, hz = BAY.d / 2 - RADIUS;
    this.pos.x = Math.max(-hx, Math.min(hx, this.pos.x));
    this.pos.z = Math.max(-hz, Math.min(hz, this.pos.z));
    for (const o of this.obstacles) {
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
      const ox = o.hw + RADIUS - Math.abs(dx);
      const oz = o.hd + RADIUS - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        // push out along the shallower overlap: sliding along a bench feels
        // right, being shoved across it does not
        if (ox < oz) this.pos.x += Math.sign(dx || 1) * ox;
        else this.pos.z += Math.sign(dz || 1) * oz;
      }
    }
    this.pos.y = EYE;
  }
}

const _look = new THREE.Vector3();
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
