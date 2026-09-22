# -*- coding: utf-8 -*-
"""修正版：严谨的周期检测 + 亚像素位移。"""
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

# 为了曲线更密，把 74~152 全序列 + 之后用到的帧合并
# 这里只处理已导出的帧

def m_chain(a):
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    return ((R > 210) & (G > 190) & (B > 210)) | \
           ((B > 125) & (B > G + 40) & (R > 60) & (R < 240))


def m_fall(a):
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    return ((G > 150) & (B > 140) & (G > R + 30)) | \
           ((R > 200) & (G > 190) & (B < 150))


chain_cnt, fall_cnt, fall_rows = [], [], []
for n in names:
    a = np.asarray(Image.open(os.path.join(SEQ, n)).convert('RGB')).astype(np.float32)
    sub = a[Y0:Y1, X0:X1]
    c = m_chain(sub); f = m_fall(sub)
    chain_cnt.append(float(c.sum()))
    fall_cnt.append(float(f.sum()))
    fall_rows.append(f.astype(np.float32).mean(axis=1))   # 每行密度
chain_cnt = np.array(chain_cnt)
fall_rows = np.array(fall_rows)

lines = []
def out(s=''):
    print(s); lines.append(s)

out('#' * 60)
out('# 修正版分析 (v2)')
out('#' * 60)
out()

# ===== A. 周期：对 chain_cnt 去趋势 + 自相关 =====
out('【A】链像素面积 A(t) 的周期分析')
x = chain_cnt.astype(np.float64)
# 去线性趋势
coef = np.polyfit(t0, x, 1)
detr = x - np.polyval(coef, t0)
detr = detr - detr.mean()
out(f'  原始 A: min={x.min()/1000:.1f}K max={x.max()/1000:.1f}K '
    f'均值={x.mean()/1000:.1f}K')
out(f'  线性趋势: {"上升" if coef[0]>0 else "下降"} {abs(coef[0])/1000:.1f} Kpx/s')
N = len(detr)
# 自相关
ac = []
for lag in range(1, N // 2):
    ac.append((lag, float(np.dot(detr[:-lag], detr[lag:]) / (N - lag))))
acn = np.array([v for _, v in ac])
acn = acn / acn[0] if acn[0] != 0 else acn
out('  自相关（前 25 lag）:')
_base = float(np.dot(detr, detr) / N)
for lag, v in ac[:25]:
    nv = (v / _base) if _base > 1e-9 else 0.0
    nb = max(0, min(40, int(abs(nv) * 40)))
    bar = ('#' * nb) if nv > 0 else ('-' * nb)
    out(f'    lag={lag:2d} ({t0[lag]-t0[0]:.2f}s)  {nv:+.3f}  {bar}')
# 找第一个显著正峰（排除 lag=0 附近）
pk = None
for k in range(1, len(acn) - 1):
    if acn[k] > acn[k - 1] and acn[k] > acn[k + 1] and acn[k] > 0.15:
        pk = k; break
if pk:
    out(f'  >>> 首个自相关正峰: lag={pk} 帧 (t={t0[pk]-t0[0]:.2f}s)  '
        f'相关={acn[pk]:+.3f}')
    out(f'  >>> 符卡主周期 ≈ {t0[pk]-t0[0]:.2f} s')
else:
    out('  >>> 未找到显著周期峰（去趋势后无周期性）')

# ===== B. 下落幕：亚像素位移（抛物线插值峰） =====
out()
out('【B】下落幕速度（亚像素互相关）')
Ysp = int((Y1 - Y0) * 0.60)
sub_rows = fall_rows[:, Ysp:]
def xcorr_sub(a, b, maxs=60):
    a = a - a.mean(); b = b - b.mean()
    na = np.linalg.norm(a); nb = np.linalg.norm(b)
    if na < 1e-6 or nb < 1e-6:
        return 0.0, 0.0
    corrs = []
    for s in range(-maxs, maxs + 1):
        corrs.append(float(np.dot(a, np.roll(b, s)) / (na * nb)))
    corrs = np.array(corrs)
    k = int(np.argmax(corrs))
    # 抛物线插值
    if 0 < k < len(corrs) - 1:
        y0, y1, y2 = corrs[k - 1], corrs[k], corrs[k + 1]
        den = (y0 - 2 * y1 + y2)
        delta = 0.5 * (y0 - y2) / den if abs(den) > 1e-9 else 0.0
        delta = max(-0.5, min(0.5, delta))
        # 注意 corrs 里 index k 对应 shift = k - maxs
        shift = (k - maxs) + delta
    else:
        shift = k - maxs
    return shift, float(corrs[k])

shifts, corrs = [], []
for k in range(1, len(sub_rows)):
    s, c = xcorr_sub(sub_rows[k - 1], sub_rows[k])
    shifts.append(s); corrs.append(c)
S = np.array(shifts); C = np.array(corrs)
dts = np.array([durs[idxs[k]] / 1000.0 for k in range(1, len(idxs))])
V = S / dts
out(f'  共 {len(S)} 帧对')
out(f'  shift: 中位={np.median(S):+.3f}px 均值={S.mean():+.3f}px '
    f'std={S.std():.3f}')
out(f'  corr : 中位={np.median(C):.3f}')
ok = C > 0.6
out(f'  高置信 (corr>0.6): {ok.sum()}/{len(S)}')
if ok.sum() > 3:
    out(f'    shift 中位 = {np.median(S[ok]):+.3f} px/帧')
    out(f'    v     中位 = {np.median(V[ok]):+8.2f} px/s')
    out(f'    v     均值 = {V[ok].mean():+8.2f} px/s +- {V[ok].std():.1f}')
    out(f'    折算 = {abs(np.median(V[ok]))/(Y1-Y0):.3f} 屏高/秒')
    out(f'    正位移(下落)占: {(S[ok]>0).sum()}/{ok.sum()}')

# ===== C. 螺旋几何：更严谨 =====
out()
out('【C】中心螺旋几何（多帧平均）')
gap_list = []
arm_cnt = []
for fi in [15, 20, 25, 30]:
    a = np.asarray(Image.open(os.path.join(SEQ, names[fi])).convert('RGB')).astype(np.float32)
    sub = a[Y0:Y1, X0:X1]
    m = m_chain(sub)
    ys, xs = np.nonzero(m)
    rr = np.sqrt((xs - CX) ** 2 + (ys - CY) ** 2)
    th = np.arctan2(ys - CY, xs - CX)
    # 只看中心 250px
    sel = rr < 250
    hist, edges = np.histogram(rr[sel], bins=np.arange(0, 252, 3))
    ctr = (edges[:-1] + edges[1:]) / 2
    # 平滑
    hs = np.convolve(hist, np.ones(3) / 3, mode='same')
    pk = [k for k in range(2, len(hs) - 2)
          if hs[k] > hs[k - 1] and hs[k] > hs[k + 1] and hs[k] > hs.max() * 0.3]
    if len(pk) >= 2:
        gaps = [ctr[pk[i + 1]] - ctr[pk[i]] for i in range(len(pk) - 1)]
        gap_list.extend(gaps)
        out(f'  帧 s{idxs[fi]:04d}: 中心区峰半径 {[f"{ctr[k]:.0f}" for k in pk]}  '
            f'间距 {[f"{g:.0f}" for g in gaps]}')
    hth, _ = np.histogram(th[sel], bins=64, range=(-math.pi, math.pi))
    tpk = [k for k in range(1, 63)
           if hth[k] > hth[k - 1] and hth[k] > hth[k + 1] and hth[k] > hth.mean() * 1.4]
    arm_cnt.append(len(tpk))
    out(f'           角向峰数(臂) ≈ {len(tpk)}')
if gap_list:
    gaps = np.array(gap_list)
    out(f'  >>> 中心区圈间距: 中位={np.median(gaps):.1f}px  '
        f'均值={gaps.mean():.1f}px  范围[{gaps.min():.0f},{gaps.max():.0f}]')
out(f'  >>> 臂数估计: {np.median(arm_cnt):.0f} (多次测量中位)')

with open(os.path.join(OUT, '_v2.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n>>> 写入 _v2.txt')
