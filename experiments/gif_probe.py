# -*- coding: utf-8 -*-
"""探针：检查帧尺寸、游戏区边界、紫色弹幕的 HSV 阈值是否合适。"""
import os
from PIL import Image
import numpy as np

FRAMES = r'D:\苍蝇\experiments\gif_frames'

# 取实战段的一帧
for name in ['f0117.png', 'f0130.png']:
    p = os.path.join(FRAMES, name)
    im = Image.open(p).convert('RGB')
    a = np.asarray(im).astype(np.float32)
    h, w, _ = a.shape
    print(f'=== {name}  size={w}x{h}')

    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]

    # 紫色判据：蓝高、红中高、绿低
    purple = (B > 90) & (R > 60) & (G < R - 15) & (B > G + 40)
    print('  purple px:', int(purple.sum()), f'({purple.mean()*100:.2f}%)')

    ys, xs = np.nonzero(purple)
    if len(xs) > 0:
        print(f'  purple bbox x[{xs.min()},{xs.max()}] y[{ys.min()},{ys.max()}]')
        print(f'  purple centroid ({xs.mean():.1f}, {ys.mean():.1f})')

    # 白色/亮色子弹（外围下落幕）
    bright = (R > 200) & (G > 200) & (B > 200)
    print('  bright px:', int(bright.sum()), f'({bright.mean()*100:.2f}%)')

    # 采样中心行/列，找游戏区左右边界（弹幕区域通常有暗底）
    mid = a[h // 2]
    lum = mid.mean(axis=1)
    print(f'  mid-row lum min={lum.min():.1f} max={lum.max():.1f} mean={lum.mean():.1f}')

    # 看看整体亮度分布，判断游戏区
    rowlum = a.mean(axis=(1, 2))
    print('  row lum: top5=', np.round(rowlum[:5], 1), ' bot5=', np.round(rowlum[-5:], 1))
