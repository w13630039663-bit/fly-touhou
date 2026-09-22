# -*- coding: utf-8 -*-
"""用 ECL 参数正向模拟，与真实帧做并排可视化验证"""
import numpy as np, math, os
from PIL import Image, ImageDraw

OUT = r'D:\苍蝇\experiments\gif_analysis'

# ===== ECL 解包参数 (大輪「からかさ後光」NORMAL) =====
OMEGA   = 0.124174       # rad/frame  <- %C ±= 0.124174f  (!ENH 分支)
SPEED   = 0.7662421      # px/frame   <- ins_504(0, %C, 0.7662421f)
ARMS    = 5              # <- ins_502(0, 5, 4) 第一参数
BURST   = 112            # <- $E = 112
# 循环体: @MBossCard1At() async -> ins_83(160) -> ins_312 -> ins_83(58)
# 因为 At 是 async（不阻塞），所以周期 = 160 + 58 = 218，不是 112+218
PERIOD  = 160 + 58       # 218

GAME_W, GAME_H = 384, 448
SCALE = 812.0 / 384.0
CXG, CYG = 192.0, 146.5          # boss 位置（游戏坐标，实测换算）

def simulate(total=1600, limit=520):
    """返回末帧全部子弹 (x,y) 游戏坐标"""
    bullets = []
    for f in range(total):
        if f % PERIOD < BURST:
            k = f % PERIOD
            for a in range(ARMS):
                bullets.append((f, a * 2 * math.pi / ARMS, 0.0))
        keep = []
        for (b, t0, th0) in bullets:
            age = f - b
            r = age * SPEED
            th = t0 + OMEGA * k_of(b)
            if r <= limit:
                keep.append((b, t0, th0))
        bullets = keep
    f = total
    pts = []
    for (b, t0, th0) in bullets:
        k = b % PERIOD
        r = (f - b) * SPEED
        th = t0 + OMEGA * k
        pts.append((r, th))
    return np.array(pts)

def k_of(b):
    return b % PERIOD

sim = simulate()
print('模拟子弹数 =', len(sim), '  r范围 [%.1f, %.1f]' % (sim[:,0].min(), sim[:,0].max()))

# ===== 画并排 theta-r 散点 =====
W, Hh = 620, 620
img = Image.new('RGB', (W*2+20, Hh), (10, 10, 16))
d = ImageDraw.Draw(img)

def panel(ox, pts_r, pts_th, title, color):
    for i in range(0, W, 62):
        d.line([(ox+i, 0), (ox+i, Hh)], fill=(26, 26, 34))
    for j in range(0, Hh, 62):
        d.line([(ox, j), (ox+W, j)], fill=(26, 26, 34))
    RMAX = 300.0
    for rr, tt in zip(pts_r, pts_th):
        x = ox + int(((math.degrees(tt)) % 360) / 360 * (W-1))
        y = int((1 - rr / RMAX) * (Hh-1))
        if 0 <= y < Hh:
            d.ellipse([x-2, y-2, x+2, y+2], fill=color)
    d.text((ox+8, 6), title, fill=(240, 240, 240))

# 真实
bp = np.load(os.path.join(OUT, '_spiral_beads.npy'))
CX, CY = 417.0, 310.0
th_r = np.arctan2(bp[:,1]-CY, bp[:,0]-CX)
r_r = np.hypot(bp[:,0]-CX, bp[:,1]-CY) / SCALE
panel(0, r_r, th_r, 'REAL (s0085)', (255, 110, 255))

# 模拟
panel(W+20, sim[:,0], sim[:,1], 'SIM (ECL params)', (110, 255, 160))

img.save(os.path.join(OUT, 'verify_sim_vs_real.png'))
print('-> verify_sim_vs_real.png')

# ===== 数值比对：径向密度 =====
print('\n=== 径向密度对比 (游戏坐标) ===')
bins = np.arange(0, 260, 20)
hr,_ = np.histogram(r_r, bins=bins); hs,_ = np.histogram(sim[:,0], bins=bins)
print(f'{"r":>10} {"real%":>7} {"sim%":>7}')
for i in range(len(bins)-1):
    print(f'{bins[i]:4.0f}-{bins[i+1]:3.0f} {hr[i]/hr.sum()*100:7.1f} {hs[i]/hs.sum()*100:7.1f}')

# ===== 螺距 =====
P_game = SPEED * (2*math.pi/OMEGA)
print(f'\nECL 螺距 = {P_game:.2f} px(游戏) = {P_game*SCALE:.1f} px(GIF)')
print(f'ECL 一圈耗时 = {2*math.pi/OMEGA:.2f} 帧 = {2*math.pi/OMEGA/60:.3f} s')
print(f'一波圈数 = {BURST*OMEGA/(2*math.pi):.3f} 圈')
print(f'转速 = {math.degrees(OMEGA)*60:.1f} deg/s')
