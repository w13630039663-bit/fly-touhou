/**
 * bench_full.js - 用新训练出的 checkpoint.full.json 做独立复现
 * 严格独立: 不复用训练时的任何种子, 20 个全新测试种子
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const graphData = JSON.parse(readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8'));
const ckpt = JSON.parse(readFileSync(path.join(__dirname, 'checkpoint.full.json'), 'utf8'));
const brain = new MaleCNSConnectome(graphData);
const TEST_SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
const MAX = 1800;

function play(seed, policy, mode) {
  brain.reset();
  const game = new DanmakuGame(null, { width: 460, height: 580, seed });
  game.setSpellcard(seed % 3);
  game.player.lives = 1; game.player.maxLives = 1;
  game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
  let f = 0;
  while (!game.player.isDead && f < MAX) {
    let motor;
    if (mode === 'fixed') motor = policy;
    else if (mode === 'silent') motor = policy.forward(brain.step(game.getBiologicalSensoryInput(), true));
    else motor = policy.forward(brain.step(game.getBiologicalSensoryInput(), false));
    game.update(motor); f++;
  }
  return { frames: f, graze: game.player.graze };
}

function bench(mode, policy) {
  let tf = 0, tg = 0; const per = [];
  for (const s of TEST_SEEDS) { const r = play(s, policy, mode); tf += r.frames; tg += r.graze; per.push(r.frames); }
  return { frames: tf / TEST_SEEDS.length, graze: tg / TEST_SEEDS.length, per };
}

const trained = new ReadoutPolicy(new Float64Array(ckpt.weights));
const R = {};
R.trained = bench('brain', trained);
R.silenced = bench('silent', trained);
R.idle = bench('fixed', { moveX: 0, moveY: 0 });
R.br = bench('fixed', { moveX: 1, moveY: 1 });
R.bl = bench('fixed', { moveX: -1, moveY: 1 });

// 随机基线: 固定 5 个种子, 各跑一次
const rr = [];
for (const rs of [11, 22, 33, 44, 55]) {
  const rw = new Float64Array(PARAMETERS);
  let st = rs;
  const rnd = () => { st = (st * 1664525 + 1013904223) % 4294967296; return st / 4294967296; };
  for (let i = 0; i < PARAMETERS; i++) rw[i] = (rnd() - 0.5) * 0.8;
  rr.push(bench('brain', new ReadoutPolicy(rw)));
}
const randMean = rr.reduce((s, r) => s + r.frames, 0) / rr.length;

console.log('======== 独立复现基准 (20 种子 80001-80020, 上限 1800 帧) ========');
console.log(`连接组 + 训练策略   : ${R.trained.frames.toFixed(1)} 帧 (${(R.trained.frames/60).toFixed(2)}s) | 擦弹 ${R.trained.graze.toFixed(1)}`);
console.log(`大脑静音消融        : ${R.silenced.frames.toFixed(1)} 帧 (${(R.silenced.frames/60).toFixed(2)}s)`);
console.log(`静止不动            : ${R.idle.frames.toFixed(1)} 帧 (${(R.idle.frames/60).toFixed(2)}s)`);
console.log(`固定右下(1,1)       : ${R.br.frames.toFixed(1)} 帧 (${(R.br.frames/60).toFixed(2)}s)`);
console.log(`固定左下(-1,1)      : ${R.bl.frames.toFixed(1)} 帧 (${(R.bl.frames/60).toFixed(2)}s)`);
console.log(`随机权重(5次均值)   : ${randMean.toFixed(1)} 帧  [${rr.map(r=>r.frames.toFixed(0)).join(', ')}]`);
console.log('\n逐局 trained 帧数:', R.trained.per.join(', '));
console.log('\n对照: checkpoint 自报 trained =', ckpt.benchmark.trained.frames.toFixed(1), '帧');
console.log('      checkpoint 自报 bestFitness =', ckpt.bestFitness.toFixed(1));
