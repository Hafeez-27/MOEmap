// MOE EUC field operations: discrete-time (1 min) simulation of the service desk, field dispatch, workforce and allocation.
import { P, SLA, CATS, CAT, DAY, dayOf, mod, weekday, shiftWindow, nextWorkday, bizBetween, addBiz, ASSESSMENT, fmtT, fmtDur } from './model.js';

// THE gender rule: boys' schools -> male engineers only, girls' schools -> female engineers only. Non-school sites: any.
export const eligible = (e, s) => s.type !== 'school' || e.gender === s.gender;
export const ruleText = s => s.type !== 'school' ? 'Non-school site: any engineer' : s.gender === 'B' ? "Boys' school: male engineers only" : "Girls' school: female engineers only";
export const status = h => h >= 80 ? 'good' : h >= 60 ? 'watch' : h >= 40 ? 'risk' : 'critical';
export const gLabel = g => g === 'G' ? 'F' : 'M';
// Loans may only come from the same zone or a neighbouring one, never across the country.
export const ADJ = { Z01: ['Z02', 'Z03'], Z02: ['Z01', 'Z03', 'Z05'], Z03: ['Z01', 'Z02', 'Z04'], Z04: ['Z03', 'Z05'], Z05: ['Z02', 'Z04'],
  Z06a: ['Z06b', 'Z07a'], Z06b: ['Z06a', 'Z07a'], Z07a: ['Z07b', 'Z06a', 'Z06b'], Z07b: ['Z07a', 'Z08'], Z08: ['Z07b'] };
const RESIDENT = k => k === 'dedicated' || k === 'pair';
const BUSY = new Set(['travel', 'checkin', 'work', 'notes']);
const HW = P.hourly;

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const newStats = () => ({ recv: 0, field: 0, remote: 0, respN: 0, respMet: 0, sumResp: 0, resN: 0, resMet: 0, revisit: 0, parts: 0, vendor: 0 });

export class Sim {
  constructor(net, travel) { this.net = net; this.travel = travel; this.ls = {}; this.reset(); }
  on(ev, fn) { (this.ls[ev] ||= []).push(fn); }
  emit(ev, d) { (this.ls[ev] || []).forEach(f => f(d)); }

  reset(seed = 7) {
    const R = this.rand = rng(seed);
    this.normal = () => Math.sqrt(-2 * Math.log(R() + 1e-9)) * Math.cos(2 * Math.PI * R());
    this.zones = Object.fromEntries(this.net.zones.map(z => [z.id, { ...z, w: 0 }]));
    this.sites = new Map(); this.engs = new Map();
    for (const s0 of this.net.sites) {
      const s = { ...s0, loc: { lat: s0.lat, lng: s0.lng } };
      if (s.type === 'school') {
        const dev = /Cycle[23]/.test(s.cycle) ? 1 : /Cycle1/.test(s.cycle) ? .5 : .1, age = s.built ? 2026 - s.built : 15;
        s.ageF = age < 5 ? .85 : age < 15 ? 1 : age < 25 ? 1.15 : 1.3; s.devF = dev;
        s.fr = Math.exp(this.normal() * P.frictionSigma);
        s.w = (P.staffWeight * (s.staffN || s.users / 12) + P.studentWeight * s.students * dev) * s.ageF * s.fr;
      } else { s.ageF = 1; s.devF = 0; s.fr = 1; s.w = P.staffWeight * 30; }
      this.zones[s.zone].w += s.w;
      Object.assign(s, { tickets: [], queue: [], closed: [], today: newStats(), days: [], health: 100, status: 'good', lowSince: null, why: [], serv: [], uncovered: false, waiting: 0, aged: 0, projected: 0, p1: 0 });
      this.sites.set(s.id, s);
    }
    for (const e0 of this.net.engineers) {
      const hub = this.zones[e0.zone].hub, home = this.sites.get(e0.covers[0]);
      const e = { ...e0, hubLoc: { lat: hub.lat, lng: hub.lng }, home: home.id, state: 'off', absent: null, leaveLeft: 0, loc: null, at: null,
        task: null, t0: 0, t1: 0, from: null, to: null, segs: [], loan: null, cover: null, loansToday: 0, breakAt: null, breakDone: false, idleSince: 0,
        jobsToday: 0, busyHist: [], pendingMove: null };
      this.engs.set(e.id, e);
    }
    this.t = 410; this.day = 0; this.nextId = 1; this.active = []; this.feed = []; this.log = []; this.nextLog = 1; this.approvals = []; this.recs = [];
    this.hist = []; this.bucket = { desk: 0, field: 0, late: 0 }; this.days = []; this.surges = []; this.pendingKids = []; this.violations = 0;
    this.examOverride = false; this.escCool = new Map(); this.respToday = []; this.stopAtDayEnd = false;
    this.morning(0);
    this.emit('reset');
  }

  // ---------- coverage
  serving(e) { if (e.absent) return []; if (e.loan) return [e.loan.siteId]; if (e.cover) return e.cover; return e.covers; }
  rebuild() {
    for (const s of this.sites.values()) s.serv = [];
    for (const e of this.engs.values()) for (const id of this.serving(e)) this.sites.get(id).serv.push(e);
    this.pools = {};
    for (const e of this.engs.values()) if ((e.kind === 'pool' || e.kind === 'nspool') && !e.absent && !e.loan && !e.cover) (this.pools[e.zone + e.kind + e.gender] ||= []).push(e);
  }
  isExamDay(d = this.day) { return this.examOverride || ASSESSMENT.has(d); }
  where(e) { return e.loc; }
  rule(e, s) { if (eligible(e, s)) return true; this.violations++; return false; }

  // ---------- day boundaries
  morning(d) {
    this.day = d; this.t = d * DAY + 410; this.tf = this.t; this.closedDay = false; const R = this.rand;
    this.examOverride = false; this.surges = []; this.travel.incidents = [];
    for (const e of this.engs.values()) {
      if (e.pendingMove) { const z = this.zones[e.pendingMove]; e.zone = z.id; e.tag = `${z.id}-POOL-${e.gender}`; e.hubLoc = { lat: z.hub.lat, lng: z.hub.lng };
        e.covers = [...this.sites.values()].filter(s => s.group === e.tag).map(s => s.id); if (!e.covers.length) e.covers = [e.home]; e.home = e.covers[0]; e.pendingMove = null; }
      if (e.pendingCovers) { e.covers = e.pendingCovers; e.home = e.covers[0]; e.pendingCovers = null; }
      e.loan = null; e.cover = null; e.loansToday = 0; e.task = null; e.segs = []; e.jobsToday = 0; e.breakDone = false;
      e.state = 'off'; e.at = RESIDENT(e.kind) ? e.home : null; e.loc = RESIDENT(e.kind) ? this.sites.get(e.home).loc : e.hubLoc;
      if (e.leaveLeft > 0) { e.leaveLeft--; e.absent = 'leave'; }
      else if (R() < P.leaveRate / 4) { e.leaveLeft = P.leaveBlock[0] + Math.floor(R() * (P.leaveBlock[1] - P.leaveBlock[0] + 1)) - 1; e.absent = 'leave'; }
      else e.absent = R() < P.sickRate ? 'sick' : null;
      e.breakAt = weekday(d) === 4 ? null : d * DAY + P.breakWindow[0] + Math.floor(R() * (P.breakWindow[1] - P.breakWindow[0]));
    }
    for (const s of this.sites.values()) { s.today = newStats(); s.uncovered = false; s.lowSince = null; }
    this.hist = []; this.respToday = []; this.bucket = { desk: 0, field: 0, late: 0 };
    this.rebuild(); this.rosterCover(d);
    // tickets logged overnight wait for the desk to open
    for (const s of this.sites.values()) {
      const n = this.poisson(this.daily(s) * P.weekday[weekday(d)] * P.offHoursShare);
      for (let i = 0; i < n; i++) { const tk = this.newTicket(s, d * DAY - 600 + Math.floor(R() * 990)); tk.triageEnd = d * DAY + P.shift.start + 5 + Math.floor(R() * 55); }
    }
    this.emit('newDay', d);
  }
  rosterCover(d) {
    const t = d * DAY + P.shift.start, absentRes = [...this.engs.values()].filter(e => e.absent && RESIDENT(e.kind));
    const handled = new Set();
    for (const a of absentRes) {
      const sites = a.covers.filter(id => !handled.has(id) && !this.sites.get(id).serv.some(x => !x.absent && RESIDENT(x.kind)));
      if (!sites.length) continue; sites.forEach(id => handled.add(id));
      const s = this.sites.get(sites[0]);
      const zones = [s.zone, ...(ADJ[s.zone] || [])];
      // same zone first, then a neighbouring zone; never leave a pool empty; never more than an hour away
      const c = [...this.engs.values()].filter(e => !e.absent && !e.cover && !e.loan && (e.kind === 'pool' || e.kind === 'nspool') && zones.includes(e.zone) && eligible(e, s) && (this.pools[e.zone + e.kind + e.gender] || []).length > 1)
        .map(e => ({ e, est: this.travel.get(e.hubLoc, s.loc, t, e.zone, s.zone, { rural: s.rural }) })).filter(x => x.est.min <= 60)
        .sort((x, y) => (x.est.min + (x.e.zone !== s.zone ? 20 : 0)) - (y.est.min + (y.e.zone !== s.zone ? 20 : 0)))[0];
      if (!c) { sites.forEach(id => this.sites.get(id).uncovered = true); this.addLog({ type: 'uncovered', t, siteId: s.id, engId: a.id, reason: `${a.id} is on ${a.absent}. No ${s.gender === 'G' ? 'female' : 'male'} pool engineer in ${s.zone} or a neighbouring zone can be spared within an hour, so ${sites.length > 1 ? 'these schools are' : 'the school is'} served by dispatch only today.` }); continue; }
      if (!sites.every(id => this.rule(c.e, this.sites.get(id)))) continue;
      c.e.cover = sites; this.rebuild();
      this.addLog({ type: 'roster', t, siteId: s.id, engId: c.e.id, eta: c.est, reason: `${a.id} is on ${a.absent}. ${c.e.id} from the ${c.e.zone} hub${c.e.zone !== s.zone ? ' (neighbouring zone)' : ''} covers ${sites.map(id => this.sites.get(id).name).join(' and ')} today, ${c.est.min} min from the hub at 07:00.` });
    }
  }
  startShift(t) {
    for (const e of this.engs.values()) { if (e.absent) { e.state = 'absent'; continue; } e.state = RESIDENT(e.kind) && !e.cover ? 'pm' : 'idle'; e.idleSince = t;
      if (e.cover) this.reposition(e, this.sites.get(e.cover[0]), t); }
  }
  endOfDay() {
    const d = this.day, w = shiftWindow(d), t = w[1];
    for (const e of this.engs.values()) {
      if (e.task) { if (e.state === 'work') e.task.svc = Math.max(5, e.t1 - t); this.requeue(e.task); }
      e.task = null; const busy = e.segs.filter(g => g.k !== 'break' && g.k !== 'return').reduce((a, g) => a + (Math.min(g.t1, t) - g.t0), 0);
      e.busyHist.push({ d, busy, avail: e.absent ? 0 : w[1] - w[0] - (e.breakAt ? P.breakMin : 0) }); if (e.busyHist.length > 30) e.busyHist.shift();
      if (e.loan) this.addLog({ type: 'release', t, siteId: e.loan.siteId, engId: e.id, reason: `Shift ended. ${e.id} returns to normal duties tomorrow.` });
      e.state = 'off';
    }
    this.approvals.filter(a => a.state === 'pending').forEach(a => { a.state = 'expired'; });
    const tot = newStats(); let aged = 0;
    for (const s of this.sites.values()) { s.days.push({ d, ...s.today }); if (s.days.length > 30) s.days.shift(); for (const k in tot) tot[k] += s.today[k]; aged += s.aged; }
    const loans = this.log.filter(l => l.day === d && l.type === 'allocate').length;
    this.days.push({ d, ...tot, aged, loans, onsite: this.median(this.respToday) });
    if (weekday(d) === 4) this.weeklyReview(true);
    this.emit('dayEnd', this.days.at(-1));
  }

  // ---------- main step
  step() {
    const t = this.t, d = dayOf(t), w = shiftWindow(d);
    if (!w) { this.morning(nextWorkday(d)); return 'skip'; }
    if (t >= w[1]) { if (!this.closedDay) { this.endOfDay(); this.closedDay = true; return 'day'; } this.closedDay = false; this.morning(nextWorkday(d)); return 'morning'; }
    if (t < w[0]) { this.t++; this.tf = this.t; return; }
    if (t === w[0]) this.startShift(t);
    this.arrivals(t, d); this.advance(t); this.progress(t, w); this.dispatch(t, w);
    if (t % 5 === 0) { this.health(t); this.snapshot(t); }
    if (t % 15 === 0) { this.controller(t, w); this.approvalsTick(t); }
    this.events(t, w);
    this.t++; this.tf = this.t;
  }
  poisson(l) { let n = 0, L = Math.exp(-l), p = this.rand(); while (p > L && n < 20) { n++; p *= this.rand(); } return n; }
  daily(s) { const z = this.zones[s.zone]; return z.monthlyTickets * P.calibration / 21 * s.w / z.w; }
  catWeights(s, t) {
    const exam = this.isExamDay(), out = [];
    for (const c of CATS) {
      let w = c.share * (c.id === 'student' ? Math.max(.15, s.devF) : 1) * (c.id === 'exam' && exam ? 5 : 1);
      for (const g of this.surges) if (g.until > t && (!g.cat || g.cat === c.id) && (g.siteId ? g.siteId === s.id : g.zone ? g.zone === s.zone && (!g.sites || g.sites.has(s.id)) : true)) w *= g.mult;
      out.push(w);
    }
    return out;
  }
  arrivals(t, d) {
    const m = mod(t), h = Math.min(7, Math.floor((m - P.shift.start) / 60)); if (h < 0) return;
    const fri = weekday(d) === 4, norm = fri ? 60 * (HW[0] + HW[1] + HW[2] + HW[3]) + 60 * HW[4] : 60 * HW.reduce((a, b) => a + b);
    if (fri && m >= 720) return;
    const k = P.weekday[weekday(d)] * (1 - P.offHoursShare) * HW[h] / norm;
    for (const s of this.sites.values()) {
      const cw = this.catWeights(s, t), mult = cw.reduce((a, b) => a + b, 0);
      const n = this.poisson(this.daily(s) * k * mult);
      for (let i = 0; i < n; i++) this.newTicket(s, t, this.pickCat(cw));
    }
    for (let i = this.pendingKids.length - 1; i >= 0; i--) { const c = this.pendingKids[i]; if (c.at <= t) { this.pendingKids.splice(i, 1); const p = this.ticketById(c.parent); if (p && p.stage !== 'closed') { const k2 = this.newTicket(this.sites.get(c.siteId), t, 'net', { linked: p }); } } }
  }
  pickCat(cw) { let r = this.rand() * cw.reduce((a, b) => a + b, 0); for (let i = 0; i < cw.length; i++) { if ((r -= cw[i]) <= 0) return CATS[i].id; } return 'acct'; }
  ticketById(id) { return this.active.find(x => x.id === id); }
  newTicket(s, t, cat, o = {}) {
    cat ||= this.pickCat(this.catWeights(s, t));
    const c = CAT[cat]; let pr = o.pr;
    if (!pr) { let r = this.rand(); const mix = cat === 'exam' && this.isExamDay() ? { P1: .5, P2: .4, P3: .1 } : c.pr; pr = 'P4'; for (const [k, v] of Object.entries(mix)) { if ((r -= v) <= 0) { pr = k; break; } } }
    const tk = { id: this.nextId++, siteId: s.id, cat, pr, created: t, stage: o.linked ? 'linked' : 'triage', triageEnd: t + P.triage[0] + Math.floor(this.rand() * (P.triage[1] - P.triage[0])),
      field: false, dueResp: addBiz(t, SLA[pr].resp), dueRes: addBiz(t, SLA[pr].res), svc: Math.max(5, Math.round(c.svc * Math.exp(this.normal() * .45))),
      engId: null, eta: null, respondedAt: null, resolvedAt: null, revisit: false, incident: !!o.incident, parent: o.linked ? o.linked.id : null, kids: [], forceField: !!o.forceField };
    if (o.linked) o.linked.kids.push(tk.id);
    this.active.push(tk); s.tickets.push(tk); s.today.recv++; this.bucket.desk++;
    this.feedPush({ k: 'logged', t, tk, s });
    return tk;
  }
  feedPush(f) { this.feed.push(f); if (this.feed.length > 400) this.feed.splice(0, 150); }

  advance(t) {
    let closed = false;
    for (const tk of this.active) {
      const s = this.sites.get(tk.siteId);
      if (tk.stage === 'triage' && t >= tk.triageEnd) {
        const c = CAT[tk.cat];
        if (!tk.forceField && this.rand() < c.remote * P.deskSkill) { tk.stage = 'remote'; tk.remoteEnd = t + P.remoteHandle[0] + Math.floor(this.rand() * (P.remoteHandle[1] - P.remoteHandle[0])); s.today.remote++; }
        else { tk.stage = 'queue'; tk.field = true; tk.queuedAt = t; s.queue.push(tk); s.today.field++; this.bucket.field++; this.feedPush({ k: 'dispatch', t, tk, s }); }
      } else if (tk.stage === 'remote' && t >= tk.remoteEnd) { this.close(tk, t, 'remote'); closed = true; }
      else if (tk.stage === 'parts' && t >= tk.readyAt) { tk.stage = 'queue'; tk.revisit = true; tk.svc = P.revisitMin; tk.queuedAt = t; s.queue.push(tk); s.today.revisit++; }
      else if (tk.stage === 'vendor' && t >= tk.vendorAt) { this.close(tk, t, tk.incident ? 'restored' : 'vendor'); closed = true; }
      if (tk.stage === 'closed') closed = true;
    }
    if (closed) this.active = this.active.filter(x => x.stage !== 'closed');
  }
  close(tk, t, how) {
    if (tk.stage === 'closed') return;
    const s = this.sites.get(tk.siteId); tk.stage = 'closed'; tk.resolvedAt = t; tk.how = how;
    const biz = bizBetween(tk.created, t); s.today.resN++; if (biz <= SLA[tk.pr].res) s.today.resMet++;
    s.tickets.splice(s.tickets.indexOf(tk), 1); s.closed.unshift(tk); if (s.closed.length > 40) s.closed.pop();
    for (const id of tk.kids) { const k = this.ticketById(id); if (k) this.close(k, t, 'with incident'); }
    if (how !== 'with incident') this.feedPush({ k: how === 'remote' ? 'remote' : 'closed', t, tk, s, how });
  }
  requeue(tk) { tk.stage = 'queue'; tk.engId = null; tk.eta = null; tk.queuedAt ??= this.t; const s = this.sites.get(tk.siteId); if (!s.queue.includes(tk)) s.queue.push(tk); }

  // ---------- engineers
  seg(e, k, t0, t1, siteId) { e.segs.push({ k, t0, t1, siteId }); }
  pos(e, t = this.t) { return e.state === 'travel' && e.from ? this.posAt(e, t) : e.loc; }
  progress(t, w) {
    for (const e of this.engs.values()) {
      if (e.state === 'absent' || e.state === 'off') continue;
      switch (e.state) {
        case 'travel': if (t >= e.t1) { e.loc = e.to.loc; e.at = e.to.siteId; if (e.task) { const s = this.sites.get(e.task.siteId); if (e.at === s.id && RESIDENT(e.kind) && e.covers.includes(s.id)) this.startWork(e, t); else { e.state = 'checkin'; e.t0 = t; e.t1 = t + P.checkin; e.task.stage = 'checkin'; this.seg(e, 'checkin', t, e.t1, s.id); } } else { e.state = this.restState(e); e.idleSince = t; } } break;
        case 'checkin': if (t >= e.t1) this.startWork(e, t); break;
        case 'work': if (t >= e.t1) { this.finishJob(e, t); e.state = 'notes'; e.t0 = t; e.t1 = t + P.notes; this.seg(e, 'notes', t, e.t1, e.at); } break;
        case 'notes': if (t >= e.t1) { e.state = this.restState(e); e.idleSince = t; } break;
        case 'break': if (t >= e.t1) { e.state = this.restState(e); e.idleSince = t; } break;
        default: // idle / pm
          if (e.breakAt && !e.breakDone && t >= e.breakAt) { e.state = 'break'; e.breakDone = true; e.t0 = t; e.t1 = t + P.breakMin; this.seg(e, 'break', t, e.t1, e.at); break; }
          // an engineer on loan goes to the school they were lent to
          if (e.loan && e.at !== e.loan.siteId) { this.reposition(e, this.sites.get(e.loan.siteId), t); break; }
          // pool engineers stage back at their hub between jobs, so the hub is the natural dispatch point
          if ((e.kind === 'pool' || e.kind === 'nspool') && !e.loan && !e.cover && e.at && t - e.idleSince >= 20 && t < w[1] - 40) this.reposition(e, null, t);
          // residents return to one of their own schools after a loan; paired engineers stay where they are between their two schools
          if (RESIDENT(e.kind) && !e.loan && !e.covers.includes(e.at) && t - e.idleSince >= 5) this.reposition(e, this.sites.get(e.home), t);
      }
    }
  }
  restState(e) { return RESIDENT(e.kind) && e.covers.includes(e.at) && !e.loan ? 'pm' : 'idle'; }
  reposition(e, s, t) {
    const dest = s ? s.loc : e.hubLoc, est = this.travel.get(e.loc, dest, t, e.zone, s ? s.zone : e.zone, { rural: s?.rural });
    if (est.min <= P.minTrip && !s) { e.at = null; e.loc = dest; return; }
    const k = s && e.loan?.siteId === s.id ? 'travel' : 'return';
    e.state = 'travel'; e.t0 = t; e.t1 = t + est.min; e.from = e.loc; e.to = { loc: dest, siteId: s ? s.id : null }; e.at = null; this.seg(e, k, t, e.t1, s ? s.id : 'hub');
  }
  startWork(e, t) {
    const tk = e.task, s = this.sites.get(tk.siteId);
    if (!tk.revisit && tk.respondedAt == null) {
      tk.respondedAt = t; const biz = bizBetween(tk.created, t), met = biz <= SLA[tk.pr].resp;
      s.today.respN++; if (met) s.today.respMet++; else this.bucket.late++; s.today.sumResp += biz; this.respToday.push(biz);
      this.feedPush({ k: met ? 'onsite' : 'late', t, tk, s, e, biz });
    }
    tk.stage = 'work'; e.state = 'work'; e.t0 = t; e.t1 = t + tk.svc; this.seg(e, 'work', t, e.t1, s.id);
  }
  finishJob(e, t) {
    const tk = e.task, s = this.sites.get(tk.siteId), c = CAT[tk.cat], r = this.rand(); e.task = null; e.jobsToday++;
    if (tk.incident) { tk.stage = 'vendor'; tk.vendorAt = t + 60 + Math.floor(this.rand() * 180); this.feedPush({ k: 'isp', t, tk, s, e }); return; }
    if (!tk.revisit && r < c.parts) { tk.stage = 'parts'; tk.readyAt = nextWorkday(dayOf(t)) * DAY + P.partsReadyAt; s.today.parts++; this.feedPush({ k: 'parts', t, tk, s, e }); return; }
    if (!tk.revisit && r < c.parts + c.vendor) { tk.stage = 'vendor'; tk.vendorAt = addBiz(t, (P.vendorHours[0] + this.rand() * (P.vendorHours[1] - P.vendorHours[0])) * 60); s.today.vendor++; this.feedPush({ k: 'vendor', t, tk, s, e }); return; }
    this.close(tk, t, 'field');
  }
  // free = idle, doing preventive checks, or driving back with nothing to do (can be redirected mid-trip)
  free(e) { return !e.absent && (e.state === 'idle' || e.state === 'pm' || (e.state === 'travel' && !e.task && !(e.loan && e.to?.siteId === e.loan.siteId))); }

  dispatch(t, w) {
    const q = []; for (const s of this.sites.values()) for (const tk of s.queue) q.push(tk);
    if (!q.length) return;
    q.sort((a, b) => a.dueResp - b.dueResp);
    const late = t > w[1] - 25;
    for (const tk of q) {
      const s = this.sites.get(tk.siteId), waited = bizBetween(tk.queuedAt, t);
      let best = null;
      const consider = (e, overflow) => {
        if (!this.free(e) || !eligible(e, s)) return;
        const here = e.at === s.id && e.state !== 'travel', est = here ? null : this.travel.get(this.pos(e, t), s.loc, t, e.zone, s.zone, { rural: s.rural });
        const eta = here ? 0 : est.min + (RESIDENT(e.kind) && e.covers.includes(s.id) ? 0 : P.checkin);
        if (late && eta > 0) return; if (overflow && eta > P.maxLoanEta) return;
        if (!best || eta < best.eta) best = { e, eta, est };
      };
      for (const e of s.serv) consider(e, false);
      if (!best && waited >= SLA[tk.pr].resp * P.overflowAt) for (const e of [...(this.pools[s.zone + 'pool' + (s.gender || 'B')] || []), ...(s.type !== 'school' ? this.pools[s.zone + 'nspoolB'] || [] : []), ...(s.type !== 'school' ? this.pools[s.zone + 'nspoolG'] || [] : [])]) consider(e, true);
      // a P1 interrupts lower-priority work by an engineer already at this school
      if (!best && tk.pr === 'P1') { const e = s.serv.find(x => x.state === 'work' && x.at === s.id && x.task && (x.task.pr === 'P3' || x.task.pr === 'P4' || (x.task.pr === 'P2' && x.t1 - t > 15)));
        if (e && eligible(e, s)) { const old = e.task; old.svc = Math.max(5, e.t1 - t); this.requeue(old); const g = e.segs.at(-1); if (g) g.t1 = t; e.task = null; e.state = 'idle'; this.feedPush({ k: 'preempt', t, tk, s, e, old }); best = { e, eta: 0 }; } }
      if (!best) continue;
      if (!this.rule(best.e, s)) continue;
      this.assign(best.e, tk, best, t);
    }
  }
  assign(e, tk, best, t) {
    const s = this.sites.get(tk.siteId); s.queue.splice(s.queue.indexOf(tk), 1);
    tk.engId = e.id; e.task = tk; tk.assignedAt = t;
    if (best.eta === 0) { this.startWork(e, t); return; }
    tk.stage = 'enroute'; tk.eta = t + best.eta; tk.trip = best.est;
    const from = this.pos(e, t); e.state = 'travel'; e.t0 = t; e.t1 = t + best.est.min; e.from = from; e.loc = from; e.to = { loc: s.loc, siteId: s.id }; e.at = null;
    this.seg(e, 'travel', t, e.t1, s.id);
    this.feedPush({ k: 'assigned', t, tk, s, e, eta: best.eta, trip: best.est });
  }

  // ---------- health & allocation
  health(t) {
    for (const s of this.sites.values()) {
      let waiting = 0, aged = 0, projected = 0, p1 = 0, hi = 0, queued = 0, agedP1 = 0, agedP2 = 0;
      for (const tk of s.tickets) {
        if (!tk.field || tk.respondedAt != null || tk.stage === 'parts' || tk.stage === 'vendor') continue;
        waiting++; if (tk.pr === 'P1') p1++; if (tk.pr === 'P1' || tk.pr === 'P2') hi++;
        if (tk.stage === 'queue') queued++;
        if (t > tk.dueResp) { aged++; if (tk.pr === 'P1') agedP1++; if (tk.pr === 'P2') agedP2++; }
        else if (tk.stage === 'queue' ? bizBetween(t, tk.dueResp) < 30 : tk.eta > tk.dueResp) projected++;
      }
      const r = s.today.respN >= 2 ? s.today.respMet / s.today.respN : 1;
      let h = Math.max(0, Math.round(100 - 22 * Math.min(aged, 3) - 12 * Math.min(projected, 2) - (p1 ? 12 : 0) - 35 * (1 - r) - (s.uncovered ? 8 : 0)));
      if (agedP1) h = Math.min(h, 39); else if (agedP2) h = Math.min(h, 59);
      Object.assign(s, { waiting, queued, enroute: waiting - queued, aged, projected, p1, hi, health: h, status: status(h) });
      s.why = [aged && `${aged} past response target`, projected && `${projected} likely to breach`, p1 && `${p1} P1 waiting`, s.uncovered && 'resident engineer absent, no cover', s.today.respN >= 2 && r < .8 && `${Math.round(r * 100)}% on-time today`].filter(Boolean);
      if (h < P.healthTrigger) s.lowSince ??= t; else s.lowSince = null;
    }
  }
  candidates(s, t, opt = {}) {
    const maxEta = opt.maxEta ?? P.maxLoanEta, out = [], ex = { gender: 0, far: 0, busy: 0, zone: 0, nearestBarred: null };
    const zones = new Set([s.zone, ...(ADJ[s.zone] || [])]);
    for (const e of this.engs.values()) {
      if (e.absent || e.state === 'off' || e.loan || e.state === 'break') continue;
      if (this.serving(e).includes(s.id)) continue;
      if (!zones.has(e.zone)) { ex.zone++; continue; }
      if (!eligible(e, s)) { ex.gender++; if (this.free(e)) { const m = this.travel.min(this.pos(e, t), s.loc, t, e.zone, s.zone); if (!ex.nearestBarred || m < ex.nearestBarred.min) ex.nearestBarred = { id: e.id, min: m }; } continue; }
      if (e.loansToday >= 1 || e.cover) { ex.busy++; continue; }
      if (RESIDENT(e.kind) && this.isExamDay()) { ex.busy++; continue; }
      const remaining = this.free(e) ? 0 : BUSY.has(e.state) ? (e.task ? Math.max(0, e.t1 - t) + (e.state === 'travel' ? 60 : 0) : Math.max(0, e.t1 - t)) : 0;
      if (remaining > 20) { ex.busy++; continue; }
      const est = this.travel.get(this.free(e) ? this.pos(e, t) : (e.state === 'travel' && e.to ? e.to.loc : e.loc), s.loc, t + remaining, e.zone, s.zone, { rural: s.rural }), eta = remaining + est.min + P.checkin;
      if (eta > maxEta) { ex.far++; continue; }
      let risk, impact;
      if (RESIDENT(e.kind)) {
        const home = e.covers.map(id => this.sites.get(id)), open = home.reduce((a, h) => a + h.waiting, 0), partners = home[0].serv.filter(x => x !== e && !x.absent && RESIDENT(x.kind)).length;
        if (!partners && open) { ex.busy++; continue; }
        risk = partners ? (open ? 30 : 10) : 35;
        impact = partners ? `${home[0].name} keeps ${partners} engineer${partners > 1 ? 's' : ''} on site (${open} open)` : `${home.map(h => h.name).join(' and ')} ${home.length > 1 ? 'are' : 'is'} left without an on-site engineer (0 open now)`;
      } else if (e.kind === 'pool') { const peers = (this.pools[e.zone + 'pool' + e.gender] || []).length || 1, open = e.covers.reduce((a, id) => a + this.sites.get(id).waiting, 0); risk = 6 + open / peers * 12; impact = `${peers - 1} colleague${peers === 2 ? '' : 's'} left in the ${e.zone} pool, ${open} pool ticket${open === 1 ? '' : 's'} open`; }
      else { risk = 4; impact = 'non-school pool, little impact'; }
      const cross = e.zone !== s.zone, where = e.state === 'travel' ? 'on the road' : e.at ? this.sites.get(e.at)?.name : `${e.zone} hub`;
      out.push({ e, eta: Math.round(eta), est, risk: Math.round(risk), impact, cross, where, score: eta + risk + (cross ? 15 : 0) });
    }
    out.sort((a, b) => a.score - b.score); out.ex = ex; return out;
  }
  controller(t, w) {
    for (const e of this.engs.values()) {
      if (!e.loan) continue; const s = this.sites.get(e.loan.siteId);
      if (t >= w[1] - 30 || (s.waiting === 0 && t - e.loan.since >= P.minLoan && this.free(e))) this.release(e, t, s.waiting ? 'shift ending' : 'queue cleared');
    }
    if (t > w[1] - 60) return;
    const hot = [...this.sites.values()].filter(s => s.waiting > 0 && ((s.projected + s.aged >= 1 && (s.hi || s.waiting >= 2)) || (s.lowSince != null && t - s.lowSince >= 30 && (s.hi || s.waiting >= 3)))).sort((a, b) => a.health - b.health);
    for (const s of hot.slice(0, 6)) {
      const loans = [...this.engs.values()].filter(e => e.loan?.siteId === s.id).length, enroute = s.tickets.filter(k => k.stage === 'enroute' || k.stage === 'checkin').length;
      if (loans >= 2 || enroute >= s.waiting || this.approvals.some(a => a.siteId === s.id && a.state === 'pending')) continue;
      const c = this.candidates(s, t);
      if (!c.length) { this.escalate(s, t, c.ex); continue; }
      const best = c[0], why = this.explainNeed(s);
      if (best.cross) {
        const ap = { id: this.nextLog, siteId: s.id, engId: best.e.id, t, autoAt: t + P.autoApproveAfter, state: 'pending', eta: best.eta, est: best.est, why, alts: c.slice(1, 4) };
        this.approvals.unshift(ap); this.addLog({ type: 'approval', t, siteId: s.id, engId: best.e.id, reason: `${why} The nearest eligible engineer, ${best.e.id}, is in the neighbouring ${best.e.zone} zone (${best.eta} min). Cross-zone moves need approval.`, ap });
      } else this.applyLoan(best.e, s, t, { auto: true, cands: c, why });
    }
  }
  explainNeed(s) { return `${s.name}: ${s.why.join(', ') || `${s.waiting} waiting`}.`; }
  // Every path (automatic, approval, operator, Copilot) goes through the same checks. "manual" only skips the approval step.
  checkLoan(e, s, t) {
    if (!eligible(e, s)) return `${ruleText(s)}. ${e.id} is ${e.gender === 'G' ? 'female' : 'male'}.`;
    if (e.absent || e.state === 'off' || e.state === 'absent') return `${e.id} is not on duty.`;
    if (e.state === 'break') return `${e.id} is on a break until ${fmtT(e.t1)}.`;
    if (e.loan) return `${e.id} is already on loan.`;
    if (e.cover) return `${e.id} is covering an absent colleague's school today.`;
    if (e.loansToday >= 1) return `${e.id} has already been lent out once today.`;
    if (e.zone !== s.zone && !(ADJ[s.zone] || []).includes(e.zone)) return `${e.id} works in ${e.zone}, which does not border ${s.zone}. Engineers are only borrowed from the same or a neighbouring zone.`;
    const est = this.travel.get(this.pos(e, t), s.loc, t, e.zone, s.zone, { rural: s.rural });
    if (est.min + P.checkin > P.maxLoanEta) return `${e.id} is ${est.min + P.checkin} min away; the limit for a loan is ${P.maxLoanEta} min.`;
    return null;
  }
  applyLoan(e, s, t, { auto = true, cands = [], why = '', manual = false } = {}) {
    const bad = this.checkLoan(e, s, t); if (bad) return { ok: false, reason: bad };
    const est = this.travel.get(this.pos(e, t), s.loc, t, e.zone, s.zone, { rural: s.rural });
    const from = e.state === 'travel' ? 'on the road' : e.at ? this.sites.get(e.at).name : `${e.zone} hub`;
    e.loan = { siteId: s.id, since: t, from }; e.loansToday++; this.rebuild();
    this.travel.refine([{ a: this.pos(e, t), b: s.loc }]);
    let moving = false; if (this.free(e) && e.at !== s.id) { if (e.state === 'travel') { e.loc = this.pos(e, t); e.state = 'idle'; } this.reposition(e, s, t); moving = true; }
    const pick = cands.find(c => c.e === e) || this.candidates(s, t, { maxEta: 999 }).find(c => c.e === e);
    const alts = cands.filter(c => c.e !== e).slice(0, 3).map(c => ({ id: c.e.id, eta: c.eta, where: c.where, risk: c.risk }));
    const entry = this.addLog({ type: manual ? 'manual' : 'allocate', t, siteId: s.id, engId: e.id, eta: est, from, alts, ex: cands.ex,
      reason: `${why} ${e.id} (${e.kind === 'nspool' ? 'non-school pool' : e.kind}, ${gLabel(e.gender)}) comes from ${from}: ${est.km} km, ${est.drive} min driving (${est.label}) + ${est.overhead} min parking + ${P.checkin} min gate check-in.${pick?.impact ? ` Effect elsewhere: ${pick.impact}.` : ''}${moving ? '' : ` Leaves after finishing the current job (about ${fmtT(e.t1)}).`}` });
    return { ok: true, entry, moving, arrives: moving ? e.t1 + P.checkin : null };
  }
  release(e, t, why) {
    const s = this.sites.get(e.loan.siteId); e.loan = null; this.rebuild();
    this.addLog({ type: 'release', t, siteId: s.id, engId: e.id, reason: `${s.name}: ${why}. ${e.id} returns to ${RESIDENT(e.kind) ? this.sites.get(e.home).name : `the ${e.zone} pool`}.` });
    if (this.free(e)) e.idleSince = t - 30;
  }
  escalate(s, t, ex) {
    if (t - (this.escCool.get(s.id) ?? -1e9) < 60) return; this.escCool.set(s.id, t);
    const g = s.gender === 'G' ? 'female' : s.gender === 'B' ? 'male' : '';
    const nb = ex?.nearestBarred && ex.nearestBarred.min <= P.maxLoanEta ? ` The nearest free engineer (${ex.nearestBarred.id}, ${ex.nearestBarred.min} min) is barred by the gender rule.` : '';
    this.addLog({ type: 'escalate', t, siteId: s.id, ex, reason: `${this.explainNeed(s)} No ${g} engineer in ${s.zone} or its neighbouring zones can arrive within ${P.maxLoanEta} min without leaving another school exposed.${nb} Escalated to the zone lead.` });
  }
  approvalsTick(t) { for (const a of this.approvals) if (a.state === 'pending' && P.autoApprove && t >= a.autoAt) this.decide(a.id, true, 'auto-approved after ' + P.autoApproveAfter + ' min'); }
  decide(id, ok, how = 'approved by operator') {
    const a = this.approvals.find(x => x.id === id); if (!a || a.state !== 'pending') return { ok: false, reason: 'This request is no longer pending.' };
    if (!ok) { a.state = 'rejected'; this.addLog({ type: 'info', t: this.t, siteId: a.siteId, engId: a.engId, reason: `Cross-zone move of ${a.engId} rejected by operator.` }); return { ok: true }; }
    const e = this.engs.get(a.engId), s = this.sites.get(a.siteId), still = this.candidates(s, this.t).find(c => c.e === e);
    const bad = this.checkLoan(e, s, this.t) || (!still ? `${e.id} is no longer a good choice (busy or further away now).` : null);
    if (bad) { a.state = 'expired'; this.addLog({ type: 'info', t: this.t, siteId: s.id, engId: e.id, reason: `Approval expired: ${bad} The next 15-minute check will look again.` }); return { ok: false, reason: bad }; }
    a.state = 'approved'; return this.applyLoan(e, s, this.t, { why: `${a.why} (${how})`, cands: [still] });
  }

  // ---------- incidents, scenarios
  events(t, w) {
    const R = this.rand, len = w[1] - w[0];
    if (R() < P.linkOutage * this.sites.size / len) { const sch = [...this.sites.values()].filter(s => s.type === 'school'); this.incident(sch[Math.floor(R() * sch.length)], t); }
    if (R() < P.regionalIsp / len) { const z = this.net.zones[Math.floor(R() * this.net.zones.length)]; this.noc(z.id, .2, `Regional ISP degradation in ${z.name}`); }
    if (R() < P.midShiftSick * this.engs.size / len) { const es = [...this.engs.values()].filter(e => !e.absent && e.state !== 'off'); if (es.length) this.sendHome(es[Math.floor(R() * es.length)], 'fell ill and went home'); }
  }
  incident(s, t) {
    const p = this.newTicket(s, t, 'net', { pr: 'P1', incident: true, forceField: true }); p.triageEnd = t + 3;
    const n = 4 + Math.floor(this.rand() * 7); for (let i = 0; i < n; i++) this.pendingKids.push({ siteId: s.id, at: t + Math.floor(this.rand() * 45), parent: p.id });
    this.addLog({ type: 'incident', t, siteId: s.id, reason: `Network link down at ${s.name}. One P1 site visit raised; ${n} related tickets will be linked to it and close when the ISP restores the link.` });
  }
  // An area-wide ISP fault: one network-operations ticket with the ISP, teachers' tickets linked to it, no site visits.
  noc(zone, frac, label) {
    const R = this.rand, hit = [...this.sites.values()].filter(s => s.zone === zone && s.type === 'school' && R() < frac); if (!hit.length) return;
    const p = this.newTicket(hit[0], this.t, 'net', { pr: 'P1', incident: true }); p.stage = 'vendor'; p.noc = true; p.vendorAt = this.t + 90 + Math.floor(R() * 60);
    let n = 0; for (const s of hit) for (let i = 0, k = 1 + Math.floor(R() * 3); i < k; i++, n++) this.pendingKids.push({ siteId: s.id, at: this.t + Math.floor(R() * 30), parent: p.id });
    this.addLog({ type: 'incident', t: this.t, siteId: hit[0].id, reason: `${label}: ${hit.length} schools affected. One network-operations ticket raised with the ISP (restore expected about ${fmtT(p.vendorAt)}); ${n} teacher tickets will be linked to it. No site visits are sent for a provider-side fault.` });
  }
  surge({ siteId, zone, cat, mult, dur, frac = 1, label }) {
    const sites = zone && frac < 1 ? new Set([...this.sites.values()].filter(s => s.zone === zone && this.rand() < frac).map(s => s.id)) : null;
    this.surges.push({ siteId, zone, cat, mult, until: this.t + dur, sites, label });
    this.addLog({ type: 'incident', t: this.t, siteId, reason: `${label}: ${cat ? CAT[cat].name.toLowerCase() + ' ' : ''}tickets ×${mult} for ${fmtDur(dur)}.` });
  }
  sendHome(e, why) {
    if (e.task) { if (e.state === 'work') e.task.svc = Math.max(5, e.t1 - this.t); this.requeue(e.task); e.task = null; }
    if (e.loan) e.loan = null; e.absent = 'sick'; e.state = 'absent'; e.cover = null; this.rebuild();
    this.addLog({ type: 'absence', t: this.t, engId: e.id, siteId: RESIDENT(e.kind) ? e.home : null, reason: `${e.id} ${why}. Their tickets went back to the dispatch queue.` });
  }
  scenario(name) {
    const R = this.rand, es = () => [...this.engs.values()].filter(e => !e.absent && e.state !== 'off');
    if (name === 'exam') { this.examOverride = true; this.addLog({ type: 'incident', t: this.t, reason: 'Assessment day declared: exam-platform tickets ×5 with more P1s. Resident engineers stay at their schools (no loans out).' }); }
    if (name === 'isp') this.noc('Z02', .3, 'ISP outage across Sharjah');
    if (name === 'flu') { const a = es(); for (let i = 0; i < Math.round(a.length * .12); i++) this.sendHome(a.splice(Math.floor(R() * a.length), 1)[0], 'called in sick (flu wave)'); }
    if (name === 'female') { const a = es().filter(e => e.gender === 'G'); for (let i = 0; i < 8 && a.length; i++) this.sendHome(a.splice(Math.floor(R() * a.length), 1)[0], 'is off (female engineer shortage scenario)'); }
    if (name === 'accident') { this.travel.incidents.push({ zones: ['Z01', 'Z02', 'Z03'], mult: 1.8, until: this.t + 120, label: 'E311 accident congestion' }); this.addLog({ type: 'incident', t: this.t, reason: 'Accident on the E311: travel times in Dubai, Sharjah and Ajman ×1.8 for 2 h.' }); }
    if (name === 'firmware') this.surge({ zone: 'Z07a', cat: 'display', mult: 5, dur: 180, label: 'Smart-panel firmware fault in Abu Dhabi 1' });
  }

  // ---------- weekly review (structural)
  weeklyReview(auto) {
    const pools = {};
    for (const e of this.engs.values()) if (e.kind === 'pool') { const k = e.zone + '|' + e.gender, p = pools[k] ||= { zone: e.zone, gender: e.gender, engs: [], busy: 0, avail: 0 }; p.engs.push(e); for (const h of e.busyHist.slice(-5)) { p.busy += h.busy; p.avail += h.avail; } }
    for (const p of Object.values(pools)) p.util = p.avail ? p.busy / p.avail : 0;
    this.poolStats = pools; this.recs = [];
    for (const g of ['B', 'G']) {
      const ps = Object.values(pools).filter(p => p.gender === g && p.avail > 0).sort((a, b) => a.util - b.util);
      if (ps.length < 2) continue; const lo = ps[0], hi = ps.at(-1);
      if (hi.util - lo.util > .2 && lo.engs.length > 2) this.recs.push({ id: this.recs.length + 1, gender: g, from: lo.zone, to: hi.zone, engId: lo.engs.at(-1).id, fromUtil: lo.util, toUtil: hi.util, state: 'open',
        reason: `${g === 'G' ? 'Female' : 'Male'} pool utilisation over the last 5 days: ${hi.zone} ${Math.round(hi.util * 100)}% vs ${lo.zone} ${Math.round(lo.util * 100)}%. Move one ${g === 'G' ? 'female' : 'male'} pool engineer from ${lo.zone} to ${hi.zone}.` });
    }
    if (auto) this.addLog({ type: 'review', t: this.t, reason: `Weekly review: ${this.recs.length} permanent pool change${this.recs.length === 1 ? '' : 's'} recommended.` });
    return this.recs;
  }
  // Re-pair shared (medium) schools so each paired engineer's two schools are as close as possible, within the same zone and gender.
  pairPlan() {
    const groups = {}, d = (a, b) => this.travel.get(this.sites.get(a).loc, this.sites.get(b).loc, 620, this.sites.get(a).zone, this.sites.get(b).zone).min;
    for (const e of this.engs.values()) if (e.kind === 'pair') { const g = groups[e.zone + e.gender] ||= { zone: e.zone, gender: e.gender, engs: [], sites: [] }; g.engs.push(e); g.sites.push(...e.covers); }
    const cur = [], prop = [], worst = [];
    for (const g of Object.values(groups)) {
      for (const e of g.engs) if (e.covers.length === 2) { const m = d(e.covers[0], e.covers[1]); cur.push(m); worst.push({ e, m, a: e.covers[0], b: e.covers[1] }); }
      const edges = []; for (let i = 0; i < g.sites.length; i++) for (let j = i + 1; j < g.sites.length; j++) edges.push([g.sites[i], g.sites[j], d(g.sites[i], g.sites[j])]);
      edges.sort((x, y) => x[2] - y[2]); const used = new Set(); g.slots = [];
      for (const [a, b, m] of edges) { if (used.has(a) || used.has(b)) continue; if (g.slots.filter(x => x.length === 2).length >= Math.floor(g.sites.length / 2)) break; used.add(a); used.add(b); g.slots.push([a, b]); prop.push(m); }
      for (const id of g.sites) if (!used.has(id)) g.slots.push([id]);
      g.ok = g.slots.length === g.engs.length;
    }
    const med = a => { const x = [...a].sort((p, q) => p - q); return x.length ? x[x.length >> 1] : 0; };
    this.pairing = { groups: Object.values(groups), nPairs: cur.length, over45: cur.filter(m => m > 45).length, curMed: med(cur), newMed: med(prop), curMax: Math.max(...cur), newMax: Math.max(...prop), worst: worst.sort((x, y) => y.m - x.m).slice(0, 5), applied: this.pairing?.applied };
    return this.pairing;
  }
  applyPairPlan() {
    const p = this.pairing || this.pairPlan(); let n = 0;
    for (const g of p.groups) if (g.ok) g.engs.forEach((e, i) => { e.pendingCovers = g.slots[i]; n++; });
    p.applied = true;
    this.addLog({ type: 'structural', t: this.t, reason: `Shared schools re-paired by distance for ${n} paired engineers, from tomorrow morning. Median drive between a pair's two schools falls from ${p.curMed} to ${p.newMed} min.` });
  }
  applyRec(id) { const r = this.recs.find(x => x.id === id); if (!r || r.state !== 'open') return; const e = this.engs.get(r.engId); e.pendingMove = r.to; r.state = 'applied';
    this.addLog({ type: 'structural', t: this.t, engId: e.id, reason: `${e.id} moves permanently from the ${r.from} pool to the ${r.to} pool from tomorrow morning.` }); }

  // ---------- logging & stats
  addLog(o) { o.id = this.nextLog++; o.day = this.day; this.log.unshift(o); if (this.log.length > 600) this.log.length = 600; this.emit('log', o); return o; }
  snapshot(t) {
    const k = this.kpis('today'); this.hist.push({ m: mod(t), ...this.bucket, resp: k.respPct }); this.bucket = { desk: 0, field: 0, late: 0 };
  }
  median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
  siteStats(s, period) {
    const list = period === 'today' ? [s.today] : period === 'week' ? [...s.days.slice(-4), s.today] : [...s.days, s.today];
    const o = newStats(); for (const x of list) for (const k in o) o[k] += x[k]; o.days = list.length; return o;
  }
  kpis(period = 'today', filter = () => true) {
    const o = newStats(); let waiting = 0, queued = 0, aged = 0, atRisk = 0, critical = 0;
    for (const s of this.sites.values()) { if (!filter(s)) continue; const x = this.siteStats(s, period); for (const k in o) o[k] += x[k]; waiting += s.waiting; queued += s.queued || 0; aged += s.aged; if (s.health < 60) atRisk++; if (s.health < 40) critical++; }
    const engs = [...this.engs.values()], onDuty = engs.filter(e => !e.absent).length;
    const now = this.t, busyNow = engs.filter(e => BUSY.has(e.state)).length;
    return { ...o, waiting, queued, aged, atRisk, critical, onDuty, absent: engs.length - onDuty, busyNow, onRoad: engs.filter(e => e.state === 'travel' && e.task).length,
      loans: engs.filter(e => e.loan).length, pending: this.approvals.filter(a => a.state === 'pending').length, violations: this.violations,
      respPct: o.respN ? o.respMet / o.respN * 100 : null, resPct: o.resN ? o.resMet / o.resN * 100 : null, remotePct: o.recv ? o.remote / Math.max(1, o.remote + o.field) * 100 : null,
      onsiteMed: period === 'today' ? this.median(this.respToday) : (o.respN ? o.sumResp / o.respN : null), now };
  }
  util(e) { const t = this.t, b = e.segs.filter(g => g.k !== 'break' && g.k !== 'return' && g.t0 <= t).reduce((a, g) => a + (Math.min(g.t1, t) - g.t0), 0), w = shiftWindow(this.day); return w && t > w[0] ? b / Math.max(1, Math.min(t, w[1]) - w[0]) : 0; }
  posAt(e, tf) {
    if (e.state !== 'travel' || !e.from) return e.loc;
    const f = Math.max(0, Math.min(1, (tf - e.t0) / Math.max(1, e.t1 - e.t0)));
    return { lat: e.from.lat + (e.to.loc.lat - e.from.lat) * f, lng: e.from.lng + (e.to.loc.lng - e.from.lng) * f };
  }
}
