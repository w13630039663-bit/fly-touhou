/**
 * _p41_cross.mjs —— P4-1 交叉环境检验：权重来自 X 臂 × 运行环境 Y
 *
 * 回答两个问题：
 *   Q1 h5 训出的读出权重，放进**冻结环境**还更好吗？
 *      → 更好 ⇒ 它找到了真更优的策略；不更好 ⇒ 它只是学会了配合一个会动的 W。
 *   Q2 none 训出的权重，放进 h5 环境会变差吗？
 *      → 变差 ⇒ 冻结环境下的最优解无法利用可塑性（说明 h5 的收益来自协同适应）
 *
 * 用法: node experiments/_p41_cross.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const graphData = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8'));

const SOURCES = {
  none: 'checkpoint_p41_none.json',
  h5: 'checkpoint_p41_h5.json',
  h4: 'checkpoint_p41_h4.json',
};
const ENVS = {
  frozen: { eta: 0, decay: 0, renorm: true, label: 'W 冻结' },
  h5: { eta: 1e-5, decay: 0.01, renorm: true, label: 'η=1e-5' },
  h4: { eta: 1e-4, decay: 0.01, renorm: true, label: 'η=1e-4' },
};
const SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
const CAP = 1800;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

const W = {};
for (const [k, f] of Object.entries(SOURCES)) {
  W[k] = new Float64Array(JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')).weights);
}

const brain = new MaleCNSConnectome(graphData);
function roll(weights, seed, env) {
  const policy = new ReadoutPolicy(weights);
  brain.setPlasticity(env);
  brain.reset();
  brain.restoreBioWeights();
  const g = new DanmakuGame(null, { width: 460, height: 580, seed, sensoryMode: 'v1' });
  g.setSpellcard(seed % 3);
  g.player.lives = 1; g.player.maxLives = 1;
  g.player.autoRespawn = false; g.player.invulnerableTimer = 0;
  let frames = 0;
  while (!g.player.isDead && frames < CAP) {
    g.update(policy.forward(brain.step(g.getBiologicalSensoryInput(), false)));
    frames++;
  }
  return frames;
}

const M = {};
console.log('='.repeat(84));
console.log('P4-1 交叉环境矩阵：20 测试种子（上限 1800 帧），行=读出权重来源，列=运行环境');
console.log('='.repeat(84));
console.log(`\n${'权重来源 \\ 环境'.padEnd(18)} | ${Object.values(ENVS).map((e) => e.label.padStart(12)).join(' | ')}`);
for (const [sk, w] of Object.entries(W)) {
  const row = [];
  for (const [ek, env] of Object.entries(ENVS)) {
    const v = SEEDS.map((s) => roll(w, s, env));
    M[`${sk}|${ek}`] = v;
    row.push(`${mean(v).toFixed(1)}(${v.filter((x) => x >= CAP).length}/20)`.padStart(12));
  }
  console.log(`${sk.padEnd(18)} | ${row.join(' | ')}`);
}

console.log('\n对角线（同臂自洽）:');
for (const k of ['none', 'h5', 'h4']) {
  const v = M[`${k}|${k === 'none' ? 'frozen' : k}`];
  console.log(`  ${k.padEnd(6)} 同环境 ${mean(v).toFixed(1)} 帧 | 触顶 ${v.filter((x) => x >= CAP).length}/20`);
}

console.log('\n[Q1] h5 权重放进冻结环境 vs none 自己的 1369.5');
const h5inFrozen = mean(M['h5|frozen']);
const noneFrozen = mean(M['none|frozen']);
console.log(`  h5 权重 → 冻结环境 : ${h5inFrozen.toFixed(1)} 帧  (Δ vs none 自身 ${(h5inFrozen - noneFrozen).toFixed(1)})`);
console.log(`  ${h5inFrozen > noneFrozen + 1 ? '⇒ h5 的读出策略本身更优（不只是配合可塑性）' : '⇒ h5 的策略离了可塑性并不更优，收益来自协同适应'}`);

console.log('\n[Q2] none 权重放进 h5 环境 vs none 自己的 1369.5');
const noneInH5 = mean(M['none|h5']);
console.log(`  none 权重 → h5 环境 : ${noneInH5.toFixed(1)} 帧  (Δ ${(noneInH5 - noneFrozen).toFixed(1)})`);
console.log(`  ${noneInH5 < noneFrozen - 1 ? '⇒ 冻结环境下的最优解读出层无法直接利用可塑性（需要重新协同训练）' : '⇒ 冻结环境的解也能吃到可塑性红利'}`);

console.log('\n逐种子（h5 权重在冻结环境 vs none 权重在冻结环境）');
console.log(`${'种子'.padEnd(8)} | ${'card'.padStart(4)} | ${'none@frozen'.padStart(11)} | ${'h5@frozen'.padStart(9)} | 差`);
let sum = 0, win = 0, lose = 0, tie = 0;
for (let i = 0; i < SEEDS.length; i++) {
  const a = M['none|frozen'][i], b = M['h5|frozen'][i];
  sum += b - a; b > a ? win++ : b < a ? lose++ : tie++;
  console.log(`${String(SEEDS[i]).padEnd(8)} | ${String(SEEDS[i] % 3).padStart(4)} | ${String(a).padStart(11)} | ${String(b).padStart(9)} | ${b - a > 0 ? '+' : ''}${b - a}`);
}
console.log(`合计 均值差 ${(sum / SEEDS.length).toFixed(1)} | 胜 ${win} / 负 ${lose} / 平 ${tie}`);
