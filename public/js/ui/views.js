// Schools scorecard, Engineers roster, Planning, Model assumptions.
import { $, $$, esc, COL, INK, LOAN, pct, num, genderTag, hbar, spark, toast, download } from './util.js';
import { P, SLA, CATS, CAT, REGION, fmtT, fmtDur, shiftWindow, weekday, dayOf as dayOfT } from '../model.js';
import { eligible, gLabel, ADJ } from '../engine.js';
import { selectSite, selectEng } from './ops.js';

let A; export function initViews(app) { A = app; }

// ---------------- Schools
const sch = { q: '', status: '', model: '', sort: ['health', 1], limit: 150 };
export function schools(force) {
  const el = $('#v-schools'), sim = A.sim, per = A.ui.period;
  if (!el.dataset.init) {
    el.dataset.init = 1;
    el.innerHTML = `<div class="panel"><h2>Schools</h2><p class="sub">Every school and non-school site with its ticket volume and service performance for the selected period. Health is live. Select a row to open it on the map.</p>
    <div class="toolbar"><input type="search" id="sQ" placeholder="Search by school name, Arabic name or number" aria-label="Search schools">
    <select id="sSt" aria-label="Health"><option value="">Any health</option><option value="attn">Needs attention (below 80)</option><option value="critical">Critical</option></select>
    <select id="sMo" aria-label="Coverage model"><option value="">Any coverage model</option><option>Dedicated - 2 engineers</option><option>Dedicated - 1 engineer</option><option>Shared - paired</option><option>Zone pool</option></select>
    <button id="sCsv">Download CSV</button><span id="sN" class="empty"></span></div><div class="scroll" id="sT"></div></div>`;
    $('#sQ').oninput = e => { sch.q = e.target.value.toLowerCase(); schools(true); };
    $('#sSt').onchange = e => { sch.status = e.target.value; schools(true); };
    $('#sMo').onchange = e => { sch.model = e.target.value; schools(true); };
    $('#sCsv').onclick = () => download(`moe-schools-${per}.csv`, csv(rows()));
    $('#sT').onkeydown = ev => { if (ev.key === 'Enter' && ev.target.matches('tr[data-id]')) selectSite(ev.target.dataset.id); };
    $('#sT').onclick = ev => { const th = ev.target.closest('th[data-k]'); if (th) { const k = th.dataset.k; sch.sort = [k, sch.sort[0] === k ? -sch.sort[1] : (k === 'name' || k === 'zone' ? 1 : -1)]; return schools(true); }
      const more = ev.target.closest('[data-more]'); if (more) { sch.limit += 200; return schools(true); }
      const tr = ev.target.closest('tr[data-id]'); if (tr) selectSite(tr.dataset.id); };
  }
  if (!force && document.activeElement && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const list = rows(); $('#sN').textContent = `${list.length} sites`;
  const H = [['name', 'School'], ['zone', 'Zone'], ['', 'Rule'], ['model', 'Coverage'], ['recv', 'Logged'], ['field', 'Field'], ['remote', 'Fixed remotely'], ['resp', 'On site in time'], ['res', 'Resolved in time'], ['onsite', 'Avg to on site'], ['waiting', 'Waiting'], ['health', 'Health'], ['', 'On time by day']];
  const [k, dir] = sch.sort;
  $('#sT').innerHTML = `<table class="tbl"><thead><tr>${H.map(([c, l]) => `<th ${c ? `data-k="${c}"` : ''} ${c && c !== 'name' && c !== 'zone' && c !== 'model' ? 'class="n"' : ''}>${l}${k === c ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${list.slice(0, sch.limit).map(r => `<tr data-id="${r.s.id}" tabindex="0"><td><b>${esc(r.s.name)}</b><span class="ar" lang="ar">${esc(r.s.nameAr)}</span></td><td>${r.s.zone}</td><td>${genderTag(r.s)}</td><td><small>${esc(r.s.model)}</small></td><td class="n">${r.recv}</td><td class="n">${r.field}</td><td class="n">${pct(r.remote)}</td><td class="n" style="color:${r.resp != null && r.n >= 3 && r.resp < 85 ? COL.critical : 'inherit'}">${r.n >= 3 ? pct(r.resp) : r.n ? `${r.met} of ${r.n}` : '–'}</td><td class="n">${r.rn >= 3 ? pct(r.res) : r.rn ? `${r.rm} of ${r.rn}` : '–'}</td><td class="n">${r.onsite == null ? '–' : fmtDur(r.onsite)}</td><td class="n">${r.s.waiting || ''}</td><td>${hbar(r.s.health)}</td><td>${spark(r.trend)}</td></tr>`).join('')}</tbody></table>${list.length > sch.limit ? `<button data-more style="margin:8px 0">Show ${Math.min(200, list.length - sch.limit)} more</button>` : ''}`;
}
function rows() {
  const sim = A.sim, per = A.ui.period;
  let list = [...sim.sites.values()].filter(s => A.match(s) && (!sch.q || (s.name + ' ' + s.nameAr + ' ' + s.no).toLowerCase().includes(sch.q)) && (!sch.status || (sch.status === 'attn' ? s.health < 80 : s.status === 'critical')) && (!sch.model || s.model === sch.model))
    .map(s => { const x = sim.siteStats(s, per); return { s, recv: x.recv, field: x.field, remote: x.remote + x.field ? x.remote / (x.remote + x.field) * 100 : null, n: x.respN, met: x.respMet, rn: x.resN, rm: x.resMet, resp: x.respN ? x.respMet / x.respN * 100 : null, res: x.resN ? x.resMet / x.resN * 100 : null, onsite: x.respN ? x.sumResp / x.respN : null, trend: [...s.days.slice(-9), s.today].map(d => d.respN ? d.respMet / d.respN * 100 : null) }; });
  const [k, dir] = sch.sort, v = { name: r => r.s.name, zone: r => r.s.zone, model: r => r.s.model, recv: r => r.recv, field: r => r.field, remote: r => r.remote ?? -1, resp: r => r.resp ?? 101, res: r => r.res ?? 101, onsite: r => r.onsite ?? -1, waiting: r => r.s.waiting, health: r => r.s.health };
  return list.sort((a, b) => { const x = v[k](a), y = v[k](b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
}
const csv = list => ['school,arabic_name,number,zone,gender_rule,coverage,logged,field,fixed_remotely_pct,on_site_in_time_pct,resolved_in_time_pct,avg_to_on_site_min,waiting_now,health']
  .concat(list.map(r => [r.s.name, r.s.nameAr, r.s.no, r.s.zone, r.s.type !== 'school' ? 'any' : r.s.gender === 'B' ? 'male only' : 'female only', r.s.model, r.recv, r.field, r.remote?.toFixed(1) ?? '', r.resp?.toFixed(1) ?? '', r.res?.toFixed(1) ?? '', r.onsite?.toFixed(0) ?? '', r.s.waiting, r.s.health].map(x => `"${String(x).replace(/"/g, '""')}"`).join(','))).join('\n');

// ---------------- Engineers
const eng = { q: '', kind: '', sort: ['util', -1], hover: null };
export function engineers(force) {
  const el = $('#v-engs'), sim = A.sim;
  if (!el.dataset.init) {
    el.dataset.init = 1;
    el.innerHTML = `<div class="panel"><h2>Today's roster</h2><p class="sub" id="gSub"></p>
      <div class="lg"><span><i style="background:${INK}"></i>Driving</span><span><i style="background:#B9C6D8"></i>Returning to hub or home school</span><span><i style="background:${LOAN}"></i>Gate check-in</span><span><i style="background:${COL.good}"></i>Working on a ticket</span><span><i style="background:#9AA8BC"></i>Notes</span><span><i style="background:#D5DCD6"></i>Break</span><span><i style="background:#E3F1E8"></i>Preventive checks</span><span><i style="background:repeating-linear-gradient(45deg,#E7ECE8 0 3px,#fff 3px 6px)"></i>Absent</span></div>
      <div class="gantt-wrap" id="gWrap"><canvas id="gC" role="img"></canvas><div class="gtip hidden" id="gTip"></div></div></div>
      <div class="cols"><div class="panel"><h2>Engineers</h2><div class="toolbar"><input type="search" id="eQ" placeholder="Engineer ID" aria-label="Search engineers"><select id="eK" aria-label="Type"><option value="">All types</option><option value="dedicated">Dedicated</option><option value="pair">Paired</option><option value="pool">Zone pool</option><option value="nspool">Non-school pool</option></select><span id="eN" class="empty"></span></div><div class="scroll" id="eT"></div></div>
      <div class="panel"><h2>Drive time from hub</h2><p class="sub">Door-to-door from each engineer's zone hub to the schools they cover, averaged per engineer: road distance, traffic, parking. Gate check-in is extra.</p><div id="eH"></div></div></div>`;
    $('#eQ').oninput = e => { eng.q = e.target.value.toLowerCase(); engineers(true); };
    $('#eK').onchange = e => { eng.kind = e.target.value; engineers(true); };
    $('#eT').onkeydown = ev => { if (ev.key === 'Enter' && ev.target.matches('tr[data-id]')) selectEng(ev.target.dataset.id); };
    $('#eT').onclick = ev => { const th = ev.target.closest('th[data-k]'); if (th) { const k = th.dataset.k; eng.sort = [k, eng.sort[0] === k ? -eng.sort[1] : -1]; return engineers(true); } const tr = ev.target.closest('tr[data-id]'); if (tr) selectEng(tr.dataset.id); };
    const c = $('#gC'); c.onmousemove = ev => ganttHover(ev); c.onmouseleave = () => $('#gTip').classList.add('hidden'); c.onclick = ev => { const r = ganttRow(ev); if (r) selectEng(r.id); };
  }
  gantt();
  if (!force && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const list = engRows(); $('#eN').textContent = `${list.length} engineers`;
  const H = [['id', 'Engineer'], ['', 'Type'], ['', 'Now'], ['jobs', 'Jobs today'], ['util', 'Busy'], ['off', 'Hub to schools, off-peak'], ['peak', 'In peak'], ['', 'Covers']];
  const [k, dir] = eng.sort;
  $('#eT').innerHTML = `<table class="tbl"><thead><tr>${H.map(([c, l]) => `<th ${c ? `data-k="${c}"` : ''} class="${['jobs', 'util', 'off', 'peak'].includes(c) ? 'n' : ''}">${l}${k === c ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${list.slice(0, 120).map(r => `<tr data-id="${r.e.id}" tabindex="0"><td><b>${r.e.id}</b> <span class="tag ${r.e.gender === 'G' ? 'g' : 'b'}">${gLabel(r.e.gender)}</span></td><td>${r.e.kind === 'nspool' ? 'non-school pool' : r.e.kind}${r.e.loan ? ' <span class="chip">on loan</span>' : r.e.cover ? ' <span class="chip">covering</span>' : ''}</td><td>${r.e.absent ? `<span class="chip">${r.e.absent}</span>` : r.e.state}</td><td class="n">${r.e.jobsToday}</td><td class="n">${Math.round(r.util * 100)}%</td><td class="n">${r.off} min</td><td class="n">${r.peak} min</td><td><small>${esc(r.cov)}</small></td></tr>`).join('')}</tbody></table>`;
  driveHist();
}
const statsCache = new Map();
function hubStats(e) {
  const key = e.id + e.zone + (e.cover || e.covers).length; if (statsCache.has(key)) return statsCache.get(key);
  const sim = A.sim, list = (e.cover || e.covers).map(id => sim.sites.get(id)), d = sim.day * 1440;
  const off = list.reduce((a, s) => a + A.travel.get(e.hubLoc, s.loc, d + 620, e.zone, s.zone, { rural: s.rural }).min, 0) / list.length;
  const peak = list.reduce((a, s) => a + A.travel.get(e.hubLoc, s.loc, d + 450, e.zone, s.zone, { rural: s.rural }).min, 0) / list.length;
  const o = { off: Math.round(off), peak: Math.round(peak) }; statsCache.set(key, o); return o;
}
function engRows() {
  const sim = A.sim; const m = s => A.match(s);
  let list = [...sim.engs.values()].filter(e => (!A.ui.zone || e.zone === A.ui.zone) && (!eng.q || e.id.toLowerCase().includes(eng.q)) && (!eng.kind || e.kind === eng.kind) && (!A.ui.gender || (A.ui.gender === 'N' ? e.kind === 'nspool' : e.gender === A.ui.gender)))
    .map(e => { const h = hubStats(e), cov = e.cover || e.covers; return { e, util: sim.util(e), ...h, cov: e.kind === 'pool' || e.kind === 'nspool' ? `${cov.length} sites in the ${e.zone} pool` : cov.map(id => sim.sites.get(id).name).join(', ') }; });
  const [k, dir] = eng.sort, v = { id: r => r.e.id, jobs: r => r.e.jobsToday, util: r => r.util, off: r => r.off, peak: r => r.peak };
  return list.sort((a, b) => { const x = v[k](a), y = v[k](b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
}
let gRows = [];
function gantt() {
  const sim = A.sim, c = $('#gC'), w = shiftWindow(sim.day) || [sim.day * 1440 + 420, sim.day * 1440 + 900];
  const zone = A.ui.zone || 'Z01';
  $('#gSub').textContent = `${A.ui.zone ? '' : 'Showing zone Z01; pick a zone in the filter above. '}${sim.zones[zone].name}: each row is one engineer, ${fmtT(w[0])} to ${fmtT(w[1])}. The red line is now. Select a row to open the engineer.`;
  gRows = [...sim.engs.values()].filter(e => e.zone === zone && (!A.ui.gender || (A.ui.gender === 'N' ? e.kind === 'nspool' : e.gender === A.ui.gender))).sort((a, b) => (a.kind > b.kind ? 1 : a.kind < b.kind ? -1 : a.id > b.id ? 1 : -1));
  const rh = 17, lw = 150, top = 20, W = c.parentElement.clientWidth, H = top + gRows.length * rh + 6, dpr = devicePixelRatio || 1;
  c.style.height = H + 'px'; c.width = W * dpr; c.height = H * dpr; const g = c.getContext('2d'); g.scale(dpr, dpr);
  const x = t => lw + (t - w[0]) / (w[1] - w[0]) * (W - lw - 8);
  g.font = '11px "IBM Plex Sans", system-ui'; g.fillStyle = '#5B6B82';
  for (let h = Math.ceil(w[0] / 60) * 60; h <= w[1]; h += 60) { g.fillText(fmtT(h), x(h) - 14, 12); g.strokeStyle = '#E7ECE8'; g.beginPath(); g.moveTo(x(h), top - 4); g.lineTo(x(h), H); g.stroke(); }
  const col = { travel: INK, return: '#B9C6D8', checkin: LOAN, work: COL.good, notes: '#9AA8BC', break: '#D5DCD6' };
  gRows.forEach((e, i) => {
    const y = top + i * rh;
    if (i % 2) { g.fillStyle = '#F7F9F7'; g.fillRect(0, y, W, rh); }
    g.fillStyle = e.gender === 'G' ? '#A8306F' : '#2457A6'; g.fillRect(4, y + 4, 3, rh - 8);
    g.fillStyle = '#16233B'; g.fillText(`${e.id}  ${e.kind === 'nspool' ? 'ns-pool' : e.kind}${e.loan ? ' · loan' : e.cover ? ' · cover' : ''}`.replace(' · ', ', '), 12, y + 12);
    if (e.absent) { g.fillStyle = '#E7ECE8'; for (let xx = lw; xx < W - 8; xx += 6) g.fillRect(xx, y + 4, 3, rh - 8); g.fillStyle = '#5B6B82'; g.fillText(e.absent === 'leave' ? 'On annual leave' : 'Off sick', lw + 6, y + 12); return; }
    if ((e.kind === 'dedicated' || e.kind === 'pair') && sim.t > w[0]) { g.fillStyle = '#E3F1E8'; g.fillRect(x(w[0]), y + 5, x(Math.min(sim.t, w[1])) - x(w[0]), rh - 10); }
    for (const s of e.segs) { const a = x(Math.max(w[0], s.t0)), b = x(Math.min(w[1], s.t1)); g.fillStyle = col[s.k]; g.fillRect(a, y + 3, Math.max(1.5, b - a), rh - 6); }
  });
  const nx = x(Math.min(Math.max(sim.tf, w[0]), w[1])); g.strokeStyle = '#C8372D'; g.lineWidth = 2; g.beginPath(); g.moveTo(nx, top - 6); g.lineTo(nx, H); g.stroke();
  gantt.geo = { rh, top, lw, x, w, W };
  c.setAttribute('aria-label', `Roster for ${sim.zones[zone].name}: ${gRows.length} engineers, ${gRows.filter(e => e.absent).length} absent, ${gRows.reduce((a, e) => a + e.jobsToday, 0)} jobs done so far today.`);
}
function ganttRow(ev) { const g = gantt.geo; if (!g) return null; const r = ev.target.getBoundingClientRect(), y = ev.clientY - r.top; const i = Math.floor((y - g.top) / g.rh); return gRows[i] || null; }
function ganttHover(ev) {
  const e = ganttRow(ev), tip = $('#gTip'), g = gantt.geo; if (!e) return tip.classList.add('hidden');
  const r = ev.target.getBoundingClientRect(), px = ev.clientX - r.left, t = g.w[0] + (px - g.lw) / (g.W - g.lw - 8) * (g.w[1] - g.w[0]);
  const seg = e.segs.find(s => t >= s.t0 && t <= s.t1), sim = A.sim;
  const label = { return: 'Returning', travel: 'Driving to a job', checkin: 'Gate check-in', work: 'Working', notes: 'Writing up notes', break: 'Break' };
  tip.innerHTML = seg ? `${e.id}: ${label[seg.k]} ${fmtT(seg.t0)}–${fmtT(seg.t1)}${seg.siteId && seg.siteId !== 'hub' ? ' at ' + esc(sim.sites.get(seg.siteId)?.name || '') : seg.siteId === 'hub' ? ' back to hub' : ''}` : `${e.id}: ${e.absent ? 'absent' : e.kind === 'dedicated' || e.kind === 'pair' ? 'on site, preventive checks' : 'available'}`;
  tip.style.left = Math.min(px + 12, g.W - 260) + 'px'; tip.style.top = (ev.clientY - r.top + 12) + 'px'; tip.classList.remove('hidden');
}
function driveHist() {
  const sim = A.sim, bins = [15, 30, 45, 60, 90, 120, 9999], off = bins.map(() => 0), pk = bins.map(() => 0);
  const es = [...sim.engs.values()].filter(e => !A.ui.zone || e.zone === A.ui.zone);
  for (const e of es) { const h = hubStats(e); off[bins.findIndex(b => h.off <= b)]++; pk[bins.findIndex(b => h.peak <= b)]++; }
  const mx = Math.max(1, ...off, ...pk);
  const per = sim.net.zones.filter(z => !A.ui.zone || z.id === A.ui.zone).map(z => { const zs = es.filter(e => e.zone === z.id).map(hubStats); return { z, n: zs.length, off: zs.reduce((a, h) => a + h.off, 0) / Math.max(1, zs.length), peak: zs.reduce((a, h) => a + h.peak, 0) / Math.max(1, zs.length), max: Math.max(0, ...zs.map(h => h.peak)) }; });
  $('#eH').innerHTML = `<div class="lg"><span><i style="background:#B9C6D8"></i>Off-peak (10:20)</span><span><i style="background:${INK}"></i>School-run peak (07:30)</span></div>
  <div class="hist">${bins.map((b, i) => `<div title="${off[i]} off-peak, ${pk[i]} in peak"><i style="height:${off[i] / mx * 100}%;background:#B9C6D8"></i><i style="height:${pk[i] / mx * 100}%;background:${INK}"></i></div>`).join('')}</div>
  <div class="histx">${bins.map((b, i) => `<span>${b === 9999 ? 'over 2 h' : `up to ${b}`}</span>`).join('')}</div>
  <table class="tbl" style="margin-top:10px"><thead><tr><th>Zone</th><th class="n">Engineers</th><th class="n">Off-peak avg</th><th class="n">Peak avg</th><th class="n">Longest in peak</th><th>Hub</th></tr></thead><tbody>${per.map(p => `<tr><td>${p.z.id} ${esc(p.z.name)}</td><td class="n">${p.n}</td><td class="n">${Math.round(p.off)} min</td><td class="n">${Math.round(p.peak)} min</td><td class="n">${fmtDur(p.max)}</td><td><small>${esc(p.z.hub.name)}</small></td></tr>`).join('')}</tbody></table>
  <p class="empty">${A.travel.live ? 'Distances and free-flow times from Google Maps, cached.' : 'Google Routes is blocked on the key, so the calibrated road model is used. Hub positions are indicative because the workbook names hubs without coordinates.'}</p>`;
}

// ---------------- Planning
const plan = { f: 'moves' };
const FILT = { moves: ['allocate', 'manual', 'release', 'approval'], roster: ['roster', 'uncovered', 'absence'], esc: ['escalate'], inc: ['incident'], struct: ['review', 'structural'], all: null };
export function planning(force) {
  const el = $('#v-plan'), sim = A.sim;
  if (!el.dataset.init) {
    el.dataset.init = 1;
    el.innerHTML = `<div class="cols"><div class="panel"><h2>Decisions</h2><p class="sub">Every move the system made or proposed, with its reasons and the alternatives it rejected. Loans only come from the same zone or a neighbouring one.</p>
      <div class="filters" id="pF">${[['moves', 'Engineer moves'], ['roster', 'Morning roster'], ['esc', 'Escalations'], ['inc', 'Incidents'], ['struct', 'Weekly review'], ['all', 'Everything']].map(([k, l]) => `<button data-f="${k}" class="${k === plan.f ? 'on' : ''}">${l}</button>`).join('')}</div><div id="pL"></div></div>
      <div><div class="panel"><h2>Approvals</h2><p class="sub">Cross-zone moves wait for you. <label class="chk" style="display:inline-flex"><input type="checkbox" id="pAuto" ${P.autoApprove ? 'checked' : ''}> Auto-approve after ${P.autoApproveAfter} min</label></p><div id="pA"></div></div>
      <div class="panel"><h2>Pool utilisation</h2><p class="sub">Share of available time pool engineers spent driving, checking in and working, over the last 5 school days. Moves are only suggested within the same gender.</p><div id="pH"></div><div class="toolbar"><button id="pRun">Run weekly review now</button></div><div id="pR"></div></div>
      <div class="panel"><h2>Shared-school pairs</h2><p class="sub">176 medium schools share 92 engineers, two schools each. The workbook's pairing is indicative; this checks how far apart each pair is and re-pairs the nearest schools within the same zone and gender.</p><div id="pP"></div></div>
      <div class="panel"><h2>Female engineer capacity</h2><p class="sub">Girls' schools can only be served by female engineers. This is where the rule bites.</p><div id="pG"></div></div></div></div>`;
    $('#pF').onclick = ev => { const b = ev.target.closest('[data-f]'); if (!b) return; plan.f = b.dataset.f; $$('#pF button').forEach(x => x.classList.toggle('on', x === b)); planning(true); };
    $('#pAuto').onchange = e => { P.autoApprove = e.target.checked; };
    $('#pRun').onclick = () => { sim.weeklyReview(false); planning(true); toast(`${sim.recs.length} recommendation${sim.recs.length === 1 ? '' : 's'}`, true); };
    el.onclick = ev => {
      const x = ev.target.closest('[data-x]'); if (x) return A.explain(+x.dataset.x);
      const ap = ev.target.closest('[data-ap]'); if (ap) { const r = sim.decide(+ap.dataset.ap, ap.dataset.ok === '1'); toast(r.ok ? (ap.dataset.ok === '1' ? 'Move approved' : 'Move rejected') : r.reason, r.ok); return planning(true); }
      const rc = ev.target.closest('[data-rec]'); if (rc) { sim.applyRec(+rc.dataset.rec); toast('Change scheduled for tomorrow morning', true); return planning(true); }
      if (ev.target.closest('[data-pair]')) { sim.applyPairPlan(); toast('Re-pairing scheduled for tomorrow morning', true); return planning(true); }
      const s = ev.target.closest('[data-site]'); if (s) return selectSite(s.dataset.site);
    };
  }
  const types = FILT[plan.f], items = sim.log.filter(l => (!types || types.includes(l.type)) && (!l.siteId || A.match(sim.sites.get(l.siteId)))).slice(0, 60);
  const ttl = { allocate: 'Automatic loan', manual: 'Operator move', release: 'Released', approval: 'Approval requested', roster: 'Roster cover', uncovered: 'Left uncovered', absence: 'Absence', escalate: 'Escalated to zone lead', incident: 'Incident', review: 'Weekly review', structural: 'Permanent change', info: 'Note' };
  if (!(el.contains(document.activeElement) && document.activeElement.closest?.('#pL'))) $('#pL').innerHTML = items.map(l => { const s = l.siteId ? sim.sites.get(l.siteId) : null;
    return `<div class="card ${l.type}"><div class="h"><span>${ttl[l.type] || l.type}${s ? `, ${s.zone}` : ''}</span><span>${esc(A.fmtDate(l.day))} ${fmtT(l.t)}</span></div><p>${esc(l.reason)}</p>${l.alts?.length ? `<div class="alts">Also considered: ${l.alts.map(a => `${a.id} from ${esc(a.where)} (${a.eta} min)`).join('; ')}${l.ex ? `. Excluded: ${l.ex.gender} by gender rule, ${l.ex.zone} in distant zones, ${l.ex.far} over ${P.maxLoanEta} min, ${l.ex.busy} busy.` : ''}</div>` : ''}${l.type === 'allocate' || l.type === 'escalate' ? `<button data-x="${l.id}">Explain with AI</button>` : ''}${s ? `<button data-site="${s.id}">Show on map</button>` : ''}<div class="ex" id="ex${l.id}">${esc(A.explanations.get(l.id) || '')}</div></div>`; }).join('') || '<div class="empty">Nothing yet. Moves appear when a school is about to miss its target and no covering engineer can make it.</div>';
  const pend = sim.approvals.filter(a => a.state === 'pending'), done = sim.approvals.filter(a => a.state !== 'pending').slice(0, 3);
  $('#pA').innerHTML = (pend.map(a => A.apprHtml(a)).join('') || '<div class="empty">Nothing waiting for you.</div>') + (done.length ? `<table class="tbl" style="margin-top:6px"><tbody>${done.map(a => `<tr data-site="${a.siteId}"><td>${esc(A.fmtDate(dayOfT(a.t)))} ${fmtT(a.t)}</td><td>${a.engId} to ${esc(sim.sites.get(a.siteId).name)}</td><td>${a.state}</td></tr>`).join('')}</tbody></table>` : '');
  const ps = sim.poolStats || (sim.weeklyReview(false), sim.poolStats);
  const zones = sim.net.zones.filter(z => !A.ui.zone || z.id === A.ui.zone), cell = p => { if (!p || !p.avail) return '<td style="background:#F4F6F3">–</td>'; const u = p.util; return `<td style="background:${u > .7 ? '#C8372D' : u > .5 ? '#E0A800' : u > .3 ? '#BFE3CE' : '#E3F1E8'};color:${u > .7 ? '#fff' : 'inherit'}" title="${p.engs.length} engineers">${Math.round(u * 100)}%</td>`; };
  $('#pH').innerHTML = `<table class="heat"><thead><tr><th class="l">Zone</th><th>Male pool</th><th>Female pool</th></tr></thead><tbody>${zones.map(z => `<tr><td class="l">${z.id} ${esc(z.name)}</td>${cell(ps[z.id + '|B'])}${cell(ps[z.id + '|G'])}</tr>`).join('')}</tbody></table>${sim.days.length ? '' : '<p class="empty">Figures fill in after the first full day.</p>'}`;
  $('#pR').innerHTML = sim.recs.map(r => `<div class="card structural"><p>${esc(r.reason)}</p><p><small>Suggested engineer: ${r.engId}. Effective the next morning.</small></p>${r.state === 'open' ? `<button class="primary" data-rec="${r.id}">Apply</button>` : '<span class="chip">scheduled</span>'}</div>`).join('') || '<div class="empty">No permanent changes recommended: pool loads are within 20 points of each other.</div>';
  const pp = sim.pairing || sim.pairPlan();
  $('#pP').innerHTML = `<div class="mini" style="grid-template-columns:repeat(4,1fr)"><div><small>Between a pair's schools now</small><b>${pp.curMed} min</b></div><div><small>Pairs over 45 min apart</small><b>${pp.over45} of ${pp.nPairs}</b></div><div><small>After re-pairing by distance</small><b>${pp.newMed} min</b></div><div><small>Engineers affected</small><b>${pp.groups.reduce((a, g) => a + (g.ok ? g.engs.length : 0), 0)}</b></div></div>
    <table class="tbl"><thead><tr><th>Furthest pairs today</th><th class="n">Apart</th></tr></thead><tbody>${pp.worst.map(w => `<tr data-site="${w.a}"><td>${w.e.id}: ${esc(sim.sites.get(w.a).name)} and ${esc(sim.sites.get(w.b).name)}</td><td class="n">${fmtDur(w.m)}</td></tr>`).join('')}</tbody></table>
    <div class="toolbar">${pp.applied ? '<span class="chip">Re-pairing scheduled</span>' : '<button class="primary" data-pair>Re-pair from tomorrow</button>'}<small>Medians, off-peak door to door</small></div>`;
  const per = zones.map(z => { const girls = [...sim.sites.values()].filter(s => s.zone === z.id && s.gender === 'G'); const f = [...sim.engs.values()].filter(e => e.zone === z.id && e.gender === 'G' && e.kind !== 'nspool'); const fd = f.filter(e => !e.absent);
    const fieldDay = girls.reduce((a, s) => a + s.days.slice(-5).reduce((b, d) => b + d.field, 0), 0) / Math.max(1, Math.min(5, sim.days.length)) || girls.reduce((a, s) => a + s.today.field, 0);
    return { z, girls: girls.length, f: f.length, fd: fd.length, fieldDay, wait: girls.reduce((a, s) => a + s.waiting, 0) }; });
  $('#pG').innerHTML = `<table class="tbl"><thead><tr><th>Zone</th><th class="n">Girls' schools</th><th class="n">Female engineers</th><th class="n">On duty</th><th class="n">Field visits a day</th><th class="n">Waiting now</th></tr></thead><tbody>${per.map(p => `<tr><td>${p.z.id} ${esc(p.z.name)}</td><td class="n">${p.girls}</td><td class="n">${p.f}</td><td class="n" style="color:${p.girls && p.fd < 2 ? COL.critical : 'inherit'}">${p.fd}</td><td class="n">${p.fieldDay.toFixed(0)}</td><td class="n">${p.wait || ''}</td></tr>`).join('')}</tbody></table>`;
}

// ---------------- Model
const GROUPS = [
  ['Demand', 'How many tickets arrive and when.', [
    ['calibration', 'Share of workbook estimate', 0.2, 1.2, .05, v => `${Math.round(v * 100)}%`, 'The workbook sizes 34,212 tickets a month for all zones. That is a planning ceiling, so the baseline uses half of it. Raise it to stress the network.'],
    ['offHoursShare', 'Logged out of hours', 0, .2, .01, v => `${Math.round(v * 100)}%`, 'Teachers log some issues in the evening; they wait for the 07:00 desk.'],
    ['linkOutage', 'School link outages per school a day', 0, .02, .001, v => `${(v * 100).toFixed(1)}%`, 'Each outage is one P1 visit plus 4–10 linked tickets that close when the ISP restores the link.']]],
  ['Service desk', 'First line, before anything reaches the field.', [
    ['deskSkill', 'Remote-fix effectiveness', .5, 1.2, .05, v => `${Math.round(v * 100)}%`, 'Multiplies each category\'s remote-fix rate. Better desk tooling means fewer site visits.']]],
  ['Travel', 'Door-to-door minutes. Visible on every trip.', [
    ['overhead', 'Leave site and park', 0, 20, 1, v => `${v} min`, 'Walking to the car and finding parking at the school.'],
    ['checkin', 'Gate check-in', 0, 20, 1, v => `${v} min`, 'Visitor registration at school security. Resident engineers skip it at their own school.'],
    ['crossDxbShj', 'Dubai–Sharjah peak factor', 1, 2.5, .05, v => `×${v.toFixed(2)}`, 'The Al Ittihad and Al Khan corridors in the school run.'],
    ['offPeak', 'Off-peak traffic factor', .9, 1.4, .05, v => `×${v.toFixed(2)}`, 'Applied outside 06:45–08:30 and 13:15–15:00.']]],
  ['Workforce', 'Who is available each morning.', [
    ['leaveRate', 'Annual leave', 0, .15, .01, v => `${Math.round(v * 100)}%`, 'Taken in 3–5 day blocks, known the evening before.'],
    ['sickRate', 'Sick days', 0, .1, .005, v => `${(v * 100).toFixed(1)}%`, 'Unplanned, known at 06:50 when the roster is built.']]],
  ['Allocation policy', 'When and how engineers are moved.', [
    ['maxLoanEta', 'Longest acceptable trip for a loan', 15, 120, 5, v => `${v} min`, 'Engineers are only borrowed from the same or a neighbouring zone, and only if they can be on site within this time.'],
    ['minLoan', 'Minimum loan', 30, 240, 15, v => fmtDur(v), 'Avoids pulling an engineer back and forth.'],
    ['healthTrigger', 'Act when health stays below', 30, 80, 5, v => v, 'Together with a predicted SLA breach, this triggers a loan check every 15 minutes.'],
    ['overflowAt', 'Any pool engineer may take a ticket after', .2, 1, .05, v => `${Math.round(v * 100)}% of target`, 'Until then only the engineers assigned to the school can take it.'],
    ['autoApproveAfter', 'Auto-approve cross-zone moves after', 5, 60, 5, v => `${v} min`, 'Only when auto-approve is switched on in Planning.']]],
];
export function modelView() {
  const el = $('#v-model'); if (el.dataset.init) return calib(); el.dataset.init = 1;
  el.innerHTML = `<div class="panel"><h2>Model and assumptions</h2><p class="sub">Everything the simulation assumes, with the reason. Sliders change the running simulation immediately. Volumes are anchored to the allocation workbook; travel is a calibrated road model until Google Routes is enabled on the key.</p><div id="calib"></div></div>
  <div class="mgrid">${GROUPS.map(([g, sub, ps]) => `<div class="panel"><h2>${g}</h2><p class="sub">${sub}</p>${ps.map(([k, l, mn, mx, st, f, why]) => `<div class="param"><label for="m-${k}">${l}</label><span class="v" id="v-${k}">${f(P[k])}</span><input type="range" id="m-${k}" min="${mn}" max="${mx}" step="${st}" value="${P[k]}"><p>${why}</p></div>`).join('')}</div>`).join('')}
  <div class="panel"><h2>Travel calculator</h2><p class="sub">Door-to-door estimate between any two schools at a chosen time.</p><div class="calc"><input list="dl" id="cA" placeholder="From school or hub" aria-label="From"><input list="dl" id="cB" placeholder="To school" aria-label="To"><select id="cT" aria-label="Time"><option value="450">07:30 school run</option><option value="620">10:20 off-peak</option><option value="840">14:00 afternoon run</option></select><button id="cGo" class="primary">Estimate</button></div><datalist id="dl">${A.net.zones.map(z => `<option value="${z.id} hub">`).join('')}${A.net.sites.map(s => `<option value="${esc(s.name)}">`).join('')}</datalist><div id="cOut" class="trip" style="margin-top:8px">Pick two places.</div></div>
  <div class="panel"><h2>Ticket categories</h2><p class="sub">Share of tickets, how often the desk fixes them remotely, and what a site visit involves.</p><table class="tbl"><thead><tr><th>Category</th><th class="n">Share</th><th class="n">Fixed remotely</th><th class="n">On-site work</th><th class="n">Needs parts</th><th class="n">To vendor</th></tr></thead><tbody>${CATS.map(c => `<tr><td>${c.name}</td><td class="n">${Math.round(c.share * 100)}%</td><td class="n">${Math.round(c.remote * 100)}%</td><td class="n">${c.svc} min</td><td class="n">${Math.round(c.parts * 100)}%</td><td class="n">${Math.round(c.vendor * 100)}%</td></tr>`).join('')}</tbody></table></div>
  <div class="panel"><h2>Service levels</h2><p class="sub">Business minutes; the clock pauses outside the shift (07:00–15:00, Fridays to 12:00).</p><table class="tbl"><thead><tr><th>Priority</th><th class="n">On site within</th><th class="n">Resolved within</th></tr></thead><tbody>${Object.entries(SLA).map(([k, v]) => `<tr><td>${k}</td><td class="n">${fmtDur(v.resp)}</td><td class="n">${fmtDur(v.res)}</td></tr>`).join('')}</tbody></table>
  <p class="sub" style="margin-top:8px">Fixed rules: boys' schools get male engineers only and girls' schools female engineers only. Loans come from the same zone or a neighbour (${Object.entries(ADJ).map(([z, a]) => `${z}: ${a.join(', ')}`).join('; ')}).</p></div></div>`;
  for (const [, , ps] of GROUPS) for (const [k, , , , , f] of ps) $('#m-' + k).oninput = e => { P[k] = +e.target.value; $('#v-' + k).textContent = f(P[k]); statsCache.clear(); calib(); };
  $('#cGo').onclick = () => {
    const find = v => { const z = A.net.zones.find(z => v === z.id + ' hub'); if (z) return { loc: z.hub, zone: z.id, name: z.hub.name }; const s = A.net.sites.find(s => s.name === v); return s && { loc: { lat: s.lat, lng: s.lng }, zone: s.zone, name: s.name, rural: s.rural }; };
    const a = find($('#cA').value), b = find($('#cB').value); if (!a || !b) return $('#cOut').textContent = 'Pick both places from the list.';
    const est = A.travel.get(a.loc, b.loc, A.sim.day * 1440 + +$('#cT').value, a.zone, b.zone, { rural: b.rural });
    $('#cOut').innerHTML = `<b>${fmtDur(est.min + P.checkin)}</b> door to door, gate included: ${est.km} km by road, ${est.drive} min driving (${esc(est.label)}, ×${est.traffic.toFixed(2)}), ${est.overhead} min leaving and parking, ${P.checkin} min gate check-in. Source: ${est.src === 'google' ? 'Google Maps' : 'road model'}.`;
  };
  calib();
}
function calib() {
  const sim = A.sim, perDay = [...sim.sites.values()].reduce((a, s) => a + sim.daily(s), 0), field = CATS.reduce((a, c) => a + c.share * (1 - c.remote * P.deskSkill), 0);
  const el = $('#calib'); if (!el) return;
  el.innerHTML = `<div class="mini" style="grid-template-columns:repeat(5,1fr)"><div><small>Workbook estimate a month</small><b>${num(sim.net.zones.reduce((a, z) => a + z.monthlyTickets, 0))}</b></div><div><small>Model, a typical month</small><b>${num(perDay * 21)}</b></div><div><small>Per school a day</small><b>${(perDay / 522).toFixed(1)}</b></div><div><small>Needing a site visit</small><b>${Math.round(field * 100)}%</b></div><div><small>Visits per engineer a day</small><b>${(perDay * field / 312).toFixed(1)}</b></div></div>`;
}
