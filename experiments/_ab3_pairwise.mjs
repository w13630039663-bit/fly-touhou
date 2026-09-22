/**
 * _ab3_pairwise.mjs —— 三臂（A/B/C）逐种子配对分析
 *
 * 读取 train_ab_seeded.mjs 产出的三个 checkpoint，在同一批测试种子上逐局配对比较。
 * 三臂矩阵（双因素设计，A 为共同角）：
 *
 *              驱动细胞 = 8        驱动细胞 = 32
 *   信号 = 8    C                   A
 *   信号 = 32   （不可构造）         B
 *
 *   A vs B：驱动细胞固定 32，只变信号维度（8 → 32）
 *   A vs C：信号固定 8，只变驱动广度（每通道 4 细胞 → 1 细胞）
 *
 * 另附 3×3 交叉检验（权重来自 X 臂，放到 Y 臂的运行环境里）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));

const ARMS = ['v1', 'wide', 'c8x1'];
const NAMES = { v1: 'A(8ch×4cell)', wide: 'B(32ch×1cell)', c8x1: 'C(8ch×1cell)' };
const CKPT = {};
for (const a of ARMS) CKPT[a] = load(`checkpoint_ab3_${a}.json`);

const RUNTIME = {
  v1: { graph: 'graph.json', sensory: 'v1' },
  wide: { graph: 'graph32ch.json', sensory: 'wide' },
  c8x1: { graph: 'graph8ch1.json', sensory: 'v1' },
};
const graphs = {}, brains = {};
for (const a of ARMS) {
  graphs[a] = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome', RUNTIME[a].graph), 'utf8'));
  brains[a] = new MaleCNSConnectome(graphs[a]);
}

const SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
const CAP = 1800;

function runOne(arm, weights, seed) {
  const brain = brains[arm];
  const policy = new ReadoutPolicy(new Float64Array(weights));
  brain.reset();
  const game = new DanmakuGame(null, { width: 460, height: 580, seed, sensoryMode: RUNTIME[arm].sensory });
  game.setSpellcard(seed % 3);
  game.player.lives = 1; game.player.maxLives = 1;
  game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
  let f = 0;
  while (!game.player.isDead && f < CAP) {
    game.update(policy.forward(brain.step(game.getBiologicalSensoryInput(), false)));
    f++;
  }
  return f;
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const L = (s, n) => String(s).padStart(n);

// ---- 0. 前置一致性检查 ----
console.log('='.repeat(78));
console.log('  前置检查：三臂 CEM 随机源是否共用');
console.log('='.repeat(78));
for (const a of ARMS) console.log(`  ${NAMES[a].padEnd(16)} cemSeed=${CKPT[a].cemSeed} gens=${CKPT[a].generations} 输入对=${CKPT[a].inputPairs} 通道=${CKPT[a].channels}`);
const rndSame = ARMS.every(a => JSON.stringify(CKPT[a].rndPerSeed) === JSON.stringify(CKPT.v1.rndPerSeed));
console.log(`  随机权重基线逐种子是否三臂完全相同: ${rndSame ? '是（随机流共用，可直接比较）' : '否 —— 注意，随机基线不可直接横比'}`);
console.log(`  检查点自报 testTrained: A ${CKPT.v1.testTrained.toFixed(1)} | B ${CKPT.wide.testTrained.toFixed(1)} | C ${CKPT.c8x1.testTrained.toFixed(1)}`);

// ---- 1. 逐种子配对 ----
const perSeed = {};
for (const a of ARMS) perSeed[a] = SEEDS.map((seed) => runOne(a, CKPT[a].weights, seed));

// 自报值 vs 本脚本重放（复现门）
console.log('\n  复现校验 (本脚本重放 vs checkpoint 自报):');
for (const a of ARMS) {
  const replay = mean(perSeed[a]);
  const stored = mean(CKPT[a].testPerSeed);
  console.log(`    ${NAMES[a].padEnd(16)} 重放 ${replay.toFixed(1)} | 自报 ${stored.toFixed(1)} | Δ=${(replay - stored).toFixed(2)}`);
}

console.log('\n' + '='.repeat(78));
console.log('  逐种子配对比较 (20 个独立测试种子 80001-80020, 上限 1800 帧)');
console.log('='.repeat(78));
console.log('    种子      A:8×4      B:32×1     C:8×1');
for (let i = 0; i < SEEDS.length; i++) {
  const a = perSeed.v1[i], b = perSeed.wide[i], c = perSeed.c8x1[i];
  const mark = (v) => (v >= CAP ? `${v}!` : String(v));
  console.log(`  ${SEEDS[i]}   ${L(mark(a), 8)}   ${L(mark(b), 8)}   ${L(mark(c), 6)}`);
}

function pairStats(x, y) {
  const d = x.map((v, i) => y[i] - v);
  return {
    meanX: mean(x), meanY: mean(y),
    dMean: mean(d), dMedian: median(d),
    win: d.filter(v => v > 0).length, loss: d.filter(v => v < 0).length, tie: d.filter(v => v === 0).length,
    capX: x.filter(v => v >= CAP).length, capY: y.filter(v => v >= CAP).length,
  };
}
function reportPair(la, lb, rx, ry) {
  const s = pairStats(rx, ry);
  console.log(`\n  ${la} → ${lb}`);
  console.log(`    均值      ${s.meanX.toFixed(1)} → ${s.meanY.toFixed(1)}  (${s.meanY >= s.meanX ? '+' : ''}${(s.meanY - s.meanX).toFixed(1)} 帧, ${((s.meanY - s.meanX) / s.meanX * 100).toFixed(1)}%)`);
  console.log(`    配对差异  均值 ${s.dMean >= 0 ? '+' : ''}${s.dMean.toFixed(1)} | 中位数 ${s.dMedian >= 0 ? '+' : ''}${s.dMedian.toFixed(1)} 帧`);
  console.log(`    胜负      ${lb} 胜 ${s.win} / ${la} 胜 ${s.loss} / 平 ${s.tie}`);
  console.log(`    触顶 1800 ${la} ${s.capX}/20  vs  ${lb} ${s.capY}/20`);
  return s;
}

console.log('\n' + '='.repeat(78));
console.log('  双因素主效应');
console.log('='.repeat(78));
const ab = reportPair('A', 'B', perSeed.v1, perSeed.wide);   // 只变信号维度
const ac = reportPair('A', 'C', perSeed.v1, perSeed.c8x1);   // 只变驱动广度
const bc = reportPair('B', 'C', perSeed.wide, perSeed.c8x1);

// ---- 2. 随机权重基线（三臂共用同一组权重） ----
console.log('\n' + '='.repeat(78));
console.log('  随机权重基线（三臂同一组权重，仅换运行环境）');
console.log('='.repeat(78));
const rndW = CKPT.v1.weights.map(() => 0); // placeholder，实际用 rndPerSeed
for (const a of ARMS) {
  console.log(`  ${NAMES[a].padEnd(16)} 随机 ${mean(CKPT[a].rndPerSeed).toFixed(1)} 帧 | 训练后 ${mean(CKPT[a].testPerSeed).toFixed(1)} 帧 | 增益 ${(mean(CKPT[a].testPerSeed) - mean(CKPT[a].rndPerSeed) >= 0 ? '+' : '')}${(mean(CKPT[a].testPerSeed) - mean(CKPT[a].rndPerSeed)).toFixed(1)}`);
}

// ---- 3. 3×3 交叉检验 ----
console.log('\n' + '='.repeat(78));
console.log('  交叉检验：权重来自 X 臂，放到 Y 臂环境 (行=权重来源, 列=运行环境)');
console.log('='.repeat(78));
const header = ['权重\\环境', ...ARMS.map(a => NAMES[a])];
console.log('  ' + header.map(h => h.padEnd(16)).join(''));
for (const src of ARMS) {
  const cells = [];
  for (const dst of ARMS) {
    const m = mean(SEEDS.map((seed) => runOne(dst, CKPT[src].weights, seed)));
    cells.push((m.toFixed(1) + (src === dst ? ' *' : '')).padEnd(16));
  }
  console.log('  ' + NAMES[src].padEnd(16) + cells.join(''));
}
console.log('  (* = 原生环境，即该臂自己的成绩)');

// ---- 4. 结论机读输出 ----
console.log('\n' + '='.repeat(78));
console.log('  判读');
console.log('='.repeat(78));
const cd = perSeed.c8x1.map((v, i) => v - perSeed.v1[i]);
console.log(`  A vs C (驱动广度 32→8, 信号不变): 中位数 ${cd.slice().sort((a, b) => a - b)[9] >= 0 ? '+' : ''}${median(cd).toFixed(1)} 帧, C 胜 ${cd.filter(v => v > 0).length}/20`);
console.log(`  A vs B (信号维度 8→32, 驱动不变): 中位数 ${median(perSeed.wide.map((v, i) => v - perSeed.v1[i])).toFixed(1)} 帧, B 胜 ${perSeed.wide.map((v, i) => v - perSeed.v1[i]).filter(v => v > 0).length}/20`);
console.log('');
console.log('  读法：');
console.log('   · C ≈ A  → 每通道 4 细胞是冗余，B 的损失来自通道内容本身');
console.log('   · C << A → 驱动广度本身值钱，B 的损失至少部分是「每通道只 1 个细胞」造成的');
console.log('   · C ≈ B  → 决定性因素是「每通道只 1 个细胞」，与通道数无关');
