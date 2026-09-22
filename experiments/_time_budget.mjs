// 训练/改造工时基准：实测单局评估耗时 → 推算重训总时长
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function benchGraph(file, label) {
  const g = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const brain = new MaleCNSConnectome(g);
  const w = new Float64Array(PARAMETERS);
  for (let i = 0; i < PARAMETERS; i++) w[i] = Math.sin(i * 0.37) * 0.4;
  const policy = new ReadoutPolicy(w);

  const MAXF = 1200;
  const N = 12;
  let frames = 0;
  let tSensory = 0, tBrain = 0, tPolicy = 0, tUpdate = 0;
  const t0 = performance.now();
  for (let s = 0; s < N; s++) {
    const seed = 11 + s * 12;
    brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed });
    game.setSpellcard((seed + s) % 3);
    game.player.lives = 1; game.player.maxLives = 1;
    game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
    let f = 0;
    while (!game.player.isDead && f < MAXF) {
      let t = performance.now();
      const obs = game.getBiologicalSensoryInput();
      tSensory += performance.now() - t;
      t = performance.now();
      const dn = brain.step(obs, false);
      tBrain += performance.now() - t;
      t = performance.now();
      const motor = policy.forward(dn);
      tPolicy += performance.now() - t;
      t = performance.now();
      game.update(motor);
      tUpdate += performance.now() - t;
      f++;
    }
    frames += f;
  }
  const total = performance.now() - t0;
  const perRun = total / N;
  const perFrame = total / frames;
  console.log(`\n=== ${label} (${g.nodes.length} 节点 / ${g.edges.length} 边) ===`);
  console.log(`  ${N} 局 / ${frames} 帧, 总耗时 ${total.toFixed(0)} ms`);
  console.log(`  单局 ${perRun.toFixed(1)} ms | 单帧 ${perFrame.toFixed(3)} ms`);
  const sh = {
    sensory: tSensory / total * 100,
    brain: tBrain / total * 100,
    policy: tPolicy / total * 100,
    physics: tUpdate / total * 100,
  };
  console.log(`  占比: 感知 ${sh.sensory.toFixed(1)}% | 脑动力学 ${sh.brain.toFixed(1)}% | 读出 ${sh.policy.toFixed(1)}% | 物理 ${sh.physics.toFixed(1)}%`);
  return { perRun, perFrame, sh };
}

const GEN = 100, POP = 64, SEEDS = 12;
const runs = GEN * POP * SEEDS;
console.log(`train_full.js 规模: ${GEN} 代 x ${POP} 候选 x ${SEEDS} 种子 = ${runs.toLocaleString()} 局`);
console.log(`CPU: ${process.env.NUMBER_OF_PROCESSORS ?? '?'} 逻辑核`);

const b80 = benchGraph('public/data/connectome/graph.json', 'v1 80 节点');
const b600 = benchGraph('public/data/connectome/graph600a.json', 'v600a 600 节点');

console.log('\n---------- 重训总时长推算 (单线程纯评估) ----------');
for (const [name, b] of [['80 节点', b80], ['600a 节点', b600]]) {
  const sec = runs * b.perRun / 1000;
  console.log(`  ${name}: ${(sec / 3600).toFixed(2)} h  (单局 ${b.perRun.toFixed(1)} ms x ${runs.toLocaleString()} 局)`);
}

// P1: 读出层 16->64 的参数放大对 forward 的额外成本
console.log('\n---------- P1 放大读出层的额外开销 ----------');
const dn = new Float64Array(16);
const pol = new ReadoutPolicy(null);
const T = 200000;
let t = performance.now();
for (let i = 0; i < T; i++) pol.forward(dn);
const cur = performance.now() - t;
// 模拟 16->64 版本: 16*64 + 64*4 = 1280 乘加 vs 320
console.log(`  当前 320 参数: ${(cur / T * 1000).toFixed(3)} us/次`);
console.log(`  放大到 1280 参数 (16->64): 约 ${(cur / T * 1000 * 1280 / 320).toFixed(3)} us/次 (线性估)`);
console.log(`  单帧占比参考: 读出占 ${b80.sh.policy.toFixed(1)}% / ${b600.sh.policy.toFixed(1)}% -> 增量可忽略`);
