import { readFileSync } from 'fs';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome, createMatchedControlGraph } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const ROOT = 'D:/苍蝇';
const graphData = JSON.parse(readFileSync(ROOT + '/public/data/connectome/graph.json', 'utf8'));
const ckpt = JSON.parse(readFileSync(ROOT + '/public/data/checkpoint.json', 'utf8'));

const bioBrain = new MaleCNSConnectome(graphData);
const ctrlGraph = createMatchedControlGraph(graphData, 42);
const ctrlBrain = new MaleCNSConnectome(ctrlGraph);

const TEST = Array.from({ length: 20 }, (_, i) => 80001 + i);
const MAX = 1800;

function newGame(s) {
  const g = new DanmakuGame(null, { width: 460, height: 580, seed: s });
  g.setSpellcard(s % 3);
  g.player.lives = 1; g.player.maxLives = 1;
  g.player.autoRespawn = false; g.player.invulnerableTimer = 0;
  return g;
}

function run(mode, brain, policy) {
  let tf = 0, tg = 0, tx = 0, n = 0;
  for (const s of TEST) {
    if (brain) brain.reset();
    const g = newGame(s);
    let f = 0;
    while (!g.player.isDead && f < MAX) {
      let m = { moveX: 0, moveY: 0 };
      if (mode === 'normal') m = policy.forward(brain.step(g.getBiologicalSensoryInput(), false));
      else if (mode === 'silenced') m = policy.forward(brain.step(g.getBiologicalSensoryInput(), true));
      else if (mode === 'driftRight') m = { moveX: 1, moveY: 1 };
      else if (mode === 'driftLeft') m = { moveX: -1, moveY: 1 };
      g.update(m); tx += g.player.x; f++; n++;
    }
    tf += f; tg += g.player.graze;
  }
  return { frames: tf / TEST.length, graze: tg / TEST.length, avgX: tx / n };
}

const bioPolicy = new ReadoutPolicy(new Float64Array(ckpt.weights));
const ctrlPolicy = new ReadoutPolicy(new Float64Array(ckpt.controlWeights));

console.log('=== 独立复现 (20 种子, 上限 1800 帧) ===');
const bio = run('normal', bioBrain, bioPolicy);
console.log(`[1] 生物连接组+训练策略 : ${bio.frames.toFixed(1)} 帧 (${(bio.frames/60).toFixed(2)}s) | 擦弹 ${bio.graze.toFixed(1)} | avgX ${bio.avgX.toFixed(1)}`);
const ctrl = run('normal', ctrlBrain, ctrlPolicy);
console.log(`[2] 随机重连对照组      : ${ctrl.frames.toFixed(1)} 帧 (${(ctrl.frames/60).toFixed(2)}s) | 擦弹 ${ctrl.graze.toFixed(1)} | avgX ${ctrl.avgX.toFixed(1)}`);
const sil = run('silenced', bioBrain, bioPolicy);
console.log(`[3] 大脑静音消融        : ${sil.frames.toFixed(1)} 帧 (${(sil.frames/60).toFixed(2)}s)`);
const idle = run('idle', null, null);
console.log(`[4] 静止不动            : ${idle.frames.toFixed(1)} 帧 (${(idle.frames/60).toFixed(2)}s)`);
const br = run('driftRight', null, null);
console.log(`[5] 固定右下(1,1)       : ${br.frames.toFixed(1)} 帧 (${(br.frames/60).toFixed(2)}s)`);
const bl = run('driftLeft', null, null);
console.log(`[6] 固定左下(-1,1)      : ${bl.frames.toFixed(1)} 帧 (${(bl.frames/60).toFixed(2)}s)`);
const rnd = run('normal', bioBrain, new ReadoutPolicy(new Float64Array(PARAMETERS).map(()=> (Math.random()-0.5)*1.5)));
console.log(`[7] 随机未训练权重      : ${rnd.frames.toFixed(1)} 帧 (${(rnd.frames/60).toFixed(2)}s)`);

const gain = ((bio.frames - ctrl.frames) / ctrl.frames) * 100;
console.log(`\n🏆 拓扑优势 (我复现): ${gain >= 0 ? '+' : ''}${gain.toFixed(2)}%`);
console.log(`   自报值: +${ckpt.benchmark.topologyAdvantagePercent.toFixed(2)}%`);

console.log('\n=== 对照自报值 ===');
for (const [k, label] of [['trained','生物'],['matchedControl','重连'],['circuitSilenced','静音'],['idle','静止'],['driftBottomRight','右下'],['driftBottomLeft','左下'],['randomPolicy','随机']]) {
  console.log(`  ${label}: 自报 ${ckpt.benchmark[k].frames.toFixed(1)}`);
}
