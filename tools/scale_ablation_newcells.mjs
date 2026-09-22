/**
 * tools/scale_ablation_newcells.mjs — PLAN_520 P0.2 选择性消融仪表
 *
 * 问题：600 版 (v600) 比 80 版 (v1) 独立测试存活差 (1235.6f vs 1545f)。
 * 520 个新细胞里有 24 个是感觉输入细胞——全静音 520 会连 43% 的感觉门一起关掉，
 * 所以本工具跑【双口径】：
 *   Δ₀(496) 主口径   = normal − (仅静音 496 个新中间神经元, 保留 24 个新感觉输入)
 *   Δ₀(520) 参考口径 = normal − (静音全部 520 新细胞)
 * 评估栈与 train.js evaluateOnTestSeeds 严格同构 (1800 帧上限 / seed%3 符卡 / lives=1)，
 * 权重取 public/data/checkpoint600.json 的 trained readout (历史冠军, 位固定)。
 *
 * 用法: node tools/scale_ablation_newcells.mjs [--write]
 *   --write 将逐种子帧表落盘 experiments/ablation_newcells.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const argv = process.argv.slice(2);
const argVal = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const GRAPH = argVal('--graph', 'public/data/connectome/graph600.json');
const CKPT = argVal('--ckpt', 'public/data/checkpoint600.json');

const g600 = readJson(GRAPH);
const g1 = readJson('public/data/connectome/graph.json');
const ck = readJson(CKPT);

// ---- 名册（确定性规则: v1 body-ID 集之外即新细胞；与 manifest600.roster 对齐） ----
const v1ids = new Set(g1.nodes.map((n) => n.id));
const newIdxs = [];
const new496 = [];
const newInput = [];
g600.nodes.forEach((n, i) => {
  if (!v1ids.has(n.id)) {
    newIdxs.push(i);
    ((n.role || 'interneuron') === 'input' ? newInput : new496).push(i);
  }
});
if (newIdxs.length !== 520 || new496.length !== 496 || newInput.length !== 24) {
  throw new Error(`名册校验失败: 520/496/24 → 实际 ${newIdxs.length}/${new496.length}/${newInput.length}`);
}
console.log(`名册: 新细胞 ${newIdxs.length} = 中间 ${new496.length} + 新输入 ${newInput.length} (v1 细胞 80/80 在场)`);

// ---- 与 train.js.evaluateOnTestSeeds 同构的评估栈 ----
const weights = new Float64Array(ck.weights);
const testSeeds = Array.from({ length: 20 }, (_, i) => 80001 + i);

function evalMode(maskIdxs) {
  const brain = new MaleCNSConnectome(g600);
  brain.silenceNodes(maskIdxs);
  // v7 增益向量: 与 train.js 基准栈一致, 把 322 权重向量的增益装到 brain 上
  if (weights.length > 320) brain.applyDnGains(weights[320], weights[321]);
  const policy = new ReadoutPolicy(weights);
  const perSeed = [];
  for (const s of testSeeds) {
    brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed: s });
    game.setSpellcard(s % 3);
    game.player.lives = 1;
    game.player.maxLives = 1;
    game.player.autoRespawn = false;
    game.player.invulnerableTimer = 0;
    let f = 0;
    while (!game.player.isDead && f < 1800) {
      const obs = game.getBiologicalSensoryInput();
      const dn = brain.step(obs, false);
      const motor = policy.forward(dn);
      game.update(motor);
      f++;
    }
    perSeed.push(f);
  }
  return { frames: perSeed.reduce((a, b) => a + b, 0) / perSeed.length, perSeedFrames: perSeed };
}

console.log('评估中（3 模式 × 20 种子 × ≤1800 帧）…');
const normal = evalMode(null);
const sil496 = evalMode(new496);
const sil520 = evalMode(newIdxs);

const mean = (r) => r.frames;
const wins = (a, b) => a.perSeedFrames.filter((x, i) => x > b.perSeedFrames[i]).length;
console.log('------------------------------------------------------');
console.log(`normal            : ${mean(normal).toFixed(1)}f  (对照 checkpoint600.benchmark.trained=${ck.benchmark.trained.frames.toFixed(1)}f, 应一致)`);
console.log(`Δ₀(496) 主口径    : ${(mean(normal) - mean(sil496)).toFixed(1)}f  (silenced496=${mean(sil496).toFixed(1)}f, 胜出种子 ${wins(normal, sil496)}/20)`);
console.log(`Δ₀(520) 参考口径  : ${(mean(normal) - mean(sil520)).toFixed(1)}f  (silenced520=${mean(sil520).toFixed(1)}f, 胜出种子 ${wins(normal, sil520)}/20)`);
console.log('解读: Δ₀ 大 ⇒ 新细胞群在现有规模下确有净贡献; Δ₀ ≈ 0 ⇒ 只是稀释器; Δ₀ < 0 ⇒ 净损害');

if (process.argv.includes('--write')) {
  const suffix = path.basename(CKPT, '.json').replace(/^checkpoint/, '');
  const out = {
    note: `PLAN_520 P0.2 — ${CKPT} trained weights, test seeds 80001-80020, 与 train.js 评估栈同构 (1800f cap)`,
    weightsFrom: CKPT,
    graph: GRAPH,
    graphSha: ck.topology.graphSha256,
    normal,
    silenced496: sil496,
    silenced520: sil520,
    delta0_496: mean(normal) - mean(sil496),
    delta0_520: mean(normal) - mean(sil520)
  };
  fs.writeFileSync(path.join(root, `experiments/ablation_newcells${suffix}.json`), JSON.stringify(out, null, 2));
  console.log(`已写 experiments/ablation_newcells${suffix}.json`);
}
