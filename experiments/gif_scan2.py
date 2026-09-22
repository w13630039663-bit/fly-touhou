# -*- coding: utf-8 -*-
"""重新抽帧：把符卡实战段密集导出（每帧都导），供逐帧差分分析。"""
import os
from PIL import Image
import numpy as np

SRC = r'D:\苍蝇\experiments\QQ20260914-231559.gif'
FULL = r'D:\苍蝇\experiments\gif_full'      # 全帧，每帧一张
os.makedirs(FULL, exist_ok=True)

im = Image.open(SRC)
n = getattr(im, 'n_frames', 1)
print('总帧数:', n)

durs = []
for i in range(n):
    im.seek(i)
    durs.append(im.info.get('duration', 70))

# 先扫描：找出「符卡实战段」的帧范围
# 判据：画面中同时存在大量珠链像素（紫/白）
prev_arr = None
stats = []
for i in range(n):
    im.seek(i)
    fr = im.convert('RGB').copy()          # 必须 copy，seek 会复用缓冲
    a = np.asarray(fr).astype(np.float32)
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    white = (R > 215) & (G > 195) & (B > 215)
    purple = (B > 130) & (B > G + 45) & (R > 70) & (R < 235)
    chain = float((white | purple).mean())
    # 屏幕下方 1/3 的弹幕密度（下落幕）
    lower = float(((white | purple)[int(a.shape[0]*0.6):]).mean())
    stats.append((i, durs[i], chain, lower))

with open(os.path.join(FULL, '_stats.txt'), 'w', encoding='utf-8') as f:
    f.write('idx\tdur\tchain%\tlower%\n')
    for i, d, c, lo in stats:
        f.write(f'{i}\t{d}\t{c*100:.2f}\t{lo*100:.2f}\n')

print('已写入 _stats.txt，共', len(stats), '帧')
print('\n全帧链像素占比（每 5 帧采样）:')
for i, d, c, lo in stats[::5]:
    bar = '#' * int(c * 200)
    print(f'  {i:3d} {d:3d}ms chain={c*100:5.2f}% lower={lo*100:5.2f}%  {bar}')
