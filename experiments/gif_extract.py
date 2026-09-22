"""
从东方星莲船录屏 GIF 中抽取游戏画面区域，用于分析弹幕运动。

GIF 尺寸 812x948，其中包含游戏窗口 + 右侧信息栏 + 背景图。
需要先定位游戏画面的边界，再逐帧导出。
"""
import os
import sys
from PIL import Image, ImageSequence

SRC = r"C:/Users/leimi/Desktop/QQ20260914-231559.gif"
OUT = r"D:/苍蝇/experiments/gif_frames"
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC)
print("size:", im.size, "n_frames:", getattr(im, "n_frames", 1))

frames = []
durations = []
for idx, frame in enumerate(ImageSequence.Iterator(im)):
    durations.append(frame.info.get("duration", 0))
    frames.append(frame.convert("RGB").copy())

print("extracted:", len(frames))
print("duration ms list (first 20):", durations[:20])

# 导出前 N 帧和若干关键帧用于目视定位
idxs = list(range(0, min(24, len(frames))))
step = max(1, len(frames) // 16)
idxs += list(range(0, len(frames), step))
idxs = sorted(set(i for i in idxs if i < len(frames)))

manifest = []
for i in idxs:
    p = os.path.join(OUT, f"f{i:04d}.png")
    frames[i].save(p)
    manifest.append((i, durations[i], p))

with open(os.path.join(OUT, "_manifest.txt"), "w", encoding="utf-8") as f:
    for i, d, p in manifest:
        f.write(f"{i}\t{d}\t{p}\n")

print("saved", len(manifest), "frames to", OUT)
