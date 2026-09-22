// 甜蜜点扫描：分离「节点数 N」与「平均度 D」对储备池健康度的影响
// 合成图改用分层结构（input -> inter <-> inter -> output），更接近真实视觉-运动通路
import { MaleCNSConnectome, DYNAMICS } from './_bench_conn.mjs';
import { readFileSync } from 'fs';

const _log = console.log;
console.log = (...a) => {
  if (typeof a[0] === 'string' && a[0].includes('[MaleCNS]')) return;
  _log(...a);
};

function mulberry32(a) {
  return function () { let t = (a += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 分层合成图：nIn 输入 -> nInter 中间(循环储备池) -> nOut 输出
function layeredGraph(nIn, nInter, nOut, avgDeg, seed = 11) {
  const rng = mulberry32(seed);
  const N = nIn + nInter + nOut;
  const nodes = [];
  for (let i = 0; i < N; i++) {
    let role = i < nIn ? 'input' : (i >= nIn + nInter ? 'output' : 'interneuron');
    nodes.push({ id: 10000 + i, type: 'T' + (i % 43), position: [30000, 0, 0],
      nt: rng() < 0.76 ? 'acetylcholine' : 'gaba', sign: rng() < 0.76 ? 1 : -1, role });
  }
  const edges = [], seen = new Set();
  const push = (a, b) => {
    if (a === b) return false;
    const k = a * N + b;
    if (seen.has(k)) return false;
    seen.add(k);
    edges.push([a, b, 1 + Math.floor(rng() * 40)]);
    return true;
  };
  const i0 = nIn, i1 = nIn + nInter;
  let guard = 0, target = Math.round(N * avgDeg);
  // 分层配边：input->inter 25%, inter<->inter 55%, inter->output 15%, output->inter 5%
  const quota = [
    [0.25, () => [Math.floor(rng() * nIn), i0 + Math.floor(rng() * nInter)]],
    [0.55, () => [i0 + Math.floor(rng() * nInter), i0 + Math.floor(rng() * nInter)]],
    [0.15, () => [i0 + Math.floor(rng() * nInter), i1 + Math.floor(rng() * nOut)]],
    [0.05, () => [i1 + Math.floor(rng() * nOut), i0 + Math.floor(rng() * nInter)]],
  ];
  while (edges.length < target && guard < target * 80) {
    guard++;
    let r = rng(), acc = 0, pick = quota[1][1];
    for (const [p, f] of quota) { acc += p; if (r <= acc) { pick = f; break; } }
    const [a, b] = pick();
    push(a, b);
  }
  const inputs = [];
  for (let c = 0; c < 8; c++) for (let k = 0; k < Math.floor(nIn / 8); k++)
    inputs.push([c * Math.floor(nIn / 8) + k, c]);
  const outputs = []; for (let i = i1; i < N; i++) outputs.push(i);
  return { version: 'synth-layered', nodes, edges, inputs, outputs,
    channels: ['LC4','LC11','LC9','LC15','LC16','LC17','LC21','LPLC2'] };
}

// 时间平均测量：预热后采样 SAMPLE 帧取平均，避免单帧快照在振荡系统中的噪声
function measure(graph, gain, warm = 1000, sample = 400) {
  const brain = new MaleCNSConnectome();
  brain.initGraph(graph);
  brain.reset();
  const saved = DYNAMICS.gain;
  DYNAMICS.gain = gain;
  const inp = new Array(8).fill(0.5);
  const drive = (i) => { for (let c = 0; c < 8; c++) inp[c] = 0.5 + 0.45 * Math.sin(i * (0.03 + c * 0.017) + c); };
  for (let i = 0; i < warm; i++) { drive(i); brain.step(inp); }
  const n = brain.count, nOut = brain.outputs.length;
  let ampSum = 0, silSum = 0, satSum = 0, sdSum = 0;
  for (let i = 0; i < sample; i++) {
    drive(warm + i);
    brain.step(inp);
    const a = brain.activity;
    let sil = 0, sat = 0, s2 = 0, amp = 0;
    for (let k = 0; k < n; k++) {
      const v = Math.abs(a[k]);
      if (v > 0.95) sat++;
      if (v < 0.02) sil++;
      s2 += a[k] * a[k];
    }
    for (let k = 0; k < nOut; k++) amp += Math.abs(a[brain.outputs[k]]);
    ampSum += amp / nOut;
    silSum += sil / n * 100;
    satSum += sat / n * 100;
    sdSum += Math.sqrt(s2 / n);
  }
  DYNAMICS.gain = saved;
  return { outAmp: ampSum / sample, silentPct: silSum / sample,
    satPct: satSum / sample, sd: sdSum / sample };
}

function timing(graph) {
  const brain = new MaleCNSConnectome();
  brain.initGraph(graph);
  brain.reset();
  const inp = new Array(8).fill(0.5);
  for (let i = 0; i < 150; i++) brain.step(inp);
  const t0 = performance.now();
  for (let i = 0; i < 800; i++) { inp[0] = 0.5 + 0.4 * Math.sin(i * 0.05); brain.step(inp); }
  return (performance.now() - t0) / 800;
}

// 自动找「最优 gain」：输出幅值最接近真实 80 基线，且静默率 < 10%
let TARGET_AMP = 0.310;
function findBestGain(graph) {
  let best = null;
  for (let gv = 1.0; gv <= 3.0001; gv += 0.1) {
    const m = measure(graph, Math.round(gv * 10) / 10, 800, 250);
    if (m.silentPct > 10) continue;
    const err = Math.abs(m.outAmp - TARGET_AMP);
    if (!best || err < best.err) best = { gain: Math.round(gv * 10) / 10, err, ...m };
  }
  return best;
}

const real = JSON.parse(readFileSync(new URL('./_graph.json', import.meta.url), 'utf8'));

// 先用真实 80 图建立基线（时间平均，600 帧采样）
const realBase = measure(real, 1.4, 1500, 600);
TARGET_AMP = realBase.outAmp;
console.log(`[基线] 真实 80 图 (gain=1.4): 输出幅值 ${realBase.outAmp.toFixed(3)}  ` +
  `静默 ${realBase.silentPct.toFixed(1)}%  饱和 ${realBase.satPct.toFixed(1)}%  std ${realBase.sd.toFixed(3)}`);
console.log(`[基线] 后续所有 gain 标定均以输出幅值 ${TARGET_AMP.toFixed(3)} 为目标\n`);

console.log('='.repeat(112));
console.log('甜蜜点二维扫描：节点数 N x 平均度 D   (输入 32 / 输出 16 固定，路线 A)');
console.log('='.repeat(112));
console.log('   N   度    边数'.padEnd(22) +
  '单帧ms'.padStart(9) + '训练min'.padStart(9) +
  '幅值@1.4'.padStart(10) + '静默@1.4'.padStart(10) +
  '最优gain'.padStart(10) + '幅值'.padStart(8) + '静默%'.padStart(8) + '饱和%'.padStart(8));
console.log('-'.repeat(112));

const results = [];
for (const [N, deg] of [
  [80, 16], [150, 16], [150, 30], [300, 16], [300, 30], [300, 45],
  [500, 16], [500, 30], [500, 45], [800, 16], [800, 30],
  [1200, 16], [1200, 30], [1500, 30], [1500, 60],
]) {
  const nInter = N - 32 - 16;
  const g = layeredGraph(32, nInter, 16, deg, 11);
  const ms = timing(g);
  const m14 = measure(g, 1.4);
  const best = findBestGain(g);
  const trainMin = (30 * 48 * 12 * 1200) * ms * 1000 * 1.5 / 1e6 / 60;
  const E = g.edges.length;
  const row = { N, deg, E, ms, trainMin, m14, best };
  results.push(row);
  const bt = best ? `${best.gain.toFixed(1)}` : '未达标';
  const ba = best ? best.outAmp.toFixed(3) : '  -  ';
  const bs = best ? best.silentPct.toFixed(1) : '  -  ';
  const bq = best ? best.satPct.toFixed(1) : '  -  ';
  console.log(
    `${String(N).padStart(4)} ${String(deg).padStart(4)} ${String(E).padStart(8)}`.padEnd(22) +
    ms.toFixed(4).padStart(9) + trainMin.toFixed(0).padStart(9) +
    m14.outAmp.toFixed(3).padStart(10) + m14.silentPct.toFixed(1).padStart(10) +
    bt.padStart(10) + ba.padStart(8) + bs.padStart(8) + bq.padStart(8)
  );
}

// ---- 真实 80 基线 ----
const realMs = timing(real);
const realM = measure(real, 1.4);
console.log('-'.repeat(112));
console.log(
  `${'REAL 80'.padStart(9)} ${String(real.edges.length).padStart(8)}`.padEnd(22) +
  realMs.toFixed(4).padStart(9) + ((30*48*12*1200)*realMs*1000*1.5/1e6/60).toFixed(0).padStart(9) +
  realM.outAmp.toFixed(3).padStart(10) + realM.silentPct.toFixed(1).padStart(10) +
  '  1.4'.padStart(10) + realM.outAmp.toFixed(3).padStart(8) + realM.silentPct.toFixed(1).padStart(8) +
  realM.satPct.toFixed(1).padStart(8)
);

// ---- 推荐：综合评分 ----
console.log('');
console.log('='.repeat(112));
console.log('综合评分（越高越好）  权重: 规模增益 30% / 训练可控 25% / 信号可恢复 25% / 可视化 20%');
console.log('='.repeat(112));
console.log('   N   度    边数'.padEnd(22) + '规模增益'.padStart(10) + '训练可控'.padStart(10) +
  '信号可恢复'.padStart(12) + '可视化'.padStart(10) + '总分'.padStart(9));
console.log('-'.repeat(112));

// 评分函数（各项 0-100）
const scaleScore = (N) => Math.min(100, Math.log2(N / 80) / Math.log2(1500 / 80) * 100);
const trainScore = (m) => m <= 15 ? 100 : m <= 30 ? 85 : m <= 60 ? 65 : m <= 120 ? 45 : m <= 300 ? 25 : 10;
const sigScore = (best) => best ? Math.max(0, 100 - Math.abs(best.outAmp - TARGET_AMP) / TARGET_AMP * 200) : 0;
// 可视化：边数 <=2000 满分（可直接全量画），>8000 需 LOD（扣分）
const visScore = (E) => E <= 2000 ? 100 : E <= 5000 ? 85 : E <= 10000 ? 65 : E <= 30000 ? 45 : E <= 60000 ? 28 : 15;

for (const r of results) {
  const s1 = scaleScore(r.N), s2 = trainScore(r.trainMin), s3 = sigScore(r.best), s4 = visScore(r.E);
  const total = s1 * 0.30 + s2 * 0.25 + s3 * 0.25 + s4 * 0.20;
  r.total = total;
  console.log(
    `${String(r.N).padStart(4)} ${String(r.deg).padStart(4)} ${String(r.E).padStart(8)}`.padEnd(22) +
    s1.toFixed(0).padStart(10) + s2.toFixed(0).padStart(10) + s3.toFixed(0).padStart(12) +
    s4.toFixed(0).padStart(10) + total.toFixed(1).padStart(9)
  );
}

const bestRow = results.reduce((a, b) => (b.total > a.total ? b : a));
console.log('-'.repeat(112));
console.log(`>>> 综合最优: N=${bestRow.N}, 平均度=${bestRow.deg}, 边数=${bestRow.E}, ` +
  `最优 gain=${bestRow.best ? bestRow.best.gain : 'N/A'}, 训练≈${bestRow.trainMin.toFixed(0)} 分钟`);
