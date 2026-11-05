// Every real-world assumption lives here so the Model view can show and tune it.
export const START_DATE = new Date(Date.UTC(2026, 9, 26)); // Monday 26 Oct 2026
export const DAY = 1440;

export const P = {
  // demand
  calibration: 0.5,          // share of the workbook's planning estimate that actually arrives
  weekday: [1.15, 1.05, 1.0, 0.95, 0.6], // Mon..Fri
  hourly: [0.9, 1.6, 1.3, 1.0, 1.1, 0.9, 0.7, 0.4], // 07..14
  offHoursShare: 0.06,
  staffWeight: 4, studentWeight: 0.15,
  frictionSigma: 0.3,
  // service desk
  triage: [4, 12], remoteHandle: [10, 40], deskSkill: 1.0,
  // field
  checkin: 8, notes: 5, revisitMin: 25, partsReadyAt: 600, vendorHours: [4, 16],
  // travel
  detour: [[10, 1.4], [35, 1.3], [1e9, 1.15]], speeds: [[10, 30], [35, 55], [1e9, 120]],
  ruralFactor: 1.1, overhead: 8, minTrip: 10,
  peakAM: [405, 510], peakPM: [795, 900],
  regionPeak: { heavy: 1.45, mid: 1.25, light: 1.1 }, crossDxbShj: 1.7, offPeak: 1.05,
  // workforce
  shift: { start: 420, end: 900, friEnd: 720 }, breakMin: 30, breakWindow: [720, 780],
  leaveRate: 0.05, leaveBlock: [3, 5], sickRate: 0.025, midShiftSick: 0.003,
  // allocation policy
  maxLoanEta: 60, minLoan: 120, healthTrigger: 55, overflowAt: 0.5, autoApprove: true, autoApproveAfter: 20, pmWhenIdle: true,
  // incidents
  linkOutage: 0.003, regionalIsp: 0.01,
};

export const REGION = { Z01: 'heavy', Z02: 'heavy', Z03: 'heavy', Z07a: 'mid', Z07b: 'mid', Z06a: 'mid', Z06b: 'mid', Z04: 'light', Z05: 'light', Z08: 'light' };

export const SLA = { // business minutes
  P1: { resp: 30, res: 240 }, P2: { resp: 120, res: 480 }, P3: { resp: 240, res: 960 }, P4: { resp: 480, res: 1440 },
};

export const CATS = [
  { id: 'acct', name: 'Account, O365 or LMS', share: .24, remote: .92, svc: 15, parts: 0, vendor: 0, pr: { P2: .1, P3: .6, P4: .3 } },
  { id: 'laptop', name: 'Teacher laptop', share: .16, remote: .45, svc: 40, parts: .12, vendor: 0, pr: { P2: .25, P3: .6, P4: .15 } },
  { id: 'display', name: 'Classroom display', share: .15, remote: .08, svc: 45, parts: .15, vendor: 0, pr: { P1: .05, P2: .45, P3: .45, P4: .05 } },
  { id: 'net', name: 'Wi-Fi and network', share: .11, remote: .35, svc: 50, parts: .08, vendor: .1, pr: { P1: .1, P2: .4, P3: .45, P4: .05 } },
  { id: 'print', name: 'Printer or copier', share: .09, remote: .25, svc: 30, parts: .05, vendor: .35, pr: { P2: .1, P3: .6, P4: .3 } },
  { id: 'student', name: 'Student device', share: .10, remote: .30, svc: 30, parts: .12, vendor: 0, pr: { P3: .7, P4: .3 } },
  { id: 'av', name: 'Peripherals and AV', share: .07, remote: .05, svc: 20, parts: .2, vendor: 0, pr: { P3: .6, P4: .4 } },
  { id: 'exam', name: 'Assessment platform', share: .04, remote: .55, svc: 35, parts: 0, vendor: 0, pr: { P1: .35, P2: .5, P3: .15 } },
  { id: 'imac', name: 'Install, move or add', share: .04, remote: 0, svc: 75, parts: 0, vendor: 0, pr: { P4: 1 } },
];
export const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));

// Indicative calendar (day index from 26 Oct 2026)
export const HOLIDAYS = new Set([36, 37, 38]);       // 1-3 Dec 2026
export const ASSESSMENT = new Set([21, 22, 23, 24, 25, 28, 29, 30, 31, 32]); // 16-27 Nov 2026

export const dayOf = t => Math.floor(t / DAY);
export const mod = t => ((t % DAY) + DAY) % DAY;
export const weekday = d => d % 7; // 0 Mon .. 6 Sun
export const isWorkday = d => weekday(d) < 5 && !HOLIDAYS.has(d);
export function shiftWindow(d) {
  if (!isWorkday(d)) return null;
  return [d * DAY + P.shift.start, d * DAY + (weekday(d) === 4 ? P.shift.friEnd : P.shift.end)];
}
export function nextWorkday(d) { let x = d + 1; while (!isWorkday(x)) x++; return x; }
// business minutes between two absolute times
export function bizBetween(t0, t1) {
  if (t1 <= t0) return 0; let sum = 0;
  for (let d = dayOf(t0); d <= dayOf(t1); d++) { const w = shiftWindow(d); if (!w) continue; sum += Math.max(0, Math.min(t1, w[1]) - Math.max(t0, w[0])); }
  return sum;
}
// absolute time after adding m business minutes to t0
export function addBiz(t0, m) {
  let d = dayOf(t0), left = m;
  for (let i = 0; i < 60; i++, d++) {
    const w = shiftWindow(d); if (!w) continue;
    const from = Math.max(t0, w[0]); if (from >= w[1]) continue;
    if (from + left <= w[1]) return from + left;
    left -= w[1] - from;
  }
  return t0 + m;
}
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateOf(d) { return new Date(START_DATE.getTime() + d * 864e5); }
export function fmtDate(d) { const x = dateOf(d); return `${DOW[weekday(d)]} ${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; }
export const fmtT = t => `${String(Math.floor(mod(t) / 60)).padStart(2, '0')}:${String(Math.floor(mod(t) % 60)).padStart(2, '0')}`;
export const fmtDur = m => { m = Math.round(m); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
