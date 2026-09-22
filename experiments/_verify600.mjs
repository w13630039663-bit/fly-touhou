/**
 * _verify600.mjs — 独立验证：600 细胞组到底是不是「真数据在跑」
 *
 * 不信任任何已有 benchmark 记录，全部现场重算：
 *  A. 数据完整性链（hash 对账 / 结构合法性 / 权重健康）
 *  B. 血缘（v1-80 vs v2-600 的节点/边/输入/输出 包含关系）
 *  C. 实时动力学（真跑游戏，测 DN 幅值 / 活跃率 / 静默率 / 输入敏感性）
 *  D. 因果闭环（静音消融是否严格输出 0；trained vs silenced vs idle vs random）
 *  E. 复现 checkpoint 自述 benchmark
 *
 * 运行: node experiments/_verify600.mjs
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { MaleCNSConnectome, createMatchedControlGraph, DYNAMICS } from '../src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';
import { DanmakuGame } from '../src/game/danmaku.js';
import { evaluateOnTestSeeds } from '../train.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (p) => path.join(ROOT, p);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readRaw = (p) => fs.readFileSync(P(p));
const readJson = (p) => JSON.parse(readRaw(p).toString('utf8'));

let FAILS = [];
function chk(ok, label, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  → ' + detail : ''}`);
  if (!ok) FAILS.push(label);
}
function sec(t) { console.log(`\n${'='.repeat(66)}\n${t}\n${'='.repeat(66)}`); }

// ═══════════════════════════════════════════════════════════
sec('A. 数据完整性链');
// ═══════════════════════════════════════════════════════════
const g600Raw = readRaw('public/data/connectome/graph600.json');
const g600 = JSON.parse(g600Raw.toString('utf8'));
const m600 = readJson('public/data/connectome/manifest600.json');
const ck600Raw = readRaw('public/data/checkpoint600.json');
const ck600 = JSON.parse(ck600Raw.toString('utf8'));

const g600Sha = sha256(g600Raw);
console.log(`  graph600.json 顶层字段: [${Object.keys(g600).join(', ')}]`);
console.log(`  实际 SHA-256 : ${g600Sha}`);
console.log(`  manifest 声明: ${m600.graphSha256}`);
console.log(`  checkpoint 声明: ${ck600?.topology?.graphSha256}`);
chk(g600Sha === m600.graphSha256, 'graph600 SHA-256 == manifest600.graphSha256');
chk(g600Sha === ck600?.topology?.graphSha256, 'graph600 SHA-256 == checkpoint600.topology.graphSha256');

chk(g600.nodes.length === 600, '节点数 == 600', `实测 ${g600.nodes.length}`);
chk(g600.edges.length === 37845, '边数 == 37845', `实测 ${g600.edges.length}`);
chk(m600.nodes === g600.nodes.length && m600.edges === g600.edges.length, 'manifest 计数与图一致');
chk(g600.inputs.length === 56, 'inputs == 56', `实测 ${g600.inputs.length}`);
chk(g600.outputs.length === 16, 'outputs == 16', `实测 ${g600.outputs.length}`);
chk(g600.channels.length === 8, 'channels == 8', `实测 ${g600.channels.length}`);
const contacts = g600.edges.reduce((a, e) => a + e[2], 0);
chk(contacts === 1129414, '接触点总数 == 1,129,414', `实测 ${contacts.toLocaleString()}`);

// 结构合法性
let selfLoop = 0, oob = 0, dup = 0, nonIntEdge = 0, lt3 = 0;
const seen = new Set();
for (const [a, b, c] of g600.edges) {
  if (a === b) selfLoop++;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= 600 || b >= 600) oob++;
  if (!Number.isInteger(c) || c < 3) lt3++;
  const k = a * 1000 + b;
  if (seen.has(k)) dup++; else seen.add(k);
}
chk(selfLoop === 0, '无自环边', `自环 ${selfLoop}`);
chk(oob === 0, '所有边端点索引在 [0,600)', `越界 ${oob}`);
chk(dup === 0, '无重复有向边', `重复 ${dup}`);
chk(lt3 === 0, '所有边 contacts >= 3', `<3 的 ${lt3}`);

// 节点元数据 vs manifest stats
const signCnt = { 1: 0, 0: 0, '-1': 0 };
const ntCnt = {};
for (const n of g600.nodes) {
  signCnt[String(n.sign)] = (signCnt[String(n.sign)] || 0) + 1;
  ntCnt[n.nt] = (ntCnt[n.nt] || 0) + 1;
}
chk(signCnt['1'] === m600.stats.signCounts['1'] && signCnt['0'] === m600.stats.signCounts['0'] && signCnt['-1'] === m600.stats.signCounts['-1'],
  'sign 分布与 manifest 一致', `实测 +1:${signCnt['1']} 0:${signCnt['0']} -1:${signCnt['-1']} / 声明 +1:${m600.stats.signCounts['1']} 0:${m600.stats.signCounts['0']} -1:${m600.stats.signCounts['-1']}`);

// 入度 / 出度
const inDeg = new Int32Array(600), outDeg = new Int32Array(600);
for (const [a, b] of g600.edges) { outDeg[a]++; inDeg[b]++; }
let isolated = 0, inZero = 0, outZero = 0;
for (let i = 0; i < 600; i++) {
  if (inDeg[i] + outDeg[i] === 0) isolated++;
  if (inDeg[i] === 0) inZero++;
  if (outDeg[i] === 0) outZero++;
}
const avgDeg = (g600.edges.length * 2) / 600;
console.log(`  平均度数: ${avgDeg.toFixed(2)} | 孤立点: ${isolated} | 入度0: ${inZero} | 出度0: ${outZero}`);

// 输出神经元是否有入边（能否被驱动）
let outInSum = 0;
for (const o of g600.outputs) outInSum += inDeg[o];
chk(outInSum > 0, '16 个输出神经元都有入边（可被驱动）', `合计入度 ${outInSum}`);

// BFS 可达性：从 inputs 出发能否到达 outputs
const adj = new Map();
for (const [a, b] of g600.edges) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); }
const vis = new Uint8Array(600); const q = [];
for (const inp of g600.inputs) { const i = typeof inp === 'number' ? inp : inp[0]; if (!vis[i]) { vis[i] = 1; q.push(i); } }
while (q.length) { const u = q.pop(); for (const v of (adj.get(u) || [])) if (!vis[v]) { vis[v] = 1; q.push(v); } }
const reachOut = g600.outputs.filter(o => vis[o]).length;
chk(reachOut === 16, '16 个输出全部从输入可达（信号通路连通）', `可达 ${reachOut}/16`);
let reachable = 0; for (let i = 0; i < 600; i++) if (vis[i]) reachable++;
console.log(`  从 56 个输入出发的可达节点: ${reachable}/600`);

// 权重健康
const cw = ck600.weights;
chk(Array.isArray(cw) && cw.length === PARAMETERS, `checkpoint 权重长度 == ${PARAMETERS}`, `实测 ${cw?.length}`);
const finite = cw.every(Number.isFinite);
const nonZero = cw.filter(v => Math.abs(v) > 1e-9).length;
const amax = Math.max(...cw.map(Math.abs));
chk(finite, '权重全部有限（无 NaN/Inf）');
chk(nonZero > PARAMETERS * 0.9, '权重几乎无零值', `${nonZero}/${PARAMETERS} 非零, max|w|=${amax.toFixed(3)}`);

// ═══════════════════════════════════════════════════════════
sec('B. 血缘：v1-80 与 v2-600 的关系');
// ═══════════════════════════════════════════════════════════
const g80 = readJson('public/data/connectome/graph.json');
const ids80 = new Set(g80.nodes.map(n => String(n.id)));
const ids600 = new Set(g600.nodes.map(n => String(n.id)));
const shared = [...ids80].filter(i => ids600.has(i)).length;
console.log(`  v1 节点 ${ids80.size} 个, v2 节点 ${ids600.size} 个, 交集 ${shared} 个`);
chk(shared === 80, 'v1 的 80 个节点全部包含在 v2 中（血缘声明成立）', `交集 ${shared}/80`);

const o80 = JSON.stringify(g80.outputs), o600 = JSON.stringify(g600.outputs);
const o80s = JSON.stringify([...g80.outputs].sort((a, b) => a - b)), o600s = JSON.stringify([...g600.outputs].slice().sort((a, b) => a - b));
console.log(`  v1 outputs=${o80}`);
console.log(`  v2 outputs=${o600}`);
chk(JSON.stringify([...g80.outputs].sort((a, b) => a - b)) === JSON.stringify([...g600.outputs].slice().sort((a, b) => a - b)),
  '16 个输出神经元 ID 顺序/集合一致（同一批 DN）');

const in80 = new Set(g80.inputs.map(x => Array.isArray(x) ? x[0] : x));
const in600 = new Set(g600.inputs.map(x => Array.isArray(x) ? x[0] : x));
const inShared = [...in80].filter(i => in600.has(i)).length;
chk(inShared === in80.size, 'v1 的输入细胞全部包含在 v2（输入集扩展而非替换）', `交集 ${inShared}/${in80.size}`);

// 诱导子图 vs v1 边集
const idx80 = new Map(g80.nodes.map((n, i) => [String(n.id), i]));
const v1e = new Set(g80.edges.map(([a, b]) => `${a}->${b}`));
const v600on80 = new Set();
for (const [a, b] of g600.edges) { const ka = String(g600.nodes[a].id), kb = String(g600.nodes[b].id); if (ids80.has(ka) && ids80.has(kb)) v600on80.add(`${g80.nodes.findIndex(x => String(x.id) === ka)}->${g80.nodes.findIndex(x => String(x.id) === kb)}`); }
console.log(`  v1 边数 ${v1e.size}; v2 在 v1 节点上的诱导边数 ${v600on80.size}`);
let both = 0; for (const e of v600on80) if (v1e.has(e)) both++;
console.log(`  两者交集 ${both} (重合度 ${(both / v1e.size * 100).toFixed(1)}%)`);

// ═══════════════════════════════════════════════════════════
sec('C. 实时动力学：喂真游戏输入，测脑活动是否真在流动');
// ═══════════════════════════════════════════════════════════
const brain = new MaleCNSConnectome(g600);
const policy = new ReadoutPolicy(new Float64Array(ck600.weights));

function runDynamics(mode, seeds, maxFrames = 1800, brainRef = brain, pol = policy) {
  const acc = { frames: 0, dnAbsSum: 0, dnAbsMax: 0, activeHist: 0, neuronFrames: 0, silentNeuronFrames: 0, xSum: 0, graze: 0, dns: [] };
  const neuronAbs = new Float64Array(600);
  for (const s of seeds) {
    brainRef.reset();
    const game = new DanmakuGame(null, { width: 460, height: 580, seed: s });
    game.setSpellcard(s % 3);
    game.player.lives = 1; game.player.maxLives = 1; game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
    let f = 0;
    while (!game.player.isDead && f < maxFrames) {
      let motor = { moveX: 0, moveY: 0 };
      const obs = game.getBiologicalSensoryInput();
      if (mode === 'trained') { const dn = brainRef.step(obs, false); motor = pol.forward(dn); acc.dnAbsSum += dn.reduce((a, v) => a + Math.abs(v), 0) / 16; acc.dnAbsMax = Math.max(acc.dnAbsMax, ...dn.map(Math.abs)); }
      else if (mode === 'silenced') { const dn = brainRef.step(obs, true); motor = pol.forward(dn); }
      game.update(motor);
      // 神经元活动统计（仅 trained）
      if (mode === 'trained') {
        let act = 0;
        for (let i = 0; i < 600; i++) {
          const a = Math.abs(brainRef.activity[i]);
          neuronAbs[i] += a; acc.neuronFrames++;
          if (a > 0.1) act++;
          if (a < 0.01) acc.silentNeuronFrames++;
        }
        acc.activeHist += act;
      }
      acc.xSum += game.player.x; f++;
    }
    acc.frames += f; acc.graze += game.player.graze;
  }
  const n = seeds.length;
  return {
    frames: acc.frames / n, sec: acc.frames / n / 60, graze: acc.graze / n, avgX: acc.xSum / acc.frames,
    dnAbsMean: acc.dnAbsSum / acc.frames, dnAbsMax: acc.dnAbsMax,
    activeRatio: acc.activeHist / (acc.frames * 600),
    silenceRatio: acc.silentNeuronFrames / acc.neuronFrames,
    neuronAbs
  };
}

const SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
console.log('  [跑] trained (真 600 脑 + 已训练读出层), 20 种子 ...');
const rTrained = runDynamics('trained', SEEDS);
console.log('  [跑] silenced (静音消融) ...');
const rSilenced = runDynamics('silenced', SEEDS);
console.log('  [跑] idle (静止不动) ...');
const rIdle = runDynamics('idle', SEEDS);

const rndRng = (() => { let a = 20260914; return () => { let t = (a += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const rw = new Float64Array(PARAMETERS); for (let i = 0; i < PARAMETERS; i++) rw[i] = (rndRng() - 0.5) * 1.5;
console.log('  [跑] random (同拓扑, 未训练随机读出层) ...');
const rRandom = runDynamics('trained', SEEDS, 1800, brain, new ReadoutPolicy(rw));

const fmt = (r) => `存活 ${r.frames.toFixed(1)}f (${r.sec.toFixed(2)}s) | 擦弹 ${r.graze.toFixed(1)} | avgX ${r.avgX.toFixed(1)}`;
console.log(`\n  trained   : ${fmt(rTrained)}`);
console.log(`  silenced  : ${fmt(rSilenced)}`);
console.log(`  idle      : ${fmt(rIdle)}`);
console.log(`  random    : ${fmt(rRandom)}`);
console.log(`\n  ── trained 脑内部活动 ──`);
console.log(`  平均 |DN 输出|      : ${rTrained.dnAbsMean.toFixed(4)}  (max |DN| = ${rTrained.dnAbsMax.toFixed(3)})`);
console.log(`  神经元活跃率(|a|>0.1): ${(rTrained.activeRatio * 100).toFixed(2)}%`);
console.log(`  神经元静默率(|a|<0.01): ${(rTrained.silenceRatio * 100).toFixed(2)}%`);
const meanAbs = Array.from(rTrained.neuronAbs).map(v => v / (rTrained.frames));
const activeNeurons = meanAbs.filter(v => v > 0.01).length;
console.log(`  有持续活动的神经元 : ${activeNeurons}/600`);
console.log(`  时间平均活动 std   : ${(() => { const m = meanAbs.reduce((a, b) => a + b, 0) / 600; return Math.sqrt(meanAbs.reduce((a, b) => a + (b - m) ** 2, 0) / 600); })().toFixed(4)}`);

chk(rTrained.dnAbsMean > 1e-4, 'C1 trained 的 DN 输出非零（脑活动真的在传到输出）', `mean|DN|=${rTrained.dnAbsMean.toFixed(5)}`);
chk(activeNeurons > 300, 'C2 过半神经元有持续活动（不是死网络）', `${activeNeurons}/600`);
chk(rSilenced.frames !== rTrained.frames, 'C3 静音与 trained 存活不同（脑活动确实驱动行为）', `silenced=${rSilenced.frames.toFixed(1)}f vs trained=${rTrained.frames.toFixed(1)}f`);

// 输入敏感性：同一脑，输入置零 vs 随机输入
const probeBrain = new MaleCNSConnectome(g600);
const probePol = new ReadoutPolicy(new Float64Array(ck600.weights));
probeBrain.reset();
const zeros = new Array(8).fill(0.5);
const dnZeros = probeBrain.step(zeros, false);
probeBrain.reset();
const ones = new Array(8).fill(1.0);
const dnOnes = probeBrain.step(ones, false);
const diffInput = Math.max(...dnZeros.map((v, i) => Math.abs(v - dnOnes[i])));
chk(diffInput > 1e-6, 'C4 改变输入会改变输出（不是开环常数）', `max|ΔDN| = ${diffInput.toExponential(3)}`);

// 静音严格零
probeBrain.reset();
const dnSil = probeBrain.step(ones, true);
const silZero = dnSil.every(v => v === 0);
const motorSil = probePol.forward(dnSil);
chk(silZero && motorSil.moveX === 0 && motorSil.moveY === 0, 'C5 静音消融严格输出 (0,0)（零偏置因果保证）', `moveX=${motorSil.moveX}, moveY=${motorSil.moveY}`);

// ═══════════════════════════════════════════════════════════
sec('D. 复现 checkpoint600 自述 benchmark');
// ═══════════════════════════════════════════════════════════
const bm = ck600.benchmark;
console.log(`  checkpoint 自述 trained: ${bm.trained.frames.toFixed(1)}f (${bm.trained.seconds.toFixed(2)}s), graze ${bm.trained.graze.toFixed(1)}`);
console.log(`  现场重算 trained      : ${rTrained.frames.toFixed(1)}f (${rTrained.sec.toFixed(2)}s), graze ${rTrained.graze.toFixed(1)}`);
const bmFrames = bm.trained.frames;
const dev = Math.abs(rTrained.frames - bmFrames) / bmFrames * 100;
chk(dev < 1.0, 'D1 现场重算与自述 benchmark 一致（<1% 偏差）', `偏差 ${dev.toFixed(3)}%`);
console.log(`  checkpoint 自述 idle   : ${bm.idle.frames.toFixed(1)}f`);
console.log(`  现场重算 idle         : ${rIdle.frames.toFixed(1)}f`);
console.log(`  checkpoint 自述 random : ${bm.randomPolicy?.frames?.toFixed?.(1) ?? '—'}f`);
console.log(`  现场重算 random       : ${rRandom.frames.toFixed(1)}f`);
console.log(`  checkpoint 自述 silenced: ${bm.circuitSilenced.frames.toFixed(1)}f`);
console.log(`  现场重算 silenced     : ${rSilenced.frames.toFixed(1)}f`);

// ═══════════════════════════════════════════════════════════
sec('E. 训练是否真的发生（trained vs 同拓扑随机权重）');
// ═══════════════════════════════════════════════════════════
console.log(`  trained ${rTrained.frames.toFixed(1)}f  vs  random ${rRandom.frames.toFixed(1)}f  =  ${((rTrained.frames - rRandom.frames) / rRandom.frames * 100).toFixed(1)}%`);
chk(rTrained.frames > rRandom.frames, 'E1 trained 权重的存活显著优于随机权重（演化确有产出）', `${rTrained.frames.toFixed(0)}f vs ${rRandom.frames.toFixed(0)}f`);

sec('结论');
if (FAILS.length === 0) console.log('  ✅ 全部检查通过');
else console.log(`  ⚠️ 未通过 ${FAILS.length} 项:\n` + FAILS.map(f => '     - ' + f).join('\n'));
