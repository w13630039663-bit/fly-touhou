import { readFileSync } from 'fs';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome, createMatchedControlGraph } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';

const ROOT = 'D:/苍蝇';
const graphData = JSON.parse(readFileSync(ROOT + '/public/data/connectome/graph.json', 'utf8'));
const ckpt = JSON.parse(readFileSync(ROOT + '/public/data/checkpoint.json', 'utf8'));

// 用多组不同测试种子, 看 +3.7% 是否稳定
const bioBrain = new MaleCNSConnectome(graphData);
const ctrlBrain = new MaleCNSConnectome(createMatchedControlGraph(graphData, 42));
const bioPolicy = new ReadoutPolicy(new Float64Array(ckpt.weights));
const ctrlPolicy = new ReadoutPolicy(new Float64Array(ckpt.controlWeights));

function runSeeds(seeds, brain, policy) {
  let tf = 0; const per = [];
  for (const s of seeds) {
    brain.reset();
    const g = new DanmakuGame(null, { width: 460, height: 580, seed: s });
    g.setSpellcard(s % 3);
    g.player.lives = 1; g.player.maxLives = 1;
    g.player.autoRespawn = false; g.player.invulnerableTimer = 0;
    let f = 0;
    while (!g.player.isDead && f < 1800) { g.update(policy.forward(brain.step(g.getBiologicalSensoryInput(), false))); f++; }
    tf += f; per.push(f);
  }
  return { avg: tf / seeds.length, per };
}

// 三组独立测试种子 (每组 20)
const sets = [
  Array.from({length:20},(_,i)=>80001+i),
  Array.from({length:20},(_,i)=>90001+i),
  Array.from({length:20},(_,i)=>70001+i),
];
console.log('=== 多组测试种子的拓扑优势稳定性 ===');
for (let i = 0; i < sets.length; i++) {
  const b = runSeeds(sets[i], bioBrain, bioPolicy);
  const c = runSeeds(sets[i], ctrlBrain, ctrlPolicy);
  const g = (b.avg - c.avg) / c.avg * 100;
  console.log(`组${i+1} (起点${sets[i][0]}): 生物 ${b.avg.toFixed(1)} vs 重连 ${c.avg.toFixed(1)} → 优势 ${g>=0?'+':''}${g.toFixed(2)}%`);
}

// 用全部 60 个种子做配对检验
const allBio = [], allCtrl = [];
for (const set of sets) {
  const b = runSeeds(set, bioBrain, bioPolicy);
  const c = runSeeds(set, ctrlBrain, ctrlPolicy);
  allBio.push(...b.per); allCtrl.push(...c.per);
}
const n = allBio.length;
let diffSum = 0, diffSq = 0;
for (let i = 0; i < n; i++) { const d = allBio[i] - allCtrl[i]; diffSum += d; diffSq += d*d; }
const meanDiff = diffSum / n;
const sdDiff = Math.sqrt((diffSq - n*meanDiff*meanDiff)/(n-1));
const se = sdDiff / Math.sqrt(n);
const t = meanDiff / se;
console.log(`\n=== 配对样本检验 (n=${n} 对) ===`);
console.log(`平均差异: ${meanDiff.toFixed(1)} 帧 (生物 - 重连)`);
console.log(`标准差: ${sdDiff.toFixed(1)}  标准误: ${se.toFixed(1)}`);
console.log(`t 统计量: ${t.toFixed(3)}`);
console.log(`近似 p 值: ${(2*(1-normCdf(Math.abs(t)))).toFixed(4)}  (>0.05 即不显著)`);
function normCdf(x){ // Abramowitz-Stegun
  const b=[0.319381530,-0.356563782,1.781477937,-1.821255978,1.330274429];
  const p=0.2316419, c=0.39894228;
  if(x<0) return 1-normCdf(-x);
  const t=1/(1+p*x); let s=0, tn=t;
  for(let i=0;i<5;i++){ s+=b[i]*tn; tn*=t; }
  return 1-c*Math.exp(-x*x/2)*s;
}
console.log(`\n解读: |t|<1.96 或 p>0.05 → 生物与重连网络无统计显著差异`);
