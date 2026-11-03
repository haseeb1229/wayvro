# Exports named Lahore features (GeoJSON lines: Point for nodes, LineString for open ways, Polygon outer ring for
# areas built from closed ways and multipolygon relations) and the one-way/access-restricted highway ways with their
# node refs (JSON lines) from the clipped extract. pyosmium 3.7.
# usage: python3 export.py <lahore.pbf> <named.geojsonseq> <restrictions.jsonl>
import json
import sys
import osmium

src, named_out, restr_out = sys.argv[1:4]
KEEP = ('name', 'name:en', 'name:ur')


class Export(osmium.SimpleHandler):
    def __init__(self, named, restr):
        super().__init__()
        self.named = named
        self.restr = restr
        self.counts = {'node': 0, 'way': 0, 'area': 0, 'restr': 0}

    @staticmethod
    def props(o, kind, oid):
        p = {t.k: t.v for t in o.tags}
        p['@type'] = kind
        p['@id'] = oid
        return p

    def emit(self, geom, props):
        self.named.write(json.dumps({'type': 'Feature', 'geometry': geom, 'properties': props}, ensure_ascii=False) + '\n')

    def node(self, n):
        if any(k in n.tags for k in KEEP) and n.location.valid():
            self.emit({'type': 'Point', 'coordinates': [n.location.lon, n.location.lat]}, self.props(n, 'node', n.id))
            self.counts['node'] += 1

    def way(self, w):
        tags = w.tags
        if 'highway' in tags and ('oneway' in tags or tags.get('junction') in ('roundabout', 'circular') or tags.get('access') in ('private', 'no')):
            self.restr.write(json.dumps({'id': w.id, 'tags': {t.k: t.v for t in tags}, 'nodes': [r.ref for r in w.nodes]}) + '\n')
            self.counts['restr'] += 1
        if any(k in tags for k in KEEP) and not w.is_closed():
            coords = [[r.lon, r.lat] for r in w.nodes if r.location.valid()]
            if len(coords) >= 2:
                self.emit({'type': 'LineString', 'coordinates': coords}, self.props(w, 'way', w.id))
                self.counts['way'] += 1

    def area(self, a):
        if not any(k in a.tags for k in KEEP):
            return
        rings = []
        for outer in a.outer_rings():
            rings.append([[r.lon, r.lat] for r in outer])
        if rings:
            geom = {'type': 'MultiPolygon', 'coordinates': [[r] for r in rings]}
            self.emit(geom, self.props(a, 'way' if a.from_way() else 'relation', a.orig_id()))
            self.counts['area'] += 1


with open(named_out, 'w', encoding='utf8') as named, open(restr_out, 'w', encoding='utf8') as restr:
    h = Export(named, restr)
    h.apply_file(src, locations=True)
print('EXPORT_DONE', json.dumps(h.counts), flush=True)
