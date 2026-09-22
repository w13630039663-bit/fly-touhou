import { readFileSync } from 'fs';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const ROOT = 'D:/苍蝇';
const graphData = JSON.parse(readFileSync(ROOT + '/public/data/connectome/graph.json', 'utf8'));
const ckpt = JSON.parse(readFileSync(ROOT + '/public/data/checkpoint.json', 'utf8'));

const brain = new MaleCNSConnectome(graphData);
const MAX = 1800;
const testSeeds = Array.from({ length: 20 }, (_, i) => 80001 + i);

function newGame(s) {
  const g = new DanmakuGame(null, { width: 460, height: 580, seed: s });
  g.setSpellcard(s % 3);
  g.player.lives = 1; g.player.maxLives = 1;
  g.player.autoRespawn = false; g.player.invulnerableTimer = 0;
  return g;
}

// 1. trained
function runTrained(weights, useBrain) {
  const p = new ReadoutPolicy(weights);
  let frames = 0, graze = 0, wall = 0;
  for (const s of testSeeds) {
    brain.reset();
    const g = newGame(s);
    let f = 0;
    while (!g.player.isDead && f < MAX) {
      let motor;
      if (useBrain) {
        const obs = g.getBiologicalSensoryInput();
        const dn = brain.step(obs, false);
        motor = p.forward(dn);
      } else {
        motor = { moveX: 0, moveY: 0 };
      }
      g.update(motor);
      f++;
      if (g.player.x < 32 || g.player.x > g.width - 32) wall += 0.25;
    }
    frames += f; graze += g.player.graze;
  }
  return { frames: frames / testSeeds.length, graze: graze / testSeeds.length, wall: wall / testSeeds.length };
}

// 2. silenced
function runSilenced(weights) {
  const p = new ReadoutPolicy(weights);
  let frames = 0;
  for (const s of testSeeds) {
    brain.reset();
    const g = newGame(s);
    let f = 0;
    while (!g.player.isDead && f < MAX) {
      const obs = g.getBiologicalSensoryInput();
      const dn = brain.step(obs, true);
      g.update(p.forward(dn));
      f++;
    }
    frames += f;
  }
  return frames / testSeeds.length;
}

// 3. constant direction
function runConst(mx, my) {
  let frames = 0;
  for (const s of testSeeds) {
    const g = newGame(s);
    let f = 0;
    while (!g.player.isDead && f < MAX) { g.update({ moveX: mx, moveY: my }); f++; }
    frames += f;
  }
  return frames / testSeeds.length;
}

// 4. random weights
function runRandom(seedRng) {
  let st = seedRng;
  const rnd = () => { st = (st * 1664525 + 1013904223) % 4294967296; return st / 4294967296; };
  const w = new Float64Array(PARAMETERS);
  for (let i = 0; i < PARAMETERS; i++) w[i] = (rnd() - 0.5) * 1.5;
  const p = new ReadoutPolicy(w);
  let frames = 0;
  for (const s of testSeeds) {
    brain.reset();
    const g = newGame(s);
    let f = 0;
    while (!g.player.isDead && f < MAX) {
      const obs = g.getBiologicalSensoryInput();
      const dn = brain.step(obs, false);
      g.update(p.forward(dn));
      f++;
    }
    frames += f;
  }
  return frames / testSeeds.length;
}

const W = new Float64Array(ckpt.weights);
console.log('=== 当前项目 checkpoint (已更新) ===');
console.log('bestFitness:', ckpt.bestFitness, ' version:', ckpt.version);
console.log('自报 benchmark trained:', ckpt.benchmark.trained.frames, '帧');

console.log('\n=== 我的独立复现 (20 种子 80001-80020, 上限 1800 帧) ===');
const t0 = Date.now();
const trained = runTrained(W, true);
console.log(`[1] 连接组+训练策略   : ${trained.frames.toFixed(1)} 帧 (${(trained.frames/60).toFixed(2)}s) | 擦弹 ${trained.graze.toFixed(1)} | 贴墙罚 ${trained.wall.toFixed(1)}`);
const silenced = runSilenced(W);
console.log(`[2] 大脑静音消融      : ${silenced.toFixed(1)} 帧 (${(silenced/60).toFixed(2)}s)`);
const idle = runConst(0, 0);
console.log(`[3] 静止不动          : ${idle.toFixed(1)} 帧 (${(idle/60).toFixed(2)}s)`);
const br = runConst(1, 1);
console.log(`[4] 固定右下(1,1)     : ${br.toFixed(1)} 帧 (${(br/60).toFixed(2)}s)`);
const bl = runConst(-1, 1);
console.log(`[5] 固定左下(-1,1)    : ${bl.toFixed(1)} 帧 (${(bl/60).toFixed(2)}s)`);

console.log('\n--- 随机权重基线 (不同种子各跑一次, 看方差) ---');
for (const sd of [11, 22, 33, 44, 55]) {
  const r = runRandom(sd);
  console.log(`  随机seed=${sd}: ${r.toFixed(1)} 帧 (${(r/60).toFixed(2)}s)`);
}
console.log(`\n总耗时: ${((Date.now()-t0)/1000).toFixed(1)}s`);
