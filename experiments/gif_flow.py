"""
对符卡实战片段做帧间差分，测量弹幕位移速度。

关键约束（必须先想清楚，否则会得出错误结论）：
1. GIF 是录屏，帧间时间不均匀（60/70/130/140ms 混用），无法直接换算游戏内 px/frame
2. 但可以算出「每个 GIF 帧间隔内的像素位移」→ 再折算成 px/秒
3. 用亮斑质心法：紫色珠链的亮斑是孤立的，容易检测
4. 由于相机/画面固定（无镜头移动），位移纯粹来自弹幕运动

输出：
- 逐帧的亮点质心位移场
- 推算的径向扩张速度（螺旋弹幕）
- 推算的向下漂移速度（下落弹幕）
"""
import os
import numpy as np
from PIL import Image, ImageSequence

SRC = r"C:/Users/leimi/Desktop/QQ20260914-231559.gif"
OUT = r"D:/苍蝇/experiments/gif_analysis"
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC)
frames = []
durs = []
for fr in ImageSequence.Iterator(im):
    durs.append(fr.info.get("duration", 0))
    frames.append(fr.convert("RGB").copy())

lines = []
lines.append(f"总帧数: {len(frames)}, 尺寸: {frames[0].size}")

# 游戏画面区域估算：去掉外围背景和底部条
# 从 f0117 看，游戏区大约 x:[10,800], y:[10,880]
GY0, GY1 = 10, 880
GX0, GX1 = 10, 800

def crop(a):
    return a[GY0:GY1, GX0:GX1]

def detect_purple(arr):
    """检测紫色珠链的亮斑（高 R 高 B 低 G）。返回质心与面积。"""
    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)
    # 紫色/粉色珠：R 高，B 高，G 低
    mask = (r > 150) & (b > 150) & (g < r - 30) & (g < b - 30)
    return mask

# 取一段连续且变化剧烈的片段（帧 113-140 是大跳变区，弹幕运动明显）
seg_start, seg_end = 113, 141
lines.append("")
lines.append("=== 紫色弹幕像素占比（判断密度变化）===")
lines.append("idx  dur_ms  purple_px  ratio%")

prev_mask = None
flow = []
for i in range(seg_start, seg_end):
    arr = np.asarray(frames[i], dtype=np.uint8)
    a = crop(arr)
    m = detect_purple(a)
    px = int(m.sum())
    ratio = px / m.size * 100
    lines.append(f"{i:4d}  {durs[i]:5d}  {px:9d}  {ratio:6.2f}")

    # 用图像互相关估计整体位移
    if prev_mask is not None:
        # 计算垂直方向的位移：把当前帧与前一帧在 y 方向做相关
        a_cur = a[:, :, 2].astype(np.float32)  # 蓝色通道，珠子最亮
        a_prev = prev_arr[:, :, 2].astype(np.float32)
        best, bestdy = None, 0
        for dy in range(0, 41, 2):
            if dy == 0:
                d = np.abs(a_cur - a_prev).mean()
            else:
                d = np.abs(a_cur[dy:, :] - a_prev[:-dy, :]).mean()
            if best is None or d < best:
                best, bestdy = d, dy
        flow.append((i, durs[i], bestdy, best))
    prev_arr = a

lines.append("")
lines.append("=== 图像下移量估计（dy>0 表示内容整体下移）===")
lines.append("idx  dur_ms  best_dy  resid")
for i, d, dy, r in flow:
    lines.append(f"{i:4d}  {d:5d}  {dy:6d}  {r:7.2f}")

# 汇总统计
dys = [dy for _, _, dy, _ in flow]
durs_f = [d for _, d, _, _ in flow]
if dys:
    # px per second（用 GIF 的时间轴）
    rates = []
    for (i, d, dy, r) in flow:
        if d > 0:
            rates.append(dy / (d / 1000.0))
    lines.append("")
    lines.append(f"下移量 dy 均值: {np.mean(dys):.2f} px/帧")
    lines.append(f"估计速度: {np.mean(rates):.1f} px/秒 (基于 GIF 时间轴)")
    lines.append(f"速度中位数: {np.median(rates):.1f} px/秒")

with open(os.path.join(OUT, "_flow.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("\n".join(lines))
