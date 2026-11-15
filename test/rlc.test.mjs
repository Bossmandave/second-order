import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../solver/mna.js';

/** Series RLC ringing down from a charged capacitor. Returns the v_C trace. */
function ring({ L, C, R, v0, h, tEnd }) {
  const ckt = new Circuit();
  const cap = ckt.C(1, 0, C, { ic: v0 });
  ckt.L(1, 2, L);
  ckt.R(2, 0, R);
  const trace = [];
  ckt.transient({ h, tEnd, onStep: (t) => trace.push([t, cap.v]) });
  return trace;
}

/** Peak magnitudes of a decaying oscillation, by local maximum of |v|. */
function peaks(trace) {
  const out = [];
  for (let i = 1; i < trace.length - 1; i++) {
    const a = Math.abs(trace[i - 1][1]), b = Math.abs(trace[i][1]), c = Math.abs(trace[i + 1][1]);
    if (b > a && b >= c) out.push([trace[i][0], b]);
  }
  return out;
}

test('damping ratio recovered from the decay matches R/2 * sqrt(C/L)', () => {
  const L = 10e-3, C = 1e-6;
  for (const zetaWanted of [0.05, 0.1, 0.2]) {
    const R = 2 * zetaWanted * Math.sqrt(L / C);
    const omegaN = 1 / Math.sqrt(L * C);
    const T = (2 * Math.PI) / (omegaN * Math.sqrt(1 - zetaWanted ** 2));

    const trace = ring({ L, C, R, v0: 10, h: T / 2000, tEnd: 6 * T });
    const p = peaks(trace);
    assert.ok(p.length >= 3, 'not enough peaks to measure');

    // log decrement over the half-cycles between successive |peaks|
    const delta = 2 * Math.log(p[0][1] / p[1][1]);
    const zeta = delta / Math.sqrt(4 * Math.PI ** 2 + delta ** 2);
    const err = Math.abs(zeta - zetaWanted) / zetaWanted;
    console.log(`    zeta wanted ${zetaWanted}  measured ${zeta.toFixed(5)}  err ${(err * 100).toFixed(3)}%`);
    assert.ok(err < 0.01, `zeta ${zeta} vs ${zetaWanted}`);
  }
});

test('ringing frequency matches the damped natural frequency', () => {
  const L = 10e-3, C = 1e-6, zeta = 0.1;
  const R = 2 * zeta * Math.sqrt(L / C);
  const omegaN = 1 / Math.sqrt(L * C);
  const omegaD = omegaN * Math.sqrt(1 - zeta ** 2);
  const T = (2 * Math.PI) / omegaD;

  const p = peaks(ring({ L, C, R, v0: 10, h: T / 4000, tEnd: 8 * T }));
  const measuredT = 2 * (p[2][0] - p[1][0]);          // peaks alternate sign
  const err = Math.abs(measuredT - T) / T;
  console.log(`    period expected ${(T * 1e6).toFixed(2)}us  measured ${(measuredT * 1e6).toFixed(2)}us  err ${(err * 100).toFixed(3)}%`);
  assert.ok(err < 0.01);
});

test('undamped LC conserves energy over 50 cycles', () => {
  const L = 10e-3, C = 1e-6, v0 = 10;
  const omegaN = 1 / Math.sqrt(L * C);
  const T = (2 * Math.PI) / omegaN;

  const ckt = new Circuit();
  const cap = ckt.C(1, 0, C, { ic: v0 });
  const ind = ckt.L(1, 0, L);
  const E0 = 0.5 * C * v0 ** 2;
  let worst = 0;
  ckt.transient({
    h: T / 500, tEnd: 50 * T,
    onStep: () => {
      const E = 0.5 * C * cap.v ** 2 + 0.5 * L * ind.i ** 2;
      worst = Math.max(worst, Math.abs(E - E0) / E0);
    },
  });
  console.log(`    worst energy drift over 50 cycles: ${(worst * 100).toFixed(4)}%`);
  assert.ok(worst < 0.005, `energy drifted ${(worst * 100).toFixed(3)}%`);
});
