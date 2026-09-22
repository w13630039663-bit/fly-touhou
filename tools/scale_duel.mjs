/**
 * tools/scale_duel.mjs — PLAN_520 A.2/C.3 四方配对对决表
 *
 * 输入: 四个 checkpoint 的 benchmark.trained.perSeedFrames (同一评估栈: 测试种子 80001-80020,
 * 1800f cap, 各自训练后的固定权重 ⇒ 完全确定可比)。
 *   v1     = public/data/checkpoint.json         (80 细胞历史冠军)
 *   v600   = public/data/checkpoint600.json      (600 细胞历史冠军, 稀释受害者)
 *   v600a  = public/data/checkpoint600a.json     (A.1 加性两段归一化)
 *   v600b  = public/data/checkpoint600b.json     (C.1 v1 读出恢复)
 * 输出: 每对 (X vs Y) 的 mean 差 + 双侧配对 bootstrap p (20000 重采样) + X 胜场数。
 * C.1b 语义注记会随 b 图结果打印: b 赢 ≠ 新细胞有用, 只说明「别让新细胞碰读出层」。
 *
 * 用法: node tools/scale_duel.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 与 train.js.pairedTwoSidedP 完全同构 (同种子 987654321, 同重采样逻辑) */
function pairedTwoSidedP(bioFrames, ctrlFrames, nBoot = 20000, rngSeed = 987654321) {
  const rng = mulberry32(rngSeed);
  const n = Math.min(bioFrames.length, ctrlFrames.length);
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += bioFrames[i]; my += ctrlFrames[i]; }
  const d = (mx - my) / n;
  if (d === 0) return { diff: 0, p: 1 };
  let flips = 0;
  for (let b = 0; b < nBoot; b++) {
    let a = 0, c = 0;
    for (let i = 0; i < n; i++) { const j = Math.floor(rng() * n); a += bioFrames[j]; c += ctrlFrames[j]; }
    if (Math.sign((a - c) / n) !== Math.sign(d)) flips++;
  }
  return { diff: d, p: Math.max(2 / nBoot, (flips / nBoot) * 2) };
}

const SPEC = [
  ['v1', 'public/data/checkpoint.json'],
  ['v600', 'public/data/checkpoint600.json'],
  ['v600a', 'public/data/checkpoint600a.json'],
  ['v600b', 'public/data/checkpoint600b.json'],
  ['v600ag', 'public/data/checkpoint600ag.json'],
  ['v1x', 'public/data/checkpointV1x.json'],
  ['v600ax', 'public/data/checkpoint600ax.json']
];
const data = new Map();
for (const [name, p] of SPEC) {
  const full = path.join(root, p);
  if (!fs.existsSync(full)) { console.log(`跳过 ${name}: ${p} 不存在`); continue; }
  const ck = readJson(p);
  const t = ck.benchmark.trained;
  if (!Array.isArray(t.perSeedFrames) || t.perSeedFrames.length !== 20) {
    console.log(`跳过 ${name}: benchmark.trained 无 20 项 perSeedFrames`);
    continue;
  }
  data.set(name, {
    frames: t.frames, per: t.perSeedFrames, fitness: ck.bestFitness,
    graph: ck.topology?.graph ?? '(旧 schema 无 topology 字段)', cemSeed: ck.cemSeed ?? '(播种前历史运行)',
    silenced: ck.benchmark.circuitSilenced?.frames,
    gains: ck.gainParams ? `exc=${ck.gainParams.raw[0].toFixed(3)} inh=${ck.gainParams.raw[1].toFixed(3)}` : null
  });
}
const names = [...data.keys()];
console.log('======================================================');
for (const n of names) {
  const d = data.get(n);
  console.log(`${n.padEnd(6)}: test ${d.frames.toFixed(1)}f | plateau ${d.fitness.toFixed(1)} | silenced ${d.silenced?.toFixed(1)}f | ${d.graph} | cemSeed ${d.cemSeed}${d.gains ? ' | ' + d.gains : ''}`);
}
console.log('------------------------------------------------------');
console.log('逐对 20 种子配对双侧 bootstrap (同 train.js 口径, 20000 重采样):');
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const A = data.get(names[i]), B = data.get(names[j]);
    const r = pairedTwoSidedP(A.per, B.per);
    const wins = A.per.filter((x, k) => x > B.per[k]).length;
    // 互补符号检验 (双侧, 精确二项): 与 bootstrap 均值差口径独立
    const k = Math.min(wins, 20 - wins);
    let tail = 0;
    for (let m = 0; m <= k; m++) {
      let comb = 1;
      for (let t = 0; t < m; t++) comb = comb * (20 - t) / (t + 1);
      tail += comb / 2 ** 20;
    }
    const signP = Math.min(1, 2 * tail);
    const sig = r.p < 0.05 ? '显著' : '不显著';
    console.log(`  ${names[i]} vs ${names[j].padEnd(5)}: Δ=${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(1)}f  p=${r.p.toFixed(4)} (${sig})  ${names[i]}胜 ${wins}/20  符号检验 p=${signP.toFixed(4)}`);
  }
}
console.log('------------------------------------------------------');
console.log('判据 (PLAN_520 A.2): v600a/v600b 相对 v600 的 Δ>0 且 p<0.05 ⇒ 假设被证实；');
console.log('判据 (D.1 终审门): 600ax vs v1x Δ>0 且 p<0.05 且方向一致 ⇒ 方可宣称「规模带来能力」; 否则定稿「本读出契约下规模打平/收益为负」；');
console.log(`plateau 值仅参考不作判据；v600a 的归一化修复若有效还应伴随 Δ₀ 口径变化 (重跑 scale_ablation_newcells --graph a)。`);
if (data.has('v600b')) {
  console.log(`C.1b 语义注记: 600b 的 DN 入边集与逐边权重位等价 v1 (build_variants [S3] 已证)。`);
  console.log(` ⇒ 「v600b ≥ v600 甚至逼近 v1」的正确结论是【不要让新细胞直连读出层】，`);
  console.log(`   而非「520 新细胞有用于读出」。新细胞对 b 图贡献需另用消融 Δ₀ 在 b 图上量。`);
}
