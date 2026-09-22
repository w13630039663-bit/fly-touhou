/**
 * repro_scores.mjs — 独立复现各 checkpoint 的训练成绩（只读，不改任何文件）
 *
 * 用法（在项目根目录）：
 *   node experiments/verify600/repro_scores.mjs
 *
 * 原理：用 checkpoint 保存的 weights + 对应 graph，在独立测试种子 80001-80020 上
 * 重跑 evaluateOnTestSeeds，与 checkpoint 里记录的数字对比。若"实跑 == 记录"，
 * 说明保存的权重与记录的成绩是自洽、可复现的真实数据。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MaleCNSConnectome } from '../../src/brain/connectome.js';
import { evaluateOnTestSeeds } from '../../train.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST_SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// train.js 用 B=20000；此处默认同参以便与记录值直接对比
function pairedBootstrap(x, y, B = 20000, seed = 246813579) {
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
    if (Math.sign((a - c) / n) !== Math.sign(d)) hits++;
  }
  return { diff: d, p: Math.max(2 / B, (hits / B) * 2) };
}

const CASES = [
  ['v1-80 (现状基线)',  'graph.json',     'checkpoint.json',     1544.85],
  ['v600 (第一版)',     'graph600.json',  'checkpoint600.json',  1235.60],
  ['v600a (A案·冠军)',  'graph600a.json', 'checkpoint600a.json', 1538.15],
  ['v600b (C案)',       'graph600b.json', 'checkpoint600b.json', 1374.90],
  ['v600ag (B案)',      'graph600a.json', 'checkpoint600ag.json', 1386.25],
  ['v600ax (D案)',      'graph600a.json', 'checkpoint600ax.json', 1454.40],
  ['v1x (D案对照)',     'graph.json',     'checkpointV1x.json',  1338.35],
];

const perSeed = {};
console.log('测试种子: 80001-80020（20 个，独立于训练种子）\n');
for (const [name, gfile, cfile, claim] of CASES) {
  const g = load(`public/data/connectome/${gfile}`);
  const ck = load(`public/data/${cfile}`);
  const brain = new MaleCNSConnectome(g);
  const r = evaluateOnTestSeeds(TEST_SEEDS, brain, new Float64Array(ck.weights), 'normal');
  perSeed[name] = r.perSeedFrames || [];
  const ok = Math.abs(r.frames - claim) < 1.0;
  console.log(
    (ok ? 'MATCH  ' : 'DIFF   ') + name.padEnd(18) +
    '实跑 ' + r.frames.toFixed(1) + 'f / ' + r.seconds.toFixed(2) + 's' +
    '   记录 ' + claim + 'f   Δ=' + (r.frames - claim).toFixed(2) + 'f'
  );
}

console.log('\n=== 核心配对比较：A案 vs 旧 v600 ===');
const c600 = load('public/data/checkpoint600.json');
const ref = c600.benchmark.originalRun?.trained.perSeedFrames || c600.benchmark.trained.perSeedFrames;
const a = perSeed['v600a (A案·冠军)'];
if (a.length && ref.length) {
  const bs = pairedBootstrap(a, ref);
  const gt = a.filter((v, i) => v > ref[i]).length;
  const ge = a.filter((v, i) => v >= ref[i]).length;
  console.log('平均 Δ = ' + bs.diff.toFixed(2) + 'f   双侧 p = ' + bs.p.toFixed(4) +
    '   胜场 严格> ' + gt + '/20, 含平局 >= ' + ge + '/20');
  console.log('PLAN_520 记录: Δ=+302.6f  p=0.0046  胜 18/20（含 1 个双方均触顶 1800f 的平局）');
}
