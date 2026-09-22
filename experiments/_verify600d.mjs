/**
 * _verify600d.mjs — 决定性检验：信号是否真的穿过内部拓扑（而非输入直连输出）
 *  D1 输入通道是否真的"活"（不是常数/全零）
 *  D2 中继消融：把 528 个中继神经元强制置零 → DN 输出是否变化
 *  D3 拓扑替换：同权重、同输入序列，换成 Matched Control 拓扑 → DN 输出是否变化
 *  D4 直连统计：多少 DN 有来自 input 细胞的直达边
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MaleCNSConnectome, createMatchedControlGraph, DYNAMICS } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';
import { DanmakuGame } from '../src/game/danmaku.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const g600 = readJson('public/data/connectome/graph600.json');
const ck600 = readJson('public/data/checkpoint600.json');

const brain = new MaleCNSConnectome(g600);
const pol = new ReadoutPolicy(new Float64Array(ck600.weights));

const inputCells = new Set(g600.inputs.map(x => Array.isArray(x) ? x[0] : x));
const outputCells = new Set(g600.outputs);

// ── 手工 step，支持「中继置零」掩码 ──
function stepMasked(b, senses, zeroRelay) {
  b.drive.fill(0);
  for (const [cell, channel] of b.inputs) b.drive[cell] = 2.0 * (senses[channel] - 0.5);
  const { ePost, ePre, eWeight } = b;
  for (let t = 0; t < DYNAMICS.iterations; t++) {
    b.scratch.set(b.drive);
    for (let e = 0; e < ePost.length; e++) b.scratch[ePost[e]] += DYNAMICS.gain * eWeight[e] * b.activity[ePre[e]];
    for (let i = 0; i < b.count; i++) {
      const prev = b.activity[i];
      let next = (1 - DYNAMICS.leak) * prev + DYNAMICS.leak * Math.tanh(b.scratch[i]);
      if (zeroRelay && !inputCells.has(i) && !outputCells.has(i)) next = 0;
      b.activity[i] = next;
    }
  }
  return b.outputs.map(i => b.activity[i] * DYNAMICS.outputGain);
}

// ── 采集真实输入序列 ──
const game = new DanmakuGame(null, { width: 460, height: 580, seed: 80001 });
const N = 600;
const obsSeq = [];
for (let f = 0; f < N; f++) { obsSeq.push(game.getBiologicalSensoryInput()); game.update({ moveX: 0, moveY: 0 }); }

console.log('=== D1 输入通道活性（真实游戏 600 帧）===');
for (let c = 0; c < 8; c++) {
  const vals = obsSeq.map(o => o[c]);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  const zeros = vals.filter(v => v === 0).length;
  console.log(`  ch${c}: min=${mn.toFixed(3)} max=${mx.toFixed(3)} mean=${mean.toFixed(3)} std=${sd.toFixed(4)} 全零帧=${zeros}/${N}`);
}
const allChansLive = [0, 1, 2, 3, 4, 5, 6, 7].every(c => {
  const vals = obsSeq.map(o => o[c]); const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) > 1e-6;
});
console.log(`  → 8 通道都有变化 ? ${allChansLive}`);

console.log('\n=== D2 中继消融（528 中继神经元强制归零）===');
let d2sum = 0, d2max = 0, d2framesChanged = 0;
for (const o of obsSeq) {
  brain.reset(); const full = stepMasked(brain, o, false);
  brain.reset(); const relayOff = stepMasked(brain, o, true);
  const d = full.map((v, i) => Math.abs(v - relayOff[i]));
  const mx = Math.max(...d); d2max = Math.max(d2max, mx);
  d2sum += d.reduce((a, b) => a + b, 0) / 16;
  if (mx > 1e-6) d2framesChanged++;
}
console.log(`  平均 |Δ DN| = ${(d2sum / obsSeq.length).toExponential(3)} | max |Δ DN| = ${d2max.toFixed(4)}`);
console.log(`  输出发生变化的帧: ${d2framesChanged}/${obsSeq.length}`);
console.log(`  → 中继拓扑是否真的参与计算 ? ${d2max > 1e-6}`);

console.log('\n=== D3 拓扑替换（同权重 / 同输入，换 Matched Control 拓扑）===');
const ctrlGraph = createMatchedControlGraph(g600, 42);
const ctrlBrain = new MaleCNSConnectome(ctrlGraph);
console.log(`  对照拓扑重连成功次数: ${ctrlGraph.successfulSwaps}`);
let d3sum = 0, d3max = 0, d3changed = 0;
for (const o of obsSeq) {
  brain.reset(); const a = stepMasked(brain, o, false);
  ctrlBrain.reset(); const b2 = stepMasked(ctrlBrain, o, false);
  const d = a.map((v, i) => Math.abs(v - b2[i]));
  const mx = Math.max(...d); d3max = Math.max(d3max, mx);
  d3sum += d.reduce((x, y) => x + y, 0) / 16;
  if (mx > 1e-6) d3changed++;
}
console.log(`  平均 |Δ DN| = ${(d3sum / obsSeq.length).toExponential(3)} | max |Δ DN| = ${d3max.toFixed(4)}`);
console.log(`  输出发生变化的帧: ${d3changed}/${obsSeq.length}`);
console.log(`  → 拓扑身份是否影响输出 ? ${d3max > 1e-6}`);

console.log('\n=== D4 直连统计 ===');
const direct = new Set();
for (const [a, b] of g600.edges) if (inputCells.has(a) && outputCells.has(b)) direct.add(b);
console.log(`  有 input→DN 直达边的 DN 数: ${direct.size}/16`);
let hop2 = 0;
const adj = new Map();
for (const [a, b] of g600.edges) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); }
for (const o of g600.outputs) {
  let found = false;
  for (const i of inputCells) { if ((adj.get(i) || []).includes(o)) { found = true; break; } }
  if (found) hop2++;
}
const relayOnly = g600.outputs.filter(o => {
  let hasRelay = false;
  for (const [a, b] of g600.edges) if (b === o && !inputCells.has(a) && !outputCells.has(a)) hasRelay = true;
  return !direct.has(o) && hasRelay;
});
console.log(`  只靠中继(无 input 直达)驱动的 DN 数: ${relayOnly.length}/16`);

console.log('\n=== 结论 ===');
console.log(`  D2 中继参与: ${d2max > 1e-6 ? 'YES' : 'NO'} | D3 拓扑参与: ${d3max > 1e-6 ? 'YES' : 'NO'} | 8 通道活跃: ${allChansLive ? 'YES' : 'NO'}`);
