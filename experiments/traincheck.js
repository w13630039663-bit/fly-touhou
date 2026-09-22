import { readFileSync } from 'fs';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const ROOT = 'D:/苍蝇';
const graphData = JSON.parse(readFileSync(ROOT + '/public/data/connectome/graph.json', 'utf8'));
const ckpt = JSON.parse(readFileSync(ROOT + '/public/data/checkpoint.json', 'utf8'));
const brain = new MaleCNSConnectome(graphData);
const W = new Float64Array(ckpt.weights);

function newGame(s) {
  const g = new DanmakuGame(null, { width: 460, height: 580, seed: s });
  g.setSpellcard(s % 3);
  g.player.lives = 1; g.player.maxLives = 1;
  g.player.autoRespawn = false; g.player.invulnerableTimer = 0;
  return g;
}

// 复现 evaluateCandidate: 用训练种子重算 fitness
function evalCandidate(weights, seeds, maxFrames = 1200) {
  const p = new ReadoutPolicy(weights);
  let total = 0;
  for (let s = 0; s < seeds.length; s++) {
    const seed = seeds[s], spellcard = s % 3;
    brain.reset();
    const g = newGame(seed);
    let frames = 0, wallPenalty = 0;
    while (!g.player.isDead && frames < maxFrames) {
      const obs = g.getBiologicalSensoryInput();
      const dn = brain.step(obs, false);
      g.update(p.forward(dn));
      frames++;
      if (g.player.x < 32 || g.player.x > g.width - 32) wallPenalty += 0.25;
    }
    total += Math.max(1, frames + g.player.graze * 4.0 - wallPenalty);
  }
  return total / seeds.length;
}

console.log('=== 用 checkpoint 权重在训练种子上复现 fitness ===');
for (const g of [0, 5, 10, 20, 39]) {
  const seeds = [g * 79 + 11, g * 79 + 23, g * 79 + 37];
  const f = evalCandidate(W, seeds, 1200);
  console.log(`第 ${g+1} 代训练种子 fitness: ${f.toFixed(1)}`);
}
console.log(`\ncheckpoint 自报 bestFitness: ${ckpt.bestFitness}`);

// 检查: 训练种子上权重表现如何
console.log('\n=== 重要区分: 训练种子 vs 测试种子 ===');
console.log('train 每代仅用 3 个种子 (共 40 代 = 120 个不同种子), 测试用 20 个全新种子');
console.log('若训练种子 fitness 远高于测试种子, 说明过拟合或训练不足');
