/* Bench instruments: the supply and the screen.
 *
 * The supply knob is the verb of the whole piece - almost everything that
 * happens here happens because somebody turned it too far - so it is a real
 * object you drag rather than a slider overlaid on the scene. Dragging a knob
 * that has weight and detents is the difference between operating a machine
 * and filling in a form.
 *
 * The screen is the Phase 2 analysis panel drawn into an offscreen canvas and
 * used as a texture. One drawing path serves the flat page and the bench, so
 * the instrument on the bench is the instrument, not a picture of it.
 */

import * as THREE from '../libs/three.module.js';

const DARK = 0x16181c;

export class Knob {
  constructor({ radius = 0.019, height = 0.016, label = '', min = 0, max = 1, value = 0 }) {
    this.min = min; this.max = max; this.value = value;
    this.label = label;

    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.92, height, 28),
      new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.42, metalness: 0.55 }),
    );
    body.castShadow = true;
    g.add(body);

    /* Knurling: 24 shallow flutes as ONE instanced mesh. As separate meshes
     * this was 24 draw calls per knob, 240 across the room - more than the
     * entire rest of the scene - for a detail you only see when leaning in. */
    const flute = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.0016, height * 0.92, 0.0022),
      new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.4 }),
      24,
    );
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      q.setFromAxisAngle(up, -a);
      m4.compose(
        new THREE.Vector3(Math.cos(a) * radius * 0.97, 0, Math.sin(a) * radius * 0.97),
        q, one,
      );
      flute.setMatrixAt(i, m4);
    }
    flute.instanceMatrix.needsUpdate = true;
    g.add(flute);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.78, radius * 0.78, 0.0012, 24),
      new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: 0.35, metalness: 0.6 }),
    );
    cap.position.y = height / 2 + 0.0005;
    g.add(cap);

    this.pointer = new THREE.Mesh(
      new THREE.BoxGeometry(0.0022, 0.0014, radius * 0.72),
      new THREE.MeshBasicMaterial({ color: 0xe8a35c }),
    );
    this.pointer.position.set(0, height / 2 + 0.0014, -radius * 0.36);
    g.add(this.pointer);

    this.dial = g;
    this.group = new THREE.Group();
    this.group.add(g);
    this._apply();
  }

  /** 300 degrees of travel, the usual for a panel pot. */
  _apply() {
    const t = (this.value - this.min) / (this.max - this.min);
    this.dial.rotation.y = -(t - 0.5) * (Math.PI * 300 / 180);
  }

  set(v) {
    this.value = Math.max(this.min, Math.min(this.max, v));
    this._apply();
    return this.value;
  }

  /** Drag vertically to turn. Horizontal drags are for looking around. */
  dragBy(dy) { return this.set(this.value - dy * (this.max - this.min) * 0.006); }
}

/** A segment-style readout drawn into a texture. */
export class Readout {
  constructor(width = 0.13, height = 0.038, digits = 5) {
    this.digits = digits;
    this.cv = document.createElement('canvas');
    this.cv.width = 384; this.cv.height = 112;
    this.ctx = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const m = new THREE.MeshBasicMaterial({ map: this.tex });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), m);
    this.text = '';
    this.write('----');
  }

  write(s) {
    if (s === this.text) return;         // the texture upload is the expensive part
    this.text = s;
    const { ctx, cv } = this;
    ctx.fillStyle = '#0a0d0c';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.font = '600 68px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    // ghost segments behind the value: what an LED display actually looks like
    ctx.fillStyle = 'rgba(80,240,170,.07)';
    ctx.fillText('8'.repeat(this.digits), cv.width - 16, cv.height / 2);
    ctx.fillStyle = '#4ef0aa';
    ctx.shadowColor = '#2fe59a'; ctx.shadowBlur = 16;
    ctx.fillText(s, cv.width - 16, cv.height / 2);
    ctx.shadowBlur = 0;
    this.tex.needsUpdate = true;
  }
}

/* The supply lever.
 *
 * A knob was the wrong control. The verb of this piece is "push it until it
 * breaks" - a committing gesture - and a dial asks for a precise one. Worse,
 * a knob is a small target needing an accurate grab and then about 170 px of
 * drag for full travel, which on a phone is a fight.
 *
 * A lever is a large target from any angle, its direction is unambiguous, its
 * position is readable from across the room, and shoving it forward is the
 * thing you are actually doing. It is also what a lab rheostat looks like.
 */
export class Lever {
  constructor({ min = 0, max = 24, value = 5, length = 0.17 }) {
    this.min = min; this.max = max; this.value = value;
    this.throw_ = Math.PI * 0.62;          // ~112 degrees of travel

    const g = new THREE.Group();

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.016, 0.21),
      new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.5, metalness: 0.55 }),
    );
    base.position.y = 0.008;
    base.castShadow = true;
    g.add(base);

    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(0.026, 0.004, 0.175),
      new THREE.MeshStandardMaterial({ color: 0x0b0d0f, roughness: 0.9 }),
    );
    slot.position.y = 0.0165;
    g.add(slot);

    // scale marks beside the slot: the setting is readable without a display
    const tickMat = new THREE.MeshBasicMaterial({ color: 0x5f666d });
    for (let i = 0; i <= 8; i++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(i % 4 ? 0.014 : 0.024, 0.002, 0.003), tickMat);
      t.position.set(i % 4 ? 0.03 : 0.035, 0.0172, -0.082 + (i / 8) * 0.164);
      g.add(t);
    }

    const pivot = new THREE.Group();
    pivot.position.set(0, 0.02, 0);
    g.add(pivot);

    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, length, 0.022),
      new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.38, metalness: 0.7 }),
    );
    arm.position.y = length / 2;
    arm.castShadow = true;
    pivot.add(arm);

    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(0.027, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0x9a6b35, roughness: 0.3, metalness: 0.85 }),
    );
    handle.position.y = length;
    handle.castShadow = true;
    pivot.add(handle);
    this.handle = handle;

    this.pivot = pivot;
    this.group = g;
    this.length = length;
    this._apply();
  }

  _apply() {
    const t = (this.value - this.min) / (this.max - this.min);
    // zero is back toward the operator, full is pushed away
    this.pivot.rotation.x = this.throw_ * (0.5 - t);
  }

  set(v) {
    this.value = Math.max(this.min, Math.min(this.max, v));
    this._apply();
    return this.value;
  }

  /* Roughly 120 px for the whole range, deliberately loose: this control is
   * for committing, not trimming. The wheel is the fine adjustment. */
  dragBy(dy) { return this.set(this.value - dy * (this.max - this.min) / 120); }
  nudge(steps) { return this.set(this.value + steps * (this.max - this.min) / 60); }
}


/* A stacked control console.
 *
 * One lever per parameter, in a single column, each with its label and
 * current value set large beside it.
 *
 * Two reasons for the column rather than controls spread over a bench. It
 * keeps every control inside the framed view on a phone, where the vertical
 * field of view is all you have to spend. And it puts the four numbers in one
 * block you can read at a glance, instead of hunting for a two-centimetre
 * segment display per control.
 *
 * The levers travel ACROSS their row, not up and down. Stacked controls
 * dragged vertically are ambiguous - a downward drag could mean "less" or
 * "the one below" - so the motion runs perpendicular to the stacking.
 */
export class Console {
  constructor(items, { width = 0.52, rowH = 0.17, readOnly = false } = {}) {
    /* A read-only console is a READOUT, not a control surface.
     * Where a station's real control lives on screen as a dial you can
     * actually hit with a thumb, leaving dummy levers on the panel invites
     * people to grab a ten-pixel sphere two and a half metres away, which is
     * the complaint that caused all of this. */
    this.readOnly = readOnly;
    this.items = items.map((it) => ({
      ...it,
      // 400 N/m wants no decimal point; 2.0 kg is meaningless without one
      dp: it.dp ?? (it.max >= 100 ? 0 : 1),
    }));
    this.rowH = rowH;
    this.width = width;
    const h = rowH * this.items.length + 0.04;
    this.height = h;

    const g = new THREE.Group();
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(width, h, 0.032),
      new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.58, metalness: 0.42 }),
    );
    panel.castShadow = true; panel.receiveShadow = true;
    g.add(panel);

    /* 512, not 1280. Measured: this panel covers 98-109 device pixels on a
     * phone and 172-257 on a desktop, so a 1280-wide texture was five to
     * thirteen times oversampled - two of them alone were 21 MB of video
     * memory for text you could already read. At 512 it is still 2x
     * oversampled on the widest desktop view, which is invisible, and the
     * saving is about 85%. */
    const CANVAS_W = 512;
    const PPM = CANVAS_W / width;            // canvas pixels per metre
    this.ppm = PPM;
    this.cv = document.createElement('canvas');
    this.cv.width = CANVAS_W;
    this.cv.height = Math.round(h * PPM);
    this.ctx = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(width, h),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true }),
    );
    face.position.z = 0.0166;
    g.add(face);
    this.face = face;

    // levers live in the right-hand third; the numbers get the left two-thirds
    this.leverX = width * 0.5 - 0.075;
    this.levers = this.items.map((it, i) => {
      const lv = new RowLever(it);
      lv.key = it.key;
      if (!readOnly) {
        lv.group.position.set(this.leverX, this._rowY(i), 0.018);
        g.add(lv.group);
      }
      return lv;
    });

    this.group = g;
    this.paint();
  }

  _rowY(i) { return this.height / 2 - 0.02 - this.rowH * (i + 0.5); }

  value(key) {
    const lv = this.levers.find((l) => l.key === key);
    return lv ? lv.value : undefined;
  }

  values() {
    return Object.fromEntries(this.levers.map((l) => [l.key, l.value]));
  }

  /** Draw arbitrary rows - for a read-only panel showing live readings. */
  paintRows(rows) {
    this._rows = rows;
    this.paint();
  }

  paint() {
    const { ctx, cv, ppm } = this;
    const rows = this._rows;
    const m2px = (v) => v * ppm;
    const rowPx = m2px(this.rowH);

    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#15181c';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = 'rgba(255,255,255,.045)';
    ctx.fillRect(0, 0, cv.width, m2px(0.004));

    this.items.forEach((it, i) => {
      // canvas y grows downward; row 0 sits at the top
      const cy = cv.height / 2 - m2px(this._rowY(i));
      const pad = m2px(0.014);

      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.022)' : 'rgba(255,255,255,.045)';
      ctx.fillRect(pad, cy - rowPx * 0.42, cv.width - pad * 2, rowPx * 0.84);

      const row = rows?.[i];
      const lv = this.levers?.[i];

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#7d8893';
      ctx.font = `600 ${Math.round(rowPx * 0.25)}px ui-monospace, Menlo, monospace`;
      ctx.fillText((row?.label ?? it.label).toUpperCase(), pad * 2, cy - rowPx * 0.09);

      const num = row ? String(row.value) : (lv ? lv.value : it.value).toFixed(it.dp);
      ctx.fillStyle = '#f0e2c8';
      ctx.font = `600 ${Math.round(rowPx * 0.46)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(num, pad * 2, cy + rowPx * 0.3);
      const w = ctx.measureText(num).width;
      ctx.fillStyle = '#7d8893';
      ctx.font = `500 ${Math.round(rowPx * 0.21)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(row?.unit ?? it.unit, pad * 2 + w + m2px(0.008), cy + rowPx * 0.3);

      /* The printed track has to sit where the handle actually goes, which is
       * an arc: the handle is on the end of an arm, not in a slot. Drawing a
       * straight line here left the brass cap visibly off its own groove. */
      const px = cv.width / 2 + m2px(this.leverX);
      const py = cy - m2px(RowLever.ARM);
      if (!this.readOnly) {
        ctx.strokeStyle = 'rgba(255,255,255,.14)';
        ctx.lineWidth = m2px(0.0025);
        ctx.beginPath();
        ctx.arc(px, cy, m2px(RowLever.ARM), -Math.PI / 2 - RowLever.SWEEP,
                -Math.PI / 2 + RowLever.SWEEP);
        ctx.stroke();
      }
      void py;
    });
    this.tex.needsUpdate = true;
  }
}

/* One row's lever: a short arm with a brass cap, swinging across its row. */
class RowLever {
  static ARM = 0.055;
  static SWEEP = 0.72;     // radians either side of upright

  constructor({ min, max, value, step, log = false }) {
    this.min = min; this.max = max; this.value = value;
    this.step = step ?? (max - min) / 100;
    /* A log lever, for anything you hunt across a decade or more.
     * Resonance is the case that forces it: a tank with a Q of 20 is sharp
     * to a few percent of its centre frequency, so on a linear lever
     * spanning 5 to 250 Hz the entire peak is about one pixel wide and the
     * station is unplayable. Log travel gives constant resolution per
     * octave, which is how you actually search for a resonance. */
    this.log = log && min > 0;

    const g = new THREE.Group();
    const pivot = new THREE.Group();
    g.add(pivot);
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.013, RowLever.ARM, 0.013),
      new THREE.MeshStandardMaterial({ color: 0x4e555e, roughness: 0.4, metalness: 0.72 }),
    );
    arm.position.y = RowLever.ARM / 2;
    arm.castShadow = true;
    pivot.add(arm);
    const boss = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.016, 16),
      new THREE.MeshStandardMaterial({ color: 0x2e3339, roughness: 0.5, metalness: 0.6 }),
    );
    boss.rotation.x = Math.PI / 2;
    g.add(boss);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.020, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xa8763a, roughness: 0.28, metalness: 0.88 }),
    );
    cap.position.y = RowLever.ARM;
    cap.castShadow = true;
    pivot.add(cap);
    this.handle = cap;
    this.pivot = pivot;
    this.group = g;
    this._apply();
  }

  /** Lever travel 0..1 for the current value. */
  _t() {
    return this.log
      ? Math.log(this.value / this.min) / Math.log(this.max / this.min)
      : (this.value - this.min) / (this.max - this.min);
  }

  /** The value at lever travel t. */
  _v(t) {
    return this.log
      ? this.min * (this.max / this.min) ** t
      : this.min + t * (this.max - this.min);
  }

  _apply() { this.pivot.rotation.z = -(this._t() * 2 - 1) * RowLever.SWEEP; }

  set(v) {
    this.value = Math.max(this.min, Math.min(this.max, v));
    this._apply();
    return this.value;
  }

  /** Move by a fraction of the lever's full travel, whatever its scale. */
  _by(dt) { return this.set(this._v(Math.max(0, Math.min(1, this._t() + dt)))); }

  /* Dragged ACROSS the row, so a stack of these is never ambiguous.
   * 170 px of travel spans the full range: enough that you can land on a
   * value, short enough that you can cross the range without letting go. */
  dragBy(dy, dx = 0) { return this._by(dx / 170); }
  nudge(steps) { return this._by(steps / 60); }
}

export function makePSU({ vMax = 24 }) {
  const g = new THREE.Group();
  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.105, 0.17),
    new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.52, metalness: 0.35 }),
  );
  caseMesh.position.y = 0.0525;
  caseMesh.castShadow = true; caseMesh.receiveShadow = true;
  g.add(caseMesh);

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.235, 0.1),
    new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.6 }),
  );
  face.position.set(0, 0.053, 0.0851);
  g.add(face);

  const volts = new Readout(0.1, 0.03, 5);
  volts.mesh.position.set(-0.058, 0.078, 0.0854);
  g.add(volts.mesh);

  const amps = new Readout(0.1, 0.03, 5);
  amps.mesh.position.set(0.058, 0.078, 0.0854);
  g.add(amps.mesh);

  // the supply control stands on the bench in front of the case, not on it
  const vKnob = new Lever({ min: 0, max: vMax, value: 5 });
  vKnob.group.position.set(-0.015, 0.0, 0.235);
  g.add(vKnob.group);

  const iKnob = new Knob({ radius: 0.021, height: 0.017, label: 'current limit', min: 0.01, max: 2, value: 2 });
  iKnob.group.position.set(0.072, 0.0335, 0.0955);
  iKnob.group.rotation.x = Math.PI / 2;
  g.add(iKnob.group);

  return { group: g, volts, amps, vKnob, iKnob, hitbox: caseMesh };
}

/** The bench screen: a panel whose face is an offscreen 2D canvas. */
export function makeScreen({ width = 0.46, height = 0.3 }) {
  const g = new THREE.Group();
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.022, height + 0.022, 0.022),
    new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.55, metalness: 0.3 }),
  );
  bezel.castShadow = true;
  g.add(bezel);

  const cv = document.createElement('canvas');
  /* Measured at 285 device pixels on a 1440 desktop and 108-119 on a phone,
   * so 1024 was 3.6x oversampled at best. 640 keeps a comfortable margin on
   * the widest view and is a 2.5x memory saving across seven screens. */
  cv.width = 640; cv.height = Math.round(640 * (height / width));
  const tex = new THREE.CanvasTexture(cv);
  /* Canvas textures default to NoColorSpace, which three.js treats as
   * linear and then gamma-encodes on output: every dark instrument face
   * was arriving on screen two stops too light, grey instead of near
   * black. These are authored in sRGB, so say so. */
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
  face.position.z = 0.0115;
  g.add(face);

  return { group: g, canvas: cv, ctx: cv.getContext('2d'), tex, face };
}
