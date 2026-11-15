# Second Order

An interactive workshop where you overload circuits and machines until they fail.

Seven benches in a dark bay. Turn the supply up and watch a resistor char, a
fuse open, an electrolytic vent, a spring go solid, a steel beam crack from
fatigue. Every failure is computed, not scripted: parts die because the
simulation says they have, and the scope shows what killed them.

## The thesis

A mass on a spring with a damper obeys

    m·ẍ + c·ẋ + k·x = F

and a series RLC circuit obeys

    L·q̈ + R·q̇ + q/C = V

These are the same equation. Mass is inductance, damping is resistance,
compliance is capacitance, force is voltage, velocity is current. So the
piece runs one solver, and the mechanical rig is a circuit the renderer
happens to draw as a spring.

The resonant beam extends the same idea. A beam's motion decomposes into
independent modes, and independent means they do not interact — so an
N-mode beam is N series-RLC loops in one block-diagonal circuit. No new
solver machinery, just more of it.

## What is actually modelled

- **Modified nodal analysis** with trapezoidal integration and
  Newton–Raphson for the nonlinear parts, with SPICE's `pnjlim` damping and
  a `gmin` conductance so diodes converge instead of oscillating.
- **Thermal**: one lump per part — power in, heat out to ambient, with each
  part's own thermal resistance and time constant. Parts fail on
  temperature, current, voltage, reverse voltage or I²t, whichever comes
  first.
- **Fatigue**: Miner's rule against an S-N curve with an endurance limit, so
  the beam accumulates damage only above a threshold stress and cracks when
  the accumulated damage reaches one.
- **Mode shapes**: φₙ(x) = sin(nπx/L) for a simply-supported beam, with
  ωₙ ∝ n². Stress follows curvature rather than deflection, which is why the
  mode that looks most dramatic is not the one that breaks it.

## Running it

```sh
npm install
npm run dev          # builds, then serves on http://127.0.0.1:8099
```

Then open <http://127.0.0.1:8099>.

`npm run dev` builds first on purpose. `index.html` loads one bundled file
rather than the raw modules, and that bundle is generated — it is not in
git — so serving the folder without building gives you a black screen.

While changing things, run the watcher and a server in two terminals, so a
save rebuilds in about a tenth of a second and you just reload:

```sh
npm run watch
python3 -m http.server 8099 --bind 127.0.0.1
```

Tests need no browser and no dependencies — `node:test` and the solver only:

```sh
npm test             # 46 tests over the solver, the parts and the failures
```

`npm run build` bundles and minifies; `npm run release` additionally writes
`dist/` as a deployable with a content-hashed bundle and the static files.

The dev server is Python's, because it is already on macOS and Linux. On
Windows, or without Python, anything that serves a folder over HTTP works —
`npx serve dist` or a VS Code live-server extension. Opening `index.html`
from the filesystem will **not** work: ES modules need a real origin.

## Layout

```
solver/      the physics: MNA, thermal, fatigue, the beam's modal model
analysis/    station definitions — what each bench is made of
world/       three.js — the room, the benches, the parts, the instruments
net/         the failure wall's data layer (Firestore over REST)
test/        node:test, no browser needed
scripts/     the esbuild bundle
```

`world/station.js` is the biggest file and does the most: it builds every
kind of bench, lays out parts, drives three sorts of animation and owns the
readouts. If something is going to need splitting, it is that.

## Deploying

Vercel, pointed at this repo. `vercel.json` sets the build command, the
output directory and the cache headers — the hashed bundle is immutable, the
HTML never cached.

Only `dist/` is served. The sources are not uploaded to the CDN.

One manual step: `og:image` and `twitter:image` in `index.html` are relative
paths. Most link-preview scrapers will not fetch a relative image, so once
the domain is settled make them absolute — `https://your-domain/og.png`.
Until then a shared link renders without its picture.

`static/` holds the favicon and that preview image; the release build copies
it into `dist/`. The preview is a deliberate still of the beam at its second
mode rather than an automatic screenshot, because the room is almost black
and an automatic one is a dark rectangle.

## The failure wall

A board on the back wall tallies every part ever broken here and shows the
last thirty, with the settings that did it. It is optional: without Firebase
keys it quietly runs on `localStorage` and shows only what this browser has
destroyed. The room never waits on the network.

To connect it:

1. In the Firebase console, register a web app (an existing project is fine
   — the wall lives under its own `second-order/` path and cannot reach
   anything else).
2. Put the API key and project ID in `firebase.config.js`. These are not
   secrets; they ship in every Firebase web app and are visible in the
   bundle. What protects the data is the rules, not hiding them.
3. Publish `firestore.rules`. Read it first if the project already serves
   another site — rules are per-database, so this file governs everything in
   the project, and each app needs its own `match` block.
4. Add the deployed domain under Authentication → Settings → Authorized
   domains, or anonymous sign-in will fail silently on the live site.

Writes use Firestore's `increment` transform for the tallies, so two people
breaking the same part at the same moment both count. The tag list is read,
appended and written whole, so simultaneous visitors can cost one tag — a
fair trade for not running a transaction per breakage.

## Notes

The room is lit only where you are standing, by a pool of three spotlights
that follow you. Nothing simulates while you are not at a station: step away
and the machine stops, so a beam cannot crack while nobody is operating it.
