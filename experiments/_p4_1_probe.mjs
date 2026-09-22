/**
 * _p4_1_probe.mjs —— P4-1「Hebbian 突触可塑性」廉价探针
 *
 * 目的：在动任何源码之前，先用「固定 A 臂读出权重」回答三个题：
 *   Q1 时间尺度：一局只有 1200~1800 帧（20~30 s），W 在这段时间里到底动了多少？
 *   Q2 是否收敛：W 是持续漂移（真在线过程）还是迅速收敛到不动点（= 一次性重参数化）？
 *   Q3 是否吃环境：把感觉输入冻结成常数，漂移终点是否还是同一个？
 *       ——若相同 ⇒ 该规则对输入不敏感，只依赖 W 自身结构，等于没从环境取信息。
 *
 * 另附两种拓扑模式：
 *   episode  : 每局重置 W（局内可塑）
 *   lifetime : W 跨局累积（一生可塑 —— 生物学上更贴近的那个版本）
 *
 * 用法: node experiments/_p4_1_probe.mjs
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

const TEST_SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
const CAP = 1800;

// —— 权重基准 ——
const brain0 = new MaleCNSConnectome(graphData);
const W0 = Array.from(brain0.eWeight);           // 初始（= 生物）权重
const NP = brain0.count;
const N_POST_MEAN = (() => {                      // W 均值 |w|，用作漂移的相对尺度
  let s = 0; for (const w of W0) s += Math.abs(w);
  return s / W0.length;
})();

/** 每条边的 post 索引（用于归一化守恒） */
const POSTS = brain0.ePost;

/**
 * 跑一局。
 * @param {object} opt { hebb, brain, frozenObs, cap, seed, wRef0 }
 *   hebb: null | { eta, decay, rule:'plain'|'oja', renorm:boolean }
 */
function rollout(seed, opt) {
  const { hebb, brain, frozenObs = null, cap = CAP } = opt;
  const policy = new ReadoutPolicy(W_READOUT);
  brain.reset();
  const game = new DanmakuGame(null, { width: 460, height: 580, seed, sensoryMode: 'v1' });
  game.setSpellcard(seed % 3);
  game.player.lives = 1; game.player.maxLives = 1;
  game.player.autoRespawn = false;
  game.player.invulnerableTimer = 0;

  const eW = brain.eWeight;
  const ePre = brain.ePre, ePost = brain.ePost;
  const nE = eW.length;
  const h = brain.activity;

  // 漂移轨迹采样
  const driftTrace = [];
  const frozen = frozenObs ? new Array(frozenObs.length).fill(frozenObs[0]) : null;

  let frames = 0, wallPenalty = 0;
  while (!game.player.isDead && frames < cap) {
    const obs = frozen || game.getBiologicalSensoryInput();
    const dn = brain.step(obs, false);
    game.update(policy.forward(dn));
    frames++;
    if (game.player.x < 32 || game.player.x > game.width - 32) wallPenalty += 0.25;

    if (hebb) {
      const { eta, decay, rule, renorm } = hebb;
      for (let e = 0; e < nE; e++) {
        const pre = h[ePre[e]], post = h[ePost[e]];
        if (rule === 'oja') eW[e] += eta * (pre * post - post * post * eW[e]);
        else eW[e] += eta * (pre * post - decay * eW[e]);
      }
      if (renorm) {
        // 恢复每突触后神经元 Σ|W_in| = 1 的基准归一化约定
        const acc = new Float64Array(NP);
        for (let e = 0; e < nE; e++) acc[ePost[e]] += Math.abs(eW[e]);
        for (let e = 0; e < nE; e++) { const a = acc[ePost[e]]; if (a > 1e-12) eW[e] /= a; }
      }
    }
    if (frames % 200 === 0) {
      let s = 0; for (let e = 0; e < nE; e++) s += Math.abs(eW[e] - W0[e]);
      driftTrace.push(+(s / nE / N_POST_MEAN).toFixed(4));  // 相对漂移：Δ|W| / 基准 |W|
    }
  }
  let driftSum = 0;
  for (let e = 0; e < nE; e++) driftSum += Math.abs(eW[e] - W0[e]);
  return {
    frames,
    score: Math.max(1, frames + game.player.graze * 4.0 - wallPenalty),
    drift: driftSum / nE / N_POST_MEAN,
    driftTrace,
  };
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

function evalSet(buildOpt, seeds = TEST_SEEDS) {
  const out = [];
  for (const seed of seeds) out.push(rollout(seed, buildOpt()));
  return {
    score: mean(out.map((o) => o.score)),
    frames: mean(out.map((o) => o.frames)),
    drift: mean(out.map((o) => o.drift)),
    capped: out.filter((o) => o.frames >= CAP).length,
    trace: out[0].driftTrace,
    details: out,
  };
}

console.log('='.repeat(78));
console.log(`P4-1 Hebbian 探针  |  图 80 节点 / ${W0.length} 边  |  W 均值|w| = ${N_POST_MEAN.toFixed(5)}`);
console.log(`读出权重 = A 臂（8ch×4cell, 测试集 1369.5 帧）冻结不动，只让 W 可塑`);
console.log('='.repeat(78));

// —— 基线：W 冻结 ——
const base = evalSet(() => ({ hebb: null, brain: new MaleCNSConnectome(graphData) }));
console.log(`\n[基线] W 冻结          : ${base.frames.toFixed(1)} 帧 | 触顶 ${base.capped}/20 | 漂移 ${base.drift.toFixed(4)}`);

// —— 扫描 η（局内可塑，每局重置 W）——
console.log(`\n[局内可塑 episode] W 每局从生物权重重新长起，1200~1800 帧内演化`);
console.log(`${'η'.padStart(9)} | ${'规则'.padEnd(6)} | ${'守恒'.padEnd(4)} | ${'存活帧'.padStart(8)} | ${'触顶'.padStart(5)} | ${'相对漂移'.padStart(9)} | 漂移轨迹(每200帧)`);
for (const rule of ['plain', 'oja']) {
  for (const eta of [1e-5, 1e-4, 1e-3, 1e-2]) {
    for (const renorm of [false, true]) {
      if (rule === 'oja' && renorm) continue;   // Oja 自带收敛，无需额外守恒
      const r = evalSet(() => ({
        hebb: { eta, decay: 0.01, rule, renorm },
        brain: new MaleCNSConnectome(graphData),
      }));
      console.log(
        `${String(eta).padStart(9)} | ${rule.padEnd(6)} | ${String(renorm).padEnd(4)} | ` +
        `${r.frames.toFixed(1).padStart(8)} | ${String(r.capped + '/20').padStart(5)} | ` +
        `${r.drift.toFixed(4).padStart(9)} | ${r.trace.join(' -> ')}`
      );
    }
  }
}

// —— 输入盲对照：把感觉输入冻结成常数 0.5 ——
console.log(`\n[输入盲对照] 感觉输入恒为 0.5（无任何环境信息），看漂移终点是否相同`);
for (const eta of [1e-3, 1e-2]) {
  const r = evalSet(() => ({
    hebb: { eta, decay: 0.01, rule: 'plain', renorm: false },
    brain: new MaleCNSConnectome(graphData),
    frozenObs: [0.5],
  }));
  console.log(`  η=${String(eta).padEnd(7)} 真实输入漂移见上 | 冻结输入漂移 ${r.drift.toFixed(4)}  轨迹 ${r.trace.join(' -> ')}`);
}

// —— 一生可塑：W 跨 20 个测试局持续累积（不重置）——
console.log(`\n[lifetime 一生可塑] W 跨局累积、从不重置（生物学上更贴近的版本）`);
for (const eta of [1e-4, 1e-3, 1e-2]) {
  const brain = new MaleCNSConnectome(graphData);
  const seq = [];
  for (const seed of TEST_SEEDS) {
    seq.push(rollout(seed, { hebb: { eta, decay: 0.01, rule: 'plain', renorm: false }, brain }));
  }
  let dsum = 0; for (let e = 0; e < brain.eWeight.length; e++) dsum += Math.abs(brain.eWeight[e] - W0[e]);
  console.log(
    `  η=${String(eta).padEnd(7)} 存活帧 ${mean(seq.map((o) => o.frames)).toFixed(1)} | 触顶 ${seq.filter((o) => o.frames >= CAP).length}/20 | ` +
    `全程累积漂移 ${(dsum / brain.eWeight.length / N_POST_MEAN).toFixed(4)} | 前5局 ${seq.slice(0, 5).map((o) => o.frames).join(',')} 后5局 ${seq.slice(-5).map((o) => o.frames).join(',')}`
  );
}

console.log('\n说明：相对漂移 = mean|W-W0| / mean|W0|。');
console.log('      报告 §3.2 实测：随机扰动到 0.1ε(=10%) 只掉 2%，0.2ε 骤降 42%（悬崖）。');
