import { readFileSync } from 'fs';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';

const ROOT = 'D:/苍蝇';
const graphData = JSON.parse(readFileSync(ROOT + '/public/data/connectome/graph.json', 'utf8'));
const ckpt = JSON.parse(readFileSync(ROOT + '/public/data/checkpoint.json', 'utf8'));
const brain = new MaleCNSConnectome(graphData);
const policy = new ReadoutPolicy(new Float64Array(ckpt.weights));

// 统计一局中自机的方向偏好
function analyze(seed) {
  brain.reset();
  const g = new DanmakuGame(null, { width: 460, height: 580, seed });
  g.setSpellcard(seed % 3);
  g.player.lives = 1; g.player.maxLives = 1;
  g.player.autoRespawn = false; g.player.invulnerableTimer = 0;

  let sumMx = 0, sumMy = 0, n = 0;
  let cntLeft = 0, cntRight = 0, cntUp = 0, cntDown = 0;
  let xs = [];
  let f = 0;
  // 方向"翻转次数"衡量是否需要"往一个固定方向跑"
  let prevSignX = 0, flips = 0;

  while (!g.player.isDead && f < 1800) {
    const obs = g.getBiologicalSensoryInput();
    const dn = brain.step(obs, false);
    const m = policy.forward(dn);
    sumMx += m.moveX; sumMy += m.moveY; n++;
    if (m.moveX < -0.1) cntLeft++;
    if (m.moveX > 0.1) cntRight++;
    if (m.moveY < -0.1) cntUp++;
    if (m.moveY > 0.1) cntDown++;
    const sg = Math.sign(m.moveX);
    if (sg !== 0 && prevSignX !== 0 && sg !== prevSignX) flips++;
    if (sg !== 0) prevSignX = sg;
    xs.push(g.player.x);
    g.update(m); f++;
  }
  const avgX = xs.reduce((a,b)=>a+b,0)/xs.length;
  return {
    frames: f,
    avgMx: sumMx/n, avgMy: sumMy/n, n,
    pctLeft: cntLeft/n*100, pctRight: cntRight/n*100,
    pctUp: cntUp/n*100, pctDown: cntDown/n*100,
    avgPlayerX: avgX, width: g.width,
    flipsPerSec: flips/(f/60),
    finalX: g.player.x
  };
}

console.log('=== 自机方向偏好分析 (10 局) ===');
let totAvgMx = 0, totAvgMy = 0, totX = 0, totFlip = 0, totFrames = 0;
let xsAll = [];
for (let i = 0; i < 10; i++) {
  const s = 80001 + i;
  const r = analyze(s);
  totAvgMx += r.avgMx; totAvgMy += r.avgMy; totX += r.avgPlayerX; totFlip += r.flipsPerSec; totFrames += r.frames;
  console.log(`seed ${s} [${r.frames}帧]: avgMoveX=${r.avgMx.toFixed(3)} avgMoveY=${r.avgMy.toFixed(3)} | 左${r.pctLeft.toFixed(0)}% 右${r.pctRight.toFixed(0)}% 上${r.pctUp.toFixed(0)}% 下${r.pctDown.toFixed(0)}% | 平均X=${r.avgPlayerX.toFixed(0)}/${r.width} | 翻转=${r.flipsPerSec.toFixed(1)}次/秒`);
}
console.log(`\n平均: avgMoveX=${(totAvgMx/10).toFixed(3)} avgMoveY=${(totAvgMy/10).toFixed(3)} 平均X位置=${(totX/10).toFixed(0)}/460 翻转=${(totFlip/10).toFixed(1)}次/秒 平均帧数=${(totFrames/10).toFixed(0)}`);
console.log('\n解读: 平均X 越接近 230(中央) 说明偏边越轻; avgMoveX 越接近0 说明水平方向越对称');
