import { readFileSync } from 'fs';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const ROOT = 'D:/苍蝇';
const graphData = JSON.parse(readFileSync(ROOT + '/public/data/connectome/graph.json', 'utf8'));

// 复刻 train.js 的 evaluateCandidate，然后检查 bestFitness 是否可复现
function evaluateCandidate(weights, seeds, brain, maxFrames = 1200) {
  let totalScore = 0;
  const policy = new ReadoutPolicy(weights);
  for (let s = 0; s < seeds.length; s++) {
    const seed = seeds[s];
    const spellcard = s % 3;
    brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed });
    game.setSpellcard(spellcard);
    game.player.lives = 1; game.player.maxLives = 1;
    game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
    let frames = 0, wallPenalty = 0;
    while (!game.player.isDead && frames < maxFrames) {
      const obs = game.getBiologicalSensoryInput();
      const dn = brain.step(obs, false);
      const motor = policy.forward(dn);
      game.update(motor);
      frames++;
      if (game.player.x < 32 || game.player.x > game.width - 32) wallPenalty += 0.25;
    }
    const fitness = frames + game.player.graze * 4.0 - wallPenalty;
    totalScore += Math.max(1, fitness);
  }
  return totalScore / seeds.length;
}

const brain = new MaleCNSConnectome(graphData);

// 测: 用一组明显更好的权重 vs 随机权重, fitness 有区分度吗?
console.log('=== 检查1: fitness 是否有区分度 (训练种子 11/23/37) ===');
const seeds = [11, 23, 37];
const zeroW = new Float64Array(PARAMETERS);
console.log('全零权重 fitness:', evaluateCandidate(zeroW, seeds, brain, 1200).toFixed(2));

const randW = new Float64Array(PARAMETERS);
for (let i = 0; i < PARAMETERS; i++) randW[i] = (Math.random() - 0.5) * 0.8;
console.log('随机权重 fitness:', evaluateCandidate(randW, seeds, brain, 1200).toFixed(2));

// 检查帧数分布 - 是否所有种子都打满 1200?
console.log('\n=== 检查2: 训练帧数是否饱和 (逐种子) ===');
const p = new ReadoutPolicy(randW);
for (const s of seeds) {
  brain.reset();
  const game = new DanmakuGame(null, { width: 460, height: 580, seed: s });
  game.setSpellcard(seeds.indexOf(s) % 3);
  game.player.lives = 1; game.player.maxLives = 1;
  game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
  let f = 0;
  while (!game.player.isDead && f < 1200) {
    const o = game.getBiologicalSensoryInput();
    const d = brain.step(o, false);
    game.update(p.forward(d));
    f++;
  }
  console.log(`  seed ${s}: ${f} 帧 ${f>=1200?'⚠️打满上限':'死亡'}`);
}

// 检查3: 用不同代种子看 fitness 稳定性
console.log('\n=== 检查3: 不同代种子下 随机权重 fitness 波动 ===');
for (const g of [0, 5, 10, 20, 39]) {
  const gs = [g * 79 + 11, g * 79 + 23, g * 79 + 37];
  console.log(`  代${g+1} 种子: ${evaluateCandidate(randW, gs, brain, 1200).toFixed(1)}`);
}
