import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../solver/mna.js';

/* An RC charging curve has a closed form, so this is a real check on the
 * integrator rather than a regression against whatever it happened to print
 * the first time. */
test('RC charge matches V(1 - e^(-t/RC)) at 1, 2 and 5 tau', () => {
  const V0 = 10, R = 1000, C = 1e-6;
  const tau = R * C;                       // 1 ms

  const ckt = new Circuit();
  ckt.V(1, 0, V0);
  ckt.R(1, 2, R);
  const cap = ckt.C(2, 0, C);

  const samples = new Map();
  const h = tau / 2000;
  ckt.transient({
    h, tEnd: 5 * tau,
    onStep: (t) => {
      for (const n of [1, 2, 5]) {
        if (Math.abs(t - n * tau) < h / 2) samples.set(n, cap.v);
      }
    },
  });

  for (const n of [1, 2, 5]) {
    const expected = V0 * (1 - Math.exp(-n));
    const got = samples.get(n);
    const err = Math.abs(got - expected) / expected;
    console.log(`    t=${n}tau  expected ${expected.toFixed(6)}  got ${got.toFixed(6)}  err ${(err * 100).toFixed(4)}%`);
    assert.ok(err < 0.001, `at ${n}tau: ${got} vs ${expected} (${(err * 100).toFixed(3)}%)`);
  }
});

test('RC time constant is independent of timestep', () => {
  const V0 = 5, R = 2200, C = 4.7e-6, tau = R * C;
  const at1tau = (h) => {
    const ckt = new Circuit();
    ckt.V(1, 0, V0); ckt.R(1, 2, R);
    const cap = ckt.C(2, 0, C);
    let out = 0;
    ckt.transient({ h, tEnd: tau, onStep: () => { out = cap.v; } });
    return out;
  };
  const coarse = at1tau(tau / 50);
  const fine = at1tau(tau / 5000);
  console.log(`    h=tau/50 -> ${coarse.toFixed(6)}   h=tau/5000 -> ${fine.toFixed(6)}`);
  assert.ok(Math.abs(coarse - fine) / fine < 0.001);
});
