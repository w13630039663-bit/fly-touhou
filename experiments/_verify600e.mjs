/**
 * _verify600e.mjs — 修正版 D1：让「已训练脑」真的驱动自机，再测 8 通道活性
 * 并在此「活输入序列」上重跑 D2 中继消融 / D3 拓扑替换
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

const inputCells = new Set(g600.inputs.map(x => Array.isArray(x) ? x[0] : x));
const outputCells = new Set(g600.outputs);

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

// ── 用【独立的一份脑】驱动自机，采集"活"输入序列 ──
const driveBrain = new MaleCNSConnectome(g600);
const drivePol = new ReadoutPolicy(new Float64Array(ck600.weights));
const game = new DanmakuGame(null, { width: 460, height: 580, seed: 80001 });
game.setSpellcard(0); game.player.lives = 1; game.player.maxLives = 1;
game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
driveBrain.reset();
const obsSeq = [];
for (let f = 0; f < 1200 && !game.player.isDead; f++) {
  const obs = game.getBiologicalSensoryInput();
  obsSeq.push(obs);
  const dn = driveBrain.step(obs, false);
  const motor = drivePol.forward(dn);
  game.update(motor);
}
console.log(`采集到 ${obsSeq.length} 帧「已训练脑实际驱动」的输入序列（自机存活 ${game.player.isDead ? '已阵亡' : '存活'}）`);
const xs = obsSeq.map((_, i) => null);
console.log(`自机 x 范围: 需另取；改用通道统计`);

console.log('\n=== D1# 输入通道活性（真驱动 1200 帧）===');
let deadCh = [];
for (let c = 0; c < 8; c++) {
  const vals = obsSeq.map(o => o[c]);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  const live = sd > 1e-4;
  if (!live) deadCh.push(c);
  console.log(`  ch${c}: min=${mn.toFixed(3)} max=${mx.toFixed(3)} mean=${mean.toFixed(3)} std=${sd.toFixed(4)} ${live ? 'LIVE' : 'DEAD'}`);
}
console.log(`  → 死通道: ${deadCh.length ? deadCh.join(',') : '无'} | 活跃通道 ${8 - deadCh.length}/8`);

console.log('\n=== D2# 中继消融（在活序列上）===');
const brain2 = new MaleCNSConnectome(g600);
let d2max = 0, d2sum = 0;
for (const o of obsSeq) {
  brain2.reset(); const full = stepMasked(brain2, o, false);
  brain2.reset(); const off = stepMasked(brain2, o, true);
  const d = full.map((v, i) => Math.abs(v - off[i]));
  d2max = Math.max(d2max, ...d);
  d2sum += d.reduce((a, b) => a + b, 0) / 16;
}
// 参照系：DN 输出本身的量级
const brain3 = new MaleCNSConnectome(g600);
let dnScale = 0;
for (const o of obsSeq) { brain3.reset(); const f = stepMasked(brain3, o, false); dnScale += f.reduce((a, b) => a + Math.abs(b), 0) / 16; }
console.log(`  DN 输出平均量级 |DN| = ${(dnScale / obsSeq.length).toFixed(4)}`);
console.log(`  中继消融平均 |Δ DN|  = ${(d2sum / obsSeq.length).toFixed(4)}  (占 ${(d2sum / dnScale * 100).toFixed(1)}%)`);
console.log(`  中继消融最大 |Δ DN|  = ${d2max.toFixed(4)}`);

console.log('\n=== D3# 拓扑替换（在活序列上）===');
const ctrlGraph = createMatchedControlGraph(g600, 42);
const ctrlBrain = new MaleCNSConnectome(ctrlGraph);
let d3max = 0, d3sum = 0;
for (const o of obsSeq) {
  brain2.reset(); const a = stepMasked(brain2, o, false);
  ctrlBrain.reset(); const b2 = stepMasked(ctrlBrain, o, false);
  const d = a.map((v, i) => Math.abs(v - b2[i]));
  d3max = Math.max(d3max, ...d);
  d3sum += d.reduce((x, y) => x + y, 0) / 16;
}
console.log(`  拓扑替换平均 |Δ DN| = ${(d3sum / obsSeq.length).toFixed(4)}  (占 ${(d3sum / dnScale * 100).toFixed(1)}%)`);
console.log(`  拓扑替换最大 |Δ DN| = ${d3max.toFixed(4)}`);
