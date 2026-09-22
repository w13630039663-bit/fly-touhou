// _review_drive.mjs — 实际游玩中 DN 驱动的活动量加权分解 (最后一个候选口径)
import fs from 'fs';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome, DYNAMICS } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';

const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const g1 = rd('public/data/connectome/graph.json');
const g2 = rd('public/data/connectome/graph600.json');
const ck1 = rd('public/data/checkpoint.json');
const ck2 = rd('public/data/checkpoint600.json');
const id1 = g1.nodes.map((n) => String(n.id));
const v1set = new Set(id1);

function run(graph, ids, weights, seeds) {
  const brain = new MaleCNSConnectome(graph);
  const policy = new ReadoutPolicy(new Float64Array(weights));
  const outSet = new Set(graph.outputs);
  const inSet = new Set(graph.inputs.map(([c]) => c));
  // 累计每个 DN 的驱动: |贡献| 来自 v1细胞 / 新细胞 / 输入直达
  const acc = graph.outputs.map(() => ({ v1: 0, neu: 0, ind: 0 }));
  const idx = new Map(graph.outputs.map((o, i) => [o, i]));
  for (const s of seeds) {
    brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed: s });
    game.setSpellcard(s % 3);
    game.player.lives = 1; game.player.maxLives = 1; game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
    let f = 0;
    while (!game.player.isDead && f < 600) {
      const obs = game.getBiologicalSensoryInput();
      // 手动做一次 step 内的首轮驱动分解 (用当前 activity)
      brain.drive.fill(0);
      for (const [cell, ch] of brain.inputs) brain.drive[cell] = 2.0 * ((obs[ch] ?? 0.5) - 0.5);
      const scratch = new Float64Array(brain.count); scratch.set(brain.drive);
      for (let e = 0; e < brain.ePre.length; e++) {
        const p = brain.ePre[e], q = brain.ePost[e];
        const contrib = DYNAMICS.gain * brain.eWeight[e] * brain.activity[p];
        scratch[q] += contrib;
        const i = idx.get(q);
        if (i !== undefined) {
          const a = Math.abs(contrib);
          if (v1set.has(ids[p])) acc[i].v1 += a; else acc[i].neu += a;
          if (inSet.has(p)) acc[i].ind += a;
        }
      }
      const dn = brain.step(obs, false);
      game.update(policy.forward(dn));
      f++;
    }
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sh = (k, tot) => (100 * mean(acc.map((a) => a[k] / ((a.v1 + a.neu) || 1)))).toFixed(1) + '%';
  const shInd = (100 * mean(acc.map((a) => a.ind / ((a.v1 + a.neu) || 1)))).toFixed(1) + '%';
  return { v1: sh('v1'), neu: sh('neu'), inputDirect: shInd };
}

const seeds = Array.from({ length: 10 }, (_, i) => 80001 + i);
console.log('v1-80 驱动分解 :', JSON.stringify(run(g1, id1, ck1.weights, seeds)));
console.log('v600  驱动分解 :', JSON.stringify(run(g2, g2.nodes.map((n) => String(n.id)), ck2.weights, seeds)));
