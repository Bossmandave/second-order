/* Bundle the world into one minified file.
 *
 * Shipping the raw modules meant shipping three.js unminified AND whole:
 * 2.36 MB, of which 2.13 MB was three.js and most of that was code this
 * project never calls. Bundling tree-shakes it to what is actually reached
 * and minifies the rest - 643 KB, 169 KB over the wire.
 *
 * The source stays as plain ES modules, so the dev server still serves them
 * directly with no build step; this runs only before publishing.
 */
import { build, context } from 'esbuild';
import { statSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');

/* --release additionally writes dist/ as a self-contained deployable: the
 * bundle under a content-hashed name, and an index.html pointing at it. The
 * hash is what lets the host cache the bundle forever and still never serve
 * a stale one - the filename changes whenever the bytes do. */
const release = process.argv.includes('--release');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [`${root}/world/main.js`],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  outfile: `${root}/dist/app.js`,
  legalComments: 'none',
  plugins: [{
    name: 'three',
    setup(b) {
      // bare "three" resolves to the local build, as the old import map did
      b.onResolve({ filter: /^three$/ }, () => ({ path: `${root}/libs/three.module.js` }));
    },
  }],
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching - ctrl-c to stop');
  console.log('serve alongside with:  python3 -m http.server 8099 --bind 127.0.0.1');
} else {
  await build(options);
  report();
}

function report() {


const code = readFileSync(`${root}/dist/app.js`);
const bytes = statSync(`${root}/dist/app.js`).size;
const gz = gzipSync(code, { level: 9 }).length;
console.log(`dist/app.js  ${(bytes / 1024).toFixed(0)} KB raw  ${(gz / 1024).toFixed(0)} KB gzipped`);

if (release) {
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 10);
  const name = `app-${hash}.js`;
  mkdirSync(`${root}/dist`, { recursive: true });
  writeFileSync(`${root}/dist/${name}`, code);
  const html = readFileSync(`${root}/index.html`, 'utf8')
    .replace('./dist/app.js', `./${name}`);
  if (!html.includes(name)) throw new Error('index.html did not reference ./dist/app.js');
  writeFileSync(`${root}/dist/index.html`, html);
  // the favicon and the social preview, which the page refers to by name
  for (const f of readdirSync(`${root}/static`)) {
    copyFileSync(`${root}/static/${f}`, `${root}/dist/${f}`);
  }
  console.log(`release      dist/index.html -> ${name}  (+${readdirSync(`${root}/static`).length} static)`);
}
}
