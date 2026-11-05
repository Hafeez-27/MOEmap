// Builds the end-to-end demo and the guided presentation as self-contained HTML pages (no server, no map tiles,
// AI text replaced by marked samples).
//   node tools/build-standalone.mjs
// Writes dist/*.html (page bodies, for publishing) and public/standalone*.html (full documents, for local testing).
import fs from 'node:fs';
const root = new URL('../', import.meta.url), rd = p => fs.readFileSync(new URL(p, root), 'utf8');

// demo modules in dependency order; imports dropped and exports unwrapped so they share one module scope
const mods = ['public/js/model.js', 'public/js/travel.js', 'public/js/engine.js', 'public/js/ui/util.js', 'public/js/demo/story.js', 'public/js/demo/demo.js'];
const js = mods.map(p => `// ---- ${p.replace('public/', '')}\n` + rd(p).split('\n').filter(l => !/^import\s/.test(l) && !/^export function download\(/.test(l)).join('\n').replace(/^export (const|function|class|async function) /gm, '$1 ')).join('\n');
if (/^\s*export\s/m.test(js)) throw new Error('an export survived bundling');
fs.mkdirSync(new URL('dist/', root), { recursive: true });
fs.writeFileSync(new URL('dist/bundle-check.mjs', root), js); // syntax check only: node --check dist/bundle-check.mjs
const net = JSON.stringify(JSON.parse(rd('public/data/network.json'))), base = rd('public/data/basemap.json');
const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">`;

function build({ src, body, css = [], flags = '', extra = '', out, local, title = 'One School Day' }) {
  let page = `<title>${title}</title>
${fonts}
<style>
${rd('tools/vendor/leaflet-1.9.4.min.css')}
${rd('public/css/demo.css')}
${css.map(rd).join('\n')}
:root{color-scheme:light}
</style>
${body(rd(src)).trim()}
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>window.DEMO_NET = ${net};window.DEMO_BASE = ${base};${flags}</script>
<script type="module">
${js}
</script>
${extra}`;
  // inline the brand logos (a published page cannot load files beside it)
  page = page.replace(/src="brand\/([\w-]+)\.png"/g, (_, n) => `src="data:image/png;base64,${fs.readFileSync(new URL(`public/brand/${n}.png`, root)).toString('base64')}"`);
  fs.writeFileSync(new URL(out, root), page);
  fs.writeFileSync(new URL(local, root), `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n${page}</html>\n`);
  console.log(`${out} ${(page.length / 1024).toFixed(0)} KB`);
}

build({ src: 'public/demo.html', body: h => h.slice(h.indexOf('<body>') + 6, h.indexOf('<script src=')), out: 'dist/one-school-day.html', local: 'public/standalone.html' });
build({ src: 'public/present.html', body: h => h.slice(h.indexOf('<!-- BODY:START -->') + 19, h.indexOf('<!-- BODY:END -->')), css: ['public/css/present.css'],
  flags: 'window.DEMO_PRESENT = true;', extra: `<script type="module">\n${rd('public/js/demo/present.js')}\n</script>\n`,
  title: 'One School Day Walkthrough', out: 'dist/one-school-day-presentation.html', local: 'public/standalone-present.html' });
