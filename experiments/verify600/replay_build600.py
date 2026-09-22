# -*- coding: utf-8 -*-
"""独立重放验证：重跑 build_graph_600.py，比对是否位级复现 graph600.json。
会先备份原文件，跑完无论结果如何都恢复。"""
import hashlib, os, shutil, subprocess, sys, time

D = r'D:\苍蝇\public\data\connectome'
g = os.path.join(D, 'graph600.json')
m = os.path.join(D, 'manifest600.json')
gb, mb = g + '.verifybak', m + '.verifybak'

shutil.copy(g, gb)
shutil.copy(m, mb)
before = hashlib.sha256(open(g, 'rb').read()).hexdigest()
print('备份完成，重放前 graph600.json sha256 =', before)
print()

py = r'D:\苍蝇\_research\malecns\py312\python.exe'
script = r'D:\苍蝇\_research\malecns\build_graph_600.py'
t0 = time.time()
r = subprocess.run([py, script], capture_output=True, text=True,
                   encoding='utf-8', errors='replace',
                   cwd=r'D:\苍蝇\_research\malecns')
print('=== 构建脚本 stdout ===')
print(r.stdout)
if r.stderr.strip():
    print('=== stderr ===')
    print(r.stderr[-3000:])
print('returncode =', r.returncode, ' 耗时 %.1fs' % (time.time() - t0))
print()

after = hashlib.sha256(open(g, 'rb').read()).hexdigest()
print('重放后 graph600.json sha256 =', after)
print('>>> 位级复现:', before == after)

# manifest 也比对（去掉 hash 后逐字段比，因为 manifest 被后续脚本加过 roster）
orig_m = open(mb, encoding='utf-8').read()
new_m = open(m, encoding='utf-8').read()
print('>>> manifest600.json 是否逐字节相同:', orig_m == new_m)

# 恢复
shutil.move(gb, g)
shutil.move(mb, m)
final = hashlib.sha256(open(g, 'rb').read()).hexdigest()
print('已恢复备份，恢复后 sha256 =', final, '| 与原始一致:', final == before)
