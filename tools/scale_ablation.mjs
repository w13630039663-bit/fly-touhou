/**
 * tools/scale_ablation.mjs — 80 vs 600 规模消融统一重评（同一当前游戏构建）
 *
 * 背景: checkpoint.json (v1-80) 自带的 benchmark 记录产出于旧游戏构建（冥符波间停顿/60Hz
 * 步进修正之前），idle/silenced 基线不可与 checkpoint600.json 直接对比。本工具用当前
 * src/game/danmaku.js 对双方保存权重统一重评 20 个独立测试种子 (80001-80020)，
 * 产出规模消融表并把重评结果写回两个 checkpoint 的 benchmark 字段（原始记录保留在
 * benchmark.originalRun 下，trainedAt 不变 —— 数据可追溯）。
 *
 * 运行: node tools/scale_ablation.mjs [--write]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MaleCNSConnectome, createMatchedControlGraph } from '../src/brain/connectome.js';
import { evaluateOnTestSeeds } from '../train.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
const WRITE = process.argv.includes('--write');

function loadJson(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); }

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function twoSidedPairedBootstrap(x, y, B = 40000, seed = 246813579) {
  const n = Math.min(x.length, y.length);
  const rng = mulberry32(seed);
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  const d = (mx - my) / n;
  if (d === 0) return { diff: 0, p: 1 };
  let hits = 0;
  for (let b = 0; b < B; b++) {
    let a = 0, c = 0;
    for (let i = 0; i < n; i++) { const j = Math.floor(rng() * n); a += x[j]; c += y[j]; }
    const dd = (a - c) / n;
    if (Math.sign(dd) !== Math.sign(d)) hits++;
  }
  return { diff: d, p: Math.max(2 / B, (hits / B) * 2) };
}

function reevalDataset(name, graphPath, ckPath) {
  const graph = loadJson(graphPath);
  const ck = loadJson(ckPath);
  const brain = new MaleCNSConnectome(graph);
  const out = { name, neurons: graph.nodes.length, edges: graph.edges.length };

  out.trained = evaluateOnTestSeeds(TEST_SEEDS, brain, new Float64Array(ck.weights), 'normal');
  out.silenced = evaluateOnTestSeeds(TEST_SEEDS, brain, new Float64Array(ck.weights), 'silenced');
  out.idle = evaluateOnTestSeeds(TEST_SEEDS, null, null, 'idle');

  // matched controls: 从保存的 controlWeights 重建（旧 v1 单组 flat 数组 / 新多组嵌套）
  const ctrlW = Array.isArray(ck.controlWeights?.[0]) ? ck.controlWeights : (ck.controlWeights ? [ck.controlWeights] : []);
  const ctrlSeeds = Array.isArray(ck.controlFitness) ? ck.controlFitness.map(c => c.seed) : [42];
  out.controls = ctrlW.map((wArr, i) => {
    const cg = createMatchedControlGraph(graph, ctrlSeeds[i] ?? 42 + i);
    const cb = new MaleCNSConnectome(cg);
    return { seed: ctrlSeeds[i] ?? 42 + i, ...evaluateOnTestSeeds(TEST_SEEDS, cb, new Float64Array(wArr), 'normal') };
  });

  out.vsControls = out.controls.map(c => ({
    seed: c.seed, ...twoSidedPairedBootstrap(out.trained.perSeedFrames, c.perSeedFrames)
  }));
  return out;
}

const v1 = reevalDataset('MaleCNS-80 v1', 'public/data/connectome/graph.json', 'public/data/checkpoint.json');
const v2 = reevalDataset('MaleCNS-600 v2', 'public/data/connectome/graph600.json', 'public/data/checkpoint600.json');

function row(label, r) {
  return `${label.padEnd(26)} ${String(Math.round(r.frames)).padStart(6)} f  ${(r.seconds).toFixed(2).padStart(6)} s  graze ${(r.graze ?? 0).toFixed(1)}`;
}
function printDataset(r) {
  console.log(`\n══ ${r.name} (${r.neurons} 神经元 / ${r.edges} 边) — 当前游戏构建重评, 20 独立种子 ══`);
  console.log(row('trained', r.trained));
  r.controls.forEach(c => console.log(row(`matched ctrl@${c.seed}`, c)));
  console.log(row('circuit silenced', r.silenced));
  console.log(row('idle', r.idle));
  console.log('paired bootstrap (trained vs ctrl):', r.vsControls.map(v => `@${v.seed} Δ=${v.diff.toFixed(0)}f p=${v.p.toFixed(4)}`).join('  '));
}
printDataset(v1);
printDataset(v2);

const scaleDelta = ((v2.trained.frames - v1.trained.frames) / v1.trained.frames) * 100;
console.log(`\n📐 规模效应 80→600 (trained): ${v1.trained.frames.toFixed(0)}f → ${v2.trained.frames.toFixed(0)}f = ${scaleDelta >= 0 ? '+' : ''}${scaleDelta.toFixed(1)}%  (同一游戏、同一 CEM 预算 100×64、同一 320 参数解码器)`);

if (WRITE) {
  const stamp = { reevaluatedAt: new Date().toISOString(), gameBuild: 'post-2026-09-15 danmaku timing fixes', seeds: '80001-80020' };
  for (const [r, ckPath] of [[v1, 'public/data/checkpoint.json'], [v2, 'public/data/checkpoint600.json']]) {
    const ck = loadJson(ckPath);
    ck.benchmark.originalRun = ck.benchmark.originalRun || JSON.parse(JSON.stringify({
      trained: ck.benchmark.trained, matchedControl: ck.benchmark.matchedControl, matchedControls: ck.benchmark.matchedControls,
      circuitSilenced: ck.benchmark.circuitSilenced, idle: ck.benchmark.idle,
      driftBottomRight: ck.benchmark.driftBottomRight, driftBottomLeft: ck.benchmark.driftBottomLeft, randomPolicy: ck.benchmark.randomPolicy,
      note: '本次演化运行时游戏构建下的原始记录'
    }));
    ck.benchmark.reeval = { ...stamp, trained: r.trained, matchedControls: r.controls, circuitSilenced: r.silenced, idle: r.idle, vsControls: r.vsControls };
    ck.benchmark.trained = r.trained;
    ck.benchmark.matchedControls = r.controls;
    ck.benchmark.matchedControl = r.controls[0];
    ck.benchmark.circuitSilenced = r.silenced;
    ck.benchmark.idle = r.idle;
    const advMean = r.controls.reduce((a, c) => a + c.frames, 0) / r.controls.length;
    const advPct = ((r.trained.frames - advMean) / advMean) * 100;
    const directions = r.vsControls.map(v => Math.sign(v.diff));
    const mixed = directions.some(s => s > 0) && directions.some(s => s < 0);
    const minP = Math.min(...r.vsControls.map(v => v.p));
    const adjP = Math.min(1, minP * r.vsControls.length);
    ck.benchmark.topologyAdvantagePercent = advPct;
    ck.benchmark.topologyAdvantageP = r.vsControls.map(v => ({ seed: v.seed, diffFrames: v.diff, twoSidedP: v.p }));
    ck.benchmark.topologyAdvantageAdjustedP = adjP;
    ck.benchmark.topologyAdvantageSignificant = !mixed && adjP < 0.05;
    ck.benchmark.topologyAdvantageConsistent = !mixed;
    ck.benchmark.topologyAdvantageNote = mixed
      ? `3 组度保持对照方向不一致 (有赢有输, 各自 bootstrap p 均 <0.05)：对照网络存活在 ${Math.min(...r.controls.map(c => c.frames)).toFixed(0)}~${Math.max(...r.controls.map(c => c.frames)).toFixed(0)}f 间波动 (CEM 单次重连运气主导)。生物拓扑相对对照的优势百分比不可作为优越性证据，与 flydino 声明一致：本项目验证的是对连接组活动的依赖 (trained ≫ silenced 的因果链条)，而非生物拓扑的优越性。`
      : `3 组对照方向一致, Bonferroni 校正双侧 p=${adjP.toFixed(4)} ${adjP < 0.05 ? '< 0.05 → 显著' : '≥ 0.05 → 不显著'}。`;
    fs.writeFileSync(path.join(ROOT, ckPath), JSON.stringify(ck, null, 2));
    console.log(`✍️ 已写回 ${ckPath} (benchmark 重评 + originalRun 保留)`);
  }
} else {
  console.log('\n(dry-run — 加 --write 落盘)');
}
