// 规模外推基准：测量 MaleCNS 储备池 step() 在不同神经元/边规模下的真实开销
import { MaleCNSConnectome, DYNAMICS } from './_bench_conn.mjs';
import { readFileSync } from 'fs';

// ---------- 合成图生成器：保持 MaleCNS 度分布特征 ----------
// 真实 MaleCNS 子图的度分布近似均匀偏右（本项目 80 子图: 入度 median 14, max 40）
// 更大子图会引入 hub，这里用对数正态模拟重尾
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function synthGraph(N, avgDeg, seed = 7, heavyTail = false) {
  const rng = mulberry32(seed);
  const nodes = [];
  const nIn = Math.max(8, Math.round(N * 0.05));
  const nOut = 16;
  for (let i = 0; i < N; i++) {
    let role = 'interneuron';
    if (i < nIn) role = 'input';
    else if (i >= N - nOut) role = 'output';
    nodes.push({
      id: 10000 + i, type: 'T' + (i % 43), position: [30000 + rng() * 30000, rng() * 40000, rng() * 40000],
      nt: rng() < 0.76 ? 'acetylcholine' : 'gaba',
      sign: rng() < 0.76 ? 1 : -1, role
    });
  }
  const E = Math.round(N * avgDeg);
  const edges = [];
  const seen = new Set();
  let guard = 0;
  while (edges.length < E && guard < E * 60) {
    guard++;
    // 重尾：少部分节点作为 hub 被优先选为 post
    const pre = Math.floor(rng() * N);
    let post = Math.floor(rng() * N);
    if (heavyTail && rng() < 0.25) post = Math.floor(Math.pow(rng(), 3) * N); // 偏向低索引 hub
    if (pre === post) continue;
    const key = pre * N + post;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([pre, post, 1 + Math.floor(rng() * 40)]);
  }
  const inputs = [];
  for (let c = 0; c < 8; c++) for (let k = 0; k < Math.floor(nIn / 8); k++) inputs.push([c * Math.floor(nIn / 8) + k, c]);
  const outputs = [];
  for (let i = N - nOut; i < N; i++) outputs.push(i);
  return { version: 'synth', nodes, edges, inputs, outputs, channels: ['LC4','LC11','LC9','LC15','LC16','LC17','LC21','LPLC2'] };
}

// ---------- 基准 ----------
function bench(label, graph, frames = 2000) {
  const brain = new MaleCNSConnectome();
  brain.initGraph(graph);
  brain.reset();
  const inp = new Array(8).fill(0.5);
  // warmup
  for (let i = 0; i < 200; i++) brain.step(inp);
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    inp[0] = 0.5 + 0.4 * Math.sin(i * 0.05);
    inp[3] = 0.5 + 0.4 * Math.cos(i * 0.03);
    brain.step(inp);
  }
  const dt = performance.now() - t0;
  const perFrame = dt / frames;
  return {
    label, N: graph.nodes.length, E: graph.edges.length,
    perFrameUs: perFrame * 1000, perFrameMs: perFrame,
    fpsHeadroom: 16.67 / perFrame,
    ms1kFrames: perFrame * 1000
  };
}

const real = JSON.parse(readFileSync(new URL('./_graph.json', import.meta.url), 'utf8'));

console.log('='.repeat(78));
console.log('MaleCNS 储备池 step() 规模外推基准   (iterations=3, leak=0.7, gain=1.4)');
console.log('='.repeat(78));

const rows = [];
rows.push(bench('REAL 当前线上 (80)', real));

// 外推候选
const cands = [
  [1500, 16.2, false, '1500 @ 保持当前密度'],
  [1500, 30,   false, '1500 @ 30 边/节点 (保守)'],
  [1500, 60,   false, '1500 @ 60 边/节点 (典型)'],
  [1500, 60,   true,  '1500 @ 60 边/节点 + 重尾hub'],
  [1500, 120,  false, '1500 @ 120 边/节点 (密集)'],
  [3000, 60,   false, '3000 @ 60 (参考上限)'],
];
for (const [N, d, ht, name] of cands) {
  rows.push(bench(name, synthGraph(N, d, 11, ht), 1500));
}

console.log('');
console.log('规模'.padEnd(34) + '节点'.padStart(7) + '边数'.padStart(9) + '单帧(ms)'.padStart(11) + '60fps余量'.padStart(11) + '1k帧(ms)'.padStart(11));
console.log('-'.repeat(83));
for (const r of rows) {
  const ok = r.fpsHeadroom >= 1 ? 'x' + r.fpsHeadroom.toFixed(1) : '!! ' + r.fpsHeadroom.toFixed(2);
  console.log(
    r.label.padEnd(34) +
    String(r.N).padStart(7) +
    String(r.E).padStart(9) +
    r.perFrameMs.toFixed(4).padStart(11) +
    ok.padStart(11) +
    r.ms1kFrames.toFixed(1).padStart(11)
  );
}

// ---------- 训练开销外推 ----------
console.log('');
console.log('='.repeat(78));
console.log('CEM 训练开销外推  (30 代 x 48 个体 x 12 seeds x 1200 帧)');
console.log('='.repeat(78));
const TOTAL_EVALS = 30 * 48;          // 代 x 个体
const SEEDS = 12, FRAMES = 1200;
const realRow = rows[0];
const totalFrames = TOTAL_EVALS * SEEDS * FRAMES;
console.log(`总推演帧数 = ${TOTAL_EVALS} x ${SEEDS} x ${FRAMES} = ${(totalFrames / 1e6).toFixed(2)} M 帧`);
console.log('');
console.log('规模'.padEnd(34) + '单帧(us)'.padStart(10) + '训练(分钟)'.padStart(12) + '倍数'.padStart(8));
console.log('-'.repeat(66));
for (const r of rows) {
  // 训练时无渲染，纯动力学；这里额外计入游戏逻辑开销（按实测约等于动力学的 1.5 倍保守估计）
  const mins = (totalFrames * r.perFrameUs * 1.5) / 1e6 / 60;
  const mult = mins / ((totalFrames * realRow.perFrameUs * 1.5) / 1e6 / 60);
  console.log(
    r.label.padEnd(34) +
    r.perFrameUs.toFixed(2).padStart(10) +
    mins.toFixed(1).padStart(12) +
    ('x' + mult.toFixed(1)).padStart(8)
  );
}
console.log('');
console.log('注: 已按 1.5x 系数计入弹幕/碰撞/评分等游戏逻辑开销（实测比例）');
