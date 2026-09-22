// P4 工期估算：实测可塑性带来的运行成本，替代拍脑袋
// 1) 基线单局耗时
// 2) 每帧加一次 O(E) Hebbian 权重更新
// 3) 每帧加一次「更新 + 归一化守恒」
// 4) CEM 在 320 / 1616 / 低秩 维度下的每代参数开销
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8'));

const brain = new MaleCNSConnectome(graph);
const E = brain.edges.length, N = graph.nodes.length;
console.log(`图: ${N} 节点 / ${E} 边 | 读出参数 ${PARAMETERS} | 若 W 全可训 → ${E + PARAMETERS} 维`);

// —— 可塑性算子：与 connectome 前向边循环同构，逐边一遍 ——
const W = new Float64Array(brain.eWeight);
const pre = brain.ePre, post = brain.ePost, act = brain.activity;
function hebbianStep(eta, decay) {
  for (let e = 0; e < E; e++) W[e] += eta * (act[pre[e]] * act[post[e]] - decay * W[e]);
}
const totals = new Float64Array(N);
function renormalize() {
  totals.fill(0);
  for (let e = 0; e < E; e++) totals[post[e]] += Math.abs(W[e]);
  for (let e = 0; e < E; e++) if (totals[post[e]]) W[e] /= totals[post[e]];
}

const policy = new ReadoutPolicy(new Float64Array(PARAMETERS).fill(0.12));
const SEEDS = Array.from({ length: 12 }, (_, i) => 70001 + i);

function bench(label, { plasticity = 'none', frames = 1200 } = {}) {
  for (let s = 0; s < 12; s++) { // 预热
    const g = new DanmakuGame(null, { width: 460, height: 580, seed: 70000 });
    g.setSpellcard(0); g.player.lives = 1; g.player.autoRespawn = false;
    brain.reset(); g.update(policy.forward(brain.step(g.getBiologicalSensoryInput(), false)));
  }
  const t0 = process.hrtime.bigint();
  let f = 0;
  for (const seed of SEEDS) {
    brain.reset();
    const g = new DanmakuGame(null, { width: 460, height: 580, seed });
    g.setSpellcard(seed % 3);
    g.player.lives = 1; g.player.maxLives = 1;
    g.player.autoRespawn = false; g.player.invulnerableTimer = 0;
    let n = 0;
    while (!g.player.isDead && n < frames) {
      g.update(policy.forward(brain.step(g.getBiologicalSensoryInput(), false)));
      if (plasticity === 'hebb') hebbianStep(0.002, 0.001);
      else if (plasticity === 'hebb+norm') { hebbianStep(0.002, 0.001); renormalize(); }
      n++; f++;
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const perEp = ms / SEEDS.length;
  console.log(`  ${label.padEnd(30)} ${ms.toFixed(0).padStart(6)} ms / ${SEEDS.length} 局  单局 ${perEp.toFixed(2)} ms  ${(f / ms * 1000 / 1000).toFixed(0)} 帧/ms`);
  return perEp;
}

console.log('\n[1] 单局耗时（12 局 × 1200 帧上限，单线程）');
const base = bench('基线（W 冻结）', {});
const h1 = bench('+ 每帧 Hebbian (O(E))', { plasticity: 'hebb' });
const h2 = bench('+ 每帧 Hebbian + 归一化守恒', { plasticity: 'hebb+norm' });

console.log(`\n  可塑性开销：纯更新 +${((h1 / base - 1) * 100).toFixed(0)}% | 更新+守恒 +${((h2 / base - 1) * 100).toFixed(0)}%`);

// —— CEM 参数空间开销（不含 rollout —— rollout 成本与维度无关）——
function cemOverhead(dim, pop, gens, label) {
  const pre = process.hrtime.bigint();
  const mu = new Float64Array(dim), sigma = new Float64Array(dim).fill(0.8);
  let acc = 0;
  for (let g = 0; g < gens; g++) {
    const cands = [];
    for (let c = 0; c < pop; c++) {
      const w = new Float64Array(dim);
      for (let i = 0; i < dim; i++) {
        const u1 = Math.random() || 1e-7, u2 = Math.random();
        w[i] = mu[i] + sigma[i] * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      }
      cands.push(w);
    }
    cands.sort((a, b) => b[0] - a[0]);
    const newMu = new Float64Array(dim);
    for (let e = 0; e < 8; e++) { const w = cands[e]; for (let i = 0; i < dim; i++) newMu[i] += w[i] / 8; }
    const newSig = new Float64Array(dim);
    for (let e = 0; e < 8; e++) { const w = cands[e]; for (let i = 0; i < dim; i++) { const d = w[i] - newMu[i]; newSig[i] += d * d / 8; } }
    for (let i = 0; i < dim; i++) { sigma[i] = Math.max(0.06, Math.sqrt(newSig[i])); mu[i] = 0.3 * mu[i] + 0.7 * newMu[i]; acc += mu[i]; }
  }
  const ms = Number(process.hrtime.bigint() - pre) / 1e6;
  console.log(`  ${label.padEnd(34)} dim=${String(dim).padStart(4)} pop=${String(pop).padStart(3)} gens=${String(gens).padStart(3)}  → ${ms.toFixed(0)} ms  (${(ms / (gens * pop)).toFixed(3)} ms/候选)`);
  return ms;
}

console.log('\n[2] CEM 参数空间开销（rollout 之外的部分）');
cemOverhead(PARAMETERS, 64, 80, '现状：读出层 320 维');
cemOverhead(E + PARAMETERS, 64, 80, 'W 全可训，同 pop/gens');
cemOverhead(E + PARAMETERS, 256, 300, 'W 全可训，加预算求收敛');
cemOverhead(E + PARAMETERS, 1024, 500, 'W 全可训，pop≈dim 的常见配比');
cemOverhead(640, 64, 80, '低秩 W（rank 4 → 640 维）');

// —— 训练总预算 ——
console.log('\n[3] 训练总预算推算');
const budget = (pop, gens, seeds, perEp, label) => {
  const eps = pop * gens * seeds;
  const h = eps * perEp / 1000 / 3600;
  console.log(`  ${label.padEnd(34)} ${eps.toLocaleString().padStart(10)} 局 → ${h.toFixed(2)} h`);
  return h;
};
budget(64, 80, 12, base, '现状（320 维读出，W 冻结）');
budget(64, 80, 12, h1, 'P4-Hebbian（每代同规模）');
budget(64, 80, 12, h2, 'P4-Hebbian + 守恒');
budget(256, 300, 12, h1, 'P4-EW 高预算 ×4pop ×3.75gens');
budget(1024, 500, 12, h1, 'P4-EW 极高预算');
