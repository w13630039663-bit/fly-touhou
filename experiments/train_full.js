/**
 * train_full.js - 加强版 CEM 训练 (可信基准用)
 * 相对 train.js 的改进:
 *  1. 每代训练种子从 3 增至 12 (降低 fitness 噪点, 提升泛化)
 *  2. 代数 40 -> 100, 种群 48 -> 64
 *  3. 训练过程中同步记录随机基线 fitness, 判断是否真的学到东西
 *  4. 记录历史 best 曲线
 *  5. 不写回项目 checkpoint, 输出到 experiments/checkpoint.full.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const graphData = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8'));

const MAX_FRAMES = 1200;

export function evaluateCandidate(weights, seeds, brain, maxFrames = MAX_FRAMES) {
  let totalScore = 0;
  const policy = new ReadoutPolicy(weights);
  for (let s = 0; s < seeds.length; s++) {
    const seed = seeds[s];
    const spellcard = (seed + s) % 3;
    brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed });
    game.setSpellcard(spellcard);
    game.player.lives = 1; game.player.maxLives = 1;
    game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
    let frames = 0, wallPenalty = 0;
    while (!game.player.isDead && frames < maxFrames) {
      const obs = game.getBiologicalSensoryInput();
      const dn = brain.step(obs, false);
      game.update(policy.forward(dn));
      frames++;
      if (game.player.x < 32 || game.player.x > game.width - 32) wallPenalty += 0.25;
    }
    totalScore += Math.max(1, frames + game.player.graze * 4.0 - wallPenalty);
  }
  return totalScore / seeds.length;
}

const GENERATIONS = 100;
const POP = 64;
const ELITE = 8;
const SEEDS_PER_GEN = 12;

const brain = new MaleCNSConnectome(graphData);
let mu = new Float64Array(PARAMETERS);
let sigma = new Float64Array(PARAMETERS).fill(0.8);
let bestFitness = -1;
let bestWeights = new Float64Array(PARAMETERS);
const history = [];
const t0 = Date.now();

// 随机基线(测量训练种子的自然水平)
const rndW = new Float64Array(PARAMETERS);
for (let i = 0; i < PARAMETERS; i++) rndW[i] = (Math.random() - 0.5) * 0.8;
console.log('随机初始化基线(第0代种子):', evaluateCandidate(rndW, [11,23,37,49,61,73,85,97,109,121,133,145], brain).toFixed(1));

console.log(`\n开始训练: ${GENERATIONS} 代 × ${POP} 候选 / ${ELITE} 精英 / 每代 ${SEEDS_PER_GEN} 种子\n`);

for (let g = 0; g < GENERATIONS; g++) {
  const trainSeeds = Array.from({ length: SEEDS_PER_GEN }, (_, i) => g * 137 + 11 + i * 12);
  const candidates = [];
  for (let c = 0; c < POP; c++) {
    const w = new Float64Array(PARAMETERS);
    if (c === 0 && g > 0) w.set(bestWeights);
    else for (let i = 0; i < PARAMETERS; i++) {
      const u1 = Math.random() || 1e-7, u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      w[i] = mu[i] + sigma[i] * z;
    }
    candidates.push({ weights: w, score: evaluateCandidate(w, trainSeeds, brain) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const elites = candidates.slice(0, ELITE);
  if (elites[0].score > bestFitness) { bestFitness = elites[0].score; bestWeights.set(elites[0].weights); }

  const newMu = new Float64Array(PARAMETERS);
  for (const e of elites) for (let i = 0; i < PARAMETERS; i++) newMu[i] += e.weights[i] / ELITE;
  const newSigma = new Float64Array(PARAMETERS);
  for (const e of elites) for (let i = 0; i < PARAMETERS; i++) { const d = e.weights[i] - newMu[i]; newSigma[i] += d * d / ELITE; }
  for (let i = 0; i < PARAMETERS; i++) newSigma[i] = Math.max(0.06, Math.sqrt(newSigma[i]));
  for (let i = 0; i < PARAMETERS; i++) {
    mu[i] = 0.3 * mu[i] + 0.7 * newMu[i];
    sigma[i] = 0.3 * sigma[i] + 0.7 * newSigma[i];
  }

  const eliteAvg = elites.reduce((s, e) => s + e.score, 0) / ELITE;
  history.push({ gen: g + 1, eliteAvg, best: bestFitness, elite0: elites[0].score });
  if ((g + 1) % 10 === 0 || g === 0) {
    console.log(`代 ${String(g+1).padStart(3)}/${GENERATIONS} [${((Date.now()-t0)/1000).toFixed(0)}s] 精英均值 ${eliteAvg.toFixed(1)} | 本代最优 ${elites[0].score.toFixed(1)} | 历史最佳 ${bestFitness.toFixed(1)}`);
  }
}

console.log(`\n训练完成, 历史最佳适应度: ${bestFitness.toFixed(1)}, 耗时 ${((Date.now()-t0)/1000).toFixed(1)}s`);

// ==== 独立测试集六项对照 ====
const TEST_SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);

function runGame(seed, mode, policy) {
  brain.reset();
  const game = new DanmakuGame(null, { width: 460, height: 580, seed });
  game.setSpellcard(seed % 3);
  game.player.lives = 1; game.player.maxLives = 1;
  game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
  let f = 0;
  while (!game.player.isDead && f < 1800) {
    let motor;
    if (mode === 'fixed') motor = policy; // {moveX,moveY}
    else if (mode === 'brain-silent') motor = policy.forward(brain.step(game.getBiologicalSensoryInput(), true));
    else motor = policy.forward(brain.step(game.getBiologicalSensoryInput(), false));
    game.update(motor);
    f++;
  }
  return { frames: f, graze: game.player.graze };
}

function evalMode(mode, policy) {
  let tf = 0, tg = 0;
  for (const s of TEST_SEEDS) { const r = runGame(s, mode, policy); tf += r.frames; tg += r.graze; }
  return { frames: tf / TEST_SEEDS.length, graze: tg / TEST_SEEDS.length };
}

const trainedPolicy = new ReadoutPolicy(bestWeights);
const R = {
  trained: evalMode('brain', trainedPolicy),
  silenced: evalMode('brain-silent', trainedPolicy),
  idle: evalMode('fixed', { moveX: 0, moveY: 0 }),
  driftBR: evalMode('fixed', { moveX: 1, moveY: 1 }),
  driftBL: evalMode('fixed', { moveX: -1, moveY: 1 }),
};
// 随机基线: 固定 5 个种子, 各跑一次, 报告均值与范围
const randRuns = [];
for (const rs of [11, 22, 33, 44, 55]) {
  const rw = new Float64Array(PARAMETERS);
  let st = rs;
  const rnd = () => { st = (st * 1664525 + 1013904223) % 4294967296; return st / 4294967296; };
  for (let i = 0; i < PARAMETERS; i++) rw[i] = (rnd() - 0.5) * 0.8;
  randRuns.push(evalMode('brain', new ReadoutPolicy(rw)));
}
const randMean = randRuns.reduce((s, r) => s + r.frames, 0) / randRuns.length;
const randMin = Math.min(...randRuns.map(r => r.frames));
const randMax = Math.max(...randRuns.map(r => r.frames));

console.log('\n========== 独立测试集基准 (20 种子 80001-80020, 上限 1800 帧) ==========');
console.log(`连接组 + 训练策略          : ${R.trained.frames.toFixed(1)} 帧 (${(R.trained.frames/60).toFixed(2)}s)  擦弹 ${R.trained.graze.toFixed(1)}`);
console.log(`大脑静音消融               : ${R.silenced.frames.toFixed(1)} 帧 (${(R.silenced.frames/60).toFixed(2)}s)`);
console.log(`静止不动                   : ${R.idle.frames.toFixed(1)} 帧 (${(R.idle.frames/60).toFixed(2)}s)`);
console.log(`固定右下 (1,1)             : ${R.driftBR.frames.toFixed(1)} 帧 (${(R.driftBR.frames/60).toFixed(2)}s)`);
console.log(`固定左下 (-1,1)            : ${R.driftBL.frames.toFixed(1)} 帧 (${(R.driftBL.frames/60).toFixed(2)}s)`);
console.log(`随机权重 (5 seeds 均值)    : ${randMean.toFixed(1)} 帧 [${randMin.toFixed(0)} ~ ${randMax.toFixed(0)}]`);

const out = {
  version: 'malecns-v1.0-touhou-readout-full',
  trainedAt: new Date().toISOString(),
  bestFitness,
  generations: GENERATIONS, population: POP, elite: ELITE, seedsPerGen: SEEDS_PER_GEN,
  benchmark: {
    trained: R.trained, circuitSilenced: R.silenced, idle: R.idle,
    driftBottomRight: R.driftBR, driftBottomLeft: R.driftBL,
    randomPolicy: { frames: randMean, min: randMin, max: randMax, runs: randRuns.map(r => r.frames) }
  },
  history,
  weights: Array.from(bestWeights)
};
fs.writeFileSync(path.join(__dirname, 'checkpoint.full.json'), JSON.stringify(out, null, 2));
console.log('\n已保存: experiments/checkpoint.full.json');
