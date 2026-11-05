"""Google Maps drive times (Routes API, computeRouteMatrix) with a local cache.

Two time slots, both on the next Tuesday (a normal school day), using Google's typical traffic for that time:
  peak = leaving 07:30 Gulf time (school-run peak), off = leaving 10:30.
Cache: tools/google-cache.json, keyed by origin/destination coordinates and slot, so rebuilds never re-buy a lookup.
The key is read from .env (GOOGLE_MAPS_API_KEY) and never written anywhere else.
"""
import datetime
import json
import os
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_FILE = os.path.join(ROOT, 'tools', 'google-cache.json')
URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix'
SLOTS = {'peak': (7, 30), 'off': (10, 30)}          # local Gulf time (UTC+4)
LABELS = {'peak': 'Tuesday, leaving 7:30 am', 'off': 'Tuesday, leaving 10:30 am'}

_cache = {'meta': {}, 'pairs': {}}
if os.path.exists(CACHE_FILE):
    with open(CACHE_FILE) as f: _cache = json.load(f)


def key(a, b, slot): return f"{a['lat']:.5f},{a['lng']:.5f}>{b['lat']:.5f},{b['lng']:.5f}|{slot}"


def get(a, b, slot):
    """(minutes, km) from the cache, or None."""
    v = _cache['pairs'].get(key(a, b, slot))
    return tuple(v) if v else None


def size(): return len(_cache['pairs'])
def meta(): return dict(_cache.get('meta', {}))


def _api_key():
    for line in open(os.path.join(ROOT, '.env')):
        if line.startswith('GOOGLE_MAPS_API_KEY='):
            return line.split('=', 1)[1].strip().strip('"\'')
    raise SystemExit('GOOGLE_MAPS_API_KEY is missing from .env')


def _departure(slot):
    d = datetime.date.today() + datetime.timedelta(days=1)
    while d.weekday() != 1: d += datetime.timedelta(days=1)       # next Tuesday
    h, m = SLOTS[slot]
    return d, datetime.datetime(d.year, d.month, d.day, h, m, tzinfo=datetime.timezone(datetime.timedelta(hours=4)))


def _call(origin, dests, dep, api_key):
    wp = lambda p: {'waypoint': {'location': {'latLng': {'latitude': p['lat'], 'longitude': p['lng']}}}}
    body = {'origins': [wp(origin)], 'destinations': [wp(d) for d in dests], 'travelMode': 'DRIVE',
            'routingPreference': 'TRAFFIC_AWARE', 'departureTime': dep.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={
        'Content-Type': 'application/json', 'X-Goog-Api-Key': api_key,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition'})
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            msg = e.read().decode()
            # 429/5xx: busy. 403 API_KEY_SERVICE_BLOCKED right after a key change: Google is still spreading the change.
            if (e.code in (429, 500, 503) or (e.code == 403 and ('API_KEY_SERVICE_BLOCKED' in msg or 'SERVICE_DISABLED' in msg))) and attempt < 7:
                time.sleep(min(30, 2 ** attempt + 1)); continue
            try: msg = json.loads(msg)['error']['message']
            except Exception: pass
            raise SystemExit(f'Google Routes API refused the request ({e.code}): {msg}')


def fetch(pairs, slot, dry=False):
    """pairs: iterable of (a, b) site dicts with lat/lng. Looks up every pair not yet cached. Returns how many were looked up."""
    todo, seen = {}, set()
    for a, b in pairs:
        k = key(a, b, slot)
        if k in _cache['pairs'] or k in seen: continue
        seen.add(k); todo.setdefault((round(a['lat'], 5), round(a['lng'], 5)), (a, []))[1].append(b)
    n = len(seen)
    if dry or not n: return n
    api_key = _api_key(); day, dep = _departure(slot)
    jobs = [(a, ds[i:i + 25]) for a, ds in todo.values() for i in range(0, len(ds), 25)]
    done = [0]
    def run(job):
        a, ds = job
        res = _call(a, ds, dep, api_key)
        out = {}
        for e in res if isinstance(res, list) else []:
            b = ds[e.get('destinationIndex', 0)]
            if e.get('condition') == 'ROUTE_EXISTS' and 'duration' in e:
                out[key(a, b, slot)] = [round(int(e['duration'].rstrip('s')) / 60, 1), round(e.get('distanceMeters', 0) / 1000, 1)]
        done[0] += 1
        if done[0] % 50 == 0: print(f'  google {slot}: {done[0]}/{len(jobs)} requests')
        return out
    _cache.setdefault('meta', {})[slot] = {'label': LABELS[slot], 'departure': dep.isoformat(), 'fetched': datetime.date.today().isoformat()}
    def save():
        with open(CACHE_FILE + '.tmp', 'w') as f: json.dump(_cache, f)
        os.replace(CACHE_FILE + '.tmp', CACHE_FILE)
    try:
        with ThreadPoolExecutor(6) as ex:
            for j, out in enumerate(ex.map(run, jobs)):
                _cache['pairs'].update(out)
                if j % 40 == 39: save()          # keep what was paid for, even if a later request fails
    finally:
        save()
    return n
