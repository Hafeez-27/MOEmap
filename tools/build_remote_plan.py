"""Option Remote: 333 engineers = 10 HQ (fixed, not mapped) + 323 for 522 schools and 48 non-school sites.

Source of truth: "MOE_EUC_Zone_Engineer_Allocation_200Nationals_Option4_Engineers Mapping-Option_Remote.xlsx"
(sheet "Schools List_Updated": proposed zones, GPS confirmed by the team leads, City/Remote flag, size categories;
 "Non-School Sites"; "Zone Lead & Pools Hub Distribut"; "national-breakup"), the call with the project lead (3 Nov 2026)
and his breakdown screenshots:

  Remote  National       200 schools -> 200 engineers  (top 200 remote schools by users, 1 Emirati national on site each)
  Remote  Non-national     2 schools ->   1 engineer   (the 2 smallest remote schools)
  City    Medium/Large/XL 158 schools ->  79 engineers  (1 non-national per 2 schools)
  City    Small/X-Small   162 schools ┐
  City    Non-school       48 sites   ┘->  43 engineers  (zone pool, ~4.9 sites each, managed by the zone lead)
  HQ                        3 sites  ->  10 engineers  (fixed, outside this plan)

Rules: nationals are never shared. Shared and pool engineers stay inside their zone. Same gender first (girls' schools
always get a female engineer); a boys + girls pair is only made where a zone's counts force it, and gets a female engineer.
Shortest drive in 7:30 am school-run traffic decides the rest: Google Maps typical times (tools/google_times.py) once they are
fetched with --google, else the simulator's road model.
Run with --google to look up missing Google times (needs the Routes API on the key in .env); --google --dry-run counts them.
Outputs: public/data/remote-plan.json, dist/MOE-FE-Mapping-Option-Remote-323.xlsx
"""
import json, math, os, sys, itertools, statistics, random
from collections import Counter, defaultdict
import networkx as nx
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import google_times as GT

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WB = os.path.join(ROOT, 'MOE_EUC_Zone_Engineer_Allocation_200Nationals_Option4_Engineers Mapping-Option_Remote.xlsx')
MANHAL = os.path.join(ROOT, 'All Schools - Al Manhal.xlsx')
TOTAL, HQ = 333, 10
TARGET = {'national': 200, 'remote_shared': 1, 'city_shared': 79, 'pool': 43}
SLA = 30
GENDER_PEN = 400        # a boys + girls pair costs this many extra minutes in the matching: only when counts force it

# ---------------------------------------------------------------- road model (port of public/js/travel.js)
ZREG = {'Z01': 'heavy', 'Z02': 'heavy', 'Z03': 'heavy', 'Z07a': 'mid', 'Z07b': 'mid', 'Z06a': 'mid', 'Z06b': 'mid', 'Z04': 'light', 'Z05': 'light', 'Z08': 'light'}
PEAKM = {'heavy': 1.45, 'mid': 1.25, 'light': 1.1}
def hav(a, b):
    R, r = 6371, math.pi / 180
    dl, dg = (b['lat'] - a['lat']) * r, (b['lng'] - a['lng']) * r
    x = math.sin(dl / 2) ** 2 + math.cos(a['lat'] * r) * math.cos(b['lat'] * r) * math.sin(dg / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))
ARGS = sys.argv[1:]
FETCH, DRY = '--google' in ARGS, '--dry-run' in ARGS
PASS = int(ARGS[ARGS.index('--pass') + 1]) if '--pass' in ARGS else 1
USE_G = FETCH or GT.size() > 0     # once Google times are cached, every build uses them
RATIO = {}                         # (zone, peak) -> Google / model, used only for pairs Google was never asked about
SRC = {}                           # (from id, to id, peak) -> 'google' | 'same' | 'model'
_tc = {}
def travel(a, b, peak=True):
    k = (a['id'], b['id'], peak)
    if k in _tc: return _tc[k]
    g = None
    if a.get('boat') or b.get('boat'): r, src = (None, None), None
    elif USE_G and hav(a, b) < 0.05: r, src = (0, 0.0), 'same'
    elif USE_G and (g := GT.get(a, b, 'peak' if peak else 'off')): r, src = (max(1, round(g[0])), g[1]), 'google'
    else:
        t, km = model(a, b, peak); src = 'model'
        r = (round(t * RATIO.get((a['zone'], peak), 1)), km) if USE_G else (t, km)
    _tc[k] = r; SRC[k] = src; return r
def model(a, b, peak=True):
    line = hav(a, b); km = line * (1.4 if line <= 10 else 1.3 if line <= 35 else 1.15)
    rest, mins, city, prev = km, 0, 0, 0
    for lim, v in [(10, 30), (35, 55), (1e9, 120)]:
        seg = max(0, min(rest, lim - prev)); m = seg / v * 60; mins += m
        if lim < 1e9: city += m
        rest -= seg; prev = lim
        if rest <= 0: break
    za, zb = a['oz'], b['oz']
    if not peak: mult = 1.05
    elif {za, zb} & {'Z01'} and {za, zb} & {'Z02', 'Z03'}: mult = 1.7
    else:
        rg = [ZREG[za], ZREG[zb]]; mult = PEAKM['heavy' if 'heavy' in rg else 'mid' if 'mid' in rg else 'light']
    hwy = mins - city
    drive = (city * mult + hwy * (1 + (mult - 1) * 0.3)) * (1.1 if (a.get('rural') or b.get('rural')) else 1)
    return round(max(10, drive + 8)), round(km, 1)
def T(a, b): return travel(S[a], S[b])[0] or 0

# ---------------------------------------------------------------- read the workbook
wb = openpyxl.load_workbook(WB, read_only=True, data_only=True)
rows = list(wb['Schools List_Updated'].iter_rows(values_only=True)); H = rows[3]
raw = [dict(zip(H, r)) for r in rows[4:] if r[0] is not None and r[5]]
zrows = [r for r in wb['Zone Lead & Pools Hub Distribut'].iter_rows(values_only=True)]
ZONES = []
for r in zrows[3:]:
    if isinstance(r[0], int) and r[1]:
        ZONES.append({'id': r[1], 'name': r[2], 'lead': r[3], 'hub': r[4]})
ZNAME = {z['id']: z['name'] for z in ZONES}
LABEL = {'DXB-SHJ': 'Dubai & Sharjah', 'KFK-DBA': 'Khor Fakkan & Dibba', 'AJM-UAQ': 'Ajman, Sharjah & UAQ', 'RAK': 'Ras Al Khaimah',
         'FUJ-KLB': 'Fujairah & Kalba', 'AAN-A': 'Al Ain A', 'AAN-B': 'Al Ain B', 'AUH-A': 'Abu Dhabi A', 'AUH-B': 'Abu Dhabi B', 'DHF': 'Al Dhafra'}
for z in ZONES: z['label'] = LABEL.get(z['id'], z['name'])

# Al Manhal register: rural flag, Arabic name, cycle (matched by GPS, which is identical for the schools both lists share)
mrows = list(openpyxl.load_workbook(MANHAL, read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True)); MH = mrows[0]
MAN = [dict(zip(MH, r)) for r in mrows[1:]]
MAN_GPS = {}
for m in MAN:
    try: MAN_GPS[(round(float(m['Latitude']), 4), round(float(m['Longitude']), 4))] = m
    except (TypeError, ValueError): pass
MAN_ID = {str(m['School_ID']): m for m in MAN}
# the simulator's old zones drive the traffic multipliers: take the old zone of the nearest site in network.json
NET = [s for s in json.load(open(os.path.join(ROOT, 'public/data/network.json')))['sites'] if s['type'] == 'school' and not s.get('approx')]
def old_zone(lat, lng): return min(NET, key=lambda s: (s['lat'] - lat) ** 2 + (s['lng'] - lng) ** 2)['zone']

num = lambda v: int(float(v)) if v not in (None, '') else 0
S = {}
closed = 0
for d in raw:
    cr = str(d['City/ Remote']).strip().capitalize()
    if cr == 'Closed' or d['Zone ID'] == 'Removed': closed += 1; continue
    no = str(d['School no.']).strip()
    lat, lng, note, approx, boat = d['Latitude'], d['Longitude'], '', False, False
    if not isinstance(lat, (int, float)):
        # Abu Moosa School: the workbook gives "Not in Service" for its GPS; it is on Abu Musa island
        lat, lng, approx, boat = 25.873, 55.033, True, True
        note = 'The workbook gives "Not in Service" for this school\'s location. Shown on Abu Musa island; no road access, so no drive time.'
    m = MAN_GPS.get((round(float(lat), 4), round(float(lng), 4))) or MAN_ID.get(no) or MAN_ID.get(no + 'AD')
    g = {'Boys': 'B', 'Girls': 'G', 'Mix': 'M'}[d['Girls/ Boys']]
    sid = f'S{len(S) + 1:03d}'
    S[sid] = {'id': sid, 'no': no, 'name': str(d['School name']).strip(), 'nameAr': (m or {}).get('SchoolName_Ar') or '', 'zone': d['Zone ID'],
              'area': d['Sub-area (register)'], 'lat': float(lat), 'lng': float(lng), 'g': g, 'cr': cr, 'size': d['Size category'],
              'qsize': d['Qualified Size Category'], 'users': num(d['Supported users']), 'st': num(d['Students']), 'sf': num(d['All staff']),
              'rural': bool(m and m.get('School Location Type En') == 'Rural'), 'cycle': (m or {}).get('School Cycle EN') or '',
              'lead': d['Tower Lead Name'], 'type': 'school', 'approx': approx, 'boat': boat, 'note': note}
    S[sid]['oz'] = old_zone(S[sid]['lat'], S[sid]['lng'])
schools = list(S.values())

# non-school sites: no coordinates in the workbook. Placed at a school the site names (e.g. "4104"), else around the
# centre of its area, and marked "location to confirm".
AREA_XY = {'dubai': (25.265, 55.335), 'sharjah': (25.330, 55.420), 'ajman': (25.405, 55.470), 'ras al khaimah': (25.790, 55.950),
           'fujairah': (25.125, 56.330), 'eastern sharjah': (25.030, 56.345), 'khor fakkan': (25.340, 56.345), 'alain': (24.215, 55.745),
           'abu dhabi': (24.455, 54.385), 'al dhafra': (23.680, 53.710)}
ZONE_XY = {z: (statistics.median(s['lat'] for s in schools if s['zone'] == z), statistics.median(s['lng'] for s in schools if s['zone'] == z)) for z in LABEL}
by_no = {s['no']: s for s in schools}
NS_DEFAULT_USERS = 75     # the workbook's assumption for a non-school site with no user count
rnd = random.Random(7)
ns_rows = [r for r in wb['Non-School Sites'].iter_rows(values_only=True)][4:52]
placed = Counter()
for r in ns_rows:
    num_, code, zone, _, name, area, stype, users, vip = r[:9]
    name = (str(name).strip() if name else '') or f'Non-school site {code} (to confirm)'
    placeholder = 'to confirm' in name.lower() or not r[4]
    ref = next((s for s in schools if any(f'"{s["no"]}"' in name or f' {s["no"]}"' in name for _ in [0])), None)
    if ref:
        lat, lng, how = ref['lat'] + 0.0012, ref['lng'] + 0.0012, f'Placed at {ref["name"]} (named in the site title)'
    else:
        key = str(area or '').strip().lower()
        base = AREA_XY.get(key) or ZONE_XY[zone]
        k = placed[(zone, base)]; placed[(zone, base)] += 1
        ang, rad = k * 2.4, 0.012 + 0.006 * k
        lat, lng = base[0] + rad * math.sin(ang), base[1] + rad * math.cos(ang)
        how = f'Placed near the centre of {area}' if AREA_XY.get(key) else 'Placed near the middle of its zone'
    sid = f'N{len(ns_rows) and int(num_):02d}'
    S[sid] = {'id': sid, 'no': str(code), 'name': name, 'nameAr': '', 'zone': zone, 'area': area or '', 'lat': lat, 'lng': lng, 'g': None, 'cr': 'City',
              'size': 'Non-school', 'qsize': '', 'users': int(users) if users else NS_DEFAULT_USERS, 'usersAssumed': not users, 'st': 0, 'sf': 0,
              'rural': False, 'cycle': '', 'lead': next(z['lead'] for z in ZONES if z['id'] == zone), 'type': 'office', 'stype': stype or 'To confirm',
              'vip': vip == 'Y', 'approx': True, 'boat': False, 'placeholder': placeholder,
              'note': how + '. Location to confirm.' + ('' if users else f' Users not given; the workbook assumes {NS_DEFAULT_USERS}.')}
    S[sid]['oz'] = old_zone(lat, lng)
offices = [s for s in S.values() if s['type'] == 'office']

# ---------------------------------------------------------------- Google Maps drive times
# Google is asked about every nearby pair the allocation could choose: each city M/L/XL school to its 8 nearest in the zone,
# each pool site to its 12 nearest. Any other pair uses the road model scaled to Google's times in that zone. After the
# allocation, every trip an engineer actually makes is looked up (7:30 and 10:30), and the allocation re-runs on those.
def nearest(i, ids, k): return sorted((j for j in ids if j != i), key=lambda j: hav(S[i], S[j]))[:k]
CAND = set()
if USE_G:
    big, small = defaultdict(list), defaultdict(list)
    for s in S.values():
        if s['boat']: continue
        if s['type'] == 'school' and s['cr'] == 'City' and s['size'] in ('Medium', 'Large', 'X-Large'): big[s['zone']].append(s['id'])
        elif s['type'] == 'office' or (s['cr'] == 'City' and s['size'] in ('Small', 'X-Small')): small[s['zone']].append(s['id'])
    for grp, k in ((big, 8), (small, 12)):
        for ids in grp.values():
            for i in ids:
                for j in nearest(i, ids, k):
                    a, b = (i, j) if grp is small or S[i]['users'] >= S[j]['users'] else (j, i)
                    if hav(S[a], S[b]) >= 0.05: CAND.add((a, b))
    if FETCH:
        n = GT.fetch([(S[a], S[b]) for a, b in sorted(CAND)], 'peak', dry=DRY)
        print(f'google: {len(CAND)} nearby pairs, {n} {"to look up" if DRY else "looked up"} (7:30 am)')
    for peak in (True, False):
        rs = defaultdict(list)
        for a, b in CAND:
            g = GT.get(S[a], S[b], 'peak' if peak else 'off')
            if g and g[0] > 0: rs[S[a]['zone']].append(g[0] / model(S[a], S[b], peak)[0])
        allr = [r for v in rs.values() for r in v]
        for z in LABEL:
            RATIO[(z, peak)] = statistics.median(rs[z]) if len(rs[z]) >= 5 else statistics.median(allr) if allr else RATIO.get((z, True), 1)

# ---------------------------------------------------------------- engineers
ENG = []
def mklegs(base, sites):
    b = S[base]; legs = []
    for m in sites:
        if m == base: continue
        t, km = travel(b, S[m]); to, _ = travel(b, S[m], False)
        legs.append({'to': m, 'peak': t, 'off': to, 'km': km, 'src': SRC.get((base, m, True))})
    return legs
def add(kind, sites, base, gender, nat, note='', flags=()):
    legs = mklegs(base, sites)
    e = {'id': None, 'kind': kind, 'sites': sites, 'base': base, 'zone': S[base]['zone'], 'gender': gender, 'nat': nat, 'legs': legs,
         'maxPeak': max([l['peak'] or 0 for l in legs], default=0), 'users': sum(S[m]['users'] for m in sites), 'note': note, 'flags': list(flags)}
    ENG.append(e); return e

# 1) remote: top 200 by users -> 1 Emirati national each (female for girls' schools); the 2 smallest -> 1 non-national
remote = sorted([s for s in schools if s['cr'] == 'Remote'], key=lambda s: (-s['users'], s['name']))
assert len(remote) == 202, len(remote)
for s in remote[:200]:
    add('national', [s['id']], s['id'], {'B': 'Male', 'G': 'Female', 'M': 'Male or female'}[s['g']], 'Emirati national',
        'Dedicated to this school, on site. Nationals are never shared (MOE rule).')
low = remote[200:]
base = next((s for s in low if not s['boat']), low[0])
add('remote_shared', [base['id']] + [s['id'] for s in low if s is not base], base['id'], 'Male', 'Non-national',
    'The two smallest remote schools share one non-national engineer.' + (' Abu Moosa is on Abu Musa island: visits by boat.' if any(s['boat'] for s in low) else ''),
    (['island'] if any(s['boat'] for s in low) else []) + (['two-zones'] if len({s['zone'] for s in low}) > 1 else []))

# 2) city Medium / Large / X-Large: 1 non-national per 2 schools, inside the zone, same gender first, shortest drive
def compat(a, b): return 'M' in (S[a]['g'], S[b]['g']) or S[a]['g'] == S[b]['g']
def Tb(a, b): return T(a, b) if S[a]['users'] >= S[b]['users'] else T(b, a)     # from the larger school, where the engineer sits
def pc(a, b): return Tb(a, b) + (0 if compat(a, b) else GENDER_PEN)
def match(ids):
    G = nx.Graph(); G.add_nodes_from(ids)
    for a, b in itertools.combinations(ids, 2): G.add_edge(a, b, weight=100000 - pc(a, b))
    M = [tuple(e) for e in nx.max_weight_matching(G, maxcardinality=True)]
    return M, sum(pc(*e) for e in M)
def join_cost(v, pair): return max(pc(v, m) for m in pair)
city_big = [s for s in schools if s['cr'] == 'City' and s['size'] in ('Medium', 'Large', 'X-Large')]
assert len(city_big) == 158, len(city_big)
zones_big = defaultdict(list)
for s in city_big: zones_big[s['zone']].append(s['id'])
plans = {}
for z, ids in zones_big.items():
    if len(ids) % 2 == 0: plans[z] = {'even': match(ids)}
    else:
        tri = single = None
        for v in ids:
            M, c = match([i for i in ids if i != v])
            jc = min(join_cost(v, e) for e in M) if M else 10 ** 6
            if not tri or c + jc < tri[0]: tri = (c + jc, M, v)
            if not single or (c, -S[v]['users']) < (single[0], -S[single[2]]['users']): single = (c, M, v)
        plans[z] = {'triad': tri, 'single': single}
odd = sorted(z for z in plans if 'even' not in plans[z])
assert len(odd) % 2 == 0, odd
best = None
for combo in itertools.combinations(odd, len(odd) // 2):     # half the odd zones take a 3-school engineer, half a 1-school one
    cost = sum(plans[z]['triad'][0] if z in combo else plans[z]['single'][0] for z in odd)
    if not best or cost < best[0]: best = (cost, set(combo))
def pair_gender(ids):
    gs = {S[i]['g'] for i in ids} - {'M'}
    return 'Female' if 'G' in gs else 'Male' if gs else 'Male or female'
def add_city(ids, note='', flags=()):
    base = max(ids, key=lambda i: S[i]['users'])          # engineer based at the larger school
    ids = [base] + [i for i in ids if i != base]
    gs = {S[i]['g'] for i in ids} - {'M'}
    fl = list(flags) + (['mixed'] if len(gs) > 1 else [])
    if len(gs) > 1: note = (note + ' ' if note else '') + "This zone has an odd number of both boys' and girls' city schools, so one pair has to mix; it gets a female engineer."
    return add('city_shared', ids, base, pair_gender(ids), 'Non-national', note, fl)
for z, p in sorted(plans.items()):
    if 'even' in p:
        for e in p['even'][0]: add_city(list(e))
    elif z in best[1]:
        _, M, v = p['triad']; tgt = min(M, key=lambda e: join_cost(v, e))
        for e in M:
            if e is tgt: add_city(list(e) + [v], f'{LABEL[z]} has an odd number of city schools, so this engineer covers 3.', ['three'])
            else: add_city(list(e))
    else:
        _, M, v = p['single']
        for e in M: add_city(list(e))
        add_city([v], f'{LABEL[z]} has an odd number of city schools, so this school keeps a whole engineer.', ['single'])

# 3) city Small / X-Small + non-school sites: 43 pool engineers, split across zones by workload (half users, half sites,
#    at least 1 per zone); every girls' school is in a female engineer's patch; patches are balanced and compact.
pool_sites = [s for s in schools if s['cr'] == 'City' and s['size'] in ('Small', 'X-Small')] + offices
assert len(pool_sites) == 210, len(pool_sites)
Utot, Ntot = sum(s['users'] for s in pool_sites), len(pool_sites)
w = {s['id']: 0.5 * s['users'] / Utot + 0.5 / Ntot for s in pool_sites}
# 2b) a zone whose girls' small schools would give a female pool engineer less than half a normal load: those schools join
#     the nearest female city engineer in the same zone (girls' schools stay with a female engineer; nobody sits idle)
avg_pool = sum(w.values()) / TARGET['pool']
attached = set()
for z in sorted({s['zone'] for s in pool_sites}):
    girls = [s['id'] for s in pool_sites if s['zone'] == z and s['g'] == 'G']
    if not girls or sum(w[i] for i in girls) >= 0.5 * avg_pool: continue
    for gid in girls:
        cand = [e for e in ENG if e['kind'] == 'city_shared' and e['zone'] == z and e['gender'] == 'Female' and len(e['sites']) < 4]
        best_e = min(cand, key=lambda e: max(T(m, gid) for m in e['sites']), default=None)
        if best_e is None or max(T(m, gid) for m in best_e['sites']) > 45: continue
        ENG.remove(best_e)
        ne = add('city_shared', best_e['sites'] + [gid], best_e['base'], best_e['gender'], best_e['nat'],
                 (best_e['note'] + ' ' if best_e['note'] else '') + f"Also covers {S[gid]['name']}, a small girls' school: it is the only one nearby, so it rides with this female engineer instead of a pool engineer.",
                 best_e['flags'] + ['plus-small'])
        attached.add(gid)
zsites = defaultdict(list)
for s in pool_sites:
    if s['id'] not in attached: zsites[s['zone']].append(s['id'])
POOL = TARGET['pool']
alloc = {z: 1 for z in zsites}
share = {z: sum(w[i] for i in v) * POOL for z, v in zsites.items()}
while sum(alloc.values()) < POOL:
    z = max(alloc, key=lambda z: (share[z] - alloc[z], share[z])); alloc[z] += 1
def medoid(p): return min(p, key=lambda c: (sum(T(c, i) for i in p), -S[c]['users']))
def partition(ids, k):
    """k compact patches of near-equal size: each patch gets between floor(n/k)-1 and ceil(n/k)+1 sites, and the assignment
    minimises total drive time to the patch centres (min-cost flow), alternating with re-centring until stable."""
    ids = list(ids)
    if k <= 1 or len(ids) <= 1: return [ids]
    k = min(k, len(ids)); n = len(ids)
    lo, hi = max(1, n // k - 1), -(-n // k) + 1
    med = [medoid(ids)]
    while len(med) < k: med.append(max((i for i in ids if i not in med), key=lambda i: min(T(i, m) for m in med)))
    part = None
    for _ in range(20):
        G = nx.DiGraph(); G.add_node('src', demand=-n); G.add_node('snk', demand=n)
        for i in ids:
            G.add_edge('src', ('s', i), capacity=1, weight=0)
            for m in med: G.add_edge(('s', i), ('m', m), capacity=1, weight=T(m, i))
        for m in med:
            G.add_edge(('m', m), ('lo', m), capacity=lo, weight=-100000); G.add_edge(('lo', m), 'snk', capacity=lo, weight=0)
            G.add_edge(('m', m), ('hi', m), capacity=hi - lo, weight=0); G.add_edge(('hi', m), 'snk', capacity=hi - lo, weight=0)
        flow = nx.min_cost_flow(G)
        part = {m: [i for i in ids if flow[('s', i)].get(('m', m), 0) == 1] for m in med}
        new = [medoid(p) for p in part.values() if p]
        if sorted(new) == sorted(med): break
        med = new
    return [p for p in part.values() if p]
pool_notes = {}
for z in sorted(zsites):
    k = alloc[z]; ids = zsites[z]
    girls = [i for i in ids if S[i]['g'] == 'G']
    boys = [i for i in ids if S[i]['g'] in ('B', 'M')]
    offs = [i for i in ids if S[i]['type'] == 'office']
    f = 0
    if girls:
        f = max(1, round(k * sum(w[i] for i in girls) / sum(w[i] for i in ids)))
        if boys and f >= k: f = k - 1
    avg = sum(w[i] for i in ids) / k
    fpatches = partition(girls, f) if f else []
    # non-school sites (any engineer) go to the nearest patch that is under the zone's average workload, female first
    # boys' schools and offices (any engineer) are split together into balanced, compact patches; a female patch that is
    # short of the zone's average then takes the nearest offices within 30 min from the male patches
    mpatches = partition(boys + offs, k - f) if k - f else []
    if f and k - f == 0:            # one engineer for the whole zone: a female engineer covers the boys' sites and offices too
        fpatches[0] += boys + offs
    per = (len(ids)) / k
    # a female patch that is short takes, within 30 min: offices from patches above the smallest normal size first, then boys'
    # schools from patches above the zone average (a female engineer may cover boys' schools, as in a mixed city pair)
    for fp in fpatches:
        while len(fp) < per - 1:
            cand = [(0 if S[o]['type'] == 'office' else 1, min(T(o, i) for i in fp), o, mp) for mp in mpatches for o in mp
                    if (S[o]['type'] == 'office' and len(mp) > per - 1) or (S[o]['type'] == 'school' and len(mp) > per)]
            cand = [c for c in cand if c[1] <= 30]
            if not cand: break
            _, _, o, mp = min(cand, key=lambda c: (c[0], c[1])); mp.remove(o); fp.append(o)
    for p, gender in [(p, 'Female') for p in fpatches] + [(p, 'Male') for p in mpatches]:
        sch = [i for i in p if S[i]['type'] == 'school'] or p
        b = medoid(sch); p = [b] + [i for i in p if i != b]
        fl = ['mixed'] if gender == 'Female' and any(S[i]['g'] == 'B' for i in p) else []
        add('pool', p, b, gender, 'Non-national',
            f'One of {k} pool engineers in {LABEL[z]}. The zone lead dispatches pool engineers by ticket; this is their home patch.', fl)
assert len(ENG) == TOTAL - HQ, len(ENG)

# every trip an engineer makes gets Google's typical time at 7:30 and 10:30; if new 7:30 times came in, re-run the allocation
if FETCH:
    need = lambda pk: [(S[e['base']], S[l['to']]) for e in ENG for l in e['legs'] if SRC.get((e['base'], l['to'], pk)) == 'model']
    n1, n2 = GT.fetch(need(True), 'peak', dry=DRY), GT.fetch(need(False), 'off', dry=DRY)
    print(f'google: engineer trips {n1} {"to look up" if DRY else "looked up"} at 7:30 am, {n2} at 10:30 am (pass {PASS})')
    if DRY:
        print(f'google: about {len(CAND) + n1 + n2} lookups in total for a first run; re-runs add a few more'); sys.exit(0)
    if n1 and PASS < 4:
        os.execv(sys.executable, [sys.executable, os.path.abspath(__file__), '--google', '--pass', str(PASS + 1)])
    if n1 or n2:
        _tc.clear()
        for e in ENG:
            e['legs'] = mklegs(e['base'], e['sites']); e['maxPeak'] = max([l['peak'] or 0 for l in e['legs']], default=0)

# ---------------------------------------------------------------- ids, checks, stats
KCODE = {'national': 'N', 'remote_shared': 'R', 'city_shared': 'C', 'pool': 'P'}
ORDER = {'national': 0, 'remote_shared': 1, 'city_shared': 2, 'pool': 3}
zorder = [z['id'] for z in ZONES]
ENG.sort(key=lambda e: (zorder.index(e['zone']), ORDER[e['kind']], -e['users']))
cnt = Counter()
for e in ENG:
    cnt[(e['zone'], e['kind'])] += 1
    e['id'] = f"{e['zone']}-{KCODE[e['kind']]}{cnt[(e['zone'], e['kind'])]:02d}"
    for m in e['sites']: S[m]['eng'] = e['id']
seen = Counter(m for e in ENG for m in e['sites'])
assert all(v == 1 for v in seen.values()) and len(seen) == len(S), 'every site exactly once'
assert not [e for e in ENG if e['kind'] in ('city_shared', 'pool') and len({S[m]['zone'] for m in e['sites']}) > 1], 'no zone crossing'
kinds = Counter(e['kind'] for e in ENG)
assert kinds['national'] == 200 and kinds['remote_shared'] == 1 and kinds['city_shared'] == 79 and kinds['pool'] == 43, kinds

pairs = [e for e in ENG if e['kind'] == 'city_shared' and len(e['sites']) > 1]
pmins = sorted(e['maxPeak'] for e in pairs)
pools = [e for e in ENG if e['kind'] == 'pool']
stats = {
    'pairs': len(pairs), 'pair_median': statistics.median(pmins), 'pair_le15': sum(m <= 15 for m in pmins), 'pair_le30': sum(m <= 30 for m in pmins),
    'pair_gt30': sum(m > 30 for m in pmins), 'pair_km_median': statistics.median(max(l['km'] for l in e['legs']) for e in pairs),
    'pair_users_avg': round(statistics.mean(e['users'] for e in ENG if e['kind'] == 'city_shared')),
    'mixed_pairs': [e['id'] for e in ENG if e['kind'] == 'city_shared' and 'mixed' in e['flags']],
    'qualified_xs_city': sum(1 for s in city_big if s['qsize'] in ('X-Small', 'Small')),
    'pool_sites_avg': round(statistics.mean(len(e['sites']) for e in pools), 2), 'girls_small_with_city_engineer': len(attached), 'pool_sites_max': max(len(e['sites']) for e in pools),
    'pool_users_avg': round(statistics.mean(e['users'] for e in pools)),
    'pool_median_reach': statistics.median(l['peak'] for e in pools for l in e['legs'] if l['peak'] is not None),
    'pool_le30_sites': sum(1 for e in pools for l in e['legs'] if l['peak'] is not None and l['peak'] <= 30) + len(pools),
    'pool_alloc': alloc, 'female': Counter(e['gender'] for e in ENG), 'closed_removed': closed,
    'ns_placeholders': sum(1 for s in offices if s['placeholder']), 'ns_users_assumed': sum(1 for s in offices if s['usersAssumed']),
}
LEGS = [l for e in ENG for l in e['legs'] if l['peak'] is not None]
ng = sum(l['src'] in ('google', 'same') for l in LEGS)
stats['times'] = {'source': 'google' if ng == len(LEGS) else 'mixed' if ng else 'model', 'legs': len(LEGS), 'google': ng,
                  'meta': GT.meta() if ng else {}}
for z in ZONES:
    es = [e for e in ENG if e['zone'] == z['id']]
    z.update({'schools': sum(1 for s in schools if s['zone'] == z['id']), 'offices': sum(1 for s in offices if s['zone'] == z['id']),
              'remote': sum(1 for s in schools if s['zone'] == z['id'] and s['cr'] == 'Remote'),
              'cityBig': sum(1 for s in city_big if s['zone'] == z['id']), 'citySmall': sum(1 for s in schools if s['zone'] == z['id'] and s['cr'] == 'City' and s['size'] in ('Small', 'X-Small')),
              'eng': len(es), 'byKind': dict(Counter(e['kind'] for e in es)), 'female': sum(e['gender'] == 'Female' for e in es),
              'lat': ZONE_XY[z['id']][0], 'lng': ZONE_XY[z['id']][1]})
out = {'generated': 'tools/build_remote_plan.py', 'sla': SLA, 'total': TOTAL, 'hq': HQ, 'target': TARGET, 'zones': ZONES, 'stats': stats,
       'sites': [{k: v for k, v in s.items() if k != 'oz'} for s in S.values()], 'engineers': ENG}
json.dump(out, open(os.path.join(ROOT, 'public/data/remote-plan.json'), 'w'), separators=(',', ':'), default=str)

# ---------------------------------------------------------------- FE mapping workbook
KIND = {'national': 'Dedicated Emirati national (remote school, on site)', 'remote_shared': 'Remote shared non-national (2 smallest remote schools)',
        'city_shared': 'City shared non-national (Medium / Large / X-Large)', 'pool': 'City pool non-national (Small / X-Small + non-school)'}
xb = openpyxl.Workbook(); bold = Font(bold=True); head = PatternFill('solid', fgColor='DCE6F5')
sm = xb.active; sm.title = 'Summary'
sm.append(['Option Remote: 333 engineers for 573 locations']); sm['A1'].font = Font(bold=True, size=13)
sm.append([]); sm.append(['', 'Category', 'Sites', 'Engineers', 'Who'])
for r in [('City', 'Medium, Large, X-Large', 158, 79, 'Non-national, 1 per 2 schools'), ('City', 'X-Small, Small', 162, 43, 'Non-national zone pool'),
          ('City', 'Non-school sites', 48, '(in pool)', 'Zone pool'), ('Remote', 'National', 200, 200, 'Emirati national, 1 per school'),
          ('Remote', 'Non-national', 2, 1, 'Non-national, shared'), ('', 'Schools + non-school', 570, 323, ''), ('HQ', 'HQ sites', 3, 10, 'Fixed, not mapped'),
          ('', 'Total', 573, 333, '')]: sm.append(list(r))
for c in sm[3]: c.font = bold; c.fill = head
sm.append([]); sm.append(['Zone', 'Team Lead', 'Schools', 'Remote', 'City M/L/XL', 'City S/XS', 'Non-school', 'Nationals', 'City shared', 'Pool', 'Remote shared', 'Engineers', 'Female engineers'])
hr = sm.max_row
for z in ZONES:
    b = z['byKind']; sm.append([f"{z['id']} {z['label']}", z['lead'], z['schools'], z['remote'], z['cityBig'], z['citySmall'], z['offices'],
                                b.get('national', 0), b.get('city_shared', 0), b.get('pool', 0), b.get('remote_shared', 0), z['eng'], z['female']])
for c in sm[hr]: c.font = bold; c.fill = head
sm.column_dimensions['A'].width = 30; sm.column_dimensions['B'].width = 26; sm.column_dimensions['E'].width = 30
GOO = stats['times']['source'] != 'model'
TLONG = 'Longest drive from base, Google Maps typical at 7:30 am (min)' if GOO else 'Longest drive from base, peak (min)'
es = xb.create_sheet('Engineers')
es.append(['Engineer ID', 'Zone', 'Team Lead', 'Coverage', 'Engineer gender', 'Nationality', 'Base site', 'Base School no.', 'Sites', 'Schools', 'Non-school',
           'Supported users', TLONG, 'Notes', 'Site list (School no. / site code)'])
for e in ENG:
    sc = [m for m in e['sites'] if S[m]['type'] == 'school']
    es.append([e['id'], e['zone'], next(z['lead'] for z in ZONES if z['id'] == e['zone']), KIND[e['kind']], e['gender'], e['nat'], S[e['base']]['name'], S[e['base']]['no'],
               len(e['sites']), len(sc), len(e['sites']) - len(sc), e['users'], e['maxPeak'] or '', e['note'], ', '.join(S[m]['no'] for m in e['sites'])])
for c in es[1]: c.font = bold; c.fill = head
es.freeze_panes = 'B2'
for col, wd in zip('ABCDEFGHIJKLMNO', [14, 10, 22, 44, 14, 16, 40, 12, 6, 8, 10, 10, 12, 60, 60]): es.column_dimensions[col].width = wd
ss = xb.create_sheet('Sites')
ss.append(['School no. / site code', 'Name', 'Zone', 'Team Lead', 'City / Remote', 'Size category', 'Qualified size', 'Boys / Girls', 'Supported users',
           'Students', 'Staff', 'Engineer ID', 'Coverage', 'Engineer gender', *(['Drive from base, typical 7:30 am (min)', 'Drive from base, typical 10:30 am (min)', 'Road km', 'Drive time source'] if GOO else ['Drive from engineer base, peak (min)']), 'Latitude', 'Longitude', 'Note'])
E = {e['id']: e for e in ENG}
def drive_cols(s, leg):
    if not GOO: return [(leg['peak'] if leg else 0) if not s['boat'] else 'boat']
    if s['boat']: return ['boat', '', '', '']
    if not leg: return ['Base', '', '', '']
    return [leg['peak'], leg['off'], leg['km'], {'google': 'Google Maps', 'same': 'Same place', 'model': 'Estimate'}[leg['src']]]
for s in sorted(S.values(), key=lambda s: (zorder.index(s['zone']), s['type'], s['name'])):
    e = E[s['eng']]; leg = next((l for l in e['legs'] if l['to'] == s['id']), None)
    ss.append([s['no'], s['name'], s['zone'], s['lead'], s['cr'], s['size'], s['qsize'], {'B': 'Boys', 'G': 'Girls', 'M': 'Mix', None: '-'}[s['g']], s['users'],
               s['st'], s['sf'], e['id'], KIND[e['kind']], e['gender'], *drive_cols(s, leg), round(s['lat'], 6), round(s['lng'], 6), s['note']])
for c in ss[1]: c.font = bold; c.fill = head
ss.freeze_panes = 'C2'
for col, wd in zip('ABCDEFGHIJKLMNOPQRSTU', [12, 46, 10, 22, 8, 12, 12, 8, 8, 8, 8, 14, 44, 12] + ([12, 12, 8, 12] if GOO else [10]) + [11, 11, 60]): ss.column_dimensions[col].width = wd
XL = os.path.join(ROOT, 'dist/MOE-FE-Mapping-Option-Remote-323.xlsx'); os.makedirs(os.path.dirname(XL), exist_ok=True); xb.save(XL)

print('engineers', len(ENG), '+ HQ', HQ, '=', len(ENG) + HQ, dict(kinds))
print('stats', {k: v for k, v in stats.items()})
print('odd zones', odd, '-> 3-school', best[1])
print('city shared sizes', Counter(len(e['sites']) for e in ENG if e['kind'] == 'city_shared'))
print('pool', sorted((e['id'], len(e['sites']), e['gender'], e['maxPeak']) for e in pools))
print('wrote', XL)
