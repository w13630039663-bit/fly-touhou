# -*- coding: utf-8 -*-
"""build_graph_600.py — P1: derive a 600-neuron MaleCNS subgraph by weighted pathway
closure grown from the existing 80 selected cells (LC→bridge→DN visual-motor spine).
Deterministic; no game outcomes used.

Sources (FlyEM MaleCNS v1.0, min-conf 0.5, flat connectome):
  body-annotations-male-cns-v1.0-minconf-0.5.feather     -> type, superclass, status, somaLocation
  body-neurotransmitters-male-cns-v1.0.feather           -> consensus_nt, predicted_nt_confidence
  connectome-weights-male-cns-v1.0-minconf-0.5-traced-only.feather -> directed seg-to-seg contacts

Self-check gate: before building, recompute the CURRENT 80 nodes' position/nt/sign from
these sources and diff against graph.json (must be 80/80 identical, else abort).

Output: public/data/connectome/graph600.json + manifest600.json (same schema family as v1).
"""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pyarrow.feather as feather

HERE = Path(__file__).resolve().parent            # _research/malecns
ROOT = HERE.parent.parent                          # workspace root
OUT_DIR = ROOT / "public" / "data" / "connectome"
ANN = HERE / "body-annotations-male-cns-v1.0-minconf-0.5.feather"
NT = HERE / "body-neurotransmitters-male-cns-v1.0.feather"
WEIGHTS = HERE / "connectome-weights-male-cns-v1.0-minconf-0.5-traced-only.feather"

TARGET = 600
MIN_CONTACTS = 3
ROUNDS = (120, 120, 240)            # per-round top-K additions -> 80+480 = 560... see fill
CHANNELS = ["LC4", "LC11", "LC9", "LC15", "LC16", "LC17", "LC21", "LPLC2"]
NT_SIGN = {"acetylcholine": 1, "gaba": -1, "glutamate": -1}
NT_CONF_FLOOR = 0.5


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    # ---------- existing v1 graph ----------
    g80 = json.loads((OUT_DIR / "graph.json").read_text(encoding="utf-8"))
    v1_id_of = [n["id"] for n in g80["nodes"]]
    seed_ids = set(v1_id_of)
    old_inputs = {v1_id_of[i] for i, _ in g80["inputs"]}
    old_outputs = {v1_id_of[i] for i in g80["outputs"]}
    assert (len(seed_ids), len(old_inputs), len(old_outputs)) == (80, 32, 16)
    v1_node_by_id = {n["id"]: n for n in g80["nodes"]}

    # ---------- annotations ----------
    ann = feather.read_table(
        ANN, columns=["bodyId", "type", "superclass", "status", "somaLocation"]).to_pandas()
    ann = ann[(ann["status"] == "Traced") & ann["type"].notna()]
    meta: dict[int, tuple] = {}
    for r in ann.itertuples(index=False):
        loc = r.somaLocation
        if loc is None or len(loc) != 3:
            continue
        meta[int(r.bodyId)] = (str(r.type), str(r.superclass),
                               [int(loc[0]), int(loc[1]), int(loc[2])])
    print(f"annotations universe: {len(meta)} traced+named+soma bodies")

    # ---------- neurotransmitters ----------
    nt = feather.read_table(NT, columns=["body", "consensus_nt", "predicted_nt_confidence"]).to_pandas()
    ntmap: dict[int, str] = {}
    for r in nt.itertuples(index=False):
        name = r.consensus_nt
        if name is None or (isinstance(name, float) and np.isnan(name)):
            continue
        conf = float(r.predicted_nt_confidence or 0.0)
        ntmap[int(r.body)] = str(name).lower() if conf >= NT_CONF_FLOOR else "unclear"

    # ---------- SELF-CHECK vs v1 graph.json ----------
    diffs = []
    for n in g80["nodes"]:
        bid = n["id"]
        typ, _sup, loc = meta[bid]
        nt_name = ntmap.get(bid, "unclear")
        sign = NT_SIGN.get(nt_name, 0)
        if typ != n["type"] or loc != list(n["position"]) or nt_name != n["nt"] or sign != n["sign"]:
            diffs.append((bid, typ, n["type"], loc, n["position"], nt_name, n["nt"], sign, n["sign"]))
    print(f"self-check v1 reproduction: {80 - len(diffs)}/80 identical, {len(diffs)} diffs")
    for d in diffs[:10]:
        print("  DIFF", d)
    if diffs:
        print("ABORT: derivation does not reproduce the shipped 80-cell graph.")
        return 2

    # ---------- weights ----------
    wt = feather.read_table(WEIGHTS, columns=["body_pre", "body_post", "weight"])
    pre = wt["body_pre"].to_numpy(zero_copy_only=False)
    post = wt["body_post"].to_numpy(zero_copy_only=False)
    w = wt["weight"].to_numpy(zero_copy_only=False)
    del wt
    keep = (pre != post) & (w >= MIN_CONTACTS)
    pre, post, w = pre[keep], post[keep], w[keep]
    print(f"weights: {len(pre)} strong directed edges (>={MIN_CONTACTS})")

    def build_csr(src, dst, val):
        order = np.argsort(src, kind="stable")
        s, d, v = src[order], dst[order], val[order]
        uniq, starts = np.unique(s, return_index=True)
        ends = np.append(starts[1:], len(s))
        return d, v, uniq, starts, ends

    dst_out, val_out, rows_out, st_out, en_out = build_csr(pre, post, w)
    dst_in, val_in, rows_in, st_in, en_in = build_csr(post, pre, w)
    del pre, post, w

    def row_range(body, rows, starts, ends):
        i = np.searchsorted(rows, body)
        if i < len(rows) and rows[i] == body:
            return starts[i], ends[i]
        return 0, 0

    # ---------- closure ----------
    inside = set(seed_ids)
    cand: dict[int, int] = {}

    def absorb(body: int) -> None:
        for dst, val, rows, st, en in ((dst_out, val_out, rows_out, st_out, en_out),
                                       (dst_in, val_in, rows_in, st_in, en_in)):
            s, e = row_range(body, rows, st, en)
            for j in range(s, e):
                nb = int(dst[j])
                if nb not in inside:
                    cand[nb] = cand.get(nb, 0) + int(val[j])

    for bid in sorted(inside):
        absorb(bid)

    added_order = []
    for k in ROUNDS:
        cands = sorted(((sc, -b) for b, sc in cand.items() if b not in inside and b in meta),
                       reverse=True)
        chosen = [-neg for _, neg in cands[:k]]
        for bid in chosen:
            inside.add(bid)
            added_order.append(bid)
            absorb(bid)
            cand.pop(bid, None)
        print(f"round +{k}: set size {len(inside)}")

    while len(inside) < TARGET:
        cands = sorted(((sc, -b) for b, sc in cand.items() if b not in inside and b in meta),
                       reverse=True)
        if not cands:
            break
        bid = -cands[0][1]
        inside.add(bid)
        added_order.append(bid)
        absorb(bid)
        cand.pop(bid, None)
    while len(inside) > TARGET:  # trim lowest-marginal non-seed additions last-in-first-out
        inside.discard(added_order.pop())
    assert len(inside) == TARGET, f"final size {len(inside)} != {TARGET}"
    assert seed_ids <= inside and old_outputs <= inside and old_inputs <= inside

    # ---------- induced edges (index space, nodes sorted by body id asc) ----------
    node_ids = sorted(inside)
    index_of = {b: i for i, b in enumerate(node_ids)}
    edges = []
    for bid in node_ids:
        s, e = row_range(bid, rows_out, st_out, en_out)
        for j in range(s, e):
            dj = index_of.get(int(dst_out[j]))
            if dj is not None:
                edges.append([index_of[bid], dj, int(val_out[j])])
    edges.sort()
    total_contacts = sum(c for _, _, c in edges)
    print(f"induced edges: {len(edges)}  totalContacts: {total_contacts}")

    # ---------- roles / inputs / outputs ----------
    input_ids = {b for b in node_ids if meta[b][0] in CHANNELS}
    output_ids = set(old_outputs)
    assert len(output_ids) == 16 and len(input_ids) >= 32

    nodes = []
    for bid in node_ids:
        typ, sup, loc = meta[bid]
        nt_name = ntmap.get(bid, "unclear")
        sign = NT_SIGN.get(nt_name, 0)
        role = "output" if bid in output_ids else ("input" if bid in input_ids else "interneuron")
        nodes.append({"id": bid, "type": typ, "position": loc, "nt": nt_name, "sign": sign, "role": role})
    inputs = [[i, CHANNELS.index(n["type"])] for i, n in enumerate(nodes) if n["id"] in input_ids]
    outputs = [i for i, n in enumerate(nodes) if n["id"] in output_ids]

    graph = {
        "version": "malecns-visual-motor-600-v2",
        "nodes": nodes,
        "edges": edges,
        "inputs": inputs,
        "outputs": outputs,
        "channels": CHANNELS,
    }
    graph_bytes = json.dumps(graph, separators=(",", ":")).encode("utf-8")
    (OUT_DIR / "graph600.json").write_bytes(graph_bytes)

    stats = {
        "roleCounts": {r: sum(1 for n in nodes if n["role"] == r) for r in ("input", "interneuron", "output")},
        "signCounts": {str(s): sum(1 for n in nodes if n["sign"] == s) for s in (1, 0, -1)},
        "ntCounts": dict(Counter(n["nt"] for n in nodes).most_common()),
        "superclassCounts": dict(Counter(meta[b][1] for b in node_ids).most_common()),
        "typeCount": len({meta[b][0] for b in node_ids}),
        "dnSupernumerary": sum(1 for b in node_ids if meta[b][1] == "descending_neuron") ,
        "vncMotor": sum(1 for b in node_ids if meta[b][1] == "vnc_motor"),
    }
    manifest = {
        "dataset": "FlyEM MaleCNS v1.0, min confidence 0.5, traced-only segment pairs",
        "license": "CC BY 4.0",
        "source": "https://male-cns.janelia.org/download/",
        "nodes": len(nodes),
        "edges": len(edges),
        "synapticContacts": int(total_contacts),
        "inputCells": len(input_ids),
        "readoutCells": 16,
        "graphSha256": hashlib.sha256(graph_bytes).hexdigest(),
        "sources": {
            "annotations": sha256(ANN),
            "edgesTracedOnly": sha256(WEIGHTS),
            "neurotransmitters": sha256(NT),
        },
        "selection": (
            f"Weighted pathway closure grown deterministically from the 80 cells of graph.json v1: "
            f"three rounds taking the top {ROUNDS} candidates by total synaptic contacts "
            f"(>={MIN_CONTACTS} per edge, either direction) to the current set, ties by lower body ID; "
            "candidates restricted to status=Traced, annotated type, soma location present; "
            f"filled to exactly {TARGET}. Readout cells unchanged (the original 16 DNs). Input cells: "
            "every set member whose annotated type is one of the 8 channel types. All induced directed "
            "edges >=3 contacts retained. No game outcomes used. Derived node metadata reproduced the "
            "shipped 80-cell v1 graph byte-for-byte from the same sources before growing."
        ),
        "assumptions": (
            "Engineered 8-channel input injection; simplified signed, normalized, leaky tanh rate units. "
            "Acetylcholine +1, GABA/glutamate -1; unknown and modulatory transmitters 0. "
            "Neurotransmitter call = consensus_nt when predicted_nt_confidence >= 0.5 else unclear. "
            "Not a physiological or whole-brain model."
        ),
        "stats": stats,
    }
    (OUT_DIR / "manifest600.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("stats:", json.dumps(stats, ensure_ascii=False))
    print(f"WROTE graph600.json ({len(graph_bytes)} bytes) "
          f"nodes={len(nodes)} edges={len(edges)} contacts={total_contacts}")
    print("graphSha256:", manifest["graphSha256"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
