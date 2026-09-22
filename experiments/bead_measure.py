# -*- coding: utf-8 -*-
"""从实战帧中提取白色珠子质心，测量螺旋几何"""
import numpy as np
from PIL import Image
import os, math

FR = r'D:\苍蝇\experiments\gif_seq\s0085.png'
OUT = r'D:\苍蝇\experiments\gif_analysis'
os.makedirs(OUT, exist_ok=True)


def report(*a):
    print(*a)


img = Image.open(FR).convert('RGB')
A = np.asarray(img).astype(np.int16)
H, W, _ = A.shape
report('frame size', W, 'x', H)

R, G, B = A[:, :, 0], A[:, :, 1], A[:, :, 2]
# 白珠中心判据：三通道都高
lum = np.minimum(np.minimum(R, G), B)

# 局部极大值（5x5）替代连通域
def local_max(m, rad=3):
    mx = m.copy()
    for dy in range(-rad, rad + 1):
        for dx in range(-rad, rad + 1):
            if dx == 0 and dy == 0:
                continue
            mx = np.maximum(mx, np.roll(np.roll(m, dy, 0), dx, 1))
    return m >= mx

for thr in (200, 215, 230, 240):
    mask = lum > thr
    peaks = mask & local_max(lum, 3)
    ys, xs = np.nonzero(peaks)
    report(f'  thr={thr}: white px={mask.sum():7d}  peaks={len(xs)}')

THR = 230
mask = lum > THR
peaks = mask & local_max(lum, 3)
ys, xs = np.nonzero(peaks)
report(f'\nusing thr={THR}: {len(xs)} centers')

# 估计螺旋中心 = 粉色光晕质心（R高 G低 B高 的大块）
core_mask = (R > 180) & (B > 150) & (G < R - 30)
# 只取中间区域
core_mask[:150, :] = False
core_mask[900:, :] = False
cy, cx = None, None
if core_mask.sum() > 500:
    yy, xx = np.nonzero(core_mask)
    # 用中位数抗异常
    cx, cy = float(np.median(xx)), float(np.median(yy))
    report(f'core glow centroid (median) = ({cx:.1f}, {cy:.1f})  px={core_mask.sum()}')

# 若检测失败，用图中估计值
if cx is None:
    cx, cy = 400.0, 290.0
    report('core detect failed -> fallback', cx, cy)

# 计算每颗珠子的 r, theta（y 向下 -> theta 顺时针）
d = []
for x, y in zip(xs, ys):
    dx = x - cx
    dy = y - cy
    r = math.hypot(dx, dy)
    th = math.atan2(dy, dx)
    d.append((r, th, x, y))
d.sort()
rs = np.array([t[0] for t in d])

report(f'\nr 分布: min={rs.min():.1f} max={rs.max():.1f} mean={rs.mean():.1f} median={np.median(rs):.1f}')
report('r 分位:', [round(float(np.percentile(rs, q)), 1) for q in (5, 25, 50, 75, 90, 95, 99)])

# 半径直方图（看螺旋是否是离散圈）
hist, edges = np.histogram(rs, bins=40, range=(0, rs.max()))
report('\n半径直方图 (bin=%.1fpx):' % (edges[1] - edges[0]))
for i, h in enumerate(hist):
    bar = '#' * int(h / max(1, hist.max()) * 50)
    report(f'  {edges[i]:6.0f}-{edges[i+1]:6.0f} {h:5d} {bar}')

# 只保留螺旋链（排除下落幕：下落幕在下方且更暗/青色）
# 用 bbox 内的珠子
report('\n全部 %d 颗珠子的极坐标列表（按 r 排序，每 10 颗取 1）:' % len(d))
for i in range(0, len(d), max(1, len(d) // 40)):
    r, th, x, y = d[i]
    report(f'   r={r:7.1f}  th={math.degrees(th):8.2f}deg  ({x},{y})')

np.save(os.path.join(OUT, '_beads.npy'), np.array([(t[2], t[3]) for t in d]))
with open(os.path.join(OUT, '_beads.txt'), 'w', encoding='utf-8') as f:
    f.write(f'center=({cx},{cy})\n')
    f.write(f'count={len(d)}\n')
    for t in d:
        f.write(f'{t[0]:.3f}\t{t[1]:.6f}\t{t[2]}\t{t[3]}\n')
report('\n-> _beads.txt / _beads.npy written')
