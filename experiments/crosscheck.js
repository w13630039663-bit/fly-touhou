import { readFileSync } from 'fs';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const ROOT = 'D:/苍蝇';
const graphData = JSON.parse(readFileSync(ROOT + '/public/data/connectome/graph.json', 'utf8'));
const ckpt = JSON.parse(readFileSync(ROOT + '/public/data/checkpoint.json', 'utf8'));
const brain = new MaleCNSConnectome(graphData);
const MAX = 1800;
const seeds = [80001, 80002, 80003, 80004, 80005];

function newGame(s) {
  const g = new DanmakuGame(null, { width: 460, height: 580, seed: s });
  g.setSpellcard(s % 3);
  g.player.lives = 1; g.player.maxLives = 1;
  g.player.autoRespawn = false; g.player.invulnerableTimer = 0;
  return g;
}

// 逐局打印, 看是否与自报一致
console.log('=== 当前 checkpoint 权重逐局结果 (前5个测试种子) ===');
const W = new Float64Array(ckpt.weights);
const p = new ReadoutPolicy(W);
for (const s of seeds) {
  brain.reset();
  const g = newGame(s);
  let f = 0;
  while (!g.player.isDead && f < MAX) {
    const obs = g.getBiologicalSensoryInput();
    const dn = brain.step(obs, false);
    g.update(p.forward(dn));
    f++;
  }
  console.log(`seed ${s} (符卡${s%3}): ${f} 帧 ${f>=MAX?'(打满)':'(死亡)'}`);
}

// 检查权重统计: 是否像训练收敛的? 还是像随机的?
let mn = Infinity, mx = -Infinity, sum = 0, sum2 = 0;
for (const w of W) { mn = Math.min(mn, w); mx = Math.max(mx, w); sum += w; sum2 += w*w; }
const mean = sum / W.length;
const std = Math.sqrt(sum2 / W.length - mean*mean);
console.log(`\n权重统计: min=${mn.toFixed(4)} max=${mx.toFixed(4)} mean=${mean.toFixed(4)} std=${std.toFixed(4)}`);

// 检查 checkpoint 里 benchmark 是否与 weights 时间戳自洽
console.log('\ntrainedAt:', ckpt.trainedAt);
console.log('checkpoint 文件里的自报 trained:', ckpt.benchmark.trained.frames);

// 额外: 用自报 benchmark 反推 —— 若真跑出 809.75, 我用同样的键应该能复现
console.log('\n=== 用 checkpoint 的 weights 完整跑 20 种子 ===');
const seeds20 = Array.from({length:20},(_,i)=>80001+i);
let tot=0;
for (const s of seeds20) {
  brain.reset();
  const g = newGame(s);
  let f=0;
  while(!g.player.isDead && f<MAX){ const o=g.getBiologicalSensoryInput(); const d=brain.step(o,false); g.update(p.forward(d)); f++; }
  tot+=f;
}
console.log('20种子平均:', (tot/20).toFixed(2), '帧');

// === 关键交叉检查: 把 checkpoint 的 T0 帧数作为参考, 检查物理是否变了 ===
console.log('\n=== 检查: 训练时的物理参数 vs 现在 ===');
console.log('danmaku.js 里是否仍有 speed 5.0 / 460x580?');
const dmk = readFileSync(ROOT + '/src/game/danmaku.js', 'utf8');
const hasSpeed = dmk.match(/speed\s*[:=]\s*([\d.]+)/g);
console.log('speed 出现:', hasSpeed ? hasSpeed.slice(0,6).join(' | ') : '未找到');
const hasSize = dmk.match(/width:\s*(\d+)[\s\S]{0,30}height:\s*(\d+)/);
console.log('默认尺寸:', hasSize ? hasSize[1]+'x'+hasSize[2] : '未找到');

// 检查 graze 奖励是否参与 (自报 graze 11.3)
console.log('\n=== 检查 fitness 计算一致性 ===');
console.log('train.js 里 evaluateCandidate: fitness = frames + graze*4.0 - wallPenalty');
console.log('自报 bestFitness = 669.75');
console.log('自报带符卡测试 trained frames = 809.75 (训练用的是 3 种子 x 1200 上限)');
console.log('→ 若 benchmark 的 809.75 出自 beta 版物理, 现在物理已变, 数字失效');
