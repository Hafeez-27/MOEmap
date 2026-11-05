// Google Maps basemap tiles (Map Tiles API, 2D roadmap) served through our own server, so the API key never reaches the
// browser. Used by server.js (local) and, copied by tools/build-deploy.mjs, by the Vercel function.
//   /tiles/ok                          -> {ok:true} when Google tiles are available
//   /tiles/{z}/{x}/{y}                 -> one 256px tile (2x resolution)
//   /tiles/attr/{z}/{n}/{s}/{e}/{w}    -> {copyright} for the visible area (Google requires it on the map)
// region AE: borders and place names as shown in the UAE (e.g. "Arabian Gulf").
const STYLE = [   // Google's map, a little quieter so the engineer colours stand out
  { featureType: 'all', elementType: 'all', stylers: [{ saturation: -55 }] },
  { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];
const API = 'https://tile.googleapis.com';

export function googleTiles(key) {
  let gs = null, pending = null;
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  function session(force = false) {
    if (!force && gs && Date.now() < gs.exp - 3600e3) return Promise.resolve(gs.s);
    if (!pending) pending = (async () => {
      let r;
      for (let i = 0; i < 4; i++) {           // a few retries: right after a Google Cloud change, some calls are still refused
        r = await fetch(`${API}/v1/createSession?key=${encodeURIComponent(key)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mapType: 'roadmap', language: 'en-US', region: 'AE', scale: 'scaleFactor2x', highDpi: true, styles: STYLE })
        });
        if (r.ok || r.status !== 403) break;
        await new Promise(res => setTimeout(res, 700));
      }
      if (!r.ok) throw new Error(`Google tiles ${r.status}`);
      const j = await r.json(); gs = { s: j.session, exp: Number(j.expiry) * 1000 }; return gs.s;
    })().finally(() => { pending = null; });
    return pending;
  }
  return async function handle(path) {
    if (!key) return json({ ok: false, error: 'No Google key.' }, 503);
    try {
      if (path === '/tiles/ok') { await session(); return json({ ok: true }); }
      let m = path.match(/^\/tiles\/attr\/(\d{1,2})\/(-?[\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)$/);
      if (m) {
        const s = await session();
        const r = await fetch(`${API}/tile/v1/viewport?session=${s}&key=${encodeURIComponent(key)}&zoom=${m[1]}&north=${m[2]}&south=${m[3]}&east=${m[4]}&west=${m[5]}`);
        const j = r.ok ? await r.json() : {};
        return json({ copyright: j.copyright || '' });
      }
      m = path.match(/^\/tiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/);
      if (!m) return json({ error: 'Not found.' }, 404);
      const [z, x, y] = m.slice(1).map(Number);
      if (z > 22 || x >= 2 ** z || y >= 2 ** z) return json({ error: 'Not found.' }, 404);
      for (let i = 0; i < 2; i++) {
        const s = await session(i > 0);          // a second try with a fresh session if Google says the session is stale
        const r = await fetch(`${API}/v1/2dtiles/${z}/${x}/${y}?session=${s}&key=${encodeURIComponent(key)}`);
        if (r.ok) {
          const age = (r.headers.get('cache-control') || '').match(/max-age=\d+/)?.[0] || 'max-age=3600';
          return new Response(await r.arrayBuffer(), { headers: { 'Content-Type': r.headers.get('content-type') || 'image/png', 'Cache-Control': `private, ${age}` } });
        }
        if (![400, 401, 403].includes(r.status)) return new Response(null, { status: r.status });
      }
      return new Response(null, { status: 502 });
    } catch (e) { return json({ ok: false, error: String(e.message).slice(0, 200) }, 502); }
  };
}
