# -*- coding: utf-8 -*-
"""
符卡参数校验器
用途：其他 AI 改完 danmaku.js 后，跑这个脚本，检查关键参数是否符合实测值。

用法：
  python 符卡参数校验.py
  python 符卡参数校验.py --file D:\\苍蝇\\src\\game\\danmaku.js
"""
import re
import sys
import os

# ============ 实测基准值（画布坐标 460x580）============
BASELINE = {
    'spiralArms':     {'expect': 6,    'tol': 0,    'label': '螺旋臂数'},
    'armSpacing':     {'expect': 12.4, 'tol': 2.5,  'label': '圈间距(px)'},
    'cycleTime':      {'expect': 3.74, 'tol': 0.8,  'label': '符卡周期(s)'},
    'fallSpeed':      {'expect': 61,   'tol': 15,   'label': '下落速度(px/s)'},
    'bodyRadius':     {'expect': 189,  'tol': 40,   'label': '主体半径(px)'},
    'maxRadius':      {'expect': 304,  'tol': 60,   'label': '最大半径(px)'},
    'bulletRadius':   {'expect': 3.2,  'tol': 1.2,  'label': '珠子半径(px)'},
    'rotationSpeed':  {'expect': 120,  'tol': 45,   'label': '螺旋转速(°/s)'},
    'fireInterval':   {'expect': 0.22, 'tol': 0.10, 'label': '发射间隔(s)'},
}

# 常见的关键词别名（AI 可能用不同命名）
ALIASES = {
    'spiralArms':    [r'\barms?\b', r'spiralArms?', r'armCount', r'臂数'],
    'armSpacing':    [r'armSpacing', r'ringSpacing', r'spiralSpacing', r'圈间距'],
    'cycleTime':     [r'cycleTime', r'spellCycle', r'cycleDur', r'周期'],
    'fallSpeed':     [r'fallSpeed', r'fallVel', r'fallSpeedPx', r'下落速度'],
    'bodyRadius':    [r'bodyRadius', r'coreRadius', r'innerRadius'],
    'maxRadius':     [r'maxRadius', r'outerRadius', r'spiralRadius'],
    'bulletRadius':  [r'bulletRadius', r'beadRadius', r'珠子半径'],
    'rotationSpeed': [r'rotationSpeed', r'spinSpeed', r'omega', r'角速度'],
    'fireInterval':  [r'fireInterval', r'spawnInterval', r'emitInterval', r'发射间隔'],
}


def extract(src, key):
    """尝试从源码中找出该参数的值。"""
    pats = ALIASES.get(key, [key])
    for p in pats:
        # 匹配:  标识符 : 数字   /   标识符 = 数字   /   const 标识符 = 数字
        for m in re.finditer(
            p + r'\s*[:=]\s*(-?\d+(?:\.\d+)?)',
            src, re.IGNORECASE
        ):
            try:
                return float(m.group(1)), m.group(0)[:70]
            except ValueError:
                pass
    return None, None


def main():
    path = r'D:\苍蝇\src\game\danmaku.js'
    if '--file' in sys.argv:
        i = sys.argv.index('--file')
        if i + 1 < len(sys.argv):
            path = sys.argv[i + 1]

    if not os.path.exists(path):
        print(f'❌ 找不到文件: {path}')
        print('   用 --file 指定正确路径')
        return 1

    src = open(path, encoding='utf-8', errors='ignore').read()
    lines = src.count('\n')
    print('=' * 64)
    print('符卡参数校验器 —— 大輪「ハロウフォゴットンワールド」')
    print('=' * 64)
    print(f'目标文件: {path}')
    print(f'文件行数: {lines}')
    print()
    print(f'{"参数":<16} {"实测基准":>10} {"容差":>7} {"检出值":>10}  判定')
    print('-' * 64)

    found = 0
    ok = 0
    for key, b in BASELINE.items():
        val, ev = extract(src, key)
        if val is None:
            print(f'{b["label"]:<16} {b["expect"]:>10} {b["tol"]:>7} '
                  f'{"未检出":>10}  ⚠️')
            continue
        found += 1
        passed = abs(val - b['expect']) <= b['tol']
        if passed:
            ok += 1
        mark = '✅ 合格' if passed else '❌ 偏离'
        # 中文字符宽度补偿
        pad = 12 - sum(2 if ord(c) > 127 else 1 for c in b['label']) // 1
        print(f'{b["label"]:<16} {b["expect"]:>10} {b["tol"]:>7} '
              f'{val:>10}  {mark}')

    print('-' * 64)
    print(f'检出 {found}/{len(BASELINE)} 项，其中 {ok} 项在容差内')
    print()

    if found == 0:
        print('提示：一个参数都没检出，可能原因：')
        print('  1. AI 还没开始改代码')
        print('  2. 参数用了非常规命名 —— 请把参数名加到脚本的 ALIASES 里')
        print('  3. 参数是硬编码在生成逻辑里而非常量')
    elif ok == found:
        print('🎉 全部合格！参数与实测值一致。')
    else:
        print('⚠️  有参数偏离实测值。若是有意调整手感则忽略；')
        print('   若是误用 GIF 原始像素(780x810)而非画布坐标(460x580)，')
        print('   请检查缩放系数: 0.5898(横) / 0.6373(纵)')

    print()
    print('参考换算表：')
    print('  GIF(780x810) → 画布(460x580)')
    print('    圈间距      21.0 px → 12.4 px')
    print('    主体半径   320.0 px → 189 px')
    print('    最大半径   516.0 px → 304 px')
    print('    珠子半径     5.5 px → 3.2 px')
    print('    下落速度   104 px/s → 61 px/s')
    return 0


if __name__ == '__main__':
    sys.exit(main())
