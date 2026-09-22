import json
import numpy as np
import pyarrow.feather as feather

g = json.loads(open(r"D:\苍蝇\public\data\connectome\graph.json", encoding="utf-8").read())
print("graph nodes[:3]:", [(n["id"], n["type"]) for n in g["nodes"][:3]])
print("graph edges[:5]:", g["edges"][:5])
ids = np.array(sorted({n["id"] for n in g["nodes"]}), dtype=np.int64)
tbl = feather.read_table(
    r"D:\苍蝇\_research\malecns\connectome-weights-male-cns-v1.0-minconf-0.5-traced-only.feather",
    columns=["body_pre", "body_post", "weight"])
pre = tbl["body_pre"].to_numpy()
post = tbl["body_post"].to_numpy()
w = tbl["weight"].to_numpy()
print("weights sample[:3]:", [(int(pre[k]), int(post[k]), int(w[k])) for k in range(3)])

idx = set(ids.tolist())
mask = np.isin(pre, ids) & np.isin(post, ids)
sp, sq, sw = pre[mask], post[mask], w[mask]
print("masked rows:", len(sp))
print("masked sample (pre,post,w):", [(int(sp[k]), int(sq[k]), int(sw[k])) for k in range(5)])
fwd = {(int(a), int(b)): int(c) for a, b, c in zip(sp, sq, sw)}
rev = {(int(b), int(a)): int(c) for a, b, c in zip(sp, sq, sw)}
fh = sum(1 for a, b, c in g["edges"] if (a, b) in fwd)
rh = sum(1 for a, b, c in g["edges"] if (a, b) in rev)
he = sum(1 for a, b, c in g["edges"] if (a, b) in fwd and fwd[(a, b)] == c)
print("fwd hits:", fh, " rev-direction hits:", rh, " fwd exact:", he)
print("sum graph contacts:", sum(c for _, _, c in g["edges"]), " sum masked w:", int(sw.sum()))
id_of = [n["id"] for n in g["nodes"]]
edge_set_g = {(id_of[ia], id_of[ib]) for ia, ib, _ in g["edges"]}
edge_set_m = set(fwd.keys())
print("set equal:", edge_set_g == edge_set_m, " g-only:", len(edge_set_g - edge_set_m), " m-only:", len(edge_set_m - edge_set_g))

# graph edges are INDEX pairs -> remap to body ids via node list order
id_of = [n["id"] for n in g["nodes"]]
exact = present = missing = 0
mism = []
for ia, ib, c in g["edges"]:
    k = (id_of[ia], id_of[ib])
    if k in fwd:
        present += 1
        if fwd[k] == c:
            exact += 1
        elif len(mism) < 5:
            mism.append((k, c, fwd[k]))
    else:
        missing += 1
print("ID-mapped: present", present, "exact", exact, "missing", missing, "mismatch samples:", mism)
