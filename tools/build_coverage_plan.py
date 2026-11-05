"""Coverage plan v3: 323 school field engineers, built on the MOE school mapping in the Al Manhal register.

Direction (project lead, 2026-11-03):
  - 333 engineers in total; 10 are HQ dedicated (3 HQ sites) and are left out of this plan.
  - The balance, 323, covers the 522 schools + 48 non-school sites.
  - Follow the schools mapping in the Al Manhal sheet: column 'Cluster' (Team-Lead cluster 1-9, with its Team Lead),
    and within it the MOE sub-cluster ('Cluster English Name', e.g. DNE.5.1). Column 'FE' is filled by this plan.
  - Option 1 of "MOE_EUC_Resource_Deployment_Plan_Management_Schools mapping.pptx":
      X-Large 14 + Large 44 + Medium top 130 + Dalma/Al Hosn 2 -> 190 dedicated Emirati nationals
      Medium others 71 + Small 161 -> 1 non-national per 2 schools (deck: 36 + 80 = 116)
      X-Small 100 + non-school 48 -> zone pool, ticket-driven (deck: 17)

Rules
  - Hard: total = 323; gender (boys' schools male engineer, girls' female; co-ed keeps the workbook mapping);
    a shared or pool engineer never crosses a Team-Lead cluster.
  - Soft: pairs stay inside one MOE sub-cluster unless crossing saves >= CROSS min; legs over the 30-min P1 target are
    penalised; pool engineers go where they cut the most out-of-reach travel.
  - Travel is reported against the 30-min P1 target, not used as a hard cap (a hard cap needs ~359 engineers: v1).

  python3 tools/build_coverage_plan.py                 -> plan with the chosen options (CHOSEN) + outputs
  python3 tools/build_coverage_plan.py --scenarios F   -> run every scenario in SCENARIOS, write the comparison to F
Outputs: public/data/coverage-plan.json, dist/MOE-FE-Mapping-Option1-323.xlsx
"""
import json, math, os, sys, itertools, statistics
from collections import Counter, defaultdict
import networkx as nx
import openpyxl
from openpyxl.styles import Font, PatternFill

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTER = os.path.join(ROOT, 'All Schools - Al Manhal.xlsx')
net = json.load(open(os.path.join(ROOT, 'public/data/network.json')))
TOTAL, HQ = 333, 10
FIELD = TOTAL - HQ                       # 323
DECK = {'dedicated': 190, 'shared': 116, 'pool': 17}
SLA = 30                                 # P1 response target, minutes (reported)
JOIN_USERS, JOIN_SITES, JOIN_MAX = 2200, 4, 120   # a 3rd/4th school joining a shared engineer

# ---- road model (port of public/js/travel.js + model.js) ----
ZREG = {'Z01': 'heavy', 'Z02': 'heavy', 'Z03': 'heavy', 'Z07a': 'mid', 'Z07b': 'mid', 'Z06a': 'mid', 'Z06b': 'mid', 'Z04': 'light', 'Z05': 'light', 'Z08': 'light'}
PEAKM = {'heavy': 1.45, 'mid': 1.25, 'light': 1.1}
def hav(a, b):
    R, r = 6371, math.pi / 180
    dl, dg = (b['lat'] - a['lat']) * r, (b['lng'] - a['lng']) * r
    x = math.sin(dl / 2) ** 2 + math.cos(a['lat'] * r) * math.cos(b['lat'] * r) * math.sin(dg / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))
_tc = {}
def travel(a, b, peak=True):
    k = (a['id'], b['id'], peak)
    if k in _tc: return _tc[k]
    if a['id'] in BOAT or b['id'] in BOAT:          # no road: modelled as 0 here, reported separately as a boat visit
        _tc[k] = (0, 0.0); return _tc[k]
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
        rg = [ZREG[za], ZREG[zb]]; mult = PEAKM['heavy' if 'heavy' in rg else 'mid' if 'mid' in rg else 'light']
    hwy = mins - city
    drive = (city * mult + hwy * (1 + (mult - 1) * 0.3)) * (1.1 if (a.get('rural') or b.get('rural')) else 1)
    _tc[k] = (round(max(10, drive + 8)), round(km, 1)); return _tc[k]
T = lambda a, b: travel(sites[a], sites[b])[0]

# ---- register: figures and the MOE mapping ----
ws = openpyxl.load_workbook(REGISTER, read_only=True, data_only=True).worksheets[0]
rows = list(ws.iter_rows(values_only=True)); H = rows[0]
MAN = {str(r[H.index('School_ID')]): dict(zip(H, r)) for r in rows[1:] if r[H.index('School_ID')]}
num = lambda v: float(v) if v not in (None, '') else 0
REGION_NAME = {1: 'Sharjah, Ajman & UAQ', 2: 'Ras Al Khaimah', 3: 'Dubai', 4: 'Fujairah', 5: 'Sharjah East Coast', 7: 'Al Dhafra', 8: 'Al Ain', 9: 'Abu Dhabi'}
TL = {}
for m in MAN.values():
    if m['Team Lead']: TL[m['Cluster']] = m['Team Lead']
# 9 schools have no Latitude/Longitude in the register; the old data build put them on a zone hub (5 stacked in Sharjah city)
LOCATION_FIX = {
    '4042':   (25.095485, 55.197420, False, 'Register address field carries the Google location (Al Barsha 1)'),
    '5075':   (25.128500, 55.879000, True, 'Estimated: Mleiha town (no GPS in register)'),
    '5009':   (25.873000, 55.033000, True, 'Estimated: Abu Musa island, boat access only (no GPS in register)'),
    '5100':   (25.245000, 55.545000, True, 'Estimated: Al Suyoh, Sharjah (no GPS in register)'),
    '590':    (25.205000, 55.745000, True, 'Estimated: Al Batayih / Qitah, Sharjah (no GPS in register)'),
    '5113':   (25.010000, 55.875000, True, 'Estimated: centre of MOE sub-cluster DNE.5.4 (no GPS in register)'),
    '6046':   (25.403000, 55.509000, True, 'Estimated: centre of MOE sub-cluster DNE.6.1, Ajman (no GPS in register)'),
    '2105AD': (24.390000, 54.710000, True, 'Estimated: Al Shamkha (no GPS in register)'),
    '2090AD': (24.393000, 54.623000, True, 'Estimated: Zayed City, next to Zayed City School (no GPS in register)'),
}
for s in net['sites']:
    if s['type'] != 'school': continue
    m = MAN[s['no']]
    s['students'] = int(num(m['Total Students'])); s['staff'] = int(num(m['Teachers']) + num(m['Admin']) + num(m['Technician']))
    s['users'] = s['students'] + s['staff']
    reg = m['Student Gender EN']
    s['gender'] = 'B' if reg == 'Boys' else 'G' if reg == 'Girls' else s['gender']
    s['register'] = reg; s['rural'] = m['School Location Type En'] == 'Rural'
    s['name'] = m['SchoolName_En'] or s['name']; s['emirate'] = m['Emirate En']
    s['region'] = int(m['Cluster']); s['moe'] = m['Cluster English Name']
    if m['Latitude'] and m['Longitude']:
        s['lat'], s['lng'], s['approx'] = round(float(m['Latitude']), 6), round(float(m['Longitude']), 6), False
    elif s['no'] in LOCATION_FIX:
        s['lat'], s['lng'], s['approx'], s['locNote'] = LOCATION_FIX[s['no']]
sites = {s['id']: s for s in net['sites']}
schools = sorted([s for s in net['sites'] if s['type'] == 'school'], key=lambda s: -s['users'])
nonschool = [s for s in net['sites'] if s['type'] != 'school']
NS_USERS_DECK = 3907   # deck total for the 48 non-school sites; the placeholder register has 120 each
_ns = sum(s['users'] for s in nonschool)
for s in nonschool: s['users'] = round(s['users'] * NS_USERS_DECK / _ns)
for s in nonschool:   # placeholder locations: take the Team-Lead cluster / MOE sub-cluster of the nearest school
    n = min(schools, key=lambda o: hav(s, o)); s['region'], s['moe'] = n['region'], n['moe']
ISLAND = {'S511', 'S520'}  # Dalma School, Al Hosn Scientific School (Dalma Island, no road link): dedicated
BOAT = {s['id'] for s in schools if s['no'] == '5009'}   # Abu Moosa School, Abu Musa island: X-Small, boat visits
# Hatta (Dubai), Masfout (Ajman) and Al Muniai (RAK) exclaves sit within ~15 km of each other but in 3 Team-Lead clusters
POCKET = {s['id'] for s in schools if 24.7 < s['lat'] < 25.0 and 56.0 < s['lng'] < 56.2}

# ---- Option 1 tiers (rank by supported users) ----
tier = {}
for i, s in enumerate(schools):
    tier[s['id']] = 'XL' if i < 14 else 'L' if i < 58 else 'MT' if i < 188 else None
rest = [s for s in schools if tier[s['id']] is None and s['id'] not in ISLAND]
for s in ISLAND: tier[s] = 'IS'
for i, s in enumerate(rest):
    tier[s['id']] = 'MO' if i < 71 else 'S' if i < 232 else 'XS'
for s in nonschool: tier[s['id']] = 'NS'

BASE_OPTS = dict(cross=30, sla_pen=0, pool_alloc='workload', pool_base='medoid', pool_cap=1.3, pool_load=1.5, pool_min=3, xs_join=0, scope='tl', coed='workbook')

def build(o):
    """Builds the 323 clusters for options o; returns the cluster list (ids not yet assigned)."""
    o = {**BASE_OPTS, **o}
    CROSS, PEN = o['cross'], o['sla_pen']
    grp = lambda s: ('P' if (o['scope'] == 'pocket' and s['id'] in POCKET) else 0 if o['scope'] == 'any' else s['region'])
    gset = lambda s: {'B', 'G'} if (o['coed'] == 'flex' and s.get('register') == 'Co Edu') else {s['gender']}
    clusters = []
    def add(kind, members, base, note=''):
        b = sites[base]; legs = []
        for m in members:
            if m == base: continue
            t, km = travel(b, sites[m]); to, _ = travel(b, sites[m], False)
            legs.append({'to': m, 'peak': t, 'off': to, 'km': km, **({'boat': True} if m in BOAT else {})})
        gs = set.intersection(*[gset(sites[m]) for m in members if sites[m]['type'] == 'school']) if any(sites[m]['type'] == 'school' for m in members) else {'B'}
        gender = next(iter(gs)) if len(gs) == 1 else next((sites[m]['gender'] for m in members if sites[m]['gender'] and len(gset(sites[m])) == 1), 'B')
        moes = sorted({sites[m]['moe'] for m in members if sites[m]['type'] == 'school'})
        c = {'id': None, 'kind': kind, 'members': members, 'base': base, 'zone': b['zone'], 'region': b['region'], 'moe': moes,
             'gender': gender, 'legs': legs, 'maxPeak': max([l['peak'] for l in legs], default=0),
             'users': sum(sites[m]['users'] for m in members), 'rural': any(sites[m].get('rural') for m in members), 'note': note}
        clusters.append(c); return c
    def rebuild(c, members, kind=None, note=None):
        clusters.remove(c); return add(kind or c['kind'], members, c['base'], c['note'] if note is None else note)
    pen = lambda t: t + (PEN if t > SLA else 0)

    # 1) dedicated: 190 Emirati nationals
    for s in schools:
        if tier[s['id']] in ('XL', 'L', 'MT', 'IS'):
            add('dedicated', [s['id']], s['id'], 'Island school: no road link, needs its own engineer' if s['id'] in ISLAND else '')

    # 2) shared pairs: min-cost perfect matching per Team-Lead cluster (x gender); leaving the MOE sub-cluster costs CROSS,
    #    a leg over the P1 target costs PEN. In an odd group the school left over is the one that joins a pair most cheaply.
    def pc(a, b):
        if not (gset(sites[a]) & gset(sites[b])): return None
        return pen(T(a, b)) + (CROSS if sites[a]['moe'] != sites[b]['moe'] else 0)
    def match(ids):
        G = nx.Graph(); G.add_nodes_from(ids)
        for a, b in itertools.combinations(ids, 2):
            c = pc(a, b)
            if c is not None: G.add_edge(a, b, weight=100000 - c)
        M = nx.max_weight_matching(G, maxcardinality=True)
        return [tuple(e) for e in M], sum(pc(*e) for e in M)
    def join_cost(v, members):
        if not set.intersection(gset(sites[v]), *[gset(sites[m]) for m in members]): return None, None
        far = max(T(m, v) for m in members)
        return pen(far) + (0 if sites[v]['moe'] in {sites[m]['moe'] for m in members} else CROSS), far
    left = []
    shared = [s for s in schools if tier[s['id']] in ('MO', 'S')]
    gkey = (lambda s: (grp(s),)) if o['coed'] == 'flex' else (lambda s: (grp(s), s['gender']))
    for key in sorted({gkey(s) for s in shared}, key=str):
        ids = [s['id'] for s in shared if gkey(s) == key]
        M, _ = match(ids)
        unmatched = [i for i in ids if not any(i in e for e in M)]
        if len(unmatched) == 1 and len(ids) > 2:
            best = None
            for v in ids:
                Mv, cost = match([i for i in ids if i != v])
                if len(Mv) * 2 != len(ids) - 1: continue
                jc = [join_cost(v, e)[0] for e in Mv]; jc = [x for x in jc if x is not None]
                if jc and (not best or cost + min(jc) < best[0]): best = (cost + min(jc), Mv, v)
            if best: M, unmatched = best[1], [best[2]]
        for a, b in M:
            base = a if sites[a]['users'] >= sites[b]['users'] else b      # engineer based at the larger school
            add('pair', [base, b if base == a else a], base)
        left += [sites[i] for i in unmatched]

    # 3) the odd ones out, the girls' X-Small schools (and, if xs_join, boys' X-Small within xs_join min) join the
    #    cheapest shared engineer of a compatible gender in the same group as a 3rd/4th school (judged on the farthest member)
    def best_join(s, kinds=('pair', 'triad', 'remote'), cap=JOIN_MAX):
        best = None
        for c in clusters:
            if c['kind'] not in kinds or grp(sites[c['base']]) != grp(s): continue
            if c['users'] + s['users'] > JOIN_USERS or len(c['members']) >= JOIN_SITES: continue
            cost, far = join_cost(s['id'], c['members'])
            if cost is not None and far <= cap and (not best or cost < best[0]): best = (cost, c)
        return best
    def join(s, j):
        if j[1]['kind'] == 'remote': rebuild(j[1], j[1]['members'] + [s['id']], 'pair', 'Pairs a school that has no shared partner with a nearby X-Small school')
        else: rebuild(j[1], j[1]['members'] + [s['id']], 'triad', 'Shared engineer covers a 3rd/4th school in the same Team-Lead cluster')
    xs = [s for s in schools if tier[s['id']] == 'XS' and s['id'] not in BOAT]
    pool_left = []
    for s in left + [s for s in xs if s['gender'] == 'G']:
        j = best_join(s)
        if j: join(s, j)
        elif tier[s['id']] == 'XS': pool_left.append(s)
        else: add('remote', [s['id']], s['id'], f'No same-gender shared school within {JOIN_MAX} min inside its Team-Lead cluster: own engineer')
    for s in sorted([s for s in xs if s['gender'] != 'G'], key=lambda s: -s['users']):
        j = best_join(s, ('pair', 'triad'), o['xs_join']) if o['xs_join'] else None
        if j: join(s, j)
        else: pool_left.append(s)

    # 3b) option sat: an isolated X-Small school (no other pool school within 45 min) that is within `sat` min of a
    #     same-gender dedicated engineer becomes that engineer's satellite (dilutes the dedicated commitment: a decision)
    if o.get('sat'):
        for s in list(pool_left):
            if min([T(s['id'], x['id']) for x in pool_left if x is not s] or [999]) <= 45: continue
            d = min(((T(c['base'], s['id']), c) for c in clusters if c['kind'] == 'dedicated' and c['gender'] == s['gender'] and grp(sites[c['base']]) == grp(s)
                     and c['base'] not in ISLAND), key=lambda x: x[0], default=None)
            if d and d[0] <= o['sat']:
                rebuild(d[1], d[1]['members'] + [s['id']], 'dedicated', 'Dedicated national with an isolated X-Small satellite school'); pool_left.remove(s)

    # 4) pool: whatever is left of the 323 covers the remaining X-Small schools and the 48 non-school sites, per group x gender
    #    (non-school sites take any engineer and ride with the male pool). At least one engineer per group; the rest go by
    #    workload (half users, half sites) or, with pool_alloc='travel', to wherever the next engineer cuts the most
    #    minutes beyond the P1 target.
    FIELD_N = o.get('field', FIELD)
    POOL_ENG = FIELD_N - len(clusters)
    groups = defaultdict(list)
    for s in pool_left: groups[(grp(s), s['gender'])].append(s['id'])
    for s in nonschool: groups[(grp(s), 'B')].append(s['id'])
    U, N = sum(sites[i]['users'] for v in groups.values() for i in v), sum(len(v) for v in groups.values())
    keys = sorted(groups, key=str); alloc = {k: 1 for k in keys}
    if POOL_ENG < len(keys): raise ValueError(f'pool engineers {POOL_ENG} < groups {len(keys)}')
    def medoid(p): return min(p, key=lambda c: (sum(T(c, i) for i in p), -sites[c]['users']))
    def minimax(p): return min(p, key=lambda c: (max([T(c, i) for i in p if i != c], default=0), sum(T(c, i) for i in p)))
    center = minimax if o['pool_base'] == 'minimax' else medoid
    _pc = {}
    def partition(key, k):
        if (key, k) in _pc: return _pc[(key, k)]
        ids = groups[key]; k = min(k, len(ids))
        if k == 1: _pc[(key, k)] = [ids]; return [ids]
        w = {i: 0.5 * sites[i]['users'] / U + 0.5 / N for i in ids}; cap = sum(w.values()) / k * o['pool_cap']
        med = [center(ids)]
        while len(med) < k: med.append(max((i for i in ids if i not in med), key=lambda i: min(T(i, m) for m in med)))
        for _ in range(25):
            part, load = {m: [] for m in med}, {m: 0 for m in med}
            regret = lambda i: (lambda d: d[1] - d[0] if len(d) > 1 else 0)(sorted(T(m, i) for m in med))
            for i in sorted(ids, key=regret, reverse=True):
                for m in sorted(med, key=lambda m: T(m, i)):
                    if load[m] + w[i] <= cap or m == min(med, key=lambda m: load[m]):
                        part[m].append(i); load[m] += w[i]; break
            new = [center(p) for p in part.values() if p]
            if sorted(new) == sorted(med): break
            med = new
        _pc[(key, k)] = [p for p in part.values() if p]; return _pc[(key, k)]
    def excess(key, k):   # minutes beyond the P1 target, summed over sites, measured from each pool's base
        tot = 0
        for p in partition(key, k):
            sch = [i for i in p if sites[i]['type'] == 'school'] or p; b = center(sch)
            tot += sum(max(0, T(b, i) - SLA) for i in p)
        return tot
    if o['pool_alloc'] == 'travel':
        # workload ceiling first: no pool engineer above pool_load x the average load (half users, half sites)
        lw = {k: 0.5 * sum(sites[i]['users'] for i in groups[k]) / U + 0.5 * len(groups[k]) / N for k in keys}
        for k in keys: alloc[k] = max(1, min(len(groups[k]), math.ceil(lw[k] * POOL_ENG / o['pool_load'] - 1e-9)))
        if sum(alloc.values()) > POOL_ENG: raise ValueError('pool workload ceiling needs more engineers than available')
        while sum(alloc.values()) < POOL_ENG:
            cand = [k for k in keys if alloc[k] < len(groups[k]) and min(len(p) for p in partition(k, alloc[k] + 1)) >= o['pool_min']]
            if not cand: cand = [k for k in keys if alloc[k] < len(groups[k])]
            k = max(cand, key=lambda k: (excess(k, alloc[k]) - excess(k, alloc[k] + 1), len(groups[k]) / alloc[k]))
            alloc[k] += 1
    else:
        share = {k: (0.5 * sum(sites[i]['users'] for i in groups[k]) / U + 0.5 * len(groups[k]) / N) * POOL_ENG for k in keys}
        while sum(alloc.values()) < POOL_ENG:
            k = max(keys, key=lambda k: (share[k] - alloc[k], share[k])); alloc[k] += 1
    for k in keys:
        for mem in partition(k, alloc[k]):
            sch = [i for i in mem if sites[i]['type'] == 'school'] or mem
            base = center(sch); mem = [base] + [i for i in mem if i != base]
            add('pool', mem, base, 'Ticket-driven pool engineer: X-Small schools' + (' (girls)' if k[1] == 'G' else ' and non-school sites'))
    for i in BOAT:   # boat visits from the pool based nearest Sharjah port
        port = {'id': '_port', 'lat': 25.36, 'lng': 55.38, 'zone': 'Z02'}
        c = min((c for c in clusters if c['kind'] == 'pool' and c['region'] == sites[i]['region']), key=lambda c: hav(sites[c['base']], port))
        rebuild(c, c['members'] + [i])
    assert len(clusters) == FIELD_N, len(clusters)
    for c in clusters: c['_alloc'] = {f'{k[0]}{k[1]}': v for k, v in alloc.items()}
    return clusters

def reach(c, m):
    """P1 reach for school m: on site for dedicated; for a rotating shared engineer the farthest other member (the engineer
    can be at any of them); for a pool, travel from the pool base."""
    if len(c['members']) == 1 or m in BOAT or m == c['base'] and c['kind'] in ('dedicated', 'pool'): return 0
    if c['kind'] == 'dedicated': return T(c['base'], m)   # satellite of a dedicated engineer
    if c['kind'] == 'pool': return T(c['base'], m)
    return max(T(o, m) for o in c['members'] if o != m)

def metrics(clusters):
    of = {m: c for c in clusters for m in c['members']}
    sch = [s for s in schools if s['id'] not in BOAT]
    nd = [s for s in sch if of[s['id']]['kind'] != 'dedicated']
    r = {s['id']: reach(of[s['id']], s['id']) for s in sch}
    rn = sorted(r[s['id']] for s in nd)
    mv = [c for c in clusters if len(c['members']) > 1]
    k = Counter(c['kind'] for c in clusters)
    return {
        'engineers': len(clusters), 'dedicated': k['dedicated'], 'shared': k['pair'] + k['triad'] + k['remote'], 'pool': k['pool'],
        'pairs': k['pair'], 'triads': k['triad'], 'own': k['remote'],
        'schools_in30': sum(r[s['id']] <= SLA for s in sch), 'schools': len(sch),
        'shared_pool_schools_in30': sum(r[s['id']] <= SLA for s in nd), 'shared_pool_schools': len(nd),
        'users_in30_pct': round(100 * sum(s['users'] for s in sch if r[s['id']] <= SLA) / sum(s['users'] for s in sch), 1),
        'rural_out30': sum(1 for s in nd if s['rural'] and r[s['id']] > SLA),
        'over60': sum(x > 60 for x in rn), 'median_reach': statistics.median(rn), 'p90_reach': rn[int(len(rn) * .9)], 'max_reach': rn[-1],
        'excess_min': sum(max(0, x - SLA) for x in rn),
        'eng_all_in30': sum(1 for c in mv if all(reach(c, m) <= SLA for m in c['members'] if sites[m]['type'] == 'school') and c['maxPeak'] <= SLA), 'eng_moving': len(mv),
        'cross_moe': sum(1 for c in clusters if len({sites[m]['moe'] for m in c['members'] if sites[m]['type'] == 'school'}) > 1),
        'cross_tl': sum(1 for c in clusters if len({sites[m]['region'] for m in c['members']}) > 1),
        'gender_mixed': sum(1 for c in clusters if len({sites[m]['gender'] for m in c['members'] if sites[m]['gender']}) > 1),
        'max_pool_sites': max(len(c['members']) for c in clusters if c['kind'] == 'pool'),
        'pool_alloc': clusters[0]['_alloc'],
    }

# scenarios: A-C stay inside every rule (C is the plan); D-F each relax one rule and are decisions, not applied.
# V1 (the earlier 359 plan, scored on the same yardstick) is added by tools/score_v1.py
CHOSEN = dict(sla_pen=60, xs_join=30, pool_alloc='travel', pool_load=1.5, pool_base='medoid', pool_cap=1.8, cross=30)
SCENARIOS = [
    ('A', 'v2 as first delivered: pairs by lowest total travel, pools by workload', dict()),
    ('B', 'A + pairing that avoids legs over the 30-min P1 target', dict(sla_pen=60)),
    ('C', 'B + X-Small next to a pair (all within 30 min) joins it, pool engineers placed where travel is worst', CHOSEN),
    ('D', 'C + Hatta, Masfout and Al Muniai exclaves share engineers across Team-Lead clusters', {**CHOSEN, 'scope': 'pocket'}),
    ('E', 'C + co-ed schools may take a male or a female engineer', {**CHOSEN, 'coed': 'flex'}),
    ('F', 'C + no Team-Lead cluster boundaries (national pairing)', {**CHOSEN, 'scope': 'any'}),
    ('H', 'C + isolated X-Small schools become satellites of a dedicated engineer within 30 min', {**CHOSEN, 'sat': 30}),
]

if '--scenarios' in sys.argv:
    out = {}
    for sid, label, opts in SCENARIOS:
        m = metrics(build(opts)); out[sid] = {'label': label, 'opts': opts, **m}
        print(sid, label); print('   ', {k: v for k, v in m.items() if k != 'pool_alloc'})
    json.dump(out, open(sys.argv[sys.argv.index('--scenarios') + 1], 'w'), indent=1)
    sys.exit()

clusters = build(CHOSEN)
MET = metrics(clusters)
CROSS = {**BASE_OPTS, **CHOSEN}['cross']

# ---- ids, engineers, nationality ----
order = {'dedicated': 0, 'pair': 1, 'triad': 2, 'remote': 3, 'pool': 4}
clusters.sort(key=lambda c: (c['region'], order[c['kind']], c['moe'][0] if c['moe'] else '', c['gender'] or 'Z', -c['users']))
cnt = Counter()
for c in clusters:
    c.pop('_alloc', None)
    k = {'dedicated': 'D', 'pair': 'P', 'triad': 'T', 'pool': 'X', 'remote': 'R'}[c['kind']]
    cnt[(c['region'], k)] += 1
    c['id'] = f"C{c['region']}-{k}{cnt[(c['region'], k)]:02d}"
    c['reach'] = {m: reach(c, m) for m in c['members'] if sites[m]['type'] == 'school'}
    c['maxReach'] = max(c['reach'].values(), default=0)
    c['sla'] = c['maxPeak'] <= SLA and c['maxReach'] <= SLA
    c['crossMoe'] = len(c['moe']) > 1
    c['engineer'] = {'sex': 'Male' if c['gender'] == 'B' else 'Female' if c['gender'] == 'G' else 'Any'}
    c['engineer']['nat'] = 'Emirati national' if c['kind'] == 'dedicated' else 'Emirati preferred (rural)' if c['rural'] else 'Non-national'
    if any(m in BOAT for m in c['members']): c['note'] += '. Abu Moosa School (Abu Musa island) is served by scheduled boat visits and remote support.'
ded = sorted([c for c in clusters if c['kind'] == 'dedicated'], key=lambda c: (c['members'][0] not in ISLAND, not c['rural'], -c['users']))
for i, c in enumerate(ded): c['wave'] = 1 if (c['rural'] or c['members'][0] in ISLAND) else 2; c['rank'] = i + 1
cl_of = {m: c for c in clusters for m in c['members']}

# regions (Team-Lead clusters) take the place of zones in the map
REG_ID = lambda r: f'C{r}'
regions = []
for r in sorted(REGION_NAME):
    cs = [c for c in clusters if c['region'] == r]
    regions.append({'id': REG_ID(r), 'n': r, 'name': REGION_NAME[r], 'tl': TL.get(r, ''), 'moe': sorted({s['moe'] for s in schools if s['region'] == r}),
                    'eng': len(cs), 'schools': sum(1 for s in schools if s['region'] == r)})
out_sites = []
for s in net['sites']:
    c = cl_of[s['id']]
    out_sites.append({'id': s['id'], 'no': s.get('no', ''), 'name': s['name'], 'zone': REG_ID(s['region']), 'moe': s['moe'], 'g': s['gender'], 'reg': s.get('register', ''),
                      'u': s['users'], 'lat': s['lat'], 'lng': s['lng'], 'rural': s.get('rural', False), 'tier': tier[s['id']], 'c': c['id'],
                      'approx': s.get('approx', False), 'locNote': s.get('locNote', ''), 'island': s['id'] in ISLAND, 'boat': s['id'] in BOAT,
                      'cycle': s.get('cycle', ''), 'st': s.get('students', 0), 'sf': s.get('staff', 0), 'em': s.get('emirate', '')})
for c in clusters: c['zone'] = REG_ID(c['region'])
kinds = Counter(c['kind'] for c in clusters)
SCEN_FILE = os.path.join(ROOT, 'public/data/coverage-scenarios.json')
plan = {'generated': 'tools/build_coverage_plan.py (v3, 323 engineers on the Al Manhal mapping)', 'sla': SLA, 'cross': CROSS, 'metrics': MET,
        'scenarios': json.load(open(SCEN_FILE)) if os.path.exists(SCEN_FILE) else None,
        'budget': {'total': TOTAL, 'hq': HQ, 'field': FIELD, 'deck': DECK,
                   'plan': {'dedicated': kinds['dedicated'], 'shared': kinds['pair'] + kinds['triad'] + kinds['remote'], 'pool': kinds['pool']}},
        'zones': regions, 'sites': out_sites, 'clusters': clusters}
json.dump(plan, open(os.path.join(ROOT, 'public/data/coverage-plan.json'), 'w'), separators=(',', ':'))

# ---- FE mapping workbook: the register with column 'FE' filled, plus an engineer roster and a summary ----
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
XL_OUT = os.path.join(ROOT, 'dist/MOE-FE-Mapping-Option1-323.xlsx')
wb = openpyxl.load_workbook(REGISTER); ws = wb.worksheets[0]
hdr = [c.value for c in ws[1]]; iFE, iID = hdr.index('FE') + 1, hdr.index('School_ID') + 1
extra = ['FE Coverage model', 'FE Option 1 category', 'FE Gender', 'FE Nationality', 'FE Base school', 'FE Sites covered', 'FE P1 reach min (peak)', 'FE Location note']
c0 = ws.max_column + 1
bold, head = Font(bold=True), PatternFill('solid', fgColor='FFF2CC')
for j, t in enumerate(extra): x = ws.cell(1, c0 + j, t); x.font = bold; x.fill = head
ws.cell(1, iFE).fill = head
TIERN = {'XL': 'X-Large (2000+)', 'L': 'Large (1000-1999)', 'MT': 'Medium top list', 'IS': 'Dalma Island', 'MO': 'Medium others', 'S': 'Small', 'XS': 'X-Small', 'NS': 'Non-school'}
KINDN = {'dedicated': 'Dedicated national, on site', 'pair': 'Shared, 2 schools', 'triad': 'Shared, 3-4 schools', 'remote': 'Own engineer (no partner)', 'pool': 'Zone pool, ticket-driven'}
by_no = {s['no']: s for s in schools}
for r in range(2, ws.max_row + 1):
    s = by_no.get(str(ws.cell(r, iID).value))
    if not s: continue
    c = cl_of[s['id']]
    ws.cell(r, iFE, c['id'])
    for j, v in enumerate([KINDN[c['kind']], TIERN[tier[s['id']]], c['engineer']['sex'], c['engineer']['nat'], sites[c['base']]['name'], len(c['members']),
                           'boat' if s['id'] in BOAT else c['reach'][s['id']], s.get('locNote', '')]):
        ws.cell(r, c0 + j, v)
ros = wb.create_sheet('FE Roster', 1)
ros.append(['FE', 'Team-Lead cluster', 'Region', 'Team Lead', 'MOE sub-cluster(s)', 'Coverage model', 'Gender', 'Nationality', 'Base school', 'Base School_ID',
            'Schools', 'Non-school sites', 'Supported users', 'Max peak min from base', 'Worst P1 reach min', 'All within 30 min P1', 'Rural', 'Emirati wave', 'Members (School_ID)'])
for c in clusters:
    b = sites[c['base']]; sc = [m for m in c['members'] if sites[m]['type'] == 'school']
    ros.append([c['id'], c['region'], REGION_NAME[c['region']], TL.get(c['region'], 'To confirm'), ', '.join(c['moe']), KINDN[c['kind']], c['engineer']['sex'],
                c['engineer']['nat'], b['name'], b.get('no', ''), len(sc), len(c['members']) - len(sc), c['users'], c['maxPeak'], c['maxReach'], 'Yes' if c['sla'] else 'No',
                'Yes' if c['rural'] else '', c.get('wave', ''), ', '.join(sites[m].get('no', m) for m in c['members'])])
for x in ros[1]: x.font = bold; x.fill = head
ros.freeze_panes = 'B2'
for col, w in zip('ABCDEFGHIJKLMNOPQRS', [10, 9, 20, 26, 22, 26, 8, 24, 44, 12, 8, 9, 10, 10, 10, 9, 6, 7, 60]): ros.column_dimensions[col].width = w
sm = wb.create_sheet('FE Summary', 1)
sm.append(['Option 1: 333 engineers, 10 HQ dedicated (not mapped here), 323 for schools and non-school sites']); sm['A1'].font = Font(bold=True, size=13)
sm.append([]); sm.append(['Block', 'Deck', 'Plan', 'Difference'])
P = plan['budget']['plan']
for k, lbl in [('dedicated', 'Dedicated nationals (XL 14, L 44, Medium top 130, Dalma 2)'), ('shared', 'Shared non-nationals (Medium others 71, Small 161)'), ('pool', 'Pool (X-Small 100, non-school 48)')]:
    sm.append([lbl, DECK[k], P[k], P[k] - DECK[k]])
sm.append(['Field total', sum(DECK.values()), len(clusters), len(clusters) - sum(DECK.values())])
sm.append(['HQ support (3 sites)', HQ, HQ, 0]); sm.append(['Grand total', TOTAL, len(clusters) + HQ, len(clusters) + HQ - TOTAL])
sm.append([]); sm.append(['Team-Lead cluster', 'Region', 'Team Lead', 'Schools', 'Non-school', 'Dedicated', 'Shared', 'Pool', 'Engineers', 'Male', 'Female', 'Schools within 30 min P1'])
hr = sm.max_row
for r in sorted(REGION_NAME):
    cs = [c for c in clusters if c['region'] == r]
    sm.append([r, REGION_NAME[r], TL.get(r, 'To confirm'), sum(1 for s in schools if s['region'] == r), sum(1 for s in nonschool if s['region'] == r),
               sum(c['kind'] == 'dedicated' for c in cs), sum(c['kind'] in ('pair', 'triad', 'remote') for c in cs), sum(c['kind'] == 'pool' for c in cs), len(cs),
               sum(c['gender'] == 'B' for c in cs), sum(c['gender'] == 'G' for c in cs),
               sum(1 for s in schools if s['region'] == r and s['id'] not in BOAT and cl_of[s['id']]['reach'][s['id']] <= SLA)])
for x in sm[hr]: x.font = bold
for x in sm[3]: x.font = bold
sm.column_dimensions['A'].width = 58; sm.column_dimensions['B'].width = 22; sm.column_dimensions['C'].width = 28
wb.save(XL_OUT)

# ---- report ----
print('engineers', len(clusters), '+ HQ', HQ, '=', len(clusters) + HQ, '| blocks', P, 'deck', DECK)
print('metrics', MET)
print('own engineer', [(c['id'], sites[c['base']]['name']) for c in clusters if c['kind'] == 'remote'])
print('sites covered', sum(len(c['members']) for c in clusters), 'of', len(net['sites']), '| wrote', XL_OUT)
