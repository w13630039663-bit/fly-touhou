/**
 * train_ab_seeded.mjs —— 感知口径三臂对照训练（A / B / C），共享同一 CEM 随机流
 *
 * 用法: node train_ab_seeded.mjs --mode=v1|wide|c8x1 [--gens=80] [--seed=20260916]
 *
 * 三臂定义（除「感知口径 + 输入映射」外完全一致：同图拓扑 80 节点 / 1296 边逐位相同、
 * 同超参、同训练种子、同 CEM 随机源）：
 *   v1   : 8 通道 × 4 细胞 = 32 驱动细胞   （A 基线，原口径）
 *   wide : 32 通道 × 1 细胞 = 32 驱动细胞  （B，信号维度 ↑）
 *   c8x1 : 8 通道 × 1 细胞 =  8 驱动细胞   （C，驱动广度 ↓）
 *
 * 为什么必须共用随机源：train_wide_ab.mjs 用未播种的 Math.random() 驱动 CEM，
 * 两臂之间除了口径还差了一整个随机流，无法区分「口径效应」和「初始化噪声」。
 * 本脚本用 mulberry32(CEM_SEED) 替代 Math.random()，三臂消耗的随机数序列逐位相同。
 *
 * 遗传预算按玩票标准收敛（不做显著性检验）：80 代 × 64 候选 × 12 种子 = 61,440 局。
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

const MODES = {
  v1: { graph: 'graph.json', sensory: 'v1', label: 'A 8通道x4细胞 = 32驱动细胞' },
  wide: { graph: 'graph32ch.json', sensory: 'wide', label: 'B 32通道x1细胞 = 32驱动细胞' },
  c8x1: { graph: 'graph8ch1.json', sensory: 'v1', label: 'C 8通道x1细胞 = 8驱动细胞' },
};
const MODE = args.mode || 'v1';
const CFG = MODES[MODE];
if (!CFG) throw new Error(`未知 mode: ${MODE}，可选 ${Object.keys(MODES).join(' / ')}`);

const OUT = args.out || path.join(__dirname, `checkpoint_ab3_${MODE}.json`);
const GENERATIONS = parseInt(args.gens || '80', 10);
const CEM_SEED = parseInt(args.seed || '20260916', 10);

const POP = 64;
const ELITE = 8;
const SEEDS_PER_GEN = 12;
const MAX_FRAMES = 1200;

// —— 可复现随机源：三臂共用同一颗种子 ⇒ 候选扰动序列逐位相同 ——
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(CEM_SEED);
function gauss() {
  const u1 = rng() || 1e-7;
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const graphData = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome', CFG.graph), 'utf8'));
const brain = new MaleCNSConnectome(graphData);

function rollout(weights, seed, cap) {
  const policy = new ReadoutPolicy(weights);
  brain.reset();
  const game = new DanmakuGame(null, { width: 460, height: 580, seed, sensoryMode: CFG.sensory });
  game.setSpellcard(seed % 3);
  game.player.lives = 1; game.player.maxLives = 1;
  game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
  let frames = 0, wallPenalty = 0;
  while (!game.player.isDead && frames < cap) {
    const obs = game.getBiologicalSensoryInput();
    const dn = brain.step(obs, false);
    game.update(policy.forward(dn));
    frames++;
    if (game.player.x < 32 || game.player.x > game.width - 32) wallPenalty += 0.25;
  }
  return { frames, graze: game.player.graze, score: Math.max(1, frames + game.player.graze * 4.0 - wallPenalty) };
}

function evaluateCandidate(weights, seeds) {
  let total = 0;
  for (const seed of seeds) total += rollout(weights, seed, MAX_FRAMES).score;
  return total / seeds.length;
}

const TEST_SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
function evalTestPerSeed(weights) {
  return TEST_SEEDS.map((seed) => rollout(weights, seed, 1800).frames);
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

console.log(`[${MODE}] ${CFG.label}`);
console.log(`[${MODE}] 图=${CFG.graph} 节点=${graphData.nodes.length} 边=${graphData.edges.length} 输入对=${graphData.inputs.length} 通道=${graphData.channels.length}`);
console.log(`[${MODE}] CEM 随机源种子=${CEM_SEED}（三臂共用）`);
console.log(`[${MODE}] ${GENERATIONS} 代 x ${POP} 候选 / ${ELITE} 精英 / 每代 ${SEEDS_PER_GEN} 种子 = ${(GENERATIONS * POP * SEEDS_PER_GEN).toLocaleString()} 局`);

let mu = new Float64Array(PARAMETERS);
let sigma = new Float64Array(PARAMETERS).fill(0.8);
let bestFitness = -1;
let bestWeights = new Float64Array(PARAMETERS);
const history = [];
const t0 = Date.now();

for (let g = 0; g < GENERATIONS; g++) {
  const trainSeeds = Array.from({ length: SEEDS_PER_GEN }, (_, i) => g * 137 + 11 + i * 12);
  const candidates = [];
  for (let c = 0; c < POP; c++) {
    const w = new Float64Array(PARAMETERS);
    if (c === 0 && g > 0) w.set(bestWeights);
    else for (let i = 0; i < PARAMETERS; i++) w[i] = mu[i] + sigma[i] * gauss();
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

const testPerSeed = evalTestPerSeed(bestWeights);
const rndW = new Float64Array(PARAMETERS);
for (let i = 0; i < PARAMETERS; i++) rndW[i] = (rng() - 0.5) * 0.8;
const rndPerSeed = evalTestPerSeed(rndW);

const elapsed = (Date.now() - t0) / 1000;
const testTrained = mean(testPerSeed);
const testRandom = mean(rndPerSeed);
console.log(`\n[${MODE}] 完成 ${elapsed.toFixed(0)}s (${(elapsed / 60).toFixed(1)} min)`);
console.log(`[${MODE}] 训练最佳适应度 ${bestFitness.toFixed(1)}`);
console.log(`[${MODE}] 独立测试集 (20 种子 80001-80020, 上限 1800 帧):`);
console.log(`[${MODE}]   训练后  : ${testTrained.toFixed(1)} 帧 | 触顶(1800) ${testPerSeed.filter(v => v >= 1800).length}/20`);
console.log(`[${MODE}]   随机权重: ${testRandom.toFixed(1)} 帧`);

fs.writeFileSync(OUT, JSON.stringify({
  mode: MODE, label: CFG.label, graphFile: CFG.graph, sensoryMode: CFG.sensory,
  inputPairs: graphData.inputs.length, channels: graphData.channels.length,
  generations: GENERATIONS, population: POP, elite: ELITE, seedsPerGen: SEEDS_PER_GEN,
  cemSeed: CEM_SEED,
  bestFitness, testTrained, testRandom, testPerSeed, rndPerSeed, elapsedSec: elapsed,
  history, weights: Array.from(bestWeights)
}, null, 2));
console.log(`[${MODE}] 已保存 ${path.relative(ROOT, OUT)}`);
