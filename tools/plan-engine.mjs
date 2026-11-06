// Plan engine for the Option Remote map: apply proposed changes to a plan (simulation), recompute every figure, check the
// rules, describe the impact, and build the assistant's data tables. Plain ES module with no imports: the map inlines it
// (tools/build-remote-map.mjs) and the server imports it (copied into the Vercel project by tools/build-deploy.mjs).

export const SLA = 30, BUDGET = 322;
// the engineer budget in the zones comes from the plan itself (331 model: 331 - 9 HQ = 322); older plans fall back to total - HQ
export const budgetOf = plan => plan.budget ?? (plan.total != null && plan.hq != null ? plan.total - plan.hq : BUDGET);
// the 331 model classes city schools by their *qualified* size; older plans used the size category
export const sizeOf = (plan, s) => (plan?.model ? s.qsize : s.size) || s.size;
export const KCODE = { national: 'N', remote_shared: 'R', city_shared: 'C', pool: 'P' };
export const KNAME = { national: 'Emirati national', remote_shared: 'Remote shared engineer', city_shared: 'City shared engineer', pool: 'City pool engineer' };
const BIG = ['Medium', 'Large', 'X-Large'], SMALL = ['Small', 'X-Small'];

export function hav(a, b) {
  const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dg = (b.lng - a.lng) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// estimate calibrated on the plan's 246 Google trips (7:30: 5.6 min + 0.93 min per straight-line km; road km 1.0 + 1.28x)
export function est(a, b) {
  const d = hav(a, b);
  if (d < 0.05) return { peak: 0, off: 0, km: 0, src: 'same' };
  return { peak: Math.max(1, Math.round(5.6 + 0.93 * d)), off: Math.max(1, Math.round(5.4 + 0.94 * d)), km: Math.round((1.0 + 1.28 * d) * 10) / 10, src: 'estimate' };
}
export const index = plan => ({ S: new Map(plan.sites.map(s => [s.id, s])), E: new Map(plan.engineers.map(e => [e.id, e])), Z: new Map(plan.zones.map(z => [z.id, z])) });
const clone = o => JSON.parse(JSON.stringify(o));
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const girlsOk = (s, e) => s.g !== 'G' || e.gender === 'Female';
export const siteLabel = s => `${s.name} (${s.type === 'office' ? 'site code' : 'no.'} ${s.no})`;
export const norm = v => String(v ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const GENERIC = new Set(['school', 'schools', 'cycle', 'kindergarten', 'kg', 'boys', 'girls', 'model', 'and', 'for', 'the', 'of', 'basic', 'education', '1', '2', '3']);
const core = n => norm(n).split(' ').filter(w => !GENERIC.has(w)).join(' ');
// a site from an id, a school number or a name; when both an id and a name are given they must agree
export function resolveSite(plan, ref, name) {
  const byName = n => {
    const q = norm(n); if (!q) return null;
    for (const f of [s => norm(s.name) === q || norm(s.nameAr) === q, s => core(s.name) === core(n) && core(n), s => norm(s.name).startsWith(q), s => norm(s.name).includes(q)]) {
      const m = plan.sites.filter(f); if (m.length === 1) return m[0]; if (m.length > 1) return 'many';
    }
    return null;
  };
  const sameName = (s, n) => { const a = core(s.name), b = core(n); return !n || !b || a.includes(b) || b.includes(a) || norm(s.nameAr) === norm(n); };
  const byId = plan.sites.find(s => s.id === ref) || plan.sites.find(s => String(s.no) === String(ref ?? '').trim());
  if (byId && sameName(byId, name)) return byId;
  const b = byName(name || (byId ? '' : ref));
  if (b && b !== 'many') return b;
  throw new Error(b === 'many' ? `"${name || ref}" matches more than one site; give the school number` : byId ? `site ${ref} is ${byId.name}, not "${name}"` : `there is no site "${name || ref}"`);
}
// sites, engineers and zones named in a question, so their full details can be put next to it
export function mentions(plan, text) {
  const t = ' ' + norm(text) + ' ', up = String(text).toUpperCase(), out = new Map();
  for (const s of plan.sites) {
    const c = core(s.name);
    if (((c.includes(' ') || c.length >= 8) && t.includes(' ' + c + ' ')) || (s.nameAr && norm(s.nameAr).length > 5 && t.includes(norm(s.nameAr)))) out.set('site:' + s.id, { type: 'site', id: s.id });
    else if (s.no && new RegExp(`(^|[^\\w-])${String(s.no).replace(/[^\w-]/g, '')}([^\\w-]|$)`, 'i').test(text)) out.set('site:' + s.id, { type: 'site', id: s.id });
  }
  for (const e of plan.engineers) if (up.includes(e.id)) out.set('eng:' + e.id, { type: 'eng', id: e.id });
  for (const z of plan.zones) if (t.includes(' ' + norm(z.label) + ' ') || new RegExp(`(^|[^\\w-])${z.id}([^\\w]|$)`).test(up) || (z.lead && !/tbd/i.test(z.lead) && t.includes(' ' + norm(z.lead) + ' '))) out.set('zone:' + z.id, { type: 'zone', id: z.id });
  return [...out.values()].slice(0, 25);
}
// full, plain-language details for selected or mentioned items
export function details(plan, refs) {
  const { S, E, Z } = index(plan), bk = backups(plan), L = [], seen = new Set();
  const legTxt = (e, id) => { if (e.base === id) return e.sites.length > 1 ? 'the base' : 'on site'; const l = e.legs.find(l => l.to === id); return l && l.peak != null ? `${l.peak} min from base at 7:30 am (${l.off} at 10:30, ${l.km} km)` : 'boat'; };
  const engLine = e => `ENGINEER ${e.id}: ${KNAME[e.kind]}, ${e.gender}, ${e.nat}, zone ${e.zone}; base ${e.base} ${S.get(e.base)?.name}; ${e.sites.length} site(s), ${e.users} users; longest drive ${e.maxPeak || 0} min. Sites: ${e.sites.map(id => `${id} ${S.get(id).name} (${S.get(id).g === 'G' ? 'girls' : S.get(id).g === 'B' ? 'boys' : S.get(id).g === 'M' ? 'mixed' : 'office'}, ${legTxt(e, id)})`).join('; ')}.${e.flags?.length ? ' Flags: ' + e.flags.join(', ') + '.' : ''}`;
  for (const r of refs) {
    if (seen.has(r.type + r.id)) continue; seen.add(r.type + r.id);
    if (r.type === 'site' && S.has(r.id)) {
      const s = S.get(r.id), e = E.get(s.eng), b = bk.get(s.id), be = b && E.get(b.eng);
      L.push(`SITE ${s.id}: ${s.name}${s.nameAr ? ` / ${s.nameAr}` : ''}; ${s.type === 'office' ? `office (${s.stype || ''}), site code` : `${s.cr} school, ${s.size}${s.qsize && s.qsize !== s.size ? ` (qualified ${s.qsize})` : ''}, ${s.g === 'G' ? 'girls' : s.g === 'B' ? 'boys' : 'mixed'}, school no.`} ${s.no}; ${s.users} users; zone ${s.zone} (${Z.get(s.zone)?.label}), Team Lead ${Z.get(s.zone)?.lead}; engineer ${e?.id} (${KNAME[e?.kind]}, ${e?.gender}), ${e ? legTxt(e, s.id) : ''}; backup ${be ? `${be.id} (${KNAME[be.kind]}, ${be.gender}), about ${b.min} min` : 'none'}.${s.note ? ' Note: ' + s.note : ''}`);
      if (e && !seen.has('eng' + e.id)) { seen.add('eng' + e.id); L.push('  ' + engLine(e)); }
    } else if (r.type === 'eng' && E.has(r.id)) L.push(engLine(E.get(r.id)));
    else if (r.type === 'zone' && Z.has(r.id)) {
      const z = Z.get(r.id), es = plan.engineers.filter(e => e.zone === z.id);
      L.push(`ZONE ${z.id}: ${z.label}, Team Lead ${z.lead}; ${z.schools} schools (${z.remote} remote, ${z.cityBig} city M/L/XL, ${z.citySmall} city S/XS), ${z.offices} offices; ${es.length} engineers: ${Object.entries(z.byKind).map(([k, n]) => `${n} ${KNAME[k]}`).join(', ')}; ${z.female} female. Pool engineers: ${es.filter(e => e.kind === 'pool').map(e => `${e.id} (${e.gender}, ${e.sites.length} sites, longest ${e.maxPeak} min)`).join('; ')}. City shared: ${es.filter(e => e.kind === 'city_shared').map(e => `${e.id} (${e.gender}, ${e.sites.length} schools, ${e.maxPeak} min)`).join('; ')}.`);
    }
  }
  return L.join('\n');
}

function baseFor(e, S) {
  const ss = e.sites.map(id => S.get(id));
  if (!ss.length) return null;
  if (e.kind === 'remote_shared') return (ss.find(s => !s.boat) || ss[0]).id;
  if (e.kind === 'pool') {
    const pts = ss.filter(s => s.type === 'school' && !s.boat).length ? ss.filter(s => s.type === 'school' && !s.boat) : ss;
    return pts.reduce((b, c) => { const t = pts.reduce((a, o) => a + est(c, o).peak, 0); return !b || t < b[0] || (t === b[0] && c.users > b[1].users) ? [t, c] : b; }, null)[1].id;
  }
  return ss.reduce((b, s) => (!b || s.users > b.users ? s : b), null).id;
}

// balanced, compact patches (an approximation of the build's min-cost-flow split): each patch gets between n/k-1 and n/k+1
function partition(ids, k, T) {
  ids = [...ids]; const n = ids.length;
  if (k <= 1 || n <= 1) return [ids];
  k = Math.min(k, n);
  const lo = Math.max(1, Math.floor(n / k) - 1), hi = Math.ceil(n / k) + 1;
  const medoid = p => p.reduce((b, c) => { const t = p.reduce((a, i) => a + T(c, i), 0); return !b || t < b[0] ? [t, c] : b; }, null)[1];
  let med = [medoid(ids)];
  while (med.length < k) med.push(ids.filter(i => !med.includes(i)).reduce((b, i) => { const d = Math.min(...med.map(m => T(i, m))); return !b || d > b[0] ? [d, i] : b; }, null)[1]);
  let parts = [];
  for (let it = 0; it < 15; it++) {
    const asg = new Map(), cnt = new Map(med.map(m => [m, 0]));
    for (const m of med) { asg.set(m, m); cnt.set(m, 1); }
    const rest = ids.filter(i => !med.includes(i)).map(i => { const c = med.map(m => T(m, i)).sort((a, b) => a - b); return [(c[1] ?? c[0]) - c[0], i]; }).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    for (const i of rest) { const m = med.filter(m => cnt.get(m) < hi).sort((a, b) => T(a, i) - T(b, i))[0] ?? med[0]; asg.set(i, m); cnt.set(m, cnt.get(m) + 1); }
    for (const m of med) while (cnt.get(m) < lo) {
      const c = ids.filter(i => asg.get(i) !== m && !med.includes(i) && cnt.get(asg.get(i)) > lo).sort((a, b) => T(m, a) - T(m, b))[0];
      if (!c) break; cnt.set(asg.get(c), cnt.get(asg.get(c)) - 1); asg.set(c, m); cnt.set(m, cnt.get(m) + 1);
    }
    parts = med.map(m => ids.filter(i => asg.get(i) === m));
    const nm = parts.filter(p => p.length).map(medoid);
    if ([...nm].sort().join() === [...med].sort().join()) break;
    med = nm;
  }
  return parts.filter(p => p.length);
}

// ---------------------------------------------------------------- figures
export function recompute(plan) {
  const { S } = index(plan);
  for (const e of plan.engineers) { e.users = e.sites.reduce((a, id) => a + (S.get(id)?.users || 0), 0); e.maxPeak = Math.max(0, ...e.legs.map(l => l.peak || 0)); }
  for (const s of plan.sites) s.eng = null;
  for (const e of plan.engineers) for (const id of e.sites) S.get(id).eng = e.id;
  for (const z of plan.zones) {
    const es = plan.engineers.filter(e => e.zone === z.id), byKind = {};
    for (const e of es) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    Object.assign(z, { eng: es.length, byKind, female: es.filter(e => e.gender === 'Female').length });
  }
  const pairs = plan.engineers.filter(e => e.kind === 'city_shared' && e.sites.length > 1), pools = plan.engineers.filter(e => e.kind === 'pool');
  const pm = pairs.map(e => e.maxPeak), legs = plan.engineers.flatMap(e => e.legs).filter(l => l.peak != null);
  const poolLegs = pools.flatMap(e => e.legs).filter(l => l.peak != null), fem = {};
  for (const e of plan.engineers) fem[e.gender] = (fem[e.gender] || 0) + 1;
  const alloc = {}; for (const e of pools) alloc[e.zone] = (alloc[e.zone] || 0) + 1;
  const ng = legs.filter(l => l.src === 'google' || l.src === 'same').length;
  Object.assign(plan.stats, {
    pairs: pairs.length, pair_median: median(pm), pair_le15: pm.filter(m => m <= 15).length, pair_le30: pm.filter(m => m <= SLA).length, pair_gt30: pm.filter(m => m > SLA).length,
    pair_km_median: median(pairs.map(e => Math.max(0, ...e.legs.map(l => l.km || 0)))), pair_users_avg: Math.round(mean(plan.engineers.filter(e => e.kind === 'city_shared').map(e => e.users))),
    mixed_pairs: plan.engineers.filter(e => e.kind === 'city_shared' && new Set(e.sites.map(id => S.get(id).g).filter(g => g === 'B' || g === 'G')).size > 1).map(e => e.id),
    pool_sites_avg: Math.round(mean(pools.map(e => e.sites.length)) * 100) / 100, pool_sites_max: Math.max(0, ...pools.map(e => e.sites.length)),
    pool_users_avg: Math.round(mean(pools.map(e => e.users))), pool_median_reach: median(poolLegs.map(l => l.peak)),
    pool_le30_sites: poolLegs.filter(l => l.peak <= SLA).length + pools.length, pool_alloc: alloc, female: fem,
    girls_small_with_city_engineer: plan.sites.filter(s => s.type === 'school' && s.cr === 'City' && SMALL.includes(sizeOf(plan, s)) && s.g === 'G' && plan.engineers.find(e => e.id === s.eng)?.kind === 'city_shared').length,
  });
  plan.stats.times = { ...(plan.stats.times || {}), legs: legs.length, google: ng, source: ng === legs.length ? 'google' : ng ? 'mixed' : 'model' };
  plan.total = plan.engineers.length + (plan.hq || 0);   // headcount follows the plan after any change
  return plan;
}

// ---------------------------------------------------------------- rule checks
export function checks(plan) {
  const { S, E } = index(plan), out = [];
  const add = (key, level, text, ids) => out.push({ key, level, text, ids });
  const n = plan.engineers.length;
  const B = budgetOf(plan);
  if (n !== B) add('headcount', 'rule', `${n} engineers in the zones, against the budget of ${B} (${n > B ? '+' : ''}${n - B}).`, []);
  for (const e of plan.engineers) {
    if (e.kind === 'national' && e.sites.length > 1) add('nat-shared:' + e.id, 'rule', `${e.id} is an Emirati national covering ${e.sites.length} schools; nationals are never shared (MOE rule).`, [e.id]);
    if (['city_shared', 'pool'].includes(e.kind) && e.sites.some(id => S.get(id).zone !== e.zone)) add('zone:' + e.id, 'rule', `${e.id} covers a site outside its zone (${e.zone}).`, [e.id]);
    if (e.kind === 'city_shared' && e.sites.length > 3) add('big:' + e.id, 'watch', `${e.id} covers ${e.sites.length} city schools.`, [e.id]);
    if (e.kind === 'pool' && e.sites.length > 8) add('pool:' + e.id, 'watch', `${e.id}'s patch has ${e.sites.length} sites (the average is about ${Math.round(plan.stats?.pool_sites_avg || 5)}).`, [e.id]);
    for (const l of e.legs) if (l.peak != null && l.peak > SLA) add(`far:${e.id}:${l.to}`, 'watch', `${S.get(l.to).name} is ${l.peak} min from ${e.id}'s base at 7:30 am.`, [l.to, e.id]);
  }
  for (const s of plan.sites) {
    const e = E.get(s.eng);
    if (!e) { add('orphan:' + s.id, 'rule', `${siteLabel(s)} has no engineer.`, [s.id]); continue; }
    if (!girlsOk(s, e)) add('girls:' + s.id, 'rule', `Girls' school ${siteLabel(s)} is covered by a male engineer (${e.id}).`, [s.id, e.id]);
    if (s.cr === 'Remote' && e.kind !== 'national' && e.kind !== 'remote_shared') add('remote:' + s.id, 'rule', `Remote school ${siteLabel(s)} has no dedicated national (covered by ${e.id}).`, [s.id, e.id]);
  }
  return out;
}

// ---------------------------------------------------------------- simulation
// ops: {op:'move', site, to} | {op:'swap', a, b} | {op:'base', engineer, site} | {op:'add', kind, zone, gender, sites?}
//      {op:'remove', engineer} | {op:'gender', engineer, gender} | {op:'rebalance', zone}
// drive(pairs:[{a,b}]) -> Promise<[{peak, off, km, src}]> looks up real drive times (Google); estimates are used without it.
export async function simulate(base, ops, { drive } = {}) {
  const plan = clone(base); let { S, E } = index(plan);
  const known = new Map(); for (const e of base.engineers) for (const l of e.legs) known.set(`${e.base}>${l.to}`, l);
  const touched = new Set(), based = new Set(), added = [], removed = [], log = [], before = new Map(base.sites.map(s => [s.id, s.eng]));
  const T = (a, b) => est(S.get(a), S.get(b)).peak;
  const nextId = (zone, kind) => { let n = 0; const re = new RegExp(`^${zone}-${KCODE[kind]}(\\d+)$`); for (const e of plan.engineers) { const m = e.id.match(re); if (m) n = Math.max(n, +m[1]); } return `${zone}-${KCODE[kind]}${String(n + 1).padStart(2, '0')}`; };
  const site = (id, name) => resolveSite(plan, id, name);
  const eng = id => { const e = E.get(id); if (!e) throw new Error(`there is no engineer "${id}"`); return e; };
  const give = (sid, to) => { const s = S.get(sid), from = E.get(s.eng); if (from === to) return; if (from) { from.sites = from.sites.filter(x => x !== sid); touched.add(from.id); } to.sites.push(sid); s.eng = to.id; touched.add(to.id); };
  const pickNearest = (s, zone, prefer) => {
    const c = plan.engineers.filter(e => e.zone === zone && ['city_shared', 'pool'].includes(e.kind) && girlsOk(s, e) && !removed.includes(e.id) && e.sites.length);
    const rank = e => (e.kind === prefer ? 0 : 1) * 1000 + T(e.base, s.id);
    return c.sort((a, b) => rank(a) - rank(b))[0];
  };
  function rebalance(zone, gender) {
    const group = plan.engineers.filter(e => e.kind === 'pool' && e.zone === zone && e.gender === gender && !removed.includes(e.id));
    if (!group.length) return;
    const ids = [...new Set(group.flatMap(e => e.sites))];
    const parts = partition(ids, group.length, T), free = new Set(group), outp = new Map();
    const pairs = []; for (const [pi, p] of parts.entries()) for (const e of group) pairs.push([p.filter(id => e.sites.includes(id)).length, pi, e]);
    pairs.sort((a, b) => b[0] - a[0]);
    const usedP = new Set(); for (const [, pi, e] of pairs) if (!usedP.has(pi) && free.has(e)) { usedP.add(pi); free.delete(e); outp.set(e, parts[pi]); }
    for (const e of group) { e.sites = outp.get(e) || []; for (const id of e.sites) S.get(id).eng = e.id; e.base = null; touched.add(e.id); }
  }
  for (const [i, op] of (ops || []).entries()) {
    try {
      if (op.op === 'move') { const s = site(op.site, op.name), to = eng(op.to); if (to.id === s.eng) throw new Error(`${s.name} is already covered by ${to.id}`); const from = s.eng; give(s.id, to); log.push({ i, ok: true, text: `Move ${siteLabel(s)} from ${from} to ${to.id}` }); }
      else if (op.op === 'swap') { const a = site(op.a, op.aName), b = site(op.b, op.bName), ea = eng(a.eng), eb = eng(b.eng); if (ea === eb) throw new Error('both sites already have the same engineer'); give(a.id, eb); give(b.id, ea); log.push({ i, ok: true, text: `Swap ${siteLabel(a)} (to ${eb.id}) with ${siteLabel(b)} (to ${ea.id})` }); }
      else if (op.op === 'base') { const e = eng(op.engineer), s = site(op.site, op.name); if (!e.sites.includes(s.id)) throw new Error(`${s.name} is not one of ${e.id}'s sites`); e.base = s.id; touched.add(e.id); based.add(e.id); log.push({ i, ok: true, text: `Base ${e.id} at ${siteLabel(s)}` }); }
      else if (op.op === 'gender') { const e = eng(op.engineer); if (!['Male', 'Female'].includes(op.gender)) throw new Error('gender must be Male or Female'); e.gender = op.gender; touched.add(e.id); log.push({ i, ok: true, text: `Make ${e.id} a ${op.gender.toLowerCase()} engineer` }); }
      else if (op.op === 'add') {
        if (!KCODE[op.kind]) throw new Error(`unknown engineer type "${op.kind}"`);
        if (!plan.zones.some(z => z.id === op.zone)) throw new Error(`there is no zone "${op.zone}"`);
        const gender = op.gender === 'Female' ? 'Female' : 'Male', id = nextId(op.zone, op.kind);
        const e = { id, kind: op.kind, sites: [], base: null, zone: op.zone, gender, nat: op.kind === 'national' ? 'Emirati national' : 'Non-national', legs: [], maxPeak: 0, users: 0, note: 'Added in a proposed change.', flags: ['proposed'] };
        plan.engineers.push(e); E.set(id, e); added.push(id); touched.add(id);
        if (op.sites?.length) op.sites.forEach((sid, k) => give(site(sid, op.names?.[k]).id, e));
        else if (op.kind === 'pool') { rebalance(op.zone, gender); if (!e.sites.length) throw new Error(`${id} would get no sites: ${op.zone} has no ${gender.toLowerCase()} pool engineers whose patches it could share. Add it with a list of sites ("sites" and "names") instead`); }
        else throw new Error('a new engineer of this type needs a list of sites');
        log.push({ i, ok: true, text: `Add ${KNAME[op.kind].toLowerCase()} ${id} (${gender.toLowerCase()}) in ${op.zone}${op.sites?.length ? ` for ${op.sites.map(x => S.get(x).name).join(', ')}` : ', and re-split the zone\'s pool patches'}` });
      }
      else if (op.op === 'remove') {
        const e = eng(op.engineer), orphans = [...e.sites];
        removed.push(e.id); e.sites = []; touched.add(e.id);
        if (e.kind === 'pool') {
          const mates = plan.engineers.filter(x => x.kind === 'pool' && x.zone === e.zone && x.gender === e.gender && x !== e);
          if (mates.length) { mates[0].sites.push(...orphans); for (const id of orphans) S.get(id).eng = mates[0].id; rebalance(e.zone, e.gender); }
          else for (const id of orphans) { const s = S.get(id), to = pickNearest(s, e.zone, 'pool'); if (!to) throw new Error(`no engineer in ${e.zone} can take ${s.name}`); to.sites.push(id); s.eng = to.id; touched.add(to.id); }
        } else for (const id of orphans) { const s = S.get(id), to = pickNearest(s, e.zone, s.cr === 'City' && BIG.includes(sizeOf(plan, s)) ? 'city_shared' : 'pool'); if (!to) throw new Error(`no engineer in ${e.zone} can take ${s.name}`); to.sites.push(id); s.eng = to.id; touched.add(to.id); }
        log.push({ i, ok: true, text: `Remove ${e.id} (${KNAME[e.kind].toLowerCase()}); its ${orphans.length} site${orphans.length === 1 ? '' : 's'} go to the nearest engineers in ${e.zone}` });
      }
      else if (op.op === 'rebalance') { if (!plan.zones.some(z => z.id === op.zone)) throw new Error(`there is no zone "${op.zone}"`); rebalance(op.zone, 'Female'); rebalance(op.zone, 'Male'); log.push({ i, ok: true, text: `Re-split the pool patches in ${op.zone}` }); }
      else throw new Error(`unknown change "${op.op}"`);
    } catch (err) { log.push({ i, ok: false, text: `Change ${i + 1} not applied: ${err.message}.` }); }
  }
  // engineers left with no sites leave the plan (one fewer engineer); new or changed engineers get a base and fresh trips
  const freed = plan.engineers.filter(e => !e.sites.length).map(e => e.id);
  plan.engineers = plan.engineers.filter(e => e.sites.length);
  ({ S, E } = index(plan));
  const need = [];
  for (const e of plan.engineers) {
    if (!touched.has(e.id)) continue;
    if (!e.base || !e.sites.includes(e.base) || (e.kind === 'pool' && !based.has(e.id))) e.base = baseFor(e, S);
    e.legs = e.sites.filter(id => id !== e.base).map(id => {
      const s = S.get(id), b = S.get(e.base);
      if (s.boat || b.boat) return { to: id, peak: null, off: null, km: null, src: null };
      const k = known.get(`${e.base}>${id}`); if (k) return { ...k };
      const l = { to: id, ...est(b, s) }; if (l.src !== 'same') need.push([b, s, l]); return l;
    });
    e.flags = (e.flags || []).filter(f => f !== 'changed').concat('changed');
  }
  if (drive && need.length) {
    try {
      const got = await drive(need.map(([a, b]) => ({ a: { lat: a.lat, lng: a.lng }, b: { lat: b.lat, lng: b.lng } })));
      need.forEach(([, , l], i) => { const g = got?.[i]; if (g && g.peak != null) Object.assign(l, { peak: g.peak, off: g.off, km: g.km, src: g.src || 'google' }); });
    } catch { /* keep the estimates */ }
  }
  recompute(plan);
  const changedSites = plan.sites.filter(s => s.eng !== before.get(s.id)).map(s => s.id);
  const baseIds = new Set(base.engineers.map(e => e.id)), simIds = new Set(plan.engineers.map(e => e.id));
  return { plan, log, added: plan.engineers.filter(e => !baseIds.has(e.id)).map(e => e.id), removed: base.engineers.filter(e => !simIds.has(e.id)).map(e => e.id),
    changedSites, changedEngs: [...touched].filter(id => simIds.has(id)) };
}

// ---------------------------------------------------------------- impact: what a set of changes does to the whole plan
export function impact(base, res) {
  const sim = res.plan, { S } = index(sim), bS = index(base).S, bE = index(base).E, E = index(sim).E;
  const kinds = p => { const o = {}; for (const e of p.engineers) o[e.kind] = (o[e.kind] || 0) + 1; return o; };
  const bk = kinds(base), sk = kinds(sim);
  const leg = (p, Ex, sid) => { const s = (p === base ? bS : S).get(sid), e = Ex.get(s.eng); if (!e) return null; if (e.base === sid) return e.sites.length > 1 ? 'base' : 'on site'; const l = e.legs.find(l => l.to === sid); return l ? l.peak : null; };
  const moved = res.changedSites.map(id => { const s = S.get(id); return { site: id, name: s.name, no: s.no, from: bS.get(id).eng, to: s.eng, before: leg(base, bE, id), after: leg(sim, E, id) }; });
  const st = (p, k) => p.stats[k];
  const metrics = [
    ['Engineers in the zones', base.engineers.length, sim.engineers.length],
    ['City pairs: median drive apart, 7:30 am (min)', st(base, 'pair_median'), st(sim, 'pair_median')],
    ['City pairs within 15 min', st(base, 'pair_le15'), st(sim, 'pair_le15')],
    ['City pairs over 30 min', st(base, 'pair_gt30'), st(sim, 'pair_gt30')],
    ['Pool sites: median drive from base (min)', st(base, 'pool_median_reach'), st(sim, 'pool_median_reach')],
    ['Pool sites within 30 min of base', st(base, 'pool_le30_sites'), st(sim, 'pool_le30_sites')],
    ['Average sites per pool engineer', st(base, 'pool_sites_avg'), st(sim, 'pool_sites_avg')],
    ['Female engineers', st(base, 'female')?.Female || 0, st(sim, 'female')?.Female || 0],
  ].map(([label, before, after]) => ({ label, before, after }));
  const zonesHit = new Set([...moved.flatMap(m => [bE.get(m.from)?.zone, E.get(m.to)?.zone]), ...res.added.map(id => E.get(id)?.zone), ...res.removed.map(id => bE.get(id)?.zone)].filter(Boolean));
  const zl = (p, z) => { const es = p.engineers.filter(e => e.zone === z && e.kind !== 'national'); const u = es.reduce((a, e) => a + e.users, 0); return { eng: p.engineers.filter(e => e.zone === z).length, usersPer: es.length ? Math.round(u / es.length) : 0 }; };
  const zones = [...zonesHit].map(z => ({ zone: z, label: sim.zones.find(x => x.id === z)?.label || z, before: zl(base, z), after: zl(sim, z) }));
  const bc = new Map(checks(base).map(c => [c.key, c])), sc = checks(sim);
  return {
    headcount: { before: { total: base.engineers.length, byKind: bk }, after: { total: sim.engineers.length, byKind: sk } },
    metrics, zones, moved, added: res.added, removed: res.removed,
    warnings: sc.filter(c => !bc.has(c.key)), resolved: [...bc.values()].filter(c => !sc.some(x => x.key === c.key)),
    log: res.log,
  };
}
// the impact in sections: headline figures, zones, rule warnings, resolved issues, and the sites that change engineer
export function impactGroups(imp) {
  const d = (a, b) => (a === b ? `${a} (no change)` : `${a} → ${b}`);
  const leg = v => v == null ? 'boat' : v === 'base' ? 'patch base' : v === 'on site' ? 'on site' : `${v} min from base`;
  const hb = imp.headcount.before, ha = imp.headcount.after;
  const headline = [`Engineers in the zones: ${d(hb.total, ha.total)} (${Object.keys(KCODE).filter(k => (hb.byKind[k] || 0) !== (ha.byKind[k] || 0)).map(k => `${KNAME[k]}s ${hb.byKind[k] || 0} → ${ha.byKind[k] || 0}`).join('; ') || 'same mix'}).`,
    ...imp.metrics.filter(m => m.before !== m.after && m.label !== 'Engineers in the zones').map(m => `${m.label}: ${m.before} → ${m.after}.`)];
  return {
    headline,
    zones: imp.zones.map(z => `${z.label}: ${d(z.before.eng, z.after.eng)} engineers; users per non-national engineer ${d(z.before.usersPer, z.after.usersPer)}.`),
    warnings: imp.warnings.map(w => `${w.level === 'rule' ? 'Rule warning' : 'Watch'}: ${w.text}`),
    resolved: imp.resolved.map(w => `Resolved: ${w.text}`),
    moves: imp.moved.map(m => `${m.name} (no. ${m.no}): ${m.from} → ${m.to}, ${leg(m.before)} → ${leg(m.after)}.`),
  };
}
export function impactLines(imp) {
  const g = impactGroups(imp);
  return [...g.headline, ...g.zones, ...g.moves.slice(0, 40), ...(g.moves.length > 40 ? [`…and ${g.moves.length - 40} more sites change engineer.`] : []), ...g.warnings, ...g.resolved];
}

// ---------------------------------------------------------------- backup engineer per site (if its own engineer is off)
export function backups(plan) {
  const { S } = index(plan), out = new Map();
  const cand = plan.engineers.filter(e => e.kind === 'pool' || e.kind === 'city_shared');
  for (const s of plan.sites) {
    if (s.boat) continue;
    const c = cand.filter(e => e.id !== s.eng && e.zone === s.zone && girlsOk(s, e)).map(e => [e.kind === 'pool' ? 0 : 1, est(S.get(e.base), s).peak, e]);
    c.sort((a, b) => a[1] + a[0] * 4 - (b[1] + b[0] * 4));
    if (c[0]) out.set(s.id, { eng: c[0][2].id, min: c[0][1] });
  }
  return out;
}

// ---------------------------------------------------------------- the assistant's data tables
export function kbTables(plan, { arabic = false } = {}) {
  const { S, E } = index(plan), bk = backups(plan), L = [];
  const z = plan.zones.map(z => {
    const es = plan.engineers.filter(e => e.zone === z.id), nn = es.filter(e => e.kind !== 'national'), u = nn.reduce((a, e) => a + e.users, 0);
    return `${z.id}|${z.label}|${z.lead}|${z.schools}|${z.remote}|${z.cityBig}|${z.citySmall}|${z.offices}|${es.length}|${z.byKind.national || 0}|${z.byKind.city_shared || 0}|${z.byKind.pool || 0}|${z.byKind.remote_shared || 0}|${z.female}|${es.reduce((a, e) => a + e.users, 0)}|${nn.length ? Math.round(u / nn.length) : 0}`;
  });
  L.push('ZONES (id|name|team lead|schools|remote schools|city M/L/XL|city S/XS|offices|engineers|nationals|city shared|pool|remote shared|female engineers|users|users per non-national engineer)', ...z, '');
  L.push('ENGINEERS (id|type|gender|nationality|zone|base site|sites|users|longest drive from base at 7:30 am, min)');
  for (const e of plan.engineers) L.push(`${e.id}|${e.kind}|${e.gender}|${e.nat}|${e.zone}|${e.base}|${e.sites.join(',')}|${e.users}|${e.maxPeak || 0}${e.flags?.length ? '|flags:' + e.flags.join(',') : ''}`);
  L.push('', `SITES (id|${arabic ? 'arabic name|' : ''}name|school no. or site code|type|city/remote|size|qualified size|gender B/G/M|users|zone|engineer|drive from base 7:30 am min|10:30 am min|road km|backup engineer ~min|notes)`);
  for (const s of plan.sites) {
    const e = E.get(s.eng), l = e?.legs.find(l => l.to === s.id), b = bk.get(s.id);
    const dr = !e ? '' : e.base === s.id ? (e.sites.length > 1 ? 'base|base|' : 'on site|on site|') : l && l.peak != null ? `${l.peak}|${l.off}|${l.km}` : 'boat||';
    const notes = [s.approx && 'location approximate', s.boat && 'island, boat', s.rural && 'rural', s.placeholder && 'placeholder', s.usersAssumed && 'users assumed'].filter(Boolean).join(', ');
    L.push(`${s.id}|${arabic ? (s.nameAr || '') + '|' : ''}${s.name}|${s.no}|${s.type}|${s.cr}|${s.size}|${s.qsize || ''}|${s.g || '-'}|${s.users}|${s.zone}|${s.eng}|${dr}|${b ? `${b.eng} ~${b.min}` : ''}|${notes}`);
  }
  const nn = plan.engineers.filter(e => e.kind !== 'national');
  const zr = plan.zones.map(z => { const es = nn.filter(e => e.zone === z.id); return [z.id, es.length ? Math.round(es.reduce((a, e) => a + e.users, 0) / es.length) : 0]; }).sort((a, b) => b[1] - a[1]);
  const allTrips = plan.engineers.flatMap(e => e.legs.filter(l => l.peak != null).map(l => [l.peak, e, l.to, l.km])).sort((a, b) => b[0] - a[0]), trips = allTrips.filter(t => t[0] > SLA);
  L.push('', 'RANKINGS (use these instead of working rankings out)',
    `Zones by users per non-national engineer, highest first: ${zr.map(([id, u]) => `${id} ${u}`).join('; ')}.`,
    `ALL trips over ${SLA} min from an engineer's base at 7:30 am (${trips.length}, longest first): ${trips.map(([m, e, to, km]) => `${e.id} (${e.kind}, ${e.gender}) to ${to} ${S.get(to).name} (${S.get(to).type}): ${m} min, ${km} km`).join('; ')}.`,
    `Non-national engineers with the most users: ${[...nn].sort((a, b) => b.users - a.users).slice(0, 10).map(e => `${e.id} ${e.users}`).join('; ')}.`,
    `Pool engineers with the most sites: ${plan.engineers.filter(e => e.kind === 'pool').sort((a, b) => b.sites.length - a.sites.length).slice(0, 8).map(e => `${e.id} ${e.sites.length}`).join('; ')}.`,
    `Mixed boys+girls city engineers: ${plan.stats.mixed_pairs.join(', ') || 'none'}. City engineers with 3 schools: ${plan.engineers.filter(e => e.kind === 'city_shared' && e.sites.length === 3).map(e => e.id).join(', ') || 'none'}; with 1 school: ${plan.engineers.filter(e => e.kind === 'city_shared' && e.sites.length === 1).map(e => e.id).join(', ') || 'none'}.`);
  const st = plan.stats;
  L.push('', `TOTALS: ${plan.engineers.length + (plan.hq || 0)} engineers = ${plan.hq} HQ + ${plan.engineers.length} in zones: ${Object.keys(KCODE).map(k => [k, plan.engineers.filter(e => e.kind === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${KNAME[k].toLowerCase()}s`).join(', ')}. City pairs: ${st.pairs}, median ${st.pair_median} min apart at 7:30 am, ${st.pair_le15} within 15 min, ${st.pair_le30} within 30, ${st.pair_gt30} over 30; median ${st.pair_km_median} km. Pool: ${st.pool_sites_avg} sites per engineer on average (max ${st.pool_sites_max}); median ${st.pool_median_reach} min from base; ${st.pool_le30_sites} pool sites within 30 min. Mixed boys+girls pairs: ${st.mixed_pairs.join(', ') || 'none'}. Engineers by gender: ${Object.entries(st.female).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  L.push(`BUDGET: ${budgetOf(plan)} engineers in the zones + ${plan.hq} at HQ${plan.hqSites?.length ? ` (${plan.hqSites.map(h => `${h.name} ${h.engineers}`).join(', ')}; HQ engineers are not field engineers and are not on the plan's sites)` : ''}. ${plan.model ? 'City schools are classed by QUALIFIED size: qualified Medium/Large/X-Large are paired (1 non-national per 2 schools); qualified Small/X-Small go to the zone pool with the non-school sites. Every remote school has its own Emirati national.' : ''}${plan.stats?.island?.length ? ' Abu Moosa School is not in service (on Abu Musa island): boat visits by the nearest pool engineer in its zone, not counted.' : ''}`);
  return L.join('\n');
}
