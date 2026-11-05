// End-to-end presentation: one school day told through the school portal, the operations console and the engineer's phone.
// The story uses real sites, engineers, drive-time model and allocation rules (story.js); the rest of the network runs in the
// background with the full simulator, so the console's network figures are live.
import { Sim } from '../engine.js';
import { Travel } from '../travel.js';
import { P, SLA, CAT, fmtT, fmtDate, fmtDur, dayOf, bizBetween } from '../model.js';
import { $, $$, esc, md, MAPCOL, toast } from '../ui/util.js';
import { makeStory, CAST, T } from './story.js';

const STATIC = !!window.DEMO_NET; // standalone build: data inlined, no server, no map tiles
const net = STATIC ? window.DEMO_NET : await (await fetch('data/network.json')).json();
const BASE = STATIC ? window.DEMO_BASE : await (await fetch('data/basemap.json')).json(); // sea, islands and major roads from OpenStreetMap (tools/build_basemap.py)
const travel = new Travel(); travel.google.ok = false; // the story's numbers are checked against the road model (tools/demo-check.mjs)
const X = makeStory(net, travel), bg = new Sim(net, travel);
const { A, A2, B, E1, t1, p1, search: SR, cand: PICK } = X, E3 = PICK.e;
const shortN = n => n.replace(/\s+(Cycle|Kindergarten|KG).*$/i, '').trim(), short = s => shortN(s.name);
const zn = id => X.zones[id].name, hubName = id => X.zones[id].hub.name.split(/[,(]/)[0].trim();
const fmtDT = t => `${fmtDate(dayOf(t))} ${fmtT(t)}`;
const mins = m => `${Math.round(m)} min`;
const lerp = (a, b, f) => ({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });
const clamp01 = x => Math.max(0, Math.min(1, x));
const OUT_TXT = {
  fixed: 'Panel input board reseated, firmware input profile reset to HDMI 2. Tested with the teacher laptop and the class PC. Working.',
  part: 'Panel HDMI input board faulty. Replacement board ordered from the depot; revisit booked. Class moved to the spare room for today.',
  vendor: 'Panel will not power past the logo screen. Under warranty: vendor engineer requested, loan panel to be delivered.',
};
const DESC = 'The smart board in room 2.14 shows "No signal" from my laptop. I tried a second HDMI cable and restarting the board. My Grade 9 class cannot see the lesson.';

// ---------- state
const S = { i: 0, t: 405, anim: null, tab: null, who: null, outcome: 'fixed', approved: false, rejected: false, signed: false, csat: 0, offerDeclined: false, ai: {}, desc: DESC, room: '2.14', portalSchool: null };

// ---------- chapters (a real sequence, so they are numbered on the rail)
const CH = [
  { id: 'intro', act: 'Morning', short: 'The service', t: 405, screen: 'ops', who: 'e1' },
  { id: 'roster', act: 'Morning', short: 'Roster', t: T.roster, screen: 'ops', who: 'e1' },
  { id: 'log', act: 'One ticket', short: 'Teacher reports', t: T.log - 1, screen: 'portal', who: 'e1' },
  { id: 'triage', act: 'One ticket', short: 'Desk triage', anim: [T.log, T.remoteEnd], dur: 5000, screen: 'ops', who: 'e1' },
  { id: 'dispatch', act: 'One ticket', short: 'Dispatch', t: T.remoteEnd, screen: 'ops', who: 'e1' },
  { id: 'drive', act: 'One ticket', short: 'On the way', anim: [t1.depart, t1.arrive], dur: 8000, screen: 'portal', who: 'e1' },
  { id: 'work', act: 'One ticket', short: 'On site', anim: [t1.arrive, t1.workEnd], dur: 9000, screen: 'portal', who: 'e1' },
  { id: 'close', act: 'One ticket', short: 'Sign-off', t: t1.closeAt, screen: 'portal', who: 'e1' },
  { id: 'outage', act: 'Something breaks', short: 'Outage', anim: [T.outage, T.control], dur: 4500, screen: 'portal', who: 'e1' },
  { id: 'search', act: 'Something breaks', short: 'Find nearby', t: T.control, screen: 'ops', who: 'e3' },
  { id: 'move', act: 'Something breaks', short: 'Reassign', t: T.decide, screen: 'ops', who: 'e3' },
  { id: 'drive2', act: 'Something breaks', short: 'Gate check-in', anim: [p1.depart, p1.onsite], dur: 9000, screen: 'ops', who: 'e3' },
  { id: 'restore', act: 'Something breaks', short: 'Restore', anim: [p1.onsite, p1.restored], dur: 8000, screen: 'portal', who: 'e3' },
  { id: 'eod', act: 'Close of day', short: 'Results', t: T.eod, screen: 'ops', who: 'e1' },
];
const IDX = Object.fromEntries(CH.map((c, i) => [c.id, i]));
const ch = () => CH[S.i];
const past = id => S.i > IDX[id], atOrPast = id => S.i >= IDX[id];

// ---------- derived story facts
const out = () => X.outcomes[S.outcome];
const e3Moving = () => atOrPast('drive2');
function engLoc(id, t = S.t) {
  if (id === E1.id) { if (!atOrPast('drive')) return A2.loc; if (t < t1.depart) return A2.loc; return lerp(A2.loc, A.loc, clamp01((t - t1.depart) / (t1.arrive - t1.depart))); }
  if (id === E3.id) { const h = X.hub(E3.zone); if (!e3Moving()) return h; return lerp(h, B.loc, clamp01((t - p1.depart) / (p1.arrive - p1.depart))); }
  if (id === CAST.coverer && t < 440) return X.hub('Z01');
  const st = X.state(X.engs.get(id)); return st.loc;
}
const linkedAt = t => t < T.outage ? 0 : Math.min(p1.linked, 1 + Math.floor((t - T.outage) / 4));
function healthB(t) { // same scoring as Sim.health for a single waiting P1
  if (t < T.outTriage || t >= p1.onsite) return t >= p1.restored || t < T.outage ? 100 : 82;
  const aged = t > p1.dueResp; let h = 100 - (aged ? 22 : 12) - 12; if (aged) h = Math.min(h, 39); return h;
}
const hcol = h => h >= 80 ? MAPCOL.good : h >= 60 ? MAPCOL.watch : h >= 40 ? MAPCOL.risk : MAPCOL.critical;

// ---------- background network
function bgTo(t) {
  if (bg.day !== 0 || bg.t > t + 1) bg.reset();
  let n = 0; while (bg.t < Math.min(t, 899) && n++ < 2000) bg.step();
  if (t >= 900 && !bg.closedDay) { while (!bg.closedDay && n++ < 3000) bg.step(); }
}

// ---------- narration
function narr() {
  const c = ch(), k = (h, rows) => `<div class="real"><h2>${h}</h2><ul>${rows.map(r => `<li>${r}</li>`).join('')}</ul></div>`;
  const cue = txt => `<div class="cue"><span>${txt}</span></div>`;
  const barredCloser = X.barredA.filter(x => x.est.min <= X.trip1.min).length;
  const TX = {
    intro: () => `<div class="when">Mon 26 Oct 2026, 06:45</div><h1>One school day, end to end</h1>
      <p>This demo follows real schools and engineers from the ministry's allocation workbook through one school day in Dubai. You'll see what the teacher sees, what the service desk and dispatch see, and what the engineer sees on their phone.</p>
      <div class="facts"><div><span class="big">${net.sites.filter(s => s.type === 'school').length}</span><small>schools</small></div><div><span class="big">${net.engineers.length}</span><small>field engineers in ${net.zones.length} zones</small></div>
      <div><span class="big">${net.engineers.filter(e => e.gender === 'G').length}</span><small>female engineers</small></div><div><span class="big">${net.engineers.filter(e => /pool/.test(e.kind)).length}</span><small>in hub pools</small></div></div>
      <p>Two rules shape every decision: <b>boys' schools get male engineers and girls' schools get female engineers</b>, and an engineer is only borrowed from the <b>same or a neighbouring zone</b>, within an hour.</p>
      ${k('What the map shows', ['Every school and site in the network: blue boys\', magenta girls\', grey non-school.', 'Dark labels are zone hubs, where pool engineers start and wait between jobs.', 'The rest of the network runs live in the background with the full simulator.'])}
      ${cue('Press Next or the right arrow key to start the day.')}`,
    roster: () => `<div class="when">06:50, before the desk opens</div><h1>The morning roster</h1>
      <p><b>${CAST.absent}</b>, a female engineer paired between Nadd Al Hamar and Al Lisaili, is on leave today. The roster finds cover <b>from the nearest hub first</b>: ${CAST.coverer} from the ${hubName('Z01')} hub, ${mins(travel.get(X.hub('Z01'), X.sites.get('S011').loc, 420, 'Z01', 'Z01').min)} away.</p>
      <p>It keeps at least one engineer in every pool, so ${CAST.poolBusy} stays in the Dubai female pool for schools that have no resident engineer.</p>
      <p>${E1.id} gets her day on the phone: her two schools, ${short(A2)} and ${short(A)}, and the team notice.</p>
      ${k('Real rules', ['Cover is same zone first, then a neighbouring zone, never more than 60 minutes from the hub.', `Across the whole network this morning: ${bgRosterText()}.`])}
      ${cue(`Tap <b>Start shift</b> on ${E1.id}'s phone.`)}`,
    log: () => `<div class="when">08:39, ${short(A)}</div><h1>A teacher reports a fault</h1>
      <p>A Grade 9 lesson can't start: the smart board shows "No signal". The teacher logs it on the school portal. There's no phone queue and no email chain.</p>
      <p>The form is short on purpose. The desk does the categorising; the teacher only says what's wrong, where, and how many people it affects.</p>
      ${k('Behind the form', ['The ticket is tied to the school\'s ID, so the gender rule and coverage are known before anyone reads it.', 'The response clock starts at logging and only counts school hours.'])}
      ${cue('Edit the description if you like, then press <b>Submit</b> on the portal.')}`,
    triage: () => `<div class="when">08:40 to 08:52</div><h1>Service desk triage</h1>
      <p>The desk assistant (a live AI model) reads the teacher's words and proposes a category and priority. The desk agent confirms: <b>classroom display, P2</b>, because a whole class can't be taught.</p>
      <p>The desk always tries a remote fix first. Only ${Math.round(CAT.display.remote * 100)}% of display faults can be fixed remotely. This one isn't: the panel ignores a remote input reset, so it goes to the field.</p>
      ${k('Targets for a P2', [`On site within ${SLA.P2.resp} school minutes: by <b>${fmtT(t1.dueResp)}</b>.`, `Resolved within ${SLA.P2.res} school minutes: by <b>${fmtDT(t1.dueRes)}</b>. The clock stops at 15:00 and restarts at 07:00.`, 'About 55% of the network\'s tickets need a site visit; the rest are closed by the desk.'])}`,
    dispatch: () => `<div class="when">08:52</div><h1>Choosing the engineer</h1>
      <p>${short(A)} is a girls' school, so only female engineers are considered. Its own paired engineer, <b>${E1.id}</b>, is free at ${short(A2)}: ${X.trip1.km} km, <b>${X.trip1.drive} min of driving</b> (${X.trip1.label}) plus ${X.trip1.overhead} min to park and walk in.</p>
      <p>${barredCloser ? `${barredCloser} male engineer${barredCloser > 1 ? 's are' : ' is'} as close or closer, but` : 'The nearest male engineers are'} ruled out by the gender rule. The Dubai female pool is kept for schools with no resident engineer. It's only used if Al Rayah waits more than ${SLA.P2.resp * P.overflowAt} minutes.</p>
      ${k('How the drive time is built', ['Road distance is the straight line × 1.15 to 1.4, depending on trip length.', 'Speed is 30 km/h in the city, 55 km/h suburban and 120 km/h on highways.', 'School-run peaks slow the city part of a trip more than the highway part.', 'Each trip adds 8 min to park and walk in. Visitors also need about 8 min at the school gate; residents have a badge.'])}
      ${cue(`Tap <b>Accept</b> on ${E1.id}'s phone.`)}`,
    drive: () => `<div class="when">${fmtT(t1.depart)} to ${fmtT(t1.arrive)}</div><h1>On the way</h1>
      <p>The teacher can see who is coming and when, without phoning anyone. The engineer's phone shows the route and arrival time; the console shows the engineer moving.</p>
      <p>The clock is sped up, but the drive takes as long as it would on Dubai's roads: <b>${X.trip1.min} minutes door to door</b> for ${X.trip1.km} km.</p>
      ${cue(`When she arrives, tap <b>I've arrived</b> on the phone.`)}`,
    work: () => `<div class="when">From ${fmtT(t1.arrive)}</div><h1>On site, fixing</h1>
      <p>Arrival stops the response clock: <b>${t1.respBiz} min</b> from logging against a ${SLA.P2.resp}-minute target.</p>
      <p>The phone walks the engineer through the checks for this kind of fault. The assistant can suggest next steps from the ticket text. The engineer records how the job ended, which decides what happens next.</p>
      ${k('What each outcome does', [`Fixed: the ticket closes now and resolution is about ${fmtDur(X.outcomes.fixed.resBiz)} of school time.`, `Needs a part: the part comes from the depot by 10:00 the next school day, and a revisit is booked automatically (${X.outcomes.part.resMet ? 'within' : 'outside'} the resolution target).`, `Needs the vendor: a warranty engineer is booked, usually within 4 to 16 school hours.`])}
      ${cue('Tick the checks, try <b>Ask the assistant</b>, choose an outcome, then <b>Continue</b>.')}`,
    close: () => `<div class="when">${fmtT(t1.closeAt)}</div><h1>Sign-off and feedback</h1>
      <p>The teacher signs on the engineer's phone. The job notes and outcome go straight into the ticket, so nobody has to type them up later.</p>
      <p>${S.outcome === 'fixed' ? `Resolved in <b>${fmtDur(out().resBiz)}</b> of school time, inside the ${fmtDur(SLA.P2.res)} target.` : `The ticket stays open while it waits: ${S.outcome === 'part' ? `revisit ${fmtDT(out().revisit)}` : 'vendor visit booked'}, expected closure ${fmtDT(out().closed)}. That is ${out().resMet ? 'inside' : 'outside'} the resolution target, and the dashboard shows it honestly.`}</p>
      ${cue('Sign on the phone and tap <b>Close job</b>. The teacher can rate the visit on the portal.')}`,
    outage: () => `<div class="when">10:41, ${short(B)}</div><h1>A second school goes offline</h1>
      <p>${short(B)}'s network link drops. Teachers start reporting it. Instead of ${p1.linked} separate visits, the desk raises <b>one P1 incident</b> and links every report to it.</p>
      <p>This school is small and has no resident engineer. It is served by the Dubai female pool, and both of that pool's engineers are already committed this morning.</p>
      ${k('P1 targets', [`On site within ${SLA.P1.resp} min: by ${fmtT(p1.dueResp)}.`, `Restored within ${SLA.P1.res} school minutes: by ${fmtT(p1.dueRes)}.`, 'School health falls as the P1 waits and its deadline gets closer.'])}`,
    search: () => `<div class="when">10:45, the 15-minute dispatch check</div><h1>Looking nearby first</h1>
      <p>Dispatch searches outwards from the school. It looks in the same zone first, then in neighbouring zones, and never across the country.</p>
      <p><b>${SR.barred.length} male engineers</b> could be there within an hour but are barred. The nearest is ${SR.barred[0]?.e.id}, ${SR.barred[0]?.eta} min away. The ${SR.busy.length} Dubai female engineers who could otherwise go are busy or covering, and a fourth is on leave. The nearest free female engineer is at the <b>Sharjah hub, ${PICK.eta} min</b> away.</p>
      <p>${X.waitFor ? `Waiting for a Dubai engineer means ${X.waitFor.e.id} finishes at ${fmtT(X.waitFor.until)} and is on site about <b>${fmtT(X.waitFor.until + X.waitFor.est.min + P.checkin)}</b>.` : ''} Moving an engineer across a zone boundary needs an operator's approval.</p>
      ${k('Not considered', [`${SR.zone} engineers in zones that don't border Dubai, including ${SR.zoneEx.length} women in Abu Dhabi, Al Ain and Al Dhafra.`, `${SR.kept} lone resident engineers stay with their own schools.`])}
      ${cue('Approve the move on the operations console.')}`,
    move: () => `<div class="when">${fmtT(T.decide)}</div><h1>Reassigning an engineer</h1>
      <p>${E3.id} is a ${E3.kind === 'nspool' ? 'non-school pool' : 'pool'} engineer at the ${hubName(E3.zone)} hub. Her phone shows the temporary move: where she's going, why she was chosen, and that she returns to Sharjah duties when it's released.</p>
      <p>The same checks run again at the moment of approval. She must still be free, still eligible and still within an hour, so a stale approval can't send the wrong person.</p>
      ${cue(`Tap <b>Accept</b> on ${E3.id}'s phone.`)}`,
    drive2: () => `<div class="when">${fmtT(p1.depart)} to ${fmtT(p1.onsite)}</div><h1>Drive and gate check-in</h1>
      <p>Al Nasseriya to Al Ahmadiah is ${PICK.est.km} km. That's ${PICK.est.drive} min of driving plus parking. She isn't based at this school, so she checks in at the gate with a visitor QR code.</p>
      <p>She is on site at <b>${fmtT(p1.onsite)}</b>, ${p1.respBiz} min after the outage. That is <b>${p1.respMet ? 'inside' : `${p1.respBiz - SLA.P1.resp} min past`}</b> the 30-minute P1 target. The console records the miss rather than hiding it.</p>`,
    restore: () => `<div class="when">${fmtT(p1.onsite)} to ${fmtT(p1.restored)}</div><h1>Restoring service</h1>
      <p>The fault is on the provider's side: the fibre router has no power. She raises it with the ISP's network operations centre and connects the school's 4G backup to the admin office and the exam room.</p>
      <p>When the ISP restores the line at <b>${fmtT(p1.restored)}</b>, all ${p1.linked} linked teacher reports close with the incident. That is ${fmtDur(p1.resBiz)} of school time against a ${fmtDur(SLA.P1.res)} target.</p>`,
    eod: () => `<div class="when">15:00, end of the school day</div><h1>What the day adds up to</h1>
      <p>The console totals the whole network for the day, not just the two tickets we followed.</p>
      <p>${S.outcome === 'fixed' ? `The display ticket met both targets.` : `The display ticket is still open, waiting for the ${S.outcome === 'part' ? 'part' : 'vendor'}.`} The outage ${p1.respMet ? 'met' : `missed its on-site target by ${p1.respBiz - SLA.P1.resp} min, but was restored well within`} its restore target.</p>
      <p>The lesson for planning is structural. Dubai has <b>2 female pool engineers for ${net.sites.filter(s => s.zone === 'Z01' && s.gender === 'G').length} girls' schools</b>. On a day with one absence, the next P1 at a pool-only girls' school has to come from Sharjah.</p>
      ${cue(STATIC ? 'Write the day\'s briefing, or press <b>Start again</b> to replay the day with different choices.' : 'Ask the assistant for the day\'s briefing, or open the live simulator.')}`,
  };
  $('#narr').innerHTML = TX[c.id]();
}
function bgRosterText() {
  const r = bg.log.filter(l => l.day === 0 && l.type === 'roster').length, u = bg.log.filter(l => l.day === 0 && l.type === 'uncovered').length, a = [...bg.engs.values()].filter(e => e.absent).length;
  return `${a} engineers absent, ${r} covers arranged${u ? `, ${u} school${u > 1 ? 's' : ''} left to dispatch only` : ''}`;
}

// ---------- portal
function portal() {
  const c = ch().id, onB = S.portalSchool ? S.portalSchool === 'B' : atOrPast('outage') && c !== 'eod' ? true : false;
  const s = onB ? B : A, showSwitch = atOrPast('outage');
  $('#bUrl').textContent = `School support portal, ${short(s)}`;
  let h = `<div class="ph"><div class="crest">IT</div><div><b>${esc(short(s))}</b><span>IT support, ${zn(s.zone)}</span></div><div class="ar">${esc(s.nameAr || '')}</div></div>`;
  if (showSwitch) h += `<div class="pswitch"><button data-ps="A" class="${!onB ? 'on' : ''}">${esc(short(A))}</button><button data-ps="B" class="${onB ? 'on' : ''}">${esc(short(B))}</button></div>`;
  h += `<div class="pbody">${onB ? portalB() : portalA()}</div>`;
  $('#portal').innerHTML = h;
  $$('[data-ps]').forEach(b => b.onclick = () => { S.portalSchool = b.dataset.ps; portal(); });
  const f = $('#pf'); if (f) { f.onsubmit = ev => { ev.preventDefault(); S.desc = $('#pdesc').value.trim() || DESC; S.room = $('#proom').value; next(); }; }
  $$('.stars button').forEach(b => b.onclick = () => { S.csat = +b.dataset.v; portal(); toast(`Thank you. The visit was rated ${S.csat} out of 5.`); });
}
function portalA() {
  const c = ch().id;
  if (!atOrPast('log')) return `<h2>Good morning</h2><p>No open requests for your school. If something isn't working, report it here and track it to the end.</p><button disabled>Report a problem</button>`;
  if (c === 'log') return `<h2>Report a problem</h2><small>Logged in as a class teacher at ${esc(short(A))}. It takes about a minute.</small>
    <form class="pform" id="pf">
      <label>What isn't working<select><option>Classroom display or smart board</option><option>Teacher laptop</option><option>Wi-Fi or internet</option><option>Printer</option><option>Account or password</option><option>Something else</option></select></label>
      <label>Room<input id="proom" value="${esc(S.room)}"></label>
      <label class="w">Describe the problem<textarea id="pdesc">${esc(S.desc)}</textarea></label>
      <label class="w">Who is affected<div class="radios"><label><input type="radio" name="aff"> Just me</label><label><input type="radio" name="aff" checked> A whole class</label><label><input type="radio" name="aff"> The whole school</label></div></label>
    </form><div class="psubmit"><button form="pf" type="submit">Submit</button><small>You'll get updates here and by SMS.</small></div>`;
  // tracker
  const st = trackA(), steps = ['Logged', 'Desk review', 'Engineer assigned', 'On the way', 'On site', S.outcome === 'fixed' || !atOrPast('close') ? 'Resolved' : 'Waiting'];
  let h = `<h2>Your request</h2><div class="track"><div class="tid">${t1.id}, classroom display, room ${esc(S.room)}</div>
    <div class="steps">${steps.map((x, i) => `<div class="${i < st.n ? 'done' : i === st.n ? 'now' : ''}">${x}</div>`).join('')}</div>
    <div id="pLive">${st.line}</div></div>`;
  h += `<div style="margin-top:10px">${st.msgs.map(m => `<div class="msgline"><span class="t">${fmtT(m[0])}</span><span>${m[1]}</span></div>`).join('')}</div>`;
  if (past('close') || (c === 'close' && S.signed)) h += S.outcome === 'fixed' ? `<div class="banner ok">Resolved at ${fmtT(t1.closeAt)} by ${E1.id}. How was the visit?<div class="stars">${[1, 2, 3, 4, 5].map(v => `<button data-v="${v}" class="${v <= S.csat ? 'on' : ''}" aria-label="${v} stars">★</button>`).join('')}</div>${S.csat ? `<small>Rated ${S.csat} of 5. Ratings feed the school's satisfaction score on the console.</small>` : ''}</div>` : `<div class="banner">${S.outcome === 'part' ? `A replacement part is on order. ${E1.id} returns ${fmtDT(out().revisit)}.` : 'A vendor engineer has been booked under warranty.'} The class has been moved to the spare room.</div>`;
  return h;
}
function trackA() {
  const t = S.t, m = [[T.log, `Request logged. Target: an engineer on site by ${fmtT(t1.dueResp)}.`]];
  if (!atOrPast('triage')) return { n: 0, line: '', msgs: m };
  if (t >= T.triage) m.push([T.triage, 'The service desk tried a remote reset of the board. It did not fix it, so an engineer will come.']);
  if (!atOrPast('dispatch')) return { n: t >= T.triage ? 1 : 1, line: 'The desk is reviewing your request.', msgs: m };
  m.push([T.remoteEnd, `${E1.id} (your school's engineer) has been assigned.`]);
  if (!atOrPast('drive')) return { n: 2, line: `${E1.id} is assigned and will set off shortly.`, msgs: m };
  m.push([t1.depart, `${E1.id} is on the way from ${short(A2)}.`]);
  if (c0('drive') && t < t1.arrive) return { n: 3, line: `<b>${E1.id} is on the way.</b> Expected at <b>${fmtT(t1.arrive)}</b>, <span data-live="left1">${Math.max(0, Math.round(t1.arrive - t))}</span> min from now.`, msgs: m };
  m.push([t1.arrive, `${E1.id} is on site.`]);
  if (!past('work') && !(c0('close') && S.signed)) return { n: 4, line: `<b>${E1.id} is with your class now.</b>`, msgs: m };
  const o = out(); m.push([t1.closeAt, S.outcome === 'fixed' ? 'Resolved. ' + OUT_TXT.fixed : OUT_TXT[S.outcome]]);
  return { n: S.outcome === 'fixed' ? 6 : 5, line: S.outcome === 'fixed' ? `Resolved at ${fmtT(t1.closeAt)}.` : `Open, waiting. Expected to be resolved ${fmtDT(o.closed)}.`, msgs: m };
}
const c0 = id => ch().id === id;
function portalB() {
  const t = S.t, n = linkedAt(t), restored = t >= p1.restored && atOrPast('restore');
  const steps = ['Reported', 'Incident open', 'Engineer approved', 'On the way', 'On site', 'Restored'];
  const k = restored ? 6 : atOrPast('drive2') && t >= p1.onsite ? 4 : atOrPast('drive2') ? 3 : atOrPast('move') ? 2 : t >= T.outTriage ? 1 : 0;
  const msgs = [[T.outage, 'A teacher reported: "No internet in the staff room or classrooms."'], ...(t >= T.outTriage ? [[T.outTriage, `Incident ${p1.id} opened, priority P1. New reports from this school are linked to it.`]] : [])];
  if (atOrPast('move')) msgs.push([T.decide, `An engineer from the Sharjah hub has been approved to come. Expected about ${fmtT(p1.onsite)}.`]);
  if (atOrPast('drive2') && t >= p1.onsite) msgs.push([p1.onsite, `${E3.id} is on site.`]);
  if (atOrPast('restore') && t >= p1.diagEnd) msgs.push([p1.diagEnd, 'The admin office and exam room are back online on the 4G backup. The provider is repairing the fibre line.']);
  if (restored) msgs.push([p1.restored, `Internet restored. All ${p1.linked} reports from this school are closed.`]);
  return `<h2>${restored ? 'Internet restored' : 'Internet is down at this school'}</h2>
    <div class="banner ${restored ? 'ok' : ''}">${restored ? `Fixed at ${fmtT(p1.restored)}. Thank you for your patience.` : `This is a known problem. One incident is open for the whole school. <b><span data-live="nlinked">${n}</span> colleagues</b> have reported it, and every report is linked to the incident, so you don't need to report it again.`}</div>
    <div class="track"><div class="tid">${p1.id}, Wi-Fi and network, whole school</div><div class="steps">${steps.map((x, i) => `<div class="${i < k ? 'done' : i === k ? 'now' : ''}">${x}</div>`).join('')}</div></div>
    <div style="margin-top:10px">${msgs.map(m => `<div class="msgline"><span class="t">${fmtT(m[0])}</span><span>${m[1]}</span></div>`).join('')}</div>`;
}

// ---------- operations console
function kpis() {
  if (S.t < 420) { $('#okpis').innerHTML = [['–', 'tickets logged today'], [`${[...bg.engs.values()].filter(e => !e.absent).length}`, 'engineers on duty'], [`${[...bg.engs.values()].filter(e => e.absent).length}`, 'absent today'], ['07:00', 'service desk opens'], [`${bg.log.filter(l => l.day === 0 && l.type === 'roster').length}`, 'roster covers'], ['0', 'gender rule breaches']].map(([b, s]) => `<div><b>${b}</b><small>${s}</small></div>`).join(''); return; }
  const k = bg.kpis('today');
  $('#okpis').innerHTML = [[k.recv.toLocaleString(), 'tickets logged today'], [k.respPct == null ? '–' : `${Math.round(k.respPct)}%`, 'on site within target'], [k.waiting, 'waiting for an engineer'], [k.busyNow, 'engineers on a job now'], [k.loans + (atOrPast('move') && S.t < p1.restored + 30 ? 1 : 0), 'engineers on loan'], [k.violations, 'gender rule breaches']].map(([b, s]) => `<div><b>${b}</b><small>${s}</small></div>`).join('');
}
function clockCard(label, from, due, stop) {
  const now = Math.floor(stop ?? S.t), used = bizBetween(from, now), tot = bizBetween(from, due), late = now > due;
  return `<div class="${late ? 'late' : ''}"><small>${label}</small><b>${stop != null ? (late ? `Missed by ${bizBetween(due, stop)} min` : `Met, ${used} min`) : late ? `${bizBetween(due, now)} min late` : `${tot - used} min left`}</b><div class="bar"><i style="width:${Math.min(100, used / Math.max(1, tot) * 100)}%"></i></div><small>target ${fmtT(due)}</small></div>`;
}
function opanel() {
  const c = ch().id, t = S.t; let h = '';
  const tag = s => s.type !== 'school' ? '<span class="tag">Non-school</span>' : s.gender === 'G' ? `<span class="tag g">Girls' school</span>` : `<span class="tag b">Boys' school</span>`;
  if (c === 'intro') {
    const z = net.zones.map(z => ({ z, n: net.sites.filter(s => s.zone === z.id).length, f: net.engineers.filter(e => e.zone === z.id && e.gender === 'G').length, m: net.engineers.filter(e => e.zone === z.id && e.gender === 'B').length }));
    h = `<section><h3>Zones <small>sites / male / female engineers</small></h3><table class="res"><tr><th>Zone</th><th>Sites</th><th>M</th><th>F</th></tr>${z.map(r => `<tr><td>${r.z.id} ${esc(r.z.name)}</td><td>${r.n}</td><td>${r.m}</td><td>${r.f}</td></tr>`).join('')}</table></section>
      <section><h3>How engineers are deployed</h3><div class="kv"><span>Dedicated</span><b>${net.engineers.filter(e => e.kind === 'dedicated').length} at one large school</b><span>Paired</span><b>${net.engineers.filter(e => e.kind === 'pair').length} shared by two schools</b><span>Hub pool</span><b>${net.engineers.filter(e => e.kind === 'pool').length} serve small schools from the hub</b><span>Non-school</span><b>${net.engineers.filter(e => e.kind === 'nspool').length} for offices and centres</b></div></section>`;
  } else if (c === 'roster') {
    const cov = travel.get(X.hub('Z01'), X.sites.get('S011').loc, 420, 'Z01', 'Z01');
    h = `<section><h3>Dubai roster, 06:50</h3><div class="appr" style="border-color:var(--girl)"><b>${CAST.absent} on leave</b><br>Nadd Al Hamar and Al Lisaili girls' schools need a female engineer.<br><b>${CAST.coverer}</b> covers from the ${hubName('Z01')} hub, ${cov.min} min at 07:00.</div>
      <div class="kv"><span>Rule</span><b>Same zone first, keep 1 in each pool, 60 min limit</b><span>Dubai female pool</span><b>${CAST.coverer} covering, ${CAST.poolBusy} kept free</b></div></section>
      <section><h3>Across the network</h3><p style="margin:0">${bgRosterText()}.</p><div class="feed">${bg.log.filter(l => l.day === 0 && (l.type === 'roster' || l.type === 'uncovered')).slice(0, 6).map(l => `<div><span class="t">06:50</span>${esc(l.reason)}</div>`).join('')}</div></section>`;
  } else if (c === 'log') {
    h = `<section><h3>Service desk queue <small>live, whole network</small></h3><div class="feed" id="oFeed"></div></section>`;
  } else if (['triage', 'dispatch', 'drive', 'work', 'close'].includes(c)) {
    h = ticketCard();
    if (c === 'dispatch') h += dispatchCard();
  } else if (c === 'outage') {
    h = incidentCard();
  } else if (c === 'search') {
    h = incidentCard(true) + searchCard();
  } else if (['move', 'drive2', 'restore'].includes(c)) {
    h = incidentCard(true) + `<section><h3>Move</h3><div class="kv"><span>Engineer</span><b>${E3.id}, ${E3.kind === 'nspool' ? 'Sharjah non-school pool' : 'Sharjah pool'}, female</b><span>From</span><b>${hubName(E3.zone)} hub</b><span>Trip</span><b>${PICK.est.km} km, ${PICK.est.drive} min driving + ${PICK.est.overhead} parking + ${P.checkin} gate</b><span>Approved</span><b>${fmtT(T.decide)} by the Dubai operator</b><span>Released</span><b>when the incident closes, or 14:30 at the latest</b></div></section>`;
  } else if (c === 'eod') h = eodCard();
  $('#opanel').innerHTML = h;
  if (c === 'search') wireApproval();
  const bb = $('#brief'); if (bb) bb.onclick = brief;
  if (c === 'triage') triageAI();
}
function ticketCard() {
  const c = ch().id, t = S.t, stop = atOrPast('work') ? t1.arrive : null;
  const stage = !atOrPast('dispatch') ? (t < T.triage ? 'Logged, desk reviewing' : 'Remote fix attempted') : c === 'dispatch' ? `Offered to ${E1.id}` : c === 'drive' ? (t < t1.arrive ? 'Engineer on the way' : 'Arrived') : c === 'work' ? 'Engineer on site' : S.outcome === 'fixed' ? 'Resolved' : S.outcome === 'part' ? 'Waiting for a part' : 'Waiting for the vendor';
  const ai = S.ai.triage;
  return `<section><h3>${t1.id} <span class="tag p2">P2</span></h3>
    <div>${esc(short(A))} ${A.type === 'school' ? `<span class="tag g">Girls' school</span>` : ''}</div>
    <div class="kv" style="margin-top:4px"><span>Room</span><b>${esc(S.room)}</b><span>Category</span><b>${CAT.display.name}</b><span>Status</span><b id="oStage">${stage}</b>${atOrPast('dispatch') ? `<span>Engineer</span><b>${E1.id}, female, paired</b>` : ''}</div>
    <div class="clk">${clockCard('On site', T.log, t1.dueResp, stop)}${clockCard('Resolved', T.log, t1.dueRes, past('work') || (c0('close')) ? (S.outcome === 'fixed' ? t1.closeAt : null) : null)}</div>
    ${c === 'triage' ? `<div class="ai" id="aiTriage"><small>Desk assistant (live AI)</small>${ai ? md(ai) : 'Reading the ticket…'}</div><div class="feed"><div><span class="t">08:40</span>Ticket logged from the portal</div>${t >= T.triage ? `<div><span class="t">${fmtT(T.triage)}</span>Desk agent confirms classroom display, P2</div><div><span class="t">${fmtT(T.triage + 1)}</span>Remote input reset sent to the panel</div>` : ''}${t >= T.remoteEnd ? `<div><span class="t">${fmtT(T.remoteEnd)}</span>No change. Sent to field dispatch</div>` : ''}</div>` : ''}
    <div class="ai" style="background:#fff;border:1px solid var(--line2)"><small>Teacher's words</small>${esc(S.desc)}</div></section>`;
}
function dispatchCard() {
  const fem = X.femaleA.filter(x => x.e.id !== CAST.absent).slice(0, 2), bar = X.barredA.slice(0, 3);
  return `<section><h3>Who can go <small>${esc(SR.rule.replace('Girls\' school: ', ''))}</small></h3>
    <div class="cand pick"><b>${E1.id}, at ${esc(short(A2))}</b><span class="m">${X.trip1.min} min</span><span class="why">Al Rayah's own paired engineer, free now. ${X.trip1.km} km, ${X.trip1.drive} min driving (${X.trip1.label}) + ${X.trip1.overhead} min parking. Resident badge, so no gate check-in.</span></div>
    ${fem.map(x => `<div class="cand"><b>${x.e.id}, ${esc(x.where)}</b><span class="m">${x.est.min + P.checkin} min</span><span class="why">Dubai female pool, held for schools with no resident engineer. Used after ${SLA.P2.resp * P.overflowAt} min of waiting.</span></div>`).join('')}
    ${bar.map(x => `<div class="cand no"><b>${x.e.id}, ${esc(shortN(x.where))}</b><span class="m">barred</span><span class="why">Male engineer, ${x.est.min} min away. Not allowed at a girls' school.</span></div>`).join('')}
    </section>`;
}
function incidentCard(compact) {
  const t = S.t, h = healthB(t), restored = t >= p1.restored && atOrPast('restore');
  const stop = atOrPast('drive2') && t >= p1.onsite ? p1.onsite : null;
  return `<section><h3>${p1.id} <span class="tag p1">P1</span></h3><div>${esc(short(B))} <span class="tag g">Girls' school</span> <span class="tag">${B.size || ''}, pool-served</span></div>
    <div class="health"><b style="background:${hcol(h)}" id="hB">${h}</b><div><small>School health</small><div>${restored ? '<span class="tag ok">Restored</span>' : `<span class="chip">P1 waiting</span>${t > p1.dueResp && !stop ? '<span class="chip">past response target</span>' : '<span class="chip">likely to breach</span>'}`}</div></div></div>
    ${compact ? '' : `<div class="kv"><span>Reports linked</span><b><span data-live="nlinked">${linkedAt(t)}</span> of the teachers' tickets</b><span>Served by</span><b>Dubai female pool: ${CAST.coverer}, ${CAST.poolBusy}</b><span>${CAST.coverer}</span><b>covering ${CAST.absent}'s schools</b><span>${CAST.poolBusy}</span><b>on a job at Umm Sqaim until ${fmtT(CAST.poolBusyUntil)}</b></div>`}
    <div class="clk">${clockCard('On site', T.outage, p1.dueResp, stop)}${clockCard('Restored', T.outage, p1.dueRes, restored ? p1.restored : null)}</div></section>`;
}
function searchCard() {
  const ok = SR.ok.slice(0, 3), busy = SR.busy, ap = S.approved;
  return `<section><div class="appr" id="apprBox"><b>Approval needed: cross-zone move</b><br>Send <b>${PICK.e.id}</b> from Sharjah to ${esc(short(B))}, on site about ${fmtT(T.decide + 1 + PICK.eta)}. If nobody decides, it is approved automatically at ${fmtT(T.control + P.autoApproveAfter)}.
      ${S.rejected ? `<div class="banner">Rejected. The P1 waits for ${X.waitFor ? `${X.waitFor.e.id}, on site about ${fmtT(X.waitFor.until + X.waitFor.est.min + P.checkin)}` : 'the next Dubai engineer'}. That's ${X.waitFor ? bizBetween(T.outage, X.waitFor.until + X.waitFor.est.min + P.checkin) : '?'} min after the outage, not ${p1.respBiz}.</div>` : ''}
      <div class="row"><button class="primary" id="apOk">Approve</button><button id="apNo" ${S.rejected ? 'disabled' : ''}>Reject</button></div></div><h3>Search from the school outwards</h3>
    <div class="excl"><b>${SR.barred.length}</b><span>male engineers within an hour, barred by the gender rule. Nearest: ${SR.barred[0].e.id}, ${SR.barred[0].eta} min.</span></div>
    <div class="excl"><b>${busy.length + SR.absent.length}</b><span>Dubai female engineers who could go are busy, covering or on leave:<br>${[...busy.map(b => `${b.e.id} ${esc(b.why)}`), ...SR.absent.map(a => `${a.e.id} on leave`)].join('<br>')}</span></div>
    <div class="excl"><b>${SR.kept}</b><span>lone residents kept at their own schools.</span></div>
    <div class="excl"><b>${SR.zone}</b><span>in zones that don't border Dubai. Not considered.</span></div>
    <h3 style="margin-top:8px">Eligible, nearest first</h3>
    ${ok.map((c, i) => `<div class="cand ${i === 0 ? 'pick' : ''}"><b>${c.e.id}, ${esc(hubName(c.e.zone))} hub</b><span class="m">${c.eta} min</span><span class="why">${c.e.kind === 'nspool' ? 'Non-school pool' : 'School pool'}, ${zn(c.e.zone)}. ${c.cross ? 'Neighbouring zone, so it needs approval.' : ''}</span></div>`).join('')}
    ${X.waitFor ? `<div class="cand no"><b>Wait for ${X.waitFor.e.id}</b><span class="m">${fmtT(X.waitFor.until + X.waitFor.est.min + P.checkin)}</span><span class="why">Free at ${fmtT(X.waitFor.until)}, then a ${X.waitFor.est.min}-min drive.</span></div>` : ''}
</section>`;
}
function wireApproval() { $('#apOk').onclick = () => { S.approved = true; S.rejected = false; toast(`Approved. Checks re-run: ${E3.id} is still free, female and ${PICK.eta} min away.`); next(); }; $('#apNo').onclick = () => { S.rejected = true; opanel(); }; }
function eodCard() {
  const d = bg.days.find(x => x.d === 0) || bg.kpis('today'), loans = bg.log.filter(l => l.day === 0 && l.type === 'allocate').length, esc2 = bg.log.filter(l => l.day === 0 && l.type === 'escalate').length;
  const o = out(), yes = v => v ? '<span class="tag ok">met</span>' : '<span class="tag bad">missed</span>';
  return `<section><h3>Network, ${fmtDate(0)}</h3><div class="kv"><span>Tickets logged</span><b>${d.recv.toLocaleString()}</b><span>Sent to the field</span><b>${d.field.toLocaleString()} (${Math.round(d.field / Math.max(1, d.recv) * 100)}%)</b><span>On site within target</span><b>${d.respN ? Math.round(d.respMet / d.respN * 100) : '–'}%</b><span>Resolved within target</span><b>${d.resN ? Math.round(d.resMet / d.resN * 100) : '–'}%</b><span>Engineers lent to nearby schools</span><b>${loans}</b><span>Escalated to zone leads</span><b>${esc2}</b><span>Gender rule breaches</span><b>${bg.violations}</b></div></section>
    <section><h3>The two tickets we followed</h3><table class="res"><tr><th></th><th>On site</th><th>Resolved</th></tr>
      <tr><td>${t1.id}<br><small>display, P2</small></td><td>${t1.respBiz} min ${yes(t1.respMet)}</td><td>${S.outcome === 'fixed' ? `${fmtDur(o.resBiz)} ${yes(o.resMet)}` : `open, expected ${fmtDT(o.closed)} ${yes(o.resMet)}`}</td></tr>
      <tr><td>${p1.id}<br><small>outage, P1, ${p1.linked} linked</small></td><td>${p1.respBiz} min ${yes(p1.respMet)}</td><td>${fmtDur(p1.resBiz)} ${yes(p1.resMet)}</td></tr></table>${S.csat ? `<small>Teacher rating for the display visit: ${S.csat} of 5.</small>` : ''}</section>
    <section><h3>Briefing</h3><div class="ai" id="briefBox">${S.ai.brief ? md(S.ai.brief) : 'A short, plain-language briefing written from these figures by the live AI model.'}</div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="hlb" id="brief">Write the briefing</button>${STATIC ? '' : '<a href="index.html"><button class="primary">Open the live simulator</button></a>'}<button id="restart">Start again</button></div></section>`;
}

// ---------- engineer phone
function phone() {
  const c = ch().id, who = S.who || ch().who, e = who === 'e3' ? E3 : E1;
  const avail = atOrPast('search') ? ['e1', 'e3'] : ['e1'];
  $('#who').innerHTML = avail.map(w => `<button role="tab" data-w="${w}" aria-selected="${w === who}">${w === 'e1' ? E1.id : E3.id}${w === 'e1' ? ', Dubai' : ', Sharjah'}</button>`).join('');
  $$('#who button').forEach(b => b.onclick = () => { S.who = b.dataset.w; phone(); });
  let st = 'Off shift', body = '';
  if (who === 'e1') ({ st, body } = phoneE1(c)); else ({ st, body } = phoneE3(c));
  const lockC = c === 'intro';
  $('#phone').innerHTML = lockC ? body : `<div class="abar"><span class="st ${st === 'On shift' ? '' : 'on'}">${st}</span><b>MOE Field</b><span>${e.id}, ${e.gender === 'G' ? 'female' : 'male'} engineer, ${e.kind === 'pair' ? 'paired' : e.kind === 'nspool' ? 'non-school pool' : e.kind}</span></div><div class="pscroll">${body}</div>`;
  $('#pcap').textContent = who === 'e1' ? `${E1.id} covers ${short(A2)} and ${short(A)}, ${X.trip1.km} km apart.` : `${E3.id} starts the day at the ${hubName(E3.zone)} hub.`;
  wirePhone();
}
function phoneE1(c) {
  const t = S.t;
  if (c === 'intro') return { body: `<div class="lock"><span>Monday 26 October</span><b>06:45</b><div class="notif"><b>MOE Field</b><br>Your roster for today is ready.</div></div>` };
  if (c === 'roster') return { st: 'Before shift', body: `<div class="card"><h4>Good morning</h4><p>Shift 07:00 to 15:00. Break 12:30.</p><div class="row"><span>First school</span><b>${esc(short(A2))}</b></div><div class="row"><span>Also covering</span><b>${esc(short(A))}</b></div><div class="row"><span>Between them</span><b>${X.trip1.km} km, about ${X.trip1.min} min</b></div></div>
    <div class="card"><h4>Team notice</h4><p>${CAST.absent} is on leave today. ${CAST.coverer} covers Nadd Al Hamar and Al Lisaili.</p></div><button class="pbtn go" data-act="next">Start shift</button>` };
  if (c === 'log' || c === 'triage') return { st: 'On shift', body: `<div class="card"><h4>At ${esc(short(A2))}</h4><p>No open jobs. Preventive checks while you're here:</p>${['Lab 3: printer queue and toner', 'Library: sign-in kiosk update', 'Room 1.08: panel firmware check'].map((x, i) => `<label class="chk"><input type="checkbox" ${i === 0 ? 'checked' : ''}> ${x}</label>`).join('')}</div><div class="card"><div class="row"><span>Jobs today</span><b>0</b></div><div class="row"><span>Next break</span><b>12:30</b></div></div>` };
  if (c === 'dispatch') return { st: 'New job', body: `<div class="card offer"><h4>New job <span class="tag p2">P2</span></h4><p><b>${esc(short(A))}</b>, room ${esc(S.room)}</p><p>${CAT.display.name}: "${esc(S.desc.slice(0, 110))}${S.desc.length > 110 ? '…' : ''}"</p>
    <div class="row"><span>On site by</span><b>${fmtT(t1.dueResp)}</b></div><div class="row"><span>Drive</span><b>${X.trip1.km} km, ${X.trip1.drive} min, ${X.trip1.label}</b></div><div class="row"><span>Parking and walk in</span><b>${X.trip1.overhead} min</b></div><div class="row"><span>You'd arrive</span><b>${fmtT(t1.arrive)}</b></div>
    <button class="pbtn go" data-act="next">Accept</button><button class="pbtn" data-act="decline">I can't take it</button></div>` };
  if (c === 'drive') { const done = t >= t1.arrive; return { st: done ? 'Arrived' : 'On the way', body: navCard(A2.loc, A.loc, t1.depart, t1.arrive, X.trip1, short(A)) + `<button class="pbtn go" data-act="next" ${done ? '' : 'disabled'} id="arrBtn">I've arrived</button><p style="font-size:12px;color:var(--mut);text-align:center">Arrival is confirmed when the phone is inside the school's geofence.</p>` }; }
  if (c === 'work') return { st: 'On site', body: `<div class="card"><h4>${CAT.display.name}, room ${esc(S.room)}</h4><div class="row"><span>Arrived</span><b>${fmtT(t1.arrive)}, on time</b></div><div class="row"><span>Working for</span><b><span data-live="worked">${Math.max(0, Math.round(t - t1.arrive))}</span> min</b></div></div>
    <div class="card"><h4>Checks</h4>${['Input source and wall-plate HDMI', 'Known-good cable and laptop', 'Panel input board and firmware', 'Power cycle and factory input reset'].map(x => `<label class="chk"><input type="checkbox"> ${x}</label>`).join('')}
    <button class="pbtn" data-act="ai">Ask the assistant</button><div class="ai ${S.ai.fix ? '' : 'hidden'}" id="aiFix">${S.ai.fix ? md(S.ai.fix) : ''}</div>${remoteBox()}</div>
    <div class="card"><h4>How did it end?</h4><div class="outs">${Object.entries(X.outcomes).map(([k, o]) => `<button data-out="${k}" class="${S.outcome === k ? 'on' : ''}">${o.label}</button>`).join('')}</div><button class="pbtn go" data-act="next">Continue to sign-off</button></div>` };
  if (c === 'close') return { st: S.signed ? 'Done' : 'Sign-off', body: S.signed ? doneE1() : `<div class="card"><h4>Sign-off: ${X.outcomes[S.outcome].label.toLowerCase()}</h4><textarea class="pnote" aria-label="Job notes">${OUT_TXT[S.outcome]}</textarea><p>Photo attached: panel input board</p></div>
    <div class="card"><h4>Teacher's signature</h4><canvas class="sig" id="sig" width="560" height="220" aria-label="Signature pad"></canvas><button class="link" data-act="autosign" style="margin-top:4px">Sign for the demo</button>
    <button class="pbtn go" data-act="close" id="closeBtn" disabled>${S.outcome === 'fixed' ? 'Close job' : 'Finish visit'}</button></div>` };
  if (c === 'eod') return { st: 'Shift ended', body: dayE1() };
  return { st: 'On shift', body: doneE1() + (atOrPast('outage') && c !== 'eod' ? `<div class="card"><h4>Zone alert</h4><p>Network outage at ${esc(short(B))}. Dispatch is arranging cover. No action needed from you.</p></div>` : '') };
}
// remote support: offered once the AI steps are shown, a Tier 2 specialist joins by video
function remoteBox() {
  if (!S.remote) return `<div id="remoteBox" class="${S.ai.fix ? '' : 'hidden'}"><button class="pbtn hl" data-act="remote">Request remote support</button></div>`;
  const on = S.remote === 'on';
  return `<div id="remoteBox" class="ai rem"><small>Remote support</small><b>${on ? 'Connected' : 'Calling the service desk…'}</b><p>Video call with a Tier 2 display specialist. They see your camera, have the ticket, the AI steps and your checks, and can push panel settings remotely.</p><div class="row"><span>Requested</span><b>${fmtT(S.remoteAt)}</b></div>${on ? '<button class="pbtn" data-act="remoteEnd">End call</button>' : ''}</div>`;
}
function doneE1() {
  const o = X.outcomes[S.outcome];
  return `<div class="card"><h4>${S.outcome === 'fixed' ? 'Job closed' : 'Visit done, ticket on hold'}</h4><div class="row"><span>${t1.id}</span><b>${o.label}</b></div><div class="row"><span>On site after</span><b>${t1.respBiz} min (target ${SLA.P2.resp})</b></div><div class="row"><span>Signed by</span><b>class teacher</b></div></div><div class="card"><h4>Next</h4><p>Back to preventive checks at ${esc(short(A))} until the next job.</p></div>`;
}
function dayE1() {
  return `<div class="card"><h4>Your day</h4><div class="row"><span>Jobs</span><b>1</b></div><div class="row"><span>Driving</span><b>${X.trip1.km} km, ${X.trip1.min} min</b></div><div class="row"><span>On site</span><b>${t1.workEnd - t1.arrive} min</b></div><div class="row"><span>Preventive checks</span><b>3 done</b></div></div><div class="card"><h4>Tomorrow</h4><p>${S.outcome === 'part' ? `Revisit ${esc(short(A))} at ${fmtT(out().revisit)} to fit the part.` : `Start at ${esc(short(A2))}, 07:00.`}</p></div>`;
}
function phoneE3(c) {
  const t = S.t;
  if (c === 'search') return { st: 'On shift', body: `<div class="card"><h4>At the ${esc(hubName(E3.zone))} hub</h4><p>No open jobs. Waiting for dispatch.</p></div><div class="card"><div class="row"><span>Jobs today</span><b>1 done</b></div><div class="row"><span>Zone</span><b>${zn(E3.zone)}</b></div></div>` };
  if (c === 'move') return { st: 'Move request', body: `<div class="card offer"><h4>Temporary move <span class="tag p1">P1</span></h4><p><b>${esc(short(B))}</b>, Dubai. Network down, whole school.</p><p>Approved by Dubai operations at ${fmtT(T.decide)}. You're the nearest free female engineer; this is a girls' school.</p>
    <div class="row"><span>Drive</span><b>${PICK.est.km} km, ${PICK.est.drive} min</b></div><div class="row"><span>Parking and gate</span><b>${PICK.est.overhead + P.checkin} min</b></div><div class="row"><span>On site about</span><b>${fmtT(p1.onsite)}</b></div><div class="row"><span>Back to</span><b>Sharjah duties when released</b></div>
    <button class="pbtn go" data-act="next">Accept</button></div>` };
  if (c === 'drive2') { if (t < p1.arrive) return { st: 'On the way', body: navCard(X.hub(E3.zone), B.loc, p1.depart, p1.arrive, PICK.est, short(B)) };
    const f = clamp01((t - p1.arrive) / P.checkin);
    return { st: 'Gate check-in', body: `<div class="card"><h4>Show this at the gate</h4><p>Visitor check-in at ${esc(short(B))}. Security scans the code and issues a badge.</p>${qr()}<div class="meter"><i style="width:${f * 100}%" data-live="gate"></i></div><p><span data-live="gateTxt">${f >= 1 ? 'Checked in. Go to the server room.' : `About ${Math.ceil(P.checkin * (1 - f))} min`}</span></p></div>` }; }
  if (c === 'restore' || c === 'eod') {
    const steps = [[p1.onsite + 6, 'Fibre router: no power light. Fault is on the provider side'], [p1.onsite + 10, `Raised with the ISP operations centre, reference ISP-58213`], [p1.diagEnd, '4G backup connected: admin office and exam room online'], [p1.restored, `Fibre restored. ${p1.linked} linked reports closed`]];
    return { st: t >= p1.restored ? 'Closed' : 'On site', body: `<div class="card"><h4>${p1.id}, network down</h4><div class="row"><span>On site</span><b>${fmtT(p1.onsite)}</b></div></div><div class="card"><h4>Progress</h4>${steps.map(([tt, x]) => `<label class="chk"><input type="checkbox" disabled ${t >= tt ? 'checked' : ''}> ${t >= tt ? fmtT(tt) + ' ' : ''}${x}</label>`).join('')}</div>${t >= p1.restored ? `<div class="card"><p>Released at ${fmtT(p1.restored)}. Driving back to the ${esc(hubName(E3.zone))} hub.</p></div>` : ''}` };
  }
  return { st: 'On shift', body: `<div class="card"><h4>At the ${esc(hubName(E3.zone))} hub</h4><p>No open jobs.</p></div>` };
}
function navCard(a, b, t0, t1x, est, dest) {
  const W = 280, H = 190, pad = 34, minLat = Math.min(a.lat, b.lat), maxLat = Math.max(a.lat, b.lat), minLng = Math.min(a.lng, b.lng), maxLng = Math.max(a.lng, b.lng);
  const sc = Math.min((W - 2 * pad) / Math.max(1e-4, maxLng - minLng), (H - 2 * pad) / Math.max(1e-4, maxLat - minLat));
  const px = p => [(W - (maxLng - minLng) * sc) / 2 + (p.lng - minLng) * sc, (H + (maxLat - minLat) * sc) / 2 - (p.lat - minLat) * sc];
  const [x0, y0] = px(a), [x1, y1] = px(b), mx = (x0 + x1) / 2 + (y1 - y0) * .18, my = (y0 + y1) / 2 - (x1 - x0) * .18;
  const grid = [...Array(8)].map((_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40 - 30}" y2="${H}" stroke="#D5DCD6"/><line x1="0" y1="${i * 28}" x2="${W}" y2="${i * 28 + 12}" stroke="#DFE4E0"/>`).join('');
  return `<div class="nav"><svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${grid}<path d="M${x0},${y0} Q${mx},${my} ${x1},${y1}" fill="none" stroke="#16233B" stroke-width="4" stroke-linecap="round" opacity=".25"/><path id="navDone" d="M${x0},${y0} Q${mx},${my} ${x1},${y1}" fill="none" stroke="#16233B" stroke-width="4" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100"/>
    <circle cx="${x1}" cy="${y1}" r="7" fill="#A8306F"/><circle id="navDot" cx="${x0}" cy="${y0}" r="7" fill="#FFE88A" stroke="#16233B" stroke-width="2.5"/></svg></div>
    <div class="card" data-q="${x0},${y0},${mx},${my},${x1},${y1}" id="navData" data-t0="${t0}" data-t1="${t1x}"><div class="eta"><span>Arrive ${esc(dest)}</span><b>${fmtT(t1x)}</b></div><div class="row"><span>Remaining</span><b><span data-live="navLeft">${Math.max(0, Math.round(t1x - S.t))}</span> min, <span data-live="navKm">${est.km}</span> km</b></div><div class="row"><span>Traffic</span><b>${est.label}</b></div></div>`;
}
function qr() { let r = '', s = 11; for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) { const f = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13); const on = f ? ((x % 6 === 0 || y % 6 === 0 || (x > 13 && (x - 14) % 6 === 0) || (y > 13 && (y - 14) % 6 === 0)) || ((x % 7 > 1 && x % 7 < 5) && (y % 7 > 1 && y % 7 < 5))) : ((x * 7 + y * 13 + x * y) % 5 < 2); if (on) r += `<rect x="${x * 7}" y="${y * 7}" width="7" height="7"/>`; } return `<svg class="qr" viewBox="0 0 147 147" fill="#16233B" aria-label="Visitor QR code">${r}</svg>`; }
function wirePhone() {
  $$('#phone [data-act]').forEach(b => b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'next') next();
    if (a === 'decline') toast(`Declined. Dispatch offers the job to the next eligible engineer: the Dubai female pool, about ${X.femaleA.find(x => x.e.id !== CAST.absent)?.est.min + P.checkin} min away.`);
    if (a === 'ai') fixAI();
    if (a === 'remote') { S.remote = 'calling'; S.remoteAt = Math.round(S.t); phone(); toast('Remote support requested. The service desk routes the call to a Tier 2 display specialist.'); setTimeout(() => { if (S.remote === 'calling') { S.remote = 'on'; phone(); } }, 1500); }
    if (a === 'remoteEnd') { S.remote = null; phone(); toast('Call ended. The specialist\'s notes are added to the ticket.'); }
    if (a === 'autosign') autosign();
    if (a === 'close') { S.signed = true; render(); toast(S.outcome === 'fixed' ? 'Job closed. The teacher sees it on the portal now.' : 'Visit finished. The ticket stays open and the teacher sees the plan on the portal.'); }
  });
  $$('#phone [data-out]').forEach(b => b.onclick = () => { S.outcome = b.dataset.out; phone(); narr(); portal(); });
  const cv = $('#sig'); if (cv) sigPad(cv);
}
function sigPad(cv) {
  const g = cv.getContext('2d'); g.lineWidth = 4; g.lineCap = 'round'; g.strokeStyle = '#16233B'; let down = false;
  const p = ev => { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) * cv.width / r.width, (ev.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = ev => { down = true; cv.setPointerCapture(ev.pointerId); g.beginPath(); g.moveTo(...p(ev)); };
  cv.onpointermove = ev => { if (!down) return; g.lineTo(...p(ev)); g.stroke(); $('#closeBtn').disabled = false; };
  cv.onpointerup = () => { down = false; };
}
function autosign() {
  const cv = $('#sig'); if (!cv) return; const g = cv.getContext('2d'); g.lineWidth = 4; g.lineCap = 'round'; g.strokeStyle = '#16233B'; g.beginPath();
  for (let i = 0; i <= 120; i++) { const x = 60 + i * 3.6, y = 120 + Math.sin(i / 6) * 38 * Math.sin(i / 40) + (i % 30 < 15 ? -8 : 8); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  $('#closeBtn').disabled = false;
}

// ---------- AI (live, through the server's proxy; key never reaches the browser)
async function ask(messages, onTok) {
  if (STATIC) { await new Promise(r => setTimeout(r, 700)); throw new Error('static'); }
  const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
  if (!r.ok) throw new Error(`AI service returned ${r.status}`);
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', full = '';
  for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) if (l.trim()) { try { full += JSON.parse(l).t; onTok(full); } catch {} } }
  return full;
}
async function triageAI() {
  if (S.ai.triage || S.ai.triageBusy) return; S.ai.triageBusy = true;
  const put = x => { const el = $('#aiTriage'); if (el) el.innerHTML = '<small>Desk assistant (live AI)</small>' + md(x); };
  try { S.ai.triage = await ask([{ role: 'system', content: 'You are the UAE Ministry of Education IT service desk triage assistant. Reply in exactly three short lines, no preamble:\nCategory: one of Classroom display, Teacher laptop, Wi-Fi and network, Printer, Account, Student device, Peripherals and AV, Assessment platform.\nPriority: P1 (whole school or an exam stopped), P2 (a whole class cannot be taught), P3 (one person degraded), P4 (request), with a reason of under 12 words.\nRemote first: one thing the desk can try remotely, and whether a site visit is likely.' }, { role: 'user', content: `School: ${short(A)} (girls' school). Room ${S.room}. Teacher says: ${S.desc}` }], x => { S.ai.triage = x; put(x); }); }
  catch { S.ai.triage = 'Category: Classroom display\nPriority: P2, a whole class cannot be taught\nRemote first: reset the panel input source through device management; a visit is likely if the board ignores it.\n' + (STATIC ? '(Sample text. In the live demo the AI model writes this from the teacher\'s words.)' : '(The AI service was not reachable, so this is the desk\'s standard rule.)'); put(S.ai.triage); }
  S.ai.triageBusy = false;
}
async function fixAI() {
  const el = $('#aiFix'); el.classList.remove('hidden'); el.textContent = 'Thinking…';
  try { S.ai.fix = await ask([{ role: 'system', content: 'You help a school IT field engineer on site. Give 4 numbered steps, each under 14 words, to diagnose the fault described, most likely cause first. No preamble.' }, { role: 'user', content: `Classroom smart panel. ${S.desc}` }], x => { const e2 = $('#aiFix'); if (e2) e2.innerHTML = md(x); }); }
  catch { S.ai.fix = '1. Check the panel input source is set to the wall-plate HDMI.\n2. Test the wall plate with your own laptop and a known-good cable.\n3. Open the panel service menu and check the input board is detected.\n4. Factory-reset the input profile, then update the firmware if offered.'; const e2 = $('#aiFix'); if (e2) e2.innerHTML = md(S.ai.fix); }
  $('#remoteBox')?.classList.remove('hidden');
}
async function brief() {
  const el = $('#briefBox'); el.textContent = 'Writing the briefing…';
  const d = bg.days.find(x => x.d === 0) || {};
  const facts = { network: { logged: d.recv, toField: d.field, onSiteInTargetPct: d.respN && Math.round(d.respMet / d.respN * 100), resolvedInTargetPct: d.resN && Math.round(d.resMet / d.resN * 100), engineersLentToNearbySchools: bg.log.filter(l => l.day === 0 && l.type === 'allocate').length, escalationsToZoneLeads: bg.log.filter(l => l.day === 0 && l.type === 'escalate').length, genderRuleBreaches: bg.violations },
    followed: [{ ticket: t1.id, school: short(A), what: 'classroom display, P2', onSiteMin: t1.respBiz, target: SLA.P2.resp, outcome: X.outcomes[S.outcome].label }, { ticket: p1.id, school: short(B), what: 'network outage, P1, ' + p1.linked + ' linked reports', onSiteMin: p1.respBiz, target: SLA.P1.resp, restoredMin: p1.resBiz, coveredBy: `${E3.id} from the Sharjah hub (cross-zone, approved)`, why: 'both Dubai female pool engineers committed; 47 male engineers nearby barred by the gender rule' }],
    structure: { dubaiGirlsSchools: net.sites.filter(s => s.zone === 'Z01' && s.gender === 'G').length, dubaiFemalePool: 2 } };
  try { S.ai.brief = await ask([{ role: 'system', content: 'Write the end-of-day briefing for the UAE Ministry of Education EUC field service in under 120 words of plain prose, no headings or lists: the headline result, what happened at the two followed tickets and why, and one staffing change worth considering. Respect the rules: boys\' schools male engineers only, girls\' schools female only; borrowing only from the same or a neighbouring zone. Use only the figures given.' }, { role: 'user', content: JSON.stringify(facts) }], x => { el.innerHTML = md(x); }); }
  catch { const n = facts.network; el.innerHTML = md(`${STATIC ? 'Sample briefing. In the live demo the AI model writes this from the same figures.\n\n' : ''}**${n.logged} tickets** were logged across the network and ${n.toField} needed a visit; ${n.onSiteInTargetPct}% of visits arrived within target and the gender rule was never broken. ${n.engineersLentToNearbySchools} engineers were lent to nearby schools and ${n.escalationsToZoneLeads} cases went to zone leads. At ${short(A)} the display fault was reached in ${t1.respBiz} min. At ${short(B)} the internet outage waited on an engineer from the Sharjah hub because both Dubai female pool engineers were committed: on site in ${p1.respBiz} min against a 30-minute target, restored in ${fmtDur(p1.resBiz)}. Consider a third female pool engineer at the Dubai hub.`); }
}

// ---------- map
let map, siteLayer, dyn, engMk = {}, siteMk = new Map(), needScene = true;
function resizeMap() { if (!map || !map.getContainer().clientWidth) return; try { map.invalidateSize({ pan: false, debounceMoveend: true }); map.getCenter(); } catch { map.setView([25.25, 55.4], 10, { animate: false }); } }
function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true, zoomSnap: 0.25 }).setView([25.25, 55.4], 10);
  L.control.zoom({ position: 'topright' }).addTo(map);
  basemap();
  siteLayer = L.layerGroup().addTo(map); dyn = L.layerGroup().addTo(map);
  for (const s of net.sites) { const m = L.circleMarker([s.lat, s.lng], { radius: 3, weight: 1, color: '#fff', fillOpacity: .9, fillColor: gcol(s) }).bindTooltip(esc(s.name)); m.addTo(siteLayer); siteMk.set(s.id, m); }
  for (const z of net.zones) L.marker([z.hub.lat, z.hub.lng], { icon: L.divIcon({ className: '', html: `<span class="hubic">${z.id} hub</span>`, iconSize: [52, 16], iconAnchor: [26, -6] }) }).addTo(siteLayer);
}
// Vector basemap: no tile server needed, so the map looks the same offline and inside the published page.
const PLACES = [['Dubai', 25.2, 55.29], ['Sharjah', 25.335, 55.43], ['Ajman', 25.4, 55.5], ['Umm Al Quwain', 25.54, 55.62], ['Ras Al Khaimah', 25.76, 55.97], ['Fujairah', 25.13, 56.3], ['Abu Dhabi', 24.45, 54.4], ['Al Ain', 24.2, 55.72], ['Madinat Zayed', 23.68, 53.71], ['Persian Gulf', 25.6, 54.6]];
function basemap() {
  const pair = a => { const o = []; for (let i = 0; i < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; };
  map.createPane('base'); map.getPane('base').style.zIndex = 250; map.createPane('baselbl'); map.getPane('baselbl').style.zIndex = 390; map.getPane('baselbl').style.pointerEvents = 'none';
  const r = L.canvas({ pane: 'base', padding: .3 }), o = { renderer: r, interactive: false };
  for (const p of BASE.sea) L.polygon(pair(p), { ...o, stroke: true, color: '#A9C3D6', weight: 1, fillColor: '#D4E4EE', fillOpacity: 1 }).addTo(map);
  for (const p of BASE.islands) L.polygon(pair(p), { ...o, stroke: true, color: '#A9C3D6', weight: 1, fillColor: '#F1F2EC', fillOpacity: 1 }).addTo(map);
  for (const l of BASE.primary) L.polyline(pair(l), { ...o, color: '#FFFFFF', weight: 2.2, opacity: .95 }).addTo(map);
  for (const l of BASE.motorway) L.polyline(pair(l), { ...o, color: '#C7CFD9', weight: 4.5 }).addTo(map);
  for (const l of BASE.motorway) L.polyline(pair(l), { ...o, color: '#FFFFFF', weight: 2.6 }).addTo(map);
  for (const [n, la, lo] of PLACES) L.marker([la, lo], { pane: 'baselbl', interactive: false, keyboard: false, icon: L.divIcon({ className: '', html: `<span class="place${n === 'Persian Gulf' ? ' sea' : ''}">${n}</span>`, iconSize: [140, 20], iconAnchor: [70, 10] }) }).addTo(map);
  map.attributionControl.addAttribution(BASE.attribution);
}
const gcol = s => s.type !== 'school' ? '#9AA8BC' : s.gender === 'G' ? '#A8306F' : '#2457A6';
function mapScene() {
  needScene = false; resizeMap(); const c = ch().id; dyn.clearLayers(); engMk = {};
  $('#mlegend').innerHTML = c === 'intro' ? `<span><i style="background:#2457A6"></i>Boys' school</span><span><i style="background:#A8306F"></i>Girls' school</span><span><i style="background:#9AA8BC"></i>Non-school site</span>` : `<span><i style="background:${MAPCOL.good}"></i>School health good</span><span><i style="background:${MAPCOL.watch}"></i>Watch</span><span><i style="background:${MAPCOL.critical}"></i>Critical</span><span><i style="background:#FFE88A;border:2px solid #16233B"></i>Engineer we follow</span>`;
  if (c === 'intro') { for (const [id, m] of siteMk) m.setStyle({ fillColor: gcol(X.sites.get(id)), radius: 3 }); map.fitBounds(L.latLngBounds(net.sites.map(s => [s.lat, s.lng])), { padding: [20, 20], animate: false }); return; }
  const lbl = (s, cls = 'g', dir = 'top') => L.circleMarker([s.loc.lat, s.loc.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#A8306F', fillOpacity: 1 }).bindTooltip(esc(short(s)), { permanent: true, direction: dir, className: 'lbl ' + cls, offset: dir === 'top' ? [0, -8] : [8, 0] }).addTo(dyn);
  const line = (a, b, o) => L.polyline([[a.lat, a.lng], [b.lat, b.lng]], o).addTo(dyn);
  const eng = (id, label, cls = 'e') => { engMk[id] = L.circleMarker([0, 0], { radius: 6, color: '#16233B', weight: 2.5, fillColor: '#FFE88A', fillOpacity: 1 }).bindTooltip(label, { permanent: true, direction: 'bottom', className: 'lbl ' + cls, offset: [0, 8] }).addTo(dyn); };
  const focus = pts => map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { padding: [50, 50], maxZoom: 13, animate: false });
  if (c === 'roster') { const s11 = X.sites.get('S011'), s12 = X.sites.get('S012'); lbl(s11); lbl(s12); lbl(A2, 'g', 'right'); line(X.hub('Z01'), s11.loc, { color: '#D98200', weight: 3, dashArray: '6 6' }); eng(E1.id, E1.id); eng(CAST.coverer, CAST.coverer, ''); engMk[CAST.coverer].setStyle({ fillColor: '#fff' }); focus([X.hub('Z01'), s11.loc, s12.loc, A2.loc, A.loc]); }
  else if (['log', 'triage', 'dispatch', 'drive', 'work', 'close'].includes(c)) {
    lbl(A, 'g hl'); lbl(A2, 'g', 'right'); eng(E1.id, E1.id);
    if (c === 'dispatch') { line(A2.loc, A.loc, { color: '#16233B', weight: 4 }); for (const x of X.barredA.slice(0, 3)) { const p = X.posOf(x.e); line(p, A.loc, { color: '#C8372D', weight: 2, dashArray: '4 6' }); L.circleMarker([p.lat, p.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#2457A6', fillOpacity: 1 }).bindTooltip(`${x.e.id}: male, barred`, { direction: 'top' }).addTo(dyn); } }
    if (c === 'drive') engMk.trail = L.polyline([], { color: '#16233B', weight: 4 }).addTo(dyn);
    focus([A.loc, A2.loc]);
  } else if (['outage', 'search', 'move', 'drive2', 'restore'].includes(c)) {
    lbl(B, 'g hl'); L.marker([B.loc.lat, B.loc.lng], { icon: L.divIcon({ className: '', html: '<div class="pulse"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(dyn);
    const pts = [B.loc, X.hub('Z02'), X.hub('Z01')];
    if (c === 'search') {
      for (const x of SR.barred.slice(0, 6)) { const p = X.state(x.e).loc; line(p, B.loc, { color: '#C8372D', weight: 1.5, dashArray: '3 6', opacity: .8 }); L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 1, fillColor: '#2457A6', fillOpacity: 1 }).bindTooltip(`${x.e.id}: male, ${x.eta} min, barred`).addTo(dyn); }
      for (const b of SR.busy) { const p = X.state(b.e).loc; line(p, B.loc, { color: '#5B6B82', weight: 2, dashArray: '1 6' }); L.circleMarker([p.lat, p.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#A8306F', fillOpacity: 1 }).bindTooltip(`${b.e.id}: ${b.why}`).addTo(dyn); }
      for (const o of SR.ok.slice(1, 3)) line(X.state(o.e).loc, B.loc, { color: '#16233B', weight: 1.5, opacity: .5 });
      line(X.hub(E3.zone), B.loc, { color: '#C9A800', weight: 6, opacity: .8 });
    }
    if (c === 'drive2') engMk.trail = L.polyline([], { color: '#16233B', weight: 4 }).addTo(dyn);
    eng(E3.id, E3.id);
    focus(pts);
  } else if (c === 'eod') { map.fitBounds(L.latLngBounds(net.sites.filter(s => ['Z01', 'Z02', 'Z03'].includes(s.zone)).map(s => [s.lat, s.lng])), { padding: [20, 20], animate: false }); }
  mapTick(true);
}
let lastHealth = 0;
function mapTick(force) {
  for (const [id, m] of Object.entries(engMk)) {
    if (id === 'trail') continue; const p = engLoc(id); if (p) m.setLatLng([p.lat, p.lng]);
  }
  if (engMk.trail) { const c = ch().id, from = c === 'drive' ? A2.loc : X.hub(E3.zone), id = c === 'drive' ? E1.id : E3.id, p = engLoc(id); engMk.trail.setLatLngs([[from.lat, from.lng], [p.lat, p.lng]]); }
  const now = performance.now();
  if (ch().id !== 'intro' && (force || now - lastHealth > 1200)) { lastHealth = now;
    for (const [id, m] of siteMk) { const s = bg.sites.get(id), h = id === B.id && atOrPast('outage') ? healthB(S.t) : S.t < 420 ? 100 : s.health; m.setStyle({ fillColor: hcol(h), radius: id === B.id ? 6 : 3 }); } }
}

// ---------- live fields (no full re-render, so form fields and the signature pad survive)
function live() {
  const t = S.t, set = (k, v) => $$(`[data-live="${k}"]`).forEach(el => { el.textContent = v; });
  $('#dClk').textContent = fmtT(t); $('#pTime').textContent = fmtT(t); $('#dDate').textContent = `${fmtDate(dayOf(t))} 2026`;
  set('left1', Math.max(0, Math.round(t1.arrive - t))); set('worked', Math.max(0, Math.round(t - t1.arrive))); set('nlinked', linkedAt(t));
  const nd = $('#navData');
  if (nd) { const t0 = +nd.dataset.t0, t1x = +nd.dataset.t1, f = clamp01((t - t0) / (t1x - t0)), [x0, y0, mx, my, x1, y1] = nd.dataset.q.split(',').map(Number);
    const u = 1 - f, x = u * u * x0 + 2 * u * f * mx + f * f * x1, y = u * u * y0 + 2 * u * f * my + f * f * y1; const dot = $('#navDot'); if (dot) { dot.setAttribute('cx', x); dot.setAttribute('cy', y); }
    const dn = $('#navDone'); if (dn) dn.setAttribute('stroke-dasharray', `${f * 100} 100`);
    set('navLeft', Math.max(0, Math.round(t1x - t))); const km = ch().id === 'drive' ? X.trip1.km : PICK.est.km; set('navKm', (km * (1 - f)).toFixed(1)); }
  const ab = $('#arrBtn'); if (ab) ab.disabled = t < t1.arrive;
  const of = $('#oFeed'); if (of) of.innerHTML = bg.feed.slice(-14).reverse().map(f => `<div><span class="t">${fmtT(f.t)}</span>${esc(short(f.s))}: ${esc(CAT[f.tk.cat].name)}, ${f.tk.pr}${f.k === 'dispatch' ? ', to field' : f.k === 'remote' ? ', fixed remotely' : f.k === 'onsite' ? ', engineer on site' : f.k === 'closed' ? ', resolved' : ''}</div>`).join('');
}

// ---------- flow
function render() {
  const c = ch();
  $('#rail').innerHTML = CH.map((x, i) => `<li><span class="act">${i === 0 || CH[i - 1].act !== x.act ? x.act : ''}</span><button data-i="${i}" class="${i === S.i ? 'on' : i < S.i ? 'done' : ''}" ${i === S.i ? 'aria-current="step"' : ''}>${i + 1}. ${x.short}</button></li>`).join('');
  const scr = S.tab || c.screen;
  $$('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.s === scr)); $$('.pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + scr));
  if (scr === 'ops') { resizeMap(); if (needScene) { needScene = false; setTimeout(() => { resizeMap(); mapScene(); }, 0); } }
  narr(); portal(); opanel(); phone(); kpis(); live();
  $('#prev').disabled = S.i === 0; $('#next').textContent = S.i === CH.length - 1 ? 'Start again' : 'Next';
  const rs = $('#restart'); if (rs) rs.onclick = () => go(0);
}
function go(i, animate = false) {
  if (S.anim) { cancelAnimationFrame(S.anim.raf); S.anim = null; }
  if (i <= IDX.work) S.signed = false;
  if (i === 0) Object.assign(S, { outcome: 'fixed', approved: false, rejected: false, signed: false, csat: 0, portalSchool: null });
  S.i = i; S.tab = null; S.who = null; S.portalSchool = null;
  const c = ch();
  if (c.anim) S.t = animate ? c.anim[0] : c.anim[1]; else S.t = c.t;
  bgTo(Math.floor(S.t)); needScene = true;
  render();
  if (c.id === 'dispatch' || c.id === 'move') { const f = $('#phoneFrame'); f.classList.remove('buzz'); void f.offsetWidth; f.classList.add('buzz'); }
  if (c.anim && animate) runAnim(c);
}
function runAnim(c) {
  const [a, b] = c.anim, t0 = performance.now(), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, dur = reduce ? 600 : c.dur;
  let lastBg = 0, lastRender = 0, phase = null;
  const stepf = now => {
    const f = clamp01((now - t0) / dur); S.t = a + (b - a) * f;
    if (now - lastBg > 250) { lastBg = now; bgTo(Math.floor(S.t)); kpis(); }
    live(); mapTick();
    // re-render the parts whose structure changes with time, at most a few times a second
    const ph = phaseOf(c.id, S.t); if (ph !== phase || (now - lastRender > 900 && ['triage', 'outage', 'restore'].includes(c.id))) { phase = ph; lastRender = now; portal(); if (c.id !== 'work') phone(); if (!['search'].includes(c.id)) opanel(); }
    if (f < 1) S.anim.raf = requestAnimationFrame(stepf); else { S.anim = null; S.t = b; bgTo(b); render(); mapTick(true); }
  };
  S.anim = { raf: requestAnimationFrame(stepf) };
}
function phaseOf(id, t) {
  if (id === 'triage') return t >= T.remoteEnd ? 3 : t >= T.triage ? 2 : 1;
  if (id === 'drive') return t >= t1.arrive ? 2 : 1;
  if (id === 'drive2') return t >= p1.onsite ? 3 : t >= p1.arrive ? 2 : 1;
  if (id === 'restore') return t >= p1.restored ? 4 : t >= p1.diagEnd ? 3 : t >= p1.onsite + 10 ? 2 : 1;
  if (id === 'outage') return t >= T.outTriage ? 2 : 1;
  return 0;
}
function finishAnim() { if (!S.anim) return false; cancelAnimationFrame(S.anim.raf); S.anim = null; S.t = ch().anim[1]; bgTo(S.t); render(); mapTick(true); return true; }
function next() {
  if (finishAnim()) return;
  const c = ch().id;
  if (c === 'close' && !S.signed) { S.signed = true; render(); return; }
  if (c === 'search') S.approved = true;
  if (S.i === CH.length - 1) return go(0);
  go(S.i + 1, true);
}
function prev() { if (S.anim) finishAnim(); if (S.i > 0) go(S.i - 1, false); }

$('#next').onclick = next; $('#prev').onclick = prev;
$('#rail').onclick = ev => { const b = ev.target.closest('[data-i]'); if (b) go(+b.dataset.i, false); };
$('#tabs').onclick = ev => { const b = ev.target.closest('[data-s]'); if (!b) return; S.tab = b.dataset.s; render(); };
if (!window.DEMO_PRESENT) document.addEventListener('keydown', ev => {
  if (ev.target.closest('input,textarea,select')) return;
  if (ev.key === 'ArrowRight' || ev.key === 'PageDown') { ev.preventDefault(); next(); }
  if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); prev(); }
});
initMap(); bgTo(405); go(0);
window.demo = { S, X, bg, go, next, prev, CH, IDX, T, P, SLA, fmtT, fmtDur, short, get map() { return map; }, resizeMap,
  set(o) { Object.assign(S, o); render(); }, autosign, fixAI, brief, finishAnim, get animating() { return !!S.anim; } };
window.dispatchEvent(new Event('demo-ready'));
