"""Coverage plan: dedicated / shared / pool clusters for all 522 MOE schools + 48 non-school sites.

Inputs : public/data/network.json (schools from the Al Manhal register: GPS, gender, users, rural flag)
Rules  : deck "MOE_EUC_Resource_Deployment_Plan_Management_Schools mapping.pptx", Option 1
  - X-Large (14), Large (44), Medium top list (130) + the two Dalma island schools -> 1 dedicated Emirati national each
  - Medium others (71) and Small (161) -> 1 non-national shared by 2 schools (a 3rd school only where no partner fits)
  - X-Small (100) and non-school sites (48) -> zone pool clusters, ticket-driven
Hard constraints
  - gender: boys' schools only male engineers, girls' schools only female (co-ed follows the workbook: male coverage)
  - travel SLA: every school in a shared/pool cluster is reachable from the engineer's base school within the
    P1 response target (30 min, door to door, at school-run PEAK traffic, same road model as the simulator)
  - rural schools: Emirati nationals placed first
Output : public/data/coverage-plan.json
"""
import json, math, os, itertools
import networkx as nx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
net = json.load(open(os.path.join(ROOT, 'public/data/network.json')))
SLA = 30                       # P1 response, minutes
POOL_USERS, POOL_SITES = 1500, 6   # one pool engineer's load (deck: ~1,476 users per pool engineer)
TRIAD_USERS = 1500

# ---- road model (port of public/js/travel.js + model.js) ----
REGION = {'Z01': 'heavy', 'Z02': 'heavy', 'Z03': 'heavy', 'Z07a': 'mid', 'Z07b': 'mid', 'Z06a': 'mid', 'Z06b': 'mid', 'Z04': 'light', 'Z05': 'light', 'Z08': 'light'}
PEAK = {'heavy': 1.45, 'mid': 1.25, 'light': 1.1}
def hav(a, b):
    R, r = 6371, math.pi / 180
    dl, dg = (b['lat'] - a['lat']) * r, (b['lng'] - a['lng']) * r
    x = math.sin(dl / 2) ** 2 + math.cos(a['lat'] * r) * math.cos(b['lat'] * r) * math.sin(dg / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))
PEAK_DEFAULT = os.environ.get("PLAN_PEAK", "1") == "1"
def travel(a, b, peak=None):
    peak = PEAK_DEFAULT if peak is None else peak
    line = hav(a, b); km = line * (1.4 if line <= 10 else 1.3 if line <= 35 else 1.15)
    rest, mins, city, prev = km, 0, 0, 0
    for lim, v in [(10, 30), (35, 55), (1e9, 120)]:
        seg = max(0, min(rest, lim - prev)); m = seg / v * 60; mins += m
        if lim < 1e9: city += m
        rest -= seg; prev = lim
        if rest <= 0: break
    za, zb = a['zone'], b['zone']
    if not peak: mult = 1.05
    elif {za, zb} & {'Z01'} and {za, zb} & {'Z02', 'Z03'}: mult = 1.7
    else:
        rg = [REGION[za], REGION[zb]]; mult = PEAK['heavy' if 'heavy' in rg else 'mid' if 'mid' in rg else 'light']
    hwy = mins - city
    drive = (city * mult + hwy * (1 + (mult - 1) * 0.3)) * (1.1 if (a.get('rural') or b.get('rural')) else 1)
    return round(max(10, drive + 8)), round(km, 1)

# School figures come straight from the Al Manhal register (agreed with the project lead): supported users =
# Total Students + Teachers + Admin + Technician; gender from 'Student Gender EN' (co-ed keeps the workbook's mapping);
# rural from 'School Location Type En'; GPS from Latitude/Longitude.
import openpyxl
ws = openpyxl.load_workbook(os.path.join(ROOT, 'All Schools - Al Manhal.xlsx'), read_only=True, data_only=True).worksheets[0]
rows = list(ws.iter_rows(values_only=True)); H = rows[0]
MAN = {str(r[H.index('School_ID')]): dict(zip(H, r)) for r in rows[1:] if r[H.index('School_ID')]}
num = lambda v: float(v) if v not in (None, '') else 0
for s in net['sites']:
    m = MAN.get(s.get('no')) if s['type'] == 'school' else None
    if not m: continue
    s['students'] = int(num(m['Total Students'])); s['staff'] = int(num(m['Teachers']) + num(m['Admin']) + num(m['Technician']))
    s['users'] = s['students'] + s['staff']
    reg = m['Student Gender EN']
    s['gender'] = 'B' if reg == 'Boys' else 'G' if reg == 'Girls' else s['gender']
    s['register'] = reg; s['rural'] = m['School Location Type En'] == 'Rural'
    s['name'] = m['SchoolName_En'] or s['name']; s['tl'] = m['Team Lead'] or ''; s['amCluster'] = m['Cluster']
    s['emirate'] = m['Emirate En']
sites = {s['id']: s for s in net['sites']}
schools = sorted([s for s in net['sites'] if s['type'] == 'school'], key=lambda s: -s['users'])
nonschool = [s for s in net['sites'] if s['type'] != 'school']
ISLAND = {'S511', 'S520'}  # Dalma School, Al Hosn Scientific School: inside the Dalma island polygon of the basemap

# ---- tiers by the deck's counts (rank by supported users) ----
tier = {}
for i, s in enumerate(schools):
    tier[s['id']] = 'XL' if i < 14 else 'L' if i < 58 else 'MT' if i < 188 else None
rest = [s for s in schools if tier[s['id']] is None and s['id'] not in ISLAND]
for s in ISLAND: tier[s] = 'IS'
for i, s in enumerate(rest):
    tier[s['id']] = 'MO' if i < 71 else 'S' if i < 232 else 'XS'

clusters = []
def add(kind, members, base, note=''):
    b = sites[base]
    legs = []
    for m in members:
        if m == base: continue
        t, km = travel(b, sites[m]); to, _ = travel(b, sites[m], False)
        legs.append({'to': m, 'peak': t, 'off': to, 'km': km})
    gender = next((sites[m]['gender'] for m in members if sites[m]['gender']), None)
    c = {'id': None, 'kind': kind, 'members': members, 'base': base, 'zone': b['zone'], 'gender': gender, 'legs': legs,
         'maxPeak': max([l['peak'] for l in legs], default=0), 'users': sum(sites[m]['users'] for m in members),
         'rural': any(sites[m].get('rural') for m in members), 'note': note}
    clusters.append(c); return c

# 1) dedicated
for s in schools:
    if tier[s['id']] in ('XL', 'L', 'MT', 'IS'):
        add('dedicated', [s['id']], s['id'], 'Island school: no road link, needs its own engineer' if s['id'] in ISLAND else '')

# 2) shared pairs: min-travel perfect matching per gender, edges only where peak travel <= SLA
def pair_up(pool):
    G = nx.Graph(); G.add_nodes_from(x['id'] for x in pool)
    for a, b in itertools.combinations(pool, 2):
        t, _ = travel(a, b)
        if t <= SLA: G.add_edge(a['id'], b['id'], weight=1000 - t)
    return nx.max_weight_matching(G, maxcardinality=True)
shared = [s for s in schools if tier[s['id']] in ('MO', 'S')]
left = []
for g in ('B', 'G'):
    pool = [s for s in shared if s['gender'] == g]
    M = pair_up(pool); used = set()
    for a, b in M:
        base = a if sites[a]['users'] >= sites[b]['users'] else b  # engineer is based at the larger school
        add('pair', [base, b if base == a else a], base); used |= {a, b}
    left += [s for s in pool if s['id'] not in used]

# 3) leftovers (shared schools with no partner + X-Small) first try to join a nearby same-gender pair as a 3rd/4th site.
#    A rotating shared engineer can be at any of its sites, so the check is the cluster DIAMETER (every pair of sites <= SLA).
def diam_ok(members, s):
    return all(travel(sites[m], s)[0] <= SLA for m in members)
def try_join(s, kinds, cap_users, cap_sites, diameter=True):
    best = None
    for c in clusters:
        if c['kind'] not in kinds or (c['gender'] and s['gender'] and c['gender'] != s['gender']): continue
        if c['users'] + s['users'] > cap_users or len(c['members']) >= cap_sites: continue
        if diameter and not diam_ok(c['members'], s): continue
        t, _ = travel(sites[c['base']], s)
        if t <= SLA and (not best or t < best[0]): best = (t, c)
    return best
xs = [s for s in schools if tier[s['id']] == 'XS']
cand = left + xs
def options(s):
    return sum(1 for o in cand if o is not s and o['gender'] == s['gender'] and travel(s, o)[0] <= SLA)
pool_left = []
for s in sorted(cand, key=options):          # hardest to place first
    j = try_join(s, ('pair', 'triad'), TRIAD_USERS, 4)
    if j:
        c = j[1]; clusters.remove(c)
        add('triad', c['members'] + [s['id']], c['base'], 'Shared engineer covers a 3rd/4th nearby site')
    else: pool_left.append(s)

# 4) the rest -> pool clusters: greedy, seeded from the most isolated school, per gender, within SLA of the base
def pool_build(pool, g):
    out, todo = [], {s['id'] for s in pool}
    while todo:
        reach = {i: [j for j in todo if j != i and travel(sites[i], sites[j])[0] <= SLA] for i in todo}
        seed = min(todo, key=lambda i: (len(reach[i]), -sites[i]['users']))
        cand = [seed] + reach[seed]
        base = max(cand, key=lambda i: (sum(1 for j in cand if travel(sites[i], sites[j])[0] <= SLA), sites[i]['users']))
        mem, users = [base], sites[base]['users']
        for j in sorted((j for j in todo if j != base and travel(sites[base], sites[j])[0] <= SLA), key=lambda j: (j != seed, travel(sites[base], sites[j])[0])):
            if len(mem) >= POOL_SITES or users + sites[j]['users'] > POOL_USERS: continue
            mem.append(j); users += sites[j]['users']
        if seed not in mem: base, mem = seed, [seed]
        todo -= set(mem); out.append((base, mem))
    return out
for g in ('B', 'G'):
    for base, mem in pool_build([s for s in pool_left if s['gender'] == g], g):
        add('pool', mem, base)

# 5) a pool of one: fold into a nearby same-gender cluster with spare capacity (base within SLA); otherwise it is a
#    genuinely isolated school (no same-gender school within 30 min) and keeps its own engineer: 'remote'
for c in [c for c in clusters if c['kind'] == 'pool' and len(c['members']) == 1]:
    s = sites[c['members'][0]]
    j = try_join(s, ('pair', 'triad', 'pool'), POOL_USERS, POOL_SITES, diameter=False)
    if j and j[1] is not c:
        t = j[1]; clusters.remove(c); clusters.remove(t)
        add('triad' if t['kind'] in ('pair', 'triad') else 'pool', t['members'] + [s['id']], t['base'],
            'Shared engineer covers a 3rd/4th nearby site' if t['kind'] != 'pool' else '')
    else:
        c['kind'] = 'remote'; c['note'] = 'Isolated: no same-gender school within 30 min at peak, so it cannot share without breaching the SLA'

# 6) non-school sites (any engineer, treated as Small sites): join the nearest cluster with spare capacity whose base is
#    within SLA (remote engineers have the most spare capacity); otherwise a zone non-school pool.
#    NOTE: non-school coordinates in the register are placeholders until MOE confirms the 48-site list.
for s in sorted(nonschool, key=lambda x: -x['users']):
    best = None
    for c in clusters:
        if c['kind'] not in ('pair', 'triad', 'pool', 'remote') or c['users'] + s['users'] > POOL_USERS or len(c['members']) >= POOL_SITES: continue
        t, _ = travel(sites[c['base']], s)
        if t <= SLA and (not best or (t, c['users']) < (best[0], best[1]['users'])): best = (t, c)
    if best:
        c = best[1]; clusters.remove(c); add(c['kind'], c['members'] + [s['id']], c['base'], c['note'])
    else:
        ex = [c for c in clusters if c['kind'] == 'nspool' and c['zone'] == s['zone'] and len(c['members']) < POOL_SITES and diam_ok(c['members'], s)]
        if ex: c = ex[0]; clusters.remove(c); add('nspool', c['members'] + [s['id']], c['base'], c['note'])
        else: add('nspool', [s['id']], s['id'], 'Non-school pool: any engineer; site locations are placeholders to confirm')

# 7) lever, not applied: an isolated school whose nearest same-gender school is a DEDICATED Medium-top school within SLA
#    could be a satellite of that engineer (saves one engineer, but dilutes the dedicated commitment)
for c in clusters:
    if c['kind'] != 'remote': continue
    s = sites[c['base']]; best = None
    for d in clusters:
        if d['kind'] != 'dedicated' or d['gender'] != s['gender'] or tier[d['base']] != 'MT': continue
        t, _ = travel(sites[d['base']], s)
        if t <= SLA and (not best or t < best[0]): best = (t, d['base'])
    c['satellite'] = {'host': best[1], 'peak': best[0]} if best else None
    near = min(((travel(s, o)[0], o['id']) for o in schools if o['gender'] == s['gender'] and o['id'] != s['id']), default=None)
    c['nearest'] = {'id': near[1], 'peak': near[0]} if near else None

# ---- ids, engineers, nationality ----
order = {'dedicated': 0, 'pair': 1, 'triad': 2, 'pool': 3, 'remote': 4, 'nspool': 5}
clusters.sort(key=lambda c: (order[c['kind']], c['zone'], c['gender'] or 'Z', -c['users']))
cnt = {}
for c in clusters:
    k = {'dedicated': 'D', 'pair': 'P', 'triad': 'T', 'pool': 'C', 'remote': 'R', 'nspool': 'N'}[c['kind']]
    cnt[(c['zone'], k)] = cnt.get((c['zone'], k), 0) + 1
    c['id'] = f"{c['zone']}-{k}{cnt[(c['zone'], k)]:02d}"
    c['sla'] = c['maxPeak'] <= SLA
    c['engineer'] = {'sex': 'Male' if c['gender'] == 'B' else 'Female' if c['gender'] == 'G' else 'Any'}
    if c['kind'] == 'dedicated':
        c['engineer']['nat'] = 'Emirati national'
    else:
        c['engineer']['nat'] = 'Emirati preferred (rural)' if c['rural'] else 'Non-national'
# national onboarding waves: rural dedicated first, then by size
ded = [c for c in clusters if c['kind'] == 'dedicated']
ded.sort(key=lambda c: (c['members'][0] not in ISLAND, not c['rural'], -c['users']))
for i, c in enumerate(ded): c['wave'] = 1 if (c['rural'] or c['members'][0] in ISLAND) else 2; c['rank'] = i + 1

out_sites = []
for s in net['sites']:
    t = tier.get(s['id'], 'NS')
    cid = next(c['id'] for c in clusters if s['id'] in c['members'])
    out_sites.append({'id': s['id'], 'name': s['name'], 'zone': s['zone'], 'g': s['gender'], 'reg': s.get('register', ''), 'u': s['users'],
                      'lat': s['lat'], 'lng': s['lng'], 'rural': s.get('rural', False), 'tier': t, 'c': cid, 'approx': s.get('approx', False),
                      'island': s['id'] in ISLAND, 'cycle': s.get('cycle', ''), 'st': s.get('students', 0), 'sf': s.get('staff', 0), 'em': s.get('emirate', '')})
plan = {'generated': 'tools/build_coverage_plan.py', 'sla': SLA, 'poolUsers': POOL_USERS, 'poolSites': POOL_SITES,
        'zones': net['zones'], 'sites': out_sites, 'clusters': clusters}
json.dump(plan, open(os.path.join(ROOT, 'public/data/coverage-plan.json'), 'w'), separators=(',', ':'))

# ---- report ----
from collections import Counter
k = Counter(c['kind'] for c in clusters)
print('clusters', dict(k), 'engineers', len(clusters))
for kind in order:
    cs = [c for c in clusters if c['kind'] == kind]
    print(f"{kind:9s} eng={len(cs):3d} sites={sum(len(c['members']) for c in cs):3d} M={sum(c['gender']=='B' for c in cs)} F={sum(c['gender']=='G' for c in cs)} "
          f"rural={sum(c['rural'] for c in cs)} slaBreach={sum(not c['sla'] for c in cs)} maxPeak={max([c['maxPeak'] for c in cs], default=0)}")
print('tiers', Counter(tier.values()))
print('breaches', [(c['id'], c['maxPeak'], c['members']) for c in clusters if not c['sla']])
print('pool sizes', Counter(len(c['members']) for c in clusters if c['kind'] == 'pool'))
print('satellite lever', sum(1 for c in clusters if c.get('satellite')))
print('mixed gender check', [c['id'] for c in clusters if len({sites[m]['gender'] for m in c['members'] if sites[m]['gender']}) > 1])
