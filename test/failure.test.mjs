import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../solver/mna.js';
import { Bench } from '../solver/bench.js';
import { part } from '../solver/parts.js';
import { describe } from '../solver/thermal.js';

/** A resistor straight across a supply, dissipating `watts`. */
function resistorAt(watts, spec = part('R_0.25W'), R = 1000) {
  const ckt = new Circuit();
  ckt.V(1, 0, Math.sqrt(watts * R));
  ckt.R(1, 0, R, { spec, ref: 'R1' });
  return new Bench({ circuit: ckt });
}

test('a 1/4 W resistor at 0.5 W dies in a few seconds', () => {
  const b = resistorAt(0.5);
  while (b.alive && b.t < 60) b.advance(0.02, 2e-3);
  assert.ok(!b.alive, 'should have failed');
  const f = b.failures[0];
  console.log(`    ${describe(f)}`);
  assert.equal(f.cause, 'overheated');
  assert.ok(f.survived > 2 && f.survived < 15, `died at ${f.survived}s`);
  assert.ok(f.overBy > 1.0);
});

test('the same resistor at 0.24 W runs indefinitely', () => {
  const b = resistorAt(0.24);
  while (b.t < 300) b.advance(0.1, 5e-3);
  const T = b.temperature(b.ckt.elements[1]);
  console.log(`    settled at ${T.toFixed(1)} degC, limit ${part('R_0.25W').tMax} degC, still alive: ${b.alive}`);
  assert.ok(b.alive, 'should have survived');
  assert.ok(T < part('R_0.25W').tMax);
});

test('a brief overload is survivable but a sustained one is not', () => {
  const brief = resistorAt(2.0);
  brief.advance(0.5, 2e-3);                 // 8x rating, half a second
  console.log(`    2 W for 0.5 s -> ${brief.alive ? 'survived' : 'died'} at ${brief.temperature(brief.ckt.elements[1]).toFixed(0)} degC`);
  assert.ok(brief.alive, 'half a second at 8x should not be fatal');

  const sustained = resistorAt(2.0);
  while (sustained.alive && sustained.t < 60) sustained.advance(0.02, 2e-3);
  console.log(`    2 W sustained -> died after ${sustained.failures[0].survived.toFixed(2)} s`);
  assert.ok(!sustained.alive);
});

test('a fuse clears faster the harder it is pushed', () => {
  const clearTime = (amps) => {
    const R = 1;
    const ckt = new Circuit();
    ckt.V(1, 0, amps * R);
    ckt.R(1, 2, R);
    ckt.R(2, 0, 1e-6, { spec: part('FUSE_1A'), ref: 'F1' });
    const b = new Bench({ circuit: ckt });
    while (b.alive && b.t < 10) b.advance(0.001, 2e-4);
    return b.alive ? Infinity : b.failures[0].survived;
  };
  const t2 = clearTime(2), t5 = clearTime(5), t10 = clearTime(10);
  console.log(`    2 A -> ${t2.toFixed(4)} s   5 A -> ${t5.toFixed(4)} s   10 A -> ${t10.toFixed(4)} s`);
  assert.ok(t2 > t5 && t5 > t10, 'clearing time must fall as current rises');
  assert.ok(clearTime(0.9) === Infinity, 'below rating it should never clear');
});

test('forensics carry everything the autopsy card needs', () => {
  const b = resistorAt(0.5);
  while (b.alive && b.t < 60) b.advance(0.02, 2e-3);
  const f = b.failures[0];
  for (const k of ['part', 'ref', 'cause', 'mode', 'value', 'limit', 'unit', 'overBy', 'dissipated', 'peakT', 'tMax', 'survived']) {
    assert.ok(f[k] !== undefined, `missing ${k}`);
  }
});

test('a failed-open part stops conducting and the circuit stays solvable', () => {
  const b = resistorAt(0.5);
  while (b.alive && b.t < 60) b.advance(0.02, 2e-3);
  const r = b.ckt.elements[1];
  b.advance(1.0, 2e-3);                      // keep running after the failure
  console.log(`    post-failure current ${r.i.toExponential(2)} A`);
  assert.ok(Math.abs(r.i) < 1e-6);
});
