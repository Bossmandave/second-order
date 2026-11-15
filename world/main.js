import * as THREE from '../libs/three.module.js';
import { buildBay, BAY } from './bay.js';
import { FailureWall } from './board3d.js';
import { load as loadWall, post as postWall, tagFor } from '../net/wall.js';
import { Station } from './station.js';
import { LightPool } from './lights.js';
import { Navigator } from './camera.js';
import { CIRCUITS } from '../analysis/circuits.js';
import { Hum } from './sound.js';
import { EffectComposer } from '../libs/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../libs/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../libs/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../libs/addons/postprocessing/OutputPass.js';

const cv = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060607);
/* Fog does the heavy lifting on "the room is bigger than it is": the far wall
 * dissolves before you can read its distance. Cheap, and it makes a five
 * metre bay feel open-ended. */
scene.fog = new THREE.FogExp2(0x060607, 0.14);

const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 40);
buildBay(scene);

/* Stations around the perimeter, facing in. Close enough that crossing takes
 * a few seconds - a dark room you have to trek across stops being atmospheric
 * and starts being tedious.
 * Keyed by station id, not taken in array order. The floor plan used to be
 * PLACES[place++], so every station's position depended on where its
 * definition happened to sit in the list: retiring one bench silently slid
 * every later station into its neighbour's bay. A room should not rearrange
 * itself because of an edit somewhere else.
 *
 * The arrangement means something. The rig stands alone in the middle,
 * because it is the only object here worth walking around. The two resonance
 * stations - the driven tank and the beam - are the same experiment in two
 * domains, so they sit together down the right-hand side where you can look
 * from one to the other. The LED faces you as you come in; it is the thirty
 * seconds that teach you what this room is.
 */
const SPOTS = {
  led:   { x: 0,     z: -2.05, rot: 0 },               // back wall, facing in
  rc:    { x: -1.95, z: -1.9,  rot: 0.34 },            // back left
  rlc:   { x: 1.95,  z: -1.9,  rot: -0.34 },           // back right
  rect:  { x: -2.6,  z: 0.1,   rot: Math.PI / 2 },     // left wall
  beam:  { x: 2.6,   z: 0.1,   rot: -Math.PI / 2 },    // right wall, beside the tank
  fuse:  { x: -2.0,  z: 1.85,  rot: Math.PI - 0.34 },  // front left
  msd:   { x: 0,     z: 0.35,  rot: 0 },               // centre of the floor
};
const SPARE = { x: 2.0, z: 1.85, rot: Math.PI + 0.34 };

const stations = CIRCUITS.map((def) => {
  const p = SPOTS[def.id] ?? SPARE;
  const st = new Station({
    def, position: new THREE.Vector3(p.x, 0, p.z), rotation: p.rot,
  });
  scene.add(st.group);
  return st;
});

/* The failure wall, and what feeds it.
 *
 * Which tally a breakage lands in comes off the reference designator, with
 * one exception: an LED is a D like any other diode, so the part's own name
 * has to settle it. Getting that wrong would quietly file every dead lamp
 * under DIODES.
 */
const kindOf = (f) => {
  const r = String(f.ref ?? '').toUpperCase();
  if (r.startsWith('BEAM')) return 'beam';
  if (/LED/i.test(f.part ?? '')) return 'lamp';
  if (r.startsWith('F')) return 'fuse';
  if (r.startsWith('R')) return 'res';
  if (r.startsWith('C')) return 'cap';
  if (r.startsWith('D')) return 'diode';
  return 'rig';
};

const wall = new FailureWall(scene);
loadWall().then((s) => wall.set(s));

Station.onBreak = (st, f) => {
  const tag = tagFor(f);
  /* Post, then re-read. The write needs the list as it stands so it can
   * append rather than replace, and the re-read is what puts other people's
   * tags on the wall during a long visit rather than only at load. */
  postWall(kindOf(f), tag, wall.state.tags)
    .then(() => loadWall())
    .then((s) => wall.set(s));
};

/* Bloom.
 *
 * Incandescence is the one thing this piece has to get across and an emissive
 * material alone cannot do it: without bloom a glowing part is simply a
 * lighter-coloured part, which is what a hot resistor looked like until this
 * pass existed. Light spilling past an object's edge is how an eye reads
 * "this is emitting" rather than "this is pale".
 *
 * Threshold is high on purpose. Everything else in this room is dim, so a low
 * threshold would make the whole bench glow and the effect would stop meaning
 * anything. Only genuinely hot things and the lamps cross it.
 */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight), 0.72, 0.5, 0.62,
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const pool = new LightPool(scene);
const hum = new Hum();
const nav = new Navigator(camera, cv);
nav.obstacles = stations.map((s) => ({ x: s.position.x, z: s.position.z, hw: 0.78, hd: 0.42 }));

// --------------------------------------------------------------- interaction
/* Touch. Keyed off pointer capability AND width, because a touchscreen laptop
 * is not a phone and should not get a thumbstick over its view. */
const TOUCH = (('ontouchstart' in window) || navigator.maxTouchPoints > 0)
  && Math.min(innerWidth, innerHeight) < 900;
/* Declared here, not beside the thumbstick code 300 lines down, because
 * setHint reads it during module evaluation: a `const` used before its
 * declaration is a dead-zone throw, not a quiet undefined, and it would have
 * taken the whole page down on first paint. */
/* Two hints, because the desktop one was instructions for hardware a phone
 * does not have: WASD, a mouse, an R key and a T key. It was also still being
 * printed on mobile, over the values strip, telling you to press keys that
 * are not there. */
const HINT = '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to walk  \u00b7  drag to look  \u00b7  click a bench  \u00b7  <kbd>R</kbd> to reset  \u00b7  <kbd>T</kbd> for thermal';
const HINT_TOUCH = 'stick to walk  \u00b7  drag to look  \u00b7  tap a bench';
function setHint(text) {
  const h = document.getElementById('hint');
  h.innerHTML = text ?? (TOUCH ? HINT_TOUCH : HINT);
}
/* Seed it. The hint used to be hard-coded in the markup, which meant the
 * desktop wording shipped to phones; now the markup is empty and the first
 * line has to be written here, or there is no hint until something else
 * happens to set one. */
setHint(null);

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hovered = null;

function pick(ev) {
  const r = cv.getBoundingClientRect();
  ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  for (const st of stations) {
    if (ray.intersectObject(st.group, true).length) return st;
  }
  return null;
}

/* Knob dragging.
 *
 * This is the verb of the whole piece: almost everything that happens here
 * happens because somebody turned the supply too far. So it is a real object
 * you grab, not a slider floating over the scene - and while you are holding
 * it, looking around is suspended, because a drag cannot mean two things.
 *
 * Knobs take vertical movement. Turning one by tracing a circle with the
 * mouse is how it works in life and is miserable with a pointer; every piece
 * of audio software settled on up-and-down for the same reason.
 *
 * The rig's stacked levers take HORIZONTAL movement instead, because in a
 * single column a downward drag is ambiguous between "less" and "the lever
 * below". Each control decides for itself which axis it reads; both deltas
 * are handed over and the control ignores the one it does not want.
 */
let downAt = null, grabbed = null, lastY = 0, lastX = 0;

function pickKnob(ev) {
  if (!focused) return null;
  const r = cv.getBoundingClientRect();
  ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  for (const k of focused.controls()) {
    if (ray.intersectObject(k.group, true).length) return k;
  }
  return null;
}

cv.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
  grabbed = pickKnob(e);
  lastY = e.clientY; lastX = e.clientX;
  if (grabbed) { nav.grabbed = true; cv.setPointerCapture?.(e.pointerId); }
});
addEventListener('pointermove', (e) => {
  if (!grabbed) return;
  grabbed.dragBy(e.clientY - lastY, e.clientX - lastX);
  lastY = e.clientY; lastX = e.clientX;
  focused.supplyChanged(grabbed);
});
/* The wheel is the precise way in. Dragging the lever is for committing;
 * scrolling over it is for the last volt before something lets go. */
cv.addEventListener('wheel', (e) => {
  const c = pickKnob(e);
  if (!c) return;
  e.preventDefault();
  if (c.nudge) c.nudge(-Math.sign(e.deltaY));
  else c.dragBy(Math.sign(e.deltaY) * 6);
  focused.supplyChanged(c);
}, { passive: false });

cv.addEventListener('pointerup', (e) => {
  if (grabbed) { grabbed = null; nav.grabbed = false; downAt = null; return; }
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 6) return;                    // that was a look, not a click

  // leaning in on a component, when already at a bench
  if (focused) {
    const part = pickPart(e);
    if (part) { nav.lean(part); setHint('close focus \u2014 click anywhere, or Esc, to pull back'); return; }
    if (nav.leaning) { nav.unlean(); setHint(null); return; }
  }
  const hit = pick(e);
  if (hit) { nav.goTo(hit); setFocus(hit); }
  else if (nav.focus) stepBack();
});

/** Any component body on the focused station's card. */
function pickPart(ev) {
  const r = cv.getBoundingClientRect();
  ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  for (const b of focused.bodies) {
    if (ray.intersectObject(b.mesh, true).length) return b.mesh;
  }
  return null;
}
cv.addEventListener('pointermove', (e) => {
  if (downAt) return;
  hovered = pick(e);
  cv.style.cursor = hovered ? 'pointer' : 'default';
});

/* The live settings readout.
 *
 * Rebuilt only when a number actually changes - the comparison is against a
 * single joined string, which is cheaper than touching eight DOM nodes every
 * frame and keeps this off the critical path at 60 Hz. */
const valsEl = document.getElementById('vals');
let valsKey = '';
function updateVals() {
  if (!focused) return;
  const rs = focused.readings();
  const key = rs.map((r) => `${r.label}${r.value}${r.unit}`).join('|');
  if (key === valsKey) return;
  valsKey = key;
  valsEl.innerHTML = rs.map((r) => `<div class="row${r.live ? ' live' : ''}">`
    + `<span class="k">${r.label}</span>`
    + `<span><span class="v">${r.value}</span><span class="u">${r.unit}</span></span>`
    + '</div>').join('');
}

/* The dial: the station's primary control, as real UI.
 *
 * Driven by the same RowLever the 3D console uses, so the log scale, the
 * clamping and the value are all one implementation - the dial moves the
 * lever and the lever tells the circuit. */
const dialEl = document.getElementById('dial');
const dialTrack = document.getElementById('dial-track');
const dialThumb = document.getElementById('dial-thumb');
const dialVal = document.getElementById('dial-val');
const dialLbl = document.getElementById('dial-lbl');
const dialResp = document.getElementById('dial-resp');
let dialLever = null, dialItem = null;

function buildDial(st) {
  const key = st?.def?.dial;
  dialLever = key ? st.controls().find((l) => l.key === key) : null;
  dialItem = key ? st.def.params.find((q) => q.key === key) : null;
  dialEl.classList.toggle('on', !!dialLever);
  document.body.classList.toggle('working', !!dialLever);
  if (!dialLever) return;
  dialLbl.textContent = dialItem.label;
  dialTrack.querySelectorAll('.mark').forEach((m) => m.remove());
  for (const f of st.def.marks?.(st.sim) ?? []) {
    const t = dialLever.log
      ? Math.log(f / dialLever.min) / Math.log(dialLever.max / dialLever.min)
      : (f - dialLever.min) / (dialLever.max - dialLever.min);
    if (t < 0 || t > 1) continue;
    const m = document.createElement('div');
    m.className = 'mark';
    m.style.left = `${t * 100}%`;
    m.dataset.hz = f;
    m.innerHTML = `<b>${f.toFixed(0)}</b>`;
    dialTrack.appendChild(m);
  }
  paintDial();
}

function paintDial() {
  if (!dialLever) return;
  const t = dialLever._t();
  dialThumb.style.left = `${t * 100}%`;
  dialVal.innerHTML = `${dialLever.value.toFixed(dialItem.dp ?? 1)}<span>${dialItem.unit}</span>`;
  for (const m of dialTrack.querySelectorAll('.mark')) {
    const f = +m.dataset.hz;
    m.classList.toggle('hit', Math.abs(f - dialLever.value) / f < 0.03);
  }
}

/* Drag anywhere on the track, and absolutely: the thumb goes where your
 * finger is. Relative dragging is right for a knob you cannot see the scale
 * of, and wrong for a scale with targets printed on it. */
function dialTo(clientX) {
  if (!dialLever) return;
  const r = dialTrack.getBoundingClientRect();
  const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  dialLever.set(dialLever._v(t));
  focused?.supplyChanged(dialLever);
  paintDial();
}
let dialing = false;
dialTrack.addEventListener('pointerdown', (e) => {
  dialing = true; dialTrack.setPointerCapture(e.pointerId); dialTo(e.clientX); e.preventDefault();
});
dialTrack.addEventListener('pointermove', (e) => { if (dialing) dialTo(e.clientX); });
for (const ev of ['pointerup', 'pointercancel']) dialTrack.addEventListener(ev, () => { dialing = false; });

let focused = null;
function setFocus(st) {
  /* Stepping away stops the machine running.
   *
   * It used to keep going: step back from the beam at resonance and it
   * carried on being driven while you stood across the room, burning through
   * its fatigue life - about 1.4% every ten seconds - so you could return to
   * a part that cracked while nobody was operating it. The same was true of
   * every station: an LED over its current limit, a resistor cooking.
   *
   * The lighting is a different matter and stays as it was. A station near
   * you remains lit whether or not you are working it, which is what makes
   * the room feel occupied rather than a menu. What stops is the SIMULATION,
   * which is the thing that consumes the parts. */
  if (focused && focused !== st) focused.armed = false;
  focused = st;
  for (const s of stations) s.wakeTarget = s === st ? 1 : 0;
  if (st) st.arm();
  const el = document.getElementById('hud');
  el.textContent = st ? st.title : '';
  el.classList.toggle('on', !!st);
  valsKey = '';                    // force a rebuild for the new station
  buildDial(st);
  /* With a dial on screen the control's value is already large and in front
   * of you, and the 3D panel carries the results - so the corner strip would
   * be the same numbers a third time. */
  valsEl.classList.toggle('on', !!st && !st.def.dial);
  document.getElementById('back').classList.toggle('on', !!st);
  refreshReplace();
}
/* One thermal toggle behind both the key and the button, so they cannot
 * disagree about the state, and the button carries the state visibly. */
/* Re-centre.
 *
 * The room is deliberately dark and only the nearest few stations are lit,
 * which is the look - but it also means you can turn twice and be facing a
 * black wall with nothing to steer by. This puts you back exactly where the
 * piece starts: in the middle of the floor, a metre and a half from the rig,
 * looking straight at it. From there every other station is a turn away.
 *
 * It is a wayfinding control, not a camera move, so it is instant. An
 * animated swing from a disoriented position is a second of watching the
 * dark go past before you learn anything.
 */
function recentre() {
  const mid = stations.find((st) => st.def.mechanical) ?? stations[0];
  nav.release();
  setFocus(null);
  nav.pos.set(mid.position.x, nav.pos.y, mid.position.z + 1.4);
  // verified empirically: this is the yaw that points at a world position
  nav.yaw = Math.atan2(mid.position.x - nav.pos.x, mid.position.z - nav.pos.z) + Math.PI;
  nav.pitch = -0.05;
  setHint(null);
}
document.getElementById('recenter').onclick = recentre;

const thermalBtn = document.getElementById('thermal');
function toggleThermal() {
  Station.thermalView = !Station.thermalView;
  const on = Station.thermalView;
  thermalBtn.classList.toggle('on', on);
  thermalBtn.setAttribute('aria-pressed', String(on));
  setHint(on
    ? (TOUCH ? 'THERMAL VIEW \u2014 each part against its own rating'
             : 'THERMAL VIEW \u2014 each part against its own rating. T to exit')
    : null);
}
thermalBtn.onclick = toggleThermal;
addEventListener('keydown', (e) => { if (e.code === 'KeyT') toggleThermal(); });

/* One way out, used by the button, the Escape key and clicking into the dark,
 * so the HUD cannot be left claiming you are still at a bench you have walked
 * away from. */
function stepBack() {
  if (nav.leaning) { nav.unlean(); setHint(null); return; }
  nav.release();
  setFocus(null);
}
const backBtn = document.getElementById('back');
backBtn.onclick = stepBack;
// desktop has room for the full wording; a 390 px bar does not
if (TOUCH) backBtn.innerHTML = '&larr; back';

/* Restoring a station.
 *
 * Damage persists across reloads on purpose - that is the point of the rack -
 * but without a way back the only recovery was clearing site data, which is
 * not a thing anyone will work out. The wording follows the station: you fit
 * a new card at a bench and you reset the rig.
 */
const replaceBtn = document.getElementById('replace');
function refreshReplace() {
  replaceBtn.classList.toggle('on', !!focused);
  if (!focused) return;
  replaceBtn.textContent = `\u21bb ${TOUCH ? focused.replaceLabelShort : focused.replaceLabel}`;
  replaceBtn.classList.toggle('dead', !!focused.failure);
}
replaceBtn.onclick = () => {
  if (!focused) return;
  focused.replace();
  focused.arm();
  refreshReplace();
};
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && focused) { focused.replace(); focused.arm(); refreshReplace(); }
});
addEventListener('keydown', (e) => { if (e.code === 'Escape') stepBack(); });

/* Proximity wake: walk near a station and it comes up on its own. Clicking is
 * the deliberate version; this is what makes the room feel alive while you
 * are crossing it. */
function proximity() {
  if (focused) return;
  // Generous on purpose. At 1.9 m you had to walk into the bench before it
  // noticed you, which reads as the mechanic being broken rather than as a
  // threshold. The station should notice you approaching, not arriving.
  let near = null, best = 2.9;
  for (const st of stations) {
    const d = st.position.distanceTo(nav.pos);
    if (d < best) { best = d; near = st; }
  }
  for (const st of stations) st.wakeTarget = st === near ? 0.85 : 0;
}

// ---------------------------------------------------------------------- loop
function resize() {
  const w = cv.clientWidth, h = cv.clientHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
let frames = 0, fpsT = 0, fps = 0;
function frame(now) {
  /* Two clocks.
   *
   * dt is clamped so a long frame - a tab coming back, a slow phone, a
   * garbage collection pause - cannot hand the solver a huge timestep and
   * blow it up. But clamping it also slows every CAMERA move by the same
   * factor, because a 0.85 s ease advanced by at most 50 ms a frame takes
   * 0.85 s only if you are already rendering at 20 fps or better. On
   * anything slower the transition crawls, which is exactly when you least
   * want to be waiting for the camera.
   *
   * So transitions run on wall time and simulation runs on the clamped one.
   */
  const realDt = Math.min((now - last) / 1000, 0.25);
  const dt = Math.min(realDt, 0.05);
  last = now;

  nav.update(realDt);
  proximity();
  for (const st of stations) st.tick(dt);
  if (focused && replaceBtn.classList.contains('dead') !== !!focused.failure) refreshReplace();
  let loudest = 0;
  for (const st of stations) {
    const was = st.wake;
    st.step(dt);
    // the contactor fires on the way up, once, not every frame it is awake
    if (was < 0.08 && st.wake >= 0.08) hum.strike();
    loudest = Math.max(loudest, st.wake);
  }
  hum.level(loudest);
  pool.update(stations, camera.position, focused, dt);

  updateVals();
  if (dialLever && focused) {
    // the lever can move from elsewhere (a reset, a tap on the 3D panel),
    // so the dial reads it every frame rather than only when dragged
    paintDial();
    /* The response meter, on a log scale.
     *
     * The three resonances are not the same size - mode 1 swings fifty times
     * further than mode 3 for the same force, because stiffness goes as n^4
     * - so a linear meter pins at mode 1 and shows mode 3 as nothing. The
     * meter's job is "are you getting warmer", which is a ratio question,
     * and ratios want a log scale. 0.05 mm to 20 mm, which is the floor and
     * the ceiling of what this beam actually does. */
    const LO = 5e-5, HI = 0.02;
    const r = Math.max(LO, focused.response ?? 0);
    const pct = (Math.log(r / LO) / Math.log(HI / LO)) * 100;
    dialResp.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(0)}%`;
  }
  composer.render();

  frames++; fpsT += dt;
  if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__world = {
  nav, stations, pool, scene, camera, renderer, composer, wall,
  focus: (id) => { const s = stations.find((x) => x.id === id); nav.goTo(s); setFocus(s); },
  arm: (id) => stations.find((x) => x.id === id)?.arm(),
  stats: () => ({
    calls: renderer.info.render.calls,
    tris: renderer.info.render.triangles,
    lights: pool.slots.map((s) => +s.light.intensity.toFixed(2)),
    assigned: pool.slots.map((s) => s.station?.id ?? null),
    awake: stations.filter((s) => s.active).map((s) => s.id),
    fps: +fps.toFixed(1),
    pos: nav.pos.toArray().map((v) => +v.toFixed(2)),
  }),
  walk: (dx, dz, n = 30) => { for (let i = 0; i < n; i++) { nav.pos.x += dx; nav.pos.z += dz; nav._collide(); } },
};


// ----------------------------------------------------------------- the gate
/* Nothing runs until the visitor says go. That is partly manners about the
 * download and partly a technical necessity: the AudioContext will not start
 * without a gesture, so the first station to wake would otherwise come up
 * silent. */
const gate = document.getElementById('gate');
document.getElementById('enter').onclick = () => {
  gate.classList.add('gone');
  setTimeout(() => gate.remove(), 800);
};

if (TOUCH) {
  document.body.classList.add('touch');
  const stick = document.getElementById('stick');
  const nub = stick.querySelector('i');
  let id = null, cx = 0, cy = 0;
  const R = 42;
  stick.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    stick.setPointerCapture(id);
    e.stopPropagation();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / R) / d;
    dx *= k; dy *= k;
    nub.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
    nav.stick = { x: dx, y: dy };
    e.stopPropagation();
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null; nav.stick = null;
    nub.style.transform = '';
  };
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
}
