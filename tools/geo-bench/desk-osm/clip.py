# Bounding-box clip with complete ways (pyosmium 3.7): pass 1 selects nodes inside the bbox, every way touching one
# (plus all of that way's nodes) and every relation with a selected member; pass 2 writes the selection.
# usage: python3 clip.py <in.pbf> <out.pbf> minlon minlat maxlon maxlat
import sys
import osmium

src, dst = sys.argv[1], sys.argv[2]
minlon, minlat, maxlon, maxlat = map(float, sys.argv[3:7])


class Inside(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.nodes = set()

    def node(self, n):
        loc = n.location
        if loc.valid() and minlon <= loc.lon <= maxlon and minlat <= loc.lat <= maxlat:
            self.nodes.add(n.id)


class Select(osmium.SimpleHandler):
    def __init__(self, inside):
        super().__init__()
        self.inside = inside
        self.nodes = set(inside)
        self.ways = set()
        self.relations = set()

    def way(self, w):
        refs = [r.ref for r in w.nodes]
        if any(r in self.inside for r in refs):
            self.ways.add(w.id)
            self.nodes.update(refs)

    def relation(self, r):
        for m in r.members:
            if (m.type == 'w' and m.ref in self.ways) or (m.type == 'n' and m.ref in self.inside):
                self.relations.add(r.id)
                return


class Write(osmium.SimpleHandler):
    def __init__(self, sel, writer):
        super().__init__()
        self.sel = sel
        self.writer = writer

    def node(self, n):
        if n.id in self.sel.nodes:
            self.writer.add_node(n)

    def way(self, w):
        if w.id in self.sel.ways:
            self.writer.add_way(w)

    def relation(self, r):
        if r.id in self.sel.relations:
            self.writer.add_relation(r)


inside = Inside()
inside.apply_file(src)
print('nodes inside', len(inside.nodes), flush=True)
sel = Select(inside.nodes)
sel.apply_file(src)
print('selected nodes', len(sel.nodes), 'ways', len(sel.ways), 'relations', len(sel.relations), flush=True)
writer = osmium.SimpleWriter(dst)
Write(sel, writer).apply_file(src)
writer.close()
print('CLIP_DONE', flush=True)
