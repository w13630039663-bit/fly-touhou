/**
 * 为什么三种模式都不死？检查无敌帧/复活逻辑与子弹可行性
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 直接复刻 Sim，但加上诊断
class Sim {
  constructor(seed) {
    this.seed = seed; this.width = 520; this.height = 700;
    this.player = { x: this.width / 2, y: this.height * 0.8, speed: 3.6, radius: 4.0 };
    this.bullets = []; this.frame = 0; this.grazeCount = 0;
    this.deaths = 0;
  }
  nextRandom() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  spawnBullets() {
    const f = this.frame;
    const bossX = this.width / 2 + Math.sin(f * 0.025) * 160;
    const bossY = 90;
    if (f % 20 === 0) { const c = 12, ba = f * 0.08; for (let i = 0; i < c; i++) { const a = ba + (i / c) * Math.PI * 2; this.bullets.push({ x: bossX, y: bossY, vx: Math.cos(a) * 2.4, vy: Math.sin(a) * 2.4, radius: 4.5 }); } }
    if (f % 45 === 0) { const dx = this.player.x - bossX, dy = this.player.y - bossY, ang = Math.atan2(dy, dx); for (let sp = -1; sp <= 1; sp++) { const a = ang + sp * 0.12; this.bullets.push({ x: bossX, y: bossY, vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 3.2, radius: 5.0 }); } }
    if (f % 28 === 0) { const rx = 50 + this.nextRandom() * (this.width - 100); this.bullets.push({ x: rx, y: 40, vx: (this.nextRandom() - 0.5) * 0.6, vy: 2.6 + this.nextRandom() * 1.0, radius: 4.5 }); }
  }
  step(mx, my) {
    this.frame++; this.spawnBullets();
    this.player.x += mx * this.player.speed; this.player.y += my * this.player.speed;
    this.player.x = Math.max(20, Math.min(this.width - 20, this.player.x));
    this.player.y = Math.max(20, Math.min(this.height - 20, this.player.y));
    // 关键诊断：统计"能真正构成威胁"的子弹
    let closest = 999;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]; b.x += b.vx; b.y += b.vy;
      const dx = b.x - this.player.x, dy = b.y - this.player.y, d2 = dx * dx + dy * dy;
      const d = Math.sqrt(d2); if (d < closest) closest = d;
      const hd = b.radius + this.player.radius;
      if (d2 < hd * hd) { this.deaths++; return { dead: true, frame: this.frame }; }
      if (b.y > this.height + 30 || b.y < -30 || b.x < -30 || b.x > this.width + 30) this.bullets.splice(i, 1);
    }
    this.closest = closest;
    return { dead: false, frame: this.frame };
  }
}

// 诊断 1：完全静止能否存活？
console.log('=== 诊断1：静止不动 (moveX=0, moveY=0) ===');
for (const seed of [1, 2, 80001, 80002]) {
  const sim = new Sim(seed);
  let minClosest = 999;
  while (sim.frame < 1800) {
    const r = sim.step(0, 0);
    if (sim.closest < minClosest) minClosest = sim.closest;
    if (r.dead) break;
  }
  console.log(`  种子${seed}: 存活 ${sim.frame} 帧, 死亡${sim.deaths}次, 最近子弹距离 ${minClosest.toFixed(1)}px`);
}

// 诊断 2：子弹总数与自机位置分布
console.log('\n=== 诊断2：子弹几何分布 ===');
const sim = new Sim(1);
while (sim.frame < 600) sim.step(0, 0);
console.log(`  第600帧: 场上子弹 ${sim.bullets.length} 枚`);
let above = 0, below = 0;
for (const b of sim.bullets) { if (b.y < sim.player.y) above++; else below++; }
console.log(`  自机上方 ${above} 枚, 下方 ${below} 枚`);
console.log(`  自机位置: (${sim.player.x.toFixed(0)}, ${sim.player.y.toFixed(0)})`);

// 诊断 3：把自机往上推，看能否撞弹
console.log('\n=== 诊断3：主动撞弹测试 (强推向上) ===');
for (const seed of [1, 80001]) {
  const s = new Sim(seed);
  let dead = false, df = 0;
  while (s.frame < 1800) {
    const r = s.step(0, -1); // 持续向上冲
    if (r.dead) { dead = true; df = s.frame; break; }
  }
  console.log(`  种子${seed}: ${dead ? `第 ${df} 帧撞弹身亡` : '1800 帧仍未撞到'}`);
}
