# Desk route-to-way review (SP-04 desk only; DESK — NOT FIELD). Maps the OSM node ids of local OSRM routes
# (annotations=nodes) to the ways of the extract the router was built from, with their access-relevant tags, and
# checks whether the ways at each route end (all ways through the first/last route node; OSRM /nearest at the waypoint
# location names the exact snapped segment) are connected to the rest of the road
# network without access=private/no ways. pyosmium 3.7 (pinned Nominatim image).
# usage: python3 -I route-ways.py <extract.pbf> <out.json> <minlon,minlat,maxlon,maxlat> [mid=<way id>,...] <osrm-route.json>...
#   mid=: also write the middle vertex (5 dp, local output only) of these ways, e.g. for a labelled diagnostic end point.
#   bbox: the area whose ways are loaded for the connectivity check (keep it around the end points under review);
#   a component that reaches a way leaving the bbox counts as connected.
# Output stays local (it contains OSM node ids and 5-dp vertices); only way ids/tags go into committed text.
import json
import sys
import osmium

pbf, out, bbox_arg = sys.argv[1:4]
BBOX = tuple(float(x) for x in bbox_arg.split(','))
CAR = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
       'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road'}
KEY_TAGS = ('highway', 'access', 'service', 'motor_vehicle', 'motorcar', 'vehicle', 'aeroway', 'area', 'name', 'name:en',
            'oneway', 'barrier')
args = sys.argv[4:]
MID = args.pop(0)[4:].split(',') if args and args[0].startswith('mid=') else []
routes = {}
for p in args:
    with open(p, encoding='utf8') as f:
        body = json.load(f)
    routes[p.replace('\\', '/').rsplit('/', 1)[-1]] = {
        'nodes': [str(n) for leg in body['routes'][0]['legs'] for n in leg['annotation']['nodes']],
        'snapDistanceM': [round(w['distance']) for w in body['waypoints']],
    }


def inside(lon, lat):
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


class Ways(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = {}  # car-class highway ways touching the bbox
        self.node_ways = {}

    def way(self, w):
        tags = {t.k: t.v for t in w.tags}
        if tags.get('highway') not in CAR:
            return
        locs = [(r.lon, r.lat) for r in w.nodes if r.location.valid()]
        flags = [inside(x, y) for x, y in locs]
        if not any(flags):
            return
        wid = str(w.id)
        refs = [str(r.ref) for r in w.nodes]
        mid = locs[len(locs) // 2]
        self.ways[wid] = {'tags': tags, 'nodes': refs, 'leavesBbox': not all(flags),
                          'midVertex5dp': [round(mid[0], 5), round(mid[1], 5)]}
        for r in refs:
            self.node_ways.setdefault(r, []).append(wid)


h = Ways()
h.apply_file(pbf, locations=True)


def restricted(wid):
    return h.ways[wid]['tags'].get('access') in ('private', 'no')


def public_component(start):
    seen, queue = {start}, [start]
    while queue:
        w = queue.pop()
        for n in h.ways[w]['nodes']:
            for v in h.node_ways.get(n, []):
                if v not in seen and not restricted(v):
                    seen.add(v)
                    queue.append(v)
    return seen


def way_of_pair(a, b):
    for wid in h.node_ways.get(a, []):
        ns = h.ways[wid]['nodes']
        for j in range(1, len(ns)):
            if {ns[j - 1], ns[j]} == {a, b}:
                return wid
    return None


def key_tags(wid):
    return {k: v for k, v in h.ways[wid]['tags'].items() if k in KEY_TAGS} if wid else {}


result = {'note': 'DESK — NOT FIELD. (c) OpenStreetMap contributors, ODbL.', 'bbox': BBOX, 'routes': {},
          'midVertex5dp': {w: h.ways[w]['midVertex5dp'] for w in MID if w in h.ways}}
for name, r in routes.items():
    seq = r['nodes']
    runs = []
    for i in range(1, len(seq)):
        wid = way_of_pair(seq[i - 1], seq[i])
        if runs and runs[-1]['way'] == wid:
            runs[-1]['toPair'] = i
        else:
            runs.append({'way': wid, 'fromPair': i - 1, 'toPair': i})
    for run in runs:
        run['tags'] = key_tags(run['way'])
    ends = []
    for end_node, dist in zip((seq[0], seq[-1]), r['snapDistanceM']):
        cands = []
        for wid in h.node_ways.get(end_node, []):
            comp = public_component(wid) if not restricted(wid) else set()
            cands.append({'way': wid, 'tags': key_tags(wid), 'publicComponentWays': len(comp),
                          'connectedWithoutPrivate': any(h.ways[c]['leavesBbox'] for c in comp)})
        ends.append({'snapDistanceM': dist, 'candidates': cands or 'end node outside bbox'})
    result['routes'][name] = {
        'pairs': len(seq) - 1,
        'ends': ends,
        'restrictedRuns': [x for x in runs if x['way'] and restricted(x['way'])],
        'unmappedPairs': sum(x['toPair'] - x['fromPair'] for x in runs if x['way'] is None),
        'runs': runs,
    }

with open(out, 'w', encoding='utf8') as f:
    json.dump(result, f, ensure_ascii=False, indent=1)
for name, r in result['routes'].items():
    print(name, json.dumps({'pairs': r['pairs'], 'unmapped': r['unmappedPairs'],
                            'restricted': [(x['way'], x['fromPair'], x['toPair'], x['tags']) for x in r['restrictedRuns']],
                            'ends': r['ends']},
                           ensure_ascii=False), flush=True)
