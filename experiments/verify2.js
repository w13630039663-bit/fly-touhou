/**
 * 独立验证：不信任 train.js 自报数字，用真实 DanmakuGame 亲自复现
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const { pathToFileURL } = await import('url');
const { DanmakuGame } = await import(pathToFileURL(path.join(ROOT, 'src/game/danmaku.js')).href);
const { MaleCNSConnectome } = await import(pathToFileURL(path.join(ROOT, 'src/brain/connectome.js')).href);
const { ReadoutPolicy, PARAMETERS } = await import(pathToFileURL(path.join(ROOT, 'src/brain/policy.js')).href);

const graphData = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8'));
const ckpt = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/checkpoint.json'), 'utf8'));

console.log('=== 0. 基础检查 ===');
console.log(`  声称参数数: ${ckpt.parameters}, 实际权重长度: ${ckpt.weights.length}, policy.PARAMETERS: ${PARAMETERS}`);
console.log(`  checkpoint 自报 bestFitness: ${ckpt.bestFitness}`);
console.log(`  checkpoint 自报 benchmark: trained ${ckpt.benchmark.trained.frames.toFixed(1)}帧`);

const brain = new MaleCNSConnectome(graphData);
const policy = new ReadoutPolicy(new Float64Array(ckpt.weights));

console.log('\n=== 1. 零偏置数学性质验证 ===');
{
  const zero = new Array(16).fill(0);
  const out = [];
  for (let t = 0; t < 3; t++) { const m = policy.forward(zero); out.push(`${m.moveX},${m.moveY}`); }
  console.log(`  输入全零 -> ${out.join(' | ')}`);
  console.log(`  ${out.every(o => o === '0,0') ? '✓ 严格恒等 (0,0)，零偏置保证成立' : '❌ 非零，零偏置未生效'}`);
}

console.log('\n=== 2. 消融是否与静止严格等价 ===');
{
  brain.reset();
  const dnT = brain.step(new Array(8).fill(0.5), false);
  const dnS = brain.step(new Array(8).fill(0.5), true);
  const mT = policy.forward(dnT), mS = policy.forward(dnS);
  console.log(`  正常 DN: [${Array.from(dnT).map(v=>v.toFixed(3)).join(',')}]`);
  console.log(`  静音 DN: [${Array.from(dnS).map(v=>v.toFixed(3)).join(',')}]`);
  console.log(`  正常策略输出: (${mT.moveX.toFixed(6)}, ${mT.moveY.toFixed(6)})`);
  console.log(`  静音策略输出: (${mS.moveX.toFixed(6)}, ${mS.moveY.toFixed(6)})`);
  console.log(`  ${mS.moveX===0&&mS.moveY===0 ? '✓ 静音严格等于 (0,0)' : '❌'}`);
}

console.log('\n=== 3. 复现 benchmark (20 个测试种子 80001-80020, 上限 1800) ===');
function runGame(seed, mode, maxFrames = 1800) {
  brain.reset();
  const game = new DanmakuGame(null, { width: 460, height: 580, seed });
  game.setSpellcard(seed % 3);
  game.player.lives = 1; game.player.maxLives = 1;
  game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
  let f = 0;
  while (!game.player.isDead && f < maxFrames) {
    let motor;
    if (mode === 'idle') motor = { moveX: 0, moveY: 0 };
    else if (mode === 'br') motor = { moveX: 1, moveY: 1 };
    else if (mode === 'bl') motor = { moveX: -1, moveY: 1 };
    else if (mode === 'randW') motor = randPolicy.forward(brain.step(game.getBiologicalSensoryInput(), false));
    else if (mode === 'silenced') motor = policy.forward(brain.step(game.getBiologicalSensoryInput(), true));
    else motor = policy.forward(brain.step(game.getBiologicalSensoryInput(), false));
    game.update(motor);
    f++;
  }
  return { frames: f, graze: game.player.graze, dead: game.player.isDead };
}

const randPolicy = new ReadoutPolicy();
for (let i = 0; i < PARAMETERS; i++) randPolicy.weights[i] = (Math.random() - 0.5) * 1.5;

const results = {};
for (const mode of ['trained', 'silenced', 'idle', 'br', 'bl', 'randW']) {
  let tf = 0, tg = 0, capped = 0;
  for (let i = 0; i < 20; i++) {
    const r = runGame(80001 + i, mode);
    tf += r.frames; tg += r.graze;
    if (r.frames >= 1800) capped++;
  }
  results[mode] = { frames: tf / 20, graze: tg / 20, capped };
}

const claimed = {
  trained: ckpt.benchmark.trained.frames,
  silenced: ckpt.benchmark.circuitSilenced.frames,
  idle: ckpt.benchmark.idle.frames,
  br: ckpt.benchmark.driftBottomRight.frames,
  bl: ckpt.benchmark.driftBottomLeft.frames,
  randW: ckpt.benchmark.randomPolicy.frames,
};
const names = { trained: '连接组+训练策略', silenced: '大脑静音消融', idle: '静止不动', br: '固定右下(1,1)', bl: '固定左下(-1,1)', randW: '随机权重' };
console.log('  模式              我复现值      自报值       偏差');
for (const mode of ['trained', 'silenced', 'idle', 'br', 'bl', 'randW']) {
  const mine = results[mode].frames, theirs = claimed[mode];
  const dev = Math.abs(mine - theirs);
  console.log(`  ${names[mode].padEnd(16)} ${mine.toFixed(1).padStart(7)}帧 ${theirs.toFixed(1).padStart(10)}帧  ${dev < 5 ? '✓' : '⚠ +-' + dev.toFixed(1)}`);
}

console.log('\n=== 4. 训练适应度是否仍饱和 (maxFrames=1200, train.js 用种子 g*79+11,23,37) ===');
for (const g of [0, 1, 5, 39]) {
  const seeds = [g * 79 + 11, g * 79 + 23, g * 79 + 37];
  let total = 0;
  const details = [];
  for (let s = 0; s < seeds.length; s++) {
    brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed: seeds[s] });
    game.setSpellcard(s % 3);
    game.player.lives = 1; game.player.maxLives = 1;
    game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
    let f = 0, wp = 0;
    while (!game.player.isDead && f < 1200) {
      const motor = policy.forward(brain.step(game.getBiologicalSensoryInput(), false));
      game.update(motor); f++;
      if (game.player.x < 32 || game.player.x > game.width - 32) wp += 0.25;
    }
    const fit = f + game.player.graze * 4.0 - wp;
    total += Math.max(1, fit);
    details.push(`${f}帧(擦${game.player.graze})->${fit.toFixed(1)}`);
  }
  console.log(`  代${String(g).padStart(2)}: ${details.join(' | ')}  => 均值 ${(total/3).toFixed(1)}`);
}

console.log('\n=== 5. 训练集 vs 测试集泛化差距 ===');
{
  let trainF = 0, testF = 0;
  const trainSeeds = [];
  for (let g = 0; g < 40; g++) trainSeeds.push(g*79+11, g*79+23, g*79+37);
  for (const s of trainSeeds) { const r = runGame(s, 'trained'); trainF += r.frames; }
  for (let i = 0; i < 20; i++) { const r = runGame(80001+i, 'trained'); testF += r.frames; }
  console.log(`  训练种子 (${trainSeeds.length}局): 平均 ${(trainF/trainSeeds.length).toFixed(1)} 帧`);
  console.log(`  测试种子 (20局): 平均 ${(testF/20).toFixed(1)} 帧`);
}
