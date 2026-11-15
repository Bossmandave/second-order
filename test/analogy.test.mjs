import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../solver/mna.js';
import { MassSpringDamper } from '../solver/mechanical.js';

/* The project's central claim, as a test.
 *
 *     m·ẍ + c·ẋ + k·x = F        <->        L·q̈ + R·q̇ + q/C = V
 *
 * If these two ever disagree, the piece is lying to its audience. */

const m = 2, c = 0.8, k = 50, F = 10;          // kg, N·s/m, N/m, N
const L = m, R = c, C = 1 / k, V = F;          // H, ohm, F, V

const omegaN = Math.sqrt(k / m);
const zeta = c / (2 * Math.sqrt(k * m));
const omegaD = omegaN * Math.sqrt(1 - zeta ** 2);

/** Closed-form underdamped step response. */
const analytic = (t) =>
  (F / k) * (1 - Math.exp(-zeta * omegaN * t) *
    (Math.cos(omegaD * t) + (zeta / Math.sqrt(1 - zeta ** 2)) * Math.sin(omegaD * t)));

const H = 1e-5, T_END = 4;

test('the mechanical rig matches the closed-form step response', () => {
  const rig = new MassSpringDamper({ m, c, k, force: F });
  let worst = 0;
  rig.run({ h: H, tEnd: T_END, onStep: (t, x) => {
    worst = Math.max(worst, Math.abs(x - analytic(t)));
  }});
  console.log(`    worst displacement error: ${(worst * 1e6).toFixed(3)} um  (travel ${(F / k * 1000).toFixed(0)} mm)`);
  assert.ok(worst < 1e-5, `off by ${worst} m`);
});

test('the series RLC matches the same closed form, in charge', () => {
  const ckt = new Circuit();
  ckt.V(1, 0, V); ckt.L(1, 2, L); ckt.R(2, 3, R);
  const cap = ckt.C(3, 0, C);
  let worst = 0;
  ckt.transient({ h: H, tEnd: T_END, onStep: (t) => {
    worst = Math.max(worst, Math.abs(C * cap.v - analytic(t)));
  }});
  console.log(`    worst charge error: ${(worst * 1e6).toFixed(3)} uC`);
  assert.ok(worst < 1e-5);
});

test('displacement and charge are the same number, step for step', () => {
  const rig = new MassSpringDamper({ m, c, k, force: F });
  const mech = [];
  rig.run({ h: H, tEnd: T_END, onStep: (t, x, v) => mech.push([x, v]) });

  const ckt = new Circuit();
  ckt.V(1, 0, V); ckt.L(1, 2, L); ckt.R(2, 3, R);
  const cap = ckt.C(3, 0, C);
  const elec = [];
  ckt.transient({ h: H, tEnd: T_END, onStep: () => elec.push([C * cap.v, cap.i]) });

  assert.equal(mech.length, elec.length);
  let dx = 0, dv = 0;
  for (let i = 0; i < mech.length; i++) {
    dx = Math.max(dx, Math.abs(mech[i][0] - elec[i][0]));
    dv = Math.max(dv, Math.abs(mech[i][1] - elec[i][1]));
  }
  console.log(`    displacement vs charge: max difference ${dx.toExponential(2)}`);
  console.log(`    velocity vs current:    max difference ${dv.toExponential(2)}`);
  assert.ok(dx < 1e-12 && dv < 1e-12);
});

test('both domains report the same zeta and omega_n', () => {
  const rig = new MassSpringDamper({ m, c, k });
  const elecZeta = (R / 2) * Math.sqrt(C / L);
  const elecOmegaN = 1 / Math.sqrt(L * C);
  console.log(`    mechanical  zeta ${rig.zeta.toFixed(6)}  omega_n ${rig.omegaN.toFixed(6)}`);
  console.log(`    electrical  zeta ${elecZeta.toFixed(6)}  omega_n ${elecOmegaN.toFixed(6)}`);
  assert.ok(Math.abs(rig.zeta - elecZeta) < 1e-12);
  assert.ok(Math.abs(rig.omegaN - elecOmegaN) < 1e-9);
});
