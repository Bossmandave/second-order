/* The resonant beam.
 *
 * Three claims the station is built on, each of which would be invisible if
 * it were wrong: that there are peaks and they sit at the stated
 * frequencies, that where you push decides which modes you can excite, and
 * that the beam breaks where the curvature is - not where the motion is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIRCUITS, makeStation, defaults } from '../analysis/circuits.js';
import { Beam } from '../solver/beam.js';

const DEF = CIRCUITS.find((c) => c.id === 'beam');
const base = () => defaults(DEF);

/** Steady-state peak deflection at one drive setting. */
function respond({ f, A = 6, pos = 0.35, z = 0.05 }, cycles = 60) {
  const sim = makeStation(DEF, { ...base(), f, A, pos, z });
  const h = 1 / (f * 200);
  const settle = cycles / f;
  while (sim.bench.alive && sim.bench.t < settle) sim.bench.advance(h * 10, h);
  let peak = 0;
  const until = sim.bench.t + 2 / f;
  while (sim.bench.alive && sim.bench.t < until) {
    sim.bench.advance(h, h);
    peak = Math.max(peak, sim.beam.peakDeflection(41));
  }
  return peak;
}

test('the spectrum is 1 : 4 : 9, as a simply supported beam must be', () => {
  const f = makeStation(DEF, base()).beam.frequencies;
  assert.equal(f.length, 3);
  assert.ok(Math.abs(f[1] / f[0] - 4) < 1e-9, `${f[1] / f[0]}`);
  assert.ok(Math.abs(f[2] / f[0] - 9) < 1e-9, `${f[2] / f[0]}`);
});

test('every mode is a reachable peak', () => {
  const fs = makeStation(DEF, base()).beam.frequencies;
  for (const f0 of fs) {
    const on = respond({ f: f0 });
    const off = respond({ f: f0 * 1.5 });
    assert.ok(on > off * 2.5,
      `no peak at ${f0.toFixed(1)} Hz: ${(on * 1000).toFixed(2)} mm on, ${(off * 1000).toFixed(2)} off`);
  }
});

test('pushing on a node cannot excite that mode', () => {
  /* Mode 2 has a node at mid-span, so driving there at exactly its own
   * frequency must leave it asleep. Against the Beam directly rather than
   * through the station, because the station fixes the shaker at 0.21 of the
   * span - there is one control now, and the point of this test is a claim
   * about the model, not about what the station exposes. Measured on mode
   * 2's own coordinate: modes 1 and 3 still answer an 86 Hz push off their
   * own resonances, and that forced response would mask it. */
  const q2 = (pos) => {
    const beam = new Beam({ modes: 3, zeta: 0.012, drive: pos, force: 40, freq: 85.83 });
    const h = 1 / (85.83 * 200);
    let peak = 0;
    for (let n = 1; n <= 60 * 200; n++) {
      beam.ckt.step(n * h, h);
      peak = Math.max(peak, Math.abs(beam.q(1)));
    }
    return peak;
  };
  const onNode = q2(0.5);
  const offNode = q2(0.25);
  assert.ok(onNode < offNode / 1e6,
    `mode 2 driven from its own node reached ${onNode.toExponential(2)} m `
    + `against ${offNode.toExponential(2)} m off-node`);
});

test('mode 3 needs a ninth of mode 1 amplitude to reach yield', () => {
  /* Curvature goes as n^2 for the same deflection, so the dangerous mode is
   * not the one you can see moving. This is the reason the station colours
   * by strain rather than by displacement. */
  const b = makeStation(DEF, base()).beam;
  const amp = (n) => 250e6 / (b.E * (b.h / 2) * b.modes[n - 1].beta ** 2);
  assert.ok(Math.abs(amp(1) / amp(3) - 9) < 1e-9, `${amp(1) / amp(3)}`);
  assert.ok(amp(1) > 0.02 && amp(1) < 0.04, `mode 1 yields at ${amp(1)} m`);
});

test('the crack lands where the curvature is, not where the motion is', () => {
  // mode 2 alone: peak deflection at the quarter points, peak curvature too,
  // and mid-span - the node - must be the quietest place on the beam
  const sim = makeStation(DEF, { ...base(), f: 85.8, pos: 0.25, A: 30, z: 0.05 });
  const h = 1 / (85.8 * 200);
  while (sim.bench.alive && sim.bench.t < 40 / 85.8) sim.bench.advance(h * 10, h);
  const mid = Math.abs(sim.beam.stress(0.5));
  const quarter = Math.abs(sim.beam.stress(0.25));
  assert.ok(quarter > mid * 10, `mid ${mid.toExponential(2)}, quarter ${quarter.toExponential(2)}`);
});

test('damping sharpens and raises the peak', () => {
  const swing = (zeta) => {
    const beam = new Beam({ modes: 3, zeta, drive: 0.21, force: 11, freq: 21.457 });
    const h = 1 / (21.457 * 200);
    let peak = 0;
    for (let n = 1; n <= 120 * 200; n++) {
      beam.ckt.step(n * h, h);
      if (n > 90 * 200) peak = Math.max(peak, beam.peakDeflection(41));
    }
    return peak;
  };
  const soft = swing(0.15);
  const sharp = swing(0.012);
  assert.ok(sharp > soft * 5,
    `zeta .012 gave ${(sharp * 1000).toFixed(2)} mm, zeta .15 gave ${(soft * 1000).toFixed(2)} mm`);
});

test('it can be fatigued to death below yield', () => {
  /* The point of modelling fatigue at all: a beam that never once goes near
   * its yield stress still cracks if you leave it at resonance. */
  const sim = makeStation(DEF, { ...base(), f: 21.5, A: 14, z: 0.02 });
  let peakStress = 0;
  while (sim.bench.alive && sim.bench.t < 120) {
    sim.bench.advance(2e-3, 4e-4);
    peakStress = Math.max(peakStress, sim.beam.peakStress(41).sigma);
  }
  const f = sim.bench.failures[0];
  assert.ok(f, 'never failed');
  assert.equal(f.cause, 'fatigue crack');
  assert.ok(peakStress < 250e6, `it yielded instead, at ${(peakStress / 1e6).toFixed(0)} MPa`);
});

test('a gentle drive off resonance is survivable indefinitely', () => {
  const sim = makeStation(DEF, base());
  while (sim.bench.alive && sim.bench.t < 60) sim.bench.advance(2e-3, 4e-4);
  assert.ok(sim.bench.alive, 'the shipped settings destroyed the beam');
});
