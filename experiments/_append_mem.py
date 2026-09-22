import io

note = """

---

## 22:35 界面优化审查 + 给外部 AI 的任务书

用户提供界面截图，问 02 连接组卡片留白问题。实测确认后产出任务书（用户要求不自己动手改，因项目由另一个 AI 维护）。

### 几何实测
- 卡片容器约 528 x 350px（grid-template-columns: 490px 1fr 1fr，gap 18，measure 1600）
- 减 panel-head(42) + panel-foot(40) 后净内容区 = 528 x 268px
- 画布声明 480 x 320 → 高度溢出被压缩，左右各空约 63px
- 二次留白根因：brain_view.js 的 layoutNodes() 第 52-53 行又乘了 scaleX=0.68 / scaleY=0.66 收缩，人为制造 30% 留白

### 发现的口径问题
1. index.html 第 941 行标题标 "1,296 SYNAPSES"，但 brain_view.js 第 151 行 i += 2 只渲染 648 条
2. index.html 第 1117/1137 行硬编码 21.72s / 4.25s，checkpoint 实际是 24.36s / 4.25s（app.js 67-86 行有动态覆盖，但首屏会闪错值）
3. app.js 第 599 行 GF Evasions 直接复用 graze（与 Graze 卡重复）；561-567 行 Spike Rate 实为 |activity| > 0.4 阈值计数，非真实 spike
4. 浏览器端 "Step 1 Generation" 只是在 weights 上加 (random-0.5)*0.08 噪声（app.js 322-330），并非界面宣称的 CEM

### 产出物
D:\\苍蝇\\experiments\\任务书_连接组卡片填充.md （可直接复制给那个 AI）

内容：方案 A（保守式）——不动布局结构，补充两层真实数据
- 改动1 底部细胞类型图例条：INFLOW / BRIDGE / MOTOR 三行 + hover 高亮同 type 节点
- 改动2 实时活动直方图：80 细胞 |activity|，绿正(#4ade80) / 橙负(#f97316)，对齐 flydino 口径
- 改动3 修正边数口径（全量渲染 或 标注 648 RENDERED）
- 改动4 调整 layoutNodes 收缩比例（0.68->0.82, 0.66->0.72, centerY 0.52->0.46）+ 画布改 520x300

### 已实测 graph.json 分布（写入任务书，供 AI 直接引用）
- role: input 32 / interneuron 32 / output 16，共 80 节点 / 1296 边
- input 8 种各 4 个：LC4 LC11 LC9 LC15 LC16 LC17 LC21 LPLC2（ch0-7 一一对应）
- output 12 种 16 个：DNp01/pIP1/DNp27/DNp35/DNp09/DNp02/DNp06/DNp11/DNp04/DNpe052/DNp03/DNg40
- interneuron 24 种 32 个（PVLP151 x4 最多）
- nt: acetylcholine 61 / gaba 13 / glutamate 5 / unclear 1
- sign: +1 61 / -1 18 / 0 1
"""

p = "experiments/journal/2026-09-14.md"
with io.open(p, "a", encoding="utf-8") as f:
    f.write(note)
with io.open(p, encoding="utf-8") as f:
    print("new len:", len(f.read()))
