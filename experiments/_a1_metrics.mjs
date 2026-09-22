// experiments/_a1_metrics.mjs — A.1 验收指标 (dnRms / 权重份额) + P0.3 护栏复跑
import fs from 'fs';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';

const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const specs = [
  ['v1', 'public/data/connectome/graph.json', 'public/data/checkpoint.json'],
  ['v600', 'public/data/connectome/graph600.json', 'public/data/checkpoint600.json'],
  ['v600a', 'public/data/connectome/graph600a.json', 'public/data/checkpoint600a.json']
];
for (const [name, gp, cp] of specs) {
  const g = load(gp), ck = load(cp);
  const w = new Float64Array(ck.weights);
  // 权重侧口径: Σ|w|(pre∈inputs 段的边) / Σ|w|(全部→DN 的边)
  const brain = new MaleCNSConnectome(g);
  const inputSet = new Set(g.inputs.map((p) => p[0]));
  let dnAbs = 0, dnAbsFromInputs = 0;
  for (const e of brain.edges) {
    if (!g.outputs.includes(e.post)) continue;
    dnAbs += Math.abs(e.weight);
    if (inputSet.has(e.pre)) dnAbsFromInputs += Math.abs(e.weight);
  }
  const shareW = (100 * dnAbsFromInputs) / dnAbs;
  // 播放画像: dnRms / dnStd / activePct + 逐种子帧
  const policy = new ReadoutPolicy(w);
  const seeds = Array.from({ length: 20 }, (_, i) => 80001 + i);
  let sum = 0, sum2 = 0, n = 0, active = 0, totalCells = 0;
  const per = [];
  for (const s of seeds) {
    brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed: s });
    game.setSpellcard(s % 3);
    game.player.lives = 1; game.player.maxLives = 1; game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
    let f = 0;
    while (!game.player.isDead && f < 1800) {
      const dn = brain.step(game.getBiologicalSensoryInput(), false);
      for (const v of dn) { sum += v; sum2 += v * v; n++; }
      for (let i = 0; i < brain.count; i++) { totalCells++; if (Math.abs(brain.activity[i]) > 0.4) active++; }
      game.update(policy.forward(dn));
      f++;
    }
    per.push(f);
  }
  const mean = sum / n;
  const rms = Math.sqrt(sum2 / n);
  const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  console.log(`${name.padEnd(6)}: DN |w| 份额(输入源) ${shareW.toFixed(1)}% | dnRms ${rms.toFixed(2)} | dnStd ${sd.toFixed(2)} | 活跃率 ${(100 * active / totalCells).toFixed(1)}% | test ${per.reduce((a, b) => a + b, 0) / 20}f`);
}
