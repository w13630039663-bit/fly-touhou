# -*- coding: utf-8 -*-
"""长基线验证：跨多帧累积位移。若真有速度，长基线必然暴露。"""
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


def phase_shift(A, B):
    """返回 B 相对 A 的 (dx, dy) 整数位移 + 峰值。"""
    fa = np.fft.rfft2(A - A.mean())
    fb = np.fft.rfft2(B - B.mean())
    R = fa * np.conj(fb)
    R /= (np.abs(R) + 1e-9)
    c = np.fft.irfft2(R, s=A.shape)
    pk = np.unravel_index(np.argmax(c), c.shape)
    dy, dx = pk
    h, w = A.shape
    if dy > h // 2: dy -= h
    if dx > w // 2: dx -= w
    return dx, dy, float(c.max())


out('【长基线相位相关】以 s0074 为基准，看不同时间跨度的位移')
base = gray[names[0]]
out('  k   idx    dt(s)    dx     dy    peak')
for k in [1, 2, 5, 10, 20, 30, 40, 50, 60, 70, 78]:
    if k >= len(names):
        continue
    dx, dy, c = phase_shift(base, gray[names[k]])
    out(f'  {k:3d}  s{idxs[k]:04d}  {t0[k]:6.2f}   {dx:+5d}  {dy:+5d}   {c:.6f}')

out()
out('【下半屏长基线】只统计下半屏（下落幕区域）')
ys = int((Y1 - Y0) * 0.55)
base2 = gray[names[0]][ys:]
out('  k   idx    dt(s)    dx     dy    peak')
for k in [1, 2, 5, 10, 20, 30, 40, 50, 60, 70, 78]:
    if k >= len(names):
        continue
    dx, dy, c = phase_shift(base2, gray[names[k]][ys:])
    out(f'  {k:3d}  s{idxs[k]:04d}  {t0[k]:6.2f}   {dx:+5d}  {dy:+5d}   {c:.6f}')

out()
out('【相邻帧下半屏】逐对，看是否始终为 0')
dys = []
for k in range(1, len(names)):
    dx, dy, c = phase_shift(gray[names[k - 1]][ys:], gray[names[k]][ys:])
    dys.append(dy)
D = np.array(dys)
out(f'  N={len(D)}  dy: 唯一值={sorted(set(D.tolist()))[:20]}')
out(f'  dy==0 的比例: {(D == 0).sum()}/{len(D)}')

# 用亚像素：对下半屏做亮度质心
out()
out('【下半屏亮度质心 y（亚像素）】')
cys = []
for n in names:
    g = gray[n][ys:]
    w = g - g.min()
    s = w.sum()
    ycoord = np.arange(g.shape[0])[:, None] * np.ones((1, g.shape[1]))
    cys.append(float((w * ycoord).sum() / s) if s > 1e-6 else np.nan)
cys = np.array(cys)
for k in range(0, len(idxs), 6):
    out(f'  s{idxs[k]:04d} t={t0[k]:5.2f}  cy={cys[k]:9.4f}px')
valid = ~np.isnan(cys)
if valid.sum() > 10:
    d = np.polyfit(t0[valid], cys[valid], 1)
    res = cys[valid] - np.polyval(d, t0[valid])
    out(f'  >>> dcy/dt = {d[0]:+.4f} px/s   残差 std={res.std():.4f}px')
    out(f'  >>> 若真实下落，{t0[-1]:.1f}s 内应下移 {abs(d[0])*t0[-1]:.2f}px')

with open(os.path.join(OUT, '_longbase.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n>>> 写入 _longbase.txt')
