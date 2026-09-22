# -*- coding: utf-8 -*-
"""
局部光流：对画面分区（扇形 + 环带），每区单独测径向位移。
放射状/螺旋运动下，全局相位相关会因方向相消而归零，
必须按区域分别测量。

方法：
  1. 极坐标重采样。
  2. 对每个 (r 环带, θ 扇区) 小格，做相邻帧的局部互相关 -> 局部位移。
  3. 把局部位移投影到径向/切向，得到 v_r 和 v_θ。
"""
import os, math
import numpy as np
from PIL import Image

SEQ = r'D:\苍蝇\experiments\gif_seq'
OUT = r'D:\苍蝇\experiments\gif_analysis'
SRC = r'D:\苍蝇\experiments\QQ20260914-231559.gif'

im = Image.open(SRC)
durs = {}
for i in range(im.n_frames):
    im.seek(i); durs[i] = im.info.get('duration', 70)

Y0, Y1 = 80, 900
X0, X1 = 12, 800
CX = (X0 + X1) / 2.0
CY = (Y0 + Y1) / 2.0

names = sorted([f for f in os.listdir(SEQ) if f.endswith('.png')])
idxs = [int(n[1:5]) for n in names]
t0, acc = [], 0.0
for i in idxs:
    acc += durs[i] / 1000.0; t0.append(acc)
t0 = np.array(t0); t0 -= t0[0]

gray = {}
for n in names:
    gray[n] = np.asarray(Image.open(os.path.join(SEQ, n)).convert('L')).astype(np.float32)[Y0:Y1, X0:X1]

lines = []
def out(s=''):
    print(s); lines.append(s)


def local_shift(A, B, bx, by, bw, bh, srch=14):
    """在 A 的 (bx,by,bw,bh) 窗口，在 B 中搜索最佳匹配，返回 (dx,dy,score)。"""
    h, w = A.shape
    tpl = A[by:by + bh, bx:bx + bw]
    if tpl.shape != (bh, bw):
        return None
    best = (0, 0, 1e18)
    for dy in range(-srch, srch + 1):
        for dx in range(-srch, srch + 1):
            yy, xx = by + dy, bx + dx
            if yy < 0 or xx < 0 or yy + bh > h or xx + bw > w:
                continue
            cand = B[yy:yy + bh, xx:xx + bw]
            s = float(np.abs(cand - tpl).mean())
            if s < best[2]:
                best = (dx, dy, s)
    return best


out('【局部光流：分区测量放射状运动】')
out('把游戏区按极坐标分成 3 个环带 × 4 个象限，每格独立测位移')
out()

nr_bands = [(60, 180), (180, 320), (320, 480)]
quads = [(-180, -90), (-90, 0), (0, 90), (90, 180)]   # 角度范围（度）

# 先算每个环带的金字塔平均（提高信噪比）
for (r0, r1) in nr_bands:
    out(f'--- 环带 r={r0}~{r1}px ---')
    for (a0, a1) in quads:
        # 该象限的像素位置
        dxs, dys, vs = [], [], []
        for k in range(1, len(names)):
            A = gray[names[k - 1]]
            B = gray[names[k]]
            # 取该象限内若干采样点做局部匹配
            found = []
            for rr in np.linspace(r0, r1, 4):
                for aa in np.linspace(math.radians(a0), math.radians(a1), 6):
                    x = int(CX + rr * math.cos(aa)) - 12
                    y = int(CY + rr * math.sin(aa)) - 12
                    if x < 0 or y < 0 or x + 24 >= A.shape[1] or y + 24 >= A.shape[0]:
                        continue
                    r = local_shift(A, B, x, y, 24, 24, srch=12)
                    if r and r[2] < 30:
                        found.append(r)
            if found:
                mdx = float(np.median([f[0] for f in found]))
                mdy = float(np.median([f[1] for f in found]))
                dt = durs[idxs[k]] / 1000.0
                dxs.append(mdx); dys.append(mdy)
                # 投影到径向
                mid_a = math.radians((a0 + a1) / 2)
                vr = (mdx * math.cos(mid_a) + mdy * math.sin(mid_a)) / dt
                vs.append(vr)
        if vs:
            V = np.array(vs)
            out(f'  象限 {a0:+4d}~{a1:+4d}°: N={len(V):3d}  '
                f'v_r 中位={np.median(V):+8.1f} px/s  '
                f'均值={V.mean():+8.1f} px/s')
        else:
            out(f'  象限 {a0:+4d}~{a1:+4d}°: 无有效匹配')

with open(os.path.join(OUT, '_localflow.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n>>> 写入 _localflow.txt')
