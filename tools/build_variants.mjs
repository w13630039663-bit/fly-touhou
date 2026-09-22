/**
 * tools/build_variants.mjs — PLAN_520 A.1 / C.1 派生拓扑构建器（确定性后处理，不重跑 Python 生长）
 *
 * graph600a (A.1 加性两段归一化, 单一变量=归一化):
 *   边集与 graph600 完全相同；每条边烘焙最终权重：
 *     段1 = v1 边集成员 (preID->postID ∈ v1): w = contacts·sign / T1[post]，T1 只累计段1
 *     段2 = 其余边 (含新→旧、旧→新、新→新): w = α·contacts·sign / T2[post]，T2 只累计段2
 *   ⇒ 每个 DN 的 |w| 段1 和 ≈1、段2 和 ≈α (α=1 时总驱动上限 ≈2)。
 *   注意: v1→DN 在 graph600 里被 ≥3 接触阈值裁掉 114 条，A 图不恢复它们（保持单变量）。
 *
 * graph600b (C.1 v1 读出恢复, 语义 = v1 读出 + 520 新细胞调制 v1 上游):
 *   剔除全部 新→DN 边 (833)；放回全部 450 条被裁 v1 边 (含 114 条汇入 DN)。
 *   边序 = v1 原 1296 边按原序在前 + v600 独有边按原序在后
 *   ⇒ DN 入边集与 v1 逐位相同，且 totals[DN] 浮点累加顺序与 v1 一致 ⇒ DN 权重位等价 v1。
 *   不烘焙权重，运行时单段归一化即可（这正是等价性的来源，见 C.1b 注记）。
 *
 * 自检（任一失败即 throw）:
 *   [S1] v1 细胞 80/80 在两图在场; [S2] 保留 v1 边 contacts 与 v1 逐条相等;
 *   [S3] b 图 DN 入边 = v1 DN 入边 (按 body-ID 三元组集合相等) 且权重位等价 v1;
 *   [S4] a 图每 DN 段1 |w| 和 ≈1、段2 |w| 和 ≈α; [S5] a 图边数/接触与 graph600 相同;
 *   [S6] 饱和画像: 20 测试种子真实对局轨迹下 max|scratch[DN]|>2 的帧占比 (a vs 600 vs v1)。
 *
 * 用法: node tools/build_variants.mjs [--alpha 1]
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { DanmakuGame } from '../src/game/danmaku.js';
import { MaleCNSConnectome, DYNAMICS } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');

const ALPHA = Number(process.argv.includes('--alpha') ? process.argv[process.argv.indexOf('--alpha') + 1] : '1');

const g1 = readJson('public/data/connectome/graph.json');
const g6 = readJson('public/data/connectome/graph600.json');
const ck6 = readJson('public/data/checkpoint600.json');
const sha1 = sha('public/data/connectome/graph.json');
const sha6 = sha('public/data/connectome/graph600.json');

// ---------- 索引与名册 ----------
const id6 = g6.nodes.map((n) => n.id);
const idx6 = new Map(id6.map((id, i) => [id, i]));
const v1ids = new Set(g1.nodes.map((n) => n.id));
const isNew6 = (i) => !v1ids.has(g6.nodes[i].id);
const dnIdx6 = new Set(g6.outputs);
const dnIdx1 = new Set(g1.outputs);
const idOf1 = (i) => g1.nodes[i].id;
const idOf6 = (i) => g6.nodes[i].id;

// v1 边集 (body-ID 键) — 注意 v1 边数组是 [preIdx, postIdx, contacts]，端点是数组下标！
const v1EdgeByKey = new Map();
for (const [a, b, c] of g1.edges) v1EdgeByKey.set(`${idOf1(a)}->${idOf1(b)}`, c);
const v6EdgeByKey = new Map();
for (const [a, b, c] of g6.edges) v6EdgeByKey.set(`${idOf6(a)}->${idOf6(b)}`, c);

// [S1] 80/80
const v1In6 = g1.nodes.filter((n) => idx6.has(n.id)).length;
if (v1In6 !== 80) throw new Error(`[S1] v1 细胞 ${v1In6}/80 在场`);
// [S2] 保留边 contacts 逐条相等
let kept = 0, lost = 0, mismatch = 0;
for (const [k, c] of v1EdgeByKey) {
  if (v6EdgeByKey.has(k)) { kept++; if (v6EdgeByKey.get(k) !== c) mismatch++; }
  else lost++;
}
if (mismatch) throw new Error(`[S2] ${mismatch} 条保留 v1 边 contacts 不一致`);
console.log(`[S1] v1 细胞 ${v1In6}/80 ✓  [S2] v1 边: 保留 ${kept} / 被裁 ${lost}, contacts 全等 ✓`);

// ---------- graph600a: 加性两段烘焙 ----------
const T1 = new Float64Array(g6.nodes.length);
const T2 = new Float64Array(g6.nodes.length);
const segOf = g6.edges.map(([a, b]) => (v1EdgeByKey.has(`${idOf6(a)}->${idOf6(b)}`) ? 1 : 2));
g6.edges.forEach(([a, b, c], i) => {
  const m = c * Math.abs(g6.nodes[a].sign);
  (segOf[i] === 1 ? T1 : T2)[b] += m;
});
const edgesA = g6.edges.map(([a, b, c], i) => {
  const s = g6.nodes[a].sign;
  const w = segOf[i] === 1
    ? (T1[b] ? (c * s) / T1[b] : 0)
    : (T2[b] ? (ALPHA * c * s) / T2[b] : 0);
  return [a, b, c, w];
});

// ---------- graph600b: v1 读出恢复 ----------
const edgesB = [];
for (const [a, b, c] of g1.edges) edgesB.push([idx6.get(idOf1(a)), idx6.get(idOf1(b)), c]); // v1 原序在前
for (const [a, b, c] of g6.edges) {
  if (v1EdgeByKey.has(`${idOf6(a)}->${idOf6(b)}`)) continue; // 已在 v1 块
  if (dnIdx6.has(b) && isNew6(a)) continue;                  // 剔除 新→DN
  edgesB.push([a, b, c]);                                    // v600 独有边原序在后
}

const derivedNote = (what) => ({
  derivedFrom: { graph: 'graph600.json', graphSha256: sha6, v1Graph: 'graph.json', v1Sha256: sha1 },
  derivation: what,
  builder: 'tools/build_variants.mjs',
  alpha: ALPHA,
  noGameOutcomesUsed: true
});
const base = { nodes: g6.nodes, inputs: g6.inputs, outputs: g6.outputs, channels: g6.channels };
const graphA = { version: 'malecns-600a-additive-readout-v1', ...base, edges: edgesA, derived: derivedNote('additive two-segment normalization baked into edge weights') };
const graphB = { version: 'malecns-600b-v1readout-upstream600-v1', ...base, edges: edgesB, derived: derivedNote('remove all new->DN edges; restore all pruned v1 edges; DN edge set & per-post totals bit-identical to v1') };

const outA = path.join(root, 'public/data/connectome/graph600a.json');
const outB = path.join(root, 'public/data/connectome/graph600b.json');
fs.writeFileSync(outA, JSON.stringify(graphA));
fs.writeFileSync(outB, JSON.stringify(graphB));

// ---------- 自检 ----------
const brain1 = new MaleCNSConnectome(g1);
const brainA = new MaleCNSConnectome(graphA);
const brainB = new MaleCNSConnectome(graphB);

// [S3] b 图 DN 权重位等价 v1
{
  const dnW = (brain, idOf) => {
    const m = new Map();
    for (const e of brain.edges) {
      const pid = idOf(e.post);
      if (!dnIdx1.has(g1.nodes.findIndex((n) => n.id === pid))) continue;
      const key = `${idOf(e.pre)}->${pid}`;
      if (!m.has(pid)) m.set(pid, []);
      m.get(pid).push([key, e.weight]);
    }
    for (const [, arr] of m) arr.sort((x, y) => (x[0] < y[0] ? -1 : 1));
    return m;
  };
  const w1 = dnW(brain1, idOf1);
  const wB = dnW(brainB, idOf6);
  let n = 0, bad = 0;
  for (const [pid, arr1] of w1) {
    const arrB = wB.get(pid) || [];
    if (arr1.length !== arrB.length) { bad++; continue; }
    for (let i = 0; i < arr1.length; i++) { n++; if (arr1[i][0] !== arrB[i][0] || arr1[i][1] !== arrB[i][1]) bad++; }
  }
  const newToDnB = brainB.edges.filter((e) => dnIdx6.has(e.post) && isNew6(e.pre)).length;
  if (bad || newToDnB) throw new Error(`[S3] FAIL bad=${bad} newToDN=${newToDnB}`);
  console.log(`[S3] b 图 DN 入边 ${n} 条与 v1 位等价 ✓ (新→DN 残留 ${newToDnB})`);
}

// [S4] a 图 DN 段和
{
  let worst = 0;
  for (const dn of g6.outputs) {
    let s1 = 0, s2 = 0;
    brainA.edges.forEach((e, i) => {
      if (e.post !== dn) return;
      (segOf[i] === 1 ? (s1 += Math.abs(e.weight)) : (s2 += Math.abs(e.weight)));
    });
    worst = Math.max(worst, Math.abs(s1 - 1), Math.abs(s2 - ALPHA));
  }
  if (worst > 1e-12) throw new Error(`[S4] a 图 DN 段和偏差 ${worst}`);
  console.log(`[S4] a 图 16 DN 段1|w|和≈1、段2|w|和≈α ✓ (最大偏差 ${worst.toExponential(1)})`);
}

// [S5] a 图边集守恒
{
  const cA = edgesA.reduce((a, e) => a + e[2], 0);
  const c6 = g6.edges.reduce((a, e) => a + e[2], 0);
  if (edgesA.length !== g6.edges.length || cA !== c6) throw new Error('[S5] a 图边集不守恒');
  console.log(`[S5] a 图边数 ${edgesA.length} / 接触 ${c6} 与 graph600 相同 ✓ | b 图边数 ${edgesB.length} (600: ${g6.edges.length}, 剔 ${g6.edges.length - edgesB.length + (kept ? 0 : 0)} 裁补净额)`);
}

// [S6] 饱和画像: 真实对局轨迹下 max|scratch[DN]|>2 帧占比
function saturation(brain, weights) {
  const policy = new ReadoutPolicy(weights);
  let satFrames = 0, frames = 0, maxIn = 0;
  for (const s of Array.from({ length: 20 }, (_, i) => 80001 + i)) {
    brain.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed: s });
    game.setSpellcard(s % 3);
    game.player.lives = 1; game.player.maxLives = 1; game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
    let f = 0;
    while (!game.player.isDead && f < 1800) {
      const dn = brain.step(game.getBiologicalSensoryInput(), false);
      let mx = 0;
      for (const idx of brain.outputs) mx = Math.max(mx, Math.abs(brain.scratch[idx]));
      maxIn = Math.max(maxIn, mx);
      if (mx > 2) satFrames++;
      frames++;
      game.update(policy.forward(dn));
      f++;
    }
  }
  return { satPct: (100 * satFrames) / frames, maxIn };
}
const w6 = new Float64Array(ck6.weights);
const sat6 = saturation(new MaleCNSConnectome(g6), w6);
const satA = saturation(brainA, w6);
const satV1 = saturation(brain1, new Float64Array(readJson('public/data/checkpoint.json').weights));
console.log(`[S6] 饱和帧占比 (|DN 输入|>2): v1 ${satV1.satPct.toFixed(1)}% | 600 ${sat6.satPct.toFixed(1)}% | 600a ${satA.satPct.toFixed(1)}% (max|in|: ${satV1.maxIn.toFixed(2)}/${sat6.maxIn.toFixed(2)}/${satA.maxIn.toFixed(2)})`);
if (satA.satPct > 10) console.log(`⚠️ a 图饱和帧占比 ${satA.satPct.toFixed(1)}% > 10% — 按预案重训时用 --alpha 0.5 重建`);

const shaAbs = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
console.log(`\nWROTE ${path.relative(root, outA)} (${fs.statSync(outA).size} B, sha ${shaAbs(outA).slice(0, 12)}…)`);
console.log(`WROTE ${path.relative(root, outB)} (${fs.statSync(outB).size} B, sha ${shaAbs(outB).slice(0, 12)}…)`);
console.log(`DYNAMICS 不变: ${JSON.stringify(DYNAMICS)} | α=${ALPHA}`);
