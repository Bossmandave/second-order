/* The rig has to be breakable from the levers, and break for the right reason.
 *
 * These run the station exactly as the bench does - no 3D, no browser - which
 * is only possible because the travel and force limits live on the model
 * rather than being written in by the view each frame.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIRCUITS, makeStation } from '../analysis/circuits.js';

const DEF = CIRCUITS.find((c) => c.id === 'msd');

function drive(params, tMax = DEF.pace.tEnd) {
  const sim = makeStation(DEF, params);
  while (sim.bench.alive && sim.bench.t < tMax) sim.bench.advance(5e-3, 5e-4);
  const f = sim.bench.failure ?? sim.bench.failures?.[0] ?? null;
  return { sim, f, x: sim.rig.displacement, t: sim.bench.t };
}

test('the shipped settings are a working machine', () => {
  const d = Object.fromEntries(DEF.params.map((p) => [p.key, p.value]));
  const r = drive(d);
  assert.equal(r.f, null, 'the rig must not destroy itself on arrival');
  assert.ok(Math.abs(r.x) < 0.17);
});

test('winding the force up past the spring breaks the spring', () => {
  const r = drive({ m: 2, c: 0.8, k: 5, F: 60 });
  assert.ok(r.f, 'expected a failure');
  assert.equal(r.f.ref, 'SPR');
  assert.match(r.f.cause, /travel/);
  assert.ok(r.t < 1, `should go quickly, took ${r.t}s`);
});

test('a heavy mass on a soft spring still finds the travel limit', () => {
  const r = drive({ m: 10, c: 0.4, k: 20, F: 40 });
  assert.equal(r.f?.ref, 'SPR');
});

test('a fast, stiff rig tears the mount off instead', () => {
  /* The mount carries spring force plus damper force. A soft spring reaches
   * its travel limit long before 48 N, so the mount only goes when the rig
   * is stiff enough and quick enough for the two to add up first. */
  const r = drive({ m: 2, c: 6, k: 400, F: 60 });
  assert.ok(r.f, 'expected a failure');
  assert.equal(r.f.ref, 'MNT', `broke ${r.f.ref} (${r.f.cause}) instead`);
});

test('both failure modes are reachable from the levers', () => {
  /* The regression that prompted the mount's rating change: at 95 N the
   * mount never failed anywhere in the lever space, so the rig had one
   * failure mode and a second one listed on the part sheet for show. */
  const seen = new Set();
  const R = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
  for (const m of R(0.2, 10, 4)) for (const c of R(0, 20, 4))
    for (const k of R(5, 400, 4)) for (const F of R(10, 60, 4)) {
      const r = drive({ m, c, k, F }, 3);
      seen.add(r.f ? r.f.ref : 'survived');
    }
  assert.ok(seen.has('SPR'), 'no spring failure anywhere in the lever space');
  assert.ok(seen.has('MNT'), 'no mount failure anywhere in the lever space');
  assert.ok(seen.has('survived'), 'everything breaks; nothing is a working machine');
});

test('a yielded spring keeps pushing - it does not vanish', () => {
  /* A part that has taken a permanent set has not stopped working. Treating
   * every failure as an open circuit once sent this rig to 138 metres. */
  const r = drive({ m: 2, c: 0.8, k: 5, F: 60 });
  assert.equal(r.f.ref, 'SPR');
  assert.equal(r.sim.rig.cap.failed.mode, 'set');
  assert.ok(Number.isFinite(r.x) && Math.abs(r.x) < 1,
            `a set spring still carries load; got ${r.x} m`);
});

test('the limits do not depend on anything drawing the rig', () => {
  // the regression this file exists for: nothing here touches world/
  const r = drive({ m: 2, c: 0, k: 5, F: 60 });
  assert.ok(r.f, 'the model must detect its own failure, with no view attached');
});
