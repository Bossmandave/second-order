/* A station: a bench with an experiment card on it, a supply, and a screen.
 *
 * Dormant stations are not invisible. That sounds like a detail and it is the
 * difference between a dark room you can navigate and one you blunder around
 * in: each sleeping station keeps a standby indicator and a faint rim of
 * light on its bench edge, enough to say "there is something over there" and
 * nothing more.
 *
 * Only an awake station ticks its solver. Nothing is simulating at a bench
 * you are not standing at, so the cost of the room is the cost of one
 * station however many it grows to hold.
 */

import { makeBeamRig, SPAN, BEAM_Y } from './beam3d.js';
import * as THREE from '../libs/three.module.js';
import { groundLeads, makeCard, makeResistor, makeElectrolytic, makeLED, makeDiode, labelTexture } from './parts3d.js';
import { Console, makePSU, makeScreen } from './instruments.js';
import { makeStation } from '../analysis/circuits.js';
import { makeRig } from './rig.js';
import { recall, record, forget, freshness } from './memory.js';
import { Trace, PhasePath } from '../analysis/scope.js';
import { drawPanel } from '../analysis/panel.js';
import { Smoke, char, incandescence, thermalColour } from './damage.js';

const BENCH_H = 0.92;

export class Station {
  /** Set by main.js: called with (station, failure) when a part dies. */
  static onBreak = null;

  constructor({ def, position, rotation = 0 }) {
    this.def = def;
    this.id = def.id;
    this.title = def.title;
    this.position = position.clone();
    this.wake = 0;
    this.wakeTarget = 0;
    this.lampPower = def.mechanical ? 7.5 : 11;
    this.active = false;
    this.armed = false;            // running, as opposed to merely lit

    const g = new THREE.Group();
    g.position.copy(position);
    g.rotation.y = rotation;
    this.group = g;

    /* The working position is in front of the bench, which is only "+Z" for a
     * station that happens to be unrotated. Several face sideways, so the
     * offset has to be rotated with the bench or you end up standing inside
     * it looking at the far wall.
     *
     * Defined BEFORE the geometry is built: _buildRig needs it to aim the
     * camera at the mass, and reaching for it a few lines too early is a
     * blank page with "this._front is not a function" in the console. */
    const front = (dz, dy) => new THREE.Vector3(0, dy, dz)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation)
      .add(position);
    this._front = front;
    /* A bench wants its lamp overhead. The rig is nearly two metres tall, so
     * the same position puts the lamp ON its head beam - blowing the beam out
     * under bloom and leaving the mass, the only thing worth watching, in its
     * shadow. Light it from in front and below the head instead. */
    this.lampPosition = def.mechanical
      ? front(0.95, 1.45)
      : def.beam ? front(0.45, 1.9)
      : front(0.1, BENCH_H + 0.95);
    this.viewTarget = front(-0.04, BENCH_H + 0.17);
    /* How wide the thing you came to look at actually is. The camera works
     * out where to stand from this and the viewport shape, instead of a fixed
     * distance that happens to suit one screen. */
    /* The WORKING AREA - card, screen and supply - not the full 1.5 m bench.
     * Framing the whole bench on a portrait phone demanded 3.2 m of standing
     * room, and the benches are only 2.4 m from the rig in the middle of the
     * floor, so the camera reversed straight through it. You frame what you
     * came to look at and let the bench ends run off the sides, which is what
     * a person standing at a bench actually sees. */
    this.subjectWidth = 1.15;
    // a console stands ~54 cm proud of the bench; the old frame cut its top row
    this.subjectHeight = this.def.console ? 0.72 : 0.62;
    this.subjectY = BENCH_H + 0.2;
    if (def.beam) {
      /* The beam is 80 cm of span plus its console, and the thing you are
       * reading is the SHAPE - so the frame has to take in the whole span at
       * once or the nodes are off the edge and the station is pointless. */
      /* Measured from the furniture, not guessed. The screen's outer corner
       * sits at -0.84 and the console's at +0.85, and the tallest thing is
       * the screen at 1.48; framing on the span alone put the camera inside
       * the station looking at a dark bar. */
      /* 1.8, and the furniture pulled in to match. Asking for a wider
       * frame did nothing: on a phone the camera is already as far back as
       * the room allows, so the only way to get margin around the span is to
       * make the station narrower. */
      this.subjectWidth = 1.8;
      this.subjectHeight = 1.5;
      this.subjectY = 0.74;
      this.viewTarget = front(-0.04, BEAM_Y - 0.06);
    }
    this.viewPos = front(1.02, 1.42);       // fallback before a frame has run

    if (!def.mechanical && !def.beam) this._buildBench(g);
    this._buildInstruments(g);
    this._buildCard(g);

    this.scar = recall(this.id);
    this.reset();
    if (this.scar) this._applyScar();
  }

  // ------------------------------------------------------------- geometry
  _buildBench(g) {
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.055, 0.72),
      new THREE.MeshStandardMaterial({ color: 0x3c3a36, roughness: 0.72, metalness: 0.1 }),
    );
    top.position.y = BENCH_H;
    top.castShadow = true; top.receiveShadow = true;
    g.add(top);

    const legMat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.55, metalness: 0.6 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, BENCH_H, 0.055), legMat);
      leg.position.set(sx * 0.68, BENCH_H / 2, sz * 0.3);
      leg.castShadow = true;
      g.add(leg);
    }

    this.standbyMat = new THREE.MeshBasicMaterial({ color: 0x4fb4e0, fog: false });
    // Inset in the bench edge, not a ball resting on top of it. A sphere
    // floating above the surface reads as a stray object rather than as an
    // indicator, and this is the thing people navigate by.
    const standby = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.004, 14), this.standbyMat);
    standby.rotation.x = Math.PI / 2;
    standby.position.set(-0.6, BENCH_H + 0.012, 0.362);
    g.add(standby);

    this.rimMat = new THREE.MeshBasicMaterial({ color: 0x2c4f63, fog: false });
    const rim = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.010, 0.012), this.rimMat);
    rim.position.set(0, BENCH_H + 0.028, 0.36);
    g.add(rim);
  }

  _buildInstruments(g) {
    /* The supply parameter is not always called V - the mechanical rig drives
     * a force, F - so the lever was falling back to a hard-coded 24 and could
     * not reach the top of that station's range. */
    if (this.def.mechanical || this.def.console) {
      /* Four levers in one column, not one knob and three numbers you cannot
       * reach. A mass-spring-damper has four inputs and three of them change
       * the CHARACTER of the machine rather than how hard you push it; a rig
       * that only let you vary the force was a rig with one interesting
       * number and three constants.
       *
       * The column stands on its own mast bolted to the plinth, angled back
       * toward whoever is in front of the rig. One column rather than a bench
       * of scattered controls because the phone's framed view is barely two
       * metres wide, and anything outside it cannot be touched at all. */
      const rig = this.def.mechanical || this.def.beam;
      /* A read-only panel needs a row per READING, not per control: the beam
       * has one control and four things worth watching. */
      const rows = this.def.readOnly
        ? [...this.def.params, { key: '_r1', label: '', unit: '', min: 0, max: 1, value: 0 },
           { key: '_r2', label: '', unit: '', min: 0, max: 1, value: 0 },
           { key: '_r3', label: '', unit: '', min: 0, max: 1, value: 0 }]
        : this.def.params;
      this.console = rig
        ? new Console(rows,
          { width: 0.40, rowH: rows.length > 4 ? 0.11 : 0.155, readOnly: !!this.def.readOnly })
        : new Console(this.def.params, { width: 0.32, rowH: 0.095 });
      this.psu = null;

      if (!rig) {
        /* A bench console stands on the bench where the supply used to, and
         * the supply's two knobs are folded into it. A station whose whole
         * point is hunting a frequency cannot have its frequency living on
         * the flat panel while the 3D bench offers you a voltage dial. */
        /* Centre height is set from the console's own half-height, not
         * guessed: at 0.215 above the bench the bottom 5 cm of a 54 cm panel
         * sat *below* the bench surface and was simply occluded by it, which
         * cost the fourth row. A bench console is also a third the size of
         * the rig's - it shares the bench with the circuit you are there to
         * watch, rather than standing on its own mast. */
        this.console.group.position.set(0.355, BENCH_H + this.console.height / 2 + 0.02, -0.14);
        this.console.group.rotation.y = -0.16;
        this.console.group.rotation.x = -0.08;
        g.add(this.console.group);
        const plinth = new THREE.Mesh(
          new THREE.BoxGeometry(0.36, 0.02, 0.15),
          new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.62, metalness: 0.45 }),
        );
        plinth.position.set(0.355, BENCH_H + 0.012, -0.125);
        plinth.castShadow = true; plinth.receiveShadow = true;
        g.add(plinth);
      } else {

      // the beam's console stands clear of the span, off its right-hand end
      const cx = this.def.beam ? SPAN / 2 + 0.14 : 0.44;
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.026, 0.62, 16),
        new THREE.MeshStandardMaterial({ color: 0x343940, roughness: 0.55, metalness: 0.6 }),
      );
      post.position.set(cx, 0.4, 0.2);
      post.castShadow = true;
      g.add(post);
      const foot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.085, 0.022, 20),
        new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.68, metalness: 0.45 }),
      );
      foot.position.set(cx, 0.111, 0.2);
      foot.castShadow = true; foot.receiveShadow = true;
      g.add(foot);

      this.console.group.position.set(cx - 0.02, this.def.beam ? 0.92 : 0.95, 0.22);
      this.console.group.rotation.y = -0.2;    // turned toward the operator
      this.console.group.rotation.x = -0.06;   // tipped back, like a desk panel
      g.add(this.console.group);
      }
    } else {
      /* The supply parameter is not always called V - the mechanical rig
       * drives a force, F - so the lever was falling back to a hard-coded 24
       * and could not reach the top of that station's range. */
      const drive = this.def.params.find((p) => p.key === 'V' || p.key === 'F');
      this.psu = makePSU({ vMax: drive?.max ?? 24 });
      this.psu.group.position.set(0.44, BENCH_H + 0.028, -0.09);
      g.add(this.psu.group);
    }

    /* The rig gets a bigger screen than the benches. It stands alone in the
     * middle of the floor and has to be framed whole, so the camera is nearly
     * a metre further back than at a bench; at 46 cm the scope was a postage
     * stamp on a phone. */
    this.screen = this.def.beam
      ? makeScreen({ width: 0.46, height: 0.3 })
      : this.def.mechanical
      ? makeScreen({ width: 0.52, height: 0.34 })
      : makeScreen({ width: 0.46, height: 0.3 });
    if (this.def.beam) {
      this.screen.group.position.set(-(SPAN / 2) - 0.16, BEAM_Y + 0.38, 0.03);
      this.screen.group.rotation.y = 0.28;
      /* The scope and the console stand higher than the beam and between it
       * and the lamp, so they were dropping a hard shadow across the left
       * third of the span - which read as the beam being unevenly lit, and
       * then as the strain colour being wrong. They are instruments, not the
       * subject; nothing is gained by them casting onto the thing you came
       * to look at. */
      for (const g2 of [this.screen.group, this.console?.group]) {
        g2?.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      }
    } else if (this.def.mechanical) {
      /* Up and out of the way. With travel doubled, the mass at full
       * extension reaches 1.53 m and swept across the scope's lower right
       * corner - correct depth sorting, but the instrument you are reading
       * disappears behind the thing you are watching. At 1.46 m the scope
       * clears the mass by 55 mm in x and still sits below the head beam. */
      this.screen.group.position.set(-0.47, 1.46, 0.10);
      this.screen.group.rotation.y = 0.34;
    } else {
      this.screen.group.position.set(-0.31, BENCH_H + 0.195, -0.2);
      this.screen.group.rotation.x = -0.14;
    }
    g.add(this.screen.group);

    // a slot in the bench for the card to seat into
    if (this.def.mechanical) return;
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(0.47, 0.016, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.8 }),
    );
    slot.position.set(-0.3, BENCH_H + 0.029, 0.16);
    g.add(slot);
  }

  /* The beam station: a bar on two knife edges, a shaker that rides it, and
   * a console you work it from. No bench, because it is a structure under
   * test rather than a circuit on a board. */
  _buildBeam(g) {
    this.beamRig = makeBeamRig();
    g.add(this.beamRig.group);
    this.card = this.beamRig.group;
    this.smoke = new Smoke(this.card, 90, { size: 0.09, rise: 6, opacity: 0.5 });

    /* Per-mode amplitude envelopes, for the strobe.
     *
     * At 193 Hz the bar is a grey blur and the mode shape - the entire point
     * of the station - is invisible. The strobe redraws the beam from these
     * envelopes at a slow phase, which is the same thing a lab strobe does
     * to a running machine: freeze the motion so you can see the shape
     * instead of the smear. */
    this.modeEnv = [0, 0, 0];
    this.strobePhase = 0;
    this._stampedAt = -1;

    /* Wayfinding, same as every other station: the rim strip and the standby
     * dot are how you tell a sleeping station from a live one across a dark
     * room, and step() drives both unconditionally. A station that builds
     * neither takes the whole page down with "cannot read properties of
     * undefined" on the first frame. */
    this.rimMat = new THREE.MeshBasicMaterial({ color: 0x2c4f63, fog: false });
    for (const sz of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(SPAN + 0.3, 0.012, 0.012), this.rimMat);
      rim.position.set(0, 0.056, sz * 0.165);
      g.add(rim);
    }
    this.standbyMat = new THREE.MeshBasicMaterial({ color: 0x4fb4e0, fog: false });
    const ind = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 14), this.standbyMat);
    ind.rotation.x = Math.PI / 2;
    ind.position.set(-(SPAN / 2) - 0.1, 0.056, 0.168);
    g.add(ind);

    return this.card;
  }

  _buildCard(g) {
    if (this.def.mechanical) return this._buildRig(g);
    if (this.def.beam) return this._buildBeam(g);
    const card = makeCard(this.def.short);
    card.position.set(-0.3, BENCH_H + 0.042, 0.16);
    g.add(card);
    this.card = card;
    /* Bench smoke was built for a close-up and the station is not viewed
     * that way: focused at a card you are the better part of a metre off,
     * and 12 mm particles drew a grey thread a few pixels wide above the
     * part. A resistor cooking should be the thing you notice, not something
     * you find by looking for it. Bigger particles, more of them, rising
     * harder - measured against the same framing the player actually gets. */
    this.smoke = new Smoke(card, 150, { size: 0.032, rise: 2.2, opacity: 0.42 });

    const edgeMat = new THREE.MeshStandardMaterial({ map: labelTexture(this.def.short), roughness: 0.75 });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.03), edgeMat);
    plate.position.set(0, 0.006, 0.1445);
    card.add(plate);

    /* One mesh per solver element that has a body worth seeing, laid out left
     * to right. The mapping is kept so charring and glow can be driven
     * straight from the element's own state later. */
    this.bodies = [];
    const visible = this.station?.ckt?.elements ?? [];
  }

  _buildRig(g) {
    this.rig = makeRig();
    g.add(this.rig.group);               // stands on the floor, not on a bench
    this.card = this.rig.group;          // smoke and lean-in target the same way
    /* Sized for a machine you stand over two metres from, not for a puff off
     * a quarter-watt resistor at arm's length. These numbers were settled by
     * measuring the plume's own pixels - at 75 mm it moved the mean
     * brightness of its patch by three levels out of 255, which is to say
     * not at all - rather than by looking for it and guessing again. These
     * lift the patch by about 17 levels over a background of 55: clearly a
     * plume, not a white blob. (Measuring this needs the scene frozen; with
     * the plume still rising, the sample window moves between the two reads
     * and the comparison is worthless - it reported the smoke as DARKENING
     * the frame, which sent me looking for a blending bug that did not
     * exist.) */
    this.smoke = new Smoke(this.card, 220,
      { size: 0.13, rise: 10, opacity: 0.62, color: 0xc4bfb7 });
    /* Measured, not guessed: the scope's outer edge sits at -0.70 and the
     * console's at +0.65 - and both stand FORWARD of the rig's centre line,
     * so perspective magnifies them by about 12% over anything at z=0. The
     * widths below are the magnified ones; framing on the flat numbers put
     * both of them half off the edge of a phone. */
    this.subjectWidth = 1.48;
    this.subjectHeight = this.rig.subjectHeight;
    this.maxStand = 3.0;   // it is two metres tall; you have to stand back
    this.minStand = 2.0;
    this.subjectY = this.rig.eyeTarget.y;
    this.viewTarget = this._front(0, this.rig.eyeTarget.y);

    /* It needs standby presence more than the benches do, not less: it stands
     * alone in the middle of a dark room with no bench edge to catch a rim
     * light. A strip around the plinth and an indicator on the frame. */
    this.rimMat = new THREE.MeshBasicMaterial({ color: 0x2c4f63, fog: false });
    for (const [w, d, z] of [[0.8, 0.012, 0.315], [0.8, 0.012, -0.315]]) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), this.rimMat);
      rim.position.set(0, 0.1, z);
      g.add(rim);
    }
    this.standbyMat = new THREE.MeshBasicMaterial({ color: 0x4fb4e0, fog: false });
    const ind = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 14), this.standbyMat);
    ind.rotation.x = Math.PI / 2;
    ind.position.set(-0.3, 1.5, 0.038);
    g.add(ind);
  }

  /**
   * The station's live settings, for the on-screen readout.
   *
   * This exists because of a hard limit, not a styling preference. The scope
   * panel and the segment displays are canvas textures on surfaces roughly
   * 20-45 cm wide; framed on a phone, a bench is about 1.3 m across the
   * screen, so a 15 px glyph on a 1024 px texture lands at two or three
   * device pixels. No amount of enlarging the texture fixes that - the
   * surface itself is too small in the frame. Drawn as real DOM text instead,
   * the same numbers render at device resolution and stay sharp at any
   * aspect, on the one device where they were illegible.
   */
  readings() {
    const out = [];
    if (this.console) {
      /* Driven from def.params, not from the console's levers: a read-only
       * panel is padded with blank rows so it has somewhere to print the
       * readings, and those placeholders were leaking out as "0.0". */
      for (const pm of this.def.params) {
        const lv = this.console.levers.find((l) => l.key === pm.key);
        if (!lv) continue;
        out.push({ label: pm.label, value: lv.value.toFixed(pm.dp ?? 1), unit: pm.unit, live: true });
      }
      for (const extra of this.def.readouts?.(this.sim) ?? []) out.push(extra);
      const r = this.sim.rig;
      if (r) {
        out.push({ label: 'x', value: (r.displacement * 1000).toFixed(0), unit: 'mm' });
        /* Speed, because force does not change how FAST the rig oscillates -
         * that is set by mass and stiffness alone - but it does change how
         * fast the mass is moving, because the swing gets bigger. Without a
         * number for it, winding the force up looks like nothing happened. */
        out.push({ label: 'speed', value: Math.abs(r.velocity).toFixed(2), unit: 'm/s' });
        out.push({ label: 'zeta', value: r.zeta.toFixed(2), unit: '' });
      }
      return out;
    }
    if (!this.psu) return out;
    const u = this.def.units ?? { v: 'V', i: 'mA' };
    const drive = this.def.params.find((p) => p.key === 'V' || p.key === 'F');
    out.push({ label: drive?.label ?? 'Supply', value: this.psu.vKnob.value.toFixed(2), unit: u.v, live: true });
    for (const pm of this.def.params) {
      if (pm === drive) continue;
      out.push({ label: pm.label, value: pm.value.toFixed(pm.step >= 1 ? 0 : 1), unit: pm.unit });
    }
    const src = this.sim.ckt.elements.find((e) => e.type === 'V');
    out.push({ label: 'I', value: (Math.abs(src?.i ?? 0) * 1000).toFixed(0), unit: 'mA' });
    return out;
  }

  /** Everything on this station you can grab and drag. */
  controls() {
    if (this.console) return this.console.levers;
    return this.psu ? [this.psu.vKnob, this.psu.iKnob] : [];
  }

  // ------------------------------------------------------- live simulation
  reset() {
    const values = Object.fromEntries(this.def.params.map((p) => [p.key, p.value]));
    if (this.psu) {
      const key = this.def.params.some((p) => p.key === 'V') ? 'V' : 'F';
      values[key] = this.psu.vKnob.value;
    }
    // the console holds every parameter, so a reset keeps the machine you built
    if (this.console) Object.assign(values, this.console.values());
    this.sim = makeStation(this.def, values);
    this.names = Object.keys(this.sim.probes);
    this.probes = Object.values(this.sim.probes);
    const w = (this.def.pace?.tEnd ?? 0.1) / 16;
    this.traces = [new Trace(420, w), new Trace(420, w)];
    this.phase = new PhasePath(2500);
    this.failure = null;
    this.armed = false;
    /* A fresh beam is a straight beam. makeStation builds a new Fatigue, so
     * the damage is already back to zero; this is the crack mark and the
     * strobe envelopes, which live on the view. */
    if (this.beamRig) {
      this._cracked = false;
      this.beamRig.restore();
      this.modeEnv = this.modeEnv.map(() => 0);
      this.nodeEnv = null; this.spanEnv = 0; this.relax = 1;
      this.smoke?.reset?.();
    }
    this._layoutParts();
    this._paint();
  }

  /* Draw the beam.
   *
   * Deflection is exaggerated by GAIN. The beam yields at 27 mm of mid-span
   * movement on an 800 mm span, which is honest and almost invisible from
   * two metres away; the station is about seeing a SHAPE, and a shape you
   * cannot see is not an argument. The strain colour is not exaggerated,
   * because that is the number being claimed.
   */
  _updateBeam(dt) {
    /* 10x, with a soft ceiling.
     *
     * Honest deflections here are a few millimetres on an 800 mm span -
     * correct, and invisible from the two metres away the frame puts you.
     * The ceiling matters as much as the gain: at yield the beam moves 27 mm
     * and ten times that would put the bar through the floor, so the display
     * compresses as it approaches the limit rather than clipping flat, which
     * would read as the beam having stopped. The STRAIN colour is not
     * exaggerated - that is the number being claimed.
     *
     * 40x because the modes are not equally visible: stiffness goes as n^4,
     * so the same force moves mode 2 a twentieth as far as mode 1. At a gain
     * that suited mode 1 the upper modes were a straight bar, and a station
     * whose argument is "each resonance has its own shape" cannot show two
     * of its three shapes as nothing. */
    const GAIN = 30;
    const CEIL = 0.13;
    const b = this.sim.beam;
    const rig = this.beamRig;
    if (!b || !rig) return;

    // envelopes, so the strobe has an amplitude to draw even at 193 Hz
    const decay = Math.exp(-dt / 0.35);
    for (let i = 0; i < b.modes.length; i++) {
      this.modeEnv[i] = Math.max(Math.abs(b.q(i)), (this.modeEnv[i] ?? 0) * decay);
    }

    const strobing = b.d.f > 30 || !this.armed;

    /* Settling to rest when the machine stops.
     *
     * This cannot come from the envelopes. They follow max(|q|, env*decay),
     * and stopping the simulation freezes q - so the envelope decays down to
     * the frozen value and sticks there. Measured: step away at mode 1 and
     * the drawn beam held a 13 mm bend indefinitely, which is a machine
     * stopped mid-flex rather than a machine at rest.
     *
     * So the drawn shape gets its own multiplier, independent of any modal
     * state, which runs to zero over half a second once the station is no
     * longer running and snaps back when it is. */
    this.relax = this.armed
      ? 1
      : Math.max(0, (this.relax ?? 1) - dt / 0.5);

    /* Live, the beam is drawn from its actual modal coordinates. Strobed, it
     * is drawn from the envelopes at a slow shared phase - which is a lie
     * about the relative phase between modes and the truth about the shape,
     * and the shape is what you turned the strobe on to see. */
    const raw = (u) => {
      let sum = 0;
      for (let i = 0; i < b.modes.length; i++) {
        const q = strobing ? this.modeEnv[i] * Math.sin(this.strobePhase) : b.q(i);
        sum += b.phi(i + 1, u) * q;
      }
      return sum;
    };

    /* Fixed gain until it saturates - NOT normalised to the beam's own peak.
     *
     * The first version scaled by the current peak so the shape survived the
     * compression, and in doing so threw away the only signal the station
     * exists to carry: off-resonance and on-resonance came out the same
     * SIZE. A beam that wobbles identically wherever you put the dial is not
     * a resonance demonstration, it is noise, and it is why this station was
     * unreadable.
     *
     * So: multiply by GAIN, and only once that would exceed CEIL fall back
     * to a single clamping factor applied across the whole span. Below the
     * ceiling, amplitude differences are real and visible; at the ceiling
     * the shape is still exact, just capped. The alternative - compressing
     * point by point - flattens mode 1's crest into a plateau and turns a
     * sine into something closer to a square wave. */
    let peak = 0;
    for (let i = 0; i <= 24; i++) peak = Math.max(peak, Math.abs(raw(i / 24)));
    const factor = (peak * GAIN > CEIL ? CEIL / peak : GAIN) * this.relax;
    const w = (u) => raw(u) * factor;
    this.response = peak;
    const yieldStress = 250e6;
    const strain = (u) => Math.abs(b.stress(u)) / yieldStress;

    /* Node stillness is measured on the LIVE motion, never on the strobe.
     *
     * The strobe draws every mode at one shared phase, which is a useful lie
     * about the shape and a bad basis for this: adding a residual mode 1 to
     * a ringing mode 2 in phase fills in mode 2's node, and the tick that
     * lit was the wrong one. What matters is whether that point of the beam
     * is actually moving, so each node carries its own motion envelope and
     * is compared against the span's. */
    const live = (u) => {
      let sum = 0;
      for (let i = 0; i < b.modes.length; i++) sum += b.phi(i + 1, u) * b.q(i);
      return sum;
    };
    let livePeak = 0;
    for (let i = 0; i <= 24; i++) livePeak = Math.max(livePeak, Math.abs(live(i / 24)));
    /* These envelopes forget quickly, and forget completely when the dial
     * moves. At the 0.35 s used for the strobe, mode 1's nineteen
     * millimetres was still in the node envelope long after you had tuned
     * away to mode 2's two, so the comparison said "this point is moving"
     * about a point that had been still for a second. History from a
     * frequency you are no longer driving is not evidence about this one. */
    const nDecay = Math.exp(-dt / 0.15);
    if (Math.abs(b.d.f - (this._nodeF ?? 0)) / Math.max(b.d.f, 1) > 0.01) {
      this._nodeF = b.d.f;
      this.nodeEnv = null;
      this.spanEnv = 0;
    }
    this.nodeEnv = this.nodeEnv ?? rig.nodeAt.map(() => 0);
    this.spanEnv = Math.max(livePeak, (this.spanEnv ?? 0) * nDecay);
    const nodeLit = rig.nodeAt.map((u, i) => {
      this.nodeEnv[i] = Math.max(Math.abs(live(u)), this.nodeEnv[i] * nDecay);
      // 0.2 mm of real movement across the span, and under a tenth of it here
      return this.spanEnv > 2e-4 && this.nodeEnv[i] < this.spanEnv * 0.1;
    });

    rig.set(w, strain, b.d.pos, nodeLit);

    // the plate lights the mark you are sitting on; only redraw when it moves
    if (Math.abs(b.d.f - this._stampedAt) > 0.05) {
      this._stampedAt = b.d.f;
      rig.stamp(b.frequencies, b.d.f);
    }

    /* The strobe runs itself. Above about 30 Hz the bar is a smear and the
     * mode shape - the thing you came for - is invisible; below it the real
     * motion is more honest and more satisfying. Making that a lever was
     * asking the viewer to solve a rendering problem. */
    if (b.d.f > 30) this.strobePhase += dt * 2 * Math.PI * 0.4;

    if (this.failure && !this._cracked) {
      this._cracked = true;
      const at = this.sim.env?.at ?? b.peakStress(41).at;
      rig.breakAt(at);
      const p = new THREE.Vector3((at - 0.5) * SPAN, BEAM_Y, 0);
      for (let i = 0; i < 40; i++) this.smoke.emit(p, 1);
    }
  }

  /** Place a mesh for each physical element on the card. */
  _layoutParts() {
    if (this.def.mechanical || this.def.beam) { this.bodies = []; return; }
    if (this._partGroup) { this.card.remove(this._partGroup); }
    const pg = new THREE.Group();
    pg.position.y = 0.006;
    this._partGroup = pg;
    this.card.add(pg);
    this.bodies = [];

    const els = this.sim.ckt.elements.filter((e) => ['R', 'C', 'D', 'L'].includes(e.type));
    const span = 0.33;
    els.forEach((el, i) => {
      let m;
      if (el.type === 'R') m = makeResistor(el.value);
      else if (el.type === 'C') m = makeElectrolytic();
      else if (el.type === 'D') m = el.spec?.iMax ? makeLED() : makeDiode();
      else m = makeDiode();
      const x = els.length === 1 ? 0 : -span / 2 + (span * i) / (els.length - 1);
      const h = el.type === 'C' || (el.type === 'D' && el.spec?.iMax) ? 0.032 : 0.017;
      m.position.set(x, h, 0);
      /* pg floats above the card, so the board is that much further down
       * than the part's own mounting height. */
      groundLeads(m, h + pg.position.y);
      pg.add(m);
      const body = m.userData.body;
      if (body) {
        body.material.userData.baseRough = body.material.roughness;
        body.userData.baseColor = body.material.color.clone();
      }
      this.bodies.push({ el, mesh: m, body, vented: false });
    });
  }

  /** Advance only if this station is the one being used. */
  tick(dt) {
    if (!this.active) { this.ember(dt); this.smoke?.step(dt); return; }
    if (!this.armed) { this._updateParts(dt); return; }
    const tEnd = this.def.pace?.tEnd ?? Infinity;
    const scale = this.def.pace?.scale ?? 1;
    const b = this.sim.bench;
    if (!b.alive || b.t >= tEnd) { this.armed = false; return; }

    const sim = Math.min(dt * scale, tEnd - b.t);
    b.advance(sim, H_MAX[this.def.id] ?? 1e-4);
    this.traces[0].push(b.t, this.probes[0] ? this.probes[0]() : 0);
    this.traces[1].push(b.t, this.probes[1] ? this.probes[1]() : 0);
    if (this.sim.phase) { const [x, y] = this.sim.phase(); this.phase.push(x, y); }

    if (this.rig && this.sim.rig) {
      const x = this.sim.rig.displacement;
      const spec = this.sim.ckt.elements.find((e) => e.ref === 'SPR')?.spec;
      /* x and f are live getters on the elements themselves now, so there is
       * nothing to write here; the view only reads them to draw. */
      this.rig.set(x, spec?.xMax ? Math.abs(x) / spec.xMax : 0);
    }
    if (!b.alive) {
      this.failure = b.failures[0];
      this.armed = false;
      record(this.id, this.failure);
      /* Tell whoever is listening. Station knows nothing about Firestore or
       * the wall on the back of the room - it reports that a part died and
       * main.js decides what, if anything, that means. */
      Station.onBreak?.(this, this.failure);
      this.scar = recall(this.id);
      if (this.rig) {
        if (this.failure.mode === 'set') this.rig.yield_(0.18);
        this._rigPlume();
      }
    }
    this._paint();
    this._updateParts(dt);
  }

  /**
   * Drive every visual from the solver's own numbers.
   *
   * Charring tracks the margin left before the part's rated temperature, so a
   * resistor browns while you still have time to back the knob off. Glow is
   * the blackbody curve against absolute temperature, which is why a resistor
   * failing at 155 degC chars without ever glowing and a fuse element at 900
   * lights up - nobody decided that, the physics did.
   */
  _updateParts(dt) {
    if (this.def.beam) return this._updateBeam(dt);
    const therm = this.sim.bench.thermal;
    let smoking = 0;
    for (const b of this.bodies) {
      const { el, mesh, body } = b;
      const spec = el.spec;

      const lit = mesh.userData.emissive;
      if (lit && spec?.iMax) {
        const f = el.failed ? 0 : Math.min(1, Math.abs(el.i) / spec.iMax);
        lit.emissiveIntensity = f * 2.6;
      }

      if (!spec || !body) continue;
      const T = therm.of(el).T;
      const peak = therm.of(el).peakT;

      if (spec.tMax) {
        // fraction of the way from ambient to the rating, held after failure
        const f = Math.max(0, Math.min(1, (peak - 60) / (spec.tMax - 60)));
        if (Station.thermalView) {
          thermalColour(Math.max(0, (T - 25) / (spec.tMax - 25)), body.material.color);
          body.material.roughness = 0.9;
        } else {
          char(body.material, body.userData.baseColor, el.failed ? Math.max(f, 0.85) : f);
        }
        if (body.material.emissive) {
          /* The blackbody colour is correct and, at the bottom of its range,
           * almost invisible next to a lit bench - dull red heat is genuinely
           * hard to see in a lit room. True, and useless here: the glow is
           * the thing you are meant to notice. So the COLOUR stays physical
           * and the INTENSITY is pushed, which keeps the progression from red
           * through orange to yellow honest while making it readable. */
          incandescence(T, body.material.emissive);
          const over = Math.max(0, (T - 470) / 480);
          body.material.emissiveIntensity = Math.min(4.2, over * 4.2);
        }
        if (T > spec.tMax * 0.78 || (el.failed && peak > spec.tMax * 0.6)) smoking += 1;
      }

      // A can swells before it lets go. The bulge is small - a millimetre on
      // a thirteen millimetre can - and that is exactly how it looks in life.
      if (spec?.vents) {
        const strain = Math.max(
          el.v < 0 && spec.vRev ? -el.v / spec.vRev : 0,
          spec.vMax ? Math.abs(el.v) / spec.vMax : 0,
        );
        const bulge = Math.min(1, Math.max(0, strain - 0.55) / 0.45);
        mesh.scale.set(1 + bulge * 0.09, 1 + bulge * 0.02, 1 + bulge * 0.09);
        if (el.failed && !b.vented) { this._vent(b); b.vented = true; }
      }
    }

    if (smoking && this.smoke) {
      const p = new THREE.Vector3();
      for (const b of this.bodies) {
        const spec = b.el.spec;
        if (!spec?.tMax) continue;
        const peak = therm.of(b.el).peakT;
        if (peak < spec.tMax * 0.78) continue;
        b.mesh.getWorldPosition(p);
        this.card.worldToLocal(p);
        this.smoke.emit(p, 26 * dt);
      }
    }
    if (this._plumeFor > 0) {
      this._plumeFor -= dt;
      this.smoke?.emit(new THREE.Vector3(-0.235, 0.62, 0), 55 * dt);
    }
    if (this.smoke) this.smoke.step(dt);
  }

  /* A mechanical failure does not smoke the way a resistor does, but it is
   * not silent either: a damper that has been driven past its limit sheds oil
   * haze, and a spring going solid throws dust off the plinth. Without this
   * the rig simply stopped, which read as the simulation having crashed
   * rather than the machine having broken.
   */
  _rigPlume() {
    if (!this.smoke) return;
    const at = new THREE.Vector3(-0.235, 0.62, 0);    // damper head, clear of the plinth
    for (let i = 0; i < 90; i++) this.smoke.emit(at, 1);
    this._plumeFor = 3.0;
  }

  /** The can splits at its score mark and the top lifts. */
  _vent(b) {
    const top = b.mesh.userData.top;
    if (top) {
      top.position.y += 0.0022;
      top.rotation.z = 0.22;
      top.rotation.x = 0.1;
    }
    b.mesh.scale.set(1.1, 0.97, 1.1);
    if (this.smoke) {
      const p = new THREE.Vector3();
      b.mesh.getWorldPosition(p);
      this.card.worldToLocal(p);
      for (let i = 0; i < 26; i++) this.smoke.emit(p, 1);
    }
  }

  _paint() {
    const b = this.sim.bench;
    drawPanel(this.screen.ctx, this.screen.canvas.width, this.screen.canvas.height, {
      title: this.title, traces: this.traces, names: this.names,
      phase: this.sim.phase ? this.phase : null, meta: this.sim.meta,
      failure: this.failure, t: b.t, armed: this.armed,
      ghosts: this.ghosts, ghostPhase: this.ghostPhase,
    });
    this.screen.tex.needsUpdate = true;
    /* The supply is not always a supply. At the mechanical bench it drives a
     * force and the loop current IS velocity, so showing volts and milliamps
     * there would be wrong on the one station whose entire point is that the
     * units are a disguise. */
    if (this.console) {
      if (this.console.readOnly) this.console.paintRows(this.readings());
      else this.console.paint();
      return;
    }
    const u = this.def.units ?? { v: 'V', i: 'mA' };
    this.psu.volts.write(`${this.psu.vKnob.value.toFixed(u.v === 'V' ? 2 : 1)}${u.v}`);
    const src = this.sim.ckt.elements.find((e) => e.type === 'V');
    if (u.i === 'mA') {
      this.psu.amps.write(`${(Math.abs(src?.i ?? 0) * 1000).toFixed(0)}mA`);
    } else {
      this.psu.amps.write(`${(this.sim.rig?.velocity ?? 0).toFixed(2)}${u.i}`);
    }
  }

  /**
   * The supply knob moved.
   *
   * Where the supply is a live source - an LED rail, a mains transformer, a
   * driving force - the change applies to the running circuit, so you can
   * turn it up and watch the part respond. Where the parameter is an INITIAL
   * condition, as with the charge on a tank capacitor, there is nothing to
   * change mid-run: that one restarts. Pretending otherwise would show a
   * voltage on the display that the circuit is not using.
   */
  supplyChanged(knob) {
    /* The console's levers are not all supplies. Three of them rebuild the
     * machine - mass, stiffness, damping - and each preserves a different
     * piece of state, which MassSpringDamper.tune is responsible for. Doing
     * it live rather than by restarting matters: half the intuition here
     * comes from stiffening a spring WHILE it is ringing and watching the
     * frequency climb under your hand. */
    if (this.console) {
      const vals = this.console.values();
      for (const pm of this.def.params) if (vals[pm.key] != null) pm.value = vals[pm.key];
      if (this.sim.rig) {
        this.sim.rig.tune({ m: vals.m, c: vals.c, k: vals.k, force: vals.F });
        if (this.sim.meta) {
          this.sim.meta.zeta = this.sim.rig.zeta;
          this.sim.meta.omegaN = this.sim.rig.omegaN;
        }
      } else {
        // an electrical console: the circuit knows how to retune itself
        this.def.tune?.(this.sim, vals);
      }
      this._paint();
      return;
    }
    if (knob === this.psu.iKnob) { this._paint(); return; }
    const v = knob.value;
    if (this.def.id === 'rlc') {
      this.def.params.find((p) => p.key === 'V').value = v;
      this.reset();
      this.arm();
      return;
    }
    const src = this.sim.ckt.elements.find((e) => e.type === 'V');
    if (!src) { this._paint(); return; }
    if (this.def.mechanical) { src.value = v; this._paint(); return; }
    if (typeof src.value === 'function') {
      // an AC source: scale its amplitude, keep its shape
      const f = this.def.params.find((p) => p.key === 'f')?.value ?? 50;
      src.value = (t) => v * Math.sin(2 * Math.PI * f * t);
    } else {
      src.value = v;
    }
    this._paint();
  }

  arm() {
    if (!this.sim.bench.alive || this.sim.bench.t >= (this.def.pace?.tEnd ?? Infinity)) {
      /* Keep the finished run as a ghost before clearing it. Comparing this
       * attempt against the last one is most of what makes repeated tries
       * worth making. */
      this.ghosts = this.traces.map((t) => ({ min: t.min.slice(), max: t.max.slice(), used: t.used }));
      this.ghostPhase = this.phase.pts.slice();
      this.reset();
    }
    this.armed = true;
  }

  /** What the restore control should say for this station. */
  get replaceLabel() {
    if (this.def.beam) return 'fit a new beam';
    return this.def.mechanical ? 'reset the rig' : 'fit a new card';
  }

  /* The same thing in two words, for a 390 px top bar that also has to hold
   * the thermal and flat-panel controls. The long wording is worth keeping on
   * desktop - it says what the action means at this station - but wrapped
   * onto two lines inside its own button it just looks broken. */
  get replaceLabelShort() {
    if (this.def.beam) return 'new beam';
    return this.def.mechanical ? 'reset' : 'new card';
  }

  /** A fresh card, and the record of the last death cleared with it. */
  replace() {
    forget(this.id);
    this.scar = null;
    this.ghosts = null;
    this.ghostPhase = null;
    this._plumeFor = 0;
    this.smoke?.reset();
    if (this.rig) this.rig.restore();
    this.reset();
  }

  /** Carry a remembered failure onto the geometry at load time. */
  _applyScar() {
    for (const b of this.bodies) {
      if (b.el.ref !== this.scar.ref) continue;
      if (b.body) char(b.body.material, b.body.userData.baseColor, 0.95);
      if (b.el.spec?.vents) { this._vent(b); b.vented = true; }
      b.el.failed = { mode: this.scar.mode, cause: this.scar.cause };
    }
    this.failure = { ...this.scar, value: 0, limit: 0, unit: '', dissipated: 0, tMax: null, overBy: null };
    this._paint();
  }

  /* Embers: a station you killed recently keeps glowing faintly and smoking
   * after its lamp goes out. Standing in the middle of the dark room, the
   * damage you caused is the only thing you can see - no UI involved. */
  ember(dt) {
    const f = freshness(this.scar);
    if (f <= 0 || !this.smoke) return;
    for (const b of this.bodies) {
      if (b.el.ref !== this.scar.ref || !b.body?.material?.emissive) continue;
      b.body.material.emissive.setRGB(0.32 * f, 0.055 * f, 0.01 * f);
      b.body.material.emissiveIntensity = 1;
      if (Math.random() < f * 0.5) {
        const p = new THREE.Vector3();
        b.mesh.getWorldPosition(p);
        this.card.worldToLocal(p);
        this.smoke.emit(p, 7 * dt);
      }
    }
    this.smoke.step(dt);
  }

  // -------------------------------------------------------------- lighting
  /** Where to stand to see this station from `d` metres in front of it. */
  standAt(d) {
    d = Math.max(this.minStand ?? 1.0, d);
    /* Eye height follows the subject: level with a bench, and level with the
     * middle of a rig that is taller than a person. Standing at 1.33 m in
     * front of a 1.8 m machine means looking at its knees. */
    const eye = this.def.mechanical
      ? this.subjectY + 0.1
      : Math.min(1.5, 1.2 + d * 0.12);
    return this._front(Math.max(0.62, d), eye);
  }

  step(dt) {
    const k = 1 - Math.exp(-dt / 0.26);
    this.wake += (this.wakeTarget - this.wake) * k;
    const w = this.wake;
    /* Held deliberately under the bloom threshold. These are unlit materials,
     * so before bloom existed their only job was to be visible across a dark
     * room; afterwards they became the brightest things in the scene and the
     * rim strip blazed like a strip light. They are wayfinding, not light
     * sources - only genuinely hot parts and the lamps should bloom. */
    this.standbyMat.color.setRGB(0.20 * (1 - w) + 0.07, 0.44 * (1 - w) + 0.12, 0.56 * (1 - w) + 0.15);
    this.rimMat.color.setRGB(0.12 + w * 0.36, 0.21 + w * 0.21, 0.27 - w * 0.05);
    this.screen.face.material.opacity = w;
    this.screen.face.material.transparent = true;
    /* The segment displays are unlit materials, so they ignore the lamp and
     * stayed brightly green on every sleeping bench - a dark room full of
     * glowing readouts, which undercuts the whole mechanic. They fade with
     * the station now, down to a trace that reads as standby. */
    for (const r of this.psu ? [this.psu.volts, this.psu.amps] : []) {
      r.mesh.material.transparent = true;
      r.mesh.material.opacity = 0.12 + w * 0.88;
    }
    if (this.console) this.console.face.material.opacity = 0.12 + w * 0.88;
    this.active = w > 0.5;
  }
}

Station.thermalView = false;

const H_MAX = { rlc: 2e-6, rect: 4e-6, led: 5e-5, rc: 2e-4, msd: 5e-4 };
