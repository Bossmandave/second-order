/* Live retuning of the rig.
 *
 * Changing a parameter mid-run is a physical act, and each one preserves a
 * different piece of state. These check that the state really does survive,
 * because the failure mode is silent: get the capacitor's voltage wrong when
 * stiffness changes and the mass teleports, which the thermal pass then
 * reports as a travel failure the operator did nothing to cause.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MassSpringDamper } from '../solver/mechanical.js';

/** Step a rig forward by hand, so the state is ours to inspect between steps. */
function run(rig, h, n) {
  rig.ckt.transient({ h, tEnd: h * n });
}

test('swapping the spring preserves displacement, not force', () => {
  const rig = new MassSpringDamper({ m: 2, c: 0.4, k: 50, force: 6 });
  run(rig, 1e-3, 400);
  const x = rig.displacement;
  assert.ok(Math.abs(x) > 1e-3, 'needs to be somewhere off zero to be a test');

  rig.tune({ k: 200 });
  assert.ok(Math.abs(rig.displacement - x) < 1e-12,
            `displacement jumped: ${x} -> ${rig.displacement}`);
  // the spring force is what changes: four times the stiffness, four times the force
  assert.ok(Math.abs(rig.cap.v - 200 * x) < 1e-12);
});

test('bolting on mass preserves velocity', () => {
  const rig = new MassSpringDamper({ m: 1, c: 0.2, k: 80, force: 5 });
  run(rig, 1e-3, 300);
  const v = rig.velocity;
  assert.ok(Math.abs(v) > 1e-3);
  rig.tune({ m: 4 });
  assert.equal(rig.velocity, v);
  assert.equal(rig.ind.value, 4);
});

test('tuning moves the natural frequency and damping ratio', () => {
  const rig = new MassSpringDamper({ m: 2, c: 0.8, k: 50, force: 4 });
  rig.tune({ m: 0.5, k: 200, c: 2 });
  assert.ok(Math.abs(rig.omegaN - Math.sqrt(200 / 0.5)) < 1e-12);
  assert.ok(Math.abs(rig.zeta - 2 / (2 * Math.sqrt(200 * 0.5))) < 1e-12);
});

test('a retuned rig behaves like one built that way', () => {
  /* The real test of live tuning: from rest, tuning then running must give
   * the same answer as building the tuned machine in the first place. If it
   * does not, a parameter is being held in two places and one of them is
   * stale. */
  const a = new MassSpringDamper({ m: 2, c: 0.8, k: 50, force: 4 });
  a.tune({ m: 1.5, c: 1.6, k: 120, force: 9 });
  const b = new MassSpringDamper({ m: 1.5, c: 1.6, k: 120, force: 9 });
  run(a, 2e-4, 2000);
  run(b, 2e-4, 2000);
  assert.ok(Math.abs(a.displacement - b.displacement) < 1e-12,
            `${a.displacement} vs ${b.displacement}`);
  assert.ok(Math.abs(a.velocity - b.velocity) < 1e-12);
});

test('stiffening while it rings raises the frequency', () => {
  /* The whole reason tuning is live rather than a restart.
   *
   * transient() re-solves initial conditions and restarts from t=0 on every
   * call, so this steps the circuit by hand - which is also what the live
   * bench does - and counts velocity sign changes either side of the tune.
   */
  const build = () => new MassSpringDamper({ m: 2, c: 0.05, k: 50, force: 4 });
  const h = 2e-4;

  const crossings = (rig, steps, t0) => {
    let last = rig.velocity, n = 0;
    for (let i = 1; i <= steps; i++) {
      rig.ckt.step(t0 + i * h, h);
      if (last !== 0 && Math.sign(rig.velocity) !== Math.sign(last)) n++;
      last = rig.velocity;
    }
    return n;
  };

  const soft = build(); soft.ckt._solveIC();
  const stiff = build(); stiff.ckt._solveIC();
  crossings(soft, 1500, 0);
  crossings(stiff, 1500, 0);
  stiff.tune({ k: 400 });        // eight times stiffer, mid-swing

  const t0 = 1500 * h;
  const ns = crossings(soft, 4000, t0);
  const nf = crossings(stiff, 4000, t0);
  assert.ok(nf > ns, `stiff rig crossed zero ${nf} times, soft one ${ns}`);
  // omega should have gone up by sqrt(8); the crossing count should follow
  assert.ok(nf / ns > 2, `expected roughly sqrt(8)x the rate, got ${nf / ns}`);
});

test('zero damping rings instead of returning NaN', () => {
  /* A damping lever that reaches zero is a legitimate machine - an undamped
   * mass-spring - but it stamps a zero-ohm resistor, and 1/0 took the whole
   * solution to NaN. Circuit.R_MIN is what stops that. */
  const rig = new MassSpringDamper({ m: 2, c: 0, k: 50, force: 4 });
  run(rig, 5e-4, 4000);
  assert.ok(Number.isFinite(rig.displacement), 'displacement went NaN');
  assert.ok(Number.isFinite(rig.velocity));
  // undamped: the peak should still be near 2x the static deflection
  assert.ok(Math.abs(rig.displacement) < 2.2 * (4 / 50));
});

test('tuning damping to zero mid-run is also safe', () => {
  const rig = new MassSpringDamper({ m: 2, c: 3, k: 50, force: 4 });
  rig.ckt._solveIC();
  for (let i = 1; i <= 800; i++) rig.ckt.step(i * 5e-4, 5e-4);
  rig.tune({ c: 0 });
  for (let i = 801; i <= 4000; i++) rig.ckt.step(i * 5e-4, 5e-4);
  assert.ok(Number.isFinite(rig.displacement), 'displacement went NaN after tune');
});
