/**
 * train_wide_ab.mjs —— 「宽感知」A/B 对照训练（v9 实验）
 *
 * 用法: node train_wide_ab.mjs --mode=v1    （8 通道，原口径 + graph.json）
 *       node train_wide_ab.mjs --mode=wide  （32 通道，宽口径 + graph32ch.json）
 *
 * 两组除「感知口径 + 输入映射」外完全一致：同图拓扑（80 节点 / 1296 边逐位相同）、
 * 同超参、同训练种子、同 CEM 随机源。唯一变量就是通道数 8 → 32。
 *
 * 遗传预算按玩票标准收敛（不做显著性检验）：80 代 × 64 候选 × 12 种子 = 61,440 局，
 * 单组约 15~25 分钟。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)=?(.*)$/);
  if (m) args[m[1]] = m[2] === '' ? true : m[2];
}
const MODE = args.mode || 'v1';
if (MODE !== 'v1' && MODE !== 'wide') throw new Error(`未知 mode: ${MODE}`);
const OUT = args.out || path.join(__dirname, `checkpoint_ab_${MODE}.json`);
const GRAPH_FILE = MODE === 'wide' ? 'graph32ch.json' : 'graph.json';

const graphData = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome', GRAPH_FILE), 'utf8'));

const GENERATIONS = parseInt(args.gens || '80', 10);
const POP = 64;
const ELITE = 8;
const SEEDS_PER_GEN = 12;
const MAX_FRAMES = 1200;

const brain = new MaleCNSConnectome(graphData);

function evaluateCandidate(weights, seeds) {
  let totalScore = 0;
  const policy = new ReadoutPolicy(weights);
  for (let s = 0; s < seeds.length; s++) {
    const seed = seeds[s];
    brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed, sensoryMode: MODE });
    game.setSpellcard((seed + s) % 3);
    game.player.lives = 1; game.player.maxLives = 1;
    game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
    let frames = 0, wallPenalty = 0;
    while (!game.player.isDead && frames < MAX_FRAMES) {
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

// 独立测试集评估（不做大脑消融/漂移对照 —— 玩票标准，只保留随机基线）
const TEST_SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
function evalTest(weights) {
  const policy = new ReadoutPolicy(weights);
  let tf = 0;
  for (const seed of TEST_SEEDS) {
    brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed, sensoryMode: MODE });
    game.setSpellcard(seed % 3);
    game.player.lives = 1; game.player.maxLives = 1;
    game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
    let f = 0;
    while (!game.player.isDead && f < 1800) {
      game.update(policy.forward(brain.step(game.getBiologicalSensoryInput(), false)));
      f++;
    }
    tf += f;
  }
  return tf / TEST_SEEDS.length;
}

let mu = new Float64Array(PARAMETERS);
let sigma = new Float64Array(PARAMETERS).fill(0.8);
let bestFitness = -1;
let bestWeights = new Float64Array(PARAMETERS);
const history = [];
const t0 = Date.now();

console.log(`[${MODE}] 图=${GRAPH_FILE} 节点=${graphData.nodes.length} 边=${graphData.edges.length} 输入通道=${graphData.channels.length}`);
console.log(`[${MODE}] ${GENERATIONS} 代 x ${POP} 候选 / ${ELITE} 精英 / 每代 ${SEEDS_PER_GEN} 种子 = ${(GENERATIONS * POP * SEEDS_PER_GEN).toLocaleString()} 局`);

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
    candidates.push({ weights: w, score: evaluateCandidate(w, trainSeeds) });
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
    console.log(`[${MODE}] 代 ${String(g + 1).padStart(3)}/${GENERATIONS} [${((Date.now() - t0) / 1000).toFixed(0)}s] 精英均值 ${eliteAvg.toFixed(1)} | 历史最佳 ${bestFitness.toFixed(1)}`);
  }
}

const testTrained = evalTest(bestWeights);
const rndW = new Float64Array(PARAMETERS);
for (let i = 0; i < PARAMETERS; i++) rndW[i] = (Math.random() - 0.5) * 0.8;
const testRandom = evalTest(rndW);

const elapsed = (Date.now() - t0) / 1000;
console.log(`\n[${MODE}] 完成 ${elapsed.toFixed(0)}s (${(elapsed / 60).toFixed(1)} min)`);
console.log(`[${MODE}] 训练最佳适应度 ${bestFitness.toFixed(1)}`);
console.log(`[${MODE}] 独立测试集 (20 种子 80001-80020, 上限 1800 帧):`);
console.log(`[${MODE}]   训练后  : ${testTrained.toFixed(1)} 帧 (${(testTrained / 60).toFixed(2)}s)`);
console.log(`[${MODE}]   随机权重: ${testRandom.toFixed(1)} 帧`);

fs.writeFileSync(OUT, JSON.stringify({
  mode: MODE, graphFile: GRAPH_FILE,
  channels: graphData.channels.length,
  generations: GENERATIONS, population: POP, elite: ELITE, seedsPerGen: SEEDS_PER_GEN,
  bestFitness, testTrained, testRandom, elapsedSec: elapsed,
  history, weights: Array.from(bestWeights)
}, null, 2));
console.log(`[${MODE}] 已保存 ${path.relative(ROOT, OUT)}`);
