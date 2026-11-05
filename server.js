// Static server + secure proxies for Google Routes (drive times) and Ollama (AI). Keys never reach the browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApi } from './tools/app-api.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const PORT = process.env.PORT || 5173;
const CACHE_FILE = path.join(ROOT, 'route-cache.json');
let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
let dirty = false; setInterval(() => { if (dirty) { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); dirty = false; } }, 5000);
// the Option Remote map's routes (assistant, proposals, approvals, tiles, drive times): same code as the Vercel site.
// Locally they use a separate "dev/" area of the Blob store, and every email goes to Resend's test inbox.
const readEnv = f => { try { return Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })); } catch { return {}; } };
const appEnv = { STORE_PREFIX: 'dev/', MAIL_TEST_TO: 'delivered@resend.dev', ...readEnv(path.join(ROOT, 'deploy/moe-option-remote-map/.env.local')), ...env, SITE_URL: `http://localhost:${PORT}` };
const appApi = makeApi({ env: appEnv, basePlan: JSON.parse(fs.readFileSync(path.join(PUB, 'data/remote-plan.json'), 'utf8')), decisions: fs.readFileSync(path.join(ROOT, 'tools/kb/decisions.md'), 'utf8'), driveSeed: JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/google-cache.json'), 'utf8')), logos: { ad: 'data:image/png;base64,' + fs.readFileSync(path.join(PUB, 'brand/alpha-data-h80.png')).toString('base64'), moe: 'data:image/png;base64,' + fs.readFileSync(path.join(PUB, 'brand/moe-h80.png')).toString('base64') } });
async function toWeb(req, res) {
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const r = await appApi(new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers, body }), { signedIn: true, origin: `http://localhost:${PORT}` });
  if (!r) return false;
  res.writeHead(r.status, Object.fromEntries(r.headers));
  if (r.body) { const rd = r.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; res.write(value); } }
  res.end(); return true;
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const g = { ok: null, error: '', retryAt: 0, calls: 0 };
const k = (a, b) => `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;

async function googleMatrix(origins, dests, departureTime) {
  const body = {
    origins: origins.map(o => ({ waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } } })),
    destinations: dests.map(o => ({ waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } } })),
    travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', ...(departureTime ? { departureTime } : {})
  };
  const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition' },
    body: JSON.stringify(body)
  });
  const txt = await r.text();
  if (!r.ok) { let m = txt; try { m = JSON.parse(txt).error.message; } catch {} throw new Error(`${r.status} ${m}`); }
  return txt.trim().startsWith('[') ? JSON.parse(txt) : txt.trim().split('\n').map(l => JSON.parse(l.replace(/^,/, '')));
}

async function handleMatrix(reqBody) {
  const { pairs } = reqBody; // [{a:{lat,lng}, b:{lat,lng}}]
  const out = new Array(pairs.length).fill(null), need = [];
  pairs.forEach((p, i) => { const c = cache[k(p.a, p.b)]; if (c) out[i] = { min: c[0], km: c[1], src: 'google' }; else need.push(i); });
  if (need.length && (g.ok !== false || Date.now() > g.retryAt)) {
    // group by origin so each request is origin x its destinations (<=25)
    const byO = new Map();
    need.forEach(i => { const key = `${pairs[i].a.lat.toFixed(4)},${pairs[i].a.lng.toFixed(4)}`; (byO.get(key) || byO.set(key, []).get(key)).push(i); });
    for (const idxs of byO.values()) {
      for (let s = 0; s < idxs.length; s += 25) {
        const chunk = idxs.slice(s, s + 25);
        try {
          g.calls++;
          const res = await googleMatrix([pairs[chunk[0]].a], chunk.map(i => pairs[i].b));
          g.ok = true; g.error = '';
          for (const e of res) {
            const i = chunk[e.destinationIndex];
            if (e.duration && e.distanceMeters != null) {
              const min = Math.round(parseInt(e.duration) / 6) / 10, km = Math.round(e.distanceMeters / 100) / 10;
              cache[k(pairs[i].a, pairs[i].b)] = [min, km]; dirty = true; out[i] = { min, km, src: 'google' };
            }
          }
        } catch (err) { g.ok = false; g.error = String(err.message).slice(0, 240); g.retryAt = Date.now() + 120000; break; }
      }
      if (g.ok === false) break;
    }
  }
  return { results: out.map(x => x || null), google: { ok: g.ok, error: g.error, cached: Object.keys(cache).length } };
}

async function handleAI(req, res, body) {
  const { messages, json } = JSON.parse(body);
  const r = await fetch(`${env.OLLAMA_HOST}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OLLAMA_KEY}` },
    body: JSON.stringify({ model: env.OLLAMA_MODEL, messages, stream: true, ...(json ? { format: 'json' } : {}) })
  });
  if (!r.ok) { res.writeHead(502); return res.end(JSON.stringify({ error: `ollama ${r.status}` })); }
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) { if (!l.trim()) continue; try { const j = JSON.parse(l); const t = j.message?.content || ''; if (t) res.write(JSON.stringify({ t }) + '\n'); } catch {} }
  }
  res.end();
}

const readBody = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/status') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ google: { ok: g.ok, error: g.error, cached: Object.keys(cache).length }, ollama: { host: env.OLLAMA_HOST, model: env.OLLAMA_MODEL } })); }
    if (req.url === '/api/matrix' && req.method === 'POST') { const o = await handleMatrix(JSON.parse(await readBody(req))); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(o)); }
    if (req.url === '/api/ai' && req.method === 'POST') return await handleAI(req, res, await readBody(req));
    if ((req.url.startsWith('/api/') && !['/api/status', '/api/matrix', '/api/ai'].includes(req.url.split('?')[0])) || req.url.startsWith('/tiles/') || req.url.startsWith('/approve')) { if (await toWeb(req, res)) return; }
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    if (p === '/remote') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' }); return fs.createReadStream(path.join(ROOT, 'dist/MOE-Option-Remote-Coverage-Map.html')).pipe(res); }
    const f = path.join(PUB, path.normalize(p));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}).listen(PORT, () => console.log(`MOE EUC dashboard on http://localhost:${PORT}`));
