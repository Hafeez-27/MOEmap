// Builds the Option Remote map as ONE standalone HTML file (map library, styles, plan and basemap inlined; works offline).
//   python3 tools/build_remote_plan.py && node tools/build-remote-map.mjs
import fs from 'node:fs';
const root = new URL('../', import.meta.url), rd = p => fs.readFileSync(new URL(p, root), 'utf8');
const uri = p => 'data:image/png;base64,' + fs.readFileSync(new URL(p, root)).toString('base64');
const plan = JSON.stringify(JSON.parse(rd('public/data/remote-plan.json'))), base = JSON.stringify(JSON.parse(rd('public/data/basemap.json')));
const body = rd('public/remote-map.src.html')
  .replace('/*__MAPLIBRE_CSS__*/', () => rd('tools/vendor/maplibre-gl-4.7.1.min.css'))
  .replace('/*__MAPLIBRE_JS__*/', () => rd('tools/vendor/maplibre-gl-4.7.1.min.js'))
  .replace('/*__PLAN__*/null', () => plan).replace('/*__BASE__*/null', () => base)
  .replace('/*__ENGINE__*/', () => `window.PlanEngine = (() => {\n${rd('tools/plan-engine.mjs').replace(/^export /gm, '')}\nreturn { simulate, impact, impactLines, impactGroups, checks, index, est, recompute, resolveSite, KNAME, KCODE };\n})();`)
  .replace('__LOGO_AD__', () => uri('public/brand/alpha-data-h80.png')).replace('__LOGO_MOE__', () => uri('public/brand/moe-h80.png'))
  .replace('__LOGO_GOOGLE__', () => uri('public/brand/google-maps-logo-2x.png'));
const doc = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${body}\n</body></html>\n`;
fs.mkdirSync(new URL('dist/', root), { recursive: true });
fs.writeFileSync(new URL('dist/MOE-Option-Remote-Coverage-Map.html', root), doc);
console.log(`dist/MOE-Option-Remote-Coverage-Map.html ${(doc.length / 1024).toFixed(0)} KB`);
