# -*- coding: utf-8 -*-
"""
不依赖帧间配对的宏观测量法。

物理观测：相邻帧变化过大 -> 逐帧互相关失效。
改用：整段序列的宏观演化趋势。

A. 螺旋扩张速度：追踪「链掩码」的最外半径 R95(t)，线性拟合得 dR/dt。
B. 发射/生成周期：链掩码面积 A(t) 与 R95(t) 的去趋势 + 自相关。
C. 下落幕速度：对「屏幕下方 30%」区域的链像素质心 y(t) 做线性拟合。
D. 子弹表观速度：由螺旋几何（臂间距 × 角速度）推算。
"""
import os, math
import numpy as np
from PIL import Image

SEQ = r'D:\苍蝇\experiments\gif_seq'
OUT = r'D:\苍蝇\experiments\gif_analysis'

# 帧时长（从原 GIF 读，与 seq 一致）
SRC = r'D:\苍蝇\experiments\QQ20260914-231559.gif'
im = Image.open(SRC)
durs = {}
for i in range(im.n_frames):
    im.seek(i)
    durs[i] = im.info.get('duration', 70)

Y0, Y1 = 80, 900
X0, X1 = 12, 800
CX = (X0 + X1) / 2.0
CY = (Y0 + Y1) / 2.0

names = sorted([f for f in os.listdir(SEQ) if f.endswith('.png')])
idxs = [int(n[1:5]) for n in names]
print('帧数:', len(idxs), idxs[0], '~', idxs[-1])

# 累积时间轴
t_axis = []
acc = 0.0
for i in idxs:
    acc += durs[i] / 1000.0
    t_axis.append(acc)
t_axis = np.array(t_axis)
t0 = t_axis - t_axis[0]


def chain(a):
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    white = (R > 210) & (G > 190) & (B > 210)
    purple = (B > 125) & (B > G + 40) & (R > 60) & (R < 240)
    return (white | purple)


areas, r95, rmax_r = [], [], []
ycen_lower = []
for n in names:
    p = os.path.join(SEQ, n)
    a = np.asarray(Image.open(p).convert('RGB')).astype(np.float32)
    sub = a[Y0:Y1, X0:X1]
    m = chain(sub)
    areas.append(float(m.sum()))
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        r95.append(0.0); rmax_r.append(0.0); ycen_lower.append(np.nan)
        continue
    dx = xs - CX; dy = ys - CY
    r = np.sqrt(dx * dx + dy * dy)
    r95.append(float(np.percentile(r, 95)))
    rmax_r.append(float(r.max()))
    # 下方 30% 区域的链质心
    ysplit = (Y1 - Y0) * 0.70
    sel = ys > ysplit
    ycen_lower.append(float(ys[sel].mean()) if sel.sum() > 50 else np.nan)

areas = np.array(areas); r95 = np.array(r95); rmax_r = np.array(rmax_r)
ycen = np.array(ycen_lower)

lines = []
def out(s=''):
    print(s); lines.append(s)

out('=== 逐帧宏观量 ===')
out('idx  t(s)   dur  area(Kpx)  r95(px)  rmax(px)  ycen_lower')
for k, i in enumerate(idxs):
    out(f'{i:4d} {t0[k]:5.2f} {durs[i]:4d}   {areas[k]/1000:7.1f}  '
        f'{r95[k]:7.1f}  {rmax_r[k]:7.1f}   {ycen[k] if not np.isnan(ycen[k]) else -1:7.1f}')

# ---- A. 螺旋扩张：r95 vs t 线性拟合（取上升段）----
out()
out('=== A. 螺旋外缘扩张速度（r95 ~ t 线性拟合）===')
# 自动找上升段：r95 单调上升超过 60px 的连续区间
best = None
for s in range(len(r95)):
    for e in range(s + 8, min(s + 60, len(r95))):
        seg = r95[s:e]
        if seg[-1] - seg[0] < 60:
            break
        d = np.polyfit(t0[s:e], seg, 1)
        resid = np.std(seg - np.polyval(d, t0[s:e]))
        score = d[0] - resid * 0.05
        if best is None or score > best[0]:
            best = (score, s, e, d, resid)
if best:
    _, s, e, d, resid = best
    out(f'  区间 frames {idxs[s]}~{idxs[e-1]}  (t={t0[s]:.2f}~{t0[e-1]:.2f}s, 跨度 {t0[e-1]-t0[s]:.2f}s)')
    out(f'  dR95/dt = {d[0]:+.1f} px/s   (拟合残差 std={resid:.1f}px)')
    out(f'  r95: {r95[s]:.1f} -> {r95[e-1]:.1f} px')

# 全局也来一个
d_all = np.polyfit(t0, r95, 1)
out(f'  全局拟合 dR95/dt = {d_all[0]:+.1f} px/s')

# ---- B. 周期性（自相关）----
out()
out('=== B. 生成周期（去趋势后自相关）===')
for label, series in [('area', areas), ('r95', r95)]:
    x = series.astype(np.float64)
    x = x - np.polyval(np.polyfit(t0, x, 2), t0)      # 去二次趋势
    x = x / (np.std(x) + 1e-9)
    N = len(x)
    ac = []
    for lag in range(1, N // 2):
        ac.append((lag, float(np.dot(x[:-lag], x[lag:]) / (N - lag))))
    peaks = [(lag, v) for lag, v in ac[1:-1]
             if v > ac[lag - 1][1] and v > ac[lag + 1][1] and v > 0.05]
    peaks.sort(key=lambda kv: -kv[1])
    out(f'  [{label}] top自相关峰:')
    for lag, v in peaks[:5]:
        out(f'     lag={lag} 帧  相关性={v:+.3f}  对应时间跨度={t0[lag]-t0[0]:+.2f}s')

# ---- C. 下落幕速度 ----
out()
out('=== C. 下方区域链质心下落（ycen ~ t）===')
valid = ~np.isnan(ycen)
if valid.sum() > 10:
    d = np.polyfit(t0[valid], ycen[valid], 1)
    out(f'  全局 dYc/dt = {d[0]:+.1f} px/s  (N={valid.sum()})')
    # 分段
    for s in range(0, len(t0), 20):
        e = min(s + 20, len(t0))
        v = valid[s:e]
        if v.sum() > 8:
            dd = np.polyfit(t0[s:e][v], ycen[s:e][v], 1)
            out(f'    帧{idxs[s]:4d}~{idxs[e-1]:4d}: dy/dt={dd[0]:+8.1f} px/s')

with open(os.path.join(OUT, '_macro.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n>>> 写入 _macro.txt')
