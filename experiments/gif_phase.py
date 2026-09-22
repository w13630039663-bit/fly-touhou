# -*- coding: utf-8 -*-
"""
相位追踪法测螺旋转速。

思路：
  螺旋是「多臂」结构，用角向剖面的「主频相位」追踪旋转更稳。
  对固定半径 r 的环带，取亮度随角度的分布 f(θ)，
  做 1 阶/2 阶/3 阶傅里叶变换，取最大谐波的相位 φ_m(t)，
  相邻帧的 Δφ 即旋转角（对 m 阶谐波，实际转角 = Δφ/m）。

这样即使帧间跨度大，只要 < 半周期就能解出。
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
t0 = []
acc = 0.0
for i in idxs:
    acc += durs[i] / 1000.0
    t0.append(acc)
t0 = np.array(t0); t0 -= t0[0]


def chain(a):
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    white = (R > 210) & (G > 190) & (B > 210)
    purple = (B > 125) & (B > G + 40) & (R > 60) & (R < 240)
    return (white | purple).astype(np.float32)


NT = 720                      # 角分辨率 0.5°
ts = np.linspace(0, 2 * math.pi, NT, endpoint=False)
profiles = {}                 # r_bin -> [f(θ) per frame]
R_BINS = list(range(20, 301, 10))

frames_masks = {}
for n in names:
    a = np.asarray(Image.open(os.path.join(SEQ, n)).convert('RGB')).astype(np.float32)
    frames_masks[n] = chain(a[Y0:Y1, X0:X1])

for r in R_BINS:
    X = np.clip((CX + r * np.cos(ts)).astype(np.int32), 0, X1 - X0 - 1)
    Y = np.clip((CY + r * np.sin(ts)).astype(np.int32), 0, Y1 - Y0 - 1)
    vecs = []
    for n in names:
        m = frames_masks[n]
        # 取 r-2..r+2 的环带平均（抗锯齿）
        acc = np.zeros(NT, dtype=np.float32)
        for dr in (-2, -1, 0, 1, 2):
            xx = np.clip((CX + (r + dr) * np.cos(ts)).astype(np.int32), 0, X1 - X0 - 1)
            yy = np.clip((CY + (r + dr) * np.sin(ts)).astype(np.int32), 0, Y1 - Y0 - 1)
            acc += m[yy, xx]
        vecs.append(acc / 5.0)
    profiles[r] = np.array(vecs)      # (Nframes, NT)


def harmonic_phase(vec, m):
    """返回 m 阶谐波的相位（弧度）与幅度。"""
    k = np.arange(NT)
    c = float(np.sum(vec * np.cos(2 * math.pi * m * k / NT)))
    s = float(np.sum(vec * np.sin(2 * math.pi * m * k / NT)))
    return math.atan2(s, c), math.hypot(c, s)


lines = []
def out(s=''):
    print(s); lines.append(s)

out('=== 相位追踪：各半径环带的旋转角速度 ===')
out('（对 m 阶谐波，Δφ=相位差，实际转角 = Δφ/m，已解卷绕）')
out()
out('r(px)  m  |ω|(°/s)  方向  幅度比  样本数')
results = []
for r in R_BINS:
    V = profiles[r]
    if V.sum() < 500:
        continue
    # 选最佳谐波阶数：比较 1..6 阶的平均幅度
    best_m, best_amp = 1, -1
    for m in range(1, 7):
        amps = [harmonic_phase(V[k], m)[1] for k in range(0, len(V), 5)]
        a = float(np.median(amps))
        if a > best_amp:
            best_amp, best_m = a, m
    m = best_m
    if best_amp < 1e-6:
        continue
    # 逐帧解相位，解卷绕
    ph = [harmonic_phase(V[k], m)[0] for k in range(len(V))]
    amps = [harmonic_phase(V[k], m)[1] for k in range(len(V))]
    med_amp = float(np.median(amps))
    unw = [ph[0]]
    for k in range(1, len(ph)):
        d = ph[k] - ph[k - 1]
        # 转到 (-pi, pi]
        while d > math.pi: d -= 2 * math.pi
        while d <= -math.pi: d += 2 * math.pi
        unw.append(unw[-1] + d)
    omegas = []
    for k in range(1, len(unw)):
        dt = durs[idxs[k]] / 1000.0
        deg = math.degrees((unw[k] - unw[k - 1]) / m)
        omegas.append(deg / dt)
    O = np.array(omegas)
    # 用中位数（抗离群）
    om = float(np.median(O))
    sign = '+' if om > 0 else '-'
    results.append((r, m, abs(om), sign, med_amp, len(O)))
    out(f'{r:4d}  {m}  {abs(om):8.1f}   {sign}    {med_amp:7.1f}  {len(O)}')

out()
out('=== 汇总 ===')
if results:
    good = [x for x in results if x[4] > 30]
    if good:
        ws = [x[2] for x in good]
        ss = [x[3] for x in good]
        out(f'  有效环带数: {len(good)}')
        out(f'  |ω| 中位数 = {np.median(ws):.1f} °/s')
        out(f'  |ω| 均值   = {np.mean(ws):.1f} °/s')
        from collections import Counter
        out(f'  方向分布: {Counter(ss).most_common()}')

with open(os.path.join(OUT, '_phase.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n>>> 写入 _phase.txt')
