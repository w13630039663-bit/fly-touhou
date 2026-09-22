# -*- coding: utf-8 -*-
"""交叉验证 v1 边表 + 检查全部 graph/checkpoint 的拓扑自洽性。"""
import json, os, hashlib
from collections import Counter
import numpy as np
import pyarrow.feather as feather

PUB = r'D:\苍蝇\public\data'
D = r'D:\苍蝇\_research\malecns'

def sha_file(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()

# ---------- 1. v1 graph.json 与源 traced-only 的边交叉验证 ----------
g80 = json.load(open(os.path.join(PUB, 'connectome', 'graph.json'), encoding='utf-8'))
ids = [n['id'] for n in g80['nodes']]
pos = {b: i for i, b in enumerate(ids)}
wt = feather.read_table(os.path.join(D, 'connectome-weights-male-cns-v1.0-minconf-0.5-traced-only.feather'),
                        columns=['body_pre', 'body_post', 'weight'])
pre = wt['body_pre'].to_numpy(zero_copy_only=False)
post = wt['body_post'].to_numpy(zero_copy_only=False)
w = wt['weight'].to_numpy(zero_copy_only=False)
s = set(ids)
mask = np.isin(pre, list(s)) & np.isin(post, list(s))
sp, sq, sw = pre[mask], post[mask], w[mask]
print('=== v1 边交叉验证 ===')
print('graph.json 边数:', len(g80['edges']), '| 源中该 80 子集内边数:', len(sp), '(未过滤接触数阈值)')
src = {}
for a, b, c in zip(sp, sq, sw):
    src[(int(a), int(b))] = int(c)
ok = 0; bad = []; extra = []
for a, b, c in g80['edges']:
    key = (ids[a], ids[b])
    if key in src:
        if src[key] == c:
            ok += 1
        else:
            bad.append((key, c, src[key]))
    else:
        extra.append((key, c))
print('逐边接触数完全一致:', ok, '/', len(g80['edges']))
print('接触数不符:', len(bad), bad[:3])
print('源中找不到的边:', len(extra), extra[:3])
# 反向：源里有 >=3 接触的边是否都被收录
src_ge3 = {k: v for k, v in src.items() if v >= 3 and k[0] != k[1]}
print('源中 >=3 接触无自环的边:', len(src_ge3), '| graph.json 收录:', len(g80['edges']))
missing = [k for k in src_ge3 if k not in {(ids[a], ids[b]) for a, b, c in g80['edges']}]
print('源中有但 graph 未收录:', len(missing), missing[:3])
print()
print('v1 graph.json 实际 sha256 :', sha_file(os.path.join(PUB, 'connectome', 'graph.json')))
print('v1 manifest 声称           :', json.load(open(os.path.join(PUB, 'connectome', 'manifest.json'), encoding='utf-8'))['graphSha256'])
print()

# ---------- 2. 各 graph 文件的角色/规模摘要 ----------
print('=== 全部 graph 文件摘要 ===')
for fn in ['graph.json', 'graph600.json', 'graph600a.json', 'graph600b.json']:
    p = os.path.join(PUB, 'connectome', fn)
    g = json.load(open(p, encoding='utf-8'))
    rc = Counter(n['role'] for n in g['nodes'])
    tot = sum(e[2] for e in g['edges'])
    print(f'{fn:18} nodes={len(g["nodes"]):5} edges={len(g["edges"]):7,} contacts={tot:>10,} '
          f'inputs={len(g["inputs"]):3} outputs={len(g["outputs"]):3} '
          f'roles={dict(rc)} sizes={os.path.getsize(p):,}')
    print(f'{"":18} keys={list(g.keys())}')
print()

# ---------- 3. 600 家族是否同边集 ----------
def edge_set(fn):
    g = json.load(open(os.path.join(PUB, 'connectome', fn), encoding='utf-8'))
    ids = [n['id'] for n in g['nodes']]
    ncol = len(g['edges'][0])
    e = {(ids[r[0]], ids[r[1]]): tuple(r[2:]) for r in g['edges']}
    return e, ids, ncol, g
e600, id600, nc600, gg600 = edge_set('graph600.json')
print('graph600 边列数:', nc600, '示例:', gg600['edges'][0])
print('graph600 derived keys:', list(gg600.get('derived', {}).keys()) if 'derived' in gg600 else None)
print()
for fn in ['graph600a.json', 'graph600b.json']:
    e, ii, nc, gg = edge_set(fn)
    print(f'{fn}: 边列数={nc} 节点序同600={ii == id600} 边集完全相同={e == e600} 差集={len(set(e) ^ set(e600))}')
    print(f'   示例边: {gg["edges"][0]}')
    print(f'   derived: {json.dumps(gg.get("derived", {}), ensure_ascii=False)[:500]}')
print()

# ---------- 4. checkpoint 拓扑守卫 ----------
print('=== checkpoint 拓扑守卫 ===')
m600 = json.load(open(os.path.join(PUB, 'connectome', 'manifest600.json'), encoding='utf-8'))
m600a = json.load(open(os.path.join(PUB, 'connectome', 'manifest600a.json'), encoding='utf-8'))
m600b = json.load(open(os.path.join(PUB, 'connectome', 'manifest600b.json'), encoding='utf-8'))
m80 = json.load(open(os.path.join(PUB, 'connectome', 'manifest.json'), encoding='utf-8'))
known = {m80['graphSha256']: 'v1(80)', m600['graphSha256']: 'v600',
         m600a.get('graphSha256'): 'v600a', m600b.get('graphSha256'): 'v600b'}
for fn in sorted(os.listdir(PUB)):
    if not fn.startswith('checkpoint') or not fn.endswith('.json'):
        continue
    p = os.path.join(PUB, fn)
    c = json.load(open(p, encoding='utf-8'))
    topo = c.get('topology', {})
    gs = topo.get('graphSha256') or topo.get('graph')
    bm = c.get('benchmark', {})
    ro = bm.get('originalRun', {}) if isinstance(bm, dict) else {}
    re_ = bm.get('reeval', {}) if isinstance(bm, dict) else {}
    print(f'{fn:24} {os.path.getsize(p):>7,}B  topo={str(gs)[:12]}.. -> {known.get(gs, "UNKNOWN")}')
    print(f'{"":24} nodes={topo.get("nodes")} edges={topo.get("edges")} contacts={topo.get("contacts")}')
    if ro: print(f'{"":24} originalRun: trained={ro.get("trained")} silenced={ro.get("circuitSilenced")} idle={ro.get("idle")}')
    if re_: print(f'{"":24} reeval: {json.dumps(re_, ensure_ascii=False)[:220]}')
print()

# ---------- 5. manifest600a/b 的差异 ----------
print('=== manifest600a / 600b ===')
for name, m in [('manifest600a', m600a), ('manifest600b', m600b)]:
    print(f'--- {name} ---')
    diff = {k: v for k, v in m.items() if m600.get(k) != v and k not in ('stats',)}
    print(json.dumps(diff, ensure_ascii=False, indent=2)[:1400])
    print()
