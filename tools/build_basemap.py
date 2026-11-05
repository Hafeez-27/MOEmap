"""Builds a small vector basemap (sea, islands, major roads) for the standalone demo, from OpenStreetMap data.

Inputs are Overpass API JSON exports (out geom):
  coast.json  way["natural"="coastline"] around the UAE
  roads.json  way["highway"~"motorway|trunk|primary"]
Usage: python3 tools/build_basemap.py <coast.json> <roads.json>  ->  public/data/basemap.json
Map data (c) OpenStreetMap contributors, ODbL.
"""
import json, sys, math, pathlib

LAT0, LAT1, LON0, LON1 = 22.55, 26.35, 51.45, 56.65   # clip box: every site plus a margin
TOL_COAST, TOL_ROAD = 0.00025, 0.0003                  # Douglas-Peucker tolerance in degrees (about 25-30 m)
SEA_PT, LAND_PT = (55.10, 25.30), (55.40, 25.20)       # (lon, lat) sanity checks: off Jumeirah, inland Dubai

def dp(pts, tol):
    if len(pts) < 3: return pts
    if pts[0] == pts[-1]:  # a closed ring has no baseline: simplify its two halves
        m = len(pts) // 2; return dp(pts[:m + 1], tol) + dp(pts[m:], tol)[1:]
    keep = [False] * len(pts); keep[0] = keep[-1] = True; stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop(); (x1, y1), (x2, y2) = pts[a], pts[b]; dx, dy = x2 - x1, y2 - y1; n = math.hypot(dx, dy) or 1e-12
        best, idx = 0, -1
        for i in range(a + 1, b):
            d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / n
            if d > best: best, idx = d, i
        if best > tol: keep[idx] = True; stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]

inside = lambda p: LON0 <= p[0] <= LON1 and LAT0 <= p[1] <= LAT1
def cross(p, q):
    """Point where segment p->q crosses the box edge (p inside, q outside, or the reverse)."""
    best = None
    for v0, v1, edges, axis in ((p[0], q[0], (LON0, LON1), 0), (p[1], q[1], (LAT0, LAT1), 1)):
        if v1 == v0: continue
        for edge in edges:
            s = (edge - v0) / (v1 - v0)
            if 0 <= s <= 1:
                x = p[0] + (q[0] - p[0]) * s; y = p[1] + (q[1] - p[1]) * s
                if LON0 - 1e-9 <= x <= LON1 + 1e-9 and LAT0 - 1e-9 <= y <= LAT1 + 1e-9:
                    if best is None or s < best[0]: best = (s, (min(max(x, LON0), LON1), min(max(y, LAT0), LAT1)))
    return best[1]

def clip_line(pts):
    """Split a polyline into pieces inside the box; returns [(points, enters_from_edge, leaves_to_edge)]."""
    out, cur = [], None
    for i, p in enumerate(pts):
        if inside(p):
            if cur is None: cur = ([cross(p, pts[i - 1])] if i else []) + [p]; ent = i > 0
            else: cur.append(p)
        else:
            if cur is not None: cur.append(cross(pts[i - 1], p)); out.append((cur, ent, True)); cur = None
            elif i and not inside(pts[i - 1]):
                pass  # segment entirely outside (corner cutting ignored: harmless at this scale)
    if cur is not None: out.append((cur, ent, False))
    return out

W, H = LON1 - LON0, LAT1 - LAT0; PER = 2 * (W + H)
def tpos(p):  # clockwise perimeter position from the top-left corner (lon right, lat up)
    x, y = p
    if abs(y - LAT1) < 1e-7: return x - LON0
    if abs(x - LON1) < 1e-7: return W + (LAT1 - y)
    if abs(y - LAT0) < 1e-7: return W + H + (LON1 - x)
    return 2 * W + H + (y - LAT0)
CORNERS = [(0, (LON0, LAT1)), (W, (LON1, LAT1)), (W + H, (LON1, LAT0)), (2 * W + H, (LON0, LAT0))]
def walk(t_from, t_to, cw):
    """Box corners passed when walking the perimeter from t_from to t_to (clockwise if cw)."""
    pts = []
    if cw:
        span = (t_to - t_from) % PER
        for tc, c in sorted(CORNERS, key=lambda k: (k[0] - t_from) % PER):
            if 0 < (tc - t_from) % PER < span: pts.append(c)
    else:
        span = (t_from - t_to) % PER
        for tc, c in sorted(CORNERS, key=lambda k: (t_from - k[0]) % PER):
            if 0 < (t_from - tc) % PER < span: pts.append(c)
    return pts

def assemble(pieces, cw):
    polys, left = [], list(range(len(pieces)))
    while left:
        start = left.pop(0); ring, cur = [], start
        for _ in range(len(pieces) + 1):
            pts = pieces[cur]; ring += pts; tx = tpos(pts[-1])
            cands = [(((tpos(pieces[j][0]) - tx) % PER) if cw else ((tx - tpos(pieces[j][0])) % PER), j) for j in left + [start]]
            _, nxt = min(cands); ring += walk(tx, tpos(pieces[nxt][0]), cw)
            if nxt == start: break
            left.remove(nxt); cur = nxt
        polys.append(ring)
    return polys

def pip(pt, ring):
    x, y, c = pt[0], pt[1], False
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i], ring[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

def main(coast_path, roads_path):
    ways = [w for w in json.load(open(coast_path))['elements'] if w['type'] == 'way' and w.get('geometry')]
    # join coastline ways end to end into chains
    by_start = {}
    for w in ways: by_start.setdefault(w['nodes'][0], []).append(w)
    used, chains = set(), []
    for w in ways:
        if w['id'] in used: continue
        used.add(w['id']); nodes, geom = list(w['nodes']), [(g['lon'], g['lat']) for g in w['geometry']]
        # extend forwards
        while nodes[-1] != nodes[0]:
            nx = [v for v in by_start.get(nodes[-1], []) if v['id'] not in used]
            if not nx: break
            v = nx[0]; used.add(v['id']); nodes += v['nodes'][1:]; geom += [(g['lon'], g['lat']) for g in v['geometry']][1:]
        # extend backwards
        ends = {}
        for v in ways:
            if v['id'] not in used: ends.setdefault(v['nodes'][-1], []).append(v)
        while nodes[-1] != nodes[0] and ends.get(nodes[0]):
            v = [x for x in ends[nodes[0]] if x['id'] not in used]
            if not v: break
            v = v[0]; used.add(v['id']); nodes = v['nodes'][:-1] + nodes; geom = [(g['lon'], g['lat']) for g in v['geometry']][:-1] + geom
        chains.append((geom, nodes[0] == nodes[-1]))
    islands, pieces, dropped = [], [], 0
    for geom, closed in chains:
        g = dp(geom, TOL_COAST)
        if closed and all(inside(p) for p in g):
            if len(g) >= 4: islands.append(g)
            continue
        for pts, ent, lv in clip_line(g):
            if ent and lv and len(pts) >= 2: pieces.append(pts)
            else: dropped += 1
    sea = None
    for cw in (True, False):
        polys = assemble(pieces, cw)
        if any(pip(SEA_PT, r) for r in polys) and not any(pip(LAND_PT, r) for r in polys): sea = polys; break
    if sea is None: sys.exit('could not assemble the sea polygons consistently')
    roads = {'m': [], 'p': []}
    for w in json.load(open(roads_path))['elements']:
        if w['type'] != 'way' or not w.get('geometry'): continue
        k = 'p' if w['tags'].get('highway') == 'primary' else 'm'
        for pts, _, _ in clip_line(dp([(g['lon'], g['lat']) for g in w['geometry']], TOL_ROAD)):
            if len(pts) >= 2: roads[k].append(pts)
    flat = lambda pts: [round(v, 5) for p in pts for v in (p[1], p[0])]   # lat, lng pairs
    out = {'attribution': '© OpenStreetMap contributors', 'box': [LAT0, LON0, LAT1, LON1],
           'sea': [flat(r) for r in sea], 'islands': [flat(r) for r in islands if len(r) >= 4],
           'motorway': [flat(l) for l in roads['m']], 'primary': [flat(l) for l in roads['p']]}
    p = pathlib.Path(__file__).resolve().parent.parent / 'public/data/basemap.json'
    p.write_text(json.dumps(out, separators=(',', ':')))
    print(f"sea {len(sea)} polys, islands {len(out['islands'])}, motorway {len(out['motorway'])}, primary {len(out['primary'])}, dropped pieces {dropped}, {p.stat().st_size // 1024} KB")

if __name__ == '__main__': main(sys.argv[1], sys.argv[2])
