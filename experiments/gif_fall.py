# -*- coding: utf-8 -*-
"""验证下落幕速度：直接追踪质心 + 光流块匹配。"""
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

lines = []
def out(s=''):
    print(s); lines.append(s)


def m_fall(a):
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    return ((G > 150) & (B > 140) & (G > R + 30)) | \
           ((R > 200) & (G > 190) & (B < 150))


# ===== 方法1: 下半屏下落幕的「加权质心 y」 =====
out('【方法1】下半屏下落幕质心 y 随时间')
cy_list, cnt_list = [], []
for n in names:
    a = np.asarray(Image.open(os.path.join(SEQ, n)).convert('RGB')).astype(np.float32)
    f = m_fall(a[Y0:Y1, X0:X1])
    ysplit = int((Y1 - Y0) * 0.5)
    fs = f[ysplit:]
    ys, xs = np.nonzero(fs)
    cnt_list.append(len(ys))
    cy_list.append(float(ys.mean()) if len(ys) > 100 else np.nan)
cy = np.array(cy_list)
for k, i in enumerate(idxs):
    v = f'{cy[k]:7.1f}' if not np.isnan(cy[k]) else '   nan '
    out(f'  s{i:04d} t={t0[k]:5.2f}  cy={v}  n={cnt_list[k]:6d}')

valid = ~np.isnan(cy)
if valid.sum() > 10:
    d = np.polyfit(t0[valid], cy[valid], 1)
    out(f'  >>> 线性拟合 dcy/dt = {d[0]:+.2f} px/s  (N={valid.sum()})')
    resid = cy[valid] - np.polyval(d, t0[valid])
    out(f'      残差 std = {resid.std():.2f} px')

# ===== 方法2: 块匹配光流（在下半屏取多个块，逐帧追踪） =====
out()
out('【方法2】块匹配光流（下半屏，8 个采样块）')
imgs = {}
for n in names:
    imgs[n] = np.asarray(Image.open(os.path.join(SEQ, n)).convert('L')).astype(np.float32)[Y0:Y1, X0:X1]

H, W = imgs[names[0]].shape
BK = 48           # 块大小
blocks = []
for by in range(int(H * 0.5), H - BK, 80):
    for bx in range(20, W - BK, 120):
        blocks.append((bx, by))
out(f'  采样块数: {len(blocks)}  块尺寸 {BK}x{BK}')

def match(p0, p1, half=16):
    x, y = p0
    tpl = p1[y:y + BK, x:x + BK]
    if tpl.shape != (BK, BK):
        return None
    best = (0, 0, 1e18)
    for dy in range(-half, half + 1):
        for dx in range(-half, half + 1):
            yy, xx = y + dy, x + dx
            if yy < 0 or xx < 0 or yy + BK > p1.shape[0] or xx + BK > p1.shape[1]:
                continue
            cand = p1[yy:yy + BK, xx:xx + BK]
            s = float(np.abs(cand - tpl).mean())
            if s < best[2]:
                best = (dx, dy, s)
    return best

for bi in [0, len(blocks) // 2, len(blocks) - 1]:
    bx, by = blocks[bi]
    dys, dts = [], []
    for k in range(1, len(names)):
        r = match((bx, by), imgs[names[k]], half=20)
        if r and r[2] < 25:
            dys.append(r[1])
            dts.append(durs[idxs[k]] / 1000.0)
    if len(dys) > 5:
        D = np.array(dys)
        out(f'  块({bx},{by}): 有效帧对={len(D)}, dy中位={np.median(D):+.2f}px, '
            f'dy均值={D.mean():+.2f}px')

# ===== 方法3: 全下半屏平均光流 =====
out()
out('【方法3】下半屏整体位移（相位相关 FFT）')
def phase_corr(a, b):
    fa = np.fft.rfft2(a - a.mean())
    fb = np.fft.rfft2(b - b.mean())
    R = fa * np.conj(fb)
    R = R / (np.abs(R) + 1e-9)
    c = np.fft.irfft2(R, s=a.shape)
    peak = np.unravel_index(np.argmax(c), c.shape)
    dy, dx = peak
    if dy > a.shape[0] // 2: dy -= a.shape[0]
    if dx > a.shape[1] // 2: dx -= a.shape[1]
    return dx, dy, float(c.max())

ysplit = int(H * 0.5)
dys, dts, cs = [], [], []
for k in range(1, len(names)):
    A = imgs[names[k - 1]][ysplit:]
    B = imgs[names[k]][ysplit:]
    dx, dy, c = phase_corr(A, B)
    dys.append(dy); dts.append(durs[idxs[k]] / 1000.0); cs.append(c)
D = np.array(dys); C = np.array(cs)
out(f'  共 {len(D)} 帧对')
out(f'  dy 中位={np.median(D):+.2f}px 均值={D.mean():+.2f}px std={D.std():.2f}')
out(f'  峰相关 中位={np.median(C):.6f}')
out('  逐帧 dy:')
for k in range(len(D)):
    out(f'    s{idxs[k]:04d}->s{idxs[k+1]:04d} dt={dts[k]:.3f}s  dz={D[k]:+4d}px  '
        f'v={D[k]/dts[k]:+9.1f}px/s')

with open(os.path.join(OUT, '_fall.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n>>> 写入 _fall.txt')
