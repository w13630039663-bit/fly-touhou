# -*- coding: utf-8 -*-
"""沿 r 轴搜索平移 -> 测螺旋的径向扩张/收缩速度。"""
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


def chain(a):
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    white = (R > 210) & (G > 190) & (B > 210)
    purple = (B > 125) & (B > G + 40) & (R > 60) & (R < 240)
    return (white | purple).astype(np.float32)


NR, NT = 200, 360
RMAX = 330.0
rs = np.linspace(0, RMAX, NR)
ts = np.linspace(0, 2 * math.pi, NT, endpoint=False)
RR, TT = np.meshgrid(rs, ts, indexing='ij')
GX = np.clip((CX + RR * np.cos(TT)).astype(np.int32), 0, X1 - X0 - 1)
GY = np.clip((CY + RR * np.sin(TT)).astype(np.int32), 0, Y1 - Y0 - 1)

pol = []
for n in names:
    a = np.asarray(Image.open(os.path.join(SEQ, n)).convert('RGB')).astype(np.float32)
    m = chain(a[Y0:Y1, X0:X1])
    pol.append(m[GY, GX])
pol = np.array(pol)                  # (N, NR, NT)
N = len(pol)
rscale = RMAX / NR                   # px per radial bin

lines = []
def out(s=''):
    print(s); lines.append(s)

# ---- 沿 r 轴搜索最优平移 ----
MAXS = 45                           # ±45 bins = ±74px
out('=== 相邻帧的径向最佳平移（r 轴）===')
out('k  idx   dt(s)   Δr(bin)  Δr(px)  v_r(px/s)  相关')
records = []
for k in range(N - 1):
    A = pol[k] - pol[k].mean()
    B = pol[k + 1] - pol[k + 1].mean()
    na = np.linalg.norm(A); nb = np.linalg.norm(B)
    if na < 1e-6 or nb < 1e-6:
        continue
    best_s, best_c, second = 0, -2.0, -2.0
    for s in range(-MAXS, MAXS + 1):
        Bs = np.roll(B, s, axis=0)          # 沿 r 轴平移
        c = float(np.sum(A * Bs) / (na * np.linalg.norm(Bs)))
        if c > best_c:
            second = best_c; best_c = c; best_s = s
        elif c > second:
            second = c
    dt = durs[idxs[k + 1]] / 1000.0
    dr_px = best_s * rscale
    vr = dr_px / dt
    records.append((k, idxs[k], dt, best_s, dr_px, vr, best_c, best_c - second))
    out(f'{k:3d} {idxs[k]:4d}  {dt:5.3f}  {best_s:+5d}   {dr_px:+7.1f}  {vr:+9.1f}  {best_c:5.2f}')

out()
out('=== 汇总 ===')
if records:
    rel = np.array([r[6] for r in records])
    adv = np.array([r[7] for r in records])
    vrs = np.array([r[5] for r in records])
    good = (adv > 0.02) & (rel > 0.25)
    out(f'  高置信帧对: {good.sum()} / {len(records)}')
    if good.sum() > 3:
        gv = vrs[good]
        out(f'  v_r 中位数 = {np.median(gv):+8.1f} px/s')
        out(f'  v_r 均值   = {gv.mean():+8.1f} px/s')
        out(f'  v_r 范围   = [{gv.min():+.1f}, {gv.max():+.1f}] px/s')
        pos = (gv > 0).sum(); neg = (gv < 0).sum()
        out(f'  方向: 向外(+) {pos} 帧, 向内(-) {neg} 帧')
    # 全部
    out(f'  [全部帧对] v_r 中位数 = {np.median(vrs):+8.1f} px/s, 均值 = {vrs.mean():+8.1f} px/s')

# ---- 用「外缘半径」直接测，不依赖互相关 ----
out()
out('=== 独立验证：链像素的外缘半径 R99 演化 ===')


def r99(a):
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    white = (R > 210) & (G > 190) & (B > 210)
    purple = (B > 125) & (B > G + 40) & (R > 60) & (R < 240)
    m = white | purple
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        return np.nan
    r = np.sqrt((xs - CX) ** 2 + (ys - CY) ** 2)
    return float(np.percentile(r, 99))


r99s = []
for n in names:
    a = np.asarray(Image.open(os.path.join(SEQ, n)).convert('RGB')).astype(np.float32)
    r99s.append(r99(a[Y0:Y1, X0:X1]))
r99s = np.array(r99s)
for k, i in enumerate(idxs):
    out(f'  s{i:04d} t={t0[k]:5.2f}  R99={r99s[k]:7.1f}px')

with open(os.path.join(OUT, '_radial.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n>>> 写入 _radial.txt')
