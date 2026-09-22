"""P0 probe: dump schema + row counts + sample rows of the MaleCNS v1.0 feather files.

Read-only. Prints everything we need to design build_graph_600.py:
  - exact column names / dtypes of annotations, neurotransmitters, weights(traced-only)
  - how many proofread/annotated bodies exist and what 'type'-like columns look like
  - whether the existing 80-cell graph.json edges are reproduced by the weights file
"""
import json
import sys
from collections import Counter
from pathlib import Path

import pyarrow.feather as feather  # type: ignore

HERE = Path(__file__).resolve().parent
GRAPH_80 = HERE.parent.parent / "public" / "data" / "connectome" / "graph.json"

FILES = {
    "annotations": HERE / "body-annotations-male-cns-v1.0-minconf-0.5.feather",
    "neurotransmitters": HERE / "body-neurotransmitters-male-cns-v1.0.feather",
    "weights_traced": HERE / "connectome-weights-male-cns-v1.0-minconf-0.5-traced-only.feather",
}


def describe(name: str, path: Path) -> None:
    print(f"\n===== {name}: {path.name} =====")
    if not path.exists():
        print("MISSING")
        return
    table = feather.read_table(path)
    print(f"rows={table.num_rows} cols={table.num_columns}")
    for field in table.schema:
        print(f"  - {field.name}: {field.type}")
    # sample rows
    py = table.slice(0, 5).to_pydict()
    keys = list(py.keys())
    for i in range(min(5, table.num_rows)):
        print("  sample:", {k: py[k][i] for k in keys[:14]})
    return table


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    tables = {}
    if mode != "xcheck":
        for name, path in FILES.items():
            t = describe(name, path)
            if t is not None:
                tables[name] = t

    # ---- annotations deep dive: which columns look like cell type / name / status
    ann = tables.get("annotations")
    if ann is not None:
        d = ann.to_pandas()
        print("\n===== annotations: column non-null / cardinality =====")
        for col in d.columns:
            if d[col].dtype == object and len(d[col].dropna()) and hasattr(d[col].dropna().iloc[0], "__len__"):
                print(f"  {col}: LIST column, nonNull={d[col].notna().sum()}")
                continue
            nun = d[col].nunique(dropna=True)
            nn = d[col].notna().sum()
            print(f"  {col}: distinct={nun} nonNull={nn}")
            if 0 < nun <= 40:
                print("     values:", dict(Counter(d[col].dropna().astype(str)).most_common(40)))
            if col == "statusLabel":
                have_type = d["type"].notna()
                for st in ["Reviewed", "Roughly traced", "Prelim Roughly traced"]:
                    m = d["statusLabel"] == st
                    print(f"     status={st}: total={m.sum()}, with type={int((m & have_type).sum())}")

    # ---- weights cross-check against existing 80-cell graph
    wt_path = FILES["weights_traced"]
    if wt_path.exists() and GRAPH_80.exists():
        import numpy as np
        import pyarrow as pa
        g = json.loads(GRAPH_80.read_text(encoding="utf-8"))
        ids = np.array(sorted({n["id"] for n in g["nodes"]}), dtype=np.int64)
        print(f"\n===== cross-check: graph.json {len(g['nodes'])} nodes / {len(g['edges'])} edges vs traced-only =====")
        tbl = feather.read_table(wt_path, columns=["body_pre", "body_post", "weight"])
        pre = tbl["body_pre"].to_numpy(zero_copy_only=False)
        post = tbl["body_post"].to_numpy(zero_copy_only=False)
        w = tbl["weight"].to_numpy(zero_copy_only=False)
        print(f"traced-only rows: {len(pre)}")
        # membership via searchsorted on sorted ids
        def in_ids(a):
            i = np.searchsorted(ids, a)
            i_c = np.clip(i, 0, len(ids) - 1)
            return (ids[i_c] == a) & ((a >= ids[0]) & (a <= ids[-1]))
        mask = in_ids(pre) & in_ids(post)
        sp, sq, sw = pre[mask], post[mask], w[mask]
        print(f"edges between the 80 bodies found in traced-only: {len(sp)}")
        lut = {}
        for a, b, c in zip(sp.tolist(), sq.tolist(), sw.tolist()):
            lut[(a, b)] = c
        hit_exact = hit_present = miss = 0
        mism_sample = []
        for a, b, c in g["edges"]:
            k = (a, b)
            if k in lut:
                hit_present += 1
                if lut[k] == c:
                    hit_exact += 1
                elif len(mism_sample) < 5:
                    mism_sample.append((a, b, c, lut[k]))
            else:
                miss += 1
        print(f"graph edges: exact-value={hit_exact} present-any={hit_present} missing={miss}")
        if mism_sample:
            print("mismatch samples (pre,post,graph_w,traced_w):", mism_sample)
        # also global: how strong are these edges (for min-contact rule design)
        print("weight distribution of the 80-graph edges in traced-only:",
              "min", sw.min() if len(sw) else None, "max", sw.max() if len(sw) else None)
        del pre, post, w, tbl
    return 0


if __name__ == "__main__":
    sys.exit(main())
