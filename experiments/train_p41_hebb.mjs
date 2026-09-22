/**
 * train_p41_hebb.mjs —— P4-1 Hebbian 可塑性的「读出层协同训练」三臂对照
 *
 * 为什么需要这一轮：_p4_1_probe.mjs 用的是「对着冻结 W 训出来的」A 臂读出权重，
 * 它从没被要求应付一个会动的 W。所以探针里那个 -2.2% 不能直接当成 P4-1 的结论。
 * 本脚本让读出层在「W 正在可塑」的环境里从头训一遍，看协同适应能不能把它救回来。
 *
 * ⚠️ 本脚本调用的是引擎里的正式 API（connectome.setPlasticity / restoreBioWeights），
 *    不是另写一份 Hebbian 拷贝 —— 保证验证的就是真正发布的代码路径。
 *
 * 用法: node train_p41_hebb.mjs --hebb=none|h5|h4 [--gens=80] [--seed=20260916]
 *   none : W 冻结（应与 checkpoint_ab3_v1.json 逐位一致 —— 回归门）
 *   h5   : η=1e-5, 衰减 0.01, renorm 守恒（探针里的「安全档」）
 *   h4   : η=1e-4, 衰减 0.01, renorm 守恒（「温和档」）
 *
 * 其余全部与 train_ab_seeded.mjs 一致：同图、同超参、同 CEM 随机源、同 80 代预算。
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

const HEBB = {
  none: { eta: 0, decay: 0, renorm: true, label: 'W 冻结（对照）' },
  h5: { eta: 1e-5, decay: 0.01, renorm: true, label: 'Hebbian η=1e-5 + 守恒' },
  h4: { eta: 1e-4, decay: 0.01, renorm: true, label: 'Hebbian η=1e-4 + 守恒' },
};
const MODE = args.hebb || 'h5';
const CFG = HEBB[MODE];
if (!CFG) throw new Error(`未知 --hebb=${MODE}，可选 ${Object.keys(HEBB).join(' / ')}`);

const OUT = args.out || path.join(__dirname, `checkpoint_p41_${MODE}.json`);
const GENERATIONS = parseInt(args.gens || '80', 10);
const CEM_SEED = parseInt(args.seed || '20260916', 10);
const POP = 64, ELITE = 8, SEEDS_PER_GEN = 12, MAX_FRAMES = 1200;

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
  const u1 = rng() || 1e-7, u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const graphData = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8'));
const brain = new MaleCNSConnectome(graphData);
brain.setPlasticity(CFG);

let peakDrift = 0;   // 训练过程中观测到的最大相对权重漂移

function rollout(weights, seed, cap) {
  const policy = new ReadoutPolicy(weights);
  brain.reset();
  brain.restoreBioWeights();       // 局内可塑：每局 W 从生物权重重新长起
  const game = new DanmakuGame(null, { width: 460, height: 580, seed, sensoryMode: 'v1' });
  game.setSpellcard(seed % 3);
  game.player.lives = 1; game.player.maxLives = 1;
  game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
  let frames = 0, wallPenalty = 0;
  while (!game.player.isDead && frames < cap) {
    const obs = game.getBiologicalSensoryInput();
    const dn = brain.step(obs, false);        // ← Hebbian 在 step() 内部就地更新 W
    game.update(policy.forward(dn));
    frames++;
    if (game.player.x < 32 || game.player.x > game.width - 32) wallPenalty += 0.25;
  }
  if (CFG.eta > 0) {
    const d = brain.measureDrift();
    if (d > peakDrift) peakDrift = d;
  }
  return { frames, graze: game.player.graze, score: Math.max(1, frames + game.player.graze * 4.0 - wallPenalty) };
}
function evaluateCandidate(weights, seeds) {
  let t = 0;
  for (const s of seeds) t += rollout(weights, s, MAX_FRAMES).score;
  return t / seeds.length;
}

const TEST_SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
const evalTestPerSeed = (w) => TEST_SEEDS.map((s) => rollout(w, s, 1800).frames);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

console.log(`[p41/${MODE}] ${CFG.label} | 80 节点/${graphData.edges.length} 边 | CEM 种子 ${CEM_SEED}`);
console.log(`[p41/${MODE}] ${GENERATIONS} 代 x ${POP} x ${SEEDS_PER_GEN} 种子 = ${(GENERATIONS * POP * SEEDS_PER_GEN).toLocaleString()} 局`);

let mu = new Float64Array(PARAMETERS);
let sigma = new Float64Array(PARAMETERS).fill(0.8);
let bestFitness = -1;
const bestWeights = new Float64Array(PARAMETERS);
const history = [];
const t0 = Date.now();

for (let g = 0; g < GENERATIONS; g++) {
  const trainSeeds = Array.from({ length: SEEDS_PER_GEN }, (_, i) => g * 137 + 11 + i * 12);
  const cands = [];
  for (let c = 0; c < POP; c++) {
    const w = new Float64Array(PARAMETERS);
    if (c === 0 && g > 0) w.set(bestWeights);
    else for (let i = 0; i < PARAMETERS; i++) w[i] = mu[i] + sigma[i] * gauss();
    cands.push({ weights: w, score: evaluateCandidate(w, trainSeeds) });
  }
  cands.sort((a, b) => b.score - a.score);
  const elites = cands.slice(0, ELITE);
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
  history.push({ gen: g + 1, eliteAvg, best: bestFitness, elite0: elites[0].score, peakDrift });
  if ((g + 1) % 10 === 0 || g === 0) {
    console.log(`[p41/${MODE}] 代 ${String(g + 1).padStart(3)}/${GENERATIONS} [${((Date.now() - t0) / 1000).toFixed(0)}s] 精英均值 ${eliteAvg.toFixed(1)} | 历史最佳 ${bestFitness.toFixed(1)}${CFG.eta > 0 ? ` | 峰值漂移 ${peakDrift.toFixed(4)}` : ''}`);
  }
}

const testPerSeed = evalTestPerSeed(bestWeights);
const rndW = new Float64Array(PARAMETERS);
for (let i = 0; i < PARAMETERS; i++) rndW[i] = (rng() - 0.5) * 0.8;
const rndPerSeed = evalTestPerSeed(rndW);
const elapsed = (Date.now() - t0) / 1000;
console.log(`\n[p41/${MODE}] 完成 ${(elapsed / 60).toFixed(1)} min | 训练最佳 ${bestFitness.toFixed(1)}`);
console.log(`[p41/${MODE}] 测试集(20 种子, 上限 1800): 训练后 ${mean(testPerSeed).toFixed(1)} 帧 | 触顶 ${testPerSeed.filter((v) => v >= 1800).length}/20 | 随机 ${mean(rndPerSeed).toFixed(1)} 帧`);

fs.writeFileSync(OUT, JSON.stringify({
  hebb: MODE, label: CFG.label, eta: CFG.eta, decay: CFG.decay, renorm: CFG.renorm,
  generations: GENERATIONS, cemSeed: CEM_SEED, bestFitness, peakDrift,
  testTrained: mean(testPerSeed), testRandom: mean(rndPerSeed),
  testPerSeed, rndPerSeed, elapsedSec: elapsed, history,
  weights: Array.from(bestWeights),
}, null, 2));
console.log(`[p41/${MODE}] 已保存 ${path.relative(ROOT, OUT)}`);
