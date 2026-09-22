import json
import numpy as np
import pyarrow.feather as feather

ANN = r"D:\苍蝇\_research\malecns\body-annotations-male-cns-v1.0-minconf-0.5.feather"
NT = r"D:\苍蝇\_research\malecns\body-neurotransmitters-male-cns-v1.0.feather"
g = json.loads(open(r"D:\苍蝇\public\data\connectome\graph.json", encoding="utf-8").read())
want = {n["id"]: n["type"] for n in g["nodes"]}

ann = feather.read_table(ANN, columns=["bodyId", "type", "class", "superclass", "status", "statusLabel",
                                       "somaLocation", "instance", "somaSide", "flywireType"]).to_pandas()
ann = ann[ann["bodyId"].isin(want.keys())]
print("existing-80 bodies found in annotations:", len(ann), "of", len(want))
for _, r in ann.iterrows():
    gid = int(r["bodyId"])
    sl = r["somaLocation"]
    sl_ok = "som" if (sl is not None and hasattr(sl, "__len__") and len(sl) == 3) else "NO-som"
    print(f"  {gid:6d} graph={want[gid]:8s} ann.type={str(r['type']):10s} class={str(r['class']):8s} sup={str(r['superclass']):18s} st={str(r['status'])[:14]:14s} {sl_ok}")

# universe stats for selection pool
t = feather.read_table(ANN, columns=["bodyId", "type", "status", "somaLocation"]).to_pandas()
traced = t[(t["status"] == "Traced") & t["type"].notna()]
print("\nUniverse: traced+type =", len(traced),
      " with somaLocation =", int(traced["somaLocation"].notna().sum()))
