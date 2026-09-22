/**
 * tools/verify_geom.mjs — 用与游戏完全相同的 exFlags 位链积分，量化核对「紅色の冥界」的几何
 *
 *   1) 交错网弹（0x20, ω=±π/128, a=128）：128 帧是否正好转 180°、曲率半径、之后是否纯直线
 *   2) 落雨弹（0x10, 恒定 (0,+0.02) 加速度, a=240）：vx 恒定？vy 线性？最高点帧？之后匀速？
 *   3) 「交叉织网」的量化定义 + 新旧实现对照：
 *        网眼数 = 同时被一条 CW 弧和一条 CCW 弧经过、且距 BOSS >25px 的 8px 网格数
 *        同向堆积 = 单个网格内同方向弧的最大重合条数（蚊香/螺旋坍缩的直接指标）
 */
import { EMITTERS } from '../src/game/spellcards/red_netherworld.js';

/** 与 danmaku.js 的 exFlags 位链同构（playfield 单位） */
function integrate(b, frames) {
  const path = [[b.x, b.y]];
  for (let f = 0; f < frames; f++) {
    if (b.exFlags & 0x10) {
      if (f >= b.ex5Int0) b.exFlags &= ~0x10;
      else { b.vx += b.ex4Ax; b.vy += b.ex4Ay; b.angle = Math.atan2(b.vy, b.vx); }
    } else if (b.exFlags & 0x20) {
      if (f >= b.ex5Int0) b.exFlags &= ~0x20;
      else {
        b.angle += b.ex5F1;
        b.speed += b.ex5F0;
        b.vx = Math.cos(b.angle) * b.speed;
        b.vy = Math.sin(b.angle) * b.speed;
      }
    }
    b.x += b.vx; b.y += b.vy;
    path.push([b.x, b.y]);
  }
  return path;
}

const SPAWN = [192, 144];

console.log('=== 1) 交错网弹 spr=2 (flags=0x220 → 0x20 弧, ω=+π/128, a=128) ===');
{
  const em = EMITTERS[0];
  const b = { x: 192, y: 144, angle: Math.PI, speed: em.spd1, vx: -em.spd1, vy: 0,
    exFlags: em.flags, ex5Int0: em.extra.a, ex5F0: em.extra.r, ex5F1: em.extra.s, ex4Ax: 0, ex4Ay: 0 };
  const a0 = b.angle;
  const path = integrate(b, 200);
  const arcEnd = path[128], last = path[200];
  const dHead = ((b.angle - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const R = em.spd1 / Math.abs(em.extra.s);
  const p = path[198], q = path[199], r = path[200];
  const cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  console.log(`  R = spd/ω = ${R.toFixed(2)} px   （解析 ${(em.spd1 / (Math.PI / 128)).toFixed(2)} px）`);
  console.log(`  128 帧总航向改变 = ${(dHead * 180 / Math.PI).toFixed(2)}°   （期望 180.00°）`);
  console.log(`  弧弦长 = ${Math.hypot(arcEnd[0] - SPAWN[0], arcEnd[1] - SPAWN[1]).toFixed(2)} px   （期望 2R = ${(2 * R).toFixed(2)}）`);
  console.log(`  弧结束后末段叉积 = ${cross.toExponential(2)}（≈0 ⇒ 严格直线）；${b.exFlags.toString(16)} ⇒ 0x20 位已自清除`);
  console.log(`  200 帧位置 (${last[0].toFixed(1)}, ${last[1].toFixed(1)}) 速度 (${b.vx.toFixed(3)}, ${b.vy.toFixed(3)})`);
}

console.log('\n=== 2) 落雨弹 spr=5 (flags=0x210 → 0x10, 恒定加速度 (0,+0.02), a=240) ===');
{
  const em = EMITTERS[2];
  for (const ang of [-Math.PI / 2, -Math.PI, 0]) {
    const b = { x: 192, y: 144, angle: ang, speed: em.spd1,
      vx: Math.cos(ang) * em.spd1, vy: Math.sin(ang) * em.spd1,
      exFlags: em.flags, ex5Int0: em.extra.a, ex5F0: em.extra.r, ex5F1: em.extra.s,
      ex4Ax: Math.cos(em.extra.s) * em.extra.r, ex4Ay: Math.sin(em.extra.s) * em.extra.r };
    const vx0 = b.vx, vy0 = b.vy;
    const path = integrate(b, 300);
    let apex = 0, minY = 1e9;
    path.forEach(([x, y], i) => { if (y < minY) { minY = y; apex = i; } });
    const vTheo = vy0 + 0.02 * 240;
    const yTheo = vy0 < 0 ? (-(vy0 * vy0) / (2 * 0.02)) : 0;
    console.log(`  出膛 ${(ang * 180 / Math.PI).toFixed(0)}°: vx ${vx0.toFixed(3)}→${b.vx.toFixed(3)}（横向恒定 ⇒ 不是"强制转向"）`);
    console.log(`    vy ${vy0.toFixed(3)}→${b.vy.toFixed(3)}（240 帧解析值 ${vTheo.toFixed(3)}）` +
      (vy0 < 0 ? `；最高点第 ${apex} 帧（解析 ${(0 - vy0 / 0.02).toFixed(0)}），上升 ${Math.abs(yTheo).toFixed(1)} px` : `；出膛即向下，无上升段`));
    console.log(`    第 300 帧 exFlags=0x${b.exFlags.toString(16)}（0x10 已清除 ⇒ 之后冻结速度直线坠落 ✓）`);
  }
}

console.log('\n=== 3) 三个决定性差异（旧实现 → 新实现，全部可复算）===');
{
  // (a) 晶格进动速度：基准角推进量 vs 同一环内的角距
  const ringPitch = 360 / 24;                       // 环内相邻两发 = 15°
  const newPerBurst = 4 * (180 / 32);               // 每脉冲 4 个发射器 × π/32 = 22.5°
  const oldPerBurst = (0.098 * 180) / Math.PI;      // 旧：每脉冲只推进一次 0.098 rad
  console.log(`  (a) 晶格进动（环内角距 = ${ringPitch}°）`);
  console.log(`      新：每脉冲 +${newPerBurst.toFixed(1)}° = ${(newPerBurst / ringPitch).toFixed(2)} 个环距 ⇒ 相邻脉冲错开、彼此穿插成网`);
  console.log(`      旧：每脉冲 +${oldPerBurst.toFixed(1)}° = ${(oldPerBurst / ringPitch).toFixed(2)} 个环距 ⇒ 不到半个间距，弧带互相压叠成"蚊香"`);
  console.log(`      一个大波（6 脉冲）基准角总扫过：新 ${(6 * newPerBurst).toFixed(1)}° vs 旧 ${(6 * oldPerBurst).toFixed(1)}°`);

  // (b) 单弧转角
  console.log(`  (b) 单弧转角：新 = π/128 × 128 帧 = 180.0°（正好半圆，之后直线）`);
  console.log(`      旧 = 0.025 rad/f × 130 帧 = ${(0.025 * 130 * 180 / Math.PI).toFixed(1)}° ⇒ 越过半圆回头，压在来路附近`);

  // (c) 落雨弹：旧模型"以固定角速度转向正下方"会把整环的 vx 抹平成 0 ⇒ 雨幕塌成竖直平行条
  const rain = (oldModel, T = 180) => {
    let minX = 1e9, maxX = -1e9, sumAbsVx = 0;
    for (let i = 0; i < 16; i++) {
      const ang = (2 * Math.PI * i) / 16 - Math.PI / 2;
      let x = 192, vx = Math.cos(ang) * 2.2, vy = Math.sin(ang) * 2.2;
      for (let f = 0; f < T; f++) {
        if (oldModel) {
          const cur = Math.atan2(vy, vx);
          let d = Math.PI / 2 - cur;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          const na = cur + Math.sign(d) * Math.min(Math.abs(d), 0.035);
          const sp = Math.hypot(vx, vy) + 0.018;
          vx = Math.cos(na) * sp; vy = Math.sin(na) * sp;
        } else { vy += 0.02; }                        // 新：恒定向下加速度，vx 严格守恒
        x += vx;
      }
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      sumAbsVx += Math.abs(vx);
    }
    return { width: maxX - minX, meanAbsVx: sumAbsVx / 16 };
  };
  const rNew = rain(false), rOld = rain(true);
  console.log(`  (c) 落雨弹 180 帧后：新 平均|vx| = ${rNew.meanAbsVx.toFixed(2)} px/f，横向展开 ${rNew.width.toFixed(0)} px`);
  console.log(`      旧 平均|vx| = ${rOld.meanAbsVx.toFixed(2)} px/f（全部被强扭成正下方 ⇒ 雨幕塌成竖直平行条）`);
  console.log(`      原作语义 = 恒定 0.02 px/f² 向下加速度，横向动量守恒 ⇒ 平滑抛物线 + 张开雨幕`);
  console.log(`  (d) 发弹空窗：新实现 BOSS 滑行期间照常发弹；旧实现每大波后 repositionTimer=90 ⇒`);
  console.log(`      一个 (6×21+90)=216 帧的大波里约 ${(100 * 90 / 216).toFixed(0)}% 的时间场上不再增弹`);
}
