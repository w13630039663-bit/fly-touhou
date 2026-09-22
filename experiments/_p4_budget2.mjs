// P4 可行性实测 v2：
// 1) 固定帧数下的干净归因（脑动力学 / 游戏物理 / 可塑性算子）
// 2) W 的量级分布 → CEM 的 sigma 该取多少
// 3) W 扰动敏感度 → P4 的搜索地形是「平缓」还是「针尖」
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8'));
const ckpt = JSON.parse(fs.readFileSync(path.join(__dirname, 'checkpoint_ab3_v1.json'), 'utf8'));

const brain = new MaleCNSConnectome(graph);
const E = brain.edges.length, N = graph.nodes.length;
const pre = brain.ePre, post = brain.ePost, act = brain.activity;
const W = new Float64Array(brain.eWeight);
const totals = new Float64Array(N);

function hebbianStep(eta, decay) {
  for (let e = 0; e < E; e++) W[e] += eta * (act[pre[e]] * act[post[e]] - decay * W[e]);
}
function renormalize() {
  totals.fill(0);
  for (let e = 0; e < E; e++) totals[post[e]] += Math.abs(W[e]);
  for (let e = 0; e < E; e++) if (totals[post[e]]) W[e] /= totals[post[e]];
}

// ---------- [1] 固定帧数微基准 ----------
const NFRAMES = 60000;
const obs = new Float64Array(8).fill(0.4);
const policy = new ReadoutPolicy(new Float64Array(PARAMETERS).fill(0.12));

function timeIt(label, fn, n = NFRAMES) {
  for (let i = 0; i < 5000; i++) fn();           // 预热
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn();
  const us = Number(process.hrtime.bigint() - t0) / 1000 / n;
  console.log(`  ${label.padEnd(30)} ${us.toFixed(3).padStart(7)} us/帧`);
  return us;
}

console.log(`[1] 固定 ${NFRAMES.toLocaleString()} 帧微基准（单线程）`);
const tBrain = timeIt('脑动力学 step()', () => brain.step(obs, false));
const tHebb = timeIt('+ Hebbian (O(E))', () => { brain.step(obs, false); hebbianStep(0.002, 0.001); });
const tHebbN = timeIt('+ Hebbian + 归一化守恒', () => { brain.step(obs, false); hebbianStep(0.002, 0.001); renormalize(); });
const tRead = timeIt('读出层 forward()', () => policy.forward([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]));

const g = new DanmakuGame(null, { width: 460, height: 580, seed: 12345 });
g.setSpellcard(0); g.player.lives = 99; g.player.maxLives = 99; g.player.autoRespawn = false;
g.player.invulnerableTimer = 1e9;
const inp = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
const tGame = timeIt('游戏物理 update()', () => { g.update({ moveX: 0.2, moveY: -0.3 }); });

const ep = (t) => t * 1200 / 1000;
console.log(`\n  单局 1200 帧推算：脑 ${ep(tBrain).toFixed(2)} ms | 游戏 ${ep(tGame).toFixed(2)} ms | 读出 ${ep(tRead).toFixed(2)} ms`);
console.log(`  基线合计 ${ep(tBrain + tGame + tRead).toFixed(2)} ms（实测 12.26 ms，差值=感知层+对象分配）`);
const pctHebb = (((tHebb / tBrain) - 1) * 100).toFixed(0);
const pctHebbN = (((tHebbN / tBrain) - 1) * 100).toFixed(0);
console.log(`  + Hebbian 每帧      → ${ep(tHebb + tGame + tRead).toFixed(2)} ms  (脑开销 +${pctHebb}%)`);
console.log(`  + Hebbian+守恒      → ${ep(tHebbN + tGame + tRead).toFixed(2)} ms  (脑开销 +${pctHebbN}%)`);

// ---------- [2] W 量级 ----------
const absW = Array.from(brain.eWeight, Math.abs);
const meanAbs = absW.reduce((s, v) => s + v, 0) / absW.length;
const sorted = [...absW].sort((a, b) => a - b);
console.log(`\n[2] W 量级分布（共 ${E} 条边，权重口径 = contacts / totals[post]，每神经元入权和 ≡ 1）`);
console.log(`  均值 ${meanAbs.toFixed(5)} | 中位 ${sorted[E >> 1].toFixed(5)} | 最大 ${sorted[E - 1].toFixed(5)} | 最小 ${sorted[0].toFixed(6)}`);
console.log(`  → 现 CEM 初始 sigma = 0.8，是 W 均值量级的 ${(0.8 / meanAbs).toFixed(0)} 倍。`);
console.log(`     若对 W 用同一 sigma，第一次采样就会把权重全冲掉 → sigma 必须按 W 量级重设（约 ${(meanAbs).toFixed(3)}）。`);

// ---------- [3] W 扰动敏感度 ----------
const SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
const wBase = new Float64Array(brain.eWeight);
function evalW() {
  const pol = new ReadoutPolicy(new Float64Array(ckpt.weights));
  let tf = 0;
  for (const seed of SEEDS) {
    brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed, sensoryMode: 'v1' });
    game.setSpellcard(seed % 3);
    game.player.lives = 1; game.player.maxLives = 1;
    game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
    let f = 0;
    while (!game.player.isDead && f < 1800) { game.update(pol.forward(brain.step(game.getBiologicalSensoryInput(), false))); f++; }
    tf += f;
  }
  return tf / SEEDS.length;
}
let sw = 20260916;
const rnd = () => { sw = (sw * 1664525 + 1013904223) >>> 0; return sw / 4294967296; };
const rndn = () => Math.sqrt(-2 * Math.log(rnd() || 1e-7)) * Math.cos(2 * Math.PI * rnd());

console.log(`\n[3] W 扰动敏感度（固定用 A 臂训练好的读出权重，只扰动 W，测 20 种子）`);
console.log(`  扰动强度 ε 是「相对 W 均值的倍数」：ε=1 → 权重被随机量级完全淹没`);
const baseScore = evalW();
console.log(`  ε=0       参考      ${baseScore.toFixed(1)} 帧`);
for (const eps of [0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0]) {
  const sigma = eps * meanAbs;
  const saved = Float64Array.from(wBase);
  brain.eWeight = Float64Array.from(saved, (v) => v + sigma * rndn());
  const s = evalW();
  brain.eWeight = saved;
  console.log(`  ε=${String(eps).padEnd(5)} sigma=${sigma.toFixed(4)}   ${s.toFixed(1)} 帧   (${((s / baseScore - 1) * 100 >= 0 ? '+' : '')}${((s / baseScore - 1) * 100).toFixed(1)}%)`);
}
