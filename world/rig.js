/* The mass-spring-damper rig.
 *
 * Floor-standing, roughly 1.8 m of frame, and that is not an inflation of a
 * desk toy - it is what a mass-spring-damper test rig in a mechanics lab
 * actually is. The bench-top version built first was a diagram of a rig: a
 * 38 cm model you had to put your eye twelve centimetres from, on a bench, in
 * a room at human scale. Three scales fighting each other.
 *
 * At this size the mass has visible weight, the spring's coils close up where
 * you can see them, and the whole thing is a machine you stand in front of
 * rather than an object you squint at. It still computes nothing: it is a
 * series RLC solved by the same engine as every circuit here, read back with
 * the units swapped.
 */

import * as THREE from '../libs/three.module.js';

const STEEL = new THREE.MeshStandardMaterial({ color: 0x5f666e, roughness: 0.55, metalness: 0.62 });
const FRAME = new THREE.MeshStandardMaterial({ color: 0x343940, roughness: 0.55, metalness: 0.55 });
const PAINT = new THREE.MeshStandardMaterial({ color: 0x4e5a63, roughness: 0.62, metalness: 0.3 });

const H_BASE = 0.1;            // plinth
const TRAVEL = 0.46;           // metres of visible travel, full scale
const REST_Y = 1.02;           // where the mass sits unloaded
/* Where the damper rod is pinned inside its body. The body spans 0.10 to
 * 0.50; anchoring at 0.25 keeps the pin buried at every position the mass
 * can reach, including the extra sag of a yielded spring. */
const D_ANCHOR = 0.25;

/** A helix along +Y, as a tube. */
function helix(turns, length, radius, wire) {
  const pts = [];
  const n = turns * 20;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector3(
      Math.cos(t * turns * Math.PI * 2) * radius,
      t * length,
      Math.sin(t * turns * Math.PI * 2) * radius,
    ));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, wire, 9, false);
}

export function makeRig() {
  const g = new THREE.Group();

  // plinth
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.78, H_BASE, 0.62), FRAME);
  base.position.y = H_BASE / 2;
  base.castShadow = true; base.receiveShadow = true;
  g.add(base);

  // two columns and a head beam: the mass hangs between them
  for (const x of [-0.3, 0.3]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.62, 0.07), PAINT);
    col.position.set(x, H_BASE + 0.81, 0);
    col.castShadow = true;
    g.add(col);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.08, 0.3), PAINT);
  head.position.y = H_BASE + 1.62;
  head.castShadow = true;
  g.add(head);

  /* Guide rods FLANK the mass. Both were at x=0, one behind the other, so
   * head-on they stacked into a single polished bar straight under the lamp -
   * which under bloom became a white stripe down the middle of the machine.
   * Either side is also where they belong on a real rig. */
  for (const x of [-0.27, 0.27]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.5, 14), STEEL);
    rod.position.set(x, H_BASE + 0.78, 0);
    g.add(rod);
  }

  /* The mass. Deliberately heavy-looking: a cast block with lifting eyes and
   * a chamfered edge, because "200 kg" has to be legible at a glance or the
   * resonance means nothing. */
  const mass = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.26, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x53463a, roughness: 0.52, metalness: 0.78 }));
  block.castShadow = true; block.receiveShadow = true;
  mass.add(block);
  for (const x of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 8, 18), STEEL);
    eye.position.set(x, 0.142, 0);
    eye.rotation.y = Math.PI / 2;
    mass.add(eye);
  }
  // sleeve bearings around the guide rods
  // bearings stand proud of the block, clear of its 0.44 m width, riding
  // rods that pass beside the mass rather than through it
  for (const x of [-0.27, 0.27]) {
    const slv = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.11, 14), FRAME);
    slv.position.set(x, 0, 0);
    mass.add(slv);
    const web = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.06), FRAME);
    web.position.set(x * 0.72, 0, 0);
    mass.add(web);
  }
  mass.position.y = REST_Y;
  g.add(mass);

  /* Spring: a real helix below the mass, compressing as the mass comes down.
   * The coils closing up is the thing you watch as it approaches its limit -
   * coil binding is a failure you can see coming. */
    /* Free length is not a free choice: the spring sits on the plinth at
   * H_BASE and must meet the underside of the mass at rest, or the rig is a
   * mass hovering above a spring it is not touching. */
  const MASS_HALF = 0.13;
  const FREE = REST_Y - MASS_HALF - H_BASE;
  const spring = new THREE.Mesh(helix(12, FREE, 0.105, 0.012), STEEL);
  spring.position.y = H_BASE;
  spring.castShadow = true;
  g.add(spring);

  // damper alongside: body on the plinth, rod up into the mass
  const damper = new THREE.Group();
  const dBody = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.4, 18), FRAME);
  dBody.position.y = 0.2;
  dBody.castShadow = true;
  damper.add(dBody);
  /* The rod is built one unit long and scaled, because it has to STRETCH
   * between two points, not slide between them. Translating it worked only
   * while travel was small: at full travel the rod's lower end rose clear of
   * the body it is supposed to be sliding inside, and its upper end pushed
   * through the mass. Anchored at D_ANCHOR and scaled to meet the underside
   * of the mass, it stays a damper at every position. */
  const dRod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 12), STEEL);
  dRod.add; // (geometry is unit height; set() scales it)
  damper.add(dRod);
  /* Left side, not right. The control console now stands off the rig's right
   * flank, and the damper's failure plume rose straight up through it: the
   * smoke was rendering correctly and measurably - a six-level drop in mean
   * brightness across the patch - but grey mist over a grey instrument panel
   * is invisible. Putting the machinery and the controls on opposite flanks
   * gives the plume dark air to rise into, and means you are not reaching
   * across a moving damper to work the levers. */
  damper.position.set(-0.235, H_BASE, 0.0);
  g.add(damper);

  // travel limits painted on a column, so the limit is visible before it is hit
  const limitMat = new THREE.MeshBasicMaterial({ color: 0x8a5a2a });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.012), limitMat);
    m.position.set(-0.3, REST_Y + s * TRAVEL / 2, 0.045);
    g.add(m);
  }

  const glow = new THREE.Color();

  return {
    group: g, mass, spring, damper: dRod,
    subjectWidth: 1.15,
    subjectHeight: 1.9,
    eyeTarget: new THREE.Vector3(0, REST_Y, 0),

    /** Place everything from a displacement in metres of REAL travel. */
    set(x, strain) {
      /* Screen travel, not real travel. The spring dies at 170 mm, and at
       * the old gain that was 139 mm of movement on a rig nearly two metres
       * tall - technically correct and visually inert. At gain 2.0 the
       * travel limit lands at 340 mm, which actually reads as a machine
       * working hard.
       *
       * The clamp is what keeps it legal. Headroom above the mass is 530 mm
       * to the underside of the head beam, and the spring may not compress
       * below 174 mm, which allows 616 mm down. 380 mm either way clears
       * both with room for the extra sag a yielded spring adds. */
      const px = THREE.MathUtils.clamp(x * 2.0, -0.38, 0.38);
      mass.position.y = REST_Y - px;
      const len = FREE - px;
      spring.scale.y = Math.max(0.22, len / FREE);

      // rod: fixed inside the damper body, reaching up to the mass underside
      const rodTop = (REST_Y - px) - MASS_HALF;          // world
      const rodLen = Math.max(0.12, rodTop - D_ANCHOR);
      dRod.scale.y = rodLen;
      dRod.position.y = (D_ANCHOR + rodLen / 2) - H_BASE;   // damper-local
      const k = Math.min(1, Math.max(0, strain));
      block.material.emissive = block.material.emissive ?? new THREE.Color();
      // gentle: under bloom this was turning the mass into a lamp
      block.material.emissive.copy(glow.setRGB(k * 0.16, k * 0.02, 0));
      block.material.emissiveIntensity = Math.max(0, k - 0.45) * 1.4;
    },

    /** Undo a permanent set - a new spring in the same frame. */
    restore() {
      spring.scale.y = 1;
      mass.position.y = REST_Y;
      block.material.emissiveIntensity = 0;
    },

    /** Permanent set: the spring no longer returns to its free length. */
    yield_(amount) {
      spring.scale.y = Math.max(0.3, spring.scale.y * (1 - amount));
      mass.position.y -= FREE * amount * 0.6;
    },
  };
}
