/**
 * tools/scale_why.mjs — 「为什么 600 反而不如 80」取证脚本
 *  1) v1-80 trained vs v600 trained：同 20 测试种子的配对 bootstrap + 胜率
 *  2) 信号剖析：两脑在游戏中的 DN 读出信号幅度/方差、神经元活跃率
 * 运行: node tools/scale_why.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';
import { evaluateOnTestSeeds } from '../train.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
const loadJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

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
  if (d === 0) return { diff: 0, p: 1, wins: 0 };
  let hits = 0, wins = 0;
  for (let i = 0; i < n; i++) if (x[i] - y[i] > 0) wins++;
  for (let b = 0; b < B; b++) {
    let a = 0, c = 0;
    for (let i = 0; i < n; i++) { const j = Math.floor(rng() * n); a += x[j]; c += y[j]; }
    const dd = (a - c) / n;
    if (Math.sign(dd) !== Math.sign(d)) hits++;
  }
  return { diff: d, p: Math.max(2 / B, (hits / B) * 2), wins };
}

// 单脑剖析：存活帧 + DN 信号统计 + 网络活跃率
function profile(graphPath, ckPath, seed) {
  const graph = loadJson(graphPath), ck = loadJson(ckPath);
  const brain = new MaleCNSConnectome(graph);
  const policy = new ReadoutPolicy(new Float64Array(ck.weights));
  brain.reset();
  const game = new DanmakuGame(null, { width: 460, height: 580, seed });
  game.setSpellcard(seed % 3);
  game.player.lives = 1; game.player.maxLives = 1; game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
  let f = 0; const dnRms = [], dnStd = [], active = [];
  while (!game.player.isDead && f < 1800) {
    const obs = game.getBiologicalSensoryInput();
    const dn = brain.step(obs, false);
    let s = 0; for (const v of dn) s += v * v;
    dnRms.push(Math.sqrt(s / dn.length));
    const mu = dn.reduce((a, v) => a + v, 0) / dn.length;
    dnStd.push(Math.sqrt(dn.reduce((a, v) => a + (v - mu) ** 2, 0) / dn.length));
    let a = 0; for (const nd of brain.nodes) if (nd.spiked) a++;
    active.push(a / brain.nodes.length);
    game.update(policy.forward(dn));
    f++;
  }
  const mean = (xs) => xs.reduce((p, q) => p + q, 0) / Math.max(1, xs.length);
  return { frames: f, dnRms: mean(dnRms), dnStd: mean(dnStd), active: mean(active) };
}

const v1 = loadJson('public/data/checkpoint.json'), v2 = loadJson('public/data/checkpoint600.json');
const brain1 = new MaleCNSConnectome(loadJson('public/data/connectome/graph.json'));
const brain2 = new MaleCNSConnectome(loadJson('public/data/connectome/graph600.json'));
const e1 = evaluateOnTestSeeds(TEST_SEEDS, brain1, new Float64Array(v1.weights), 'normal');
const e2 = evaluateOnTestSeeds(TEST_SEEDS, brain2, new Float64Array(v2.weights), 'normal');
const cmp = twoSidedPairedBootstrap(e1.perSeedFrames, e2.perSeedFrames);

const pr1 = TEST_SEEDS.map((s) => profile('public/data/connectome/graph.json', 'public/data/checkpoint.json', s));
const pr2 = TEST_SEEDS.map((s) => profile('public/data/connectome/graph600.json', 'public/data/checkpoint600.json', s));
const mean = (xs) => xs.reduce((p, q) => p + q, 0) / xs.length;
const fmt = (pr) => ({ dnRms: +mean(pr.map((x) => x.dnRms)).toFixed(3), dnStd: +mean(pr.map((x) => x.dnStd)).toFixed(3), activePct: (100 * mean(pr.map((x) => x.active))).toFixed(1) + '%' });

console.log('配对比较 (v1-80 trained vs v600 trained, 20 seeds):');
console.log(`  均值差 = ${cmp.diff.toFixed(1)} f   双侧 p = ${cmp.p.toFixed(4)}   80 胜出 ${cmp.wins}/20`);
console.log(`  逐种子波动: v1 sd=${Math.round(std(e1.perSeedFrames))}  v600 sd=${Math.round(std(e2.perSeedFrames))}  (f)`);
console.log('DN 读出信号剖析 (16 个运动输出的平均活动):');
console.log(`  v1-80 : ${JSON.stringify(fmt(pr1))}`);
console.log(`  v600  : ${JSON.stringify(fmt(pr2))}`);

function std(xs) { const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); }
