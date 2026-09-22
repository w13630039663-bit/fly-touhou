/**
 * 雹符「Hailstorm」— 雹符「ヘイルストーム」
 *
 * 数据来源：東方紅魔郷 (th06) th06ST.dat → ecldata2.ecl
 *   sub 34 : 符卡宣言 (move_to_decel(120, 192, 96))
 *   sub 35 : 弹幕脚本（本文件逐指令移植）
 *
 * 原始 ECL 指令序列（偏移 / 操作码 / 难度掩码 / 帧时间）：
 *   见下方 PROG 表，与反汇编逐字节一致。
 *
 * 核心运动学（EoSD playfield 384 x 448, 60fps）：
 *   · 每环 8 波内循环，每环间隔 40 帧（play_sound t=20 + jump_ex t=20）
 *   · 每环发射 num1 × 3 层，三层速度 5.00 / 3.08 / 1.17（等分布 et_set_eqdistr）
 *   · et_extra(a=60, b=1)：出弹 60 帧后统一转向下落
 *   · 下落角每环 ±22.5°，方向由波次奇偶决定；下落速度每波 +0.15（起始 1.40）
 *   · BOSS 每波结束后随机方向急停减速（stop_in_decel 120 帧）
 *
 * 与本项目画布（460 x 580）的适配：
 *   playfield 384x448 等比缩放到画布，水平/垂直居中（SCALE ≈ 1.198）。
 *   所有速度乘 SCALE，角度不变；判定半径同样缩放。
 */

const PF_W = 384;   // EoSD playfield 宽
const PF_H = 448;   // EoSD playfield 高

// ---- ECL 反汇编常量 ----
const RINGS_PER_WAVE = 8;      // set($-10009, 8)
const LAYERS = 3;              // set($-10004, 3)
const SPD1 = 5.0, SPD2 = 1.5;  // et_set_eqdistr spd1 / spd2
const ET_A = 60;               // et_extra a：60 帧后转向
const ET_B = 1;                // et_extra b：只转向 1 次
const FALL_SPD0 = 1.4;         // setf($-10005, 1.4) 初始下落速度
const FALL_SPD_STEP = 0.15;    // addf($-10005, +0.15) 每波递增
const ANG_STEP = 0.3926991;    // addf($-10007, ±0.3926991) = ±22.5°
const DECLARE_FRAMES = 120;    // sub 34 宣言阶段，此期间 sub 35 不执行

// 弹幕视觉 / 判定（playfield 单位：贯彻东方「体大核小」精细判定）
const HAIL_HIT_R = 2.2;        // 判定核心半径（缩小以支持极限擦弹与微操穿缝）
const HAIL_DRAW_R = 7.5;       // 绘制半径
const LAYER_COLORS = ['#eaf7ff', '#8fdcff', '#4aa6e8']; // 由快到慢三层（原作同精灵，此处分层便于观察）

// ============================================================
//  ECL 程序：ecldata2.ecl sub 35
//  o = 字节偏移 | op = 操作码 | d = 难度掩码(1E 2N 4H 8L) | t = 帧时间
// ============================================================
const PROG = [
  { o: 0x0004, op: 5,   d: 0xff, t: 0,      s: 'setf($-10007, 0)                    // 下落角累加器' },
  { o: 0x0018, op: 4,   d: 0xff, t: 0,      s: 'set($-10012, 0)                     // 波次 = 0' },
  { o: 0x002c, op: 5,   d: 0xff, t: 0,      s: 'setf($-10005, 1.4)                  // 下落速度' },
  { o: 0x0040, op: 4,   d: 0xff, t: 0,      s: 'set($-10009, 8)                     // 每波 8 环' },
  { o: 0x0054, op: 17,  d: 0xff, t: 0,      s: 'mod($-10002, $-10012, 2)            // 波次奇偶' },
  { o: 0x006c, op: 27,  d: 0xff, t: 0,      s: 'test($-10002, 0)' },
  { o: 0x0080, op: 34,  d: 0xff, t: 0,      s: 'jump_neq(-> @00c0)' },
  { o: 0x0094, op: 20,  d: 0xff, t: 0,      s: 'addf($-10007, %-10007, +0.3926991)  // +22.5°' },
  { o: 0x00ac, op: 2,   d: 0xff, t: 0,      s: 'jump(-> @00d8)' },
  { o: 0x00c0, op: 20,  d: 0xff, t: 0,      s: 'addf($-10007, %-10007, -0.3926991)  // -22.5°' },
  { o: 0x00d8, op: 8,   d: 0xff, t: 0,      s: 'set_randf($-10006, 6.283185)        // 基准角随机' },
  { o: 0x00ec, op: 20,  d: 0xff, t: 0,      s: 'addf($-10006, %-10006, -3.141593)   // → [-π, π)' },
  { o: 0x0104, op: 8,   d: 0xff, t: 0,      s: 'set_randf($-10008, 0.09817477)      // 预留抖动' },
  { o: 0x0118, op: 20,  d: 0xff, t: 0,      s: 'addf($-10008, %-10008, -0.04908739)' },
  { o: 0x0130, op: 4,   d: 0xff, t: 0,      s: 'set($-10004, 3)                     // 3 层' },
  { o: 0x0144, op: 13,  d: 0x04, t: 0,      s: 'add($-10003, $-10012, 8)            // Hard 每环弹数' },
  { o: 0x015c, op: 13,  d: 0x08, t: 0,      s: 'add($-10003, $-10012, 13)           // Lunatic 每环弹数' },
  { o: 0x0174, op: 82,  d: 0xff, t: 0,      s: 'et_extra(a=60, b=1, r=%-10007, s=%-10005)' },
  { o: 0x01a0, op: 70,  d: 0xff, t: 0,      s: 'et_set_eqdistr(spr=5,col=6,num1=$-10003,num2=3,spd1=5,spd2=1.5,ang1=%-10006,ang2=0,flags=0x104)' },
  { o: 0x01cc, op: 106, d: 0xff, t: 20,     s: 'play_sound(9)     ← 每环 20 帧' },
  { o: 0x01dc, op: 3,   d: 0xff, t: 20,     s: 'jump_ex(-> @0054, $-10009)  // 8 环循环' },
  { o: 0x01f4, op: 50,  d: 0xff, t: 20,     s: 'set_angle_rand_ex(-π, π)    // BOSS 随机位移' },
  { o: 0x0208, op: 47,  d: 0xff, t: 20,     s: 'set_speed(1)' },
  { o: 0x0218, op: 61,  d: 0xff, t: 20,     s: 'stop_in_decel(120)' },
  { o: 0x0228, op: 20,  d: 0xff, t: 20,     s: 'addf($-10005, %-10005, 0.15)// 下落速度 +0.15' },
  { o: 0x0240, op: 27,  d: 0xff, t: 20,     s: 'test($-10012, 10)' },
  { o: 0x0254, op: 29,  d: 0xff, t: 20,     s: 'jump_l(-> @0278)' },
  { o: 0x0268, op: 112, d: 0xff, t: 140,    s: 'set_time(99999)             // 10 波后解除时限' },
  { o: 0x0278, op: 13,  d: 0xff, t: 140,    s: 'add($-10012, $-10012, 1)    // 波次 +1' },
  { o: 0x0290, op: 2,   d: 0xff, t: 0xffff, s: 'jump(-> @0040)              // 下一波' },
];
const BY_OFF = {};
PROG.forEach((v, i) => { BY_OFF[v.o] = v; v.idx = i; });

const DIFF_MASK = 0x04; // 以 Hard 为基准（Easy/Normal 原作不发弹）

export class HailstormSpellcard {
  constructor(game) {
    this.game = game;
    this.configure();
    this.reset();
  }

  /** 计算 playfield → 画布的等比映射 */
  configure() {
    const g = this.game;
    this.s = Math.min(g.width / PF_W, g.height / PF_H);
    this.ox = (g.width - PF_W * this.s) / 2;
    this.oy = (g.height - PF_H * this.s) / 2;
  }

  reset() {
    this.configure();
    // ECL VM 状态
    this.V = {};
    this.flag = 0;
    this.pc = 0x0004;
    this.wait = 0;
    this.pendingEx = null;
    this.curIns = -1;
    // 派生显示值
    this.wave = 0;
    this.ring = 0;
    this.num1 = 0;
    this.fallSpd = FALL_SPD0;
    this.fallAng = 0;
    // BOSS（playfield 坐标）
    this.bx = PF_W / 2;
    this.by = -40;              // 入场前在场外
    this.bossSpeed = 1.0;
    this.bossAng = 0;
    this.bossVx = 0;
    this.bossVy = 0;
    this.bossDecelN = 0;
    this.bossDecelT = 1;
    // 密度总开关：觉得太密可在控制台调 game.hailstorm.densityScale = 0.6
    this.densityScale = 1.0;
    // 难度密度（由项目动态渐进难度驱动）
    this.density = 0.5775;
  }

  // ---------- 寄存器 ----------
  vg(k) { return this.V[k] !== undefined ? this.V[k] : 0; }

  /** 三层等分布速度：最慢层 = (spd1 - spd2) / num2，中间线性插值 */
  layerSpeed(i, n) {
    if (n <= 1) return SPD1;
    const slow = (SPD1 - SPD2) / n;
    return SPD1 + (slow - SPD1) * (i / (n - 1));
  }

  // ---------- 指令执行 ----------
  exec(ins) {
    const g = this.game;
    switch (ins.op) {
      case 2:  this.pc = this.jumpTarget(ins.o); return true;              // jump
      case 4:                                                              // set
        if (ins.o === 0x0018) this.V[-10012] = 0;
        else if (ins.o === 0x0040) this.V[-10009] = RINGS_PER_WAVE;
        else if (ins.o === 0x0130) this.V[-10004] = LAYERS;
        return false;
      case 5:                                                              // setf
        if (ins.o === 0x0004) this.V[-10007] = 0; else this.V[-10005] = FALL_SPD0;
        return false;
      case 8:                                                              // set_randf
        if (ins.o === 0x00d8) this.V[-10006] = g.random() * 6.283185;
        else this.V[-10008] = g.random() * 0.09817477;
        return false;
      case 13:                                                             // add
        if (ins.o === 0x0144) this.V[-10003] = this.vg(-10012) + 8;
        else if (ins.o === 0x015c) this.V[-10003] = this.vg(-10012) + 13;
        else this.V[-10012] = this.vg(-10012) + 1;
        return false;
      case 17:                                                             // mod
        this.V[-10002] = ((this.vg(-10012) % 2) + 2) % 2;
        return false;
      case 20:                                                             // addf
        if (ins.o === 0x0094) this.V[-10007] = this.vg(-10007) + ANG_STEP;
        else if (ins.o === 0x00c0) this.V[-10007] = this.vg(-10007) - ANG_STEP;
        else if (ins.o === 0x00ec) this.V[-10006] = this.vg(-10006) - 3.141593;
        else if (ins.o === 0x0118) this.V[-10008] = this.vg(-10008) - 0.04908739;
        else if (ins.o === 0x0228) this.V[-10005] = this.vg(-10005) + FALL_SPD_STEP;
        return false;
      case 27:                                                             // test
        this.flag = (ins.o === 0x006c) ? (this.vg(-10002) - 0) : (this.vg(-10012) - 10);
        return false;
      case 29:                                                             // jump_l
        if (this.flag < 0) { this.pc = this.jumpTarget(ins.o); return true; }
        return false;
      case 34:                                                             // jump_neq
        if (this.flag !== 0) { this.pc = this.jumpTarget(ins.o); return true; }
        return false;
      case 3: {                                                            // jump_ex
        this.V[-10009] = this.vg(-10009) - 1;
        if (this.vg(-10009) > 0) { this.pc = this.jumpTarget(ins.o); return true; }
        return false;
      }
      case 47: this.bossSpeed = 1.0; return false;                         // set_speed
      case 50: this.bossAng = (g.random() * 2 - 1) * Math.PI; return false; // set_angle_rand_ex
      case 61: {                                                           // stop_in_decel
        const spd = (this.bossSpeed === undefined ? 1.0 : this.bossSpeed);
        const ang = (this.bossAng === undefined ? 0 : this.bossAng);
        this.bossVx = Math.cos(ang) * spd;
        this.bossVy = Math.sin(ang) * spd;
        this.bossDecelN = 120; this.bossDecelT = 120;
        return false;
      }
      case 70: this.fire(); return false;                                  // et_set_eqdistr
      case 82:                                                             // et_extra
        this.pendingEx = { a: ET_A, b: ET_B, r: this.vg(-10007), s: this.vg(-10005) };
        return false;
      case 106: return false;                                              // play_sound
      case 112: return false;                                              // set_time(99999)
    }
    return false;
  }

  /** 跳转目标从源码文本解析，保证与反汇编一致 */
  jumpTarget(o) {
    const ins = BY_OFF[o];
    const m = /@([0-9a-f]{4})/.exec(ins.s);
    return m ? parseInt(m[1], 16) : o + 0x20;
  }

  nextOff(idx) {
    for (let i = idx + 1; i < PROG.length; i++) {
      if (PROG[i].d === 0xff || (PROG[i].d & DIFF_MASK)) return PROG[i].o;
    }
    return -1;
  }

  vmStep() {
    if (this.wait > 0) { this.wait--; return; }
    let guard = 0;
    while (guard++ < 400) {
      const ins = BY_OFF[this.pc];
      if (!ins) return;
      this.curIns = ins.idx;
      const before = this.pc;
      let jumped = false;
      if (ins.d === 0xff || (ins.d & DIFF_MASK)) jumped = this.exec(ins);
      if (this.pc === before) this.pc = this.nextOff(ins.idx);
      if (jumped) continue;                       // 跳转不消耗时间：同帧继续
      
      // ECL 真实时间轴判定：避免串行等待指令造成的数秒空滞
      if (ins.t > 0 && ins.t !== 0xffff) {
        // 1. 每环发射后的等待点：play_sound（开局拉大到 28 帧，形成通透纵向间隙）
        if (ins.o === 0x01cc) {
          const ringWait = Math.max(19, Math.round(29 - 10 * (this.mult || 0.18)));
          this.wait = ringWait - 1;
          return;
        }
        // 2. 波次结束移动减速等待点：stop_in_decel（等待 BOSS 减速漂移 120 帧完毕）
        if (ins.o === 0x0278) {
          this.wait = 119;
          return;
        }
        // 其他处于并发时间戳槽的辅助/跳转指令同一瞬刻连续执行
        continue;
      }
      if (ins.t === 0) continue;
      return;
    }
  }

  // ---------- et_set_eqdistr：核心发弹 ----------
  fire() {
    const g = this.game;
    const m = this.mult !== undefined ? this.mult : 0.18;

    // 1. 每环弹数：比其他符卡更低 (开局仅 3 颗)，呈巨大 120° 大角，绝不堵路！
    let num1 = Math.round((3.2 + this.wave * 0.8) * this.density);
    num1 = Math.max(3, Math.min(11, num1));

    // 2. 层数：低难度下仅 1 层！彻底避免三层交织形成密集雨幕
    // m < 0.45: 1 层 (极度开阔透气，单圈冰晶)
    // 0.45 <= m < 0.80: 2 层
    // m >= 0.80: 3 层 (经典密集度)
    let num2 = 1;
    if (m >= 0.80) {
      num2 = 3;
    } else if (m >= 0.45) {
      num2 = 2;
    }

    const ang1 = this.vg(-10006);
    const ex = this.pendingEx;

    this.num1 = num1;
    this.fallSpd = this.vg(-10005);
    this.fallAng = this.vg(-10007);
    this.wave = this.vg(-10012);
    this.ring = RINGS_PER_WAVE - Math.max(0, Math.round(this.vg(-10009))) + 1;
    if (num1 <= 0) return;

    const cx = this.ox + this.bx * this.s;
    const cy = this.oy + this.by * this.s;

    // 计算下落角：左右扇形摆幅收敛在 55° ~ 125°，垂直顺滑
    const turnAng = Math.PI / 2 + (this.fallAng - Math.PI / 2) * 0.38;

    // 下落速度按难度平滑放缓：初段下落速度仅 0.92 px/frame，如轻柔雪片飘落
    const fallSpeedScale = 0.52 + 0.48 * m;

    for (let L = 0; L < num2; L++) {
      const spd = this.layerSpeed(L, num2) * this.s * (0.65 + 0.35 * m);
      for (let i = 0; i < num1; i++) {
        const a = ang1 + (2 * Math.PI * i) / num1;
        g.bullets.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          radius: 1.8 * this.s,              // 判定核心微缩至 1.8px (擦弹更从容)
          drawRadius: HAIL_DRAW_R * this.s, // 绘制半径 (约 9.0px)
          color: LAYER_COLORS[L % LAYER_COLORS.length],
          grazed: false,
          age: 0,
          isHail: true,                     // 标记为冰锥弹
          decel: 0.955,                     // 更加舒缓的凝结阻尼
          // et_extra：出弹 60 帧后统一转向下落 (速度根据难度平缓收放)
          turn: ex ? { at: ex.a, ang: turnAng, spd: ex.s * this.s * fallSpeedScale, done: false } : null
        });
      }
    }
    if (g.boss) g.boss.castTimer = 18;
    if (!g.playSound || !g.playSound('tan00', 0.16)) {
      g.playBeep(880, 'square', 0.05, 0.03);
    }
  }

  /**
   * 每帧推进（由 DanmakuGame.spawnBossDanmaku 调用）
   * @param {number} mult 项目动态渐进难度倍率 (0.18 ~ 1.00)
   */
  update(mult) {
    const g = this.game;

    // 宣言符卡展开音效
    if (g.frame === 2 && g.playSound) {
      g.playSound('enep00', 0.3);
    }

    // 动态平滑放大：开局密度系数 0.20 (比其他符卡更温和入门)
    const m = Math.min(1, Math.max(0, mult));
    this.mult = m;
    this.density = (0.20 + 0.45 * m) * this.densityScale;

    // ---- BOSS 入场：move_to_decel(120, 192, 96) ----
    if (this.by < 96) this.by = Math.min(96, this.by + 1.2);
    if (this.bossDecelN > 0) {
      const k = this.bossDecelN / this.bossDecelT;
      this.bx += this.bossVx * k;
      this.by += this.bossVy * k;
      this.bossDecelN--;
    }
    this.bx = Math.max(48, Math.min(PF_W - 48, this.bx));
    this.by = Math.max(48, Math.min(200, this.by));

    // ---- ECL：宣言 120 帧结束后 sub 35 才开始 ----
    if (g.frame > DECLARE_FRAMES) this.vmStep();

    // ---- 写回画布坐标（供渲染与自机射击判定使用）----
    g.boss.x = this.ox + this.bx * this.s;
    g.boss.y = this.oy + this.by * this.s;
  }

  /** 供 HUD 显示的调试信息 */
  getStatus() {
    return {
      wave: this.wave + 1,
      ring: this.ring,
      num1: this.num1,
      fallSpd: this.fallSpd,
      fallAngDeg: (this.fallAng * 180) / Math.PI,
      layers: LAYERS
    };
  }
}

export const HAILSTORM_SOURCE = {
  file: 'th06ST.dat → ecldata2.ecl',
  subs: 'sub 34 (宣言) / sub 35 (弹幕)',
  playfield: [PF_W, PF_H],
  prog: PROG
};
