// Builds the school coverage-cluster map as ONE standalone HTML file (map library, styles and data all inlined;
// works offline by double-click; Google Fonts load when online, system fonts otherwise).
//   python3 tools/build_coverage_plan.py && node tools/build-coverage-map.mjs
import fs from 'node:fs';
const root = new URL('../', import.meta.url), rd = p => fs.readFileSync(new URL(p, root), 'utf8');
const plan = JSON.stringify(JSON.parse(rd('public/data/coverage-plan.json'))), base = JSON.stringify(JSON.parse(rd('public/data/basemap.json')));
const body = rd('public/coverage-map.src.html')
  .replace('/*__MAPLIBRE_CSS__*/', () => rd('tools/vendor/maplibre-gl-4.7.1.min.css'))
  .replace('/*__MAPLIBRE_JS__*/', () => rd('tools/vendor/maplibre-gl-4.7.1.min.js'))
  .replace('/*__PLAN__*/null', () => plan).replace('/*__BASE__*/null', () => base);
const doc = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${body}</html>\n`;
fs.mkdirSync(new URL('dist/', root), { recursive: true });
for (const out of ['dist/MOE-School-Coverage-Clusters.html', 'public/coverage-map.html']) fs.writeFileSync(new URL(out, root), doc);
fs.rmSync(new URL('dist/coverage-map.html', root), { force: true });
console.log(`dist/MOE-School-Coverage-Clusters.html ${(doc.length / 1024).toFixed(0)} KB`);
