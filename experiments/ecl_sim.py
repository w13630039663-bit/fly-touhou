# -*- coding: utf-8 -*-
"""按 ECL 逻辑正向模拟符卡弹幕，扫描参数以匹配真实观测的径向分布"""
import numpy as np, math, os, json

OUT = r'D:\苍蝇\experiments\gif_analysis'
SCALE = 812.0 / 384.0          # GIF px per game px  (2.1146)
CX_G, CY_G = 417.0 / SCALE, 310.0 / SCALE     # 中心（游戏坐标）

# ---- 真实观测（螺旋链珠，游戏坐标） ----
beads = np.load(os.path.join(OUT, '_spiral_beads.npy'))     # (x,y) GIF
r_real = np.hypot(beads[:, 0] - 417.0, beads[:, 1] - 310.0) / SCALE
r_real = r_real[r_real > 20]
print(f'真实螺旋珠 r(游戏坐标): n={len(r_real)} min={r_real.min():.1f} max={r_real.max():.1f} median={np.median(r_real):.1f}')

# ---- ECL 参数 ----
OMEGA_HL = 0.121767        # rad/frame  (HL)
OMEGA_EN = 0.124174        # rad/frame  (EN)
BURST = 112                # 一波发射帧数
PERIOD = 218               # 波周期（160 + 58）
LIMIT = 260                # 子弹出界半径（游戏坐标，估计）

def simulate(omega, v, arms=1, total_frames=1400, limit=LIMIT):
    """返回稳态末帧所有子弹的 (r, theta)"""
    bullets = []   # (birth_frame, theta0)
    for f in range(total_frames):
        ph = f % PERIOD
        if ph < BURST:
            k = ph                                   # 波内第 k 帧
            for a in range(arms):
                bullets.append((f, a * 2 * math.pi / arms))
        bullets = [(b, t) for (b, t) in bullets if (f - b) * v <= limit]
    f = total_frames
    out = []
    for (b, t0) in bullets:
        k = (b % PERIOD)
        th = t0 + omega * k
        r = (f - b) * v
        out.append((r, th))
    return np.array(out)

def hist_l1(r_sim, r_ref, lo=0, hi=300, bins=30):
    a, _ = np.histogram(r_ref, bins=bins, range=(lo, hi), density=True)
    b, _ = np.histogram(r_sim, bins=bins, range=(lo, hi), density=True)
    return float(np.abs(a - b).sum()) / bins * bins / (bins)  # 归一化 L1

def ks_stat(a, b):
    a = np.sort(a); b = np.sort(b)
    grid = np.concatenate([a, b])
    ca = np.searchsorted(a, grid, 'right') / len(a)
    cb = np.searchsorted(b, grid, 'right') / len(b)
    return float(np.abs(ca - cb).max())

print('\n=== 扫描: v (px/frame, 游戏坐标) x 臂数 ===')
best = []
for arms in (1, 3, 5, 6):
    for v in [0.3, 0.4, 0.5, 0.6, 0.7, 0.77, 0.85, 1.0, 1.2, 1.5, 2.0, 2.5]:
        sim = simulate(OMEGA_HL, v, arms=arms)
        if len(sim) == 0:
            continue
        rs = sim[:, 0]
        k = ks_stat(rs, r_real)
        best.append((k, arms, v, len(sim), float(rs.max()), float(np.median(rs))))
best.sort()
print(f'{"KS":>7} {"arms":>5} {"v":>6} {"n":>6} {"rmax":>7} {"rmed":>7}')
for k, arms, v, n, rmax, rmed in best[:18]:
    print(f'{k:7.4f} {arms:5d} {v:6.2f} {n:6d} {rmax:7.1f} {rmed:7.1f}')

print('\n=== 真实 r 与最佳模拟 r 的直方图对比 ===')
k, arms, v, n, rmax, rmed = best[0]
sim = simulate(OMEGA_HL, v, arms=arms)
rs = sim[:, 0]
bins = np.arange(0, 301, 20)
hr, _ = np.histogram(r_real, bins=bins)
hs, _ = np.histogram(rs, bins=bins)
print(f'{"r 区间":>12} {"真实":>7} {"模拟":>7}')
for i in range(len(bins) - 1):
    fr = hr[i] / max(1, hr.sum()) * 100
    fs = hs[i] / max(1, hs.sum()) * 100
    bar_r = '#' * int(fr)
    bar_s = '*' * int(fs)
    print(f'{bins[i]:5.0f}-{bins[i+1]:3.0f} {hr[i]:7d} {hs[i]:7d}  R|{bar_r:<22} S|{bar_s}')
