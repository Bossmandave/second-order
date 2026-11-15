/* Real part ratings.
 *
 * Every number here is a claim about a physical object, so they are kept in
 * one place rather than scattered through the circuits that use them. The
 * thermal numbers are the ones that decide how the piece FEELS - theta sets
 * how hot a part gets for a given overload, tau sets how long you have to
 * change your mind - so they are the first place to look when something dies
 * too fast to react to or too slowly to care about.
 *
 * theta  junction/body-to-ambient thermal resistance, degC per watt
 * tau    thermal time constant, seconds. Small parts heat in seconds, which
 *        is why brief overloads survive and sustained ones do not.
 * tMax   body or junction temperature at which it gives up, degC
 */

export const AMBIENT = 25;

export const PARTS = {
  'R_0.25W': { label: '1/4 W carbon film', pMax: 0.25, theta: 300, tau: 3.0, tMax: 155, mode: 'open' },
  'R_0.5W':  { label: '1/2 W carbon film', pMax: 0.5,  theta: 180, tau: 5.0, tMax: 155, mode: 'open' },
  'R_1W':    { label: '1 W metal film',    pMax: 1.0,  theta: 100, tau: 9.0, tMax: 200, mode: 'open' },

  // An LED dies by current, not really by bulk temperature: the junction is
  // tiny and its time constant is in milliseconds, so overcurrent is close to
  // instantaneous. tau is small to reflect that rather than to be dramatic.
  LED_5MM:   { label: '5 mm LED', iMax: 0.030, pMax: 0.1, theta: 450, tau: 0.25, tMax: 125, mode: 'open' },

  // Electrolytics fail on voltage far more often than on heat, and reverse
  // voltage is the classic way to make one vent. Both are checked.
  CAP_ELEC_16V: { label: '16 V electrolytic', vMax: 16, vRev: 1.5, theta: 120, tau: 12, tMax: 105, mode: 'open', vents: true },
  CAP_ELEC_25V: { label: '25 V electrolytic', vMax: 25, vRev: 1.5, theta: 120, tau: 12, tMax: 105, mode: 'open', vents: true },

  // Film: no polarity, so it can sit in a resonant tank where the voltage
  // reverses every half cycle. An electrolytic in that position is not a
  // design choice, it is a countdown.
  CAP_FILM_63V: { label: '63 V film', vMax: 63, theta: 90, tau: 15, tMax: 85, mode: 'open' },

  // A fuse is an I^2t device: it is defined by the energy it will pass, not by
  // a current threshold, which is why it survives inrush and still clears a
  // short. i2t is in A^2-seconds above the rated current.
  /* A fuse element is a short length of thin wire with almost no thermal
   * mass and nothing to conduct heat into, which is why it glows before it
   * parts. theta is enormous and tau tiny for exactly that reason - this is
   * not tuning for drama, it is what a 15 mm strand of tin in still air
   * actually does. Two paths can kill it: I^2t carries a dead short before
   * the wire has time to heat, while a moderate overload cooks it slowly
   * enough that you watch it go orange first. */
  FUSE_1A:   { label: '1 A fast-blow', ohms: 0.12, iRated: 1.0, i2t: 4.0,
               theta: 820, tau: 0.22, tMax: 950, mode: 'open' },

  // A wirewound load resistor: made to get hot, and to be the weak link when
  // nothing more fragile is in the circuit.
  R_WW_3W:   { label: '3 W wirewound', pMax: 3.0, theta: 95, tau: 7.0, tMax: 280, mode: 'open' },

  DIODE_1N4148: { label: '1N4148', iMax: 0.2, pMax: 0.5, theta: 350, tau: 0.8, tMax: 175, mode: 'short' },

  // Mechanical parts use the same shape. A spring has no temperature; it has a
  // travel limit, and exceeding it is permanent.
  SPRING_STD: { label: 'compression spring', xMax: 0.17, mode: 'set' },
  /* 48 N, not 95. At 95 the mount was decorative: the spring's own force is
   * capped by its travel at 400 N/m x 0.17 m = 68 N, so across a sweep of
   * 3,528 lever settings the mount never once failed - 2,130 spring failures
   * and nothing else. Two failure modes of which one is unreachable is one
   * failure mode and a lie on the part list. At 48 N the split is roughly
   * 1,385 spring to 893 mount, the spring still goes first in the soft,
   * obvious cases, and the shipped settings still survive indefinitely. */
  /* The beam is one object with two ways to die, so it carries two spec
   * cards. Yield is a threshold you cross in a single swing and it bends the
   * beam permanently - mode 'set', because a bent beam still vibrates.
   * Fatigue is a running total that kills a beam which never once went near
   * yield, which is why resonance is dangerous in the field. */
  BEAM_STEEL:   { label: 'mild steel beam', sigMax: 250e6, mode: 'set' },
  BEAM_FATIGUE: { label: 'beam fatigue life', dMax: 1, mode: 'break' },
  MOUNT_STD:  { label: 'bench mount', fMax: 48, mode: 'break' },
};

export const part = (key) => {
  const p = PARTS[key];
  if (!p) throw new Error(`unknown part "${key}"`);
  return p;
};
