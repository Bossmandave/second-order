/* The driven tank.
 *
 * This station exists to be swept, so the thing to verify is the frequency
 * response itself: a peak at f0, of height Q, of the right sharpness - and
 * that retuning the drive live does not ring the tank by accident.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIRCUITS, makeStation } from '../analysis/circuits.js';

const DEF = CIRCUITS.find((c) => c.id === 'rlc');
const base = () => Object.fromEntries(DEF.params.map((p) => [p.key, p.value]));

/** Steady-state cap-voltage amplitude at one drive frequency. */
function amplitude({ f, A = 2, R = 20, C = 100 }) {
  const sim = makeStation(DEF, { f, A, R, C });
  const h = 1 / (f * 400);              // 400 points per drive cycle
  const settle = 40 / f;                // long enough for a high-Q build-up
  let t = 0;
  while (t < settle) { sim.bench.advance(h * 20, h); t = sim.bench.t; }
  let lo = Infinity, hi = -Infinity;
  const until = t + 2 / f;              // measure over two full cycles
  while (sim.bench.t < until) {
    sim.bench.advance(h, h);
    lo = Math.min(lo, sim.cap.v); hi = Math.max(hi, sim.cap.v);
  }
  return (hi - lo) / 2;
}

test('the response peaks at the tank frequency', () => {
  const sim = makeStation(DEF, base());
  const f0 = sim.meta.omegaN / (2 * Math.PI);
  const at = (f) => amplitude({ f });
  const peak = at(f0);
  assert.ok(peak > at(f0 / 2) * 1.5, 'no peak above the low side');
  assert.ok(peak > at(f0 * 2) * 1.5, 'no peak above the high side');
});

test('the peak is Q times the drive', () => {
  const sim = makeStation(DEF, base());
  const f0 = sim.meta.omegaN / (2 * Math.PI);
  const Q = 1 / (2 * sim.meta.zeta);
  const peak = amplitude({ f: f0 });
  // series RLC: |Vc/Vin| at resonance is exactly Q
  assert.ok(Math.abs(peak / 2 - Q) / Q < 0.06,
            `expected ~${(Q * 2).toFixed(2)} V, got ${peak.toFixed(2)}`);
});

test('lowering R sharpens and raises the peak', () => {
  const soft = amplitude({ f: 35.6, R: 40 });
  const sharp = amplitude({ f: 35.6, R: 5 });
  assert.ok(sharp > soft * 3, `R=5 gave ${sharp.toFixed(1)}, R=40 gave ${soft.toFixed(1)}`);
});

test('a high-Q tank can break a 63 V cap from a few volts in', () => {
  const sim = makeStation(DEF, { f: 35.6, A: 5, R: 2, C: 100 });
  while (sim.bench.alive && sim.bench.t < 4) sim.bench.advance(1e-4, 2e-5);
  const f = sim.bench.failure ?? sim.bench.failures?.[0] ?? null;
  assert.ok(f, 'five volts into a Q of 22 should kill a 63 V part');
  assert.equal(f.ref, 'C1');
});

test('retuning the drive keeps the waveform continuous', () => {
  /* The regression this guards: sin(2*pi*f*t) steps when f changes, and a
   * step into a high-Q tank rings it hard - which reads as the resonance you
   * were hunting for, at whatever frequency you happened to stop on. */
  const sim = makeStation(DEF, base());
  const h = 2e-4;
  while (sim.bench.t < 0.4) sim.bench.advance(h, h);
  const before = sim.src.value(sim.bench.t);
  DEF.tune(sim, { f: 90, A: 2, R: 20, C: 100 });
  const after = sim.src.value(sim.bench.t);
  assert.ok(Math.abs(after - before) < 1e-9,
            `drive jumped ${before.toFixed(3)} -> ${after.toFixed(3)} V on retune`);
});

test('sweeping does not itself destroy the tank', () => {
  // walking the lever across the band at a sane amplitude must be survivable
  const sim = makeStation(DEF, { f: 5, A: 2, R: 20, C: 100 });
  for (let i = 0; i <= 60; i++) {
    DEF.tune(sim, { f: 5 * (250 / 5) ** (i / 60), A: 2, R: 20, C: 100 });
    const until = sim.bench.t + 0.05;
    while (sim.bench.alive && sim.bench.t < until) sim.bench.advance(2e-4, 2e-4);
  }
  assert.ok(sim.bench.alive, 'a plain sweep killed it: ' + JSON.stringify(sim.bench.failure));
});
