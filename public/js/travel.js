// Door-to-door travel estimates: road distance, free-flow speed, time-of-day traffic by corridor, fixed overheads.
// Google Routes (via the server proxy) replaces the distance and free-flow time when the key allows it.
import { P, REGION, mod } from './model.js';

const key = (a, b) => `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
export function haversine(a, b) {
  const R = 6371, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const band = (tbl, km) => tbl.find(([lim]) => km <= lim)[1];
export function freeFlow(a, b) {
  const line = haversine(a, b), km = line * band(P.detour, line);
  // blended speed: first 10 km urban, next 25 suburban, rest highway
  let rest = km, min = 0, prev = 0, city = 0;
  for (const [lim, v] of P.speeds) { const seg = Math.max(0, Math.min(rest, lim - prev)), m = seg / v * 60; min += m; if (lim < 1e9) city += m; rest -= seg; prev = lim; if (rest <= 0) break; }
  return { km, min, city };
}
// traffic multiplier at absolute sim time t for a trip between two zones
export function trafficAt(t, zA, zB) {
  const m = mod(t), peak = (m >= P.peakAM[0] && m <= P.peakAM[1]) || (m >= P.peakPM[0] && m <= P.peakPM[1]);
  if (!peak) return { mult: P.offPeak, label: 'off-peak' };
  const cross = (zA === 'Z01' && (zB === 'Z02' || zB === 'Z03')) || (zB === 'Z01' && (zA === 'Z02' || zA === 'Z03'));
  if (cross) return { mult: P.crossDxbShj, label: 'Dubai–Sharjah peak' };
  const r = REGION[zA] === 'heavy' || REGION[zB] === 'heavy' ? 'heavy' : REGION[zA] === 'mid' || REGION[zB] === 'mid' ? 'mid' : 'light';
  return { mult: P.regionPeak[r], label: `${r === 'heavy' ? 'heavy' : r === 'mid' ? 'moderate' : 'light'} school-run peak` };
}

export class Travel {
  constructor() { this.cache = new Map(); this.google = { ok: null, error: '', cached: 0 }; this.listeners = []; this.queue = []; this.inflight = false; this.pending = new Set(); this.incidents = []; }
  // full estimate: { km, drive, traffic, overhead, min, src, label }
  get(a, b, t = 450, zA, zB, opts = {}) {
    const g = this.cache.get(key(a, b)), m0 = freeFlow(a, b), ff = g ? { km: g.km, min: g.min / 1.1, city: Math.min(m0.city, g.min / 1.1) } : m0; // Google figures are traffic-aware at query time; normalise to free-flow
    const tr = trafficAt(t, zA, zB); let mult = tr.mult, label = tr.label;
    for (const inc of this.incidents) if (t < inc.until && (inc.zones.includes(zA) || inc.zones.includes(zB))) { mult *= inc.mult; label = inc.label; }
    const rural = opts.rural ? P.ruralFactor : 1;
    // peak congestion hits the city stretches fully and open highway only lightly
    const hwy = ff.min - ff.city, drive = (ff.city * mult + hwy * (1 + (mult - 1) * 0.3)) * rural, total = Math.max(P.minTrip, drive + P.overhead);
    return { km: Math.round(ff.km * 10) / 10, drive: Math.round(drive), traffic: mult, overhead: P.overhead, min: Math.round(total), src: g ? 'google' : 'model', label };
  }
  min(a, b, t, zA, zB) { return this.get(a, b, t, zA, zB).min; }
  onUpdate(fn) { this.listeners.push(fn); }
  refine(pairs) {
    if (this.google.ok === false) return;
    for (const p of pairs) { const k = key(p.a, p.b); if (!this.cache.has(k) && !this.pending.has(k)) { this.pending.add(k); this.queue.push(p); } }
    this._pump();
  }
  async _pump() {
    if (this.inflight || !this.queue.length) return;
    this.inflight = true;
    while (this.queue.length) {
      const batch = this.queue.splice(0, 100);
      try {
        const r = await (await fetch('/api/matrix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairs: batch }) })).json();
        this.google = r.google;
        r.results.forEach((x, i) => { this.pending.delete(key(batch[i].a, batch[i].b)); if (x) this.cache.set(key(batch[i].a, batch[i].b), x); });
        this.listeners.forEach(f => f());
        if (this.google.ok === false) { this.queue.length = 0; this.pending.clear(); break; }
      } catch { this.google = { ...this.google, ok: false, error: 'routing proxy unreachable' }; this.queue.length = 0; this.pending.clear(); break; }
    }
    this.inflight = false;
  }
  get live() { return this.google.ok === true; }
}
