// Server routes shared by the Vercel function (deploy/moe-option-remote-map/api/index.js) and the local server.js.
//   GET  /api/plan              live plan {meta, plan}
//   POST /api/drive             Google typical drive times (Tuesday 7:30 / 10:30) for simulated trips
//   POST /api/live              live traffic: typical for this hour vs now
//   POST /api/ask               the assistant (streams NDJSON events: {meta} {s} {t} {restart} {error}; see assistant.mjs)
//   POST /api/proposals         turn simulated changes into a proposal and email the approvers
//   GET  /api/proposals/{id}    a proposal, its plan and its decision (for "see it on the map")
//   GET  /api/versions          approved versions
//   POST /api/scenarios         save a map version (a named set of simulated changes) and get its private link
//   GET  /api/scenarios/{id}    a saved version and its plan (there is no list: the link is the only way in)
//   GET|POST /approve           the approval page reached from the email (token in the link, no site password)
//   /tiles/*                    Google basemap tiles
import crypto from 'node:crypto';
import * as PE from './plan-engine.mjs';
import { ask, models } from './assistant.mjs';
import { googleTiles } from './google-tiles.mjs';
import { makeStore } from './store.mjs';
import { sendMail, proposalEmail, decisionEmail } from './mailer.mjs';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DEFAULT_APPROVERS = 'sthirumaran@skyformit.com:Sithesvaran Thirumaran,sanathswaroop@skyformit.com:Sanath Swaroop';

export function makeApi({ env, basePlan, decisions, driveSeed, logos = {} }) {
  const tiles = googleTiles(env.GOOGLE_MAPS_API_KEY);
  const store = makeStore({ token: env.BLOB_READ_WRITE_TOKEN, prefix: env.STORE_PREFIX || '' });
  const APPROVERS = (env.APPROVERS || DEFAULT_APPROVERS).split(',').map(x => { const [email, ...n] = x.split(':'); return { email: email.trim().toLowerCase(), name: n.join(':').trim() || email.trim() }; });
  const sign = (id, email) => crypto.createHmac('sha256', env.APPROVAL_SECRET || 'unset').update(`${id}|${email.toLowerCase()}`).digest('base64url');
  const okToken = (id, email, t) => { const a = Buffer.from(sign(id, email)), b = Buffer.from(String(t || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };

  // ---- the live plan (version 0 = the plan built into the site), cached briefly
  let liveCache = null;
  async function live(fresh = false) {
    if (!store) return { meta: { version: 0 }, plan: basePlan };
    if (!fresh && liveCache && Date.now() - liveCache.t < 15000) return liveCache.v;
    const meta = await store.current(); const plan = meta.version ? await store.plan(meta.version) : basePlan;
    const v = { meta: { version: meta.version || 0, at: meta.at, by: meta.by, proposal: meta.proposal, requester: meta.requester }, plan: plan || basePlan };
    liveCache = { t: Date.now(), v }; return v;
  }

  // ---- Google drive times
  const GKEY = env.GOOGLE_MAPS_API_KEY;
  async function matrix(origin, dests, departureTime) {
    const wp = p => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
    const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GKEY, 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition' },
      body: JSON.stringify({ origins: [wp(origin)], destinations: dests.map(wp), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', ...(departureTime ? { departureTime } : {}) })
    });
    const t = await r.text(); if (!r.ok) throw new Error(`Google ${r.status}`); return JSON.parse(t);
  }
  const okPt = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  const byOrigin = (pairs, idx) => { const m = new Map(); for (const i of idx) { const k = `${pairs[i].a.lat.toFixed(5)},${pairs[i].a.lng.toFixed(5)}`; if (!m.has(k)) m.set(k, []); m.get(k).push(i); } return [...m.values()]; };
  const pick = (res, j) => { const e = res.find(e => (e.destinationIndex || 0) === j); return e && e.duration ? { min: parseInt(e.duration) / 60, km: Math.round(e.distanceMeters / 100) / 10 } : null; };
  // typical Tuesday times, the same as the build (tools/google_times.py): cached by coordinates
  const dcache = new Map(Object.entries(driveSeed?.pairs || {}));
  const dkey = (a, b, slot) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}|${slot}`;
  function nextTuesday(h, m) {
    const uae = new Date(Date.now() + 4 * 3600e3), d0 = Date.UTC(uae.getUTCFullYear(), uae.getUTCMonth(), uae.getUTCDate());
    const add = ((2 - new Date(d0).getUTCDay() + 7) % 7) || 7;
    return new Date(d0 + add * 864e5 + (h * 60 + m) * 60e3 - 4 * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z');
  }
  async function drive(pairs) {
    pairs = (pairs || []).filter(p => okPt(p?.a) && okPt(p?.b)).slice(0, 60);
    const out = pairs.map(() => ({}));
    for (const [slot, h] of [['peak', 7], ['off', 10]]) {
      const need = [];
      pairs.forEach((p, i) => { const c = dcache.get(dkey(p.a, p.b, slot)); if (c) { out[i][slot] = Math.max(1, Math.round(c[0])); out[i].km = c[1]; } else need.push(i); });
      if (!need.length || !GKEY) continue;
      const dep = nextTuesday(h, 30);
      await Promise.all(byOrigin(pairs, need).map(async idx => {
        try {
          const res = await matrix(pairs[idx[0]].a, idx.map(i => pairs[i].b), dep);
          idx.forEach((i, j) => { const g = pick(res, j); if (g) { dcache.set(dkey(pairs[i].a, pairs[i].b, slot), [g.min, g.km]); out[i][slot] = Math.max(1, Math.round(g.min)); out[i].km = g.km; } });
        } catch { /* leave as estimate */ }
      }));
    }
    return out.map(o => (o.peak != null ? { peak: o.peak, off: o.off ?? o.peak, km: o.km, src: 'google' } : null));
  }
  // live traffic: leaving now vs the same weekday and hour next week (Google's usual for this hour)
  const liveCacheT = new Map();
  async function liveTimes(body) {
    const pairs = (Array.isArray(body?.pairs) ? body.pairs : []).filter(p => okPt(p?.a) && okPt(p?.b)).slice(0, 30);
    const out = pairs.map(() => null), need = [], now = Date.now(), k = p => dkey(p.a, p.b, 'live');
    pairs.forEach((p, i) => { const c = liveCacheT.get(k(p)); if (c && now - c.t < 300000) out[i] = c.v; else need.push(i); });
    const nextWeek = new Date(now + 7 * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
    for (const idx of byOrigin(pairs, need)) {
      const a = pairs[idx[0]].a, ds = idx.map(i => pairs[i].b);
      const [n, t] = await Promise.all([matrix(a, ds), matrix(a, ds, nextWeek)]);
      idx.forEach((i, j) => { const x = pick(n, j), y = pick(t, j); if (x && y) { const v = { now: Math.max(1, Math.round(x.min)), typical: Math.max(1, Math.round(y.min)), km: x.km }; out[i] = v; liveCacheT.set(k(pairs[i]), { t: now, v }); } });
    }
    return { results: out, at: new Date(now).toISOString() };
  }

  // ---- pages for the approval links
  const page = (title, body, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>MOE Site Engineer Allocation Maps</title><script>/* default zoom: 80% on a Mac, 67% on Windows (desktop only) */(function(){try{var n=navigator,p=(n.userAgentData&&n.userAgentData.platform)||n.platform||'',z=/Mac/i.test(p)&&!(n.maxTouchPoints>1)?0.8:/Win/i.test(p)?0.67:1;if(z!==1){document.documentElement.style.zoom=z;}}catch(e){}})();</script>
<style>:root{--ink:#16202E;--ink2:#46536A;--mut:#6B778C;--line:#DCE2EA;--paper:#F4F6F9;--bad:#B42318;--good:#1F7A45}*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 "IBM Plex Sans",-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:24px 16px}
main{max-width:720px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:8px;padding:24px}
.brand{display:flex;align-items:center;gap:14px;margin:0 0 18px;padding:0 0 16px;border-bottom:1px solid var(--line)}.brand img{height:40px;width:auto;display:block}.brand i{width:1px;height:34px;background:var(--line)}
h1{font-size:22px;line-height:1.25;margin:0 0 6px}h2{font-size:15px;margin:18px 0 4px}p{margin:0 0 10px;color:var(--ink2)}ul{margin:4px 0 10px;padding-left:20px}li{margin:3px 0}
.warn li{color:var(--bad)}.ok{color:var(--good)}.bad{color:var(--bad)}form{display:inline}
button{font:inherit;font-weight:600;padding:10px 18px;border-radius:6px;cursor:pointer;border:1px solid #B8C2D0;background:#fff;color:var(--ink);margin:12px 8px 0 0}button.p{background:var(--ink);color:#fff;border-color:var(--ink)}
a{color:var(--ink)}</style></head><body><main><div class="brand">${logos.ad ? `<img src="${logos.ad}" alt="Alpha Data"><i></i><img src="${logos.moe}" alt="UAE Ministry of Education">` : ''}</div><h1>${esc(title)}</h1>${body}</main></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  const ul = (xs, cls = '') => xs.length ? `<ul class="${cls}">${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const summary = p => {
    const g = p.groups || { headline: p.lines.filter(l => !/^(Rule warning|Watch|Resolved)/.test(l)), zones: [], moves: [], warnings: p.lines.filter(l => /^(Rule warning|Watch)/.test(l)), resolved: [] };
    const ch = p.log.filter(l => l.ok).map(l => l.text), broke = p.rulesBroken || g.warnings.filter(l => /^Rule/.test(l)), warn = g.warnings.filter(l => /^Watch/.test(l)), imp = [...g.headline, ...g.zones, ...g.resolved];
    return `<p>Requested by <b>${esc(p.requester)}</b> on ${esc(new Date(p.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' }))} (UAE time), on plan version ${p.baseVersion}.${p.note ? `<br>Note: “${esc(p.note)}”` : ''}</p>
      <h2>What changes</h2>${ul(ch)}${broke.length ? `<h2 class="bad">Rules the requester chose to break</h2>${ul(broke, 'warn')}<p>${esc(p.requester)} was warned on the map and confirmed each of these. Confirming the proposal accepts them.</p>` : '<p class="ok">No MOE rule is broken by these changes.</p>'}<h2>Impact on the plan</h2>${ul(imp)}${warn.length ? `<h2>Things to watch</h2>${ul(warn)}` : ''}
      ${g.moves.length ? `<details><summary><b>${g.moves.length} site${g.moves.length === 1 ? '' : 's'} change engineer</b></summary>${ul(g.moves)}</details>` : ''}`;
  };

  async function approve(req, url, origin) {
    const form = req.method === 'POST' ? new URLSearchParams(await req.text()) : url.searchParams;
    const id = form.get('p') || '', email = (form.get('e') || '').toLowerCase(), t = form.get('t') || '', action = form.get('action');
    const who = APPROVERS.find(a => a.email === email);
    if (!store || !who || !/^p[\w-]{6,40}$/.test(id) || !okToken(id, email, t)) return page('This link is not valid', '<p>Open the latest email about this proposal, or ask for the changes to be sent again.</p>', 403);
    const p = await store.proposal(id);
    if (!p) return page('Proposal not found', '<p>It may have been removed.</p>', 404);
    const mapUrl = `${origin}/?proposal=${encodeURIComponent(id)}`;
    const d = await store.decision(id);
    if (d) return page(d.decision === 'approved' ? 'Already approved' : d.decision === 'rejected' ? 'Already rejected' : d.decision === 'withdrawn' ? 'This proposal was withdrawn' : 'Out of date',
      `<p>${d.decision === 'withdrawn' ? `${esc(d.reason || 'It can no longer be approved.')} The live plan is unchanged.` : d.decision === 'outdated' ? 'The plan changed before this proposal could be applied.' : `${esc(d.byName)} ${d.decision} this proposal on ${esc(new Date(d.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' }))}.`}${d.version ? ` The live map shows plan version ${d.version}.` : ''}</p><p><a href="${origin}/">Open the map</a></p>${summary(p)}`);
    if (Date.now() > new Date(p.expiresAt).getTime()) return page('This proposal has expired', `<p>It was not decided within 7 days. Ask for the changes to be made again on the map.</p>${summary(p)}`);
    const cur = await store.current();
    if ((cur.version || 0) !== p.baseVersion) return page('This proposal is out of date', `<p>It was made on plan version ${p.baseVersion}, but the live plan is now version ${cur.version}. Ask for the changes to be made again on the map so their impact is worked out on the current plan.</p>${summary(p)}`);
    if (req.method !== 'POST' || !action) {
      const hid = `<input type="hidden" name="p" value="${esc(id)}"><input type="hidden" name="e" value="${esc(email)}"><input type="hidden" name="t" value="${esc(t)}">`;
      return page('Plan update request', `${summary(p)}<p style="margin-top:16px">${esc(who.name)}, confirming updates the live plan for everyone using the map. The first approver to decide wins.</p>
        <form method="post" action="/approve">${hid}<input type="hidden" name="action" value="approve"><button class="p" type="submit">Confirm and update the plan</button></form>
        <form method="post" action="/approve">${hid}<input type="hidden" name="action" value="reject"><button type="submit">Reject</button></form>
        <p style="margin-top:14px"><a href="${esc(mapUrl)}">See the proposed plan on the map</a> (needs the map password)</p>`);
    }
    const at = new Date().toISOString();
    if (action === 'reject') {
      if (!(await store.decide(id, { decision: 'rejected', by: email, byName: who.name, at }))) return approve(new Request(url, { method: 'GET' }), url, origin);
      const dd = { decision: 'rejected', byName: who.name };
      await Promise.allSettled(APPROVERS.map(a => sendMail(env, { to: a.email, ...decisionEmail({ p, d: dd, viewUrl: `${origin}/` }) })));
      return page('Rejected', `<p>The live plan is unchanged. ${APPROVERS.filter(a => a !== who).map(a => esc(a.name)).join(', ')} has been told.</p>${summary(p)}`);
    }
    const version = (cur.version || 0) + 1;
    if (!(await store.decide(id, { decision: 'approved', by: email, byName: who.name, at, version }))) return approve(new Request(url, { method: 'GET' }), url, origin);
    const plan = await store.proposalPlan(id);
    const r = plan ? await store.commit(plan, { at, by: who.name, byEmail: email, proposal: id, requester: p.requester, changes: p.log.filter(l => l.ok).length }, p.baseVersion) : { ok: false, reason: 'missing' };
    if (!r.ok) { await store.redecide(id, { decision: 'outdated', by: email, byName: who.name, at }); return page('This proposal is out of date', '<p>The plan changed while you were confirming. Ask for the changes to be made again on the map.</p>'); }
    liveCache = null;
    await Promise.allSettled(APPROVERS.map(a => sendMail(env, { to: a.email, ...decisionEmail({ p, d: { decision: 'approved', byName: who.name, version: r.version }, viewUrl: `${origin}/` }) })));
    return page('Plan updated', `<p class="ok">Done. The live map now shows plan version ${r.version} for everyone. The other approver has been told.</p><p><a href="${origin}/">Open the map</a></p>${summary(p)}`);
  }

  async function createProposal(body, origin) {
    if (!store) return json({ error: 'Proposals need the online version of the map.' }, 503);
    const requester = String(body?.requester || '').trim().slice(0, 80), note = String(body?.note || '').trim().slice(0, 600), ops = Array.isArray(body?.ops) ? body.ops.slice(0, 50) : [];
    if (!requester) return json({ error: 'Please give your name.' }, 400);
    if (!ops.length) return json({ error: 'There are no changes to send.' }, 400);
    const { meta, plan } = await live(true);
    const res = await PE.simulate(plan, ops, { drive });
    if (!res.log.some(l => l.ok)) return json({ error: 'None of the changes could be applied to the current plan.' }, 400);
    const imp = PE.impact(plan, res), now = new Date();
    const acked = new Set(ops.flatMap(o => (Array.isArray(o.ack) ? o.ack : []))), rules = imp.warnings.filter(w => w.level === 'rule');
    const unconfirmed = rules.filter(w => !acked.has(w.key));
    if (unconfirmed.length) return json({ error: `These changes break ${unconfirmed.length === 1 ? 'a rule' : 'rules'} you have not confirmed: ${unconfirmed.map(w => w.text).join(' ')}` }, 400);
    const id = `p${now.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex')}`;
    const p = { id, createdAt: now.toISOString(), requester, note, baseVersion: meta.version, ops, log: res.log, lines: PE.impactLines(imp), groups: PE.impactGroups(imp), warnings: imp.warnings,
      changedSites: res.changedSites, changedEngs: res.changedEngs, added: res.added, removed: res.removed, rulesBroken: rules.map(w => w.text), approvers: APPROVERS.map(a => a.email), expiresAt: new Date(now.getTime() + 7 * 864e5).toISOString() };
    await store.saveProposal(p, res.plan);
    const sent = await Promise.allSettled(APPROVERS.map(a => sendMail(env, { to: a.email, ...proposalEmail({ p, approver: a, reviewUrl: `${origin}/approve?p=${id}&e=${encodeURIComponent(a.email)}&t=${sign(id, a.email)}`, viewUrl: `${origin}/?proposal=${id}` }) })));
    const failed = sent.filter(s => s.status === 'rejected');
    return json({ id, sentTo: APPROVERS.filter((a, i) => sent[i].status === 'fulfilled').map(a => a.name), error: failed.length ? `Email to ${failed.length} approver(s) failed: ${failed[0].reason?.message}` : undefined, lines: p.lines, log: p.log });
  }

  // ---- map versions: a named plan saved with an unguessable id; not published, opened only by its link
  async function createScenario(body, origin) {
    if (!store) throw new Error('Saving versions needs the online version of the map.');
    const name = String(body?.name || '').trim().slice(0, 80), summary = String(body?.summary || '').trim().slice(0, 600);
    const ops = (Array.isArray(body?.ops) ? body.ops : []).slice(0, 60).filter(o => o && typeof o.op === 'string').map(({ _id, _bad, ...o }) => o);
    if (!name) throw new Error('Please give the version a name.');
    if (!ops.length) throw new Error('There are no changes to save.');
    const { meta, plan } = await live(true);
    const res = await PE.simulate(plan, ops, { drive });
    if (!res.log.some(l => l.ok)) throw new Error('None of the changes could be applied to the current plan.');
    const imp = PE.impact(plan, res), id = 's' + crypto.randomBytes(16).toString('base64url');
    const v = { id, kind: 'version', name, summary, createdAt: new Date().toISOString(), createdBy: String(body?.createdBy || 'the map').slice(0, 40), baseVersion: meta.version, ops,
      log: res.log, lines: PE.impactLines(imp), groups: PE.impactGroups(imp), warnings: imp.warnings, changedSites: res.changedSites, changedEngs: res.changedEngs, added: res.added, removed: res.removed };
    await store.saveScenario(v, res.plan);
    return { ...v, link: `${origin}/?version=${id}` };
  }

  // ---- router. Returns null for paths it does not handle (the caller serves the map or the sign-in page).
  return async function handle(req, { signedIn = false, origin } = {}) {
    const url = new URL(req.url), path = url.searchParams.get('path') || url.pathname;
    origin = env.SITE_URL || origin || url.origin;
    if (path === '/approve') return approve(req, url, origin);
    if (!path.startsWith('/api/') && !path.startsWith('/tiles/')) return null;
    if (!signedIn) return json({ error: 'Sign in first.' }, 401);
    try {
      if (path.startsWith('/tiles/')) return tiles(path);
      if (path === '/api/plan') { const v = await live(); return json({ meta: v.meta, plan: v.plan, proposals: !!store, ai: models(env) }); }
      const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
      if (path === '/api/drive') return json({ results: await drive(body.pairs) });
      if (path === '/api/live') { if (!GKEY) return json({ error: 'Live traffic is not set up.' }, 503); return json(await liveTimes(body)); }
      if (path === '/api/proposals' && req.method === 'POST') return createProposal(body, origin);
      let m = path.match(/^\/api\/proposals\/(p[\w-]{6,40})$/);
      if (m && store) { const p = await store.proposal(m[1]); if (!p) return json({ error: 'Not found.' }, 404); return json({ proposal: p, plan: await store.proposalPlan(m[1]), decision: await store.decision(m[1]) }); }
      if (path === '/api/versions') return json({ versions: store ? await store.versions() : [] });
      if (path === '/api/scenarios' && req.method === 'POST') { try { const v = await createScenario(body, origin); return json({ id: v.id, link: v.link, name: v.name, log: v.log, lines: v.lines }); } catch (e) { return json({ error: e.message }, 400); } }
      m = path.match(/^\/api\/scenarios\/(s[\w-]{16,40})$/);
      if (m && store) { const v = await store.scenario(m[1]); if (!v) return json({ error: 'This version does not exist or the link is wrong.' }, 404); return json({ version: v, plan: await store.scenarioPlan(m[1]) }); }
      if (path === '/api/ask' && req.method === 'POST') {
        const { meta, plan } = await live(); const enc = new TextEncoder(), ac = new AbortController();
        req.signal?.addEventListener?.('abort', () => ac.abort(), { once: true });
        const stream = new ReadableStream({
          async start(c) {
            try { for await (const ev of ask({ env, plan, meta, decisions, picks: body.picks, draftOps: body.draftOps, messages: body.messages, signal: ac.signal, drive, saveVersion: store ? x => createScenario(x, origin) : null })) { if (ac.signal.aborted) break; c.enqueue(enc.encode(JSON.stringify(ev) + '\n')); } }
            catch (e) { if (!ac.signal.aborted) c.enqueue(enc.encode(JSON.stringify({ error: String(e.message).slice(0, 200) }) + '\n')); }
            try { c.close(); } catch {}
          },
          cancel() { ac.abort(); }   // the user pressed Stop or left the page
        });
        return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } });
      }
      return json({ error: 'Not found.' }, 404);
    } catch (e) { return json({ error: String(e.message).slice(0, 240) }, 502); }
  };
}
