import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../solver/mna.js';

/* Newton-Raphson only runs when a nonlinear element is present, so these also
 * check that the inner loop converges at all. */

test('diode forward drop lands near 0.6-0.75 V at a few mA', () => {
  const ckt = new Circuit();
  ckt.V(1, 0, 5);
  ckt.R(1, 2, 1000);
  const d = ckt.D(2, 0);
  ckt.transient({ h: 1e-6, tEnd: 1e-4 });
  console.log(`    Vf ${d.v.toFixed(4)} V at ${(d.i * 1000).toFixed(3)} mA`);
  assert.ok(d.v > 0.55 && d.v < 0.8, `forward drop ${d.v}`);
  assert.ok(d.i > 3e-3 && d.i < 5e-3);
});

test('diode blocks in reverse', () => {
  const ckt = new Circuit();
  ckt.V(1, 0, -5);
  ckt.R(1, 2, 1000);
  const d = ckt.D(2, 0);
  ckt.transient({ h: 1e-6, tEnd: 1e-4 });
  console.log(`    reverse current ${d.i.toExponential(2)} A`);
  assert.ok(Math.abs(d.i) < 1e-9);
});

test('half-wave rectifier clips the negative half', () => {
  const f = 50;
  const ckt = new Circuit();
  ckt.V(1, 0, (t) => 10 * Math.sin(2 * Math.PI * f * t));
  ckt.D(1, 2);
  const load = ckt.R(2, 0, 1000);
  let maxV = -Infinity, minV = Infinity;
  ckt.transient({
    h: 1 / (f * 2000), tEnd: 3 / f,
    onStep: () => { maxV = Math.max(maxV, load.v); minV = Math.min(minV, load.v); },
  });
  console.log(`    load swing: ${minV.toFixed(4)} V .. ${maxV.toFixed(4)} V`);
  assert.ok(maxV > 9.0 && maxV < 9.6, 'positive peak should be input minus a diode drop');
  assert.ok(minV > -0.01, 'negative half should be blocked');
});
