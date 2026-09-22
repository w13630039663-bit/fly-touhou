# -*- coding: utf-8 -*-
"""扫描螺旋斜率 b，用相位集中度定标螺距与臂数"""
import numpy as np, math, os

OUT = r'D:\苍蝇\experiments\gif_analysis'
b_pts = np.load(os.path.join(OUT, '_spiral_beads.npy'))
CX, CY = 417.0, 310.0
xe = b_pts[:, 0] - CX
ye = b_pts[:, 1] - CY
th = np.arctan2(ye, xe)
r = np.hypot(xe, ye)
print(f'点数 {len(r)}  r范围 [{r.min():.1f}, {r.max():.1f}]')

# 阿基米德螺旋: r = b*theta_abs + c,  theta_abs = theta + 2*pi*n
# => (r - b*theta) mod (2*pi*b) 应集中于常数 c
BW = 3.0            # 相位 bin 宽度 (px)

def score(b):
    P = 2 * math.pi * b
    ph = (r - b * th) % P
    nb = max(6, int(P / BW))
    h, _ = np.histogram(ph, bins=nb, range=(0, P))
    frac = h / h.sum()
    # 集中度: 最大 bin 占比 vs 均匀期望
    return frac.max(), nb

results = []
for b in np.arange(2.0, 80.0, 0.05):
    s, nb = score(b)
    results.append((s, b, nb))
results.sort(reverse=True)

print(f'\n=== 相位集中度 Top 20 (bin={BW}px) ===')
print(f'{"集中度":>8} {"b(px/rad)":>10} {"螺距(GIF)":>10} {"螺距(game)":>11} {"v(game,px/f)":>13} {"bins":>5}')
for s, b, nb in results[:20]:
    P = 2 * math.pi * b
    v_gif = P / (2 * math.pi / 0.121767)      # = b * omega
    v_game = v_gif / 2.1146
    print(f'{s:8.4f} {b:10.3f} {P:10.1f} {P/2.1146:11.1f} {v_game:13.3f} {nb:5d}')

# 均匀分布基准
print(f'\n均匀基准 1/bins ≈ {1/max(6,int(2*math.pi*results[0][1]/BW)):.4f}')

# 取最佳 b，看相位直方图的峰数
s, b, nb = results[0]
P = 2 * math.pi * b
ph = (r - b * th) % P
h, edges = np.histogram(ph, bins=nb, range=(0, P))
print(f'\n=== 最佳 b={b:.3f} 的相位直方图（峰数 = 臂数线索）===')
for i, v in enumerate(h):
    bar = '#' * v
    print(f'  {edges[i]:7.1f}-{edges[i+1]:7.1f} {v:4d} {bar}')

# 用圆统计做二次验证: 对 phi = theta * N mod 2pi 检验
print('\n=== 臂数检验: 计算相位角 theta 的 N 阶圆集中度 ===')
for N in range(1, 13):
    z = np.exp(1j * N * th)
    print(f'  N={N:2d}  |mean z| = {abs(z.mean()):.4f}')

# 残差: 最佳 b 下，点数 vs 相位跨度的关系
print('\n=== 最佳 b 下各珠子的螺旋展开坐标 ===')
idx = np.argsort(r)
for k in idx[::max(1, len(idx)//30)]:
    n_est = (r[k] - b * th[k]) / P
    print(f'  r={r[k]:7.1f} th={math.degrees(th[k]):8.2f}  -> 连续螺旋坐标 k={n_est:7.3f}')
