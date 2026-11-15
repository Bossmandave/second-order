/* Damage that outlives the session.
 *
 * The point of the rack - and of the dark room generally - is that what you
 * broke stays broken. A station that resets itself on reload turns failure
 * into a demo you watch; one that remembers turns it into a consequence.
 *
 * localStorage only, keyed per station. It belongs to one browser and can
 * come back empty or throw outright (private windows, storage disabled), so
 * every call is wrapped: losing the history is a disappointment, not a fault.
 */

const KEY = 'second-order/damage/v1';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
}

export function recall(id) { return read()[id] ?? null; }

export function record(id, failure) {
  try {
    const all = read();
    all[id] = {
      cause: failure.cause, part: failure.part, ref: failure.ref,
      mode: failure.mode, peakT: failure.peakT ?? null,
      survived: failure.survived, at: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable: the run still happened, it just won't persist */ }
}

export function forget(id) {
  try {
    const all = read();
    delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* nothing to do */ }
}

/** How recently, 0..1, so a fresh kill can still be cooling. */
export function freshness(entry) {
  if (!entry) return 0;
  const age = (Date.now() - entry.at) / 1000;
  return Math.max(0, 1 - age / 90);
}
