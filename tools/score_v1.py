"""Scores the earlier 359-engineer plan (tools/build_coverage_plan_v1_sla30.py) on the v3 yardstick and adds it to
public/data/coverage-scenarios.json as 'V1'. Run after build_coverage_plan.py --scenarios."""
import json, os, sys, subprocess, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
src = open(os.path.join(ROOT, 'tools/build_coverage_plan_v1_sla30.py')).read()
src = src.replace("os.path.join(ROOT, 'public/data/coverage-plan.json')", repr(os.path.join(tmp, 'v1.json')))
src = src.replace("ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))", f"ROOT = {ROOT!r}")
open(os.path.join(tmp, 'v1.py'), 'w').write(src)
subprocess.run([sys.executable, os.path.join(tmp, 'v1.py')], check=True, capture_output=True)
plan = open(os.path.join(ROOT, 'tools/build_coverage_plan.py')).read().split("if '--scenarios' in sys.argv:")[0]
g = {'__file__': os.path.join(ROOT, 'tools/build_coverage_plan.py'), '__name__': 'score_v1'}
exec(compile(plan, 'plan', 'exec'), g)
v1 = json.load(open(os.path.join(tmp, 'v1.json')))['clusters']
for c in v1: c['_alloc'] = {}
m = g['metrics'](v1); m.pop('pool_alloc')
f = os.path.join(ROOT, 'public/data/coverage-scenarios.json'); sc = json.load(open(f))
sc['V1'] = {'label': 'Earlier plan: 359 engineers, every leg within 30 min (58 schools with their own engineer)', 'opts': {}, **m}
json.dump(sc, open(f, 'w'), indent=1)
print('V1', m)

# ---- impact of 359 -> 323: who loses 30-min P1 reach, and how engineer load changes ----
from collections import Counter
import statistics as st
C = g['build'](g['CHOSEN']); B, S, R, SLA = g['BOAT'], g['sites'], g['reach'], g['SLA']
of1 = {m: c for c in v1 for m in c['members']}; ofC = {m: c for c in C for m in c['members']}
sch = [s for s in g['schools'] if s['id'] not in B]
lost = [s for s in sch if R(of1[s['id']], s['id']) <= SLA < R(ofC[s['id']], s['id'])]
def load(cl):
    sh = [c for c in cl if c['kind'] in ('pair', 'triad', 'remote')]; po = [c for c in cl if c['kind'] in ('pool', 'nspool')]
    return {'shared_eng': len(sh), 'shared_users_avg': round(st.mean(c['users'] for c in sh)), 'shared_schools_avg': round(st.mean(len(c['members']) for c in sh), 2),
            'shared_3plus': sum(len(c['members']) >= 3 for c in sh), 'own': sum(c['kind'] == 'remote' for c in sh),
            'pool_eng': len(po), 'pool_sites_avg': round(st.mean(len(c['members']) for c in po), 1), 'pool_sites_max': max(len(c['members']) for c in po),
            'pool_users_avg': round(st.mean(c['users'] for c in po))}
sc = json.load(open(f))
sc['V1']['impact'] = {
    'lost': len(lost), 'lost_users': sum(s['users'] for s in lost), 'lost_rural': sum(s['rural'] for s in lost),
    'lost_girls': sum(s['gender'] == 'G' for s in lost), 'lost_by_cluster': dict(Counter(g['REGION_NAME'][s['region']] for s in lost).most_common()),
    'lost_by_tier': dict(Counter(g['tier'][s['id']] for s in lost).most_common()),
    'gained': sum(1 for s in sch if R(ofC[s['id']], s['id']) <= SLA < R(of1[s['id']], s['id'])),
    'load_v1': load(v1), 'load_plan': load(C)}
json.dump(sc, open(f, 'w'), indent=1)
print('impact', sc['V1']['impact'])
