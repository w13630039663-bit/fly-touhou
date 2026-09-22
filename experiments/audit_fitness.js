/**
 * 独立复核：训练适应度与真实避弹能力的关系
 * 不入库，仅作审计
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8'));
const ckpt = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/checkpoint.json'), 'utf8'));

const DYNAMICS = { iterations: 3, leak: 0.7, gain: 1.4, outputGain: 4.0 };
const count = graph.nodes.length;
const totals = new Float64Array(count);
for (const [pre, post, contacts] of graph.edges) totals[post] += contacts * Math.abs(graph.nodes[pre].sign);
const edges = graph.edges.map(([pre, post, contacts]) => [pre, post, totals[post] ? (contacts * graph.nodes[pre].sign) / totals[post] : 0]);
const PARAMETERS = 340;

class Brain {
  constructor() { this.activity = new Float64Array(count); this.scratch = new Float64Array(count); this.drive = new Float64Array(count); }
  reset() { this.activity.fill(0); this.scratch.fill(0); this.drive.fill(0); }
  step(inputs, ablated = false) {
    if (ablated) { this.activity.fill(0); return graph.outputs.map(() => 0); }
    this.drive.fill(0);
    for (const [cell, channel] of graph.inputs) this.drive[cell] = 2.0 * (inputs[channel] - 0.5);
    for (let t = 0; t < DYNAMICS.iterations; t++) {
      this.scratch.set(this.drive);
      for (let e = 0; e < edges.length; e++) { const [pre, post, w] = edges[e]; this.scratch[post] += DYNAMICS.gain * w * this.activity[pre]; }
      for (let i = 0; i < count; i++) this.activity[i] = (1 - DYNAMICS.leak) * this.activity[i] + DYNAMICS.leak * Math.tanh(this.scratch[i]);
    }
    return graph.outputs.map((i) => this.activity[i] * DYNAMICS.outputGain);
  }
}

function forwardPolicy(weights, dn) {
  const hidden = new Float64Array(16); let k = 0;
  for (let h = 0; h < 16; h++) { let s = 0; for (let i = 0; i < 16; i++) s += weights[k++] * dn[i]; hidden[h] = Math.tanh(s + weights[k++]); }
  const scores = new Float64Array(4);
  for (let a = 0; a < 4; a++) { let s = 0; for (let h = 0; h < 16; h++) s += weights[k++] * hidden[h]; scores[a] = s + weights[k++]; }
  return { moveX: Math.tanh(scores[1] - scores[0]), moveY: Math.tanh(scores[3] - scores[2]) };
}

class Sim {
  constructor(seed) {
    this.seed = seed; this.width = 520; this.height = 700;
    this.player = { x: this.width / 2, y: this.height * 0.8, speed: 3.6, radius: 4.0 };
    this.bullets = []; this.frame = 0; this.grazeCount = 0;
  }
  nextRandom() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  spawnBullets() {
    const f = this.frame;
    const bossX = this.width / 2 + Math.sin(f * 0.025) * 160;
    const bossY = 90;
    if (f % 20 === 0) { const c = 12, ba = f * 0.08; for (let i = 0; i < c; i++) { const a = ba + (i / c) * Math.PI * 2; this.bullets.push({ x: bossX, y: bossY, vx: Math.cos(a) * 2.4, vy: Math.sin(a) * 2.4, radius: 4.5, grazed: false }); } }
    if (f % 45 === 0) { const dx = this.player.x - bossX, dy = this.player.y - bossY, ang = Math.atan2(dy, dx); for (let sp = -1; sp <= 1; sp++) { const a = ang + sp * 0.12; this.bullets.push({ x: bossX, y: bossY, vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 3.2, radius: 5.0, grazed: false }); } }
    if (f % 28 === 0) { const rx = 50 + this.nextRandom() * (this.width - 100); this.bullets.push({ x: rx, y: 40, vx: (this.nextRandom() - 0.5) * 0.6, vy: 2.6 + this.nextRandom() * 1.0, radius: 4.5, grazed: false }); }
  }
  getObservations() {
    const px = this.player.x, py = this.player.y, maxDist = 220;
    let ft = 0, lt = 0, rt = 0, rr = 0, vxs = 0, vys = 0, vc = 0;
    for (const b of this.bullets) {
      const dx = b.x - px, dy = b.y - py, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < maxDist && dist > 0.1) {
        vc++; const prox = 1 - dist / maxDist; vxs += b.vx; vys += b.vy;
        const app = -(dx * b.vx + dy * b.vy) / dist;
        const lo = app > 0 ? prox * 1.2 : prox * 0.6;
        if (dy < 0 && Math.abs(dx) < 45 && lo > ft) ft = lo;
        if (dx < 0 && dist < 180) { if (lo > lt) lt = lo; } else if (dx > 0 && dist < 180) { if (lo > rt) rt = lo; }
        if (dy > 0 && dist < 140 && lo > rr) rr = lo;
      }
    }
    const mvx = vc > 0 ? vxs / vc : 0, mvy = vc > 0 ? vys / vc : 0;
    return [Math.min(1, Math.max(0, ft)), Math.min(1, Math.max(0, lt)), Math.min(1, Math.max(0, rt)), Math.min(1, Math.max(0, rr)),
      Math.max(0, Math.min(1, (mvx + 3) / 6)), Math.max(0, Math.min(1, mvy / 4)),
      Math.min(1, Math.abs(px - this.width / 2) / (this.width / 2)), Math.max(0, Math.min(1, (this.height - py) / this.height))];
  }
  step(mx, my) {
    this.frame++; this.spawnBullets();
    this.player.x += mx * this.player.speed; this.player.y += my * this.player.speed;
    this.player.x = Math.max(20, Math.min(this.width - 20, this.player.x));
    this.player.y = Math.max(20, Math.min(this.height - 20, this.player.y));
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]; b.x += b.vx; b.y += b.vy;
      const dx = b.x - this.player.x, dy = b.y - this.player.y, d2 = dx * dx + dy * dy;
      if (!b.grazed && d2 < 324 && d2 > 16) { b.grazed = true; this.grazeCount++; }
      const hd = b.radius + this.player.radius;
      if (d2 < hd * hd) return { dead: true, frame: this.frame };
      if (b.y > this.height + 30 || b.y < -30 || b.x < -30 || b.x > this.width + 30) this.bullets.splice(i, 1);
    }
    return { dead: false, frame: this.frame };
  }
}

const W = new Float64Array(ckpt.weights);
const brain = new Brain();

function run(seed, maxFrames, mode) {
  brain.reset();
  const sim = new Sim(seed);
  let cornerPenalty = 0;
  while (sim.frame < maxFrames) {
    const obs = sim.getObservations();
    const dn = mode === 'silenced' ? brain.step(obs, true) : brain.step(obs, false);
    let mx = 0, my = 0;
    if (mode === 'trained' || mode === 'silenced') { const m = forwardPolicy(W, dn); mx = m.moveX; my = m.moveY; }
    else if (mode === 'randomW') { const m = forwardPolicy(rw, dn); mx = m.moveX; my = m.moveY; }
    sim.step(mx, my);
    if (sim.player.x < 35 || sim.player.x > sim.width - 35) cornerPenalty += 0.5;
  }
  return { frames: sim.frame, graze: sim.grazeCount, penalty: cornerPenalty };
}
const rw = new Float64Array(PARAMETERS).map(() => (Math.random() - 0.5) * 0.8);

// 报告训练脚本使用的种子区间到底能得多少分
console.log('=== 复现训练适应度 (train.js 用的种子 g*107+1..3) ===');
for (const g of [0, 1, 2, 44]) {
  const seeds = [g * 107 + 1, g * 107 + 2, g * 107 + 3];
  let tot = 0;
  for (const s of seeds) {
    const r = run(s, 1200, 'trained');
    const f = Math.max(1, r.frames + r.graze * 3.0 - r.penalty);
    tot += f;
    console.log(`  代${String(g).padStart(2)} 种子${s}: 存活${r.frames}帧 擦弹${r.graze}次 贴墙罚${r.penalty.toFixed(0)} -> 适应度 ${f.toFixed(1)}`);
  }
  console.log(`  -> 该代平均适应度 = ${(tot / 3).toFixed(1)}`);
}

console.log('\n=== 独立测试集 (种子 80001..80020, 上限1800帧) ===');
const modes = ['trained', 'silenced', 'randomW'];
for (const mode of modes) {
  let tf = 0, tg = 0, capped = 0;
  for (let i = 0; i < 20; i++) {
    const r = run(80001 + i, 1800, mode);
    tf += r.frames; tg += r.graze;
    if (r.frames >= 1800) capped++;
  }
  console.log(`  ${mode.padEnd(10)}: 平均存活 ${(tf / 20).toFixed(1)} 帧 (${(tf / 20 / 60).toFixed(2)}s) | 平均擦弹 ${(tg / 20).toFixed(1)} | 打满上限 ${capped}/20`);
}

console.log('\n=== 训练集 vs 测试集对比 (上限 1200) ===');
let trF = 0, trC = 0;
for (let i = 0; i < 20; i++) { const r = run(1 + i * 107, 1200, 'trained'); trF += r.frames; if (r.frames >= 1200) trC++; }
console.log(`  训练分布种子: 平均 ${(trF / 20).toFixed(1)} 帧 | 打满 ${trC}/20`);
