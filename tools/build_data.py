"""Join the Al Manhal school register with the v11 allocation workbook -> public/data/network.json"""
import openpyxl, json, collections, math, random, statistics, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOC = os.path.join(ROOT, 'MOE_EUC_Zone_Engineer_Allocation_v11 (3).xlsx')
SCH = os.path.join(ROOT, 'All Schools - Al Manhal.xlsx')

# Hub coordinates are indicative (the workbook names the hub, not coordinates).
HUBS = {
 'Z01': ('Al Qusais 2 (MOE HQ)', 25.2900, 55.3850),
 'Z02': ('Al Nasseriya, Sharjah', 25.3650, 55.4050),
 'Z03': ('Al Muntazi 2, Ajman', 25.4040, 55.4600),
 'Z04': ('Al Nakheel, RAK', 25.7900, 55.9500),
 'Z05': ('Al Faseel, Fujairah', 25.1200, 56.3300),
 'Z06a': ('ZEC Al Ain', 24.2075, 55.7447),
 'Z06b': ('Al Ain secondary hub', 24.2350, 55.7900),
 'Z07a': ('Al Shamkha Zone Office', 24.3750, 54.7100),
 'Z07b': ('Abu Dhabi secondary hub', 24.4539, 54.3773),
 'Z08': ('Madinat Zayed', 23.6600, 53.7000),
}
wa = openpyxl.load_workbook(ALLOC, data_only=True)
ws = openpyxl.load_workbook(SCH, data_only=True).active
h = [c.value for c in ws[1]]
man = {str(r[h.index('School_ID')]): dict(zip(h, r)) for r in ws.iter_rows(min_row=2, values_only=True)}

zs = wa['Zone Summary-Size wise']
zones = []
for r in zs.iter_rows(min_row=5, values_only=True):
    if r[0] and str(r[0]).startswith('Z'):
        hub = HUBS[r[0]]
        zones.append(dict(id=r[0], name=r[1], region=r[50], monthlyTickets=float(r[7]), users=float(r[28]),
                          hub=dict(name=hub[0], lat=hub[1], lng=hub[2]), band=r[6], kmFromDubai=str(r[5])))
zmap = {z['id']: z for z in zones}

rows = [r for r in wa['Schools List'].iter_rows(min_row=5, values_only=True) if r[1]]
by_region = collections.defaultdict(list)
for r in rows:
    m = man[str(r[6])]
    if m['Latitude'] and m['Longitude']:
        by_region[(r[1], m['Region'])].append((float(m['Latitude']), float(m['Longitude'])))
sites = []
for r in rows:
    m = man[str(r[6])]
    approx = False
    if m['Latitude'] and m['Longitude']:
        lat, lng = float(m['Latitude']), float(m['Longitude'])
    else:
        pts = by_region.get((r[1], m['Region']))
        if pts: lat, lng = statistics.mean(p[0] for p in pts), statistics.mean(p[1] for p in pts)
        else: lat, lng = zmap[r[1]]['hub']['lat'], zmap[r[1]]['hub']['lng']
        approx = True
    sites.append(dict(id=f"S{int(r[0]):03d}", type='school', no=str(r[6]), name=m['SchoolName_En'] or r[4], nameAr=m['SchoolName_Ar'],
        zone=r[1], gender='B' if r[5] == 'Boys' else 'G', users=int(r[9]), students=int(r[7]), staff=int(r[8]), size=r[10],
        model=r[11], fte=float(r[14]), group=r[15], lat=round(lat, 6), lng=round(lng, 6), approx=approx,
        area=m['Region'], emirate=m['Emirate En'], register=m['Student Gender EN'],
        staffN=sum(int(m[k] or 0) for k in ('Teachers', 'Admin', 'Technician')), cycle=m['School Cycle EN'] or '',
        built=int(str(m['Building Establishing Date'])[:4]) if str(m['Building Establishing Date'] or '')[:4].isdigit() else None,
        rural=m['School Location Type En'] == 'Rural', rooms=int(m['Building Number Of Rooms'] or 0) if str(m['Building Number Of Rooms'] or '').isdigit() else 0))

rng = random.Random(7)
ns_rows = [r for r in wa['Non-School Sites'].iter_rows(min_row=5, values_only=True) if r[1] and r[2] in zmap]
for r in ns_rows:
    hub = zmap[r[2]]['hub']
    sites.append(dict(id=r[1], type='nonschool', no=r[1], name=r[4], nameAr='', zone=r[2], gender=None,
        users=int(r[7]) if isinstance(r[7], (int, float)) else 120, students=0, staff=0, size='Non-school', model='Zone pool', fte=float(r[10] or 0),
        group=f"{r[2]}-POOL-NS", lat=round(hub['lat'] + rng.uniform(-.05, .05), 6), lng=round(hub['lng'] + rng.uniform(-.05, .05), 6),
        approx=True, area=r[5], emirate='', staffN=0, cycle='', built=None, rural=False, rooms=0))

# ---- engineers
pp = {r[0]: r for r in wa['Pool Plan'].iter_rows(min_row=5, max_row=14, values_only=True)}
engs = []
def add(zone, gender, kind, covers, tag):
    n = sum(1 for e in engs if e['zone'] == zone) + 1
    engs.append(dict(id=f"{zone}-FE{n:02d}", zone=zone, gender=gender, kind=kind, covers=covers, tag=tag))
groups = collections.OrderedDict()
for s in sites:
    if s['type'] == 'school': groups.setdefault(s['group'], []).append(s)
for g, ss in groups.items():
    zone = ss[0]['zone']; gender = ss[0]['gender']
    if g.endswith('-POOL-B') or g.endswith('-POOL-G'): continue
    if 'ONSITE' in g:
        for s in ss:
            for _ in range(int(round(s['fte']))): add(zone, gender, 'dedicated', [s['id']], g)
    else:
        add(zone, gender, 'pair', [s['id'] for s in ss], g)
for z in zones:
    r = pp[z['id']]
    nb, ng, nn = int(r[15]), int(r[16]), int(r[17])
    zb = [s['id'] for s in groups.get(f"{z['id']}-POOL-B", [])]; zg = [s['id'] for s in groups.get(f"{z['id']}-POOL-G", [])]
    zn = [s['id'] for s in sites if s['type'] == 'nonschool' and s['zone'] == z['id']]
    for _ in range(nb): add(z['id'], 'B', 'pool', zb, f"{z['id']}-POOL-B")
    for _ in range(ng): add(z['id'], 'G', 'pool', zg, f"{z['id']}-POOL-G")
    for i in range(nn): add(z['id'], 'B' if i % 2 == 0 else 'G', 'nspool', zn, f"{z['id']}-POOL-NS")
# Where the register says Girls but the workbook says Boys, a male engineer must not be sent: treat as girls' school,
# take it off the male pair and give it to the nearest female pool (Z07a has no female engineers, so Z07b covers).
conf = [s for s in sites if s['type'] == 'school' and s['register'] == 'Girls' and s['gender'] == 'B']
for s in conf:
    s['gender'] = 'G'; s['conflict'] = "Register says girls' school; workbook says boys'. Treated as girls' school."
    for e in engs:
        if s['id'] in e['covers'] and e['gender'] == 'B': e['covers'].remove(s['id'])
    fp = [e for e in engs if e['gender'] == 'G' and e['kind'] == 'pool' and e['zone'] == s['zone']] or [e for e in engs if e['gender'] == 'G' and e['kind'] == 'pool' and e['zone'] == 'Z07b']
    for e in fp: e['covers'].append(s['id'])
    s['group'] = fp[0]['tag'] if fp else s['group']; s['model'] = 'Zone pool'
print('gender conflicts fixed', [c['id'] for c in conf])
print('engineers', len(engs), collections.Counter(e['kind'] for e in engs), collections.Counter(e['gender'] for e in engs))
assert len(engs) == 312, len(engs)
print('approx-located schools', sum(1 for s in sites if s['approx'] and s['type'] == 'school'))
json.dump(dict(zones=zones, sites=sites, engineers=engs, generated='from MOE_EUC_Zone_Engineer_Allocation_v11 + Al Manhal register'),
          open(os.path.join(ROOT, 'public/data/network.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
