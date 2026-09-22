# 项目完整交接与上下文恢复文档 (Project Handover Document)

> **生成时间**：2026-09-15  
> **适用场景**：新建对话上下文后无缝衔接当前代码库、逆向成果与待解决问题。

---

## 一、项目全貌与核心架构 (Architecture Overview)

本项目包含两大核心模块，通过一套统一的 HTML5 Canvas + WebAudio 弹幕游戏引擎深度结合：

```
                              ┌────────────────────────────────────────┐
                              │           果蝇大脑连接组 AI             │
                              │ 80 神经元 · 1296 突触 · 320 策略权重    │
                              └──────────────────┬─────────────────────┘
                                                 │ 360° 视网膜雷达输入 (16维)
                                                 ▼
┌───────────────────────────────┐          ┌───────────────────────────┐
│     东方紅魔郷 原作逆向资产     │          │    弹幕避障与符卡挑战引擎   │
│ • th06 解包 (ECL 字节码/ANM)   ├─────────►│ • Canvas 60FPS 物理驱动    │
│ • 原版 32-bit BGRA DDS 纹理   │          │ • 动态难度平滑爬升 (0.18) │
│ • ZUN 原版 WAV 音效矩阵       │          │ • 自由生存特训模式        │
└───────────────────────────────┘          └─────────────┬─────────────┘
                                                         │
                                         ┌───────────────┴───────────────┐
                                         ▼                               ▼
                           【主工程：果蝇连接组平台】          【独立单文件复刻页】
                           • D:\苍蝇\                         • th06\hailstorm.html
                           • http://localhost:3000            • th06\red_netherworld.html
```

### 1. 核心目录与关键路径
- **主工程根目录**：`D:\苍蝇`
  - `src/game/danmaku.js`：弹幕物理与渲染总引擎
  - `src/game/spellcards/hailstorm.js`：琪露诺一符 雹符「Hailstorm」ECL 状态机
  - `src/game/spellcards/red_netherworld.js`：蕾米莉亚一符 冥符「紅色の冥界」ECL 状态机
  - `src/neural/`：果蝇连接组网络（80 节点 LIF 神经元仿真、320 权重无偏置 ReadoutPolicy）
  - `public/images/`：`cirno_boss.png`, `remilia_boss.png`, `etama3.png`, `boss_emitter.png`
  - `public/audio/`：原版音效（`tan00.wav`, `kira00.wav`, `enep00.wav`, `damage00.wav`, `graze.wav`, `pldead00.wav`）
  - `index.html`：前端面板，搭载符卡下拉切换与动态难度显示
  - `test_integration.js` & `test_red_netherworld.js`：无头端到端回归测试套件
- **TH06 解包与逆向分析工作区**：`C:\Users\leimi\WorkBuddy\2026-09-15-00-26-07\th06`
  - `out/th06ST/ecldata*.ecl`：原作各关卡 ECL 字节码脚本
  - `out/th06CM/`：`etama*.dds`, `etama*.anm`（弹幕贴图库与切片动画）
  - `out/th06IN/localization.msgpack`：原作多语言符卡注册名与文本
  - `hailstorm.html`：琪露诺雹符独立可玩页（附带 ECL 源码实时高亮追踪）
  - `red_netherworld.html`：蕾米莉亚冥符独立可玩页（附带 ECL 源码实时高亮追踪）
  - `Hailstorm_符卡逆向分析.md`：解包工具与 ECL 指令集逆向分析手册

---

## 二、已完成的核心工作 (Completed Work)

### 1. 模式精简与全局难度系统调优
- **移除冗余模式**：彻底下线了用户要求删除的“自由生存特训（点击切换穿越闯关）”模式切换，使游戏纯粹聚焦于果蝇连接组的视觉避障与弹幕符卡试炼；
- **全符卡起步大幅降压**：
  - 起始难度倍率下调至 **0.18**（入门微风起步），爬升周期拉长至 60 秒平滑缓升（`mult = 0.18 + 0.82 * Math.pow(progress, 1.2)`）；
  - 符卡 1（环状扩散）、符卡 2（自机狙）、符卡 3（双螺旋）开局均大幅减少弹量、放慢初速、开局前 15 秒禁用干扰弹，留出极宽大的逃逸安全空间。

### 2. 二面 Boss 琪露诺一符 雹符「Hailstorm」复刻
- **逆向解密**：`ecldata2.ecl` 中的 `Sub 34`（宣言）与 `Sub 35`（弹幕本体）；
- **动画与切片**：提取 `stg2enm2.dds` $\to$ `cirno_boss.png`（4 帧浮空振翅 + 抬手施法帧），提取 `etama3.dds` 冰晶针弹；
- **真实动力学**：出膛阻尼减速（0.965）$\to$ 60 帧急停凝结为冰霜云团 $\to$ `kira00` 空灵冰铃音触发全体转向下落；
- **用户专属调优**：每环弹数从 8+ 发精简至 3 发（120° 巨大安全角），低难度下单圈不重叠，下落速度放缓至 0.92 px/f。

### 3. 六面 Boss 蕾米莉亚一符 冥符「紅色の冥界」[Normal] 复刻
- **逆向解密**：
  - `ecldata6.ecl` `Sub 39`（符卡宣言，注册 ID: 106）；
  - `ecldata6.ecl` `Sub 40`（弹幕主循环）：6 次连发脉冲（21 帧/周期）+ 滑行 90 帧（**与发弹并行，不停火**；旧记录写的"90 帧移位停顿"是错的，见 §3bis）；
- **贴图资产提取**：
  - 提取 `stg6enm2.dds` $\to$ `remilia_boss.png`（2048×2048 高清 32-bit 透明 PNG）；
  - 提取 Script 160 完整的 6 帧浮空振翅待机帧（Sprites 179~184，每帧 230×230 像素）；
  - 提取 Script 166 展翅施法帧（Sprites 193~197）；
  - 绘制双层同心猩红恶魔魔法阵（绯红双环 + 4 组蝠翼星印 + 8 颗红宝石血核公转）；
  - 提取 `etama3.dds` 弹体精灵：`spr=2,col=2` → **def 48**（RICE 族长针，实心 16×36）、`spr=5,col=2` → **def 96**（SHARD 族细针，实心 14×34），两者均 **autoRotate**（解析规则见 §3bis；旧文档"红色小玉 18×18 + 红色米粒"是按肉眼取的，弹型族号错了）；
- **双轨交付与验证**：
  - 主工程：新增 [red_netherworld.js](file:///D:/苍蝇/src/game/spellcards/red_netherworld.js)，并在 [danmaku.js](file:///D:/苍蝇/src/game/danmaku.js) 中注册为符卡 4，下拉菜单中英文多语言同步更新；
  - 独立页：生成 [red_netherworld.html](file:///C:/Users/leimi/WorkBuddy/2026-09-15-00-26-07/th06/red_netherworld.html)，支持键盘操控与 ECL 指令级追踪；
  - 自动化回归测试：`node test_integration.js` 与 `node test_red_netherworld.js` 全部通过（0 错误）。

---

## 三、待解决的关键问题与深度复盘 (Current Issues & Findings)

> [!IMPORTANT]
> **本节 4 条推测已被逐条取证验证：第 2/3/4 条被推翻，第 1 条方向对但结论错。**
> 最终结论、证据链与已落地的修正见文末 **「§3bis 取证终局结论（2026-09-15，以此为准）」**。
> 本节原文保留，仅作为当时的推测记录。

（以下为原始推测，未经证实。）

### 1. 弹型与配色（Sprite & Color）映射可能存在偏差
- **当前做法**：从 `etama3.png` 提取了 `spr=2`（红色小球，18×18）与 `spr=5`（红色米粒，32×36）。
- **原版实际细节**：
  - 在《东方红魔乡》原作中，`et_set_eqdistr(spr, col, ...)` 中的 `spr` 和 `col` 并非简单的二维贴图坐标！
  - 原版 `etama.dds` / `etama2.dds` / `etama3.dds` 针对不同 stage 有独立的色板（Palette）或不同的子弹类型表。
  - 在 Stage 6 蕾米莉亚的「紅色の冥界」中，小球并不是实心小红球，而是**边缘带淡红色光晕、中心透明度较高的光玉**；下落的米粒弹（降下弾）也不是普通暗红针，而是**深红带明亮粉白高光的菱形锐针**。

### 2. 旋转弹与下落弹的运动学方程差异
- **当前做法**：在 JS 中通过逐帧累加速度向量 `b.vx = cos(ang)*spd; b.vy = sin(ang)*spd`，并通过简单的 `diff` 逼近正下方。
- **原版 ECL 物理引擎（Sub 40 反汇编细节）**：
  ```
  @0030  et_extra(a=128, b=-1, c=-1, d=-1, r=0.000, s=0.025)
  @005c  et_set_eqdistr(spr=2, col=2, num1=24, num2=1, spd1=1.800, spd2=1.000, ang1=%-10005, ang2=-0.016, flags=0x220)
  ```
  - **`ang2 = -0.016` 的作用**：在原版 ECL 中，`ang2` 是**单环内相邻子弹的附加角加速度或微小螺旋偏转**！当前实现中直接忽略了 `ang2 = -0.016`，导致交错网的倾斜弧度与原版不对齐！
  - **`flags = 0x220` 的真实语义**：
    - `0x020`：表示发射时以 BOSS 当前位置为圆心的相对极坐标发散；
    - `0x200`：表示子弹在飞行中**其旋转角速度是随时间衰减还是恒定角动量**（在原版游戏里，交错弹先是大幅弧形扩展，随着半径增大，角速度视觉上被拉伸为整齐的笔直交叉射线）。而当前实现使用固定角速度旋转 130 帧，导致子弹轨迹呈现“弯曲蚊香盘”形状，而不是原版那种“笔直的菱形交叉光束”！
  - **下落弹 `flags = 0x210` 与 `et_extra(a=240, b=-1, r=0.020, s=1.571)`**：
    - 原版中并不是从出膛第一帧就开始拐弯，而是**直飞出膛一段距离后，在空中如同被重力场捕获，画出一道极其平滑优美的抛物线，随后笔直下坠**！

### 3. 出膛原点与视觉纵横比（Aspect Ratio & Emitter Offset）
- **当前做法**：所有子弹均从 Boss 的坐标中心 `(boss.x, boss.y)` 单点发射。
- **原版视觉**：
  - 蕾米莉亚发弹时并非从身体中心发弹，而是从其**张开的巨大蝠翼双翼尖端**（或身体两侧光环）交替射出，出膛时自带一定的初始偏移半径（Spawn Radius）；
  - 原版游戏分辨率为 **640×480（Playfield 384×448）**，具有独特的垂直紧凑纵横比。当前项目画布为 `460×580`，如果未进行坐标归一化等比映射，视觉上的扩散角会发生变形。

### 4. 弹幕发光与图层混合模式（Blending Mode）
- 原版东方弹幕全部采用 **Direct3D 加色混合（Additive Blending / `ctx.globalCompositeOperation = 'lighter'`）**，子弹互相交错时交点会产生极度耀眼的高亮泛光白芯；
- 当前 Canvas 采用默认的 `source-over` 覆盖绘制，导致红色子弹叠加时变成浑浊的重叠色块，缺乏原版那种“红宝石般璀璨闪烁的魔幻感”。

---

## 三bis、取证终局结论（2026-09-15，**以此为准**）

### 证据来源（全部本地可复现，不再依赖二手转述）
| 材料 | 位置 | 说明 |
|---|---|---|
| `BulletManager.cpp` 1454 行 / `EclManager.cpp` 1043 行 / `EnemyEclInstr.cpp` 1234 行 | `_research/th06/pinned/`、`_research/th06/src/` | **GensokyoClub/th06 commit `f4285584736d35c9cf419e7399240fef3c9ac5be`**，逐文件 `SHA1("blob {len}\0"+bytes)` == GitHub blob sha 校验通过（BM `2c0b2193…`、EM `2e18be56…`、EEI `bf9aad21…`），行号即原文件行号 |
| ecldata6.ecl sub 38/39/40 反汇编 | `tools/ecl_sub38_40.txt` | `node tools/ecl_dis.mjs <ecl> 38 39 40` |
| 全游戏 191 个 opcode70 发射器 × 紧邻 opcode82 的配对统计 | `tools/ecl_scan_extra.mjs` | flags 分组：0x20 全部 `r=0,s=±π/128`；0x10 全部 `r≈0.01~0.024`；`-999` 为哨兵值 |
| ANM def 表 → 图集实像素（尺寸/不透明度/色调） | `tools/sprite_table.mjs` | 逐 def 实测 |
| ANM 脚本体（`0401 <def>` / `041a 1`） | `tools/anm_dump2.mjs` | 弹型族号与 autoRotate 位 |
| opcode 编号的决定性证据 | `EclManager.hpp` 钉版 L418/421/433 | 行尾注释 `ECL_OPCODE_BULLETFANAIMED // 0x43 / 67`、`ECL_OPCODE_BULLETCIRCLE // 0x46 / 70`、`ECL_OPCODE_BULLETEFFECTS // 0x52 / 82`；`aimMode = opCode - ECL_OPCODE_BULLETFANAIMED`（EclManager.cpp:369）⇒ op70 落 `case CIRCLE` 分支 |
| 帧时序闭环 | `Supervisor::TickTimer` + `ZunTimer.hpp:55-78` | 60fps 快路径每 Tick `current++`（`AsFramesFloat() = current + subFrame`）；`InitializeForPopup` 置 `current=0` ⇒ **运动恰好作用在 t = 0..ex5Int0-1 共 a 帧**，本项目以 `t = b.age - 1` 对齐 |

> 已作废的路线：`decomp-wiki.psicode.co.uk` 在本机 `getaddrinfo ENOTFOUND`，且所引 commit `184c3d3a…` 经 GitHub API 返回 **422 No commit found**；`Bullet_EmitMultiple` / `Ecl_Command_70_Bullet_EmitEqDistantAngled` / `coefficient_of_motion` / `rotation_speed` / `timer_1` 在上述真实语料中 **0 命中**。凡基于这套名字的结论一律不采信。

### 对 §3 四条推测的逐条裁定
| 条目 | 裁定 | 依据（行号均为上表 verbatim 副本） |
|---|---|---|
| 3.1 弹型/配色映射 | **方向对、结论错**：规则是 `精灵号 = BASE[spr] + col`，`BASE = {14,30,46,62,78,94,110,118,122,146}`。本卡应为 `spr=2`(RICE, base 46)`+col=2` → **def 48**（rect 430,254 32×36，实心 16×36 长针）与 `spr=5`(SHARD, base 94)`+2` → **def 96**（rect 67,221，实心 14×34 细针）。旧代码取的 `(746,254,18,18)` 是 **spr=0 PELLET 的圆玉**、`(34,221)` 是 **col=1**，两种弹都错；且两种弹的脚本都带 `041a 0001` ⇒ **都要 autoRotate**，旧代码的小玉完全不转 | `BulletManager.cpp` L286-287；`anm_dump2` scr2/scr5；两族色序逐位对齐（+1 白灰、+2 赤、+6 蓝紫）⇒ 规则成立 |
| 3.2 `ang2=-0.016` 造成螺旋 | **推翻**：`angle += idx1*ZUN_2PI/count1; angle += idx2*angle2 + angle1`，`idx2` 是**环号**；本卡 `num2=1` ⇒ `ang2` 与 `spd2` 都是死参数。环是严格等分的 24/16 道 | L148-149、L119 |
| 3.2 米弹"延迟后转向正下方" | **推翻**：`0x10` = **世界坐标恒定加速度** `ex4Acceleration = sincosmul(exFloats[1]=π/2, exFloats[0]=0.02)` ⇒ `(0,+0.02) px/f²` 持续 `a=240` 帧，`vx` 严格守恒 ⇒ 真抛物线。`0x20` = `angle += exFloats[1]; speed += exFloats[0]`（本卡 `r=0` ⇒ 匀速率、128 帧正好 **180°**，R=1.8/(π/128)=**73.34 px**） | L316-343、L724-749 |
| 3.3 出膛原点在翼尖 / 纵横比 | 原点部分 **推翻**：sub 39 `op 81 = et_ofc(0,0,0)` ⇒ `shootOffset=0`，出膛点 = `enemy->position + shootOffset` = BOSS 座标本身；待机位由 `move_to_decel(120, 192, 144)` 钉死。纵横比部分 **成立**：playfield 是 384×448，旧实现按画布 460×580 非等比拉伸 ⇒ 圆变椭圆 | L383；`tools/ecl_sub38_40.txt` @00dc/@0154 |
| 3.4 原作是加算混合 | **推翻**：弹体走 `SRCALPHA/INVSRCALPHA` 常规 alpha；加算只出现在 `Anm_SetBlend(1)` 的出现闪光/激光，而本卡 `flags=0x220/0x210` **没有** `0x2/0x4/0x8` 三个 `SPAWNING_*` 位 ⇒ 连生成白闪都不该画。`source-over` 本来就对 | flags 位表 L186/221/254 + `0x200` 仅 `PlaySoundByIdx` |

### 另外纠正两处文档自身的错
- `flags=0x220` 的 **`0x200` 与运动无关**，含义是"整环发射完后播放一次发弹音效"（本卡音效索引 23 由 sub 39 `op 84 raw 0x17` 设定）。
- 旧实现每大波后 `repositionTimer=90` **停火 90 帧**。本轮一度按「`jump_ex` 与滑行并行」把它删掉，但用户实机记忆 + `@022c stop_in_decel(90)`（`t=111`，晚于 6 次脉冲的发弹时刻）表明**波与波之间确实有发弹间隔** ⇒ 已恢复为「滑行 90 帧期间不增弹、刹停后开下一波」，一个大波 = 6×21 + 90 = 216 帧 ≈ 3.6 秒。`jump_ex` 的回跳计时语义仍有歧义，此处以实机手感为准。

### 已落地的修正
1. **`src/game/spellcards/red_netherworld.js` 重写**为 sub 40 的逐指令移植：4 个发射器落在脉冲内第 0/4/8/12 帧、周期 21 帧、6 次/大波、`base += π/32` **按发射器**推进（旧代码按脉冲推进 ⇒ 慢 4 倍是"蚊香"主因）、基准角每大波重掷 `rand(-π,π)`、BOSS 滑行与发弹并行、原点到 (192,144)、playfield 384×448 等比居中映射。
2. **`src/game/danmaku.js`**：删掉两条为冥符写的特判物理分支，换成与 `BulletManager::OnUpdate()` 同构的 `exFlags` 位链（`0x1 / 0x10 / 0x20` 互斥 else-if；`t = b.age - 1`；`t >= ex5Int0` 时清位、否则施加运动 ⇒ 运动恰好作用 `a` 帧）；剔除框改为 playfield 矩形 +16px（原作口径）；绘制按 `(spr,col)` 解析精灵、`autoRotate` 时旋转 `angle - π/2`、尺寸走 `TEX_SCALE = 0.5`（ANM 矩形是 2× 复刻纹理空间）。
3. **新增 `src/game/etama3.js`**：`BASE` 表 / `AUTO_ROTATE` 表 / def→矩形，单一真源，杜绝"目测取 atlas"。
4. **新增 `red_netherworld_preview.html`**：`import ./src/game/danmaku.js` 的实机预览页（与主程序同一份代码，无第二套实现），`http://localhost:3000/red_netherworld_preview.html`。
5. 新增工具：`tools/render_pattern.mjs`（离线弹图渲染，`--wave 0 --trace` 只画第一波的完整轨迹+最终位置）、`tools/verify_geom.mjs`（几何量化）、`tools/sprite_table.mjs`。

6. **固定 60Hz 仿真步进（`src/app.js` + 预览页）**：原写法「每个 requestAnimationFrame 帧推进一次」在 120/144Hz 显示器上会让整张符卡跑成 2~2.4 倍速 —— 这是用户反馈「有点太快了」的直接原因，与 ECL 数值无关。现改为按真实时间累积、固定 1/60 步推进；`simSpeed` 变成倍速旋钮，掉帧时丢弃追不上的时间（≤8 步/帧），预览页底部实时显示「屏幕刷新 Hz → 仿真 步/s」。
7. **恢复波间发弹间隔**：6 次脉冲打完后 BOSS 用 `stop_in_decel(90)` 的 90 帧滑行并刹停，期间不增弹 ⇒ 大波周期 216 帧 ≈ 3.6 秒。
8. **难度递进保留并加了等比时间缩放 k**：数量仍按 `mult`（0.35~1）削减；新增 `timeScale` 从 0.62（开局最慢）随 60 秒爬升线性恢复到 1.00（= 原作 1.8 / 2.2 px/f 口径）。缩放方式是速度×k、角速度×k、加速度×k²、运动持续帧数÷k ⇒ **轨迹几何逐点不变**（R=73.34px、总转角 180°、抛物线上升 120px），只是整段播得慢；`node tools/verify_timescale.mjs` 验证不变量。

### 量化验收（`node tools/verify_geom.mjs`）
- 弧弹：R = **73.34 px**、128 帧转角 **180.00°**、弦长 **146.68 = 2R**、弧后末段叉积 0（严格直线）、`0x20` 位自清除 ✓
- 米弹：240 帧后 `vy = 2.600`（解析值 2.600 ✓）、`vx` 恒定、上升段最高点第 **109** 帧（解析 110，同为显式欧拉步进）、上升 **121 px** ✓
- 晶格进动：**22.5°/脉冲 = 1.50 个环距**（错开编织）vs 旧 **5.6°/脉冲 = 0.37 个环距**（叠成蚊香）；单大波总扫 **135.0° vs 33.7°**
- 单弧转角 **180.0°** vs 旧 **186.2°**（过半圆回头压来路）
- 落雨 180 帧后平均 `|vx|` = **1.40 px/f**（雨幕张开）vs 旧 **≈0**（塌成竖直平行条）
- `node test_red_netherworld.js`、`node test_integration.js` 全绿；`mult=1` 在场弹体 500~660（每大波 6×(24+24+16+16)=480 发 + 跨波残留）✓

### 遗留待办（按优先级）
1. 雹符冰晶：按已证实规则 `(spr=5,col=6)` → **def 100** `149,217`，当前用 def 102 `215,217`（差 2 个色标）；且 `isHail` 仍写死 24×28 画布 px，应改用 `etama3Sprite(5,6)` + `ETK` 等比。
2. `0x40/0x80/0x100`（折线/自机狙/绝对角 + 段间线性降速）目前由旧 `b.turn` 通道近似；`0x400/0x800`（384×448 边界反弹）未实现。
3. 原作 rank 修正（`BulletRankAmount1/2`、`BulletRankSpeed`，符卡期 speed += rank/32 - 0.5）与本项目自定义的渐进 `mult` 并存，若要精确对齐 rank 需二选一。
4. 工作区外的旧独立页 `C:\Users\leimi\WorkBuddy\2026-09-15-00-26-07\th06\red_netherworld.html` 仍是旧代码（且是第二套实现），建议废弃、改用本仓库的 `red_netherworld_preview.html`。

---

## 四、下一步针对性改造行动计划 (Next Steps)

开辟新上下文后，建议按以下清晰步骤直击痛点，彻底解决“弹幕样式差距大”的问题：

### 第一步：深入核对 GensokyoClub / N0zoM1z0 反编译源码中 `et_set_eqdistr` 与 `et_extra` 的 C++ 源码
- 从 `th06` 反编译源码中提取出：
  1. `flags & 0x200`, `flags & 0x020`, `flags & 0x010` 的完整位掩码逻辑；
  2. `ang2` 参数在发弹循环中的数学计算公式（极坐标 $r, \theta$ 演化）；
  3. `et_extra` 中的参数 $a, b, r, s$ 在游戏每 tick 的精确浮点更新方程（是 $v_x, v_y$ 积分还是角度线性插值）。

### 第二步：子弹贴图与调色板精确重构
- 提取 `etama.dds` / `etama2.dds` / `etama3.dds` 中的真实 16 色调色板；
- 精准确定原版蕾米莉亚一符所使用的小玉精灵（带有柔和发光外圈）与红米粒精灵（带有透明渐变拖尾与高光针尖）；
- 在 Canvas 渲染中引入 `globalCompositeOperation = 'lighter'` 加色混合与外发光辉光滤镜。

### 第三步：发弹原点与运动学轨迹 1:1 对齐
- 实现 `ang2` 螺旋微偏，使交错弹不再是“蚊香弯线”，而是展开为原版极具张力的“笔直菱形射线网”；
- 实现米粒弹的出膛抛物线下坠（初速冲出 $\to$ 平滑转下 $\to$ 恒定加速度倾泻）。

---

## 五、关键代码状态与测试指令备忘

```bash
# 1. 验证主工程果蝇连接组全链路集成 (应保持 0 错误)
node test_integration.js

# 2. 验证冥符「紅色の冥界」专用无头模拟测试
node test_red_netherworld.js

# 3. 运行静态 HTTP 服务器并在浏览器中查看
# 访问主工程平台: http://localhost:3000
# 访问独立冥符页: 直接浏览器打开 C:\Users\leimi\WorkBuddy\2026-09-15-00-26-07\th06\red_netherworld.html
```

---

## 六、连接组规模扩展：80 → 600 细胞（2026-09-16，**规模消融对照组**）

### 决策记录

用户问「能否把神经元调到 1300」。基于实测成本（v1 全量 CEM 100代×64候选×12种子 = 755.9s @80细胞；边数 ∝ 训练时长；1300 细胞诱导边数约 5.5 万且无干净生物学集合），本喵推荐 **600** 为平衡点，用户拍板「那就600吧」。1300 的诚实对应集合是 MaleCNS 全部 1,314 个 `descending_neuron`（superclass 实测计数），未来若做「DN 全量版」是天然的另一个数据集。

### 数据血统（全部可复现、可哈希验证）

| 源文件 (gs://flyem-male-cns/v1.0/connectome-data/flat-connectome/) | 大小 | sha256 | 用途 |
|---|---|---|---|
| `body-annotations-male-cns-v1.0-minconf-0.5.feather` | 14,483,314 B | `2177e246…9a3b2` (=v1 manifest "annotations" ✓) | type/superclass/status/**somaLocation**(位置直接来源，无需 SWC) |
| `body-neurotransmitters-male-cns-v1.0.feather` | 43,282,834 B | `95c92892…79621` (=v1 manifest "neurotransmitters" ✓) | consensus_nt + 置信度≥0.5 → nt/sign |
| `connectome-weights-…-traced-only.feather` | 508,025,642 B | `9b3beab1…e604b` (**≠** v1 manifest "edges" `e35da783…`，v1 当年用的是全量 weights) | 25,563,197 有向边 |

**黄金校验**：traced-only 文件与 v1 `graph.json` 交叉验证 = **1296/1296 边、逐边接触数零误差**（graph.json 的 edges 是**节点数组下标**不是 body ID，曾为此绕了个弯）。

### 构建管线（`_research/malecns/`）

1. `py312/` 工作区内嵌 Python 3.12.8 + pip + pyarrow 25.0.1 + pandas（系统无 Python，故意不污染宿主）
2. `build_graph_600.py`：**自检门**（从源文件重推导 v1 全部 80 细胞元数据，80/80 位级一致才继续）→ 从 v1 的 80 个 body ID 出发做**加权通路闭包**：3 轮 (120/120/240)，每轮取「与集合的 ≥3 接触强边总权重」最大的候选（候选限 status=Traced + 有 type + 有 somaLocation，平局取小 body ID），填/剪到恰好 600 → 诱导子图 37,845 边 / 1,129,414 接触点 → `public/data/connectome/graph600.json` (527KB) + `manifest600.json`。选择规则含 **"No game outcomes used"** 与 v1 复现声明。
3. 产出统计：role = 56 input / 528 interneuron / 16 output；321 种细胞类型；DN superclass 44（读出仍是原 16 DN，**解码器契约 320 参数不变**）；ACh 410 / GABA 125 / Glu 44 / unclear 11 / DA 6 / OA 4。graphSha256 `d3b38436…a1144`。

### 引擎与 UI 适配

- `connectome.js`：热路径镜像 **TypedArray（与对象边表严格同序 → 浮点累加顺序不变 → 位级一致）**，实测 v1 80 细胞 8.2µs/帧、v2 600 细胞 183.6µs/帧 = 游戏 60Hz 预算的 1.1%。`tools/bench_graph600.mjs` 同时是位级回归（legacy 对象循环 vs typed 循环，300 步 Δ=0）。
- `brain_view.js` 重写为 **LOD 渲染**：全量边按**接触强度**分桶烘焙到离屏底图（与逐帧 activity 无关 → 永不陈旧，仅布局/静音/悬停态变化时重烤），每帧一次 `drawImage` + 活跃边叠加（|a|>0.35 绿线）；布局修复：按 role+通道真实分组（v1 曾按数组序错排）、中继层按 type 排序去对象键序依赖；大拓扑 (>200) 胞体缩小去标签防糊；所有计数文案动态化。
- `app.js`：数据集切换下拉（index.html 02 面板，`?brain=v600` URL 直达）；`server.js` 加 `Cache-Control: no-store`（曾因浏览器缓存旧 app.js 排查半天）；**拓扑守卫**：checkpoint.topology.graphSha256 ≠ 实际图哈希 → 强制显示为未训练（防串台自嗨）。
- `i18n.js`：`{n}/{e}` 占位符插值 + `setI18nContext`，hero/工具栏/methods/benchmark 行文案随数据集自动重译。

### 训练管线（`train.js` v4）

- 评估核心抽到 `src/brain/eval_core.js`（主进程/worker 共用）；`tools/cem_worker.mjs` worker 池（16 核机开 14）；同代候选并行、结果按候选下标聚合 → 与调度顺序无关。
- 新增：**多组 matched control**（`--control-seeds 42,43,44`）+ **配对 bootstrap 20000 次 × Bonferroni 校正**显著性（冒烟时就抓到 1 代下 control 偶然"显著胜出"，多组对照必须校正，否则 p 值虚高）。
- checkpoint 自描述拓扑（graph 路径/节点/边/接触/sha256）。
- 600 细胞重训命令（后台跑约 1 小时，日志 `experiments/_train600.txt`）：
  `node train.js --graph public/data/connectome/graph600.json --out public/data/checkpoint600.json --workers 14 --generations 100 --pop 64 --elite 8 --seeds 12 --control-seeds 42,43,44`

### 测试现状

- `test_integration.js` 重写为**双数据集参数化**：每个数据集校验 manifest 计数 + `manifest.graphSha256` vs 文件实际哈希 + 接触点总数 + 120帧仿真 + 60帧消融因果全零 + Stage1-3 + matched control 度守恒。v600 checkpoint 硬门已收紧 (`checkpointRequired: true`)，拓扑哈希匹配 ✓。
- `test_red_netherworld.js`（冥符 176 存活子弹回归）不受影响，通过。

### 规模消融结果（2026-09-16 完训+统一重评，**最终数字以此为准**）

训练：100代×64候选×8精英×12种子，14 worker，bio 2233s + 3×control ≈ **总 8254s (2.3h)**。v600 最佳训练适应度 1041.1f（v1 当年 1174f，同预算）。

因 v1 checkpoint 自带 benchmark 产出于冥符时序修正**之前**的旧游戏构建（idle 基线 255f 不可比），用 `tools/scale_ablation.mjs` 在当前构建 + 同 20 独立测试种子 (80001-80020) 对双方统一重评（各 checkpoint 的 `benchmark.originalRun` 保留原记录，`benchmark.reeval` 附重评元数据）：

| 指标 (20 种子均值, 当前构建) | MaleCNS-80 v1 | MaleCNS-600 v2 |
|---|---|---|
| 🧠 trained | **1544.9f / 25.75s** | **1235.6f / 20.59s** |
| 🔀 matched ctrl | 1529.3f (@42) | 1567.4 / 877.9 / 880.3f (@42/43/44) |
| 🔇 circuit silenced | 885.8f | 885.8f |
| 🧍 idle | 885.8f | 885.8f |
| trained vs silenced 因果增益 | **+74.4%** | **+39.5%** |
| 拓扑优势 Δ vs 各 ctrl (双侧 p) | +15.6f (p=0.864) | −332 (p=0.0001) / +358 (p=0.0001) / +355 (p=0.0001) |
| 结论 | 不显著 | **方向不一致 → 不可信** |

**诚实判读**：
1. **规模 ≠ 能力（机制已取证，`tools/scale_why.mjs`，2026-09-16）**：同 CEM 预算下 600 比 80 存活 **−20.0%**，且是真实一致的回归（配对 20 种子 Δ=+309.3f 偏向 v1，双侧 p=0.0065，80 胜 17/20），不是种子噪声。剖析定位到**读出信号稀释**而非算力/时延/维度：
   - 搜索维度两边相同（读出契约未变，仍 320 参数）→ 排除「维度爆炸」；
   - 感觉→DN 输出跳数两图都 1-2 hop → 排除「传播太深、3 迭代到不了」；
   - **真凶**：闭包补进来的 520 中间神经元大量汇聚到同 16 个 DN 输出——output 侧加权入突触 contacts 从 635/元 涨到 2788/元（×4.4），感觉细胞直连占 DN 输入份额从 **23.4% 崩到 8.5%**。per-post 归一化（weight=contacts·sign/totals[post]）按总入缩分母，原始直连信号被稀释 ⇒ DN 读出幅度 dnRms 1.37→0.42、动态 dnStd 0.99→0.36、全网活跃率 51.7%→8.4%。320 参数线性读出面对的是**衰减 3 倍、方差减半**的特征向量，天花板自然低。
   - 佐证（双口径表述，经 PLAN_520 评审修正）：**训练平台上** v600 bio gen 25 即平台（历史最佳 1041f，之后 75 代近乎零进步），同规模同预算三组随机重连对照历史最佳 1129.6/1097.2/1079.7 均不低于 bio ⇒ 预算足以在别的 600 拓扑上继续进步；但**独立测试集**上 bio 1235.6f 对三对照 1567.4/877.9/880.3f 为 2 胜 1 负、均值反高 11.4%，故**不足以宣称「对照更优」**，只支持「预算非唯一瓶颈、这张子图的输出侧信号质量是可疑瓶颈」。修正此前「搜索预算才是瓶颈」的笼统说法。
   - 生物学注脚：真果蝇的运动指令由 DN 轴突末梢在特定神经索分区释放，不是胞体平均放电的线性读出；本模型的归一化约定在扩规模时把直连优势抹平了，属**实现约定问题**而非神经科学反例。
2. **拓扑优越性依然无法证实**：v600 三组度保持对照在 878~1567 帧间波动（重连运气主导 CEM 收敛），生物组恰好落在中间。v1 单对照 Δ=+16f p=0.86 同样为零假设。此结论与 flydino 作者声明一致：本项目证明的是**行为对连接组活动的因果依赖**（trained ≫ silenced，两尺度都成立；消融→输出恒零是数学保证），而非生物拓扑优于随机拓扑。
3. **方法论升级**：本次 v600 首跑日志曾报「+11.5% p=0.000 显著」——那是「有赢有输取最小 p × Bonferroni」的伪显著。`train.js` 已改为**双侧 bootstrap + 方向一致性检查**（不一致 → 直接标记不可信），`tools/scale_ablation.mjs` 是同一判据的离线重评版。
4. UI 侧两数据集各自展示各自 checkpoint 的重评 benchmark（04 表 + hero `{bt}/{st}` 模板随切换刷新）。

### 待办

1. ~~训练完成后收紧测试~~ ✓ 已完成（硬门 + 拓扑哈希匹配）
2. 浏览器人眼验收 600 细胞 LOD 渲染（本喵的视觉桥不可信，需人眼或像素 diff）：`http://127.0.0.1:3000/index.html?brain=v600`
3. 可选：1300 = 全 DN superclass 数据集（数据管线现成，闭包换成类型集合筛选即可）。原「加大 CEM 预算检验 −20% 归因」的对照已被 `scale_why.mjs` 取证基本回答（同预算下对照能在 600 规模收敛超过 bio ⇒ 主因是信号质量非预算）；更有兴趣的下一步是**验证可逆性**：给感觉→DN 直连边豁免 per-post 归一化（或闭包时限制汇入 output 的边数）后重训 v600，若 −20% 消失即坐实稀释机制。**→ 已工程化为 `PLAN_520.md`（v2，含评审修正）并已执行，见下方「PLAN_520 执行结果」：可逆性获证（A 主判据通过）**
4. ~~`experiments/_smoke_v1.json`、`_smoke_v600.json`~~ ✓ 已删除

### PLAN_520 执行结果（2026-09-16，**规模问题的最终答案，详细账目见 `PLAN_520.md` 执行状态日志**）

1. **稀释假说被证实且可逆**：只改读出契约（加性两段归一化, graph600a=同边集同接触+烘焙权重）重训后，独立测试 **1235.6 → 1538.2f**，vs 旧 v600 配对 **Δ=+302.6f、双侧 p=0.0046、胜 18/20**——与 v1 (1544.8f) 统计打平 (p=0.91, 对局胜数 14/20 反而领先)。回归完全反转。
2. **520 新细胞不是死重**：修好归一化后 496 个新中间神经元的因果贡献 Δ₀(496) 从 +120.7f 涨到 **+391.8f**——此前是「被错误的权重口径饿着」。剪枝回 150 的止损路线作废。
3. **C 案（graph600b, v1 读出恢复）**：+139.3f 方向为正但主判据 p=0.0550 差一线，按纪律只报「疑似有益未证实」；其 b 图 Δ₀(496)=+9.4f 恰好反证 C.1b 语义——绕过读出层后新细胞退为旁观者。
4. **工程战果两条**：① CEM 采样已播种 (`--cem-seed`, 默认 20260916, 位复现验收通过)，历史 run 仍不可复现的纪律沿用；② **发现并修复 --workers 时代评估池串台 bug**（对照候选在 bio 图上打分，播种后以「对照轨迹与 bio 逐位相同」现形）——checkpoint600 与 600a/b 的 matchedControl/topologyAdvantage 字段均标注 INVALID 不可引用；四方主判据全部基于 bio 权重，不受波及。
5. **UI 现为四档数据集**：`?brain=v1|v600|v600a|v600b`，test_integration 四链全绿；B 案（322 参数 DN 增益把手）**判负**——CEM 把增益学成关闸退化解 (exc→钳制 0, inh→0.024)，plateau 虚高至 1168.7 但独立测试 1386.3f < A 1538.2f ⇒ 固定加性契约已足够，把手=过拟合通道；B.2 场内产出**池修复后首个干净对照**：ctrl 1397.8f vs bio 1386.3f, Δ=−12f p=0.935 平手（拓扑零优势再添一证）。
6. **D 案（300×128 对称放大终审）判「打平」**：600ax test 1454.4f vs v1x 1338.3f，Δ=+116.0f 但主判据 bootstrap **p=0.3776 不显著**（符号检验 15/20、p=0.0414 次要口径如实备案，不改判）⇒ **不可宣称「规模带来能力」**，定稿：本读出契约下 600 与 80 统计打平，且预算×3 对两规模均为过拟合伤害（v1x 比 v1 掉 206.5f、600ax 比 600a 掉 83.8f）。附证：600ax Δ₀(496)=+493.4f——新细胞净贡献更大仍换不来总优势（「贡献≠优势」）。**全案冠军=v600a（100×64 原预算，1538.2f），已为 UI `?brain=v600a` 推荐档。**

### 游戏机制 v8：Boss 猎杀模式（2026-09-16，浏览器游戏侧改动，训练口径逐位不变）

用户四点需求 → 落地（均在 `src/game/danmaku.js` + `src/app.js` + `index.html` + `src/i18n.js`）：

1. **阵亡清屏**：死亡分支 (lives≤0) 即刻 `this.bullets = []` 全屏肃清；无缝观察模式下死亡休眠期 Boss 停火 (`spawnBossDanmaku` 新门：`isDead && autoRespawn` 不发弹)，重生瞬间场面洁净。
2. **难度重新计算**：渐进难度是 `survivalTime` 的纯函数，重生归零 ⇒ 倍率精确回到 0.18 入门微风并随新一轮存活重爬（断言实测 respawnMult=0.18）。
3. **火力 ×3.4**：自机弹双发/6帧 → **三发齐射/4帧**，单发伤害 1.2 → 1.8；理论 DPS 24 → 81（1000 血 Boss 全命中 ≈12.3s 打空）。
4. **击破停机 + 击杀轮数**：新状态 `round`（每次重生 +1）/ `combatTime`（跨轮累计战斗秒）/ `bossDefeated` / `bossKillRounds`。血条打空瞬间仿真停止（update 只放行余烬粒子），画布中央定格战报横幅「BOSS 击破 · 共 N 轮」，遥测带新增第 7 格「⚔️ 击杀轮次」仪表，Boss 血条附 HP 读数与「第 N 轮」指示。

**口径隔离（关键纪律）**：击破判定整块挂在 `endOnBossDefeat` 开关下，**仅 `app.js` 浏览器端置 true**；`eval_core.js` / `train.js` headless 评估（autoRespawn=false、单命即死即出环）对全部改动免疫。回归证据 `experiments/_v8_caliber.mjs`：v1=**1544.85** / v600a=**1538.15** / idle=**885.75** 与 checkpoint 存档逐位一致（对外公布的 1544.8/1538.2/885.8 即其一位小数四舍五入，20-seed 均值恒为 0.05 倍数）。

**机制全链路断言** `experiments/_v8_gameplay.mjs`（headless 浏览器同款配置，符卡 2 纯挂机）：阵亡 9 次、9 次全屏清弹全部成立、重生难度回 0.18、**第 10 轮完成击杀**（累计战斗 125.3s、中弹 27 次）；击破后 frame/combatTime/survivalTime 全冻结、场上弹数 0、`bossKillRounds==round`。

**顺带修复**：02 卡片 DPR 重建使 `render()` 依赖 `ctx.setTransform`，但 `test_integration.js` 的 mock ctx 缺该方法 → 四链曾红；补 `setTransform/getTransform/resetTransform` 桩后恢复 4 数据集全绿（2026-09-16 复跑确认）。
