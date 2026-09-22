/**
 * tools/verify_timescale.mjs — 证明渐进难度的「等比时间缩放 k」不改变轨迹几何
 *
 * 判定不变量（全部应为 playfield 口径的常数，与 k 无关）：
 *   弧弹 0x20：R = speed/|ω|、总转角 = |ω| × 持续帧数
 *   雨弹 0x10：总速度增量 = |a| × 持续帧数、抛物线顶点高度 = v⊥²/(2a)
 * 若 k 的实现正确，k=0.62 与 k=1.00 下这四个量必须逐位相同（只是耗时 1/k 倍）。
 */
import { DanmakuGame } from '../src/game/danmaku.js';
import { EMITTERS } from '../src/game/spellcards/red_netherworld.js';

function probe(survivalTime) {
  const g = new DanmakuGame(null, { width: 460, height: 580 });
  g.setSpellcard(4);
  g.survivalTime = survivalTime;           // 决定 mult ⇒ 决定 k
  let arc = null, rice = null;
  for (let f = 0; f < 400 && !(arc && rice); f++) {
    g.update();
    for (const b of g.bullets) {
      const pf = g.redNetherworld.s;
      if (!arc && b.isRedNetherBall) {
        arc = {
          k: g.redNetherworld.timeScale,
          spd: Math.hypot(b.vx, b.vy) / pf,
          omega: Math.abs(b.ex5F1),
          dur: b.ex5Int0,
        };
      }
      if (!rice && b.isRedRice) {
        rice = {
          k: g.redNetherworld.timeScale,
          v0: Math.hypot(b.vx, b.vy) / pf,
          a: Math.hypot(b.ex4Ax, b.ex4Ay) / pf,
          dur: b.ex5Int0,
        };
      }
    }
  }
  return { arc, rice, mult: g.redNetherworld.mult };
}

for (const [label, st] of [['最简单 (t=0s)', 0], ['60 秒后 (原作口径)', 9999]]) {
  const p = probe(st);
  const a = p.arc, r = p.rice;
  const R = a.spd / a.omega;
  const turn = a.omega * a.dur;
  const dv = r.a * r.dur;
  const apexUp = (0 - (-r.v0)) ** 2 / (2 * r.a);   // 向上出膛那一发的上升高度
  console.log(`${label}: mult=${p.mult.toFixed(2)}  k=${a.k.toFixed(3)}`);
  console.log(`   弧弹  spd=${a.spd.toFixed(3)} px/f  ω=${a.omega.toFixed(5)} rad/f  持续=${a.dur}f`);
  console.log(`   → 弧半径 R=${R.toFixed(2)} px【几何不变量】   总转角=${(turn * 180 / Math.PI).toFixed(2)}°【几何不变量，≈180°】`);
  console.log(`   雨弹  v0=${r.v0.toFixed(3)} px/f  a=${r.a.toFixed(5)} px/f²  持续=${r.dur}f`);
  console.log(`   → 向上发上升高度=${apexUp.toFixed(1)} px【几何不变量】   总Δv=${dv.toFixed(3)} = 4.80·k=${(4.8 * a.k).toFixed(3)}【按 k 缩放，非不变量】`);
  console.log(`   → 走完同一条抛物线耗时 ${r.dur}f = ${(r.dur / 60).toFixed(2)}s（k=1 时 240f = 4.00s）`);
}
console.log(`\nEMITTERS 原作口径: 弧弹 spd1=${EMITTERS[0].spd1} ω=${(EMITTERS[0].extra.s).toFixed(5)} a=${EMITTERS[0].extra.a} ⇒ R=${(EMITTERS[0].spd1 / EMITTERS[0].extra.s).toFixed(2)} px, 转角 180°`);
