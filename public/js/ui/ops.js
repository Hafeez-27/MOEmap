// Operations view: school-day strip, figures, map with drawer, attention list, engineers on the road, approvals, feed.
import { $, $$, esc, COL, MAPCOL, INK, BOY, GIRL, LOAN, pct, num, genderTag, toast } from './util.js';
import { P, SLA, CAT, fmtT, fmtDur, weekday, shiftWindow, bizBetween, mod } from '../model.js';
import { eligible, ruleText, gLabel } from '../engine.js';

let A, map, siteLayer, engLayer, lineLayer, selLayer, pulseLayer; const siteM = new Map(), engM = new Map();
const radius = s => Math.max(3.5, Math.min(11, 3 + Math.sqrt(s.users) / 9));

export function initOps(app) {
  A = app;
  map = L.map('map', { preferCanvas: true, zoomControl: false }).setView([24.75, 55.0], 8); L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 18, className: 'tiles' }).addTo(map);
  siteLayer = L.layerGroup().addTo(map); lineLayer = L.layerGroup().addTo(map); engLayer = L.layerGroup().addTo(map); selLayer = L.layerGroup().addTo(map); pulseLayer = L.layerGroup().addTo(map);
  const syncZoom = () => $('#map').classList.toggle('far', map.getZoom() < 10); map.on('zoomend', syncZoom); syncZoom();
  for (const z of A.net.zones) L.marker([z.hub.lat, z.hub.lng], { icon: L.divIcon({ className: '', html: `<div class="hubic">${z.id}<span> hub</span></div>`, iconSize: [52, 15], iconAnchor: [10, 7] }), zIndexOffset: 400, keyboard: false })
    .bindTooltip(`${esc(z.hub.name)}. Pool engineers start here and return between jobs (position indicative)`).addTo(map);
  buildSites();
  $('#allEng').onchange = e => { A.ui.allEng = e.target.checked; };
  let lastEsc = 0; A.sim.on('log', l => { if (l.type === 'escalate' && A.ui.view === 'ops' && A.ui.playing && performance.now() - lastEsc > 20000) { lastEsc = performance.now(); toast(`Escalated to zone lead: ${A.sim.sites.get(l.siteId).name}`, false); } });
  A.sim.on('dayEnd', d => showEod(d));

}
export function invalidate() { setTimeout(() => map.invalidateSize(), 50); }
export function flyToZone(z) {
  if (!z) return map.flyTo([24.75, 55.0], 8, { duration: .6 });
  const pts = [...A.sim.sites.values()].filter(s => s.zone === z).map(s => [s.lat, s.lng]); map.flyToBounds(pts, { padding: [30, 30], duration: .6 });
}
function buildSites() {
  siteLayer.clearLayers(); siteM.clear();
  for (const s of A.sim.sites.values()) {
    const m = L.circleMarker([s.lat, s.lng], { radius: radius(s), weight: 1.2, color: s.type !== 'school' ? '#6B7A90' : s.gender === 'B' ? BOY : GIRL, fillColor: MAPCOL.good, fillOpacity: .8 });
    m.on('click', () => selectSite(s.id));
    m.bindTooltip(() => `<b>${esc(s.name)}</b><br>${esc(ruleText(s))}<br>Health ${s.health}${s.why.length ? ': ' + esc(s.why.join(', ')) : ''}`, { sticky: true, direction: 'top' });
    m.addTo(siteLayer); siteM.set(s.id, m);
  }
}
export function rebuildSites() { buildSites(); }

// ---------- per-frame map refresh
export function mapTick() {
  const sim = A.sim, tf = sim.tf, seen = new Set(); lineLayer.clearLayers();
  const fol = A.ui.follow ? sim.active.find(k => k.id === A.ui.follow) : null;
  for (const e of sim.engs.values()) {
    if (e.absent || e.state === 'off') continue;
    if (A.ui.zone && e.zone !== A.ui.zone) continue;
    const moving = e.state === 'travel', onJob = !!e.task, sel = A.ui.sel?.type === 'eng' && A.ui.sel.id === e.id, followed = fol && fol.engId === e.id;
    if (!(moving || e.loan || e.cover && moving || A.ui.allEng || sel || followed || (onJob && e.kind !== 'dedicated'))) continue;
    seen.add(e.id); const p = sim.posAt(e, tf);
    let m = engM.get(e.id);
    if (!m) { m = L.circleMarker([p.lat, p.lng], { radius: 5, weight: 1.5, fillOpacity: 1 }); m.on('click', () => selectEng(e.id)); m.bindTooltip(() => engTip(e), { direction: 'top' }); engM.set(e.id, m); }
    m.setLatLng([p.lat, p.lng]).setStyle({ color: sel || followed ? '#C8372D' : e.loan ? LOAN : '#fff', weight: sel || followed || e.loan ? 2.5 : 1.5, fillColor: e.gender === 'G' ? GIRL : BOY, radius: sel || followed ? 6.5 : moving ? 5 : 4 });
    if (!engLayer.hasLayer(m)) m.addTo(engLayer);
    if (moving && e.to) L.polyline([[p.lat, p.lng], [e.to.loc.lat, e.to.loc.lng]], { color: e.loan ? LOAN : followed ? '#C8372D' : INK, weight: followed ? 2.5 : 1.5, dashArray: '4 5', opacity: followed ? .9 : .55, interactive: false }).addTo(lineLayer);
  }
  for (const [id, m] of engM) if (!seen.has(id)) engLayer.removeLayer(m);
}
function engTip(e) {
  const s = e.task ? A.sim.sites.get(e.task.siteId) : null;
  return `<b>${e.id}</b>, ${gLabel(e.gender) === 'F' ? 'female' : 'male'} ${e.kind} engineer<br>${e.state === 'travel' && s ? `Driving to ${esc(s.name)}, arrives ${fmtT(e.t1)}` : e.state === 'travel' ? `Returning, arrives ${fmtT(e.t1)}` : s ? `${e.state} at ${esc(s.name)}` : e.state}${e.loan ? '<br>On loan' : ''}`;
}
export function siteStyles() {
  for (const s of A.sim.sites.values()) {
    const m = siteM.get(s.id), vis = A.match(s), st = s.status;
    m.setStyle({ fillColor: MAPCOL[st], fillOpacity: vis ? (st === 'good' ? .75 : .95) : .06, opacity: vis ? 1 : .12, weight: st === 'good' ? 1.1 : 2.4, radius: radius(s) + (st === 'critical' ? 2 : 0) });
    if (vis && st !== 'good') m.bringToFront();
  }
}
export function pulse(s) { if (!A.match(s) || map.getZoom() < 9 || matchMedia('(prefers-reduced-motion: reduce)').matches) return; const m = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: '<div class="pulse"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false, keyboard: false }).addTo(pulseLayer); setTimeout(() => pulseLayer.removeLayer(m), 1150); }

// ---------- selection & drawer
export function selectSite(id, fly = true) {
  A.ui.sel = id ? { type: 'site', id } : null; A.ui.cands = null; selLayer.clearLayers();
  if (!id) { $('#drawer').classList.add('hidden'); flyToZone(A.ui.zone); return; }
  if (A.ui.view !== 'ops') A.go('ops');
  const s = A.sim.sites.get(id); L.circleMarker([s.lat, s.lng], { radius: radius(s) + 7, color: INK, weight: 2.5, fill: false, interactive: false }).addTo(selLayer);
  if (fly) map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 11), { duration: .5 });
  drawer(true); $('#drawer .x')?.focus();
}
export function selectEng(id) {
  A.ui.sel = { type: 'eng', id }; A.ui.cands = null; selLayer.clearLayers(); if (A.ui.view !== 'ops') A.go('ops');
  const e = A.sim.engs.get(id), p = A.sim.posAt(e, A.sim.tf); map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 11), { duration: .5 }); drawer(true); $('#drawer .x')?.focus();
}
export function drawer(force) {
  const d = $('#drawer'); if (!A.ui.sel) return d.classList.add('hidden');
  if (!force && d.contains(document.activeElement) && document.activeElement !== d) return; // don't rebuild under the keyboard
  d.classList.remove('hidden');
  d.innerHTML = A.ui.sel.type === 'site' ? siteHtml(A.sim.sites.get(A.ui.sel.id)) : engHtml(A.sim.engs.get(A.ui.sel.id));
  wireDrawer(d);
}
const stageText = { triage: 'Service desk triage', remote: 'Fixing remotely', queue: 'Waiting for an engineer', enroute: 'Engineer driving', checkin: 'Gate check-in', work: 'Engineer working', parts: 'Waiting for parts', vendor: 'With vendor', linked: 'Linked to incident', closed: 'Closed' };
function siteHtml(s) {
  const sim = A.sim, t = sim.t, st = sim.siteStats(s, A.ui.period), hub = sim.zones[s.zone].hub;
  const off = A.travel.get(hub, s.loc, sim.day * 1440 + 620, s.zone, s.zone, { rural: s.rural }), pk = A.travel.get(hub, s.loc, sim.day * 1440 + 450, s.zone, s.zone, { rural: s.rural });
  const open = s.tickets.filter(k => k.stage !== 'linked').sort((a, b) => a.dueResp - b.dueResp);
  const fol = A.ui.follow && (s.tickets.find(k => k.id === A.ui.follow) || s.closed.find(k => k.id === A.ui.follow));
  const plabel = { today: 'today', week: 'in 5 days', all: 'all days' }[A.ui.period];
  return `<button class="x" data-a="close" aria-label="Close">✕</button>
  <h4>${esc(s.name)}</h4><div class="ar" lang="ar">${esc(s.nameAr)}</div>
  ${genderTag(s)}<span class="tag">${esc(s.zone)} ${esc(sim.zones[s.zone].name)}</span><span class="tag">${esc(s.size)}</span><span class="tag">${esc(s.model)}</span><span class="tag ${s.status}">Health ${s.health}</span>
  <div class="rule">${esc(ruleText(s))}. ${s.users.toLocaleString()} supported users${s.cycle ? `, ${esc(s.cycle.replace(/ /g, ', '))}` : ''}${s.built ? `, building from ${s.built}` : ''}${s.rural ? ', rural' : ''}${s.approx ? '. Location approximate' : ''}.</div>
  ${s.conflict ? `<div class="rule" style="background:#C8372D14;color:#8f1f17">Source conflict: ${esc(s.conflict)}</div>` : s.register === 'Co Edu' ? `<div class="empty">Co-educational in the Al Manhal register; the allocation workbook assigns it to ${s.gender === 'B' ? "boys'" : "girls'"} coverage.</div>` : ''}
  ${s.why.length ? `<div>${s.why.map(w => `<span class="chip red">${esc(w)}</span>`).join('')}</div>` : ''}
  <div class="mini"><div><small>Logged ${plabel}</small><b>${st.recv}</b></div><div><small>Field visits</small><b>${st.field}</b></div><div><small>On site in time</small><b>${pct(st.respN ? st.respMet / st.respN * 100 : null)}</b></div><div><small>Resolved in time</small><b>${pct(st.resN ? st.resMet / st.resN * 100 : null)}</b></div></div>
  <div class="funnel"><div><b>${st.recv}</b>logged</div><div><b>${st.remote}</b>fixed remotely</div><div><b>${st.field}</b>sent to field</div><div><b>${st.parts}</b>needed parts</div><div><b>${st.vendor}</b>to vendor</div></div>
  ${fol ? followHtml(fol) : ''}
  <h5>Open tickets (${open.length})</h5>
  ${open.length ? `<table class="tbl"><tbody>${open.slice(0, 10).map(k => { const due = k.respondedAt == null && k.field ? k.dueResp : k.dueRes, left = t < due ? bizBetween(t, due) : -bizBetween(due, t);
    return `<tr data-follow="${k.id}" tabindex="0" title="Follow this ticket"><td>#${k.id}</td><td>${k.pr}</td><td>${esc(CAT[k.cat].name)}</td><td>${esc(stageText[k.stage])}${k.engId ? ` <small>${k.engId}</small>` : ''}</td><td class="n" style="color:${left < 0 ? COL.critical : left < 30 ? COL.watch : 'inherit'}">${left < 0 ? fmtDur(-left) + ' late' : fmtDur(left) + ' left'}</td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">Nothing open. Select a ticket row to follow it end to end.</div>'}
  <h5>Engineers covering this school</h5>
  ${s.serv.length ? `<table class="tbl"><tbody>${s.serv.slice(0, 8).map(e => { const here = e.at === s.id && e.state !== 'travel', toHere = e.state === 'travel' && e.to?.siteId === s.id, est = here || toHere ? null : A.travel.get(sim.pos(e, t), s.loc, t, e.zone, s.zone, { rural: s.rural });
    return `<tr data-eng="${e.id}" tabindex="0"><td>${e.id} <span class="tag ${e.gender === 'G' ? 'g' : 'b'}">${gLabel(e.gender)}</span></td><td>${e.loan ? 'on loan' : e.cover ? 'covering today' : e.kind}</td><td>${e.absent ? 'absent' : e.state}</td><td class="n">${e.absent ? '' : here ? 'on site' : toHere ? 'arrives ' + fmtT(e.t1) : est.min + ' min away'}</td></tr>`; }).join('')}</tbody></table>${s.serv.length > 8 ? `<div class="empty">and ${s.serv.length - 8} more in the zone pool</div>` : ''}` : '<div class="empty">No engineer assigned today.</div>'}
  <div class="trip">From the ${s.zone} hub: ${off.km} km, ${off.min} min off-peak, ${pk.min} min in the school-run peak (${src(off)}).</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="primary" data-a="find">Find nearest engineer</button><button data-a="p1">Log a P1 ticket here</button></div>
  <div id="cands">${A.ui.cands ? candsHtml(s) : ''}</div>`;
}
const src = est => est.src === 'google' ? 'Google Maps' : 'road model';
function followHtml(k) {
  const sim = A.sim, e = k.engId ? sim.engs.get(k.engId) : null, steps = [];
  steps.push(['done', `Logged ${fmtT(k.created)} (${k.pr}, ${CAT[k.cat].name})`]);
  if (k.stage === 'triage') steps.push(['now', `Service desk triage, decision by ${fmtT(k.triageEnd)}`]);
  else if (!k.field) steps.push([k.stage === 'closed' ? 'done' : 'now', k.stage === 'closed' ? `Fixed remotely at ${fmtT(k.resolvedAt)}` : `Desk fixing remotely, expected ${fmtT(k.remoteEnd)}`]);
  else {
    steps.push(['done', `Sent to field at ${fmtT(k.queuedAt)}. On-site target ${fmtT(k.dueResp)}`]);
    if (k.stage === 'queue') steps.push(['now', 'Waiting for the nearest free engineer']);
    if (k.assignedAt != null) steps.push(['done', `${k.engId} assigned at ${fmtT(k.assignedAt)}${k.trip ? `: ${k.trip.km} km, ${k.trip.drive} min drive (${k.trip.label}) + ${k.trip.overhead} min parking` : ', already on site'}`]);
    if (k.stage === 'enroute') steps.push(['now', `Driving, at the gate about ${fmtT(e.t1)}`]);
    if (k.stage === 'checkin') steps.push(['now', `Gate check-in until ${fmtT(e.t1)}`]);
    if (k.respondedAt != null) steps.push([k.respondedAt <= k.dueResp ? 'done' : 'late', `On site and working at ${fmtT(k.respondedAt)} (${k.respondedAt <= k.dueResp ? 'within' : 'missed'} target)`]);
    if (k.stage === 'work') steps.push(['now', `Repair under way, about ${fmtDur(k.svc)}`]);
    if (k.stage === 'parts') steps.push(['now', `Waiting for parts, revisit after ${fmtT(k.readyAt)}`]);
    if (k.stage === 'vendor') steps.push(['now', `${k.incident ? 'ISP restoring the link' : 'With the vendor'}, expected ${fmtT(k.vendorAt)}`]);
    if (k.stage === 'closed') steps.push(['done', `Closed at ${fmtT(k.resolvedAt)} (${k.how})`]);
  }
  return `<h5>Following ticket #${k.id} <button class="link" data-a="unfollow">stop</button></h5><ol class="steps">${steps.map(([c, x]) => `<li class="${c}">${esc(x)}</li>`).join('')}</ol>`;
}
function candsHtml(s) {
  const c = A.ui.cands, ex = c.ex;
  return `<h5>Nearest eligible engineers</h5><div class="empty">Same zone and neighbouring zones only, within ${P.maxLoanEta} min. Excluded: ${ex.gender} by the gender rule, ${ex.zone} in distant zones, ${ex.far} more than ${P.maxLoanEta} min away, ${ex.busy} busy, covering or protected.</div>
  ${c.length ? `<table class="tbl"><tbody>${c.slice(0, 6).map(x => `<tr><td>${x.e.id} <small>${x.e.kind}</small></td><td>${esc(x.where)}${x.cross ? ' <span class="chip">neighbouring zone</span>' : ''}<br><small>${esc(x.impact || '')}</small></td><td class="n" title="${x.est.km} km, ${x.est.drive} min drive (${x.est.label}), ${x.est.overhead} min parking, ${P.checkin} min check-in">${x.eta} min</td><td><button data-send="${x.e.id}">Send</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nobody eligible is close enough. This school would be escalated to the zone lead.</div>'}
  ${ex.nearestBarred ? `<div class="empty">Rule check: ${ex.nearestBarred.id} is free and ${ex.nearestBarred.min} min away but is barred by the gender rule. <button class="link" data-send="${ex.nearestBarred.id}">Try sending anyway</button></div>` : ''}`;
}
function engHtml(e) {
  const sim = A.sim, t = sim.t, home = sim.sites.get(e.home), task = e.task, ts = task ? sim.sites.get(task.siteId) : null;
  const w = shiftWindow(sim.day), span = w ? w[1] - w[0] : 480, x = v => ((v - (w ? w[0] : 0)) / span * 100).toFixed(2);
  const segC = { travel: INK, return: '#B9C6D8', checkin: LOAN, work: COL.good, notes: '#9AA8BC', break: '#D5DCD6' };
  return `<button class="x" data-a="close" aria-label="Close">✕</button><h4>${e.id}</h4>
  <span class="tag ${e.gender === 'G' ? 'g' : 'b'}">${e.gender === 'G' ? 'Female' : 'Male'}</span><span class="tag">${e.kind === 'nspool' ? 'non-school pool' : e.kind}</span><span class="tag">${e.zone} ${esc(sim.zones[e.zone].name)}</span>${e.loan ? '<span class="tag watch">on loan</span>' : ''}${e.cover ? '<span class="tag">covering today</span>' : ''}
  <div class="rule">${e.absent ? `Not on duty today (${e.absent}).` : task ? `${e.state === 'travel' ? `Driving to ${esc(ts.name)}, arrives ${fmtT(e.t1)}` : `${e.state === 'checkin' ? 'Checking in at' : 'Working at'} ${esc(ts.name)} on ticket #${task.id} (${CAT[task.cat].name})`}.` : e.state === 'travel' ? `Driving back to ${e.to?.siteId ? esc(sim.sites.get(e.to.siteId).name) : 'the hub'}, arrives ${fmtT(e.t1)}.` : e.state === 'pm' ? `Preventive classroom checks at ${esc(home.name)}.` : e.state === 'break' ? 'On lunch and prayer break.' : e.state === 'off' ? 'Off shift.' : `Available${e.at ? ' at ' + esc(sim.sites.get(e.at).name) : ' at the ' + e.zone + ' hub'}.`}</div>
  <div class="mini"><div><small>Jobs today</small><b>${e.jobsToday}</b></div><div><small>Busy so far</small><b>${Math.round(sim.util(e) * 100)}%</b></div><div><small>Driving today</small><b>${fmtDur(e.segs.filter(g => g.k === 'travel' && g.t0 <= t).reduce((a, g) => a + Math.min(g.t1, t) - g.t0, 0))}</b></div><div><small>Covers</small><b>${(e.cover || e.covers).length}</b></div></div>
  <h5>Today</h5><div style="position:relative;height:16px;background:var(--paper2);border-radius:3px;overflow:hidden">${e.segs.map(g => `<i title="${g.k} ${fmtT(g.t0)}–${fmtT(g.t1)}" style="position:absolute;left:${x(g.t0)}%;width:${Math.max(.4, x(g.t1) - x(g.t0))}%;top:0;bottom:0;background:${segC[g.k]}"></i>`).join('')}<i style="position:absolute;left:${x(t)}%;top:0;bottom:0;width:2px;background:var(--critical)"></i></div>
  <div class="lg"><span><i style="background:${INK}"></i>Driving</span><span><i style="background:${LOAN}"></i>Check-in</span><span><i style="background:${COL.good}"></i>Working</span><span><i style="background:#9AA8BC"></i>Notes</span><span><i style="background:#B9C6D8"></i>Returning</span></div>
  <h5>Assigned schools</h5><div>${(e.loan ? [e.loan.siteId] : e.cover || e.covers).slice(0, 12).map(id => `<button class="link" data-site="${id}">${esc(sim.sites.get(id).name)}</button>`).join(', ')}${(e.cover || e.covers).length > 12 ? ` and ${(e.cover || e.covers).length - 12} more` : ''}</div>
  ${!e.absent && e.state !== 'off' ? `<div style="margin-top:10px"><button data-a="sick">Send home sick</button></div>` : ''}`;
}
function wireDrawer(d) {
  d.onkeydown = ev => { if (ev.key === 'Escape') selectSite(null); if (ev.key === 'Enter' && ev.target.matches('tr[tabindex]')) ev.target.click(); };
  d.onclick = ev => {
    const b = ev.target.closest('[data-a],[data-follow],[data-eng],[data-send],[data-site]'); if (!b) return;
    const sim = A.sim, sel = A.ui.sel;
    if (b.dataset.a === 'close') return selectSite(null);
    if (b.dataset.a === 'unfollow') { A.ui.follow = null; return drawer(true); }
    if (b.dataset.follow) { A.ui.follow = +b.dataset.follow; return drawer(true); }
    if (b.dataset.eng) return selectEng(b.dataset.eng);
    if (b.dataset.site) return selectSite(b.dataset.site);
    if (b.dataset.a === 'find') { const s = sim.sites.get(sel.id); A.ui.cands = sim.candidates(s, sim.t); return drawer(true); }
    if (b.dataset.a === 'p1') { const w = shiftWindow(sim.day); if (!w || sim.t < w[0] || sim.t >= w[1]) { toast('Tickets can be logged during the school day. Press Play first.', false); return; } const s = sim.sites.get(sel.id); const k = sim.newTicket(s, sim.t, 'display', { pr: 'P1', forceField: true }); A.ui.follow = k.id; toast(`Ticket #${k.id} logged at ${s.name}. Following it.`, true); return drawer(true); }
    if (b.dataset.a === 'sick') { sim.sendHome(sim.engs.get(sel.id), 'was sent home by the operator'); return drawer(true); }
    if (b.dataset.send) { const s = sim.sites.get(sel.id), e = sim.engs.get(b.dataset.send);
      const r = sim.applyLoan(e, s, sim.t, { manual: true, auto: false, cands: A.ui.cands || [], why: `Operator sent ${e.id} to ${s.name}.` });
      if (!r.ok) toast(`Blocked: ${r.reason}`, false); else { toast(r.moving ? `${e.id} is driving to ${s.name}, on site about ${fmtT(r.arrives)}` : `${e.id} will go to ${s.name} after the current job`, true); A.ui.cands = null; } return drawer(true); }
  };
}

// ---------- strip, figures, side lists
const BELLS = [[420, 465, 'Arrival'], [465, 510, 'P1'], [510, 555, 'P2'], [555, 600, 'P3'], [600, 630, 'Break'], [630, 675, 'P4'], [675, 720, 'P5'], [720, 765, 'P6'], [765, 810, 'Lunch'], [810, 855, 'P7'], [855, 900, 'P8']];
export function strip() {
  const c = $('#cStrip'), r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1; if (!r.width) return;
  c.width = r.width * dpr; c.height = r.height * dpr; const g = c.getContext('2d'); g.scale(dpr, dpr);
  const W = r.width, H = r.height, top = 18, bot = 18, ph = H - top - bot, x = m => (m - 420) / 480 * W, sim = A.sim, fri = weekday(sim.day) === 4;
  g.font = '500 11px "IBM Plex Sans", system-ui'; g.textAlign = 'center';
  BELLS.forEach(([a, b, l], i) => {
    const off = fri && a >= 720, brk = l === 'Break' || l === 'Lunch';
    g.fillStyle = off ? '#EEF0EE' : brk ? '#FFF4C2' : i % 2 ? '#F6F8F6' : '#fff'; g.fillRect(x(a), top, x(b) - x(a), ph + bot);
    g.fillStyle = '#5B6B82'; g.fillText(off ? '' : l, (x(a) + x(b)) / 2, H - 5);
    g.strokeStyle = '#E3E8E4'; g.beginPath(); g.moveTo(x(a), top); g.lineTo(x(a), H - bot); g.stroke();
  });
  if (fri) { g.fillStyle = '#5B6B82'; g.fillText('Friday: school closes 11:30, shift ends 12:00', (x(720) + W) / 2, top + ph / 2); }
  const mx = Math.max(25, ...sim.hist.map(h => h.desk)), bw = x(425) - x(420);
  for (const h of sim.hist) {
    const x0 = x(h.m - 5) + .5, dh = h.desk / mx * ph, fh = h.field / mx * ph, lh = Math.min(h.late, h.field) / mx * ph;
    g.fillStyle = '#C9D3E2'; g.fillRect(x0, top + ph - dh, bw - 1, dh);
    g.fillStyle = '#5F7699'; g.fillRect(x0, top + ph - fh, bw - 1, fh - lh);
    g.fillStyle = '#C8372D'; g.fillRect(x0, top + ph - lh, bw - 1, lh);
  }
  const rs = sim.hist.filter(h => h.resp != null);
  if (rs.length > 1) { g.strokeStyle = '#1F7A4D'; g.lineWidth = 2; g.beginPath(); rs.forEach((h, i) => { const X = x(h.m - 2.5), Y = top + (1 - Math.max(0, h.resp - 70) / 30) * ph; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke(); g.lineWidth = 1; }
  const m = mod(sim.tf); if (m >= 420 && m <= 900) { const nx = x(m); g.strokeStyle = '#C8372D'; g.lineWidth = 2; g.beginPath(); g.moveTo(nx, 2); g.lineTo(nx, H - bot); g.stroke(); g.lineWidth = 1; }
  g.textAlign = 'left'; g.fillStyle = '#34445F'; g.font = '11.5px "IBM Plex Sans", system-ui';
  const k = sim.kpis('today'); c.setAttribute('aria-label', `Today so far: ${k.recv} tickets logged, ${k.field} sent to field, ${k.respPct == null ? 'no visits yet' : Math.round(k.respPct) + '% of engineers on site within target'}.`);
  g.fillText(`Tickets every 5 min: light = logged at the desk, dark = sent to field, red = engineer arrived late. Green line: on-site within target (70–100%). Peak ${mx}.`, 6, 13);
}
export function figures() {
  const sim = A.sim, k = sim.kpis(A.ui.period, A.match), days = A.ui.period === 'today' ? 1 : Math.max(1, sim.siteStats([...sim.sites.values()][0], A.ui.period).days);
  const nSites = [...sim.sites.values()].filter(A.match).length;
  const f = (label, val, sub, cls = '') => `<div class="kpi ${cls}"><small>${label}</small><b>${val}</b><span>${sub}</span></div>`;
  $('#kpis').innerHTML =
    f('Tickets logged', num(k.recv), A.ui.period === 'today' ? `${(k.recv / nSites).toFixed(1)} per school so far today` : `${(k.recv / nSites / days).toFixed(1)} per school a day`) +
    f('Sent to field', num(k.field), `${pct(k.remotePct)} fixed remotely`) +
    f('On site in time', pct(k.respPct, 1), `${num(k.respMet)} of ${num(k.respN)} visits`, k.respPct == null ? '' : k.respPct >= 95 ? 'good' : k.respPct >= 85 ? 'warn' : 'bad') +
    f('Resolved in time', pct(k.resPct, 1), `${num(k.resN)} closed, ${num(k.resN - k.remote)} after a visit`, k.resPct == null ? '' : k.resPct >= 95 ? 'good' : k.resPct >= 85 ? 'warn' : 'bad') +
    f(A.ui.period === 'today' ? 'Logged to on site' : 'Logged to on site, avg', k.onsiteMed == null ? '–' : fmtDur(k.onsiteMed), A.ui.period === 'today' ? 'median, business time' : 'business time') +
    f('Not yet on site', k.waiting, `${k.queued} queued, ${k.waiting - k.queued} en route, ${k.aged} late`, k.aged ? 'bad' : '') +
    f('Engineers on duty', k.onDuty, `${k.absent} absent today`) +
    f('On the road', k.onRoad, `${k.loans} on loan${k.pending ? `, ${k.pending} need approval` : ''}`) +
    f('Gender-rule breaches', k.violations, 'every move is checked', k.violations ? 'bad' : 'good');
}
export function side() {
  const sim = A.sim, t = sim.t;
  const att = [...sim.sites.values()].filter(s => A.match(s) && (s.health < 80 || s.uncovered) && (s.waiting || s.uncovered)).sort((a, b) => a.health - b.health);
  $('#attN').textContent = att.length ? `${att.length} schools` : '';
  $('#attention').innerHTML = att.slice(0, 7).map(s => `<div class="att" data-site="${s.id}" tabindex="0"><span class="hs" style="background:${COL[s.status]}">${s.health}</span><div><b>${esc(s.name)}</b> <span class="z">${s.zone}, ${s.gender === 'B' ? 'boys' : s.gender === 'G' ? 'girls' : 'non-school'}</span><div>${s.why.map(w => `<span class="chip red">${esc(w)}</span>`).join('')}</div></div><span class="z">${s.waiting} waiting</span></div>`).join('') || '<div class="empty">Every school is within target right now.</div>';
  const road = [...sim.engs.values()].filter(e => e.state === 'travel' && e.task && (!A.ui.zone || e.zone === A.ui.zone)).sort((a, b) => a.t1 - b.t1);
  $('#roadN').textContent = road.length ? `${road.length} driving to a job` : '';
  $('#road').innerHTML = road.slice(0, 6).map(e => { const s = sim.sites.get(e.task.siteId), f = (sim.tf - e.t0) / Math.max(1, e.t1 - e.t0);
    return `<div class="road ${e.loan ? 'loan' : ''}" data-eng="${e.id}" tabindex="0"><b>${e.id}</b> to ${esc(s.name)} <small>arrives ${fmtT(e.t1)}, ${Math.max(0, Math.round(e.t1 - sim.tf))} min left of ${e.t1 - e.t0}</small><div class="p"><i style="width:${Math.min(100, f * 100)}%"></i></div></div>`; }).join('') || '<div class="empty">No engineer is driving to a job right now.</div>';
  const ap = sim.approvals.filter(a => a.state === 'pending');
  $('#approvalsMini').innerHTML = ap.map(a => apprHtml(a)).join('') || '<div class="empty">Nothing waiting. Cross-zone moves appear here for approval.</div>';
  const all = A.ui.feedAll, feed = sim.feed.filter(f => (all || !['logged', 'remote', 'dispatch'].includes(f.k)) && f.k !== 'dispatch' && A.match(f.s)).slice(-14).reverse();
  $('#feed').innerHTML = feed.map(feedLine).join('') || '<div class="empty">The feed starts when the desk opens at 07:00.</div>';
}
export function apprHtml(a) {
  const sim = A.sim, s = sim.sites.get(a.siteId), e = sim.engs.get(a.engId), left = Math.max(0, a.autoAt - sim.t);
  return `<div class="appr"><b>${e.id}</b> (${e.zone}) to <b>${esc(s.name)}</b> (${s.zone}), ${a.eta} min<br><small>${esc(a.why)}</small><div class="row"><button class="primary" data-ap="${a.id}" data-ok="1">Approve</button><button data-ap="${a.id}" data-ok="0">Reject</button><small>${P.autoApprove ? `auto-approves in ${left} min` : 'waiting for you'}</small></div></div>`;
}
const feedLine = f => {
  const s = esc(f.s.name.length > 34 ? f.s.name.slice(0, 33) + '…' : f.s.name), k = f.tk;
  const T = { assigned: () => `${f.e.id} dispatched to ${s}, ${f.eta} min away (${k.pr} ${CAT[k.cat].name.toLowerCase()})`, onsite: () => `✓ ${f.e.id} on site at ${s} after ${fmtDur(f.biz)} (target ${fmtDur(SLA[k.pr].resp)})`, late: () => `✗ ${f.e.id} reached ${s} after ${fmtDur(f.biz)}, target was ${fmtDur(SLA[k.pr].resp)}`,
    logged: () => `#${k.id} ${k.pr} ${CAT[k.cat].name.toLowerCase()} logged at ${s}`, remote: () => `#${k.id} fixed remotely by the service desk (${s})`, preempt: () => `${f.e.id} paused a ${f.old.pr} job at ${s} to take P1 #${k.id}`,
    parts: () => `${s}: waiting for parts (#${k.id})`, vendor: () => `${s}: handed to vendor (#${k.id})`, isp: () => `${s}: ISP restoring the link`, closed: () => `${s}: #${k.id} resolved (${f.how})` }, txt = T[f.k] ? T[f.k]() : '';
  return `<div class="f-${f.k}" data-site="${f.s.id}" tabindex="0"><span class="t">${fmtT(f.t)}</span>${txt}</div>`;
};
export function wireSide() {
  $('.side').onclick = ev => {
    const ap = ev.target.closest('[data-ap]'); if (ap) { const r = A.sim.decide(+ap.dataset.ap, ap.dataset.ok === '1'); toast(r.ok ? (ap.dataset.ok === '1' ? 'Move approved' : 'Move rejected') : r.reason, r.ok); return; }
    const e = ev.target.closest('[data-eng]'); if (e) return selectEng(e.dataset.eng);
    const s = ev.target.closest('[data-site]'); if (s) return selectSite(s.dataset.site);
  };
  $('.side').onkeydown = ev => { if (ev.key === 'Enter') { const e = ev.target.closest('[data-eng]'); if (e) return selectEng(e.dataset.eng); const s = ev.target.closest('[data-site]'); if (s) selectSite(s.dataset.site); } };
  $('#feedSeg').onclick = ev => { const b = ev.target.closest('[data-f]'); if (!b) return; A.ui.feedAll = b.dataset.f === 'all'; $$('#feedSeg button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); side(); };
}
function showEod(d) {
  const el = $('#eod'), sim = A.sim;
  el.classList.remove('hidden');
  el.innerHTML = `<button class="x" style="position:absolute;right:8px;top:6px;border:0;background:none" data-a="x" aria-label="Close">✕</button><h4>Day closed: ${esc(A.fmtDate(d.d))}</h4>
  <div class="mini"><div><small>Logged</small><b>${d.recv}</b></div><div><small>Field visits</small><b>${d.field}</b></div><div><small>On site in time</small><b>${pct(d.respN ? d.respMet / d.respN * 100 : null)}</b></div><div><small>Loans</small><b>${d.loans}</b></div></div>
  <div id="eodAi" class="empty">Select "Brief me" for an AI summary of the day.</div><div style="display:flex;gap:6px;margin-top:8px"><button class="primary" data-a="brief">Brief me</button><button data-a="x">Close</button></div>`;
  el.onclick = ev => { const b = ev.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'x') el.classList.add('hidden'); if (b.dataset.a === 'brief') A.brief($('#eodAi'), d); };
}
