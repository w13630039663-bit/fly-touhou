# -*- coding: utf-8 -*-
"""联合扫描 (臂数 N, 螺旋斜率 b)，用相位集中度相对均匀基线的倍数定标"""
import numpy as np, math, os

OUT = r'D:\苍蝇\experiments\gif_analysis'
bp = np.load(os.path.join(OUT, '_spiral_beads.npy'))
CX, CY = 417.0, 310.0
xe, ye = bp[:, 0] - CX, bp[:, 1] - CY
th = np.arctan2(ye, xe)
r = np.hypot(xe, ye)
BW = 3.0

def concentration(b, thx):
    P = 2 * math.pi * b
    if P < 6 * BW:
        return 0.0, 0
    ph = (r - b * thx) % P
    nb = int(P / BW)
    h, _ = np.histogram(ph, bins=nb, range=(0, P))
    f = h / h.sum()
    return f.max() / (1.0 / nb), nb      # 相对均匀基线的倍数

print('=== 联合扫描: 臂数 N × 螺旋斜率 b ===')
print(f'{"N":>3} {"best b":>8} {"螺距GIF":>9} {"螺距game":>9} {"v(gif)":>8} {"v(game)":>8} {"倍数":>7}  {"bins":>5}')
rows = []
for N in (1, 2, 3, 4, 5, 6, 8, 10):
    thx = th % (2 * math.pi / N)
    best = (0, 0, 0)
    for b in np.arange(2.0, 120.0, 0.02):
        c, nb = concentration(b, thx)
        if c > best[0]:
            best = (c, b, nb)
    c, b, nb = best
    P = 2 * math.pi * b
    vg = b * 0.121767          # px/frame (gif)
    rows.append((c, N, b, P, vg, nb))
    print(f'{N:3d} {b:8.2f} {P:9.1f} {P/2.1146:9.1f} {vg:8.3f} {vg/2.1146:8.4f} {c:7.2f}  {nb:5d}')

rows.sort(reverse=True)
print('\n>>> 最强候选:')
for c, N, b, P, vg, nb in rows[:4]:
    print(f'   N={N}  b={b:.2f}px/rad  螺距={P:.1f}GIF({P/2.1146:.1f}game)  '
          f'v={vg/2.1146:.4f}game px/f  集中度倍数={c:.2f}')

# 输出最佳组合的散点图
c, N, b, P, vg, nb = rows[0]
thx = th % (2 * math.pi / N)
from PIL import Image, ImageDraw
W, Hh = 900, 620
img = Image.new('RGB', (W, Hh), (10, 10, 16))
d = ImageDraw.Draw(img)
for i in range(0, W, 30):
    d.line([(i, 0), (i, Hh)], fill=(26, 26, 34))
for j in range(0, Hh, 40):
    d.line([(0, j), (W, j)], fill=(26, 26, 34))
RMAX = 500.0
for rr, tt in zip(r, thx):
    x = int((math.degrees(tt)) / (360.0 / N) * (W - 1))
    y = int((1 - rr / RMAX) * (Hh - 1))
    d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 120, 255))
# 叠加拟合直线
for k in range(0, N + 2):
    pts = []
    for i in range(W):
        tdeg = i / (W - 1) * (360.0 / N)
        rv = b * math.radians(tdeg) + k * P
        yy = int((1 - rv / RMAX) * (Hh - 1))
        if 0 <= yy < Hh:
            pts.append((i, yy))
    if len(pts) > 1:
        d.line(pts, fill=(120, 255, 170), width=1)
img.save(os.path.join(OUT, 'fit_best_N%d.png' % N))
print(f'\n-> fit_best_N{N}.png')
