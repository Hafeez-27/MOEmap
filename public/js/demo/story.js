// The end-to-end demo story: one school day in Dubai, told with the real network, travel model and allocation rules.
// No DOM here, so it can be checked from Node (tools/demo-check.mjs).
import { P, SLA, CAT, addBiz, bizBetween, fmtT } from '../model.js';
import { eligible, ADJ, ruleText } from '../engine.js';

// Cast, all taken from the workbook allocation. Times are minutes on Mon 26 Oct 2026 (day 0).
export const CAST = {
  zone: 'Z01',
  e1: 'Z01-FE18',          // female paired engineer, Al Rashedia + Al Rayah
  a: 'S020', a2: 'S015',   // ticket school, and where she starts the day
  absent: 'Z01-FE16',      // on leave today
  coverer: 'Z01-FE29',     // Dubai female pool engineer who covers her schools
  poolBusy: 'Z01-FE30', poolBusyAt: 'S041', poolBusyUntil: 690,
  ns: 'Z01-FE32', nsAt: 'NS-03', nsUntil: 710,
  b: 'S024',               // small girls' school served only by the Dubai female pool
};
export const T = { roster: 410, shift: 420, log: 520, triage: 527, remoteEnd: 532, outage: 641, outTriage: 644, control: 645, decide: 646, eod: 900 };
const RES = k => k === 'dedicated' || k === 'pair';

export function makeStory(net, travel) {
  const sites = new Map(net.sites.map(s => [s.id, { ...s, loc: { lat: s.lat, lng: s.lng } }]));
  const engs = new Map(net.engineers.map(e => [e.id, e]));
  const zones = Object.fromEntries(net.zones.map(z => [z.id, z]));
  const C = CAST, A = sites.get(C.a), A2 = sites.get(C.a2), B = sites.get(C.b), E1 = engs.get(C.e1);
  const hub = z => ({ lat: zones[z].hub.lat, lng: zones[z].hub.lng });
  const at = (id, t) => travel.get(sites.get(id).loc, A.loc, t, sites.get(id).zone, A.zone);

  // ---------- ticket 1: classroom display at Al Rayah
  const cat = CAT.display, pr = 'P2';
  const t1 = { id: 'INC-26-104817', siteId: A.id, cat: 'display', pr, created: T.log, dueResp: addBiz(T.log, SLA[pr].resp), dueRes: addBiz(T.log, SLA[pr].res) };
  const trip1 = travel.get(A2.loc, A.loc, T.remoteEnd, A2.zone, A.zone, { rural: A.rural });
  t1.depart = T.remoteEnd + 2; t1.arrive = t1.depart + trip1.min; // residents badge in, no gate check-in
  t1.workEnd = t1.arrive + cat.svc; t1.closeAt = t1.workEnd + P.notes;
  t1.respBiz = bizBetween(T.log, t1.arrive); t1.respMet = t1.respBiz <= SLA[pr].resp;

  // who else could have gone: nearest male engineers are closer but barred by the gender rule
  const posOf = e => RES(e.kind) ? sites.get(e.covers[0]).loc : hub(e.zone);
  const nearA = [...engs.values()].filter(e => e.zone === A.zone && e.id !== E1.id)
    .map(e => ({ e, est: travel.get(posOf(e), A.loc, T.remoteEnd, e.zone, A.zone), where: RES(e.kind) ? sites.get(e.covers[0]).name : `${e.zone} hub` }))
    .sort((x, y) => x.est.min - y.est.min);
  const barredA = nearA.filter(x => !eligible(x.e, A)), femaleA = nearA.filter(x => eligible(x.e, A));

  // outcomes for ticket 1 (presenter's choice on the phone)
  const partsBack = 1 * 1440 + P.partsReadyAt, vendorBack = addBiz(t1.closeAt, 8 * 60);
  const outcomes = {
    fixed: { label: 'Fixed on site', closed: t1.closeAt, resBiz: bizBetween(T.log, t1.closeAt) },
    part: { label: 'Needs a part', revisit: partsBack, closed: partsBack + 8 + P.revisitMin, resBiz: bizBetween(T.log, partsBack + 8 + P.revisitMin) },
    vendor: { label: 'Needs the vendor', closed: vendorBack, resBiz: bizBetween(T.log, vendorBack) },
  };
  for (const o of Object.values(outcomes)) o.resMet = o.resBiz <= SLA[pr].res;

  // ---------- incident: network link down at Al Ahmadiah
  const p1 = { id: 'INC-26-104902', siteId: B.id, cat: 'net', pr: 'P1', created: T.outage, dueResp: addBiz(T.outage, SLA.P1.resp), dueRes: addBiz(T.outage, SLA.P1.res), linked: 7 };
  const e1Free = outcomesFree(t1);
  // what every engineer is doing at 10:45 (story state; everything else is "at their own school" or "at the hub")
  const state = e => {
    if (e.id === C.absent) return { absent: 'leave' };
    if (e.id === C.coverer) return { cover: true, loc: sites.get('S011').loc, note: `covering ${C.absent}'s schools today` };
    if (e.id === C.poolBusy) return { busyUntil: C.poolBusyUntil, loc: sites.get(C.poolBusyAt).loc, note: `on a job at ${sites.get(C.poolBusyAt).name} until ${fmtT(C.poolBusyUntil)}` };
    if (e.id === C.ns) return { busyUntil: C.nsUntil, loc: sites.get(C.nsAt).loc, note: `on a job at a non-school site until ${fmtT(C.nsUntil)}` };
    if (e.id === C.e1) return { loc: A.loc, at: A.id, free: e1Free <= T.control };
    return { loc: posOf(e), at: RES(e.kind) ? e.covers[0] : null };
  };
  const search = candidatesFor(B, T.control, { engs, sites, travel, state });

  const cand = search.ok[0];
  const p1Trip = cand ? cand.est : null;
  if (cand) { p1.engId = cand.e.id; p1.depart = T.decide + 1; p1.arrive = p1.depart + p1Trip.min; p1.onsite = p1.arrive + P.checkin;
    p1.respBiz = bizBetween(T.outage, p1.onsite); p1.respMet = p1.respBiz <= SLA.P1.resp;
    p1.diagEnd = p1.onsite + 20; p1.restored = p1.diagEnd + 55; p1.resBiz = bizBetween(T.outage, p1.restored); p1.resMet = p1.resBiz <= SLA.P1.res; }
  // the next option if the cross-zone move were refused
  const fallback = search.ok.find(c => !c.cross) || null;
  const waitFor = search.busy.filter(b => b.until).sort((x, y) => (x.until + x.est.min) - (y.until + y.est.min))[0];

  return { sites, engs, zones, hub, A, A2, B, E1, t1, trip1, cat, nearA, barredA, femaleA, outcomes, p1, search, cand, fallback, waitFor, state, posOf };
}
function outcomesFree(t1) { return t1.closeAt; }

// Same rules as Sim.candidates/checkLoan: gender, same or neighbouring zone, within the loan limit, not absent, not covering,
// not tied up for more than 20 more minutes, residents kept where their own school would be left bare.
export function candidatesFor(s, t, { engs, sites, travel, state }) {
  const zones = new Set([s.zone, ...(ADJ[s.zone] || [])]), out = { ok: [], barred: [], far: [], zone: 0, zoneEx: [], busy: [], kept: 0, absent: [] };
  for (const e of engs.values()) {
    const st = state(e);
    if (!zones.has(e.zone)) { out.zone++; if (eligible(e, s)) out.zoneEx.push(e); continue; }
    if (st.absent) { if (eligible(e, s)) out.absent.push({ e, why: `on ${st.absent}` }); continue; }
    if (!st.loc) continue;
    const est = travel.get(st.loc, s.loc, t, e.zone, s.zone, { rural: s.rural }), eta = est.min + P.checkin;
    if (!eligible(e, s)) { if (eta <= P.maxLoanEta) out.barred.push({ e, est, eta }); continue; }
    if (st.cover) { out.busy.push({ e, est, eta, why: st.note }); continue; }
    const remaining = st.busyUntil ? Math.max(0, st.busyUntil - t) : 0;
    if (remaining > 20) { out.busy.push({ e, est, eta, why: st.note, until: st.busyUntil }); continue; }
    if (RES(e.kind)) {
      const home = e.covers.map(id => sites.get(id)), partners = [...engs.values()].filter(x => x !== e && RES(x.kind) && x.covers.some(id => e.covers.includes(id))).length;
      if (!partners) { out.kept++; continue; } // a lone resident stays with their own schools
    }
    if (eta + remaining > P.maxLoanEta) { out.far.push({ e, est, eta }); continue; }
    const cross = e.zone !== s.zone, risk = e.kind === 'nspool' ? 4 : e.kind === 'pool' ? 8 : 25;
    out.ok.push({ e, est, eta: eta + remaining, cross, risk, score: eta + remaining + risk + (cross ? 15 : 0), where: RES(e.kind) ? sites.get(e.covers[0]).name : `${e.zone} hub` });
  }
  out.ok.sort((a, b) => a.score - b.score); out.barred.sort((a, b) => a.eta - b.eta); out.far.sort((a, b) => a.eta - b.eta);
  out.rule = ruleText(s);
  return out;
}
