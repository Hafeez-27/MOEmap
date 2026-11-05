# MOE EUC field operations simulator: model and UI design

Audience: a Ministry of Education operations lead and the service-delivery manager.
They watch a school day unfold, see which schools are slipping, and decide where engineers go.
Everything must be demonstrable live: a viewer should be able to follow one ticket from a teacher's call to an engineer arriving at the gate.

## 1. Real-world model

### Calendar and working time
- Simulation starts **Monday 26 Oct 2026, 06:50**. UAE public-school week: Mon–Fri. Sat and Sun are skipped.
- Engineer shift: Mon–Thu 07:00–15:00, Fri 07:00–12:00 (school ends 11:30 on Fridays).
- 30-minute lunch/prayer break, starting between 12:00 and 13:00, Mon–Thu.
- Indicative calendar: Term 1 assessment window 16–27 Nov 2026; public holidays 1–3 Dec 2026 (Commemoration and National Day).
- SLA clocks run in **business minutes**, and pause outside the shift. A ticket logged at 14:50 with a 4 h target is due mid-morning the next day.

### Demand: how many tickets
- Zone totals honour the workbook ("Est. school tickets / month", 34,212 for all zones).
- The workbook is a sizing figure, so the baseline applies a **calibration of 50 %**, adjustable in the Model view.
  This gives about 800 service-desk tickets per school day network-wide (about 1.5 per school), of which about 55 % need a field visit.
- Within a zone, a school's share is driven by:
  - staff head-count (teachers + admin + technicians, from Al Manhal), weighted 4
  - students × student-device factor by cycle (Cycle 2/3 1.0, Cycle 1 0.5, KG 0.1), weighted 0.15
  - building age: <5 y 0.85, 5–15 y 1.0, 15–25 y 1.15, >25 y 1.3
  - an idiosyncratic school factor (log-normal, σ 0.3)
- Weekday factor: Mon 1.15, Tue 1.05, Wed 1.0, Thu 0.95, Fri 0.6.
- Hourly profile (07..14): 0.9, 1.6, 1.3, 1.0, 1.1, 0.9, 0.7, 0.4.
- 6 % of tickets are logged out of hours and wait for the morning.
- Assessment days: exam-platform tickets ×5 and more P1s.

### Ticket categories

| Category | Share | Remote fix | Field time | Parts | Vendor |
|---|---|---|---|---|---|
| Account, O365, LMS | 24% | 92% | 15m | 0 | 0 |
| Teacher laptop | 16% | 45% | 40m | 12% | 0 |
| Classroom display | 15% | 8% | 45m | 15% | 0 |
| Wi-Fi and network | 11% | 35% | 50m | 8% | 10% |
| Printer / MFD | 9% | 25% | 30m | 5% | 35% |
| Student device | 10% | 30% | 30m | 12% | 0 |
| Peripherals and AV | 7% | 5% | 20m | 20% | 0 |
| Assessment platform | 4% | 55% | 35m | 0 | 0 |
| Install / move / add request | 4% | 0% | 75m | 0 | 0 |

Each category has its own priority mix.

### Ticket lifecycle
1. Logged at the service desk.
2. Triage takes 4–12 min.
3. The desk either resolves it remotely (10–40 min) or **dispatches it to the field**.
4. Field: assigned → en route (drive) → gate check-in (8 min, visiting engineers only) → on site, which is the **response** → work.
5. Outcome:
   - fixed: 85 % first-time fix
   - pending parts: stores deliver next working day at 10:00, then a 25 min revisit
   - handed to a vendor: 4–16 business hours, no engineer needed
6. After every job: 5 min of notes.

SLA targets (business minutes):

| | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| Response (field: engineer on site) | 30 | 120 | 240 | 480 |
| Resolution | 240 | 480 | 960 | 1440 |

### Travel, the part that must feel real
Door-to-door minutes are built up as follows:
- **Road distance** = straight-line km × detour factor: 1.4 under 10 km, 1.3 under 35 km, 1.2 beyond.
- **Free-flow speed**: urban 30 km/h, suburban 55, highway 110 (detour 1.15 beyond 35 km). Rural schools add 10 % for access roads.
- **Traffic multiplier** by time of day and corridor:
  - school-run peaks 06:45–08:30 and 13:15–15:00
  - Dubai, Sharjah and Ajman ×1.45; Abu Dhabi and Al Ain ×1.25; RAK, Fujairah and Dhafra ×1.1
  - a Dubai↔Sharjah crossing at peak ×1.7
  - off-peak ×1.0–1.1
- Peak congestion applies fully to the city stretches (first 35 km) and at 30% strength to open highway.
- **Fixed overhead**: 4 min to leave site and 4 min to park.
- **Minimum trip**: 10 min.
- **Gate check-in** of 8 min (visitor registration), counted separately.

This gives about 30 min for a 5 km urban trip at peak, and 2 h 15 for Dubai to Madinat Zayed.
When the Google Routes API is enabled on the key, traffic-aware Google durations replace the estimate. Gate and parking overheads are still added.
**Speed of the simulation is explicit**: the clock shows "1 s = N min". The default is 1 s = 2 min, so a 30-minute drive takes 15 s on screen.

### Workforce
- 312 engineers generated from the workbook: 137 dedicated, 92 paired, 69 pool, 14 non-school pool. 237 male, 75 female.
- Daily availability:
  - annual leave 5 %, in 3–5 day blocks, known in advance
  - sick 2.5 %, unplanned, known at 06:50
  - mid-shift sick call 0.3 %
- Resident (dedicated/pair) engineers start on site. Pool engineers start at the zone hub.
- Idle residents do preventive classroom checks, which are interruptible.

### Gender rule (hard constraint)
- Boys' schools: male engineers only.
- Girls' schools: female engineers only.
- Non-school sites: anyone.

The rule is enforced in one function and used by dispatch, roster cover, loans, manual moves, AI-proposed moves and weekly recommendations. There is a violation counter, and it must stay 0.

### Allocation intelligence
- **Morning roster (06:50)**: every absent resident engineer's school gets a cover engineer from the same zone and gender pool, chosen by ETA. Schools left uncovered are flagged.
- **Dispatch**:
  - each field ticket goes to the best available covering engineer by deadline slack minus ETA
  - after 50 % of the response SLA, any same-zone, same-gender pool engineer may take it (overflow)
- **Intraday loan** (checked every 15 min), triggered when either:
  - a school has a ticket projected to breach its response SLA (best covering ETA > time left), or
  - its health stays under 55 for 30 min with a P1/P2 open or ≥3 open
- **Loan candidate rules**:
  - eligible gender, on duty, not on break
  - at most one loan per engineer per day
  - ETA within the policy limit (default 60 min)
  - candidates scored by ETA + donor risk
- **Loan approval and release**:
  - same-zone loans are automatic
  - cross-zone loans wait for **operator approval**, or are auto-approved after 20 min if that setting is on
  - minimum loan 2 h; release when the queue clears or the shift ends
- **Weekly review** (Friday close, or on demand):
  - pool utilisation per zone × gender over the last 5 days
  - recommendations to move pool engineers permanently (same gender only), applied from the next morning
- **Pairing optimiser**: the workbook's indicative pairs put a paired engineer's two schools a median 44 min apart. Greedy nearest re-pairing within the same zone and gender gives 17 min. It can be applied from the next morning.
- **Major incidents**:
  - school link outage: 0.3 % per school per day; one P1 diagnosis visit, ISP restore in 1–4 h, 4–10 linked child tickets closed together
  - regional ISP degradation: about 1 % per day
  - scenario injections

### Measures
- Site health (live): open aged tickets, projected breaches, P1 waiting, today's response SLA.
- Period scorecard (today / last 5 school days / all simulated days):
  - received, field share, remote resolution %
  - response SLA %, resolution SLA %
  - median time to on-site, revisit rate, aged backlog

## 2. UI plan

Design language (kept from the redesign):
- paper `#F4F6F3` with ink `#16233B`
- highlighter yellow for selection
- margin red for breaches, tick green for met SLAs
- IBM Plex Sans Condensed for figures and headings; Plex Sans and Plex Sans Arabic for text
- sentence case throughout, no all-caps labels, no cards-for-everything

Shell:
- Header: product name, date and clock with day progress and the time scale, view switcher, simulation controls, data-source badges, Copilot button.
- Context bar under the header: period selector, zone filter, gender filter. It applies to every view.

Views:
1. **Operations**
   - school-day strip (bell periods; desk vs field bars; late in red; SLA line; now line)
   - ruled figures row
   - map with the site drawer
   - right column: "Needs attention" (each school with reason chips), "Engineers on the road" (from → to, ETA countdown), approvals queue, ticket feed
2. **Schools**: sortable scorecard for the selected period, with sparklines of the last days, Arabic names, search, filters and CSV export. Selecting a school opens its drawer, with the ticket list and lifecycle funnel.
3. **Engineers**
   - roster timeline (Gantt for today: travel, check-in, work, break, preventive checks, idle; now line)
   - table with gender, type, coverage, drive from hub (off-peak vs peak), jobs, utilisation, status
   - drive-time distribution
4. **Planning**
   - decision log with explanations and AI "explain"
   - approvals
   - today's roster cover
   - pool utilisation heatmap (zone × gender) with weekly recommendations to apply
   - gender capacity check per zone
5. **Model**: every assumption grouped (demand, service desk, field work, travel, workforce, SLA, allocation policy) with value, rationale and sliders where live-adjustable, plus a calibration panel (model month vs workbook month) and a travel-time calculator between any two schools.
6. **Copilot**: a slide-over that works from every view. It sees period stats, and its proposed moves get an Apply button that passes the gender rule check.

Quality floor:
- responsive to tablet
- keyboard focus visible
- reduced motion respected
- no console errors
- the simulation keeps running in background tabs

## End-to-end demo (`/demo.html`)

A presenter-driven walkthrough of one school day (Mon 26 Oct 2026) in 14 chapters: roster, a teacher's ticket at Al Rayah Girls School (portal, desk triage, dispatch, the engineer's phone, sign-off, rating), then a network outage at Al Ahmadiah Girls School where the nearest free female engineer comes from the Sharjah hub through a cross-zone approval, and the end-of-day results.

- The cast and times live in `public/js/demo/story.js`. Every number shown (drive times, candidates, exclusions, SLA results) comes from the road model and the same rules as the simulator. Story-specific states are stated as assumptions: Z01-FE16 is on leave, Z01-FE29 covers her schools, Z01-FE30 and Z01-FE32 are busy until 11:30 and 11:50.
- The rest of the network runs in the background with the full simulator, so the console's network figures are live.
- `node tools/demo-check.mjs` prints the story's numbers for checking.
- The live AI model writes the desk triage note, the on-site troubleshooting steps and the end-of-day briefing. If it is unreachable, standard text is shown instead.
- Controls: Next / Back buttons, the arrow keys, the chapter rail, and the actions on each screen (Submit, Accept, I've arrived, the outcome choice, signature, Approve).
