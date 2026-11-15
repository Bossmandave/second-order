/* The beam, as an object you can stand in front of.
 *
 * Built as one InstancedMesh of short segments rather than a deforming
 * ribbon. Two reasons, and the second is the important one: a segmented bar
 * bends convincingly at this scale with no vertex shader, and - because each
 * instance carries its own colour - the SAME geometry that shows the shape
 * also shows the strain. That matters more than it sounds. The dangerous
 * place on a vibrating beam is where the curvature is, not where the motion
 * is, and a viewer left to judge by eye will always pick the bit that is
 * obviously moving. Colouring the bar by stress is how the station argues
 * with them.
 */

import * as THREE from 'three';

const SEG = 56;                 // segments along the span
export const SPAN = 0.8;        // metres, matching the physical model
export const BEAM_Y = 0.95;     // height of the neutral axis above the floor

/* Low metalness on purpose. A physically sensible 0.8 renders nearly black
 * here: a metal's colour comes almost entirely from what it reflects, and
 * this room has no environment map - only three spot lights and a lot of
 * dark. The bar is the thing the whole station is about, so it is tuned to
 * be legible under the lighting that exists rather than correct under
 * lighting that does not. */
const STEEL = new THREE.MeshStandardMaterial({
  color: 0xffffff, roughness: 0.46, metalness: 0.3, vertexColors: false,
});

/* The bar gets its own, matte, material.
 *
 * Measured: at 76% of yield the segment was asked for (223,37,4) - deep red
 * - and rendered (233,145,40), an orange. The lamp sits above the beam and
 * is warm, and roughly +110 of warm light was landing on every segment, so
 * a beam at 76% of yield and one at 35% came out with IDENTICAL green. The
 * strain colour is the station's one honest "this part is in trouble"
 * signal and the sheen had flattened it to nothing.
 *
 * Two changes. The surface goes matte, so its own colour dominates rather
 * than the reflection. And the hot end of the ramp drives EMISSIVE, so a
 * beam in danger glows by itself instead of relying on the light that was
 * washing it out - which is also the right look: bloom picks it up, and a
 * part near failure should be the brightest thing in the room.
 */
/* Cool steel through to a hot amber and then red at yield. Deliberately not
 * a rainbow: the question a viewer has is "is this part in trouble", which
 * is one dimension, and a two-ended ramp answers it without a legend. */
const COOL = new THREE.Color(0xc2c8d0);
const WARM = new THREE.Color(0xe08a22);
const HOT = new THREE.Color(0xff3b1e);

function strainColour(out, frac) {
  if (frac < 0.5) out.copy(COOL).lerp(WARM, frac / 0.5);
  else out.copy(WARM).lerp(HOT, Math.min(1, (frac - 0.5) / 0.5));
  return out;
}

/* Two signals on one bar, because one was not enough.
 *
 * Per-segment hue comes from instanceColor, which is what shows WHERE the
 * beam is worst - and the whole point is that the worst place is not the
 * place that is obviously moving.
 *
 * On top of that the material's own emissive is driven by the PEAK strain,
 * so a beam in danger glows rather than relying on reflected light to show
 * its colour. That is what the overhead lamp was destroying: measured, a
 * segment asked for (223,37,4) rendered (233,145,40), and 76% of yield was
 * indistinguishable from 35%. Emission does not care how the thing is lit.
 *
 * (Done with material.emissive rather than a shader patch on instanceColor.
 * The patch route works right up until it silently does not: three.js keys
 * its program cache on material parameters and not on onBeforeCompile, so a
 * patched material can quietly reuse an unpatched program, and chasing that
 * cost more than the per-segment glow was worth.)
 */
const BAR_ALBEDO = 0x6c727a;

export function makeBeamRig() {
  const g = new THREE.Group();

  const dark = new THREE.MeshStandardMaterial({ color: 0x2f343a, roughness: 0.68, metalness: 0.42 });
  const pale = new THREE.MeshStandardMaterial({ color: 0x3d434a, roughness: 0.6, metalness: 0.5 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(SPAN + 0.3, 0.05, 0.34), dark);
  base.position.y = 0.025;
  base.castShadow = true; base.receiveShadow = true;
  g.add(base);

  /* Simple supports, drawn as knife edges rather than clamps. The boundary
   * condition is the reason the mode shapes are clean sines and the nodes
   * land on exact fractions of the span, so it is worth being able to see
   * that the ends are free to rotate. */
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, BEAM_Y - 0.08, 0.16), pale);
    post.position.set((sx * SPAN) / 2, (BEAM_Y - 0.08) / 2 + 0.05, 0);
    post.castShadow = true; post.receiveShadow = true;
    g.add(post);
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.17, 12), STEEL.clone());
    edge.rotation.x = Math.PI / 2;
    edge.position.set((sx * SPAN) / 2, BEAM_Y - 0.018, 0);
    edge.castShadow = true;
    g.add(edge);
  }

  const seg = new THREE.BoxGeometry(SPAN / SEG, 0.014, 0.09);
  const barMat = new THREE.MeshStandardMaterial({
    color: BAR_ALBEDO, roughness: 0.78, metalness: 0.05,
  });
  const bar = new THREE.InstancedMesh(seg, barMat, SEG);
  bar.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bar.castShadow = true; bar.receiveShadow = true;
  bar.frustumCulled = false;
  /* No vertexColors flag. Per-instance colour and per-VERTEX colour are
   * different paths: setting vertexColors tells the shader to read a `color`
   * attribute off the geometry, which does not exist here, and the bar came
   * out black whatever colour it was given. setColorAt creates the instance
   * colour buffer itself and three.js enables the right shader branch. */
  const warm = new THREE.Color(0xc2c8d0);
  for (let i = 0; i < SEG; i++) bar.setColorAt(i, warm);
  g.add(bar);

  // the shaker rides on the beam and moves with it
  const shaker = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.075),
    new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.52, metalness: 0.55 }));
  body.position.y = 0.055;
  body.castShadow = true;
  shaker.add(body);
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.03, 0.095),
    new THREE.MeshStandardMaterial({ color: 0x5a6069, roughness: 0.42, metalness: 0.7 }));
  clamp.position.y = 0.006;
  shaker.add(clamp);
  g.add(shaker);

  /* The spec plate.
   *
   * The station's whole premise is "tune the shaker to one of THESE", and
   * until this existed the numbers were nowhere - not on the beam, not in
   * the readout, not on the dial. Which made it a blind search across five
   * octaves with no indication you were getting warmer. An engraved plate on
   * the frame is both where it would be in life and the one piece of
   * information the station cannot work without. */
  const pcv = document.createElement('canvas');
  pcv.width = 1024; pcv.height = 288;
  const px = pcv.getContext('2d');
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.58, 0.163),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pcv), transparent: true }),
  );
  /* 6 mm proud of its backing panel. At the same z the plane and the box's
   * front face z-fight, and the plate rendered as a solid black rectangle -
   * the canvas was correct the whole time, it simply never won the depth
   * test. */
  plate.position.set(-(SPAN / 2) - 0.04, 0.545, 0.1565);   // clear of the on-screen dial
  plate.rotation.x = -0.26;
  g.add(plate);
  const plateBack = new THREE.Mesh(
    new THREE.BoxGeometry(0.605, 0.18, 0.008),
    new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.5, metalness: 0.6 }),
  );
  plateBack.position.set(-(SPAN / 2) - 0.04, 0.5465, 0.146);
  plateBack.rotation.x = -0.26;
  g.add(plateBack);
  const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.52, 0.022), pale);
  const stalkH = 0.52;
  stalk.position.set(-(SPAN / 2) - 0.04, 0.05 + stalkH / 2, 0.14);
  stalk.castShadow = true;
  g.add(stalk);

  /* Node markers.
   *
   * A node is the part of the shape that does nothing, which makes it the
   * hardest thing to notice and the most interesting thing to see: at 85.8
   * Hz the middle of this beam is motionless while the two halves fly in
   * opposite directions. Ticks on the base give the eye something to compare
   * against, and they light when the span above them actually goes still -
   * computed from the drawn shape, so a tick never claims a node that is not
   * there. Mode 1 has no interior nodes, mode 2 has one at the half, mode 3
   * has two at the thirds. */
  const NODES = [1 / 3, 1 / 2, 2 / 3];
  // exported so the station can measure stillness at exactly these points
  const nodeAt = NODES.slice();

  /* A reference rail just under the beam, not ticks down on the baseplate.
   * Two jobs: it puts the marks where your eye already is instead of 90 cm
   * below the thing moving, and a straight datum next to a bending bar is
   * what makes the bend legible at all. */
  const RAIL_Y = BEAM_Y - 0.075;
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(SPAN + 0.06, 0.004, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x404750, roughness: 0.6, metalness: 0.4 }),
  );
  rail.position.set(0, RAIL_Y, 0.052);
  g.add(rail);
  const nodeMat = NODES.map(() => new THREE.MeshBasicMaterial({ color: 0x3a424b, fog: false }));
  const nodeTicks = NODES.map((u, i) => {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.034, 0.016), nodeMat[i]);
    t.position.set((u - 0.5) * SPAN, RAIL_Y + 0.017, 0.052);
    g.add(t);
    return t;
  });

  const crack = new THREE.Mesh(
    new THREE.BoxGeometry(0.008, 0.02, 0.084),
    new THREE.MeshBasicMaterial({ color: 0x0b0c0e }),
  );
  crack.visible = false;
  g.add(crack);

  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  const ZAXIS = new THREE.Vector3(0, 0, 1);   // hoisted: this ran once per segment per frame
  const glowCol = new THREE.Color();

  return {
    group: g,
    bar,
    nodeAt,
    subjectWidth: SPAN + 0.42,
    subjectHeight: 1.26,
    subjectY: BEAM_Y - 0.33,

    /**
     * Draw one frame of the beam.
     * @param {(u:number)=>number} w       displacement at span fraction u, metres (display-scaled)
     * @param {(u:number)=>number} strain  0..1 of yield at span fraction u
     * @param {number} shakerAt            span fraction the shaker sits at
     * @param {boolean[]} nodeLit           which node ticks to light
     */
    set(w, strain, shakerAt, nodeLit = [false, false, false]) {
      for (let i = 0; i < SEG; i++) {
        const u = (i + 0.5) / SEG;
        const y = w(u);
        /* Each segment is tilted by the local slope. Without it the bar is a
         * staircase at the ends of the span, where the shape is steepest and
         * the eye is least forgiving. */
        const du = 0.5 / SEG;
        const slope = (w(Math.min(1, u + du)) - w(Math.max(0, u - du))) / (2 * du * SPAN);
        pos.set((u - 0.5) * SPAN, BEAM_Y + y, 0);
        quat.setFromAxisAngle(ZAXIS, Math.atan(slope));
        mat.compose(pos, quat, one);
        bar.setMatrixAt(i, mat);
        strainColour(col, Math.min(1, strain(u)));
        bar.setColorAt(i, col);
      }
      bar.instanceMatrix.needsUpdate = true;
      if (bar.instanceColor) bar.instanceColor.needsUpdate = true;

      shaker.position.set((shakerAt - 0.5) * SPAN, BEAM_Y + w(shakerAt) + 0.006, 0);

      // whether each node tick is lit is decided by the caller, from the
      // beam's live motion - see Station._updateBeam
      /* The bar glows by its own worst strain. Below half of yield it is
       * just lit steel; above, it reddens and bloom takes over. */
      let worst = 0;
      for (let i = 0; i <= 24; i++) worst = Math.max(worst, strain(i / 24));
      const g = Math.max(0, Math.min(1, (worst - 0.35) / 0.65));
      strainColour(glowCol, Math.min(1, worst));
      barMat.emissive.copy(glowCol).multiplyScalar(g * g * 1.15);

      nodeLit.forEach((on, i) => {
        nodeMat[i].color.setHex(on ? 0x7fc8ff : 0x343b43);
        nodeTicks[i].scale.y = on ? 2.4 : 1;
      });
    },

    /**
     * Engrave the natural frequencies, and light the one you are sitting on.
     * @param {number[]} hz   the modes, in order
     * @param {number} liveHz the drive, so the matching mark can glow
     */
    stamp(hz, liveHz = 0) {
      /* One line, set as large as the plate allows.
       * The first version laid the three modes out in columns with labels
       * and units, which is how a real plate would read and which was
       * illegible at the 230 screen pixels this object actually occupies.
       * Three numbers is all it has to say. */
      px.clearRect(0, 0, pcv.width, pcv.height);
      px.fillStyle = '#1b1f24';
      px.fillRect(0, 0, pcv.width, pcv.height);
      px.fillStyle = 'rgba(255,255,255,.08)';
      px.fillRect(0, 0, pcv.width, 6);

      px.textAlign = 'center';
      px.fillStyle = '#6d757e';
      px.font = '600 44px ui-monospace, Menlo, monospace';
      px.letterSpacing = '10px';
      px.fillText('RESONANCES, Hz', pcv.width / 2, 72);
      px.letterSpacing = '0px';

      const parts = hz.map((f) => (f < 100 ? f.toFixed(1) : f.toFixed(0)));
      px.font = '700 92px ui-monospace, Menlo, monospace';
      const gap = px.measureText('  ').width;
      const widths = parts.map((t) => px.measureText(t).width);
      const total = widths.reduce((a, w) => a + w, 0) + gap * (parts.length - 1);
      let x = pcv.width / 2 - total / 2;
      px.textAlign = 'left';
      parts.forEach((t, i) => {
        const on = liveHz > 0 && Math.abs(hz[i] - liveHz) / hz[i] < 0.03;
        px.fillStyle = on ? '#ffb34d' : '#d6dbe1';
        px.fillText(t, x, 192);
        if (on) { px.fillRect(x, 208, widths[i], 7); }
        x += widths[i] + gap;
      });
      plate.material.map.needsUpdate = true;
    },

    /** Mark the break, at the span fraction where the curvature won. */
    breakAt(u) {
      crack.position.set((u - 0.5) * SPAN, BEAM_Y, 0);
      crack.visible = true;
    },

    restore() { crack.visible = false; },
  };
}
