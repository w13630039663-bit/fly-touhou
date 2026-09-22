import io, sys, re, os
p = r"D:\苍蝇\experiments\_train600.txt"
raw = open(p, "rb").read()
print("size:", len(raw))
print("first 32 bytes:", raw[:32])
# 探测编码
for enc in ("utf-8", "utf-16-le", "utf-16", "gbk"):
    try:
        t = raw.decode(enc)
        print(f"\n=== decode with {enc} OK (len={len(t)}) ===")
        break
    except Exception as e:
        print(f"decode {enc} failed: {e}")
else:
    t = raw.decode("utf-8", errors="replace")

# 去掉 ANSI 与 \r
t = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", t)
lines = [l.rstrip() for l in t.split("\n")]
print("total lines:", len(lines))
print("\n----- 第 40 行起（过滤掉重复的连接组初始化行）-----")
for l in lines[40:]:
    if "成功初始化连接组" in l:
        continue
    print(l)
