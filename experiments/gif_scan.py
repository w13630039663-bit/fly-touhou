"""
扫描整个 GIF，找出场景切换点（通过帧间差异）。
GIF 是混剪：暂停画面 / 符卡演出 / 实际对战 混杂。
"""
import os
import numpy as np
from PIL import Image, ImageSequence

SRC = r"C:/Users/leimi/Desktop/QQ20260914-231559.gif"
OUT = r"D:/苍蝇/experiments/gif_frames"

im = Image.open(SRC)
frames = []
durs = []
for fr in ImageSequence.Iterator(im):
    durs.append(fr.info.get("duration", 0))
    frames.append(fr.convert("L").copy())

# 缩到小尺寸算差异，快且稳
small = [np.asarray(f.resize((128, 150)), dtype=np.float32) for f in frames]

diffs = [0.0]
for i in range(1, len(small)):
    d = np.abs(small[i] - small[i - 1]).mean()
    diffs.append(float(d))

lines = []
lines.append(f"总帧数 {len(frames)}")
lines.append("")
lines.append("idx  duration_ms  mean_abs_diff")
for i, (d, dd) in enumerate(zip(durs, diffs)):
    flag = ""
    if dd > 25:
        flag = "  <<< 大跳变"
    elif dd > 12:
        flag = "  << 中变化"
    lines.append(f"{i:4d}  {d:5d}  {dd:8.2f}{flag}")

# 保存关键跳变帧
jumps = [i for i in range(1, len(diffs)) if diffs[i] > 25]
lines.append("")
lines.append("大跳变帧: " + ",".join(str(j) for j in jumps))

for j in jumps:
    for k in (max(0, j - 1), j, min(len(frames) - 1, j + 1)):
        p = os.path.join(OUT, f"jump_{k:04d}.png")
        frames[k].save(p)

with open(os.path.join(OUT, "_scenes.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print("\n".join(lines[:40]))
print("...")
print("saved scene scan")
