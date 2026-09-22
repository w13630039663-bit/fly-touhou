"""
精确帧间位移分析（修正版）

方法：
1. 用蓝色通道（紫色珠链最亮）做全局互相关，估计整体位移
2. 螺旋弹幕是「径向扩张」的 → 用径向亮度剖面(r-profile)随时间的变化测扩张速度
3. 下落弹幕 → 用垂直剖面(y-profile)的向下平移测下落速度

输出可直接用于复刻的数值。
"""
import os
import numpy as np
from PIL import Image, ImageSequence

SRC = r"C:/Users/leimi/Desktop/QQ20260914-231559.gif"
OUT = r"D:/苍蝇/experiments/gif_analysis"
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC)
frames, durs = [], []
for fr in ImageSequence.Iterator(im):
    durs.append(fr.info.get("duration", 0))
    frames.append(fr.convert("RGB").copy())

# 游戏画面：去掉顶部标题条与底部
GY0, GY1, GX0, GX1 = 60, 870, 15, 795
def crop_img(f):
    return np.asarray(f, dtype=np.uint8)[GY0:GY1, GX0:GX1]

H, W = GY1 - GY0, GX1 - GX0
cx, cy = W / 2, H / 2

lines = []
lines.append(f"GIF 211 帧, 游戏区裁切 {W}x{H} (中心 {cx:.0f},{cy:.0f})")

# ---------- 1. 径向亮度剖面：测螺旋扩张 ----------
lines.append("")
lines.append("=== 径向亮度剖面（紫色通道，测螺旋扩张速度）===")
lines.append("圆心在画面中心。r 为到中心的距离（像素）。")

def purple_profile(arr):
    r = arr[:, :, 0].astype(np.float32)
    g = arr[:, :, 1].astype(np.float32)
    b = arr[:, :, 2].astype(np.float32)
    purple = np.clip((r + b) / 2 - g, 0, 255)  # 紫色度
    yy, xx = np.mgrid[0:arr.shape[0], 0:arr.shape[1]]
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    nb = 60
    prof = np.zeros(nb)
    for k in range(nb):
        m = (dist >= k * 6) & (dist < (k + 1) * 6)
        if m.any():
            prof[k] = purple[m].mean()
    return prof

seg = range(113, 141)
profs = []
for i in seg:
    p = purple_profile(crop_img(frames[i]))
    profs.append(p)

# 找每帧的亮度峰值半径（螺旋环所在位置）
peaks = []
for i, p in zip(seg, profs):
    k = int(np.argmax(p))
    peaks.append((i, durs[i], k * 6 + 3, float(p[k])))
lines.append("idx  dur_ms  peak_r  peak_val")
for i, d, pr, pv in peaks:
    lines.append(f"{i:4d}  {d:5d}  {pr:6d}  {pv:7.1f}")

# 峰值半径的变化率
lines.append("")
lines.append("=== 螺旋扩张速度 ===")
rates = []
for a, b in zip(peaks, peaks[1:]):
    dr = b[2] - a[2]
    dt = b[1] / 1000.0
    if dt > 0:
        rates.append((a[0], dr, dt, dr / dt))
lines.append("from_idx  d_r(px)  dt(s)  speed(px/s)")
for i, dr, dt, v in rates:
    lines.append(f"{i:8d}  {dr:7d}  {dt:5.2f}  {v:9.1f}")

if rates:
    vs = [v for _, _, _, v in rates]
    lines.append("")
    lines.append(f"扩张速度 均值 {np.mean(vs):.1f} px/s, 中位数 {np.median(vs):.1f} px/s")
    lines.append(f"扩张速度 范围 [{min(vs):.1f}, {max(vs):.1f}] px/s")

# ---------- 2. 垂直剖面：测下落 ----------
lines.append("")
lines.append("=== 垂直剖面平移（测下落弹幕速度）===")
def y_profile(arr):
    # 底部区域的白/橙小弹
    sub = arr[int(H * 0.45):, :, :]
    r = sub[:, :, 0].astype(np.float32)
    g = sub[:, :, 1].astype(np.float32)
    b = sub[:, :, 2].astype(np.float32)
    bright = np.clip((r + g + b) / 3 - 60, 0, 255)
    return bright.mean(axis=1)

yprofs = {}
for i in seg:
    yprofs[i] = y_profile(crop_img(frames[i]))

lines.append("用相邻帧的垂直剖面做互相关，求下移量：")
lines.append("idx  dy(px)  dt(s)  speed(px/s)")
ys = []
for a, b in zip(list(seg), list(seg)[1:]):
    pa, pb = yprofs[a], yprofs[b]
    best, bdy = None, 0
    for dy in range(0, 60):
        if dy == 0:
            d = float(np.abs(pa - pb).mean())
        else:
            d = float(np.abs(pa[dy:] - pb[:-dy]).mean())
        if best is None or d < best:
            best, bdy = d, dy
    dt = durs[b] / 1000.0
    v = bdy / dt if dt > 0 else 0
    ys.append((b, bdy, dt, v))
    lines.append(f"{b:4d}  {bdy:5d}  {dt:5.2f}  {v:9.1f}")

if ys:
    vs = [v for _, _, _, v in ys if v > 0]
    if vs:
        lines.append("")
        lines.append(f"下落速度 均值 {np.mean(vs):.1f} px/s, 中位数 {np.median(vs):.1f} px/s")

with open(os.path.join(OUT, "_precise.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("\n".join(lines))
