# -*- coding: utf-8 -*-
"""连通域提取珠子 + 区分螺旋链/下落幕 + 螺旋几何拟合"""
import numpy as np
from PIL import Image
from collections import deque
import os, math

FR = r'D:\苍蝇\experiments\gif_seq\s0085.png'
OUT = r'D:\苍蝇\experiments\gif_analysis'
CX, CY = 417.0, 310.0          # 前面检测到的光晕中心

img = Image.open(FR).convert('RGB')
A = np.asarray(img).astype(np.int16)
H, W, _ = A.shape
R, G, B = A[:, :, 0], A[:, :, 1], A[:, :, 2]

lum = np.minimum(np.minimum(R, G), B)
mask = lum > 200
print('mask px =', mask.sum())

# --- 4连通域 BFS ---
lab = np.zeros((H, W), np.int32)
comps = []
cur = 0
ys, xs = np.nonzero(mask)
visited = np.zeros((H, W), bool)
for y0, x0 in zip(ys, xs):
    if visited[y0, x0]:
        continue
    cur += 1
    q = deque([(y0, x0)])
    visited[y0, x0] = True
    pts = []
    while q:
        y, x = q.popleft()
        pts.append((y, x))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))
    comps.append(pts)

print('components =', len(comps))
areas = np.array([len(c) for c in comps])
print('area 分位:', [int(np.percentile(areas, q)) for q in (5, 25, 50, 75, 90, 95, 99)], 'max', areas.max())

# --- 过滤：珠子面积范围 ---
beads = []
for pts in comps:
    n = len(pts)
    if n < 25 or n > 900:
        continue
    ys_ = np.array([p[0] for p in pts]); xs_ = np.array([p[1] for p in pts])
    cy, cx = ys_.mean(), xs_.mean()
    # 形状检查：接近圆形（bbox 长宽接近）
    bh = ys_.max() - ys_.min() + 1
    bw = xs_.max() - xs_.min() + 1
    if bh <= 0 or bw <= 0:
        continue
    ratio = max(bh, bw) / max(1, min(bh, bw))
    if ratio > 1.8:
        continue
    # 环带紫色检测：半径 10~20 的环内是否有明显紫
    purple = 0; tot = 0
    r0, r1 = 9, 19
    for dy in range(-r1, r1 + 1):
        for dx in range(-r1, r1 + 1):
            dd = math.hypot(dx, dy)
            if not (r0 <= dd <= r1):
                continue
            yy, xx = int(cy) + dy, int(cx) + dx
            if not (0 <= yy < H and 0 <= xx < W):
                continue
            tot += 1
            if R[yy, xx] > 140 and B[yy, xx] > 130 and G[yy, xx] < R[yy, xx] - 45:
                purple += 1
    pr = purple / max(1, tot)
    beads.append((cx, cy, n, ratio, pr))

print('候选珠子 =', len(beads))
prs = np.array([b[4] for b in beads])
print('紫环占比分位:', [round(float(np.percentile(prs, q)), 3) for q in (5, 25, 50, 75, 95)])

# --- 分类 ---
spiral = [b for b in beads if b[4] > 0.25]
fall = [b for b in beads if b[4] <= 0.25]
print(f'\n螺旋链珠 = {len(spiral)}   下落幕/其他 = {len(fall)}')

np.save(os.path.join(OUT, '_spiral_beads.npy'), np.array([(b[0], b[1]) for b in spiral]))
np.save(os.path.join(OUT, '_fall_beads.npy'), np.array([(b[0], b[1]) for b in fall]))

rs = np.array([math.hypot(b[0] - CX, b[1] - CY) for b in spiral])
ths = np.array([math.atan2(b[1] - CY, b[0] - CX) for b in spiral])
print('螺旋 r: min=%.1f max=%.1f median=%.1f' % (rs.min(), rs.max(), np.median(rs)))

# --- 螺旋拟合: r 与 (theta 累积) 的关系 ---
# 对阿基米德螺旋 r = a + b*theta_abs, theta_abs = theta + 2*pi*n
# 做法：按 r 分 bin，统计该 bin 内的 theta 集合，检验顺序性
order = np.argsort(rs)
print('\n--- 按 r 排序的 (r, theta) 采样 ---')
for i in range(0, len(order), max(1, len(order) // 45)):
    k = order[i]
    print(f'   r={rs[k]:7.1f}  theta={math.degrees(ths[k]):8.2f}')

# --- 相邻珠子间距（最近邻）---
pts = np.array([(b[0], b[1]) for b in spiral])
from math import hypot
nn = []
for i, (x, y) in enumerate(pts):
    dd = np.hypot(pts[:, 0] - x, pts[:, 1] - y)
    dd[i] = 1e9
    j = int(np.argmin(dd))
    nn.append((hypot(x - CX, y - CY), dd[j]))
nn.sort()
print('\n--- 最近邻距离 vs 半径 ---')
arr = np.array(nn)
for lo in range(0, 600, 50):
    sel = arr[(arr[:, 0] >= lo) & (arr[:, 0] < lo + 50)]
    if len(sel):
        print(f'  r {lo:3d}-{lo+50:3d}: n={len(sel):4d}  NN中位={np.median(sel[:,1]):6.1f}  均值={sel[:,1].mean():6.1f}')
