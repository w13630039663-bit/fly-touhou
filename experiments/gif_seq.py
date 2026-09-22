# -*- coding: utf-8 -*-
"""逐帧导出符卡实战段（76~150），并做逐帧差分分析。

分析目标：
  A. 螺旋转速（角速度）：固定半径环带上的角向剖面互相关
  B. 螺旋臂间距（圈间距）：径向亮度自相关的峰间距
  C. 子弹速度：追踪单颗亮斑的逐帧位移（相邻帧，dt 已知）
"""
import os, math
from PIL import Image
import numpy as np

SRC = r'D:\苍蝇\experiments\QQ20260914-231559.gif'
SEQ = r'D:\苍蝇\experiments\gif_seq'
OUT = r'D:\苍蝇\experiments\gif_analysis'
os.makedirs(SEQ, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

LO, HI = 74, 152          # 导出并分析这一段

im = Image.open(SRC)
durs = {}
frames = {}
for i in range(im.n_frames):
    im.seek(i)
    d = im.info.get('duration', 70)
    durs[i] = d
    if LO <= i <= HI:
        fr = im.convert('RGB').copy()
        fr.save(os.path.join(SEQ, f's{i:04d}.png'))
        frames[i] = np.asarray(fr).astype(np.float32)

idxs = sorted(frames.keys())
print(f'导出 {len(idxs)} 帧: {idxs[0]} ~ {idxs[-1]}')

# ---- 裁切游戏区 ----
Y0, Y1 = 80, 900
X0, X1 = 12, 800
CX = (X0 + X1) / 2.0
CY = (Y0 + Y1) / 2.0
RMAX = 330.0


def chain_mask(a):
    """白心 + 紫边 的珠链掩码。"""
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    white = (R > 210) & (G > 190) & (B > 210)
    purple = (B > 125) & (B > G + 40) & (R > 60) & (R < 240)
    return (white | purple).astype(np.float32)


def polar(P, nr=180, ntheta=360):
    rs = np.linspace(0, RMAX, nr)
    ts = np.linspace(0, 2 * math.pi, ntheta, endpoint=False)
    RR, TT = np.meshgrid(rs, ts, indexing='ij')
    X = np.clip((CX + RR * np.cos(TT)).astype(np.int32), 0, P.shape[1] - 1)
    Y = np.clip((CY + RR * np.sin(TT)).astype(np.int32), 0, P.shape[0] - 1)
    return P[Y, X]


def xcorr_shift(a, b, maxs):
    a = a - a.mean(); b = b - b.mean()
    na = np.linalg.norm(a); nb = np.linalg.norm(b)
    if na < 1e-6 or nb < 1e-6:
        return 0, 0.0
    best = (0, -2.0)
    for s in range(-maxs, maxs + 1):
        c = float(np.dot(a, np.roll(b, s)) / (na * nb))
        if c > best[1]:
            best = (s, c)
    return best


lines = []
def out(s=''):
    print(s); lines.append(s)

masks = {i: chain_mask(frames[i][Y0:Y1, X0:X1]) for i in idxs}
pols = {i: polar(masks[i]) for i in idxs}

out('=== 每帧珠链像素 & 总时长 ===')
tt = 0.0
for i in idxs:
    out(f'  s{i:04d} dur={durs[i]}ms  chain={masks[i].mean()*100:5.2f}%')

# ---- A. 角速度（多环带） ----
out()
out('=== A. 螺旋角速度（角向互相关, 相邻帧）===')
nr = pols[idxs[0]].shape[0]
rs_axis = np.linspace(0, RMAX, nr)
for rt in [30, 50, 70, 90, 110, 140, 170, 200, 240]:
    ri = int(np.argmin(np.abs(rs_axis - rt)))
    w = 4
    vecs = [P[max(0, ri - w):ri + w + 1].sum(axis=0) for P in pols.values()]
    angs, oms = [], []
    for k in range(1, len(vecs)):
        s, c = xcorr_shift(vecs[k - 1], vecs[k], 50)
        if s > 180: s -= 360
        if s < -180: s += 360
        dt = durs[idxs[k]] / 1000.0
        angs.append(s); oms.append(s / dt)
    A = np.array(oms)
    out(f'  r={rt:3d}px  dθ中位={np.median(angs):+6.1f}°/帧  ω中位={np.median(A):+8.1f}°/s  '
        f'均值={A.mean():+8.1f}°/s  N={len(A)}')

# ---- B. 圈间距（径向自相关） ----
out()
out('=== B. 螺旋臂间距（径向亮度自相关峰间距）===')
for k in [10, 20, 30]:
    if k >= len(idxs): continue
    i = idxs[k]
    P = pols[i]
    prof = P.mean(axis=1)          # 径向平均亮度
    prof = prof[15:150]
    prof = prof - prof.mean()
    rscale = RMAX / nr
    ac = []
    for lag in range(2, 90):
        if lag >= len(prof): break
        v = float(np.dot(prof[:-lag], prof[lag:]) / (len(prof) - lag))
        ac.append((lag, v))
    # 找第一个局部极大
    peaks = []
    for j in range(1, len(ac) - 1):
        if ac[j][1] > ac[j - 1][1] and ac[j][1] > ac[j + 1][1] and ac[j][1] > 0:
            peaks.append((ac[j][0], ac[j][1]))
    peaks.sort(key=lambda kv: -kv[1])
    top = peaks[:4]
    out(f'  帧 s{i:04d}: 峰间距(lag) -> ' +
        ', '.join(f'{l}格={l*rscale:.1f}px({v:.1f})' for l, v in top))

# ---- C. 子弹速度：追踪亮斑 ----
out()
out('=== C. 下落弹幕速度（垂直剖面互相关, 相邻帧）===')
for lo, hi in [(60, 899)]:
    profs = []
    for i in idxs:
        sub = frames[i][Y0:Y1, X0:X1]
        R, G, B = sub[:, :, 0], sub[:, :, 1], sub[:, :, 2]
        # 下落幕：青绿 + 黄白
        cyan = (G > 150) & (B > 140) & (G > R + 30)
        yell = (R > 200) & (G > 190) & (B < 150)
        col = (cyan | yell).astype(np.float32).mean(axis=1)   # 每行密度
        profs.append(col)
    dys, vs = [], []
    for k in range(1, len(profs)):
        s, c = xcorr_shift(profs[k - 1], profs[k], 90)
        dt = durs[idxs[k]] / 1000.0
        dys.append(s); vs.append(s / dt)
    D = np.array(dys); V = np.array(vs)
    out(f'  dy中位={np.median(D):+6.1f}px/帧  v中位={np.median(V):+8.1f}px/s  '
        f'均值={V.mean():+8.1f}px/s  N={len(V)}')

with open(os.path.join(OUT, '_seq.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n>>> 写入 _seq.txt')
