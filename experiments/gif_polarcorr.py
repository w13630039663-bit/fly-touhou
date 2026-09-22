# -*- coding: utf-8 -*-
"""
终极方案：把整幅极坐标图当成「螺旋签名」，做 2D 平移搜索。

螺旋在极坐标 (r, θ) 下是斜线！因此：
  螺旋转动 Δθ  ==  极坐标图沿 θ 轴平移 Δθ
  螺旋扩张       ==  沿 r 轴平移
  同心圆弧       ==  水平线（沿 θ 平移不变 -> 对它们的互相关无贡献）

于是对极坐标图做 **沿 θ 轴的最佳平移搜索**，只统计 r 方向上
梯度大的行（即螺旋斜线所在处），就能稳健地测出转动。

关键改进：
  1. 只保留「螺旋斜线」特征：对极坐标图求 r 方向梯度，取 |grad| 大者。
  2. 沿 θ 搜索平移量，允许帧间大位移（maxshift 覆盖整圈）。
  3. 用「相邻帧对」的多数投票 + 全局最小二乘拟合得到 ω。
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


def chain(a):
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    white = (R > 210) & (G > 190) & (B > 210)
    purple = (B > 125) & (B > G + 40) & (R > 60) & (R < 240)
    return (white | purple).astype(np.float32)


NR, NT = 160, 720          # r 步长 ~2px, θ 步长 0.5°
RMAX = 330.0
rs = np.linspace(0, RMAX, NR)
ts = np.linspace(0, 2 * math.pi, NT, endpoint=False)
RR, TT = np.meshgrid(rs, ts, indexing='ij')
GX = (CX + RR * np.cos(TT)).astype(np.int32)
GY = (CY + RR * np.sin(TT)).astype(np.int32)

pol = []
for n in names:
    a = np.asarray(Image.open(os.path.join(SEQ, n)).convert('RGB')).astype(np.float32)
    m = chain(a[Y0:Y1, X0:X1])
    np.clip(GX, 0, X1 - X0 - 1, out=GX)
    np.clip(GY, 0, Y1 - Y0 - 1, out=GY)
    pol.append(m[GY, GX])
pol = np.array(pol)        # (Nframes, NR, NT)
N = len(pol)

# ---- 提取「螺旋斜线」特征：r 方向梯度显著的行 ----
# 对每帧算 r 方向梯度绝对值，沿时间+θ 求平均，得到每个 r 的特征强度
grad_r = np.abs(np.diff(pol, axis=1))          # (N, NR-1, NT)
feat_strength = grad_r.mean(axis=(0, 2))       # (NR-1,)
# 同时，同心圆弧在 θ 方向是平的，螺旋斜线在 θ 方向有梯度
grad_t = np.abs(np.diff(pol, axis=2))          # (N, NR, NT-1)
feat_t = grad_t.mean(axis=(0, 2))              # (NR,)

# 用「θ 方向梯度 / r 方向梯度」的比值筛出斜线区
ratio = feat_t[:NR - 1] / (feat_strength + 1e-6)
sel = ratio > np.percentile(ratio, 55)         # 选上半区
sel_r = np.nonzero(sel)[0]
print(f'选中斜线行数: {len(sel_r)} / {NR-1}  (r 范围 {rs[sel_r[0]]:.0f}~{rs[sel_r[-1]]:.0f}px)')

lines = []
def out(s=''):
    print(s); lines.append(s)


def shift_score(k, s):
    """帧 k 与 k+1，沿 θ 平移 s 个格（0.5°）后的相关。只在 sel_r 行上比较。"""
    A = pol[k][sel_r, :]
    B = pol[k + 1][sel_r, :]
    A = A - A.mean(); B = B - B.mean()
    Bs = np.roll(B, s, axis=1)
    na = np.linalg.norm(A); nb = np.linalg.norm(Bs)
    if na < 1e-6 or nb < 1e-6:
        return -2.0
    return float(np.sum(A * Bs) / (na * nb))


# 限制搜索范围：假设单帧转角不超过 ±120°（240 格）
MAXS = 240
pairs = []
for k in range(N - 1):
    best_s, best_c, second = 0, -2.0, -2.0
    for s in range(-MAXS, MAXS + 1):
        c = shift_score(k, s)
        if c > best_c:
            second = best_c; best_c = c; best_s = s
        elif c > second:
            second = c
    pairs.append((k, best_s, best_c, best_c - second))

lines.append('=== 相邻帧最佳角位移（θ 格 = 0.5°）===')
lines.append('k   idx   dt(s)   Δθ格   Δθ(°)   相关  峰优势')
good = []
for k, s, c, adv in pairs:
    dt = durs[idxs[k + 1]] / 1000.0
    dth = s * 0.5
    lines.append(f'{k:3d}  {idxs[k]:4d}  {dt:5.3f}  {s:+5d}  {dth:+7.1f}  {c:5.2f}  {adv:5.3f}')
    if adv > 0.02 and c > 0.25:
        good.append((t0[k + 1] - t0[k], dth, c, adv))

lines.append('')
lines.append('=== 稳健估计（仅用高置信帧对）===')
if good:
    good.sort(key=lambda x: -x[3])
    top = good[: max(8, len(good) // 2)]
    lines.append(f'高置信帧对数: {len(good)} / {N-1}')
    dts = np.array([g[0] for g in top])
    dths = np.array([g[1] for g in top])
    # 加权最小二乘（过原点）：dθ = ω · dt
    wts = np.array([g[2] for g in top])
    omega = float(np.sum(wts * dts * dths) / np.sum(wts * dts * dts))
    lines.append(f'加权最小二乘 ω = {omega:+.1f} °/s   (= {omega/360:.3f} 圈/s)')
    med = float(np.median(dths / dts))
    lines.append(f'中位数 ω      = {med:+.1f} °/s')
    lines.append(f'置信帧对的 dt 范围: {dts.min():.3f}~{dts.max():.3f}s')
    lines.append(f'置信帧对的 Δθ 范围: {dths.min():+.1f}~{dths.max():+.1f}°')
else:
    lines.append('无高置信帧对 —— 帧率过低，无法解算')

with open(os.path.join(OUT, '_polarcorr.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n>>> 写入 _polarcorr.txt')
