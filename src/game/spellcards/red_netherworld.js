/**
 * 冥符「紅色の冥界」 [Nether Sign "Scarlet Devil"] — Remilia Scarlet, stage 6 spell #106
 *
 * ============================================================================
 *  本文件是 th06 `ecldata6.ecl` 的逐指令移植（不再是"看着像"的二创）
 *  反汇编产物见 tools/ecl_sub38_40.txt，取证脚本 tools/ecl_dis.mjs / tools/ecl_scan_extra.mjs
 * ============================================================================
 *
 * sub 38 (@0x41dc)  符卡入口
 *   @0024 call(39)                        ; 宣言脚本（先跑完才轮到弹幕）
 *   @003c call(40)                        ; 弹幕脚本
 *
 * sub 39 (@0x4238)  宣言
 *   @0036 set_spellcard(face=2, spell_id=106, "ST_ECLDATA6_SUB32_0")   ; diff=0x02 = Normal
 *   @00cc set_damageable(0)
 *   @00dc op 81 et_ofc(x=0, y=0, z=0)      ★★★ 出弹偏移被显式设为 0 → 弹幕从 BOSS 座标原点射出 ★★★
 *   @0134 set_time(0)
 *   @0144 set_timeout(2400)                ; 40 秒
 *   @0154 move_to_decel(dur=120, x=192, y=144, z=0)   ★★★ BOSS 待机位 = playfield(192,144) ★★★
 *   @0188 set_damageable(1)
 *   @0198 op 84(23)                        ; 后续发弹音效索引 = 23
 *
 * sub 40 (@0x43f4)  弹幕主循环（**diff=0xff → 四个难度跑的是同一份数据**）
 *   @0004 set($-10009, 6)                                  ; 每大波 6 次脉冲
 *   @0018 set_randf($-10005, 6.2831855, -3.1415927)         ; 基准角 = rand(-π, π)，每大波只掷一次
 *   --- 循环体（jump_ex 回跳 @0030，周期 21 帧）-----------
 *   @0030 et_extra(a=128, b=-1, c=-1, d=-1, r=0,    s=+π/128)
 *   @005c el_circle(spr=2, col=2, n1=24, n2=1, spd1=1.8, spd2=1.0, ang1=%-10005, ang2=-π/200, flags=0x220)
 *   @0088 addf($-10005, %-10005, +π/32)     t=4
 *   @00a0 et_extra(a=128, b=-1, c=-1, d=-1, r=0,    s=-π/128)
 *   @00cc el_circle(spr=2, col=2, n1=24, n2=1, spd1=1.8, spd2=1.0, ang1=%-10005, ang2=-π/200, flags=0x220)
 *   @00f8 addf($-10005, %-10005, +π/32)     t=8
 *   @0110 et_extra(a=240, b=-1, c=-1, d=-1, r=0.02, s=+π/2)
 *   @013c el_circle(spr=5, col=2, n1=16, n2=1, spd1=2.2, spd2=1.0, ang1=%-10005, ang2=-π/200, flags=0x210)
 *   @0168 addf($-10005, %-10005, +π/32)     t=12
 *   @0180 et_extra(a=240, b=-1, c=-1, d=-1, r=0.02, s=+π/2)
 *   @01ac el_circle(spr=5, col=2, n1=16, n2=1, spd1=2.2, spd2=1.0, ang1=%-10005, ang2=-π/200, flags=0x210)
 *   @01d8 addf($-10005, %-10005, +π/32)     t=21
 *   @01f0 jump_ex(@0030, $-10009)           t=21
 *   --- 6 次脉冲之后（同一份计时轴，发弹不停）----------------
 *   @0208 set_angle_rand_ex(-π, +π)         ; BOSS 随机方向
 *   @021c set_speed(1.5)                    ; 滑行初速 1.5 px/f
 *   @022c stop_in_decel(90)                 ; 90 帧线性减速到 0
 *   @023c jump(@0004)                        ; 下一大波（重掷基准角）
 *
 * ============================================================================
 *  由 GensokyoClub/th06 源码钉死的语义（见 HANDOVER §3「本轮取证结论」）
 * ============================================================================
 *  · opcode 70 = ECL_OPCODE_BULLETCIRCLE，`BulletManager::SpawnSingleBullet()` case CIRCLE：
 *      angle(i,j) = norm(ang1 + 2π*i/count1 + ang2*j)      ; i=环内序号, j=环序号
 *      speed(j)   = spd1 - (spd1 - spd2) * j / count2
 *    → 本符卡 count2(num2)=1 ⇒ j 恒为 0 ⇒ **ang2=-π/200 与 spd2=1.0 完全不起作用**（旧文档把它
 *      当成"螺旋来源"是错的）；环是**严格等分**的 24/16 道，速度恒为 spd1。
 *  · flags 0x200 = 只在整环发完后 `PlaySoundByIdx(sfx)` 一次，与运动无关。
 *  · 真正的弯曲来自 opcode 82 (ECL_OPCODE_BULLETEFFECTS) 写入的 bulletProps.exInts/exFloats，
 *    由 `BulletManager::OnUpdate()` 的 BULLET_STATE_FIRED 链按位消费（见 danmaku.js）：
 *      - 0x20（小玉）: angle += exFloats[1](=s, rad/f), speed += exFloats[0](=r) 共 a 帧
 *                      → 本卡 r=0, s=±π/128, a=128 ⇒ **每秒转 87.7°、正好转满 180° 的半圆**，
 *                        曲率半径 = 1.8/(π/128) = 73.34 playfield px，之后永久直线飞行。
 *      - 0x10（米粒）: ex4Acceleration = (cos,sin)(s) * r（s<=-999 时才改成本弹出膛方向）
 *                      → 本卡 r=0.02, s=π/2 ⇒ **恒定向下加速度 0.02 px/f² (=72 px/s²)**，
 *                        速度矢量逐帧累加、angle=atan2(vy,vx)，共 240 帧 ⇒ 真抛物线，
 *                        240 帧后冻结速度直线坠落。不是"延迟 16 帧后强制转向正下方"。
 *  · 弹体外观：`SetActiveSprite(spriteBullet, activeSpriteIndex + col)` ⇒ col 是同一形状族内的
 *    颜色偏移；spr=2 → 18x18 光玉、spr=5 → 32x36（实心针体 16x36）长针。ANM 矩形是 2x 复刻纹理
 *    空间，实际 playfield 尺寸 = 矩形/2（同一文件里 BOSS 待机帧 230 矩形/不透明内容 149 对应
 *    原作约 74 px 的视觉尺寸，与此比例一致）。绘制旋转 = angle - π/2（针尖沿速度方向）。
 *  · 混合模式：弹体 anm 用 render mode 5 = `ECL_063_render_modes[5] = (7,4,0,0)` = 常规 alpha
 *    混合，**不是加算**。加算只出现在出现闪光/激光（`Anm_SetBlend(1)`），本卡 flags=0x220/0x210
 *    没有 0x2/0x4/0x8 出现闪光位，所以连"生成白闪"都不该画。
 */

const PF_W = 384;              // EoSD playfield 宽（子弹剔除边界 0<=x<384）
const PF_H = 448;              // EoSD playfield 高（0<=y<448）
const HOME_X = 192;            // move_to_decel 目标位
const HOME_Y = 144;

// ---- ECL Sub 40 常量 ----
const BURSTS_PER_WAVE = 6;                       // set($-10009, 6)
const BURST_PERIOD = 21;                         // jump_ex 的 time=21
// 渐进难度的「时间缩放」下限：最简时整套弹道以 0.62 倍速播放（几何形状不变），
// 随 60 秒难度爬升线性回到 1.00 = 原作 ECL 口径的 1.8 / 2.2 px/f。
const EASY_TIME_SCALE = 0.62;
const EASY_MULT = 0.18;                          // 全局难度曲线起点
const RING_ANGLE_STEP = Math.PI / 32;            // 每个发射器之后 addf($-10005, +π/32)
const SLIDE_SPEED = 1.5;                         // set_speed(1.5)
const SLIDE_DECEL_FRAMES = 90;                   // stop_in_decel(90)
const DECLARE_FRAMES = 120;                      // sub 39 move_to_decel(120)

// ANM 精灵矩形 → playfield px 的比例、弹型/颜色 → 精灵矩形，全部在 ./etama3.js（单一真源）

/**
 * 4 个发射器：字段名与 ECL 反汇编一一对应，值直接抄自 ecldata6.ecl
 * `extra` = opcode 82 et_extra(a,b,c,d,r,s,m,n)，c/d/m/n 在子弹代码里从不被读取
 */
export const EMITTERS = [
  {
    at: 0, kind: 'ball',
    spr: 2, col: 2, num1: 24, num2: 1, spd1: 1.8, spd2: 1.0, ang2: -Math.PI / 200, flags: 0x220,
    extra: { a: 128, b: -1, r: 0.0, s: Math.PI / 128 },
  },
  {
    at: 4, kind: 'ball',
    spr: 2, col: 2, num1: 24, num2: 1, spd1: 1.8, spd2: 1.0, ang2: -Math.PI / 200, flags: 0x220,
    extra: { a: 128, b: -1, r: 0.0, s: -Math.PI / 128 },
  },
  {
    at: 8, kind: 'rice',
    spr: 5, col: 2, num1: 16, num2: 1, spd1: 2.2, spd2: 1.0, ang2: -Math.PI / 200, flags: 0x210,
    extra: { a: 240, b: -1, r: 0.02, s: Math.PI / 2 },
  },
  {
    at: 12, kind: 'rice',
    spr: 5, col: 2, num1: 16, num2: 1, spd1: 2.2, spd2: 1.0, ang2: -Math.PI / 200, flags: 0x210,
    extra: { a: 240, b: -1, r: 0.02, s: Math.PI / 2 },
  },
];

// 判定核（东方「体大核小」手感；原作核 = 精灵尺寸的量级，本项目按玩法压到 2 px）
const BALL_HIT_R = 2.0;
const RICE_HIT_R = 2.0;

const TWO_PI = Math.PI * 2;
const norm2pi = (a) => Math.atan2(Math.sin(a), Math.cos(a));   // = utils::AddNormalizeAngle(x, 0)

export class RedNetherworldSpellcard {
  constructor(game) {
    this.game = game;
    this.configure();
    this.reset();
  }

  /** playfield(384x448) → 画布 的等比居中映射（绝不拉伸，保证 4:3 场内的圆形仍是圆形） */
  configure() {
    const g = this.game;
    this.s = Math.min(g.width / PF_W, g.height / PF_H);
    this.ox = (g.width - PF_W * this.s) / 2;
    this.oy = (g.height - PF_H * this.s) / 2;
  }

  reset() {
    this.configure();
    this.wave = 0;
    this.burstIndex = 0;      // 0..5 脉冲计数
    this.stepTimer = 0;       // 脉冲内帧 0..20
    this.ringIdx = 0;         // 本脉冲内已执行的发射器序号
    this.isRepositioning = false;
    this.timeScale = EASY_TIME_SCALE;   // update() 每帧按难度改写
    this.slideTimer = 0;

    this.baseAngle = 0;       // $-10005

    // BOSS（playfield 坐标）：从场上方外飞入，120 帧减速到位 (192,144)
    this.bx = HOME_X;
    this.by = -30;
    this.introTimer = 0;
    this.slideVx = 0;
    this.slideVy = 0;

    this.mult = 0.18;
  }

  /**
   * 执行一个发射器 —— SpawnSingleBullet() case CIRCLE 的直译
   * @param {object} em EMITTERS 表项
   */
  fireEmitter(em) {
    const g = this.game;
    const m = Math.min(1, Math.max(0, this.mult));

    // 渐进难度只削"数量"，不削轨迹形状：
    const ratio = Math.min(1, Math.max(0.35, m));
    const count = Math.max(6, Math.min(em.num1, Math.round(em.num1 * ratio)));

    // 同时做「等比时间缩放」k（随 60 秒难度爬升从 0.62 → 1.00）：
    //   出膛速度 ×k、角速度 ×k、线/世界加速度 ×k²、运动持续帧数 ÷k
    // 这样轨迹几何与原作逐点相同（弧半径 R = k·spd / k·ω = spd/ω 不变，抛物线同形，
    // 半圆仍正好 180°），只是开头整段播得慢；k=1 时就是原作口径的 1.8 / 2.2 px/f。
    const k = this.timeScale;

    // et_ofc(0,0,0) ⇒ 出弹点就是 BOSS 座标，没有任何翼尖/半径偏移
    const cx = this.ox + this.bx * this.s;
    const cy = this.oy + this.by * this.s;

    // 等分环：angle = ang1 + 2π*i/num1 + ang2*j，num2=1 ⇒ j=0 ⇒ ang2 项恒为 0
    // 计数被难度削减时仍按 num1 的原始步进取角（保形状不保密度），否则退化成"缩小版同心环"
    const step = TWO_PI / em.num1;
    const speed = em.spd1 * this.s * k;              // speed(j) = spd1 - (spd1-spd2)*j/num2 = spd1
    const ex = em.extra;

    // 0x10: 世界坐标恒定加速度；s<=-999 时才是"沿本弹出膛方向加速"
    const useOwnAngle = (em.flags & 0x10) !== 0 && ex.s <= -999;
    const axMag = (em.flags & 0x10) !== 0 ? ex.r * this.s * k * k : 0;

    for (let i = 0; i < count; i++) {
      const angle = norm2pi(this.baseAngle + step * i);
      const b = {
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: (em.kind === 'ball' ? BALL_HIT_R : RICE_HIT_R) * this.s,
        color: em.kind === 'ball' ? '#ff3366' : '#ff2244',
        grazed: false,
        age: 0,
        // ---- 原作 Bullet 字段（SpawnSingleBullet 逐位搬运 et_extra）----
        exFlags: em.flags,
        ex5Int0: Math.max(1, Math.round(ex.a / k)),  // 持续帧数 ÷k ⇒ 总转角/总速度增量不变
        ex5F0: ex.r * this.s * k * k, // 0x20: 沿速度方向的线加速度 px/f²
        ex5F1: ex.s * k,              // 0x20: 角速度 rad/f（无量纲，不随画布缩放）
        ex4Ax: 0,
        ex4Ay: 0,
        speed,                // 0x20 会改写它
        angle,
        spr: em.spr,
        col: em.col,
        // ---- 本项目原有标记（test_red_netherworld.js 依赖）----
        isRedNetherBall: em.kind === 'ball',
        isRedRice: em.kind === 'rice',
        wave: this.wave,                    // 第几大波（取证/调试用：可只渲染某一波）
        pfBounded: true,                  // 按 playfield 384x448 + 16px 边界剔除（原作口径）
        curveAngularSpd: (em.flags & 0x20) !== 0 ? ex.s : 0,
      };
      if (useOwnAngle) {
        b.ex4Ax = Math.cos(angle) * axMag;
        b.ex4Ay = Math.sin(angle) * axMag;
      } else if ((em.flags & 0x10) !== 0) {
        b.ex4Ax = Math.cos(ex.s) * axMag;
        b.ex4Ay = Math.sin(ex.s) * axMag;
      }
      g.bullets.push(b);
    }

    // flags 0x200：整环发完后播放发弹音效（原作 sfx 索引 23，由 sub 39 @0198 op 84 设定）
    if ((em.flags & 0x200) !== 0) {
      if (g.boss) g.boss.castTimer = 18;
      if (!g.playSound || !g.playSound('tan00', 0.12)) {
        g.playBeep(820, 'square', 0.04, 0.02);
      }
    }
  }

  /**
   * set_angle_rand_ex(-π,π) + set_speed(1.5) + stop_in_decel(90)
   * —— 注意：这一串与下一大波的发弹是**并行**的，原作这里并没有任何"停火发呆"的间隙
   */
  startBossSlide() {
    const g = this.game;
    const ang = (g.random() * 2 - 1) * Math.PI;
    this.slideVx = Math.cos(ang) * SLIDE_SPEED;
    this.slideVy = Math.sin(ang) * SLIDE_SPEED;
    this.slideTimer = SLIDE_DECEL_FRAMES;
    this.isRepositioning = true;
  }

  /** BOSS 位移积分（playfield 坐标系） */
  updateBossMotion() {
    const g = this.game;

    // 登场：move_to_decel(120, 192, 144) —— 用"剩余帧数收敛"实现标准的减速到位
    if (this.introTimer < DECLARE_FRAMES) {
      const remain = DECLARE_FRAMES - this.introTimer;
      this.bx += (HOME_X - this.bx) / remain;
      this.by += (HOME_Y - this.by) / remain;
      this.introTimer++;
    } else if (this.slideTimer > 0) {
      // stop_in_decel(90)：初速 1.5，逐帧线性衰减到 0（总位移 = 1.5*90/2 = 67.5 px）
      const k = this.slideTimer / SLIDE_DECEL_FRAMES;
      this.bx += this.slideVx * k;
      this.by += this.slideVy * k;
      this.slideTimer--;
      if (this.slideTimer === 0) this.isRepositioning = false;
    }

    // 安全夹持（原作靠 ECL 数值天然落在场内，这里防随机游走飘出 playfield）
    this.bx = Math.max(48, Math.min(PF_W - 48, this.bx));
    this.by = Math.max(56, Math.min(232, this.by));

    g.boss.x = this.ox + this.bx * this.s;
    g.boss.y = this.oy + this.by * this.s;
  }

  /**
   * 每帧推进（DanmakuGame.spawnBossDanmaku 调用）
   * @param {number} mult 本项目动态渐进难度倍率 0.18 ~ 1.00
   */
  update(mult) {
    const g = this.game;

    if (g.frame === 2 && g.playSound) {
      g.playSound('enep00', 0.35);
    }

    this.mult = Math.min(1, Math.max(0, mult));
    // 时间缩放 k：难度最低时 0.62 倍速，随全局 60 秒爬升线性恢复到 1（原作口径）
    const ramp = Math.min(1, Math.max(0, (this.mult - EASY_MULT) / (1 - EASY_MULT)));
    this.timeScale = EASY_TIME_SCALE + (1 - EASY_TIME_SCALE) * ramp;
    this.updateBossMotion();

    // sub 39 宣言/入场期间不发弹（call(39) 跑完才轮到 call(40)）
    if (this.introTimer < DECLARE_FRAMES) return;

    // 大波之间留出发弹间隔：ECL 在 jump_ex 循环之后紧跟 set_angle_rand_ex / set_speed /
    // stop_in_decel(90)，BOSS 用这 90 帧滑行并刹停，期间不再增弹，停稳才开下一波。
    if (this.isRepositioning) return;

    // ---- sub 40 主循环 ----
    // 基准角：每大波重掷一次 rand(-π, π)（@0018 在 jump_ex 回跳目标 @0030 之外，脉冲内不重掷）
    if (this.burstIndex === 0 && this.stepTimer === 0 && this.ringIdx === 0) {
      this.baseAngle = (g.random() * 2 - 1) * Math.PI;
    }

    // 4 个发射器分别落在脉冲内第 0/4/8/12 帧，每个执行完 base += π/32
    while (this.ringIdx < EMITTERS.length && this.stepTimer >= EMITTERS[this.ringIdx].at) {
      const em = EMITTERS[this.ringIdx];
      this.fireEmitter(em);
      this.baseAngle += RING_ANGLE_STEP;
      this.ringIdx++;
    }

    this.stepTimer++;
    if (this.stepTimer >= BURST_PERIOD) {
      this.stepTimer = 0;
      this.ringIdx = 0;
      this.burstIndex++;
      if (this.burstIndex >= BURSTS_PER_WAVE) {
        this.burstIndex = 0;
        this.wave++;
        this.startBossSlide();   // @0208/@021c/@022c，与下一波发弹并行
      }
    }
  }

  getStatus() {
    return {
      name: '冥符「紅色の冥界」',
      wave: this.wave + 1,
      burst: this.burstIndex + 1,
      mult: this.mult.toFixed(2),
      isRepositioning: this.isRepositioning,
      timeScale: this.timeScale
    };
  }
}
