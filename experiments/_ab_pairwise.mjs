// 配对分析：同种子逐局比较 A/B + 口径本身的中性效应
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const load = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const A = load('checkpoint_ab_v1.json');
const B = load('checkpoint_ab_wide.json');

const graphs = {
  v1: JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8')),
  wide: JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph32ch.json'), 'utf8')),
};
const brains = { v1: new MaleCNSConnectome(graphs.v1), wide: new MaleCNSConnectome(graphs.wide) };

const SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
const CAP = 1800;

function runOne(mode, weights, seed) {
  const brain = brains[mode];
  const policy = new ReadoutPolicy(new Float64Array(weights));
  brain.reset();
  const game = new DanmakuGame(null, { width: 460, height: 580, seed, sensoryMode: mode });
  game.setSpellcard(seed % 3);
  game.player.lives = 1; game.player.maxLives = 1;
  game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
  let f = 0;
  while (!game.player.isDead && f < CAP) {
    game.update(policy.forward(brain.step(game.getBiologicalSensoryInput(), false)));
    f++;
  }
  return f;
}

// ---- 1. 配对比较：同种子 A(v1 感知) vs B(wide 感知) ----
const rows = [];
for (const seed of SEEDS) {
  const fa = runOne('v1', A.weights, seed);
  const fb = runOne('wide', B.weights, seed);
  rows.push({ seed, a: fa, b: fb, d: fb - fa });
}
const mean = k => rows.reduce((s, r) => s + r[k], 0) / rows.length;
const median = arr => { const s = [...arr].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

console.log('='.repeat(70));
console.log('  配对比较 (20 个独立测试种子, 上限 1800 帧)');
console.log('='.repeat(70));
console.log('  种子      A:8通道   B:32通道    B-A');
for (const r of rows) {
  const tie = r.a >= CAP && r.b >= CAP;
  console.log(`  ${r.seed}   ${String(r.a).padStart(7)}   ${String(r.b).padStart(7)}   ${(r.d >= 0 ? '+' : '') + r.d}${tie ? '  (双方触顶)' : ''}`);
}
const wins = rows.filter(r => r.b > r.a).length;
const losses = rows.filter(r => r.b < r.a).length;
const ties = rows.filter(r => r.b === r.a).length;
console.log(`\n  A 均值 ${mean('a').toFixed(1)} 帧 | B 均值 ${mean('b').toFixed(1)} 帧`);
console.log(`  配对差异均值 ${mean('d') >= 0 ? '+' : ''}${mean('d').toFixed(1)} 帧 (${(mean('d') / mean('a') * 100).toFixed(1)}%) | 中位数 ${median(rows.map(r => r.d)) >= 0 ? '+' : ''}${median(rows.map(r => r.d)).toFixed(1)} 帧`);
console.log(`  B 胜 ${wins} / A 胜 ${losses} / 平 ${ties}`);

// ---- 2. 口径本身的中性效应：同一组随机权重，两种感知 ----
console.log('\n' + '='.repeat(70));
console.log('  口径本身的中性效应 (同一组固定随机权重，仅换感知口径)');
console.log('='.repeat(70));
let sw = 12345;
const rnd = () => { sw = (sw * 1664525 + 1013904223) % 4294967296; return sw / 4294967296; };
for (let trial = 0; trial < 3; trial++) {
  const w = new Float64Array(PARAMETERS);
  for (let i = 0; i < PARAMETERS; i++) w[i] = (rnd() - 0.5) * 0.8;
  let sa = 0, sb = 0;
  for (const seed of SEEDS) { sa += runOne('v1', w, seed); sb += runOne('wide', w, seed); }
  sa /= SEEDS.length; sb /= SEEDS.length;
  console.log(`  随机权重 #${trial + 1}: v1 口径 ${sa.toFixed(1)} 帧  vs  wide 口径 ${sb.toFixed(1)} 帧   (${((sb - sa) / sa * 100).toFixed(1)}%)`);
}

// ---- 3. 交叉检验：A 的权重放到 wide 口径上 ----
console.log('\n' + '='.repeat(70));
console.log('  交叉检验：把 A 训练出的权重直接喂给 wide 口径 (读出层与感知无关)');
console.log('='.repeat(70));
let crossA = 0;
for (const seed of SEEDS) crossA += runOne('wide', A.weights, seed);
crossA /= SEEDS.length;
console.log(`  A 权重 + v1 口径   : ${mean('a').toFixed(1)} 帧`);
console.log(`  A 权重 + wide 口径 : ${crossA.toFixed(1)} 帧`);
console.log(`  B 权重 + wide 口径 : ${mean('b').toFixed(1)} 帧`);
console.log(`  B 权重 + v1 口径   : ${(SEEDS.reduce((s, sd) => s + runOne('v1', B.weights, sd), 0) / SEEDS.length).toFixed(1)} 帧`);
