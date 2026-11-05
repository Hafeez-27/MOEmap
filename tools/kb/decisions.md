# MOE Site Engineer Allocation Maps: decisions guide

This guide explains how the plan on the map was made: every rule, why it was chosen, the exceptions and what is still open.
The data tables that come with it are the source for every number. If this guide and a table disagree, the table is right,
because the tables are rebuilt each time the plan changes.

## 1. What the plan is

- The plan is "Option Remote". The project lead, Sithesvaran Thirumaran (Sithes), set it on 3 Nov 2026 for his meeting with the MOE director. The director decides.
- The plan covers MOE end-user computing (EUC) field support. One field engineer is named for every school and every non-school site (office).
- Alpha Data prepared it for the UAE Ministry of Education.
- **Headcount: 333 engineers.**
  - 10 work at HQ (3 HQ sites). They are fixed and not on the map.
  - The other 323 cover 522 schools and 48 offices.
- The 323 are split four ways, from the project lead's breakdown:
  - **200 Emirati nationals.** One per remote school, on site, never shared. They cover the 200 largest remote schools by users.
  - **1 remote shared engineer** (non-national). Covers the 2 smallest remote schools.
  - **79 city shared engineers** (non-national). Cover the 158 Medium, Large and X-Large city schools, two schools each.
  - **43 city pool engineers** (non-national). Cover the 162 Small and X-Small city schools plus the 48 offices, about 4.9 sites each. The zone's Team Lead dispatches them by ticket. The map shows each one's suggested home patch.
- The map is split into 10 zones, each with a Team Lead:
  - Dubai & Sharjah (DXB-SHJ)
  - Khor Fakkan & Dibba (KFK-DBA)
  - Ajman, Sharjah & UAQ (AJM-UAQ)
  - Ras Al Khaimah (RAK)
  - Fujairah & Kalba (FUJ-KLB)
  - Al Ain A (AAN-A)
  - Al Ain B (AAN-B)
  - Abu Dhabi A (AUH-A)
  - Abu Dhabi B (AUH-B). Its Team Lead is still TBD.
  - Al Dhafra (DHF)

## 2. Sources

- **Main workbook:** the project lead's "MOE_EUC_Zone_Engineer_Allocation_200Nationals_Option4_Engineers Mapping-Option_Remote.xlsx". The sheets used:
  - "Schools List_Updated": zones, GPS confirmed by the Team Leads, the City/Remote flag, size category and users.
  - "Non-School Sites": the offices.
  - "Zone Lead & Pools Hub Distribut": the Team Leads.
  - "national-breakup".
- **Size:** counts use "Size category", not "Qualified Size Category". The project lead said to ignore the "Mapped with Emirati by remote" column.
- **Closed schools:** 8 schools marked Closed or Removed are left out.
- **Users:** supported users = students + all staff.
- **Office users:** an office with no user count is assumed to have 75 users. That is the workbook's own assumption.
- **Al Manhal register:** used only for the rural flag, the Arabic school names and the school cycles. Schools are matched by GPS.
- **Call with the project lead (3 Nov 2026) and his breakdown screenshots:** these set the headcount model above.
- **Drive times:** Google Maps (Routes API), looked up on 4 Nov 2026. See section 5.

## 3. The rules, in the order they were applied, and why

1. **Remote schools first.**
   - The 202 remote schools are ranked by supported users. The top 200 each get one Emirati national, working on site.
   - Nationals are never shared. That is an MOE rule, confirmed by the project lead.
   - Gender: girls' schools get a female national. Mixed schools can take either; 4 of them are marked "Male or female".
   - Nationals don't travel, so they have no drive times.
2. **The 2 smallest remote schools** share one non-national engineer:
   - Msfoot Kindergarten (Fujairah & Kalba);
   - Abu Moosa School Cycle 1, 2, 3, on Abu Musa island.

   This engineer is the only one who spans two zones, and Abu Moosa needs boat visits.
3. **City Medium, Large and X-Large schools are paired inside each zone.**
   - The pairing is a mathematical best match: it makes the total drive between paired schools as small as possible.
   - The drive is measured in Google's 7:30 am school-run traffic, from the larger school, where the engineer is based.
   - **Same gender first.** A boys + girls pair is only made where a zone's counts force it. Such a pair always gets a female engineer.
     - Two zones need one: Ras Al Khaimah and Al Ain A.
     - Al Ain A's mixed engineer (AAN-A-C02) also covers a small girls' school. See rule 5.
   - **Odd counts.**
     - Al Ain B and Al Dhafra each have an odd number of these schools.
     - The fewest-minutes answer: one Al Ain B engineer covers 3 girls' schools (AAN-B-C05), and one Al Dhafra school, Ghayathi New School, keeps a whole engineer (DHF-C02). That keeps the total at 79.
   - **Why pairs at all:** 79 engineers for 158 big schools is the project lead's budget. Pairing nearby schools of the same gender keeps response fast.
4. **Pool engineers are shared out between zones by workload.**
   - Workload is half each zone's share of small-site users and half its share of small sites. The 43 pool engineers are split in proportion, with at least 1 per zone.
   - Current split by zone:

     | Zone | Pool engineers |
     |---|---|
     | Dubai & Sharjah | 8 |
     | Ajman, Sharjah & UAQ | 9 |
     | Ras Al Khaimah | 5 |
     | Khor Fakkan & Dibba | 4 |
     | Al Ain B | 4 |
     | Abu Dhabi A | 4 |
     | Al Ain A | 3 |
     | Al Dhafra | 3 |
     | Fujairah & Kalba | 2 |
     | Abu Dhabi B | 1 |

   - Abu Dhabi B has no small city schools. Its single pool engineer covers only its 3 offices.
5. **Small girls' schools where a female pool engineer would be idle.**
   - In a zone whose small girls' schools add up to less than half a normal pool load, each of those schools rides with the nearest female city engineer within 45 minutes.
   - Two schools are handled this way:
     - Falaj Al Mualla Girls School, with KFK-DBA-C02 in Khor Fakkan & Dibba;
     - Al Dhaher Girls School, with AAN-A-C02 in Al Ain A.
   - Both engineers therefore cover 3 schools.
6. **Pool patches inside a zone.**
   - **Female engineers first.** Each zone's number of female pool engineers follows its share of girls' small-school workload, with at least 1 where there are girls' schools. Every girls' school is covered by a female engineer.
   - **The rest go to male engineers.** Boys' and mixed small schools and the offices are split between them. Offices accept either gender.
   - **Compact and even patches.** Every patch gets between (average − 1) and (average + 1) sites. The split makes the total drive from each patch's centre as small as possible, then re-centres until it settles.
   - **Patch base:** the patch's most central school.
   - **A short female patch** takes nearby offices first, then nearby boys' schools within 30 minutes.
     - Example: Khor Fakkan & Dibba's female pool engineer (KFK-DBA-P04) covers Al Bataeh Girls School plus 4 boys' sites in Al Bataeh, Al Rafeea, Al Hisn and Al Dhaid.
     - Without this, she would have had 1 school while a male colleague had 9.
7. **Zones are not crossed.** City shared and pool engineers stay inside their zone, so each Team Lead dispatches only their own engineers. The remote shared engineer is the one exception (rule 2).

## 4. The director's likely concern: big city schools losing a dedicated engineer

- **Most pairs are close.**
  - Half the pairs are 7 minutes or less apart in 7:30 am traffic, and 4.3 km or less by road.
  - 66 of the 78 pairs are within 15 minutes, and 73 are within 30.
  - The tables have the exact, current figures.
- **Some of these schools are smaller than they look.** 16 of the 158 shared city schools are "qualified X-Small" in the workbook. Alef runs their student devices, so MOE supports staff only.
- **Long pairs** are where same-gender schools inside one zone are far apart. They are mainly in Khor Fakkan & Dibba (3 pairs), Al Dhafra and outer Al Ain A. Each is listed in the tables with its drive time.

## 5. Drive times

- **Source:** Google Maps typical traffic for a school-day Tuesday, leaving at 7:30 am (the school run) and at 10:30 am.
  - About 3,750 Google lookups were made on 4 Nov 2026.
  - They cover every trip an engineer makes from their base, plus nearby pairs the allocation could have chosen.
- **Drive time only:** allow a few minutes to park and walk in.
- **Earlier estimate:** before Google, the plan used a road-speed estimate. It turned out about 2.5 times too pessimistic: the median pair drive was 15 minutes, against Google's 7.
- **Re-optimised on Google's times:** the allocation was re-run on the real times, which changed 20 of the 79 shared pairs and most pool patches.
- **Live traffic:** clicking an engineer on the map shows Google's usual time for the current hour and the time right now.
- **"Backup" in the tables:** the nearest other engineer who could cover a site if its own engineer is off. The pick is:
  - same zone;
  - a female engineer for a girls' school;
  - pool engineers first, then city shared engineers. Nationals are never used as backup, because they stay at their own school.

  Backup minutes are estimates from straight-line distance, calibrated on Google's times (about 5.6 minutes + 0.93 minutes per straight-line km at 7:30). They are not Google lookups.

## 6. Exceptions and edge cases to know

| Engineer or site | What is unusual |
|---|---|
| FUJ-KLB-R01 (remote shared) | Two zones; Abu Moosa is on an island and needs boat visits. Abu Moosa's location in the workbook is "Not in Service": it is shown on Abu Musa island, to confirm. |
| AAN-B-C05 | Covers 3 girls' schools (odd count in Al Ain B). |
| DHF-C02 | Covers only Ghayathi New School (odd count in Al Dhafra). |
| RAK-C03, AAN-A-C02 | Boys + girls pairs, forced by odd counts. Each has a female engineer. |
| KFK-DBA-C02 | Female city engineer with 3 girls' schools, one of them small (Falaj Al Mualla). Longest drive in the plan, about 46 minutes. |
| KFK-DBA-P04 | Female pool engineer covering 1 girls' school and 4 boys' sites. |
| AUH-B-P01 | Abu Dhabi B's only pool engineer; covers 3 offices only. |

- **Offices:** none of the 48 has coordinates in the workbook. Each is placed at the school its name refers to, or near the centre of its area, and marked "location to confirm".
  - 10 are placeholders ("to confirm").
  - 26 have no user count, so 75 is assumed.
  - The on-ground count is 38 offices, not 48.

## 7. Still to confirm (open items)

1. **Abu Moosa School:** location ("Not in Service" in the workbook), and whether it is in service.
2. **The 48 offices:** real locations, the 10 placeholders, and the 38 vs 48 count.
3. **Abu Dhabi B Team Lead:** TBD.
4. **The long pairs** (over 30 minutes at 7:30 am): accept them, or trade some for mixed-gender pairs or extra engineers.
5. **The 2 mixed boys + girls pairs:** confirm a female engineer covering a boys' school is acceptable.

## 8. Glossary

| Term | Meaning |
|---|---|
| Emirati national | A UAE national engineer, dedicated to one remote school, on site. |
| City shared engineer | Non-national; covers two (sometimes one or three) Medium, Large or X-Large city schools. |
| City pool engineer | Non-national; covers a patch of Small and X-Small city schools and offices, dispatched by ticket. |
| Remote shared engineer | The one non-national covering the 2 smallest remote schools. |
| Base | The site an engineer starts from: the larger school of a pair, or the most central school of a pool patch. |
| Qualified size | The workbook's size after allowing for Alef-managed student devices. It can be smaller than the size category. |
| Users | Students + all staff at a school; for offices, the workbook's count. |
| Team Lead | The zone's lead, who runs and dispatches its engineers. |

## 9. Changes and approvals

- **Anyone using the map can ask for changes.** Examples: move a school to another engineer, swap two schools, add or remove an engineer, rebalance a zone's pool.
- **Changes are simulated first.** The map shows them as pending, with their impact.
- **"Request plan update"** emails the changes and their impact to the two approvers:
  - Sithesvaran Thirumaran (sthirumaran@skyformit.com);
  - Sanath Swaroop (sanathswaroop@skyformit.com).
- **Approval:** the first approver to confirm applies the changes, and the map's live plan becomes a new version. A proposal made on an older version must be re-made.
- **Rule breaks are flagged but allowed.** For example: sharing a national, a girls' school without a female engineer, crossing zones, or going over 323 engineers. The approvers decide.
- **Earlier option:** Option 1, 323 engineers grouped by the Al Manhal Team-Lead mapping, has no dedicated nationals. It is not shown on this map.
