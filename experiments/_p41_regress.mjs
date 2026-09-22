/**
 * _p41_regress.mjs —— P4-1 改动的回归门自检
 *
 * 逐个验证：
 *   C1 eWeight 与 eWeightBase 已脱开引用，但数值一致
 *   C2 applyDnGains(1,1) 不再让 eWeight 与 eWeightBase 共享引用
 *   C3 开启 Hebbian 后 eWeight 漂移，而 eWeightBase（生物原件）**分毫不动**
 *   C4 restoreBioWeights() 能把权重精确还原（漂移 = 0）
 *   C5 默认关闭时，A 臂 20 测试种子的存活帧数与改动前逐位一致（回归门）
 *
 * 用法: node experiments/_p41_regress.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const graphData = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8'));
const ckpt = JSON.parse(fs.readFileSync(path.join(__dirname, 'checkpoint_ab3_v1.json'), 'utf8'));
const W_READOUT = new Float64Array(ckpt.weights);
const EXPECTED = ckpt.testTrained;          // 1369.55，由改动前的代码产出

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? '  ' + detail : ''}`);
  ok ? pass++ : fail++;
}

console.log('='.repeat(78));
console.log('P4-1 回归门自检');
console.log('='.repeat(78));

// ---- C1: 引用脱开 + 数值一致 ----
console.log('\n[C1] eWeight 与 eWeightBase 引用关系');
const b1 = new MaleCNSConnectome(graphData);
check('eWeight !== eWeightBase（已脱开别名）', b1.eWeight !== b1.eWeightBase);
let same = true;
for (let i = 0; i < b1.eWeight.length; i++) if (b1.eWeight[i] !== b1.eWeightBase[i]) { same = false; break; }
check('eWeight[i] === eWeightBase[i] 全等（未被改动）', same, `${b1.eWeight.length} 边`);

// ---- C2: applyDnGains(1,1) 不再共享引用 ----
console.log('\n[C2] applyDnGains(1,1) 不再共享引用');
b1.applyDnGains(1, 1);
check('applyDnGains(1,1) 后 eWeight !== eWeightBase', b1.eWeight !== b1.eWeightBase);
let same2 = true;
for (let i = 0; i < b1.eWeight.length; i++) if (b1.eWeight[i] !== b1.eWeightBase[i]) { same2 = false; break; }
check('applyDnGains(1,1) 数值仍等于基准', same2);

// ---- C3/C4: Hebbian 漂移 + 精确还原 ----
console.log('\n[C3/C4] Hebbian 漂移与 restoreBioWeights 精确还原');
const b2 = new MaleCNSConnectome(graphData);
const BIO = Float64Array.from(b2.eWeightBase);   // 独立快照
b2.setPlasticity({ eta: 1e-4, decay: 0.01, renorm: true });
check('setPlasticity 后 enabled=true', b2.plasticity.enabled === true);

const policy = new ReadoutPolicy(W_READOUT);
const game = new DanmakuGame(null, { width: 460, height: 580, seed: 80001, sensoryMode: 'v1' });
game.setSpellcard(80001 % 3);
game.player.lives = 1; game.player.maxLives = 1;
game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
for (let f = 0; f < 600; f++) {
  const obs = game.getBiologicalSensoryInput();
  const dn = b2.step(obs, false);
  game.update(policy.forward(dn));
}
const driftAfter = b2.measureDrift();
check('600 帧后漂移 > 0（可塑性确实在改 W）', driftAfter > 0, `drift = ${driftAfter.toFixed(4)}`);

let bioIntact = true;
for (let i = 0; i < BIO.length; i++) {
  if (b2.eWeightBase[i] !== BIO[i]) { bioIntact = false; break; }
}
check('生物原件 eWeightBase 分毫未动', bioIntact);

b2.restoreBioWeights();
let restored = b2.eWeight.length === BIO.length;
if (restored) for (let i = 0; i < BIO.length; i++) if (b2.eWeight[i] !== BIO[i]) { restored = false; break; }
check('restoreBioWeights() 逐位精确还原', restored, `drift = ${b2.measureDrift()}`);
check('还原后漂移严格为 0', b2.measureDrift() === 0);

// restore 之后再加一次可塑性，确认没有残留状态
b2.setPlasticity({ eta: 1e-4, decay: 0.01, renorm: true });
const g2 = new DanmakuGame(null, { width: 460, height: 580, seed: 80001, sensoryMode: 'v1' });
g2.setSpellcard(80001 % 3); g2.player.lives = 1; g2.player.maxLives = 1;
g2.player.autoRespawn = false; g2.player.invulnerableTimer = 0;
for (let f = 0; f < 300; f++) {
  g2.update(policy.forward(b2.step(g2.getBiologicalSensoryInput(), false)));
}
check('还原后可再次累积漂移（无残留状态）', b2.measureDrift() > 0, `drift = ${b2.measureDrift().toFixed(4)}`);
b2.setPlasticity({ eta: 0 });
check('setPlasticity(eta=0) 关闭可塑性', b2.plasticity.enabled === false);

// ---- C5: 默认关闭时 A 臂成绩逐位复现 ----
console.log('\n[C5] 默认关闭 ⇒ A 臂 20 测试种子逐位复现（回归门）');
const brain = new MaleCNSConnectome(graphData);
// 故意不调用 setPlasticity，走默认路径
const TEST_SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
function rolloutFrames(seed) {
  const pol = new ReadoutPolicy(W_READOUT);
  brain.reset();
  const g = new DanmakuGame(null, { width: 460, height: 580, seed, sensoryMode: 'v1' });
  g.setSpellcard(seed % 3);
  g.player.lives = 1; g.player.maxLives = 1;
  g.player.autoRespawn = false; g.player.invulnerableTimer = 0;
  let frames = 0;
  while (!g.player.isDead && frames < 1800) {
    g.update(pol.forward(brain.step(g.getBiologicalSensoryInput(), false)));
    frames++;
  }
  return frames;
}
const mine = TEST_SEEDS.map(rolloutFrames);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const delta = mean(mine) - EXPECTED;
const perSeedMatch = mine.every((v, i) => v === ckpt.testPerSeed[i]);
check(`20 种子均值 = ${mean(mine).toFixed(2)}（改动前 ${EXPECTED.toFixed(2)}）`, Math.abs(delta) < 1e-9, `Δ = ${delta.toFixed(6)}`);
check('逐种子成绩全部逐位相同', perSeedMatch);
check('漂移恒为 0（W 未被触碰）', brain.measureDrift() === 0);

console.log(`\n${'='.repeat(78)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(78));
process.exit(fail ? 1 : 0);
