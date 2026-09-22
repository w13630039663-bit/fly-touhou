# -*- coding: utf-8 -*-
"""生成差异可视化：挑出「静止帧对」和「切换帧对」各一组，输出对比图。"""
import os
import numpy as np
from PIL import Image

SEQ = r'D:\苍蝇\experiments\gif_seq'
OUTDIR = r'D:\苍蝇\experiments\gif_analysis'
os.makedirs(OUTDIR, exist_ok=True)

names = sorted([f for f in os.listdir(SEQ) if f.endswith('.png')])
idxs = [int(n[1:5]) for n in names]

arrs = {}
for n in names:
    arrs[n] = np.asarray(Image.open(os.path.join(SEQ, n)).convert('RGB')).astype(np.float32)

diff = []
for k in range(1, len(names)):
    d = np.abs(arrs[names[k]] - arrs[names[k - 1]]).mean()
    diff.append((k, idxs[k - 1], idxs[k], d))
diff.sort(key=lambda x: x[3])
print('差异最小的 8 对（应该是"静止"帧）:')
for k, a, b, d in diff[:8]:
    print(f'  s{a:04d} -> s{b:04d}  mean|diff| = {d:.3f}')
print('差异最大的 8 对（应该是"切换"点）:')
for k, a, b, d in diff[-8:]:
    print(f'  s{a:04d} -> s{b:04d}  mean|diff| = {d:.3f}')

# 生成拼图：最小差异对 & 最大差异对（只挑已导出的帧）
avail = set(idxs)
def pick(pairs, reverse=False):
    for k, a, b, d in (reversed(pairs) if reverse else pairs):
        if a in avail and b in avail:
            return (k, a, b, d)
    return None

def make_compare(ka, kb, tag):
    A = arrs[f's{ka:04d}.png'].astype(np.uint8)
    B = arrs[f's{kb:04d}.png'].astype(np.uint8)
    D = np.abs(A.astype(np.float32) - B.astype(np.float32)).mean(axis=2)
    Dv = np.clip(D * 3, 0, 255).astype(np.uint8)
    Dv = np.stack([Dv] * 3, axis=2)
    h, w, _ = A.shape
    canvas = np.zeros((h, w * 3 + 20, 3), dtype=np.uint8)
    canvas[:, :w] = A
    canvas[:, w + 10:2 * w + 10] = B
    canvas[:, 2 * w + 20:] = Dv
    Image.fromarray(canvas).save(os.path.join(OUTDIR, f'compare_{tag}.png'))
    return D.mean()

small = pick(diff, reverse=False)
big = pick(diff, reverse=True)
m1 = make_compare(small[1], small[2], 'static')
m2 = make_compare(big[1], big[2], 'switch')
with open(os.path.join(OUTDIR, '_visual.txt'), 'w', encoding='utf-8') as f:
    f.write(f'最小差异对: s{small[1]:04d} -> s{small[2]:04d}  mean|diff|={m1:.3f}\n')
    f.write(f'最大差异对: s{big[1]:04d} -> s{big[2]:04d}  mean|diff|={m2:.3f}\n')
    f.write(f'\n差异比 (max/min) = {m2/m1:.2f}x\n')
print('\n拼图已生成: compare_static.png / compare_switch.png')
