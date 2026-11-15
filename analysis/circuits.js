/* The stations.
 *
 * Each one owns its netlist, its part ratings and its pacing, so the thing being
 * solved and the thing being drawn can never drift apart. Positions are in a
 * 0-100 grid that the renderer scales; keeping them unitless means the panel
 * can be any size without a second set of numbers to maintain.
 */

import { Circuit } from '../solver/mna.js';
import { Beam, Fatigue } from '../solver/beam.js';
import { Bench } from '../solver/bench.js';
import { part } from '../solver/parts.js';
import { MassSpringDamper } from '../solver/mechanical.js';

const p = (key, label, min, max, value, unit, step = 0.1, opts = {}) =>
  ({ key, label, min, max, value, unit, step, ...opts });

export const CIRCUITS = [
  {
    id: 'led',
    pace: { scale: 1 / 20, tEnd: 1.2 }, short: 'LED',
    title: 'LED + series resistor',
    blurb: 'The first thing anyone builds, and the first thing anyone kills. '
         + 'The resistor is the only thing standing between the supply and a '
         + 'junction that has no current limit of its own.',
    params: [p('V', 'Supply', 0, 24, 5, 'V'), p('R', 'Series R', 47, 1000, 220, 'Ω', 1)],
    build({ V, R }) {
      const ckt = new Circuit();
      ckt.V(1, 0, V, { ref: 'PSU' });
      ckt.R(1, 2, R, { spec: part('R_0.25W'), ref: 'R1' });
      // A red LED, not a signal diode: Is is set so the forward drop lands
      // near 1.9 V at 20 mA rather than the 0.7 V of a 1N4148.
      const led = ckt.D(2, 0, { Is: 2e-18, N: 2, spec: part('LED_5MM'), ref: 'D1' });
      return { ckt, probes: { 'LED current': () => led.i, 'LED voltage': () => led.v } };
    },
  },

  {
    id: 'rc',
    pace: { scale: 1 / 4, tEnd: 0.8 }, short: 'RC',
    title: 'RC charge',
    blurb: 'First order, and the gentlest thing on the bench. Worth a minute '
         + 'because the trace it draws is the one everything else is measured '
         + 'against. The cap is a 16 V part and the supply goes to 24, so it '
         + 'is also the shortest lesson in reading a datasheet.',
    params: [p('V', 'Supply', 0, 24, 10, 'V'), p('R', 'R', 100, 10000, 1000, 'Ω', 10),
             p('C', 'C', 1, 470, 100, 'μF', 1)],
    build({ V, R, C }) {
      const ckt = new Circuit();
      ckt.V(1, 0, V, { ref: 'PSU' });
      ckt.R(1, 2, R, { spec: part('R_0.25W'), ref: 'R1' });
      /* A 16 V part, not the 25 V it used to be. With a 24 V supply ceiling
       * a 25 V cap cannot be over-volted by anything, and a sweep of the
       * whole knob space found exactly zero reachable failures: this was the
       * one bench where nothing you did mattered. At 16 V roughly a seventh
       * of the space kills it, and the lesson is the real one - a cap is
       * chosen against the supply, not against the current. */
      const cap = ckt.C(2, 0, C * 1e-6, { spec: part('CAP_ELEC_16V'), ref: 'C1' });
      return { ckt, probes: { 'Capacitor voltage': () => cap.v, 'Charging current': () => cap.i } };
    },
  },

  {
    id: 'rlc', short: 'RLC', console: true,
    pace: { scale: 1 / 2, tEnd: 6 },
    title: 'Driven RLC',
    blurb: 'A tank with a shaker on it. Sweep the drive and almost nothing '
         + 'happens until you cross the tank\u2019s own frequency, where the '
         + 'capacitor voltage becomes Q times what you are putting in. Five '
         + 'volts in, two hundred across the cap, and a 63 V part. This is '
         + 'the beam across the room, in copper.',
    /* Values chosen so the resonance lands between 16 and 113 Hz - slow
     * enough to watch the waveform rather than infer it from an envelope,
     * and the same band the beam works in, which is the point of having
     * both. The drive is a log lever: at a Q of 40 the peak is a couple of
     * percent wide, and on a linear lever you would never find it. */
    params: [
      p('f', 'Drive', 5, 250, 60, 'Hz', 0.5, { log: true, dp: 1 }),
      p('A', 'Amplitude', 0, 10, 2, 'V', 0.1, { dp: 1 }),
      p('R', 'R', 1, 200, 20, '\u03a9', 1, { dp: 0 }),
      p('C', 'C', 10, 470, 100, '\u03bcF', 1, { dp: 0 }),
    ],
    build({ f, A, R, C }) {
      const ckt = new Circuit();
      const L = 0.2;                       // fixed choke, so the knobs stay few

      /* Phase is carried explicitly rather than recomputed from t.
       *
       * The drive frequency is a live control, and sin(2*pi*f*t) jumps the
       * moment f changes - a step discontinuity straight into a high-Q tank,
       * which rings it hard and looks exactly like the resonance you were
       * hunting for. Holding phase continuous across a tuning change is the
       * difference between a sweep and a series of accidental hammer blows.
       */
      const d = { f, A, phase0: 0, t0: 0 };
      const src = ckt.V(1, 0, (t) => d.A * Math.sin(d.phase0 + 2 * Math.PI * d.f * (t - d.t0)),
                        { ref: 'GEN' });
      const res = ckt.R(1, 2, R, { spec: part('R_1W'), ref: 'R1' });
      const ind = ckt.L(2, 3, L, { ref: 'L1' });
      const cap = ckt.C(3, 0, C * 1e-6, { spec: part('CAP_FILM_63V'), ref: 'C1' });
      return {
        ckt, drive: d, L, res, ind, cap, src,
        probes: { 'Capacitor voltage': () => cap.v, 'Loop current': () => ind.i },
        phase: () => [cap.v, ind.i],
        meta: { zeta: (R / 2) * Math.sqrt((C * 1e-6) / L),
                omegaN: 1 / Math.sqrt(L * C * 1e-6) },
      };
    },
    tune(sim, { f, A, R, C }) {
      const d = sim.drive;
      const t = sim.bench?.t ?? 0;
      if (f !== d.f) {
        // advance the accumulated phase to now, then continue at the new rate
        d.phase0 += 2 * Math.PI * d.f * (t - d.t0);
        d.t0 = t;
        d.f = f;
      }
      d.A = A;
      sim.res.value = R;
      if (C != null) {
        // swapping the cap keeps its voltage; charge follows the new value
        sim.cap.value = C * 1e-6;
      }
      sim.meta.zeta = (R / 2) * Math.sqrt((C * 1e-6) / sim.L);
      sim.meta.omegaN = 1 / Math.sqrt(sim.L * C * 1e-6);
    },
    readouts(sim) {
      const f0 = sim.meta.omegaN / (2 * Math.PI);
      const Q = 1 / (2 * sim.meta.zeta);
      return [
        { label: 'f\u2080', value: f0.toFixed(1), unit: 'Hz' },
        { label: 'Q', value: Q.toFixed(1), unit: '' },
        { label: 'Vcap', value: Math.abs(sim.cap.v).toFixed(1), unit: 'V' },
      ];
    },
  },

  {
    id: 'rect',
    pace: { scale: 1 / 300, tEnd: 0.1 }, short: 'Rect',
    title: 'Rectifier + smoothing cap',
    blurb: 'Put the electrolytic in backwards and it will tell you. This is '
         + 'the station where the failure is worth watching rather than just '
         + 'worth knowing about.',
    params: [p('V', 'AC peak', 0, 40, 12, 'V'), p('f', 'Frequency', 10, 200, 50, 'Hz', 1),
             p('C', 'Smoothing C', 1, 1000, 220, 'μF', 1), p('R', 'Load', 100, 10000, 1000, 'Ω', 10),
             p('rev', 'Cap reversed', 0, 1, 0, '', 1)],
    build({ V, f, C, R, rev }) {
      const ckt = new Circuit();
      ckt.V(1, 0, (t) => V * Math.sin(2 * Math.PI * f * t), { ref: 'AC' });
      ckt.D(1, 2, { ref: 'D1' });
      // Reversing the cap swaps its terminals, so the rectified positive rail
      // appears across it backwards - which is exactly how this fails in life.
      const cap = rev >= 0.5
        ? ckt.C(0, 2, C * 1e-6, { spec: part('CAP_ELEC_16V'), ref: 'C1' })
        : ckt.C(2, 0, C * 1e-6, { spec: part('CAP_ELEC_16V'), ref: 'C1' });
      const load = ckt.R(2, 0, R, { spec: part('R_1W'), ref: 'R1' });
      return { ckt, probes: { 'Output': () => load.v, 'Cap voltage': () => cap.v } };
    },
  },

  {
    id: 'fuse', short: 'Fuse',
    pace: { scale: 1 / 4, tEnd: 12 },
    title: 'Fuse',
    blurb: 'An I\u00b2t device: defined by the energy it will pass, not by a '
         + 'current. Just over its rating it cooks for a second and you watch '
         + 'it go orange. A dead short flashes and is gone in milliseconds.',
    params: [p('V', 'Supply', 0, 24, 3, 'V'), p('R', 'Load', 0.5, 20, 2, '\u03a9', 0.1)],
    build({ V, R }) {
      const ckt = new Circuit();
      ckt.V(1, 0, V, { ref: 'PSU' });
      const f = ckt.R(1, 2, part('FUSE_1A').ohms, { spec: part('FUSE_1A'), ref: 'F1' });
      const load = ckt.R(2, 0, R, { spec: part('R_WW_3W'), ref: 'R1' });
      return { ckt, probes: { 'Current': () => f.i, 'Element temp': () => f._T ?? 25 } };
    },
  },

  {
    id: 'beam', short: 'Beam', console: true, beam: true,
    pace: { scale: 1, tEnd: 20 },
    title: 'Resonant beam',
    units: { v: 'N', i: 'm/s' },
    blurb: 'Three natural frequencies, stamped on the plate. Sweep the '
         + 'shaker and almost nothing happens until you cross one, and then '
         + 'the beam moves in a shape \u2014 whole span at 21 Hz, dead still '
         + 'in the middle at 86. Push on a node and that mode will not wake '
         + 'at all. It cracks where the CURVATURE is worst, not where the '
         + 'motion is biggest, so the crack tells you which mode did it.',
    /* Damping defaults low enough to be interesting and high enough to find.
     * At the steel-like zeta of 0.002 the peaks are a fifth of a percent
     * wide: on any lever that will fit on a bench the entire resonance is
     * one pixel, and the station is a guessing game rather than a hunt. */
    /* ONE control.
     *
     * This started with five - drive, force, shaker position, damping,
     * strobe - and every one was defensible on its own. Together they buried
     * the station: you cannot learn that pushing on a node silences a mode
     * before you have ever felt a resonance at all, and a five-lever panel
     * asks you to understand the whole machine before it will show you
     * anything. The rest are fixed at values chosen by measurement, so that
     * all three modes read clearly against the background and sitting on the
     * first one is fatal in about a minute. They come back later, earned.
     */
    params: [p('f', 'Drive', 10, 220, 40, 'Hz', 0.2, { log: true, dp: 1, gain: 900 })],
    dial: 'f',
    readOnly: true,
    build({ f }) {
      /* Shaker at 0.21 of the span: not a node of mode 1, 2 or 3, so every
       * resonance in the band can be reached. The nodes sit at halves and
       * thirds and 0.21 is clear of all of them. Force and damping were
       * picked by sweeping: at 11 N and zeta 0.012 the three peaks show at
       * 130, 61 and 12 mm of drawn swing against a 2 mm background, and
       * sitting on mode 1 cracks the beam in about 47 seconds. */
      const A = 11, pos = 0.21, z = 0.012;
      const beam = new Beam({ modes: 3, zeta: z, drive: pos, force: A, freq: f });
      const ckt = beam.ckt;
      const fatigue = new Fatigue({ yieldStress: 250e6 });

      /* Two inert probes carrying the beam's spec cards.
       *
       * The failure pass walks circuit elements, and the beam's limits are
       * properties of the structure rather than of any one modal branch -
       * hanging them on, say, mode 1's capacitor would mean a crack only
       * opened one mode's loop and the others carried on ringing. A
       * teraohm to ground is electrically nothing and gives each limit
       * somewhere to live. */
      const free = 3 * beam.modes.length + 2;
      const yielded = ckt.R(free, 0, 1e12, { spec: part('BEAM_STEEL'), ref: 'BEAM' });
      const life = ckt.R(free + 1, 0, 1e12, { spec: part('BEAM_FATIGUE'), ref: 'LIFE' });
      Object.defineProperty(yielded, 'sigma', {
        get: () => beam.peakStress().sigma, enumerable: true, configurable: true,
      });
      Object.defineProperty(life, 'damage', {
        get: () => fatigue.damage, enumerable: true, configurable: true,
      });

      /* Stress AMPLITUDE, not instantaneous stress. Fatigue is driven by the
       * swing, and the instantaneous value passes through zero twice a
       * cycle; an envelope follower that decays over a few cycles tracks the
       * swing without needing to detect peaks. */
      const env = { sigma: 0, at: 0.5, showSigma: 0, showSwing: 0 };
      const onStep = (t, h) => {
        const { sigma, at } = beam.peakStress(41);
        /* Two time constants, because the envelope is doing two jobs.
         * Fatigue wants the true swing of each cycle, so it follows the
         * stress over about three cycles. A readout wants to be READ: at
         * 86 Hz a three-cycle envelope still visibly flickers, and a number
         * that moves 170 times a second is not information. The display
         * pair settle over a third of a second - slow enough to hold still,
         * fast enough to answer the dial. */
        const tau = 3 / Math.max(beam.d.f, 1);
        env.sigma = Math.max(sigma, env.sigma * Math.exp(-h / tau));
        if (sigma >= env.sigma) env.at = at;
        fatigue.step(env.sigma, beam.d.f, h);

        const k = Math.exp(-h / 0.33);
        env.showSigma = Math.max(sigma, env.showSigma * k);
        env.showSwing = Math.max(beam.peakDeflection(41), env.showSwing * k);
      };

      return {
        ckt, beam, fatigue, env, onStep,
        probes: {
          'Deflection': () => beam.w(0.5) * 1000,
          'Stress': () => beam.stress(beam.peakStress(41).at) / 1e6,
        },
        phase: () => [beam.w(0.5) * 1000, beam.modes[0].cap.i],
        meta: { zeta: z, omegaN: beam.modes[0].omega },
      };
    },
    tune(sim, { f }) {
      sim.beam.tune({ freq: f }, sim.bench?.t ?? 0);
    },
    readouts(sim) {
      /* Envelopes, not instantaneous values.
       *
       * The beam passes through zero twice a cycle, so a live reading of
       * deflection or stress spends half its time near nothing - at 86 Hz
       * that is a number flickering 170 times a second between 0.0 and the
       * peak, which is not a readout, it is a strobe light with digits.
       * sim.env already follows the stress amplitude for the fatigue
       * calculation; the swing gets the same treatment. */
      return [
        { label: 'swing', value: (sim.env.showSwing * 1000).toFixed(2), unit: 'mm' },
        { label: 'stress', value: (sim.env.showSigma / 1e6).toFixed(0), unit: 'MPa' },
        { label: 'life used', value: (sim.fatigue.damage * 100).toFixed(0), unit: '%' },
      ];
    },
    /* The premise is "tune to one of THESE", so the numbers have to be
     * somewhere you can read: a plate on the frame, and marks on the dial.
     * Without them it is a blind search with no gradient to follow, which is
     * unplayable however right the physics underneath is. */
    marks: (sim) => sim.beam.frequencies,
  },

  {
    id: 'msd', units: { v: 'N', i: 'm/s' },
    /* Real time. Every other station is slowed down because its events
     * happen in microseconds, but a mass on a spring oscillates at human
     * speed already - the default is about 0.8 Hz - and halving that made
     * the one station you are meant to feel in your body look sluggish. */
    pace: { scale: 1, tEnd: 8 }, short: 'Mass',
    title: 'Mass, spring, damper',
    blurb: 'The same equation as the tank, wearing different units. Mass is '
         + 'inductance, damping is resistance, the spring is a capacitor. '
         + 'Watch the phase portrait and then go back and look at the RLC.',
    mechanical: true,
    params: [p('m', 'Mass', 0.2, 10, 2, 'kg'), p('c', 'Damping', 0, 20, 0.8, 'N·s/m'),
             p('k', 'Stiffness', 5, 400, 50, 'N/m', 1), p('F', 'Force', 0, 60, 4, 'N')],
    build({ m, c, k, F }) {
      const rig = new MassSpringDamper({ m, c, k, force: F });
      /* The spring IS the capacitor and the mount IS the force source, so
       * their limits hang off those elements. The thermal pass already knows
       * how to check xMax and fMax; nothing mechanical-specific is needed. */
      rig.cap.spec = part('SPRING_STD');
      rig.cap.ref = 'SPR';
      const src = rig.ckt.elements.find((e) => e.type === 'V');
      src.spec = part('MOUNT_STD');
      src.ref = 'MNT';

      /* The failure rules read el.x and el.f. Those used to be written by the
       * 3D station every frame, which meant the rig could only break while
       * something was drawing it - the model on its own would stretch to
       * twenty metres and report nothing, and no test could catch it. They
       * are derived quantities, so they belong on the elements as getters:
       * now the rig fails identically in the browser, in a headless run and
       * in a unit test, and there is one definition of each rather than two. */
      Object.defineProperty(rig.cap, 'x', {
        get: () => rig.displacement, enumerable: true, configurable: true,
      });
      Object.defineProperty(src, 'f', {
        // what the mount actually carries: spring force plus damper force
        get: () => Math.abs(rig.k * rig.displacement) + Math.abs(rig.c * rig.velocity),
        enumerable: true, configurable: true,
      });
      return {
        ckt: rig.ckt, rig,
        probes: { 'Displacement': () => rig.displacement, 'Velocity': () => rig.velocity },
        phase: () => [rig.displacement, rig.velocity],
        meta: { zeta: rig.zeta, omegaN: rig.omegaN },
      };
    },
  },
];

export function makeStation(def, values) {
  const built = def.build(values);
  const bench = new Bench({ circuit: built.ckt });
  if (built.onStep) bench.onStep = built.onStep;
  return { def, ...built, bench };
}

export const defaults = (def) =>
  Object.fromEntries(def.params.map((q) => [q.key, q.value]));
