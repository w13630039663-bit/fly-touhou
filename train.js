/**
 * train.js - MaleCNS 连接组 + Touhou 弹幕避障的 CEM 真实神经进化训练器 (v4)
 *
 * 彻底消除环境脱节与策略退化：
 * 1. 直接导入并训练在实际游戏引擎 DanmakuGame (460x580, speed 5.0, 符卡弹幕与自机狙)
 * 2. 真实 MaleCNS v1.0 局部连接组拓扑，冻结真实连接（--graph 可切换 80 / 600 细胞数据集）
 * 3. 零偏置反射型解码网络 Zero-Bias Readout Policy (320 参数: 16x16 + 16x4, b1=0, b2=0)
 * 4. 消除死角挂机: 周期性自机狙破角 + 严格象限互斥感知 (Front, Left, Right, Rear)
 * 5. CEM (Cross-Entropy Method) 进化策略搜索 Readout 突触权重；--workers N 启用 worker_threads 并行评估
 * 6. 严格独立测试集因果消融基准 + Matched Control 多对照组 + 配对 bootstrap 显著性
 *
 * CLI:
 *   node train.js                                   # v1 80 细胞图，单进程，写 public/data/checkpoint.json
 *   node train.js --graph public/data/connectome/graph600.json \
 *                 --out public/data/checkpoint600.json --workers 14 --generations 100 --pop 64 \
 *                 --control-seeds 42,43,44
 *   --cem-seed N  CEM 候选采样种子 (mulberry32, 默认 20260916；每场训练独立新流 ⇒ 位可复现)
 *   --gains       322 参数模式 (v7): 320 读出 + 2 个 DN 兴奋/抑制全局增益把手
 *   --no-controls 跳过 Matched Control 训练 (判据不涉及拓扑主张时省一半机时)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Worker } from 'node:worker_threads';
import { DanmakuGame } from './src/game/danmaku.js';
import { MaleCNSConnectome, createMatchedControlGraph } from './src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from './src/brain/policy.js';
import { evaluateCandidate } from './src/brain/eval_core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 保持历史导入面兼容：evaluateCandidate 仍从 train.js 可导入
export { evaluateCandidate };

// ---------------- CLI ----------------
const argv = process.argv.slice(2);
function argVal(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const GRAPH_PATH = argVal('--graph', 'public/data/connectome/graph.json');
const OUT_PATH = argVal('--out', 'public/data/checkpoint.json');
const WORKERS = Number(argVal('--workers', '0'));
const NO_CONTROLS = argv.includes('--no-controls');
const CONTROL_SEEDS = NO_CONTROLS ? [] : String(argVal('--control-seeds', '42')).split(',').map(Number);
// P0.0: CEM 采样播种 —— 此前候选权重用未播种 Math.random() 抽取，历史运行不可复现；
// 现在每场训练 (bio / 各对照) 各自新建 mulberry32(cemSeed) 独立同种子流 ⇒ 位可复现，
// 且同一采样噪声序列跨架构逐位对齐 (天然配对设计)。
const CEM_SEED = Number(argVal('--cem-seed', '20260916'));
// v7 (PLAN_520 B.1): --gains 打开 322 参数模式 = 320 读出 + 2 个 DN 兴奋/抑制全局增益
// (增益由 connectome.applyDnGains 钳制到 [0,4]，1/1 时与 320 版逐位一致)。
const USE_GAINS = argv.includes('--gains');
const NUM_PARAMS = USE_GAINS ? PARAMETERS + 2 : PARAMETERS;

/**
 * mulberry32 —— 确定性伪随机数生成器 (固定种子，保证全流程可复现)
 * 与 src/brain/connectome.js 中的实现保持一致。
 */
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- worker 评估池 ----------------
function createEvalPool(graphJson, nWorkers) {
  const workers = [];
  const idle = [];
  const queue = [];
  const pending = new Map();
  let nextId = 0;
  let dead = null;

  for (let i = 0; i < nWorkers; i++) {
    const w = new Worker(new URL('./tools/cem_worker.mjs', import.meta.url), {
      workerData: { graphJson }
    });
    w.on('message', (m) => {
      const rec = pending.get(m.id);
      if (rec) {
        pending.delete(m.id);
        if (m.error) rec.reject(new Error(m.error)); else rec.resolve(m.score);
      }
      idle.push(i);
      pump();
    });
    w.on('error', (e) => { dead = e; for (const rec of pending.values()) rec.reject(e); pending.clear(); });
    workers.push(w);
    idle.push(i);
  }

  function pump() {
    while (queue.length && idle.length && !dead) {
      const wi = idle.pop();
      const task = queue.shift();
      pending.set(task.id, task);
      workers[wi].postMessage({ type: 'eval', id: task.id, weights: task.weights, seeds: task.seeds, maxFrames: task.maxFrames });
    }
  }

  return {
    eval(weights, seeds, maxFrames = 1200) {
      return new Promise((resolve, reject) => {
        if (dead) return reject(dead);
        queue.push({ id: nextId++, weights: Array.from(weights), seeds, maxFrames, resolve, reject });
        pump();
      });
    },
    async shutdown() {
      await Promise.all(workers.map((w) => { w.postMessage({ type: 'shutdown' }); return w.terminate(); }));
    }
  };
}

/**
 * 单个网络架构的通用 CEM 演化搜索（async：evalFn 可返回 Promise 或数值）
 */
export async function runCEM(evalFn, label, generations = 30, popSize = 48, eliteCount = 8, seedsPerGen = 12, rng = mulberry32(CEM_SEED), nParams = USE_GAINS ? PARAMETERS + 2 : PARAMETERS) {
  console.log(`\n------------------------------------------------------`);
  console.log(`🧬 启动演化: ${label}`);
  console.log(`⚙️  种群: ${popSize}, 精英: ${eliteCount}, 代数: ${generations}, 种子数: ${seedsPerGen}/代 | CEM 采样种子: ${CEM_SEED} (每场训练独立新流, 位可复现)`);
  console.log(`------------------------------------------------------`);

  let mu = new Float64Array(nParams);
  let sigma = new Float64Array(nParams).fill(0.8);

  let bestFitness = -1;
  let bestWeights = new Float64Array(nParams);

  const startTime = Date.now();

  for (let g = 0; g < generations; g++) {
    // 12 个训练种子覆盖 4 轮 3 套符卡 (0, 1, 2)，消除单局运气噪点
    const trainSeeds = Array.from({ length: seedsPerGen }, (_, i) => g * 137 + i * 19 + 7);

    const candidateWeights = [];
    for (let c = 0; c < popSize; c++) {
      const w = new Float64Array(nParams);
      if (c === 0 && g > 0) {
        w.set(bestWeights);
      } else {
        for (let i = 0; i < nParams; i++) {
          const u1 = rng() || 1e-7;
          const u2 = rng();
          const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
          w[i] = mu[i] + sigma[i] * z;
        }
      }
      candidateWeights.push(w);
    }

    // 同一代内并行评估；结果按候选人下标聚合 → 与调度顺序无关
    const scores = await Promise.all(candidateWeights.map((w) => evalFn(w, trainSeeds)));
    const candidates = candidateWeights.map((w, i) => ({ weights: w, score: scores[i] }));

    candidates.sort((a, b) => b.score - a.score);
    const elites = candidates.slice(0, eliteCount);

    if (elites[0].score > bestFitness) {
      bestFitness = elites[0].score;
      bestWeights.set(elites[0].weights);
    }

    // 更新高斯分布均值 mu
    const newMu = new Float64Array(nParams);
    for (const elite of elites) {
      for (let i = 0; i < nParams; i++) {
        newMu[i] += elite.weights[i] / eliteCount;
      }
    }

    // 更新高斯分布方差 sigma
    const newSigma = new Float64Array(nParams);
    for (const elite of elites) {
      for (let i = 0; i < nParams; i++) {
        const diff = elite.weights[i] - newMu[i];
        newSigma[i] += (diff * diff) / eliteCount;
      }
    }
    for (let i = 0; i < nParams; i++) {
      newSigma[i] = Math.max(0.06, Math.sqrt(newSigma[i]));
    }

    // 指数移动平滑 (Polyak Averaging)
    for (let i = 0; i < nParams; i++) {
      mu[i] = 0.3 * mu[i] + 0.7 * newMu[i];
      sigma[i] = 0.3 * sigma[i] + 0.7 * newSigma[i];
    }

    const eliteAvg = elites.reduce((sum, e) => sum + e.score, 0) / eliteCount;
    if ((g + 1) % 5 === 0 || g === 0 || g === generations - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${label}] 第 ${String(g + 1).padStart(2, ' ')}/${generations} 代 [${elapsed}s] | 精英均值: ${eliteAvg.toFixed(1)} | 当代最优: ${elites[0].score.toFixed(1)} | 历史最佳: ${bestFitness.toFixed(1)}`);
    }
  }

  return { bestWeights, bestFitness };
}

/**
 * 严格独立测试集统一评估函数（返回聚合 + 逐种子帧列表，供配对 bootstrap）
 */
export function evaluateOnTestSeeds(testSeeds, brain, weights, mode = 'normal') {
  let totalFrames = 0, totalGraze = 0, totalX = 0;
  const perSeedFrames = [];
  const policy = weights ? new ReadoutPolicy(weights) : null;
  // v7: 322 权重向量 → 增益装到 brain 后再评估; 短向量/无权重时归零为 1/1 (防上一手脏状态)
  if (brain) brain.applyDnGains(weights && weights.length > PARAMETERS ? weights[PARAMETERS] : 1, weights && weights.length > PARAMETERS ? weights[PARAMETERS + 1] : 1);

  for (const s of testSeeds) {
    if (brain) brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed: s });
    game.setSpellcard(s % 3);
    game.player.lives = 1;
    game.player.maxLives = 1;
    game.player.autoRespawn = false;
    game.player.invulnerableTimer = 0;

    let f = 0;
    while (!game.player.isDead && f < 1800) {
      let motor = { moveX: 0, moveY: 0 };
      if (mode === 'normal') {
        const obs = game.getBiologicalSensoryInput();
        const dn = brain.step(obs, false);
        motor = policy.forward(dn);
      } else if (mode === 'silenced') {
        const obs = game.getBiologicalSensoryInput();
        const dn = brain.step(obs, true);
        motor = policy.forward(dn);
      } else if (mode === 'idle') {
        motor = { moveX: 0, moveY: 0 };
      } else if (mode === 'driftRight') {
        motor = { moveX: 1, moveY: 1 };
      } else if (mode === 'driftLeft') {
        motor = { moveX: -1, moveY: 1 };
      }
      game.update(motor);
      totalX += game.player.x;
      f++;
    }
    perSeedFrames.push(f);
    totalFrames += f;
    totalGraze += game.player.graze;
  }

  return {
    frames: totalFrames / testSeeds.length,
    seconds: (totalFrames / testSeeds.length) / 60,
    graze: totalGraze / testSeeds.length,
    avgPlayerX: totalFrames > 0 ? totalX / totalFrames : 230,
    perSeedFrames
  };
}

/** 配对双侧 bootstrap：mean(bio)-mean(ctrl) 的符号在重采样中翻转的频率（2×单尾，min 2/B） */
function pairedTwoSidedP(bioFrames, ctrlFrames, nBoot = 20000, rngSeed = 987654321) {
  const rng = mulberry32(rngSeed);
  const n = Math.min(bioFrames.length, ctrlFrames.length);
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += bioFrames[i]; my += ctrlFrames[i]; }
  const d = (mx - my) / n;
  if (d === 0) return { diff: 0, p: 1 };
  let flips = 0;
  for (let b = 0; b < nBoot; b++) {
    let a = 0, c = 0;
    for (let i = 0; i < n; i++) { const j = Math.floor(rng() * n); a += bioFrames[j]; c += ctrlFrames[j]; }
    if (Math.sign((a - c) / n) !== Math.sign(d)) flips++;
  }
  return { diff: d, p: Math.max(2 / nBoot, (flips / nBoot) * 2) };
}

/**
 * CEM 进化训练主循环:
 * 双轨对决: 真实生物连接组 vs. Matched Control 随机重连网络（可多组 --control-seeds）
 */
export async function trainCEM(generations = 30, popSize = 48, eliteCount = 8, seedsPerGen = 12) {
  const graphFile = path.join(__dirname, GRAPH_PATH);
  const graphData = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
  const graphSha = crypto.createHash('sha256').update(fs.readFileSync(graphFile)).digest('hex');

  console.log(`\n======================================================`);
  console.log(`🧬 MaleCNS 真实生物连接组 vs. Matched Control 随机重连网络`);
  console.log(`🕸️  拓扑: ${GRAPH_PATH} (${graphData.nodes.length} 神经元 / ${graphData.edges.length} 边 / ${graphData.version})`);
  console.log(`🎮 训练引擎: 真实 DanmakuGame (460x580, speed 5.0, 3套东方符卡)`);
  console.log(`⚙️  策略架构: 16 DNs -> 16 Tanh -> 4 动作评分 (零偏置, ${NUM_PARAMS} 参数${USE_GAINS ? ' = 320 读出 + 2 DN 增益把手' : ''})`);
  console.log(`👥 种群规模: ${popSize}, 精英数: ${eliteCount}, 代数: ${generations}, 种子数: ${seedsPerGen}/代, 并行 worker: ${WORKERS || '（单进程）'}`);
  console.log(`======================================================\n`);

  const graphJson = JSON.stringify(graphData);
  // 每轨 (bio / 各对照) 独立评估池。旧实现共用按 bio 图初始化的池，对照候选实际在
  // bio 拓扑上打分——播种后该 bug 无所遁形 (bio 与对照轨迹逐位相同)。2026-02 修复。
  const runTrack = async (label, brain, trackJson) => {
    let p = null;
    const evalFn = (w, seeds) => p
      ? p.eval(w, seeds, 1200)
      : evaluateCandidate(w, seeds, brain, 1200);
    try {
      if (WORKERS > 0) p = createEvalPool(trackJson, WORKERS);
      return await runCEM(evalFn, label, generations, popSize, eliteCount, seedsPerGen);
    } finally {
      if (p) await p.shutdown();
    }
  };

  // 1. 真实生物 MaleCNS 连接组训练
  const bioBrain = new MaleCNSConnectome(graphData);
  const bioResult = await runTrack('MaleCNS 真实生物连接组', bioBrain, graphJson);

  // 2. Matched Control 随机重连网络对照组训练 (Maslov-Sneppen 度保持边置换)
  const controlResults = [];
  for (const cseed of CONTROL_SEEDS) {
    const controlGraph = createMatchedControlGraph(graphData, cseed);
    const controlBrain = new MaleCNSConnectome(controlGraph);
    const res = await runTrack(`Matched Control (seed=${cseed})`, controlBrain, JSON.stringify(controlGraph));
    controlResults.push({ seed: cseed, brain: controlBrain, ...res, swaps: controlGraph.successfulSwaps });
  }

  // ================= 严格独立测试集评测 (Seeds 80001 ~ 80020) =================
  console.log(`\n======================================================`);
  console.log(`📊 严格独立测试集因果消融基准评估 (20 场全新未见测试对局)`);
  console.log(`======================================================`);
  const testSeeds = Array.from({ length: 20 }, (_, i) => 80001 + i);

  const bioRes = evaluateOnTestSeeds(testSeeds, bioBrain, bioResult.bestWeights, 'normal');
  const ctrlResList = controlResults.map((c) => ({
    seed: c.seed,
    ...evaluateOnTestSeeds(testSeeds, c.brain, c.bestWeights, 'normal')
  }));
  const silencedRes = evaluateOnTestSeeds(testSeeds, bioBrain, bioResult.bestWeights, 'silenced');
  const idleRes = evaluateOnTestSeeds(testSeeds, null, null, 'idle');
  const brRes = evaluateOnTestSeeds(testSeeds, null, null, 'driftRight');
  const blRes = evaluateOnTestSeeds(testSeeds, null, null, 'driftLeft');
  const randRng = mulberry32(20260914);
  const randWeights = new Float64Array(NUM_PARAMS);
  for (let i = 0; i < PARAMETERS; i++) randWeights[i] = (randRng() - 0.5) * 1.5;
  if (NUM_PARAMS > PARAMETERS) { randWeights[PARAMETERS] = 1; randWeights[PARAMETERS + 1] = 1; } // 随机基线增益取中性, 与历史口径可比
  const randRes = evaluateOnTestSeeds(testSeeds, bioBrain, randWeights, 'normal');

  const hasCtrls = ctrlResList.length > 0;
  const ctrlFrames = ctrlResList.map((c) => c.frames);
  const ctrlMean = hasCtrls ? ctrlFrames.reduce((a, b) => a + b, 0) / ctrlFrames.length : null;
  const topologyAdvantage = hasCtrls ? ((bioRes.frames - ctrlMean) / ctrlMean) * 100 : null;
  // 每组对照独立双侧配对 bootstrap；显著性要求「方向一致 + Bonferroni 校正后 p<0.05」
  const vsCtrls = ctrlResList.map((c) => ({
    seed: c.seed,
    ...pairedTwoSidedP(bioRes.perSeedFrames, c.perSeedFrames)
  }));
  const minP = hasCtrls ? Math.min(...vsCtrls.map((v) => v.p)) : null;
  const adjustedP = hasCtrls ? Math.min(1, minP * vsCtrls.length) : null;
  const dirs = vsCtrls.map((v) => Math.sign(v.diff));
  const directionMixed = hasCtrls && dirs.some((s) => s > 0) && dirs.some((s) => s < 0);
  const significant = hasCtrls && !directionMixed && adjustedP < 0.05;

  console.log(`🧠 MaleCNS 真实生物连接组       : 平均存活 ${bioRes.frames.toFixed(1)} 帧 (${bioRes.seconds.toFixed(2)} 秒) | 平均擦弹: ${bioRes.graze.toFixed(1)} 次 | 自机平均 X: ${bioRes.avgPlayerX.toFixed(1)} (距中心偏差: ${Math.abs(bioRes.avgPlayerX - 230).toFixed(1)}px)`);
  for (const v of vsCtrls) {
    const c = ctrlResList.find((x) => x.seed === v.seed);
    console.log(`🔀 Matched Control (seed=${v.seed})   : 平均存活 ${c.frames.toFixed(1)} 帧 (${c.seconds.toFixed(2)} 秒) | 平均擦弹: ${c.graze.toFixed(1)} 次 | 配对 Δ(bio-ctrl)=${v.diff >= 0 ? '+' : ''}${v.diff.toFixed(0)}f 双侧 p=${v.p.toFixed(4)}`);
  }
  console.log(`🔇 大脑静音消融 (Circuit Silenced) : 平均存活 ${silencedRes.frames.toFixed(1)} 帧 (${silencedRes.seconds.toFixed(2)} 秒) | (因果数学保证输出恒为 0)`);
  console.log(`🧍 静止不动挂机 (Idle Baseline)    : 平均存活 ${idleRes.frames.toFixed(1)} 帧 (${idleRes.seconds.toFixed(2)} 秒)`);
  console.log(`↘️  固定右下角死蹲 (Drift 1, 1)     : 平均存活 ${brRes.frames.toFixed(1)} 帧 (${brRes.seconds.toFixed(2)} 秒)`);
  console.log(`↙️  固定左下角死蹲 (Drift -1, 1)    : 平均存活 ${blRes.frames.toFixed(1)} 帧 (${blRes.seconds.toFixed(2)} 秒)`);
  console.log(`🎲 随机未训练策略 (Random Weights) : 平均存活 ${randRes.frames.toFixed(1)} 帧 (${randRes.seconds.toFixed(2)} 秒)`);
  console.log(`------------------------------------------------------`);
  console.log(`📌 生物拓扑 vs Matched Control: ${!hasCtrls ? '本场未训练对照 (--no-controls)' : `${topologyAdvantage >= 0 ? '+' : ''}${topologyAdvantage.toFixed(1)}% | ${directionMixed ? '⚠️ 对照组间方向不一致 (有赢有输) → 拓扑优势不可信' : significant ? `方向一致, Bonferroni 校正双侧 p=${adjustedP.toFixed(4)} < 0.05 → 显著` : `Bonferroni 校正双侧 p=${adjustedP.toFixed(4)} → 不显著`}`}`);
  console.log(`======================================================\n`);

  // 保存真实训练 Checkpoint（自描述所用拓扑）
  const checkpointPath = path.join(__dirname, OUT_PATH);
  const checkpointData = {
    version: `malecns-${graphData.nodes.length}-cell-touhou-readout-${USE_GAINS ? 'v7-gains' : 'v6'}`,
    architecture: USE_GAINS
      ? 'Zero-Bias Reflexive Readout (16->16->4) with 2D Proprioception + 2 global DN input gains (exc/inh, clamped [0,4])'
      : 'Zero-Bias Reflexive Readout (16->16->4) with 2D Proprioception',
    topology: {
      graph: GRAPH_PATH,
      version: graphData.version,
      neurons: graphData.nodes.length,
      edges: graphData.edges.length,
      synapticContacts: graphData.edges.reduce((a, e) => a + e[2], 0),
      graphSha256: graphSha
    },
    trainedAt: new Date().toISOString(),
    cemSeed: CEM_SEED,
    reproducibilityNote: 'CEM 候选采样由 mulberry32(cemSeed) 驱动，每场训练（bio / 各组 control）独立新建同种子流；同 --graph/--generations/--pop/--elite/--seeds/--cem-seed（含 --gains 开关状态）下 bestWeights 位可复现。cemSeed 缺省前的历史运行不可精确复现。',
    bestFitness: bioResult.bestFitness,
    controlFitness: controlResults.map((c) => ({ seed: c.seed, fitness: c.bestFitness })),
    parameters: NUM_PARAMS,
    gainParams: USE_GAINS ? { index: [PARAMETERS, PARAMETERS + 1], semantics: 'global gains on DN-incoming edges by presynaptic sign, clamped [0,4]', raw: [bioResult.bestWeights[PARAMETERS], bioResult.bestWeights[PARAMETERS + 1]] } : undefined,
    benchmark: {
      trained: bioRes,
      matchedControls: ctrlResList,
      matchedControl: ctrlResList[0],
      circuitSilenced: silencedRes,
      idle: idleRes,
      driftBottomRight: brRes,
      driftBottomLeft: blRes,
      randomPolicy: randRes,
      topologyAdvantagePercent: topologyAdvantage,
      topologyAdvantageP: vsCtrls,
      topologyAdvantageAdjustedP: adjustedP,
      topologyAdvantageSignificant: significant,
      topologyAdvantageConsistent: !directionMixed,
      topologyAdvantageNote: !hasCtrls
        ? '本场未训练对照 (--no-controls)：判据为 bio 独立测试 vs 历史冠军的 20 种子配对，不涉及拓扑优越性主张。'
        : directionMixed
        ? `${vsCtrls.length} 组度保持对照方向不一致 (有赢有输, 各自双侧 bootstrap p 见 topologyAdvantageP)：对照网络存活在 ${Math.min(...ctrlFrames).toFixed(0)}~${Math.max(...ctrlFrames).toFixed(0)}f 间波动，CEM 单次重连运气主导。生物拓扑相对对照的优势百分比不可作为优越性证据，与 flydino 声明一致：本项目验证的是对连接组活动的依赖 (trained ≫ silenced 的因果链条)，而非生物拓扑的优越性。`
        : significant
          ? `配对双侧 bootstrap (20000 次重采样 × ${vsCtrls.length} 组对照, 20 个独立测试种子, Bonferroni 校正): 方向一致, min p=${minP.toFixed(4)}, adjusted p=${adjustedP.toFixed(4)} < 0.05。`
          : `配对双侧 bootstrap (20000 次重采样 × ${vsCtrls.length} 组对照, 20 个独立测试种子, Bonferroni 校正): min p=${minP.toFixed(4)}, adjusted p=${adjustedP.toFixed(4)} ≥ 0.05 → 无统计显著差异。单组对照的百分比不可作为生物拓扑优越性的证据 (与 flydino 作者的声明一致：本项目验证的是对连接组活动的依赖，而非生物拓扑的优越性)。`
    },
    weights: Array.from(bioResult.bestWeights),
    controlWeights: controlResults.map((c) => Array.from(c.bestWeights))
  };
fs.writeFileSync(checkpointPath, JSON.stringify(checkpointData, null, 2));
console.log(`✅ 真实冠军模型与对照组基准已持久化至: ${checkpointPath}`);

  return checkpointData;
}

// 命令行直接运行入口
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  trainCEM(
    Number(argVal('--generations', '30')),
    Number(argVal('--pop', '48')),
    Number(argVal('--elite', '8')),
    Number(argVal('--seeds', '12'))
  ).catch((e) => { console.error(e); process.exitCode = 1; });
}
