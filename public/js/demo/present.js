// Guided presentation driving the live demo (demo.js): slides, tour steps with a highlight ring and a popover.
// Each tour step names the story chapter it needs, which screen tab and phone to show, and the element to highlight.
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const d = window.demo || await new Promise(r => addEventListener('demo-ready', () => r(window.demo), { once: true }));
const { X, fmtT, fmtDur, SLA, P, short } = d, { A, A2, B, E1, t1, p1, trip1, search: SR, cand: PICK } = X, E3 = PICK.e;

const TOUR = {
  service: [
    { ch: 'intro', h: 'Three screens, one day', p: `The school portal, the operations dashboard and the engineer’s phone, all running on the same live simulation of <b>522 schools and 312 engineers</b>.` },
    { ch: 'intro', sel: '#okpis', tab: 'ops', k: 'The dashboard', h: 'Live network figures', p: 'Tickets logged, on-time visits, the queue, engineers on a job, engineers on loan and gender rule breaches. The whole network runs in the background, so these move as the day goes on.' },
    { ch: 'intro', sel: '.omap', k: 'The map', h: 'Every school and hub', p: 'Blue for boys’ schools, magenta for girls’ schools, grey for offices and centres. The dark labels are zone hubs, where pool engineers start and wait between jobs.' },
    { ch: 'intro', sel: '#opanel', k: 'Capacity', h: 'Engineers by zone and gender', p: '137 engineers are based at one large school, 92 are shared by two schools, and 69 work from the hubs. Female engineers are the scarcest: 75 for 129 girls’ schools.' },
    { ch: 'intro', h: 'Two rules shape every decision', p: '<b>Boys’ schools get male engineers, girls’ schools get female engineers.</b> And help only comes from the <b>same or a neighbouring zone, within an hour</b>. Every path in the system checks both.' },
  ],
  roster: [
    { ch: 'roster', sel: '#opanel .appr', tab: 'ops', k: 'Before the desk opens', h: `${'Z01-FE16'} is on leave`, p: `Her two girls’ schools need a female engineer. The roster takes Z01-FE29 from the nearest hub, Al Qusais, and keeps the other Dubai female pool engineer free.` },
    { ch: 'roster', sel: '.omap', k: 'Nearest first', h: 'Cover from the hub', p: 'Same zone first, then a neighbouring zone, never more than 60 minutes away, and never emptying a pool. The dashed line is the cover trip.' },
    { ch: 'roster', sel: '#phone .card', who: 'e1', k: 'Engineer app', h: 'Her day on the phone', p: `${E1.id} sees her shift, her two schools, ${short(A2)} and ${short(A)}, ${trip1.km} km apart, and the team notice about the absence.` },
    { ch: 'roster', sel: '#phone .pbtn', k: 'Engineer app', h: 'Start shift', p: 'One tap and she is on duty and visible to dispatch.' },
  ],
  report: [
    { ch: 'log', sel: '#pf', tab: 'portal', k: 'School portal', h: 'Reporting a fault takes a minute', p: 'A Grade 9 lesson can’t start: the smart board shows “No signal”. The teacher says what is wrong, where, and who is affected.' },
    { ch: 'log', sel: '#pdesc', k: 'In their own words', h: 'No categories to learn', p: 'The teacher writes it plainly. The desk, helped by the AI assistant, does the categorising.' },
    { ch: 'log', sel: '.psubmit', k: 'Submit', h: 'Tied to the school', p: 'The ticket carries the school’s ID, so the gender rule and the school’s own engineers are known before anyone reads it. The response clock starts now.' },
  ],
  triage: [
    { ch: 'triage', sel: '#opanel section', tab: 'ops', k: 'Service desk', h: 'The ticket arrives', p: 'Classroom display, priority P2: a whole class can’t be taught. The clock only counts school hours.' },
    { ch: 'triage', sel: '#aiTriage', k: 'AI assistant', h: 'A suggested category and priority', p: 'The assistant reads the teacher’s words and suggests the category, the priority and a remote check. A desk agent confirms.' },
    { ch: 'triage', sel: '#opanel .feed', k: 'Remote first', h: 'The desk tries a remote fix', p: `Only ${Math.round(X.cat.remote * 100)}% of display faults can be fixed remotely. The remote input reset doesn’t help, so the ticket goes to the field at ${fmtT(d.T.remoteEnd)}.` },
    { ch: 'triage', sel: '#opanel .clk', k: 'Targets', h: `On site by ${fmtT(t1.dueResp)}`, p: `P2 target: an engineer on site within ${SLA.P2.resp} school minutes, resolved within ${SLA.P2.res}. The bars fill as the time is used.` },
  ],
  dispatch: [
    { ch: 'dispatch', sel: '#opanel section:nth-of-type(2)', tab: 'ops', k: 'Dispatch', h: 'Who can go', p: `${short(A)} is a girls’ school. Her own paired engineer, <b>${E1.id}</b>, is free at ${short(A2)}: <b>${trip1.min} minutes</b> door to door. The male engineers just as close are barred.` },
    { ch: 'dispatch', sel: '.omap', k: 'On the map', h: 'The chosen trip and the barred ones', p: 'The dark line is her trip. The red dashed lines are the male engineers at the Al Barsha complex, ruled out by the gender rule before distance is weighed.' },
    { ch: 'dispatch', sel: '#opanel .cand.pick', k: 'Drive time', h: `${trip1.drive} min driving + ${trip1.overhead} to park`, p: `${trip1.km} km of road, off-peak. Speeds come from the road type, and school-run peaks slow the city part of a trip. She has a badge here, so no gate check-in.` },
    { ch: 'dispatch', sel: '#phone .offer', who: 'e1', k: 'Engineer app', h: 'The job lands on her phone', p: 'The school, the problem in the teacher’s words, the deadline and her arrival time. She accepts.' },
  ],
  drive: [
    { ch: 'drive', sel: '#phone .pscroll', who: 'e1', k: 'Engineer app', h: 'Route and arrival time', p: `The phone counts down the ${trip1.km} km. The clock is sped up, but the drive takes as long as Dubai’s roads would: ${trip1.min} minutes.` },
    { ch: 'drive', sel: '.track', tab: 'portal', k: 'School portal', h: 'The teacher sees the same arrival time', p: 'Who is coming and when, without phoning the desk.' },
    { ch: 'drive', sel: '.omap', tab: 'ops', k: 'Dashboard', h: 'And dispatch sees her moving', p: 'Every engineer’s position, trip and arrival time is visible on the map.' },
  ],
  onsite: [
    { ch: 'work', sel: '#opanel .clk', tab: 'ops', k: 'Response clock', h: `On site in ${t1.respBiz} minutes`, p: `Arrival stops the response clock: ${t1.respBiz} of ${SLA.P2.resp} school minutes used.` },
    { ch: 'work', sel: '#phone .card:nth-child(2)', who: 'e1', k: 'Engineer app', h: 'Checks for this kind of fault', p: 'The phone walks her through the usual causes of a “No signal” fault.' },
    { ch: 'work', sel: '#phone .card:nth-child(2)', act: 'fixAI', k: 'AI assistant', h: 'Next steps from the ticket text', p: 'The assistant suggests where to look first, from the teacher’s own description.' },
    { ch: 'work', sel: '#remoteBox', act: 'remoteBtn', k: 'Remote support', h: 'Request remote support', p: 'If the AI steps don’t solve it, she taps Request remote support. A Tier 2 specialist at the service desk joins by video with the ticket, the AI steps and her checks.' },
    { ch: 'work', sel: '#phone .outs', k: 'Outcome', h: 'How the job ends decides what happens next', p: `Fixed closes the ticket now. Needs a part books a revisit for the next school day (${fmtDur(X.outcomes.part.resBiz)}, past the resolution target). Needs the vendor books a warranty visit. Here it’s fixed.` },
  ],
  signoff: [
    { ch: 'close', sel: '#phone .pscroll', who: 'e1', act: 'autosign', k: 'Engineer app', h: 'The teacher signs on the phone', p: 'Notes and outcome go straight into the ticket, so nobody types them up later.' },
    { ch: 'close', sel: '.banner', tab: 'portal', act: 'signed', k: 'School portal', h: 'Resolved, and rated', p: `Resolved at ${fmtT(t1.closeAt)}: ${fmtDur(X.outcomes.fixed.resBiz)} of school time against an 8-hour target. The teacher rates the visit, and ratings feed the school’s satisfaction score.` },
  ],
  outage: [
    { ch: 'outage', sel: '.banner', tab: 'portal', k: 'School portal', h: `${short(B)} loses its internet`, p: `Teachers start reporting it. Instead of ${p1.linked} separate visits, the desk opens <b>one P1 incident</b> and links every report to it. The portal tells teachers it’s already known.` },
    { ch: 'outage', sel: '.health', tab: 'ops', k: 'Dashboard', h: 'School health drops', p: 'A P1 waiting and a 30-minute deadline approaching. This is what triggers the dispatch search.' },
    { ch: 'outage', sel: '#opanel .kv', k: 'Why it’s hard', h: 'No resident engineer, a committed pool', p: `A small school served by the Dubai female pool. One pool engineer is covering the colleague on leave; the other is on a job at Umm Sqaim until ${fmtT(X.state(X.engs.get('Z01-FE30')).busyUntil)}.` },
  ],
  search: [
    { ch: 'search', sel: '.omap', tab: 'ops', k: 'Nearby first', h: 'Searching outward from the school', p: `Red: <b>${SR.barred.length} male engineers</b> within an hour, barred. Grey: Dubai women who are busy or covering. Gold: the nearest free woman, at the Sharjah hub, <b>${PICK.eta} min</b> away.` },
    { ch: 'search', sel: '#opanel .excl', k: 'The exclusions', h: 'Why nobody closer', p: `Every exclusion is listed. ${SR.zone} engineers in zones that don’t border Dubai are never considered.` },
    { ch: 'search', sel: '#apprBox', k: 'Approval', h: 'Crossing a zone boundary needs a person', p: `Send ${E3.id} from Sharjah, on site about ${fmtT(p1.onsite)}, or wait for a Dubai engineer until about ${fmtT(X.waitFor.until + X.waitFor.est.min + P.checkin)}. If nobody decides, it is approved after 20 minutes. The operator approves.` },
  ],
  reassign: [
    { ch: 'move', sel: '#phone .offer', who: 'e3', k: 'Engineer app', h: `${E3.id} gets the move`, p: 'Where she is going, why she was chosen, the trip, and that she returns to Sharjah duties when released.' },
    { ch: 'move', sel: '#opanel section:last-child', tab: 'ops', k: 'Re-checked', h: 'The rules run again at approval', p: 'Still free, still a woman for a girls’ school, still within an hour. A stale approval can’t send the wrong person.' },
  ],
  gate: [
    { ch: 'drive2', sel: '.omap', tab: 'ops', k: 'Dashboard', h: 'Sharjah to Dubai', p: `${PICK.est.km} km, ${PICK.est.drive} min of driving plus parking.` },
    { ch: 'drive2', sel: '#phone .pscroll', who: 'e3', k: 'Engineer app', h: 'Gate check-in with a visitor code', p: `She isn’t based at this school, so security scans a visitor QR code: about ${P.checkin} more minutes.` },
    { ch: 'drive2', sel: '#opanel .clk', tab: 'ops', k: 'Recorded as it happened', h: `On site at ${fmtT(p1.onsite)}`, p: `${p1.respBiz} minutes after the outage, ${p1.respBiz - SLA.P1.resp} past the 30-minute P1 target. The dashboard records the miss rather than hiding it.` },
  ],
  restore: [
    { ch: 'restore', sel: '#phone .pscroll', who: 'e3', k: 'Engineer app', h: 'A provider fault, and a workaround', p: 'The fibre router has no power. She raises it with the provider and puts the admin office and exam room on the 4G backup.' },
    { ch: 'restore', sel: '.track', tab: 'portal', k: 'School portal', h: 'Every report closes together', p: `When the line is restored at ${fmtT(p1.restored)}, all ${p1.linked} linked reports close with the incident: ${fmtDur(p1.resBiz)} against a 4-hour target.` },
  ],
  results: [
    { ch: 'eod', sel: '#opanel section', tab: 'ops', k: 'Close of day', h: 'The whole network', p: 'Tickets, visits, on-time rates, engineers lent to nearby schools, escalations and gender rule breaches for the day.' },
    { ch: 'eod', sel: '#opanel .res', k: 'The two tickets', h: 'Met, missed, met', p: 'The display fault met both targets. The outage missed its on-site target and met its restore target.' },
    { ch: 'eod', sel: '#briefBox', act: 'brief', k: 'Briefing', h: 'A plain-language summary', p: 'Written from the day’s figures for the operations manager.' },
    { ch: 'eod', sel: '#phone .pscroll', who: 'e1', k: 'Engineer app', h: 'Her day', p: 'Jobs, driving and time on site, and where she starts tomorrow.' },
  ],
  explore: [
    { ch: 'intro', free: 1, explore: 1, k: 'Your turn', h: 'Everything is clickable now', p: 'Use the chapter bar and the Back and Next buttons inside the app. Submit the form, accept jobs, pick a different outcome, reject the approval.', try: 'Try: choose “Needs a part” on site, then see the results change.' },
    { ch: 'intro', free: 1, explore: 1, k: 'Try this', h: 'Switch screens', p: 'The tabs above the screen switch between the school portal and the dashboard; the buttons above the phone switch engineers.' },
  ],
};

// ---------- engine (same model as the usage-dashboard presentation)
const stage = $('#stage'), wrap = $('#appwrap'), app = $('#app'), pop = $('#pop'), ring = $('#ring');
const slides = $$('.slide'); let I = 0, S = 0, last = { I: -1, S: -1 };
const steps = i => { const t = TOUR[slides[i].dataset.app]; if (t) return t.length - 1; return Math.max(0, ...$$('.reveal', slides[i]).map(n => +n.dataset.from)); };
// measure the box the page is actually shown in (inside an embedding frame, innerWidth can disagree with it)
function fit() {
  stage.style.transform = 'none';
  const v = $('#viewport').getBoundingClientRect(), s0 = stage.getBoundingClientRect(); // both measured in the same units, whatever zoom the host applies
  const w = v.width || document.documentElement.clientWidth, h = v.height || document.documentElement.clientHeight;
  const k = Math.min(w / (s0.width || 1280), h / (s0.height || 720)) * 0.98;
  stage.style.transform = `scale(${k})`; fitApp();
}
addEventListener('load', fit); [300, 1000, 2500].forEach(ms => setTimeout(fit, ms));
if (window.ResizeObserver) new ResizeObserver(() => fit()).observe($('#viewport'));
function fitApp() { if (!wrap.clientWidth) return; const k = wrap.clientWidth / 1440; app.style.height = wrap.clientHeight / k + 'px'; app.style.transform = `scale(${k})`; }
addEventListener('resize', fit);

function scrollParent(el) { for (let p = el.parentElement; p && p !== app; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p; } return null; }
function place(sel) {
  if (!sel) { ring.classList.remove('on'); return null; }
  const el = $(sel, app); if (!el) { ring.classList.remove('on'); return null; }
  const sp = scrollParent(el); if (sp) { const pr = sp.getBoundingClientRect(), er = el.getBoundingClientRect(), k = pr.height / sp.clientHeight || 1; if (er.top < pr.top || er.bottom > pr.bottom) sp.scrollTop += (er.top - pr.top) / k - 12; }
  const ak = app.getBoundingClientRect().width / 1440, ar = app.getBoundingClientRect(), er = el.getBoundingClientRect(), pad = 6;
  let top = (er.top - ar.top) / ak - pad, h = er.height / ak + pad * 2; const AH = app.offsetHeight - 2; if (top + h > AH) h = AH - top; // keep the ring inside the frame
  Object.assign(ring.style, { left: (er.left - ar.left) / ak - pad + 'px', top: top + 'px', width: er.width / ak + pad * 2 + 'px', height: h + 'px' });
  ring.classList.add('on');
  const sr = stage.getBoundingClientRect(), k = sr.width / 1280;
  return { l: (er.left - sr.left) / k, t: (er.top - sr.top) / k, r: (er.right - sr.left) / k, b: (er.bottom - sr.top) / k };
}
function popAt(rect, free) {
  const pw = 350, ph = pop.offsetHeight || 200, W = 1280, H = 720 - 56; let x, y;
  if (!rect) { x = free ? W - pw - 36 : (W - pw) / 2; y = free ? H - ph - 24 : (H - ph) / 2; }
  else { const g = 16;
    if (rect.r + g + pw < W - 10) { x = rect.r + g; y = rect.t; }
    else if (rect.l - g - pw > 10) { x = rect.l - g - pw; y = rect.t; }
    else if (rect.b + g + ph < H - 10) { y = rect.b + g; x = rect.l; }
    else { y = Math.max(70, rect.t - g - ph); x = rect.l; } }
  pop.style.left = Math.max(12, Math.min(W - pw - 12, x)) + 'px'; pop.style.top = Math.max(64, Math.min(H - ph - 6, y)) + 'px';
}
let timers = [];
function applyStep(st, forward) {
  const ci = d.IDX[st.ch];
  if (d.S.i !== ci) { const prevCh = d.S.i; d.go(ci, forward && ci === prevCh + 1 && !!d.CH[ci].anim); }
  const o = {}; if (st.tab) o.tab = st.tab; if (st.who) o.who = st.who; if (Object.keys(o).length) d.set(o);
  if (st.act === 'autosign') { d.set({ signed: false }); setTimeout(() => d.autosign(), 400); }
  if (st.act === 'signed') d.set({ signed: true, csat: 5 });
  if (st.act === 'fixAI' && !d.S.ai.fix) d.fixAI();
  if (st.act === 'remoteBtn') { if (d.S.remote) d.set({ remote: null }); document.querySelector('#remoteBox')?.classList.remove('hidden'); }
  if (st.act === 'brief' && !d.S.ai.brief) d.brief();
}
function render(forward = true) {
  const el = slides[I], key = el.dataset.app, tour = TOUR[key];
  slides.forEach((s, i) => { s.classList.toggle('active', i === I); s.classList.toggle('before', i < I); });
  wrap.classList.toggle('show', !!tour);
  $$('.reveal', el).forEach(n => n.classList.toggle('on', +n.dataset.from <= S));
  timers.forEach(clearTimeout); timers = [];
  if (tour) {
    const st = tour[S];
    fitApp();
    if (last.I !== I || last.S !== S) applyStep(st, forward);
    app.classList.toggle('noptr', !st.explore); app.classList.toggle('explore', !!st.explore);
    if (st.explore) setTimeout(() => d.resizeMap(), 50);
    pop.innerHTML = `<div class="k">${st.k || 'Guided tour'}, ${S + 1} of ${tour.length}</div><h3>${st.h}</h3><p>${st.p}</p>${st.try ? `<div class="try">${st.try}</div>` : ''}<div class="pnav"><div class="dots">${tour.map((_, j) => `<i class="${j === S ? 'on' : ''}"></i>`).join('')}</div><div style="color:#8a8e96;font-size:12px">${S < tour.length - 1 ? '→ next' : '→ continue'}</div></div>`;
    pop.classList.add('on');
    const again = () => { const r = st.free ? null : place(st.sel); if (st.free) ring.classList.remove('on'); popAt(r, st.free); };
    again(); [120, 450, 900].forEach(ms => timers.push(setTimeout(again, ms)));
  } else { pop.classList.remove('on'); ring.classList.remove('on'); app.classList.add('noptr'); }
  last = { I, S };
  $('#prog div').style.width = ((I + (steps(I) ? S / steps(I) : 1)) / slides.length * 100).toFixed(1) + '%';
  $('#pos').textContent = `Slide ${I + 1}/${slides.length}` + (steps(I) ? `, step ${S + 1}/${steps(I) + 1}` : '');
  $('#pprev').disabled = I === 0 && S === 0;
  try { history.replaceState(null, '', `#${I + 1}.${S}`); } catch {}
}
// a step inside an animated chapter waits for the animation the first time Next is pressed
function next() { if (d.animating) { d.finishAnim(); render(); return; } if (S < steps(I)) S++; else if (I < slides.length - 1) { I++; S = 0; } render(true); }
function prev() { if (d.animating) d.finishAnim(); if (S > 0) S--; else if (I > 0) { I--; S = steps(I); } render(false); }
const go = (i, s = 0) => { I = i; S = s; render(false); };
$('#pnext').onclick = next; $('#pprev').onclick = prev;
addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,textarea,select')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); next(); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
  else if (e.key === 'Home') go(0); else if (e.key === 'End') go(slides.length - 1, steps(slides.length - 1));
  else if (e.key === 'o' || e.key === 'O') { const o = $('#ovl'); if (o.classList.toggle('on')) { o.innerHTML = `<h2>All slides</h2><div class="g">${slides.map((s, i) => `<button class="${i === I ? 'cur' : ''}" data-i="${i}">${i + 1}. ${s.dataset.title}<small>${steps(i) ? steps(i) + 1 + ' guided steps' : 'single view'}</small></button>`).join('')}</div>`; $$('#ovl button').forEach(b => b.onclick = () => { o.classList.remove('on'); go(+b.dataset.i); }); } }
  else if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}); }
  else if (e.key === 'Escape') $('#ovl').classList.remove('on');
});
let tx = null; addEventListener('touchstart', e => tx = e.touches[0].clientX, { passive: true });
addEventListener('touchend', e => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) dx < 0 ? next() : prev(); tx = null; });
const hm = location.hash.match(/#(\d+)\.(\d+)/); if (hm) { I = Math.min(+hm[1] - 1, slides.length - 1); S = Math.min(+hm[2], steps(I)); }
fit(); render(false);
window.present = { go, next, prev };
