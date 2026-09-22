# -*- coding: utf-8 -*-
"""
修正版弹幕参数反推。

方法：
1. 精确提取「珠链」像素（白心 + 紫边），排除红色背景。
2. 用极坐标重采样，把每帧转成 (radius, angle) 图像 B(r, theta)。
3. 旋转：对固定 r 环带，沿 theta 做互相关 -> 角位移 dtheta -> 角速度。
4. 扩张：对固定 theta 扇区，沿 r 做互相关 -> 径向位移 dr -> 径向速度。
   （不用 argmax，改用互相关，可同时处理多圈）
5. 发射间隔：统计整个序列中「珠链像素总量」的周期性（自相关）。
"""
import os, math
from PIL import Image
import numpy as np

FRAMES = r'D:\苍蝇\experiments\gif_frames'
OUTDIR = r'D:\苍蝇\experiments\gif_analysis'
os.makedirs(OUTDIR, exist_ok=True)

# --- 从 manifest 读帧时长 ---
durs = {}
with open(os.path.join(FRAMES, '_manifest.txt'), 'r', encoding='utf-8') as f:
    for line in f:
        parts = line.strip().split('\t')
        if len(parts) >= 2 and parts[0].isdigit():
            durs[int(parts[0])] = int(parts[1])

# --- 游戏区裁切（去掉顶部 HUD 和底部）---
# 从上图看：顶部 HUD 约 0~75px，游戏区大致 y=78 起，x 全宽但有边框
CROP = dict(x0=10, x1=802, y0=78, y1=915)
CX = (CROP['x0'] + CROP['x1']) / 2.0
CY = (CROP['y0'] + CROP['y1']) / 2.0
RMAX = 340.0


def chain_mask(a):
    """提取珠链：高亮度白心 + 紫色边。排除红背景。"""
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    # 白心：三通道都高
    white = (R > 215) & (G > 195) & (B > 215)
    # 紫边：蓝蓝明显高于绿，红中高
    purple = (B > 130) & (B > G + 45) & (R > 70) & (R < 235)
    m = white | purple
    return m.astype(np.float32)


def polar_resample(mask, nr=200, ntheta=360):
    """把掩码重采样到极坐标 (nr, ntheta)，双线性近似（最近邻够用）。"""
    rs = np.linspace(0, RMAX, nr)
    ts = np.linspace(0, 2 * math.pi, ntheta, endpoint=False)
    RR, TT = np.meshgrid(rs, ts, indexing='ij')
    X = (CX + RR * np.cos(TT)).astype(np.int32)
    Y = (CY + RR * np.sin(TT)).astype(np.int32)
    h, w = mask.shape
    np.clip(X, 0, w - 1, out=X)
    np.clip(Y, 0, h - 1, out=Y)
    return mask[Y, X]


def best_shift_1d(a, b, maxshift):
    """a,b 为等长一维；求 b 相对 a 的最佳平移（周期边界），返回 (shift, corr)。"""
    n = len(a)
    a = a - a.mean()
    b = b - b.mean()
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na < 1e-6 or nb < 1e-6:
        return 0, 0.0
    best_s, best_c = 0, -2.0
    for s in range(-maxshift, maxshift + 1):
        bs = np.roll(b, s)
        c = float(np.dot(a, bs) / (na * np.linalg.norm(bs)))
        if c > best_c:
            best_c, best_s = c, s
    return best_s, best_c


def main():
    idxs = [i for i in range(113, 141) if os.path.exists(os.path.join(FRAMES, f'f{i:04d}.png'))]
    print('分析帧:', idxs[0], '~', idxs[-1])

    polar_seq = []
    totals = []
    for i in idxs:
        im = Image.open(os.path.join(FRAMES, f'f{i:04d}.png')).convert('RGB')
        a = np.asarray(im).astype(np.float32)
        sub = a[CROP['y0']:CROP['y1'], CROP['x0']:CROP['x1']]
        m = chain_mask(sub)
        totals.append(float(m.sum()))
        P = polar_resample(m)          # (nr, ntheta)
        polar_seq.append(P)
        print(f'  f{i:04d} dur={durs.get(i)}ms  chain_px={int(m.sum())}  '
              f'({m.mean()*100:.2f}%)')

    lines = []
    def out(s=''):
        print(s); lines.append(s)

    out()
    out('=== 旋转角速度（固定环带，角向互相关）===')
    # 取几个代表环带（对应螺旋臂所在半径）
    rings = [40, 60, 80, 100, 130, 160, 190, 220]
    nr = polar_seq[0].shape[0]
    rs_axis = np.linspace(0, RMAX, nr)
    for r_target in rings:
        ri = int(np.argmin(np.abs(rs_axis - r_target)))
        w = 4
        vecs = [P[max(0, ri-w):ri+w+1].sum(axis=0) for P in polar_seq]  # 每帧一个 360 向量
        shifts = []
        omegas = []
        for k in range(1, len(vecs)):
            s, c = best_shift_1d(vecs[k-1], vecs[k], maxshift=60)
            # 把 shift 归一化到 [-180,180)
            if s > 180: s -= 360
            if s < -180: s += 360
            dt = durs.get(idxs[k], 70) / 1000.0
            deg = s * (360.0 / 360.0)   # ntheta=360，1格=1度
            om = deg / dt
            shifts.append(s)
            omegas.append(om)
        arr = np.array(omegas)
        out(f'  r={r_target:3d}px  shift(deg/frame) median={np.median(shifts):+.1f}  '
            f'omega 中位数={np.median(arr):+.1f} deg/s  均值={arr.mean():+.1f} deg/s')

    out()
    out('=== 径向扩张速度（固定扇区，径向互相关）===')
    ntheta = polar_seq[0].shape[1]
    sectors = [0, 45, 90, 135, 180, 225, 270, 315]
    for t_deg in sectors:
        ti = int(round(t_deg / 360.0 * ntheta)) % ntheta
        w = 6
        cols = []
        for P in polar_seq:
            idxs_t = [(ti + d) % ntheta for d in range(-w, w + 1)]
            cols.append(P[:, idxs_t].sum(axis=1))
        rscale = RMAX / nr   # px per radial bin
        vels = []
        for k in range(1, len(cols)):
            s, c = best_shift_1d(cols[k-1], cols[k], maxshift=40)
            dt = durs.get(idxs[k], 70) / 1000.0
            vels.append(s * rscale / dt)
        arr = np.array(vels)
        out(f'  theta={t_deg:3d}deg  v_r 中位数={np.median(arr):+8.1f} px/s  '
            f'均值={arr.mean():+8.1f} px/s')

    out()
    out('=== 珠链像素总量（自相关估计发射周期）===')
    t = np.array(totals, dtype=np.float64)
    t = t - t.mean()
    nn = len(t)
    ac = []
    for lag in range(1, nn // 2):
        v = float(np.dot(t[:-lag], t[lag:]) / (nn - lag))
        ac.append((lag, v / (np.dot(t, t) / nn)))
    ac_sorted = sorted(ac, key=lambda kv: -kv[1])[:5]
    for lag, v in ac_sorted:
        out(f'  lag={lag} 帧  自相关={v:+.3f}')

    with open(os.path.join(OUTDIR, '_rotation.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


if __name__ == '__main__':
    main()
