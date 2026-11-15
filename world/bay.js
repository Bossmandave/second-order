/* The bay.
 *
 * Small and dark on purpose. You cannot see the walls, so the room reads as a
 * large industrial space while actually being about five metres across - the
 * darkness is doing the work that geometry would otherwise have to.
 *
 * There is no global illumination here and there will not be. The room is lit
 * by the station lamps alone, plus a floor bounce that never reaches zero.
 * True black underfoot looks dramatic in a screenshot and is miserable to walk
 * around in: you lose all sense of where the ground is.
 */

import * as THREE from '../libs/three.module.js';

export const BAY = { w: 6.4, d: 5.2, h: 3.1 };

export function buildBay(scene) {
  const g = new THREE.Group();

  // concrete floor. Rough and dark, but not black - it has to catch the lamps
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x332f2b, roughness: 0.84, metalness: 0.0,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(BAY.w, BAY.d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  // Walls face inward and are nearly black. They exist to stop the lamp light
  // escaping and to give the room an edge you sense rather than see.
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x14120f, roughness: 1.0, metalness: 0.0, side: THREE.BackSide,
  });
  /* Dropped a centimetre so the shell's floor face sits BELOW the floor
   * plane. Both were at y=0, and two coplanar surfaces fight for the depth
   * buffer - which reads as the floor shimmering and crawling as you move,
   * because which one wins flips from pixel to pixel and frame to frame. */
  const shell = new THREE.Mesh(new THREE.BoxGeometry(BAY.w, BAY.h, BAY.d), wallMat);
  shell.position.y = BAY.h / 2 - 0.012;
  shell.receiveShadow = true;
  g.add(shell);

  scene.add(g);

  /* A very low hemisphere fill. Not global illumination - a floor you can see
   * when no lamp is near you. Without it, walking between stations means
   * walking through nothing, which reads as a bug rather than as darkness. */
  const fill = new THREE.HemisphereLight(0x2b3542, 0x15120f, 0.2);
  scene.add(fill);

  /* A single weak pilot light high in the bay.
   *
   * This slightly undercuts the one-station-lit rule and it earns its place:
   * with nothing but station lamps, a visitor standing between benches sees
   * pure black and reasonably concludes the thing has failed to load. Real
   * workshops have a pilot light or a window for the same reason. It is dim
   * enough that a lit station still dominates completely.
   */
  const pilot = new THREE.PointLight(0x8fa6bd, 2.2, 12, 1.3);
  /* Hung low, not tucked under the ceiling. At 50 cm below a 3.1 m ceiling
   * it was lighting a large flat surface from point-blank range, and that
   * ceiling - not the fixture - was the white bar across the top of the
   * screen. Down at 2.1 m it is where a workshop batten actually hangs and
   * the ceiling stays the dark nothing it should be. */
  pilot.position.set(0, 2.08, 0.2);
  scene.add(pilot);

  /* Give it a fixture. An unexplained pool of light on the back wall reads as
   * a rendering artefact; a batten with a visible tube reads as a room. */
  const batten = new THREE.Group();
  /* Unlit on purpose. A lit material 30 cm under the lamp it houses receives
   * an enormous amount of light and sails through the bloom threshold, so the
   * fixture became a white bar across the top of the screen. The housing is a
   * silhouette; it has no business being the brightest thing in the room. */
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.055, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x23272c }),
  );
  batten.add(body);
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 1.0, 10),
    new THREE.MeshBasicMaterial({ color: 0xc8d6e4, fog: false }),
  );
  tube.rotation.z = Math.PI / 2;
  tube.position.y = -0.035;
  batten.add(tube);
  for (const s of [-1, 1]) {
    const chain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0022, 0.0022, 0.9, 5),
      new THREE.MeshStandardMaterial({ color: 0x3c4149, roughness: 0.5, metalness: 0.8 }),
    );
    chain.position.set(s * 0.45, 0.47, 0);
    batten.add(chain);
  }
  batten.position.set(0, 2.2, 0.2);
  scene.add(batten);

  return { group: g, floor, fill, pilot };
}
