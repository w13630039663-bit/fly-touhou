# -*- coding: utf-8 -*-
"""独立交叉核对：不经过 build_graph_600.py 的任何逻辑，
直接读三份 feather 源文件，全量核对 graph600.json 的 600 个节点。"""
import json, os
import numpy as np
import pyarrow.feather as feather

D = r'D:\苍蝇\_research\malecns'
g = json.load(open(r'D:\苍蝇\public\data\connectome\graph600.json', encoding='utf-8'))
nodes = g['nodes']

ann = feather.read_table(
    os.path.join(D, 'body-annotations-male-cns-v1.0-minconf-0.5.feather'),
    columns=['bodyId', 'type', 'superclass', 'status', 'somaLocation']).to_pandas()
print('annotations 行数:', len(ann), '| bodyId 唯一:', ann['bodyId'].is_unique)
dup = ann[ann.duplicated('bodyId', keep=False)]
print('重复 bodyId 行数:', len(dup))
ann_m = {}
for r in ann.itertuples(index=False):
    if r.bodyId in ann_m:
        continue
    loc = r.somaLocation
    if loc is None:
        continue
    ann_m[int(r.bodyId)] = (str(r.type), str(r.superclass), str(r.status), list(loc))

nt = feather.read_table(
    os.path.join(D, 'body-neurotransmitters-male-cns-v1.0.feather'),
    columns=['body', 'consensus_nt', 'predicted_nt_confidence']).to_pandas()
print('neurotransmitters 行数:', len(nt), '| body 唯一:', nt['body'].is_unique)
nt_m = {}
for r in nt.itertuples(index=False):
    if r.body in nt_m:
        continue
    name = r.consensus_nt
    if name is None or (isinstance(name, float) and np.isnan(name)):
        nt_m[int(r.body)] = None
        continue
    try:
        conf = float(r.predicted_nt_confidence) if r.predicted_nt_confidence is not None else 0.0
    except Exception:
        conf = 0.0
    nt_m[int(r.body)] = str(name).lower() if conf >= 0.5 else 'unclear'
print('nt map 条目:', len(nt_m))
print()

NT_SIGN = {'acetylcholine': 1, 'gaba': -1, 'glutamate': -1}
CHANNELS = ["LC4", "LC11", "LC9", "LC15", "LC16", "LC17", "LC21", "LPLC2"]

miss_ann = []; miss_nt = []
bad_type = []; bad_pos = []; bad_nt = []; bad_status = []

for n in nodes:
    bid = n['id']
    a = ann_m.get(bid)
    if a is None:
        miss_ann.append(bid)
    else:
        typ, sup, status, loc = a
        if typ != n['type']:
            bad_type.append((bid, n['type'], typ))
        # somaLocation 是微米浮点/整数，graph.json 里存的是 int
        if [int(round(float(x))) for x in loc] != list(n['position']):
            bad_pos.append((bid, n['position'], loc))
        if status != 'Traced':
            bad_status.append((bid, status))
    got_nt = nt_m.get(bid, 'ABSENT')
    if got_nt is None:
        got_nt = 'unclear'
    if got_nt == 'ABSENT':
        miss_nt.append(bid)
        got_nt = 'unclear'
    if got_nt != n['nt']:
        bad_nt.append((bid, n['nt'], got_nt))
    exp_sign = NT_SIGN.get(got_nt, 0)
    if exp_sign != n['sign']:
        bad_nt.append((bid, 'SIGN ' + str(n['sign']), 'SIGN ' + str(exp_sign)))

print('=== 独立核对结果（600 节点全量）===')
print('annotations 中缺失:', len(miss_ann))
print('neurotransmitters 中缺失:', len(miss_nt))
print('status != Traced:', len(bad_status), bad_status[:3])
print('type 不一致:', len(bad_type), bad_type[:3])
print('position(somaLocation) 不一致:', len(bad_pos), bad_pos[:3])
print('nt / sign 不一致:', len(bad_nt), bad_nt[:3])
print()

# 额外：role 是否与 type 推导一致
role_bad = []
for n in nodes:
    is_input = n['type'] in CHANNELS
    exp = 'input' if is_input else ('output' if n['role'] == 'output' else n['role'])
    if n['role'] == 'input' and not is_input:
        role_bad.append((n['id'], n['type']))
    if n['role'] == 'interneuron' and is_input:
        role_bad.append((n['id'], n['type'], 'should be input'))
print('role 与 type 推导矛盾:', len(role_bad), role_bad[:3])

# 8 个通道各有几个输入细胞
from collections import Counter
ch = Counter(n['type'] for n in nodes if n['type'] in CHANNELS)
print('各通道输入细胞数:', dict(ch))

# 输出细胞类型
outs = set(g['outputs'])
gid = [n['id'] for n in nodes]
print('输出细胞 type 分布:', dict(Counter(nodes[i]['type'] for i in outs)))
print()

# 与 v1 manifest 的源哈希声明比对
v1m = json.load(open(r'D:\苍蝇\public\data\connectome\manifest.json', encoding='utf-8'))
print('=== v1 manifest 的源哈希 ===')
print(json.dumps(v1m, ensure_ascii=False, indent=2)[:1200])
