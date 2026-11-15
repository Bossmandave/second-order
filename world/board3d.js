import * as THREE from 'three';

/* The failure wall.
 *
 * It hangs on the back wall, behind where you start - so you meet it on the
 * way out rather than before you have done anything, and re-centring puts
 * your back to it. Everything on it is a part that somebody destroyed.
 *
 * The panel is unlit on purpose. The room is dark by design and lit only
 * where a station is, so a board relying on the scene's lights would be a
 * black rectangle from everywhere except directly under a lamp. A backlit
 * notice board is also simply what a workshop has: the shading is painted
 * into the texture, which costs no light, no shadow map and no draw calls
 * beyond the one.
 *
 * Hung high, above eye level. You start a little under a metre from this
 * wall, and at that range a board centred on your eyeline is not a board -
 * it is the whole screen, cropped. Up at 1.78 m it reads as a sign over a
 * door from close to, and squares up as you back into the room.
 */

const W = 1024, H = 768;
const PAD = 44;
const LINE = 25;             // tag line spacing; how many fit is worked out below

const LABEL = { lamp: 'LAMPS', fuse: 'FUSES', res: 'RESISTORS', cap: 'CAPS',
  diode: 'DIODES', beam: 'BEAMS', rig: 'RIGS' };
const ORDER = ['lamp', 'fuse', 'res', 'cap', 'diode', 'beam', 'rig'];

export class FailureWall {
  constructor(scene) {
    this.cv = document.createElement('canvas');
    this.cv.width = W; this.cv.height = H;
    this.ctx = this.cv.getContext('2d');

    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.54, 1.155),
      new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }),
    );
    panel.position.set(0, 1.78, 2.56);
    panel.rotation.y = Math.PI;        // faces back into the room
    scene.add(panel);

    // a shallow case around it, so it is a fixture rather than a decal
    const caseMat = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.7 });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.64, 1.255, 0.07), caseMat);
    shell.position.set(0, 1.78, 2.60);
    scene.add(shell);

    this.panel = panel;
    this.state = { counts: {}, tags: [], synced: false };
    this.paint();
  }

  set(state) { this.state = state; this.paint(); }

  paint() {
    const c = this.ctx;
    const { counts, tags, synced } = this.state;

    c.fillStyle = '#0c0e10'; c.fillRect(0, 0, W, H);
    // a faint vertical gradient, so it reads as a lit surface not a flat fill
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(255,230,190,0.055)');
    g.addColorStop(1, 'rgba(255,230,190,0.012)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    c.strokeStyle = '#2a2f36'; c.lineWidth = 3;
    c.strokeRect(PAD * 0.5, PAD * 0.5, W - PAD, H - PAD);

    c.textBaseline = 'alphabetic';
    c.font = '600 38px ui-monospace, Menlo, Consolas, monospace';
    c.fillStyle = '#e8a35c';
    c.fillText('FAILURE LOG', PAD, PAD + 46);

    c.font = '400 19px ui-monospace, Menlo, Consolas, monospace';
    c.fillStyle = '#6d7682';
    const note = synced ? 'EVERY PART BROKEN IN THIS BAY' : 'THIS MACHINE ONLY — NOT CONNECTED';
    c.textAlign = 'right';
    c.fillText(note, W - PAD, PAD + 44);
    c.textAlign = 'left';

    /* The tally. Two rows of three, numbers big enough to read from the
     * middle of the floor - this is the part that says how many people have
     * been through, and it should land before any individual line does. */
    let y = PAD + 96;
    /* Only kinds that have actually died get a column. A permanent zero
     * among six real numbers reads as something broken rather than as a part
     * nobody has managed to kill yet; RESISTORS turns up the first time
     * somebody cooks one. */
    const shown = ORDER.filter((k) => (counts[k] ?? 0) > 0);
    shown.forEach((k, i) => {
      const col = i % 4, row = (i / 4) | 0;
      const x = PAD + col * ((W - PAD * 2) / 4);
      const yy = y + row * 80;
      c.font = '400 17px ui-monospace, Menlo, Consolas, monospace';
      c.fillStyle = '#6d7682';
      c.fillText(LABEL[k], x, yy);
      c.font = '600 38px ui-monospace, Menlo, Consolas, monospace';
      c.fillStyle = '#c2c8d0';
      c.fillText(String(counts[k] ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','), x, yy + 44);
    });

    y += 80 * Math.max(1, Math.ceil(shown.length / 4)) + 50;
    c.strokeStyle = '#23282e'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(PAD, y); c.lineTo(W - PAD, y); c.stroke();

    c.font = '400 17px ui-monospace, Menlo, Consolas, monospace';
    c.fillStyle = '#6d7682';
    c.fillText('MOST RECENT', PAD, y + 30);

    /* How many lines fit is arithmetic, not a guess. The tally above is one
     * row or two depending on how many kinds have been killed, so a fixed
     * count ran the list off the bottom edge the moment a sixth kind
     * appeared. */
    const top = y + 60;
    const fit = Math.max(1, Math.floor((H - PAD - top) / LINE));
    const rows = tags.slice(-fit).reverse();
    c.font = '400 21px ui-monospace, Menlo, Consolas, monospace';
    rows.forEach((t, i) => {
      // newest brightest, fading down the list: the wall has a direction
      const f = 1 - (i / fit) * 0.55;
      c.fillStyle = `rgba(190,199,210,${f.toFixed(3)})`;
      c.fillText(t, PAD, top + i * LINE);
    });
    if (!rows.length) {
      c.fillStyle = '#4a515a';
      c.fillText('nothing broken yet', PAD, top);
    }

    this.tex.needsUpdate = true;
  }
}
