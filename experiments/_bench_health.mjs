// 储备池健康度检查：规模放大后活动是否饱和/衰减
// 判定标准: |a|>0.95 为饱和, |a|<0.02 为静默; 健康区间应两者都低且 std 适中
import { MaleCNSConnectome, DYNAMICS } from './_bench_conn.mjs';
import { readFileSync } from 'fs';

function mulberry32(a) {
  return function () { let t = (a += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function synthGraph(N, avgDeg, seed = 7) {
  const rng = mulberry32(seed);
  const nodes = [];
  const nIn = Math.max(8, Math.round(N * 0.05)), nOut = 16;
  for (let i = 0; i < N; i++) {
    let role = 'interneuron';
    if (i < nIn) role = 'input'; else if (i >= N - nOut) role = 'output';
    nodes.push({ id: 10000 + i, type: 'T' + (i % 43), position: [30000, 0, 0],
      nt: rng() < 0.76 ? 'acetylcholine' : 'gaba', sign: rng() < 0.76 ? 1 : -1, role });
  }
  const E = Math.round(N * avgDeg), edges = [], seen = new Set();
  let guard = 0;
  while (edges.length < E && guard < E * 60) {
    guard++;
    const pre = Math.floor(rng() * N), post = Math.floor(rng() * N);
    if (pre === post) continue;
    const key = pre * N + post;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([pre, post, 1 + Math.floor(rng() * 40)]);
  }
  const inputs = [];
  for (let c = 0; c < 8; c++) for (let k = 0; k < Math.floor(nIn / 8); k++) inputs.push([c * Math.floor(nIn / 8) + k, c]);
  const outputs = []; for (let i = N - nOut; i < N; i++) outputs.push(i);
  return { version: 'synth', nodes, edges, inputs, outputs, channels: ['LC4','LC11','LC9','LC15','LC16','LC17','LC21','LPLC2'] };
}

function health(label, graph, gainOverride = null) {
  const brain = new MaleCNSConnectome();
  brain.initGraph(graph);
  brain.reset();
  const savedGain = DYNAMICS.gain;
  if (gainOverride !== null) DYNAMICS.gain = gainOverride;
  const inp = new Array(8).fill(0.5);
  for (let i = 0; i < 1500; i++) {
    for (let c = 0; c < 8; c++) inp[c] = 0.5 + 0.45 * Math.sin(i * (0.03 + c * 0.017) + c);
    brain.step(inp);
  }
  const a = brain.activity;
  let sat = 0, silent = 0, sum = 0, sum2 = 0;
  for (let i = 0; i < a.length; i++) {
    const v = Math.abs(a[i]);
    if (v > 0.95) sat++;
    if (v < 0.02) silent++;
    sum += a[i]; sum2 += a[i] * a[i];
  }
  const n = a.length;
  const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  DYNAMICS.gain = savedGain;
  // 输出层幅值（决定 readout 是否有效）
  const outAmp = brain.outputs.reduce((s, i) => s + Math.abs(a[i]), 0) / brain.outputs.length;
  return { label, N: n, E: graph.edges.length, gain: gainOverride ?? DYNAMICS.gain,
    satPct: sat / n * 100, silentPct: silent / n * 100, mean, sd, outAmp };
}

const real = JSON.parse(readFileSync(new URL('./_graph.json', import.meta.url), 'utf8'));

console.log('='.repeat(96));
console.log('储备池健康度检查 (1500 帧预热后统计)   gain=1.4 leak=0.7 iter=3');
console.log('='.repeat(96));
console.log('规模'.padEnd(30) + '边数'.padStart(9) + '饱和%'.padStart(9) + '静默%'.padStart(9) + '均值'.padStart(9) + '标准差'.padStart(9) + '输出幅值'.padStart(10) + '  判定');
console.log('-'.repeat(96));

const rows = [];
rows.push(health('REAL 80 (基准)', real));
for (const [N, d] of [[1500, 16.2], [1500, 30], [1500, 60], [1500, 120], [3000, 60]]) {
  rows.push(health(`1500 @ ${d} 边/节点`.replace('1500', String(N)), synthGraph(N, d, 11), null));
}
for (const r of rows) {
  const verdict = r.satPct > 40 ? '!! 饱和' : r.silentPct > 60 ? '!! 衰减' : r.sd < 0.05 ? '!! 塌缩' : 'OK';
  console.log(
    r.label.padEnd(30) + String(r.E).padStart(9) + r.satPct.toFixed(1).padStart(9) +
    r.silentPct.toFixed(1).padStart(9) + r.mean.toFixed(3).padStart(9) + r.sd.toFixed(3).padStart(9) +
    r.outAmp.toFixed(3).padStart(10) + '  ' + verdict
  );
}

// gain 敏感性扫描（1500 @ 60）
console.log('');
console.log('='.repeat(96));
console.log('gain 敏感性扫描 (1500 @ 60 边/节点) —— 找到健康区间');
console.log('='.repeat(96));
const g = synthGraph(1500, 60, 11);
console.log('gain'.padStart(8) + '饱和%'.padStart(9) + '静默%'.padStart(9) + '标准差'.padStart(9) + '输出幅值'.padStart(10));
console.log('-'.repeat(48));
for (const gv of [0.4, 0.7, 1.0, 1.2, 1.4, 1.8, 2.4]) {
  const r = health('x', g, gv);
  console.log(String(gv).padStart(8) + r.satPct.toFixed(1).padStart(9) + r.silentPct.toFixed(1).padStart(9) +
    r.sd.toFixed(3).padStart(9) + r.outAmp.toFixed(3).padStart(10));
}
