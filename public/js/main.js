import { Sim, ruleText, eligible } from './engine.js';
import { Travel } from './travel.js';
import { P, fmtT, fmtDate, mod, shiftWindow, dayOf, SLA } from './model.js';
import { $, $$, esc, md, toast } from './ui/util.js';
import { initOps, invalidate, flyToZone, mapTick, siteStyles, pulse, selectSite, drawer, strip, figures, side, wireSide, apprHtml } from './ui/ops.js';
import { initViews, schools, engineers, planning, modelView } from './ui/views.js';

const net = await (await fetch('data/network.json')).json();
const travel = new Travel(), sim = new Sim(net, travel);
const A = window.app = {
  net, travel, sim, fmtDate, apprHtml, explanations: new Map(),
  ui: { view: 'ops', period: 'today', zone: '', gender: '', speed: 2, playing: true, sel: null, follow: null, allEng: false, cands: null },
  match: s => (!A.ui.zone || s.zone === A.ui.zone) && (!A.ui.gender || (A.ui.gender === 'N' ? s.type !== 'school' : s.gender === A.ui.gender)),
  go: v => go(v),
};

// ---------- shell
const RENDER = { ops: () => { figures(); side(); drawer(); }, schools, engs: engineers, plan: planning, model: modelView };
function go(v) {
  A.ui.view = v; $$('#nav button').forEach(b => { b.classList.toggle('on', b.dataset.v === v); if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }); $$('.view').forEach(x => x.classList.toggle('on', x.id === 'v-' + v));
  if (v === 'ops') invalidate(); RENDER[v](true); strip();
}
$('#nav').onclick = ev => { const b = ev.target.closest('[data-v]'); if (b) go(b.dataset.v); };
const pressed = (sel, b) => $$(sel + ' button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
$$('#speed button, #period button').forEach(b => b.setAttribute('aria-pressed', b.classList.contains('on')));
$('#fZone').innerHTML += net.zones.map(z => `<option value="${z.id}">${z.id} ${esc(z.name)}</option>`).join('');
$('#fZone').onchange = e => { A.ui.zone = e.target.value; flyToZone(A.ui.zone); refresh(true); };
$('#fGender').onchange = e => { A.ui.gender = e.target.value; refresh(true); };
$('#period').onclick = ev => { const b = ev.target.closest('[data-p]'); if (!b) return; A.ui.period = b.dataset.p; pressed('#period', b); refresh(true); };
$('#pauseEod').onchange = e => { sim.stopAtDayEnd = e.target.checked; };
$('#play').onclick = () => setPlay(!A.ui.playing);
function setPlay(p) { if (p) $('#eod').classList.add('hidden'); A.ui.playing = p; $('#play').textContent = p ? 'Pause' : 'Play'; $('#play').setAttribute('aria-label', p ? 'Pause simulation' : 'Play simulation'); }
$('#speed').onclick = ev => { const b = ev.target.closest('[data-s]'); if (!b) return; A.ui.speed = +b.dataset.s; pressed('#speed', b); scaleText(); };
function scaleText() { $('#scale').textContent = `1 s = ${A.ui.speed} min`; }
$('#skip').onclick = () => { const d = dayOf(sim.t); let n = 0; while (dayOf(sim.t) === d && n++ < 3000) sim.step(); $('#eod').classList.add('hidden'); refresh(true); toast(`${fmtDate(sim.day)}, 06:50: the morning roster is ready. Press Play to open the desk.`, true); setPlay(false); };
$('#scenario').onchange = e => { const v = e.target.value; if (!v) return; const w = shiftWindow(sim.day); if (!w || sim.t < w[0] || sim.t >= w[1]) { toast('Scenarios run during the school day. Press Play first.', false); e.target.value = ''; return; } sim.scenario(v); toast(`Scenario started: ${e.target.selectedOptions[0].text}`, true); e.target.value = ''; refresh(true); };
sim.on('dayEnd', () => { if (sim.stopAtDayEnd) setPlay(false); });

function header() {
  $('#clk').textContent = fmtT(sim.t); $('#date').textContent = fmtDate(sim.day) + ' 2026' + (sim.closedDay ? ', day closed' : '');
  const w = shiftWindow(sim.day), f = w ? Math.min(1, Math.max(0, (sim.t - w[0]) / (w[1] - w[0]))) : 0; $('#dayBar').style.width = f * 100 + '%';
  const r = $('#bRoute');
  if (travel.live) { r.className = 'badge ok'; r.textContent = `Drive times: Google Maps (${travel.google.cached})`; r.title = ''; }
  else { r.className = 'badge warn'; r.textContent = 'Drive times: road model'; r.title = `Google Routes is not available for this key${travel.google.error ? ' (' + travel.google.error.slice(0, 120) + ')' : ''}. Enable "Routes API" and remove the key restriction to switch to live traffic.`; }
  const n = sim.approvals.filter(a => a.state === 'pending').length; $('#nPend').textContent = n; $('#nPend').classList.toggle('hidden', !n);
  const k = sim.kpis('today'); $('#ctxNote').textContent = w && sim.t >= w[0] && sim.t < w[1] ? `${k.onDuty} engineers on duty, ${k.waiting} tickets waiting for an engineer` : 'Before the shift: roster built at 06:50';
}
function refresh(force) { header(); siteStyles(); if (A.ui.view === 'ops') strip(); RENDER[A.ui.view](force); }

// ---------- copilot
const SYS = `You are the operations copilot for the UAE Ministry of Education EUC field-engineering service: 522 schools, 48 non-school sites, 312 field engineers in 10 zones.
Hard rules: boys' schools only get male engineers, girls' schools only female engineers, non-school sites anyone. Engineers are only borrowed from the same or a neighbouring zone, and only if they arrive within the policy limit. Never suggest breaking these.
SLA (business minutes): on site within P1 30, P2 120, P3 240, P4 480; resolved within P1 240, P2 480, P3 960, P4 1440.
Use only the JSON state given. Be concise and specific: name schools, zones and engineer IDs, give numbers, and say why. Plain sentences, no headings.
If you recommend moving an engineer, end with one line per move exactly: ACTION: {"engineer":"<id>","site":"<site id>"} using IDs from the candidates provided.`;
function context() {
  const k = sim.kpis(A.ui.period, A.match), worst = [...sim.sites.values()].filter(A.match).sort((a, b) => a.health - b.health).slice(0, 8);
  const cand = {}; for (const s of worst.slice(0, 4)) if (s.waiting) cand[s.id] = sim.candidates(s, sim.t).slice(0, 3).map(c => ({ engineer: c.e.id, from: c.where, etaMin: c.eta, zone: c.e.zone }));
  return JSON.stringify({ now: `${fmtDate(sim.day)} ${fmtT(sim.t)}`, period: A.ui.period, filter: { zone: A.ui.zone || 'all', schools: A.ui.gender || 'all' },
    kpis: { logged: k.recv, toField: k.field, onSiteInTimePct: k.respPct && Math.round(k.respPct), resolvedInTimePct: k.resPct && Math.round(k.resPct), waiting: k.waiting, pastTarget: k.aged, onDuty: k.onDuty, absent: k.absent, onLoan: k.loans, pendingApprovals: k.pending, genderViolations: k.violations },
    zones: Object.values(sim.zones).map(z => { const ss = [...sim.sites.values()].filter(s => s.zone === z.id); return { id: z.id, name: z.name, waiting: ss.reduce((a, s) => a + s.waiting, 0), atRisk: ss.filter(s => s.health < 60).length, femaleOnDuty: [...sim.engs.values()].filter(e => e.zone === z.id && e.gender === 'G' && !e.absent).length, maleOnDuty: [...sim.engs.values()].filter(e => e.zone === z.id && e.gender === 'B' && !e.absent).length }; }),
    worstSchools: worst.map(s => ({ id: s.id, name: s.name, zone: s.zone, rule: s.type !== 'school' ? 'any' : s.gender === 'B' ? 'male only' : 'female only', health: s.health, waiting: s.waiting, reasons: s.why })),
    candidates: cand, recentDecisions: sim.log.slice(0, 8).map(l => ({ type: l.type, time: fmtT(l.t), text: l.reason.slice(0, 220) })), recommendations: sim.recs.map(r => r.reason),
    selected: A.ui.sel?.type === 'site' ? A.ui.sel.id : null });
}
async function ask(messages, onTok) {
  const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
  if (!r.ok) throw new Error(`AI service returned ${r.status}`);
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', full = '';
  for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) if (l.trim()) { try { full += JSON.parse(l).t; onTok(full); } catch {} } }
  return full;
}
const hist = []; let busy = false;
$('#chips').innerHTML = ['What needs attention right now?', 'Where is the gender rule limiting us?', 'Which zone is short of engineers?', 'Summarise today for the ministry'].map(q => `<button>${q}</button>`).join('');
$('#chips').onclick = ev => { const b = ev.target.closest('button'); if (b) send(b.textContent); };
$('#copBtn').onclick = () => { $('#copilot').classList.toggle('hidden'); if (!$('#copilot').classList.contains('hidden')) $('#aiQ').focus(); };
$('#copClose').onclick = () => $('#copilot').classList.add('hidden');
$('#aiF').onsubmit = ev => { ev.preventDefault(); const v = $('#aiQ').value.trim(); if (v) { $('#aiQ').value = ''; send(v); } };
$('#msgs').innerHTML = '<div class="msg">I can see the live state: tickets, schools, engineers, loans and approvals. Ask a question, or ask me to propose a move. Any move I suggest is checked against the gender and distance rules before it is applied.</div>';
function addMsg(cls, text) { const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text; $('#msgs').appendChild(d); $('#msgs').scrollTop = 1e9; return d; }
async function send(q) {
  $('#copilot').classList.remove('hidden'); if (busy) return; busy = true; addMsg('u', q); const d = addMsg('a', 'Reading the live state…');
  hist.push({ role: 'user', content: q });
  try {
    const full = await ask([{ role: 'system', content: SYS }, { role: 'system', content: 'LIVE STATE: ' + context() }, ...hist.slice(-6)], t => { d.innerHTML = md(t.replace(/ACTION:\s*\{.*?\}\s*/g, '')); $('#msgs').scrollTop = 1e9; });
    hist.push({ role: 'assistant', content: full });
    for (const m of full.matchAll(/ACTION:\s*(\{.*?\})/g)) { try { const a = JSON.parse(m[1]), e = sim.engs.get(a.engineer), s = sim.sites.get(a.site); if (!e || !s) continue;
      const why = sim.checkLoan(e, s, sim.t); if (why) { const n = document.createElement('div'); n.className = 'empty'; n.textContent = `Suggested move of ${e.id} to ${s.name} not offered: ${why}`; d.appendChild(n); continue; }
      const b = document.createElement('button'); b.className = 'primary'; b.style.cssText = 'display:block;margin-top:6px'; b.textContent = `Send ${e.id} to ${s.name}`;
      b.onclick = () => { const r = sim.applyLoan(e, s, sim.t, { manual: true, auto: false, why: `Copilot suggestion accepted by operator.` }); toast(!r.ok ? `Blocked: ${r.reason}` : r.moving ? `${e.id} is driving to ${s.name}, on site about ${fmtT(r.arrives)}` : `${e.id} will go to ${s.name} after the current job`, r.ok); b.disabled = true; refresh(true); }; d.appendChild(b); } catch {} }
  } catch (e) { d.textContent = `The AI service could not be reached (${e.message}). The simulation keeps running; try again in a moment.`; }
  busy = false;
}
A.explain = async id => {
  const l = sim.log.find(x => x.id === id), box = $('#ex' + id); if (!l || !box) return; box.textContent = 'Thinking…'; const s = sim.sites.get(l.siteId);
  try { const t = await ask([{ role: 'system', content: 'Explain this field-engineer decision to a ministry operations manager in three short plain sentences: what was wrong at the school, why this engineer (distance, traffic, impact on their own schools) and how the gender and neighbouring-zone rules shaped the choice. No preamble, no headings.' }, { role: 'user', content: JSON.stringify({ school: s?.name, rule: s && ruleText(s), decision: l.reason, alternatives: l.alts, excluded: l.ex && { byGender: l.ex.gender, distantZones: l.ex.zone, overTimeLimit: l.ex.far, busy: l.ex.busy } }) }], x => { box.innerHTML = md(x); });
    A.explanations.set(id, t); } catch { box.textContent = 'The AI service could not be reached.'; }
};
A.brief = async (el, d) => {
  el.textContent = 'Writing the briefing…';
  try { await ask([{ role: 'system', content: 'You write the end-of-day briefing for the UAE Ministry of Education EUC field service. Rules you must respect: boys\' schools get male engineers only, girls\' schools female engineers only; engineers are only borrowed from the same or a neighbouring zone. Use only the figures given. In under 130 words of plain prose (no headings, no lists of IDs, no ACTION lines): the headline result for the day, the two or three weakest schools or zones and why, and at most two staffing changes worth considering. Do not guess an engineer\'s gender; only use what the data states.' }, { role: 'user', content: 'DAY TOTALS: ' + JSON.stringify(d) + ' STATE: ' + context() }], t => el.innerHTML = md(t.replace(/ACTION:\s*\{.*?\}\s*/g, ''))); }
  catch { el.textContent = 'The AI service could not be reached.'; }
};

// ---------- boot & loop
initOps(A); initViews(A); wireSide(); scaleText();
fetch('/api/status').then(r => r.json()).then(s => { const b = $('#bAI'); b.className = 'badge ok'; b.textContent = `AI: ${s.ollama.model}`; $('#copModel').textContent = s.ollama.model; }).catch(() => { $('#bAI').textContent = 'AI offline'; });
travel.refine(net.sites.map(s => ({ a: net.zones.find(z => z.id === s.zone).hub, b: { lat: s.lat, lng: s.lng } })));
sim.on('newDay', () => { if (A.ui.view === 'ops') strip(); });
let pulses = 0; sim.on('log', () => {}); const seenFeed = { n: 0 };
let last = performance.now(), acc = 0, lastUi = 0, lastMap = 0, lastStrip = 0;
function frame() {
  const now = performance.now(), dt = Math.min(1.5, (now - last) / 1000); last = now;
  if (A.ui.playing) { acc += dt * A.ui.speed; let n = 0; while (acc >= 1 && n++ < 120) { const r = sim.step(); acc -= 1; if (r === 'day') { acc = 0; break; } } sim.tf = sim.t + Math.min(acc, .999); }
  if (A.ui.view === 'ops' && now - lastMap > 100) { lastMap = now; mapTick(); }
  if (A.ui.view === 'ops' && now - lastStrip > 400) { lastStrip = now; strip(); }
  if (now - lastUi > 600) { lastUi = now; refresh(false);
    const nf = sim.feed.length; if (A.ui.view === 'ops') for (const f of sim.feed.slice(Math.max(0, nf - 6))) if (f.k === 'logged' && f.t >= sim.t - 2) pulse(f.s); }
}
setInterval(frame, 100); refresh(true);
