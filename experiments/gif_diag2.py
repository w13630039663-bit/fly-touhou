# -*- coding: utf-8 -*-
"""诊断：为什么互相关总是 0。先看相邻帧到底差多少。"""
import os
import numpy as np
from PIL import Image

SEQ = r'D:\苍蝇\experiments\gif_seq'
idxs = [74, 75, 76, 77, 78, 79, 80]

arrs = {}
for i in idxs:
    p = os.path.join(SEQ, f's{i:04d}.png')
    arrs[i] = np.asarray(Image.open(p).convert('RGB')).astype(np.float32)

print('相邻帧的 mean |diff|（全画面）:')
for a, b in zip(idxs[:-1], idxs[1:]):
    d = np.abs(arrs[a] - arrs[b]).mean()
    print(f'  s{a:04d} -> s{b:04d}: {d:8.3f}')

print()
print('任意相隔帧（s0074 vs X）:')
for b in idxs[1:]:
    d = np.abs(arrs[74] - arrs[b]).mean()
    print(f'  s0074 -> s{b:04d}: {d:8.3f}')

# 看看紫色掩码的差异
def chain(a):
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    white = (R > 210) & (G > 190) & (B > 210)
    purple = (B > 125) & (B > G + 40) & (R > 60) & (R < 240)
    return (white | purple)

print()
print('链掩码的 IoU:')
for a, b in zip(idxs[:-1], idxs[1:]):
    ma, mb = chain(arrs[a]), chain(arrs[b])
    inter = (ma & mb).sum(); union = (ma | mb).sum()
    print(f'  s{a:04d} vs s{b:04d}: IoU={inter/max(union,1):.3f}  '
          f'A={ma.sum()} B={mb.sum()} inter={inter}')
