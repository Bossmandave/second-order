/* The failure wall: what everyone who came before you broke.
 *
 * Deliberately NOT the Firebase SDK. The modular SDK is around a hundred
 * kilobytes gzipped for what amounts to one document read and one write per
 * visit - next to a 169 KB bundle that is not a rounding error, it is most
 * of a second on a phone. The REST API does the same job in about two
 * kilobytes of fetch calls, so that is what this uses.
 *
 * Everything here is best-effort. No await in this module is allowed to
 * decide whether the room works: if the network is gone, the keys are not
 * filled in, or Firestore says no, the wall falls back to what this browser
 * has broken locally and the piece carries on exactly as it does offline.
 */
import { CONFIG } from '../firebase.config.js';

const LOCAL = 'second-order/wall';
const DOC = 'second-order/board';
const KEEP = 30;              // tags on the wall
const TIMEOUT = 4000;

/* Seeded from the failures logged while building and testing this. They are
 * real breakages, just mine. A tally reading zero makes a room that nobody
 * has visited, which is both untrue and a bad first impression. */
const SEED = { lamp: 212, fuse: 96, cap: 41, diode: 58, beam: 73, rig: 64 };

/* Captured by driving every station to destruction and keeping whatever the
 * real failure path produced - not written by hand. They sit at the bottom
 * of the wall as the oldest entries, and real visitors push them off it. */
const SEED_TAGS = [
  'F1  1 A fast-blow  ·  overheated 950 °C  ·  0.0 s',
  'D1  5 mm LED  ·  overcurrent 71.8 mA  ·  0.0 s',
  'C1  16 V electrolytic  ·  overvoltage 16.5 V  ·  0.0 s',
  'MNT  bench mount  ·  overload 48 N  ·  0.2 s',
  'D1  5 mm LED  ·  overcurrent 58.7 mA  ·  0.0 s',
  'F1  1 A fast-blow  ·  overheated 952 °C  ·  0.0 s',
  'C1  16 V electrolytic  ·  overvoltage 16.1 V  ·  0.0 s',
  'D1  5 mm LED  ·  overcurrent 84.8 mA  ·  0.0 s',
  'D1  5 mm LED  ·  overcurrent 45.7 mA  ·  0.0 s',
  'C1  16 V electrolytic  ·  overvoltage 16.7 V  ·  0.0 s',
  'F1  1 A fast-blow  ·  overheated 951 °C  ·  0.1 s',
  'SPR  compression spring  ·  travel exceeded 0.17 m  ·  0.3 s',
  'MNT  bench mount  ·  overload 48 N  ·  0.3 s',
  'LIFE  beam fatigue life  ·  fatigue crack  ·  43.5 s',
];

const live = () => !!(CONFIG.apiKey && CONFIG.projectId
  && !CONFIG.apiKey.startsWith('YOUR_'));

const base = () => `https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}`
  + `/databases/(default)/documents/${DOC}`;

async function timed(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

/* Anonymous auth by REST. One call, and the token lives only as long as the
 * page does - there is nothing here worth persisting a session for. */
let token = null;
async function auth() {
  if (token) return token;
  const r = await timed(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${CONFIG.apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }) });
  if (!r.ok) throw new Error(`auth ${r.status}`);
  token = (await r.json()).idToken;
  return token;
}

// Firestore's wire format is typed; these two just get in and out of it.
const unwrap = (f = {}) => ({
  counts: Object.fromEntries(Object.entries(f.counts?.mapValue?.fields ?? {})
    .map(([k, v]) => [k, Number(v.integerValue ?? 0)])),
  tags: (f.tags?.arrayValue?.values ?? []).map((v) => v.stringValue),
});
const wrapTags = (tags) => ({ arrayValue: { values: tags.map((t) => ({ stringValue: t })) } });

const readLocal = () => {
  try { return JSON.parse(localStorage.getItem(LOCAL)) ?? { counts: {}, tags: [] }; }
  catch { return { counts: {}, tags: [] }; }
};
const writeLocal = (s) => {
  try { localStorage.setItem(LOCAL, JSON.stringify(s)); } catch { /* private mode */ }
};

const merge = (remote) => {
  const mine = readLocal();
  const counts = { ...SEED };
  for (const [k, v] of Object.entries(remote.counts ?? {})) counts[k] = (counts[k] ?? 0) + v;
  // offline-only breakages still show, so the wall is never a lie about you
  if (!remote.synced) for (const [k, v] of Object.entries(mine.counts)) counts[k] = (counts[k] ?? 0) + v;
  /* Seeds first, so they are the oldest lines. As real failures arrive they
   * push the seed off the bottom and the wall becomes other people's. */
  const tags = [...SEED_TAGS, ...(remote.synced ? remote.tags : mine.tags)].slice(-KEEP);
  return { counts, tags, synced: !!remote.synced, mineCount: mine.tags.length };
};

/** The wall as it stands. Never throws, never blocks the room. */
export async function load() {
  if (!live()) return merge({ synced: false });
  try {
    const r = await timed(base(), { headers: { Authorization: `Bearer ${await auth()}` } });
    if (!r.ok) return merge({ synced: false });
    const d = unwrap((await r.json()).fields);
    return merge({ ...d, synced: true });
  } catch { return merge({ synced: false }); }
}

/**
 * Hang a tag and tick the tally.
 *
 * The counter goes up through Firestore's own `increment` transform, so two
 * people breaking the same part at the same moment both count. The tag list
 * cannot work that way - keeping only the last thirty is not something a
 * transform expresses - so it is read, appended and written whole. Two
 * simultaneous visitors means one tag is lost. On a wall thirty lines long
 * that is a fair trade for not running a transaction per breakage.
 */
export async function post(kind, tag, known = []) {
  const mine = readLocal();
  mine.counts[kind] = (mine.counts[kind] ?? 0) + 1;
  mine.tags = [...mine.tags, tag].slice(-KEEP);
  writeLocal(mine);
  if (!live()) return;
  try {
    const t = await auth();
    const tags = [...known, tag].slice(-KEEP);
    await timed(
      `https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}`
      + `/databases/(default)/documents:commit`,
      { method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes: [
          { transform: {
            document: `projects/${CONFIG.projectId}/databases/(default)/documents/${DOC}`,
            fieldTransforms: [{ fieldPath: `counts.${kind}`,
              increment: { integerValue: '1' } }] } },
          { update: {
            name: `projects/${CONFIG.projectId}/databases/(default)/documents/${DOC}`,
            fields: { tags: wrapTags(tags) } },
            updateMask: { fieldPaths: ['tags'] } },
        ] }) });
  } catch { /* the local copy already took it */ }
}

/* One line of the wall.
 *
 * Shared with whatever writes the seed, so the seeded lines and the ones
 * visitors generate cannot drift into different shapes.
 *
 * Two things worth knowing. Trailing zeros are only stripped after a decimal
 * point - doing it unconditionally turns a 100 degree failure into a 1
 * degree one, which this did until someone read the output. And currents
 * below half an amp are shown in mA, because "0.0511 A" is how a number looks
 * when nobody thought about the reader.
 */
const trim = (s) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);

export function tagFor(f) {
  let mid = `  ·  ${f.cause}`;
  if (f.value != null && f.unit !== 'of life') {
    let v = +f.value, u = f.unit ?? '';
    if ((u === 'A' || u === 'V') && Math.abs(v) < 0.5 && v !== 0) { v *= 1000; u = `m${u}`; }
    mid += ` ${trim(v.toPrecision(3))}${u ? ' ' + u : ''}`;
  }
  return `${f.ref}  ${f.part}${mid}  ·  ${(f.at ?? f.t ?? 0).toFixed(1)} s`;
}

export { KEEP };
