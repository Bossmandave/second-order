/* Physical components.
 *
 * Built from primitives rather than modelled, because every one of them is a
 * body of revolution with a few rings on it and because they have to CHANGE:
 * a resistor's bands come from its value, and charring has to drive its
 * colour at runtime. A modelled asset would freeze both.
 *
 * Geometries and the materials that never vary are shared. The ones that do -
 * anything that will char, glow or vent later - are cloned per instance, so
 * one dying part does not take its siblings with it.
 */

import * as THREE from '../libs/three.module.js';

const BAND = [0x1b1b1b, 0x6b4423, 0xc0392b, 0xd98f3a, 0xd8c547,
              0x4e9a3f, 0x3b6fb5, 0x8e5bb5, 0x9a9a9a, 0xf2f2f2];

/* Components are drawn FOUR TIMES life size.
 *
 * Built at true scale first, which was a mistake made by default rather than
 * decided: an 11 mm resistor on a bench in a room at human scale is a speck.
 * You had to put the camera 12 cm from the board to see anything, and what
 * you found when you got there was not worth the trip.
 *
 * Nobody measures a resistor against a ruler in a browser. Four times up, a
 * board reads from standing height and the colour bands are legible without
 * leaning in at all - leaning in becomes a choice rather than the only way to
 * see the thing. Physical scale is a presentation decision here, not a fact
 * to be faithful to.
 */
export const S = 4;
const geo = {
  res: new THREE.CylinderGeometry(0.0032 * S, 0.0032 * S, 0.0115 * S, 16),
  band: new THREE.CylinderGeometry(0.00335 * S, 0.00335 * S, 0.0013 * S, 16),
  lead: new THREE.CylinderGeometry(0.00035 * S, 0.00035 * S, 0.011 * S, 7),
  can: new THREE.CylinderGeometry(0.0045 * S, 0.0045 * S, 0.013 * S, 20),
  ledDome: new THREE.SphereGeometry(0.0026 * S, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  ledBody: new THREE.CylinderGeometry(0.0026 * S, 0.0026 * S, 0.004 * S, 16),
  ledFlange: new THREE.CylinderGeometry(0.0031 * S, 0.0031 * S, 0.0008 * S, 16),
  diode: new THREE.CylinderGeometry(0.0019 * S, 0.0019 * S, 0.0055 * S, 14),
};

const mat = {
  lead: new THREE.MeshStandardMaterial({ color: 0xbdbdc4, roughness: 0.34, metalness: 0.92 }),
  canSleeve: new THREE.MeshStandardMaterial({ color: 0x1f2a3a, roughness: 0.42, metalness: 0.1 }),
  canTop: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.85 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x4a0b0b, roughness: 0.15, metalness: 0.0,
                                          emissive: 0xff2a1a, emissiveIntensity: 0 }),
  diodeBody: new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.4, metalness: 0.1 }),
};

/** Digit triplet for a resistance, E24-style: two significant figures + decade. */
function bands(ohms) {
  if (!(ohms > 0)) return [0, 0, 0];
  const d = Math.floor(Math.log10(ohms)) - 1;
  const sig = Math.round(ohms / Math.pow(10, d));
  return [Math.floor(sig / 10) % 10, sig % 10, Math.max(0, Math.min(9, d))];
}

const LEAD_R = 0.00035 * S;
const LEAD_GEO_LEN = 0.011 * S;   // the length geo.lead is actually built at

function leads(group, len = LEAD_GEO_LEN, gap = 0.0085 * S) {
  /* geo.lead is one fixed length, so a caller asking for a shorter lead used
   * to get a full-length cylinder positioned as though it were short - the
   * far end landed past where the caller thought it was. Scaling it means
   * the end is where the arithmetic says, which matters now that something
   * has to meet it. */
  group.userData.leadEnds = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(geo.lead, mat.lead);
    l.rotation.z = Math.PI / 2;
    l.scale.y = len / LEAD_GEO_LEN;
    l.position.x = s * (gap / 2 + len / 2);
    group.add(l);
    group.userData.leadEnds.push(s * (gap / 2 + len));
  }
}

/* Take the leads down into the board.
 *
 * Through-hole parts were sitting on nothing: body a couple of centimetres
 * up, two horizontal wire stubs, and open air between them and the card. It
 * reads as a part floating above a circuit rather than soldered into one -
 * which is what you notice first, before any of the physics.
 *
 * A real lead leaves the body sideways, turns ninety degrees and goes
 * through the board, so that is what this builds: a knee at the end of each
 * stub and a leg from there to the surface. The drop is passed in because
 * only the station knows how high it mounted the part.
 */
export function groundLeads(group, drop) {
  const ends = group.userData.leadEnds;
  if (!ends || !(drop > 0)) return;
  for (const x of ends) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(LEAD_R, LEAD_R, drop, 7), mat.lead);
    leg.position.set(x, -drop / 2, 0);
    group.add(leg);
    /* No sphere at the bend. One was there to round the corner, but at this
     * radius it covers about a pixel from where the station is actually
     * viewed, and every part carries two - paid for on every card, in the
     * one budget this project is already tightest on. The two cylinders
     * meeting is enough. */
  }
}

export function makeResistor(ohms) {
  const g = new THREE.Group();
  // cloned: this body gets repainted as it chars
  const body = new THREE.Mesh(geo.res, new THREE.MeshStandardMaterial({
    color: 0xd6c6a4, roughness: 0.62, metalness: 0.02,
  }));
  body.rotation.z = Math.PI / 2;
  body.castShadow = true;
  g.add(body);

  const code = bands(ohms);
  code.forEach((d, i) => {
    const b = new THREE.Mesh(geo.band, new THREE.MeshStandardMaterial({
      color: BAND[d], roughness: 0.55,
    }));
    b.rotation.z = Math.PI / 2;
    b.position.x = (-0.0036 + i * 0.0026) * S;
    g.add(b);
  });
  const tol = new THREE.Mesh(geo.band, new THREE.MeshStandardMaterial({ color: 0xb8860b, roughness: 0.4, metalness: 0.5 }));
  tol.rotation.z = Math.PI / 2; tol.position.x = 0.0043 * S;
  g.add(tol);

  /* Short. A through-hole part is seated close to the board with its leads
   * bent down almost at the body; long horizontal runs are what made these
   * look suspended above the card rather than soldered into it. */
  leads(g, 0.0042 * S, 0.0135 * S);
  g.userData.body = body;
  return g;
}

export function makeElectrolytic() {
  const g = new THREE.Group();
  const sleeve = new THREE.Mesh(geo.can, mat.canSleeve.clone());
  sleeve.castShadow = true;
  g.add(sleeve);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.00452 * S, 0.00452 * S, 0.0006 * S, 20), mat.canTop);
  top.position.y = 0.0068 * S;
  g.add(top);
  /* The score mark. A real can is stamped with a cross or a K so it ruptures
   * where the designer chose; it is also the obvious place to split it open
   * when this one vents. */
  const scoreMat = new THREE.MeshStandardMaterial({ color: 0x6d7278, roughness: 0.5, metalness: 0.6 });
  for (const r of [0, Math.PI / 2]) {
    const sc = new THREE.Mesh(new THREE.BoxGeometry(0.0082 * S, 0.0004 * S, 0.0007 * S), scoreMat);
    sc.position.y = 0.00715 * S; sc.rotation.y = r;
    g.add(sc);
  }
  // the polarity stripe, so putting it in backwards is visibly a choice
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.0012 * S, 0.0125 * S, 0.0003 * S), new THREE.MeshStandardMaterial({ color: 0xd8dde3 }));
  stripe.position.set(0, 0, 0.00452 * S);
  g.add(stripe);

  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(geo.lead, mat.lead);
    l.position.set(s * 0.0018 * S, -0.0115 * S, 0);
    g.add(l);
  }
  g.userData.body = sleeve;
  g.userData.top = top;
  return g;
}

export function makeLED(colour = 0xff2a1a) {
  const g = new THREE.Group();
  const m = mat.glass.clone();
  m.color = new THREE.Color(colour).multiplyScalar(0.28);
  m.emissive = new THREE.Color(colour);
  const dome = new THREE.Mesh(geo.ledDome, m);
  dome.position.y = 0.002 * S;
  const body = new THREE.Mesh(geo.ledBody, m);
  const flange = new THREE.Mesh(geo.ledFlange, m);
  flange.position.y = -0.0021 * S;
  g.add(dome, body, flange);
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(geo.lead, mat.lead);
    l.position.set(s * 0.0013 * S, -0.0075 * S, 0);
    l.scale.y = s > 0 ? 1 : 0.8;          // cathode is the short leg
    g.add(l);
  }
  g.userData.emissive = m;
  g.userData.body = dome;
  return g;
}

export function makeDiode() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo.diode, mat.diodeBody.clone());
  body.rotation.z = Math.PI / 2;
  body.castShadow = true;
  g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.00195 * S, 0.00195 * S, 0.0008 * S, 14),
                              new THREE.MeshStandardMaterial({ color: 0xd8dde3 }));
  band.rotation.z = Math.PI / 2; band.position.x = 0.0018 * S;
  g.add(band);
  leads(g, 0.0038 * S, 0.0065 * S);
  g.userData.body = body;
  return g;
}

/** The experiment card: a small board with a label edge. */
export function makeCard(label) {
  const g = new THREE.Group();
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.009, 0.27),
    new THREE.MeshStandardMaterial({ color: 0x14341f, roughness: 0.55, metalness: 0.08 }),
  );
  board.castShadow = true; board.receiveShadow = true;
  g.add(board);

  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.03, 0.009),
    new THREE.MeshStandardMaterial({ color: 0xcdb58a, roughness: 0.75 }),
  );
  edge.position.set(0, 0.005, 0.1395);
  g.add(edge);

  // gold fingers along the back edge, where it seats into the bench
  const fingerMat = new THREE.MeshStandardMaterial({ color: 0xcfa94a, roughness: 0.28, metalness: 0.9 });
  for (let i = 0; i < 8; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.010, 0.030), fingerMat);
    f.position.set(-0.16 + i * 0.046, 0, -0.132);
    g.add(f);
  }
  g.userData.board = board;
  g.userData.label = label;
  return g;
}

/** Silkscreen-style text on the card edge, drawn once into a texture. */
export function labelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 40;
  const x = c.getContext('2d');
  x.fillStyle = '#cdb58a'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#2a2318';
  x.font = '600 22px ui-monospace, Menlo, monospace';
  x.textBaseline = 'middle';
  x.letterSpacing = '3px';
  x.fillText(text.toUpperCase(), 14, 21);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;   // authored in sRGB, like every canvas here
  t.anisotropy = 4;
  return t;
}
