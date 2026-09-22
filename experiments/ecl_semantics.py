# -*- coding: utf-8 -*-
"""统计 stage02.ecl 中 ins_5xx 家族的用法，推断语义"""
import re, collections

p = r'D:\苍蝇\experiments\th12_extract\stage02.txt'
lines = open(p, encoding='utf-8', errors='replace').read().split('\n')

# 提取所有 ins_NNN(...) 出现
call_re = re.compile(r'(ins_(\d+))\s*\(([^;]*?)\)\s*;')
occ = collections.defaultdict(list)          # op -> [args]
ctx = collections.defaultdict(collections.Counter)  # op -> Counter(next_op within 3 lines)

flat = []
for i, l in enumerate(lines):
    stripped = l.strip()
    m = call_re.fullmatch(stripped)
    if m:
        op = m.group(1); args = m.group(3)
        occ[op].append((i, args))
        flat.append((i, op, args))

print('=== ins_5xx 出现次数（降序）===')
for op, v in sorted(occ.items(), key=lambda x: -len(x[1])):
    if op.startswith('ins_5'):
        print(f'  {op:10} x{len(v):4}')

print()
print('=== 关键 ins 的参数样本 ===')
for op in ['ins_500','ins_501','ins_502','ins_503','ins_504','ins_507','ins_509','ins_521','ins_522','ins_524']:
    v = occ.get(op, [])
    if not v:
        print(f'  {op:10} <absent>')
        continue
    uniq = collections.Counter(a for _, a in v)
    print(f'  {op:10} x{len(v):4}  唯一签名 {len(uniq):3}')
    for a, c in uniq.most_common(6):
        print(f'        x{c:<4} ({a})')

print()
print('=== ins_501 前 3 行的指令（发射前的设置序列）===')
seqs = collections.Counter()
idx_of_501 = [i for i, op, _ in flat if op == 'ins_501']
prev = {i: (op, a) for i, op, a in flat}
# 建立行号->索引映射
line2pos = {i: k for k, (i, op, a) in enumerate(flat)}
for li in idx_of_501:
    k = line2pos[li]
    window = tuple(op for _, op, _ in flat[max(0, k-4):k+1])
    seqs[window] += 1
for s, c in seqs.most_common(8):
    print(f'  x{c:<4} {" -> ".join(s)}')

print()
print('=== ins_524 与 ins_504 是否总是成对出现在 ins_501 之前 ===')
for li in idx_of_501[:12]:
    k = line2pos[li]
    wins = []
    for j in range(max(0, k-5), k+1):
        wins.append(flat[j][1] + '(' + flat[j][2][:40] + ')')
    print(f'  @{lines[li].strip()[:30]}')
    for w in wins: print('       ', w)
