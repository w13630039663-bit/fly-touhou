/**
 * 深挖：正常模式下 DN 输出是否常年为 0？
 * 若如此，则"零偏置"虽然修好了消融对照，但也意味着策略大部分时间在"输出 0"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const { DanmakuGame } = await import(pathToFileURL(path.join(ROOT, 'src/game/danmaku.js')).href);
const { MaleCNSConnectome } = await import(pathToFileURL(path.join(ROOT, 'src/brain/connectome.js')).href);
const { ReadoutPolicy, PARAMETERS } = await import(pathToFileURL(path.join(ROOT, 'src/brain/policy.js')).href);

const graphData = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8'));
const ckpt = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/checkpoint.json'), 'utf8'));
const brain = new MaleCNSConnectome(graphData);
const policy = new ReadoutPolicy(new Float64Array(ckpt.weights));

console.log('=== A. 正常游戏中 DN 输出的幅度分布 ===');
{
  brain.reset();
  const game = new DanmakuGame(null, { width: 460, height: 580, seed: 80001 });
  game.setSpellcard(0);
  game.player.lives = 1; game.player.maxLives = 1;
  game.player.autoRespawn = false; game.player.invulnerableTimer = 0;

  let maxAbsDn = 0, nonzeroDnFrames = 0, frames = 0;
  let maxAbsAct = 0, nonzeroNeurons = 0, maxNeuronAbs = 0;
  const samples = [];
  while (!game.player.isDead && frames < 900) {
    const obs = game.getBiologicalSensoryInput();
    const dn = brain.step(obs, false);
    let dnPeak = 0;
    for (const v of dn) dnPeak = Math.max(dnPeak, Math.abs(v));
    if (dnPeak > 1e-9) nonzeroDnFrames++;
    maxAbsDn = Math.max(maxAbsDn, dnPeak);

    let actPeak = 0, nz = 0;
    for (let i = 0; i < brain.count; i++) { const a = Math.abs(brain.activity[i]); if (a > 1e-6) nz++; actPeak = Math.max(actPeak, a); }
    maxAbsAct = Math.max(maxAbsAct, actPeak);
    nonzeroNeurons += nz;
    maxNeuronAbs = Math.max(maxNeuronAbs, actPeak);

    if (frames % 150 === 0) {
      const m = policy.forward(dn);
      samples.push(`f${frames}: obs峰值=${Math.max(...obs.slice(0,8)).toFixed(3)} DN峰值=${dnPeak.toFixed(5)} 活动神经元=${nz}/80 动作=(${m.moveX.toFixed(3)},${m.moveY.toFixed(3)})`);
    }
    game.update(policy.forward(dn));
    frames++;
  }
  console.log(`  总帧数: ${frames}`);
  console.log(`  DN 峰值最大绝对值: ${maxAbsDn.toFixed(8)}`);
  console.log(`  DN 有非零输出的帧: ${nonzeroDnFrames}/${frames} (${(nonzeroDnFrames/frames*100).toFixed(1)}%)`);
  console.log(`  网络活动峰值: ${maxAbsAct.toFixed(8)}`);
  console.log(`  平均活动神经元数: ${(nonzeroNeurons/frames).toFixed(2)}/80`);
  console.log('  采样:');
  for (const s of samples) console.log(`    ${s}`);
}

console.log('\n=== B. 观测通道的实际取值范围与变化 ===');
{
  brain.reset();
  const game = new DanmakuGame(null, { width: 460, height: 580, seed: 80001 });
  game.setSpellcard(0);
  game.player.lives = 1; game.player.maxLives = 1;
  game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
  const mins = new Array(8).fill(9), maxs = new Array(8).fill(-9), sums = new Array(8).fill(0);
  let f = 0;
  while (!game.player.isDead && f < 900) {
    const obs = game.getBiologicalSensoryInput();
    for (let i = 0; i < 8; i++) { mins[i] = Math.min(mins[i], obs[i]); maxs[i] = Math.max(maxs[i], obs[i]); sums[i] += obs[i]; }
    game.update(policy.forward(brain.step(obs, false)));
    f++;
  }
  const names = ['LC4前方','LC11左','LC9右','LC15后','LC16水平光流','LC17垂直光流','LC21边缘','LPLC2纵向'];
  for (let i = 0; i < 8; i++) {
    console.log(`  Ch${i} ${names[i].padEnd(12)}: [${mins[i].toFixed(3)}, ${maxs[i].toFixed(3)}] 均值 ${(sums[i]/f).toFixed(3)}`);
  }
}

console.log('\n=== C. 策略权重的量级分布 ===');
{
  const w = new Float64Array(ckpt.weights);
  let l1 = 0, l2 = 0, mx = 0;
  for (const v of w) { l1 += Math.abs(v); l2 += v*v; mx = Math.max(mx, Math.abs(v)); }
  console.log(`  L1范数=${l1.toFixed(2)} L2范数=${Math.sqrt(l2).toFixed(2)} 最大绝对权重=${mx.toFixed(3)}`);
  const layer1 = w.slice(0, 256), layer2 = w.slice(256);
  console.log(`  第一层(16x16) 均值绝对值 ${(layer1.reduce((a,b)=>a+Math.abs(b),0)/256).toFixed(4)}`);
  console.log(`  第二层(16x4)  均值绝对值 ${(layer2.reduce((a,b)=>a+Math.abs(b),0)/64).toFixed(4)}`);
}

console.log('\n=== D. 多随机种子重复随机权重基线 (检验上次的偏差来源) ===');
{
  const trials = [];
  for (let trial = 0; trial < 5; trial++) {
    const rp = new ReadoutPolicy();
    for (let i = 0; i < PARAMETERS; i++) rp.weights[i] = (Math.random() - 0.5) * 1.5;
    let tf = 0;
    for (let i = 0; i < 20; i++) {
      brain.reset();
      const game = new DanmakuGame(null, { width: 460, height: 580, seed: 80001 + i });
      game.setSpellcard(i % 3);
      game.player.lives = 1; game.player.maxLives = 1;
      game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
      let f = 0;
      while (!game.player.isDead && f < 1800) { game.update(rp.forward(brain.step(game.getBiologicalSensoryInput(), false))); f++; }
      tf += f;
    }
    trials.push(tf / 20);
  }
  console.log(`  5 次随机权重基线: ${trials.map(v=>v.toFixed(1)).join(', ')}`);
  console.log(`  均值 ${(trials.reduce((a,b)=>a+b,0)/5).toFixed(1)} 帧 | checkpoint 自报 ${ckpt.benchmark.randomPolicy.frames.toFixed(1)} 帧`);
}
