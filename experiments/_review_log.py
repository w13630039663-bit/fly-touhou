# _review_log.py — 解码 UTF-16 训练日志并抓取关键数字
import io, re, sys
p = r"D:\苍蝇\experiments\_train600.txt"
raw = open(p, "rb").read()
print("bytes:", len(raw))
# 探测编码
enc = None
for e in ("utf-16", "utf-16-le", "utf-16-be", "utf-8"):
    try:
        t = raw.decode(e)
        # 若解出大量可见字符则认为成功
        printable = sum(1 for c in t[:2000] if c.isprintable() or c in "\r\n\t")
        if printable > len(t[:2000]) * 0.8:
            enc = e
            break
    except Exception:
        pass
print("detected encoding:", enc)
txt = raw.decode(enc, errors="replace")
txt = txt.replace("\x00", "")
lines = [l.rstrip() for l in txt.splitlines() if l.strip()]
print("lines:", len(lines))
print("\n----- 前 15 行 -----")
for l in lines[:15]:
    print(l)
print("\n----- 后 40 行 -----")
for l in lines[-40:]:
    print(l)

# 抓关键数字
print("\n===== 关键数字抓取 =====")
for pat in [r"1080", r"1097", r"1130", r"1020", r"23\.4", r"8\.5", r"51\.7", r"8\.4", r"p\s*=\s*0\.\d+", r"对照", r"Control", r"平台", r"topologyAdvantage", r"显著"]:
    hits = [l for l in lines if re.search(pat, l)]
    if hits:
        print(f"\n[{pat}] {len(hits)} 处:")
        for h in hits[:8]:
            print("   ", h[:160])
    else:
        print(f"[{pat}] 无")
