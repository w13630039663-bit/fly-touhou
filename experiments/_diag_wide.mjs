// 诊断：wide 的 24 个扇区通道为什么大量不激活
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8'));
const ckpt = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/checkpoint.json'), 'utf8'));
const policy = new ReadoutPolicy(new Float64Array(ckpt.weights));
const brain = new MaleCNSConnectome(graph);

const NCH = 32;
const active = new Array(NCH).fill(0);
const maxV = new Array(NCH).fill(0);
const sumV = new Array(NCH).fill(0);
let frames = 0;
let bulletsSeen = 0, approaching = 0, nearOnly = 0;
const approachDist = [];

const SEEDS = [11, 42, 97, 1234, 80001, 80007, 80013];
for (const seed of SEEDS) {
  for (let sc = 0; sc < 3; sc++) {
    brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed, sensoryMode: 'wide' });
    game.setSpellcard(sc);
    game.player.lives = 1; game.player.maxLives = 1;
    game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
    let f = 0;
    while (!game.player.isDead && f < 1200) {
      const obs = game.getBiologicalSensoryInput();
      for (let c = 8; c < NCH; c++) {
        const v = obs[c];
        if (v > 0.05) { active[c]++; sumV[c] += v; }
        if (v > maxV[c]) maxV[c] = v;
      }
      frames++;

      const px = game.player.x, py = game.player.y;
      for (const b of game.bullets) {
        const dx = b.x - px, dy = b.y - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= 240 || d <= 1) continue;
        bulletsSeen++;
        const ap = -(dx * b.vx + dy * b.vy) / d;
        if (ap > 0.05) { approaching++; approachDist.push(ap); }
        else if (d < 36) nearOnly++;
      }

      const dn = brain.step(obs, false);
      game.update(policy.forward(dn));
      f++;
    }
  }
}

console.log(`总帧数 ${frames} (${SEEDS.length} 种子 x 3 符卡)`);
console.log(`\n=== 24 个扇区通道激活率 (值 > 0.05 的帧占比) ===`);
const names = ['威胁', '逼近速', '密度 '];
for (let s = 0; s < 8; s++) {
  const row = [0, 1, 2].map(k => {
    const c = 8 + s * 3 + k;
    const rate = (active[c] / frames * 100);
    const avg = active[c] ? (sumV[c] / active[c]) : 0;
    return `${names[k]} ${rate.toFixed(1).padStart(5)}% avg=${avg.toFixed(2)} max=${maxV[c].toFixed(2)}`;
  });
  console.log(`  扇区${s}: ${row.join(' | ')}`);
}
const liveChans = [];
for (let c = 8; c < NCH; c++) if (active[c] / frames > 0.02) liveChans.push(c);
console.log(`\n激活率 > 2% 的扇区通道: ${liveChans.length} / 24`);

console.log(`\n=== 场景统计 ===`);
console.log(`视距内弹幕样本 ${bulletsSeen}`);
console.log(`  正在逼近 (approachSpeed>0.05): ${(approaching / bulletsSeen * 100).toFixed(1)}%`);
console.log(`  仅近距离(d<36)但未逼近  : ${(nearOnly / bulletsSeen * 100).toFixed(1)}%`);
if (approachDist.length) {
  approachDist.sort((a, b) => a - b);
  const q = p => approachDist[Math.floor(approachDist.length * p)].toFixed(2);
  console.log(`  接近速度分布: p10=${q(0.1)} p50=${q(0.5)} p90=${q(0.9)} max=${approachDist[approachDist.length - 1].toFixed(2)}`);
  console.log(`  ⇒ 若 TTC 用 dist/approachSpeed 且要求 approachSpeed 够大, 有效样本极少`);
}
