# MOE Site Engineer Allocation Maps: decisions guide

This guide explains how the plan on the map was made: every rule, why it was chosen, the exceptions and what is still open.
The data tables that come with it are the source for every number. If this guide and a table disagree, the table is right,
because the tables are rebuilt each time the plan changes.

## 1. What the plan is

- The plan is "Option Remote", **331-engineer model**. The project lead, Sithesvaran Thirumaran (Sithes), set the numbers on 6 Nov 2026: "331 FEs, 201 Nationals, based on qualified schools size category". It replaced the earlier 333-engineer version of Option Remote. The MOE director decides.
- The plan covers MOE end-user computing (EUC) field support. One field engineer is named for every school and every non-school site (office). HQ sites have their own engineers.
- Alpha Data prepared it for the UAE Ministry of Education.
- **Headcount: 331 engineers.**
  - **9 at HQ:** 3 at Dubai HQ, 4 at Abu Dhabi HQ, 2 at Ajman HQ. They stay at their HQ and are not field engineers. The HQ sites are shown on the map.
  - **322 field engineers** cover 522 schools and 38 offices.
- The 322 are split three ways:
  - **201 Emirati nationals.** Every remote school gets its own national, on site, never shared. By qualified size the 201 remote schools are 3 X-Large, 3 Large, 73 Medium, 31 Small and 91 X-Small.
  - **72 city shared engineers** (non-national). They cover the 142 city schools that are Medium, Large or X-Large by **qualified size** (126 Medium, 7 Large, 9 X-Large), two schools each.
  - **49 city pool engineers** (non-national). They cover the 178 city schools that are Small or X-Small by qualified size (84 Small, 94 X-Small) plus the 38 offices: about 3-4 schools and 1 office each. The zone's Team Lead dispatches them by ticket. The map shows each one's suggested home patch.
- **Abu Moosa School** is "Not in Service" in the workbook. It is on Abu Musa island. It is visited by boat by the nearest pool engineer in its zone (Ajman, Sharjah & UAQ) and is not counted in the 331.
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

- **Main workbook:** "MOE_EUC_FE_Allocation_331.xlsx" (the project lead's allocation workbook, 6 Nov 2026). The sheets used:
  - "Schools List": zones, GPS, the City/Remote flag, the size category, the **qualified size category**, users and Team Leads.
  - "Non-Schools List with Map": real names and locations of the 38 offices and the 3 HQ sites.
  - "Non-School Sites": office user counts, where given.
  - "Zone Lead & Pools Hub Distribut": the zones and Team Leads.
- **The project lead's breakdown (6 Nov 2026)** sets the headcount model in section 1.
- **Size:** city schools are classed by **"Qualified Size Category"**, which allows for Alef-managed student devices (MOE then supports staff only). 16 city schools are Medium or larger by register size but Small or X-Small by qualified size, so they are in the pool.
- **Closed schools:** 8 schools marked Closed are left out.
- **Users:** supported users = students + all staff.
- **Office users:** an office with no user count is assumed to have 75 users, the workbook's own assumption.
- **Al Manhal register:** used only for the rural flag, the Arabic school names and the school cycles.
- **Drive times:** Google Maps (Routes API), looked up on 4 and 6 Nov 2026. See section 5.

## 3. The rules, in the order they were applied, and why

1. **Remote schools: one national each.**
   - All 201 remote schools get their own Emirati national, working on site. There is no longer a shared remote engineer.
   - Nationals are never shared. That is an MOE rule, confirmed by the project lead.
   - Gender: girls' schools get a female national (47 of them). Mixed schools can take either; 4 are marked "Male or female".
   - Nationals don't travel, so they have no drive times.
2. **City qualified Medium, Large and X-Large schools are paired inside each zone.**
   - The pairing is a mathematical best match: it makes the total drive between paired schools as small as possible.
   - The drive is measured in Google's 7:30 am school-run traffic, from the larger school, where the engineer is based.
   - **Same gender first.** A boys + girls pair is only made where a zone's counts force it, and it gets a female engineer. Only one zone needs one: Ras Al Khaimah (RAK-C03).
   - **Odd counts.** 142 schools at 2 per engineer would be 71 engineers; the budget is 72. Four zones have an odd number: Al Ain A, Ajman, Sharjah & UAQ, Abu Dhabi A and Al Dhafra. The fewest-minutes answer that lands on exactly 72:
     - one Ajman engineer covers 3 schools (AJM-UAQ-C01);
     - one school keeps a whole engineer in each of the other three zones: Fatimah Bint Mubarak School (AUH-A-C05), Al Marfaa School (DHF-C01) and one in Al Ain A (AAN-A-C08).
3. **Pool engineers are shared out between zones by workload.**
   - Workload is half each zone's share of small-site users and half its share of small sites. The 49 pool engineers are split in proportion, with at least 1 per zone.
   - Current split by zone:

     | Zone | Pool engineers | Sites |
     |---|---|---|
     | Ajman, Sharjah & UAQ | 9 | 47, including Abu Moosa by boat |
     | Dubai & Sharjah | 7 | 35 |
     | Al Ain B | 7 | 22 |
     | Khor Fakkan & Dibba | 5 | 23 |
     | Ras Al Khaimah | 5 | 25 |
     | Al Ain A | 5 | 20 |
     | Abu Dhabi A | 4 | 17 |
     | Al Dhafra | 4 | 14 |
     | Fujairah & Kalba | 2 | 10 |
     | Abu Dhabi B | 1 | 1 |

   - Abu Dhabi B has no city schools. Its single pool engineer covers only one office, Ajbaan.
4. **Small girls' schools where a female pool engineer would be idle.**
   - In a zone whose small girls' schools add up to less than half a normal pool load, each of those schools rides with the nearest female city engineer within 45 minutes.
   - Three schools are handled this way:
     - Falaj Al Mualla Girls School, with KFK-DBA-C02 in Khor Fakkan & Dibba;
     - Al Khair Girls School, with AAN-B-C01 in Al Ain B;
     - Al Dhaher Girls School, with AAN-A-C08 in Al Ain A.
5. **Pool patches inside a zone.**
   - **Female engineers first.** Each zone's number of female pool engineers follows its share of girls' small-school workload, with at least 1 where there are girls' schools. Every girls' school is covered by a female engineer.
   - **The rest go to male engineers.** Boys' and mixed small schools and the offices are split between them. Offices accept either gender.
   - **Compact and even patches.** Every patch gets between (average − 1) and (average + 1) sites. The split makes the total drive from each patch's centre as small as possible, then re-centres until it settles.
   - **Patch base:** the patch's most central school.
   - **A short female patch** takes nearby offices first, then nearby boys' schools within 30 minutes. In this plan, Khor Fakkan & Dibba's female pool engineer (KFK-DBA-P05) covers boys' sites as well.
6. **Zones are not crossed.** City shared and pool engineers stay inside their zone, so each Team Lead dispatches only their own engineers.

## 4. The director's likely concern: big city schools losing a dedicated engineer

- **Most pairs are close.**
  - Half the pairs are 7 minutes or less apart in 7:30 am traffic, and about 4 km or less by road.
  - 59 of the 70 pairs (including the three 3-school engineers) are within 15 minutes, and 65 are within 30.
  - The tables have the exact, current figures.
- **Qualified size moves 16 schools out of pairs.** They are Medium or larger by register size, but Alef runs their student devices, so MOE supports staff only and they are in the pool.
- **Long pairs** are where same-gender schools inside one zone are far apart. There are 5 over 30 minutes: 3 in Khor Fakkan & Dibba (KFK-DBA-C02, -C05, -C06), 1 in Al Ain A (AAN-A-C05) and 1 in Al Ain B (AAN-B-C05). Each is listed in the tables with its drive time.

## 5. Drive times

- **Source:** Google Maps typical traffic for a school-day Tuesday, leaving at 7:30 am (the school run) and at 10:30 am.
  - Lookups were made on 4 Nov 2026 and topped up on 6 Nov 2026 for the new pairings and the real office locations.
  - They cover every trip an engineer makes from their base, plus nearby pairs the allocation could have chosen.
- **Drive time only:** allow a few minutes to park and walk in. Road distance (km) is shown with every drive time.
- **Live traffic:** clicking an engineer on the map shows Google's usual time for the current hour and the time right now.
- **"Backup" in the tables:** the nearest other engineer who could cover a site if its own engineer is off. The pick is:
  - same zone;
  - a female engineer for a girls' school;
  - pool engineers first, then city shared engineers. Nationals are never used as backup, because they stay at their own school.

  Backup minutes are estimates from straight-line distance, calibrated on Google's times (about 5.6 minutes + 0.93 minutes per straight-line km at 7:30). They are not Google lookups.

## 6. Exceptions and edge cases to know

| Engineer or site | What is unusual |
|---|---|
| Abu Moosa School | Not in service; on Abu Musa island. Boat visits by the nearest Ajman, Sharjah & UAQ pool engineer; not counted. |
| AJM-UAQ-C01 | Covers 3 schools (odd count in Ajman, Sharjah & UAQ). |
| AUH-A-C05, DHF-C01 | Each covers only one school (odd counts). |
| AAN-A-C08 | One school by odd count, plus Al Dhaher Girls School (small). |
| KFK-DBA-C02 | Female city engineer with 3 girls' schools, one of them small. Longest drive in the plan, about 46 minutes. |
| AAN-B-C01 | Female city engineer with 3 girls' schools, one of them small (Al Khair). |
| RAK-C03 | The only boys + girls pair, forced by odd counts. It has a female engineer. |
| KFK-DBA-P05 | Female pool engineer who also covers boys' sites. |
| AUH-B-P01 | Abu Dhabi B's only pool engineer; covers one office (Ajbaan). |
| HQ sites | Dubai HQ 3, Abu Dhabi HQ 4, Ajman HQ 2 engineers. "Ajman HQ" is taken to be the MOE Ajman Main Complex. |

- **Offices:** 38 offices with real names and locations from the workbook. The earlier list of 48 had 10 unnamed placeholders, now dropped. 21 offices have no user count, so 75 is assumed.

## 7. Still to confirm (open items)

1. **Ajman HQ:** confirm it is the MOE Ajman Main Complex.
2. **Abu Dhabi B:** one pool engineer for one office (Ajbaan). Could Abu Dhabi A's pool cover it instead?
3. **The long pairs** (over 30 minutes at 7:30 am): accept them, or trade some for mixed-gender pairs or extra engineers.
4. **The mixed boys + girls pair** in Ras Al Khaimah: confirm a female engineer covering a boys' school is acceptable.
5. **Abu Moosa School:** confirm boat visits from the Ajman, Sharjah & UAQ pool.
6. **Abu Dhabi B Team Lead:** TBD.

## 8. Glossary

| Term | Meaning |
|---|---|
| Emirati national | A UAE national engineer, dedicated to one remote school, on site. |
| City shared engineer | Non-national; covers two (sometimes one or three) qualified Medium, Large or X-Large city schools. |
| City pool engineer | Non-national; covers a patch of qualified Small and X-Small city schools and offices, dispatched by ticket. |
| HQ engineer | One of the 9 engineers dedicated to an HQ site; not a field engineer. |
| Base | The site an engineer starts from: the larger school of a pair, or the most central school of a pool patch. |
| Qualified size | The workbook's size after allowing for Alef-managed student devices. It can be smaller than the size category. The 331 model uses it for city schools. |
| Users | Students + all staff at a school; for offices, the workbook's count. |
| Team Lead | The zone's lead, who runs and dispatches its engineers. |

## 9. Changes and approvals

- **Anyone using the map can ask for changes.** Examples: move a school to another engineer, swap two schools, add or remove an engineer, rebalance a zone's pool.
- **Changes are simulated first.** The map shows them as pending, with their impact.
- **"Request plan update"** emails the changes and their impact to the two approvers:
  - Sithesvaran Thirumaran (sthirumaran@skyformit.com);
  - Sanath Swaroop (sanathswaroop@skyformit.com).
- **Approval:** the first approver to confirm applies the changes, and the map's live plan becomes a new version. A proposal made on an older version must be re-made.
- **Rule breaks are flagged but allowed.** For example: sharing a national, a girls' school without a female engineer, crossing zones, or going over the 322 field engineers. The approvers decide.
- **History:** the earlier 333-engineer version of Option Remote (200 nationals, 1 remote shared, 79 city shared, 43 pool, 10 HQ, by register size) and its approved change (version 1, 312 engineers) were replaced by this 331 model on 6 Nov 2026.
