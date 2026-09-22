# -*- coding: utf-8 -*-
"""验证局部光流：测下落幕的竖直分量 vy，并做时间稳定性检查。"""
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


def block_best(A, B, bx, by, bw, bh, srch=14):
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
            s = float(np.abs(B[yy:yy + bh, xx:xx + bw] - tpl).mean())
            if s < best[2]:
                best = (dx, dy, s)
    return best


# 在全画面均匀铺很多小窗口，逐帧测 (dx,dy)
BW = BH = 28
SRCH = 14
step = 60
H, W = gray[names[0]].shape
wins = []
for by in range(40, H - BH - 40, step):
    for bx in range(40, W - BW - 40, step):
        wins.append((bx, by))
out(f'采样窗口数: {len(wins)} (尺寸 {BW}x{BH}, 搜索半径 {SRCH}px)')
out()

# 逐帧对统计
vx_all, vy_all = [], []
for k in range(1, len(names)):
    A = gray[names[k - 1]]; B = gray[names[k]]
    dt = durs[idxs[k]] / 1000.0
    dxs, dys, scores = [], [], []
    for (bx, by) in wins:
        r = block_best(A, B, bx, by, BW, BH, SRCH)
        if r and r[2] < 22:      # 只在匹配良好的窗口统计
            dxs.append(r[0]); dys.append(r[1]); scores.append(r[2])
    if len(dxs) > 10:
        vx_all.append(np.median(dxs) / dt)
        vy_all.append(np.median(dys) / dt)

VX = np.array(vx_all); VY = np.array(vy_all)
out(f'有效帧对: {len(VX)}/{len(names)-1}')
out(f'vx: 中位={np.median(VX):+8.2f} 均值={VX.mean():+8.2f} std={VX.std():.2f} px/s')
out(f'vy: 中位={np.median(VY):+8.2f} 均值={VY.mean():+8.2f} std={VY.std():.2f} px/s')
out()

# 分段（看时间稳定性）
out('分段（每 13 帧）:')
seg = 13
for s in range(0, len(VX), seg):
    e = min(s + seg, len(VX))
    if e - s < 5:
        continue
    out(f'  帧对 {s:2d}~{e-1:2d}: vx={np.median(VX[s:e]):+8.2f}  '
        f'vy={np.median(VY[s:e]):+8.2f} px/s')

# 只统计下半屏的窗口
out()
out('仅下半屏窗口（下落幕区）:')
low_wins = [(bx, by) for (bx, by) in wins if by > H * 0.55]
out(f'  下半屏窗口数: {len(low_wins)}')
vx2, vy2 = [], []
for k in range(1, len(names)):
    A = gray[names[k - 1]]; B = gray[names[k]]
    dt = durs[idxs[k]] / 1000.0
    dxs, dys = [], []
    for (bx, by) in low_wins:
        r = block_best(A, B, bx, by, BW, BH, SRCH)
        if r and r[2] < 22:
            dxs.append(r[0]); dys.append(r[1])
    if len(dxs) > 6:
        vx2.append(np.median(dxs) / dt)
        vy2.append(np.median(dys) / dt)
VX2 = np.array(vx2); VY2 = np.array(vy2)
out(f'  N={len(VX2)}')
out(f'  vx: 中位={np.median(VX2):+8.2f} 均值={VX2.mean():+8.2f} px/s')
out(f'  vy: 中位={np.median(VY2):+8.2f} 均值={VY2.mean():+8.2f} px/s std={VY2.std():.2f}')
out(f'  速度大小 |v| 中位 = {np.median(np.hypot(VX2, VY2)):.2f} px/s')

# 换算：GIF 游戏区 780x810 -> 东方标准游戏区 384x448
sc = 384.0 / 780.0
out()
out('【换算到东方标准游戏区 384x448】')
out(f'  缩放比 = {sc:.4f}')
if len(VX2) > 3:
    out(f'  vy ≈ {np.median(VY2)*sc:+.1f} px/s @真实游戏')
    out(f'  60fps 下每帧位移 ≈ {abs(np.median(VY2))*sc/60:.3f} px/帧')

with open(os.path.join(OUT, '_verify_flow.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n>>> 写入 _verify_flow.txt')
