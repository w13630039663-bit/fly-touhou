# -*- coding: utf-8 -*-
"""极坐标展开: 把帧变换到 (theta, r) 平面，直接暴露螺旋臂数与螺距"""
import numpy as np
from PIL import Image
import os, math

FR = r'D:\苍蝇\experiments\gif_seq\s0085.png'
OUT = r'D:\苍蝇\experiments\gif_analysis'
CX, CY = 417.0, 310.0

img = Image.open(FR).convert('RGB')
A = np.asarray(img).astype(np.float32)
H, W, _ = A.shape
lum = np.minimum(np.minimum(A[:, :, 0], A[:, :, 1]), A[:, :, 2])

RMAX = 420      # 最大半径
NTH = 1080      # 角度分辨率
NR = RMAX       # 半径分辨率

th = np.linspace(0, 2 * math.pi, NTH, endpoint=False)
rr = np.arange(NR, dtype=np.float32)
TH, RR = np.meshgrid(th, rr)          # shape (NR, NTH)
X = (CX + RR * np.cos(TH)).astype(np.int32)
Y = (CY + RR * np.sin(TH)).astype(np.int32)
ok = (X >= 0) & (X < W) & (Y >= 0) & (Y < H)
Xc = np.clip(X, 0, W - 1); Yc = np.clip(Y, 0, H - 1)
pol = np.where(ok, lum[Yc, Xc], 0)

# 保存展开图（放大对比度）
pv = np.clip(pol * 1.0, 0, 255).astype(np.uint8)
Image.fromarray(pv).resize((NTH // 2, NR * 2), Image.NEAREST).save(
    os.path.join(OUT, 'polar_unwrap.png'))
print('-> polar_unwrap.png saved')

# ---- 角向峰值统计：固定在若干半径环带上，数珠子个数 ----
print('\n=== 各半径环带上的珠子数（角向峰值）===')
print(f'{"r(GIF)":>9} {"r(game)":>8} {"环带周长(px)":>12} {"峰数":>5} {"圈数密度":>9}')
for lo in range(30, 400, 20):
    band = pol[lo:lo + 20, :].max(axis=0)       # 该环带内每角度取最大亮度
    if band.max() < 150:
        continue
    # 峰检测
    thr = max(120, band.mean() + 0.9 * band.std())
    peaks = []
    for i in range(len(band)):
        if band[i] > thr and band[i] >= band[(i - 1) % len(band)] and band[i] > band[(i + 1) % len(band)]:
            peaks.append(i)
    # 去重（角度间隔 < 1.5° 的合并）
    ded = []
    for p in peaks:
        if not ded or (p - ded[-1]) * 360 / NTH > 1.5:
            ded.append(p)
    if ded and (360 - (ded[-1] - ded[0]) * 360 / NTH) < 1.5:
        ded = ded[:-1]
    rc = lo + 10
    print(f'{rc:9d} {rc/2.1146:8.1f} {2*math.pi*rc:12.0f} {len(ded):5d} {len(ded)/(2*math.pi*rc):9.4f}')

# ---- 径向剖面：固定方向上的珠子间隔 = 螺距 ----
print('\n=== 固定方向上的径向亮度剖面（找珠子峰值 -> 螺距）===')
for deg in (0, 45, 90, 135, 180, 225, 270, 315):
    col = int(deg / 360 * NTH) % NTH
    prof = pol[:, col]
    peaks = []
    for i in range(2, NR - 2):
        if prof[i] > 150 and prof[i] >= prof[i - 1] and prof[i] > prof[i + 1]:
            if not peaks or i - peaks[-1] > 6:
                peaks.append(i)
    if len(peaks) >= 2:
        gaps = np.diff(peaks)
        print(f'  theta={deg:3d}deg  peaks at r={peaks}  gaps={list(gaps)}  median_gap={np.median(gaps):.1f}px(GIF) = {np.median(gaps)/2.1146:.1f}px(game)')
    else:
        print(f'  theta={deg:3d}deg  peaks={peaks} (too few)')

with open(os.path.join(OUT, '_polar.txt'), 'w', encoding='utf-8') as f:
    f.write('see stdout\n')
print('\ndone')
