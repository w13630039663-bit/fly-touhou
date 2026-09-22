/**
 * test_integration.js - 全链路端到端无头集成测试（双拓扑数据集：80 v1 / 600 v2 通路闭包）
 *
 * 每个数据集校验：
 *  - graph.json 节点/边计数与 manifest 一致，manifest.graphSha256 与文件实际哈希一致（数据完整性链）
 *  - 120 帧正常仿真 + 60 帧消融静音（因果全零）+ 三个 Stage 闯关
 *  - Readout checkpoint（存在时）拓扑自描述与 graph 匹配
 * 另: Maslov-Sneppen matched control 度保持性质冒烟检查。
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { MaleCNSConnectome, createMatchedControlGraph } from './src/brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from './src/brain/policy.js';
import { DanmakuGame } from './src/game/danmaku.js';
import { BrainVisualizer } from './src/visualizer/brain_view.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// 创建 Mock Canvas
function createMockCanvas(w = 520, h = 700) {
  const ctx = {
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fillText: () => {},
    measureText: (text) => ({ width: (text || '').length * 5.2 }),
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    rotate: () => {},
    translate: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    setLineDash: () => {},
    setTransform: () => {},
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    resetTransform: () => {},
    shadowColor: '',
    shadowBlur: 0,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    globalAlpha: 1.0
  };
  return {
    width: w,
    height: h,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    getContext: () => ctx
  };
}

const DATASETS = [
  {
    label: 'MaleCNS-80 v1',
    graph: 'public/data/connectome/graph.json',
    manifest: 'public/data/connectome/manifest.json',
    checkpoint: 'public/data/checkpoint.json',
    expectNodes: 80,
    expectEdges: 1296,
    checkpointRequired: true
  },
  {
    label: 'MaleCNS-600 v2 closure',
    graph: 'public/data/connectome/graph600.json',
    manifest: 'public/data/connectome/manifest600.json',
    checkpoint: 'public/data/checkpoint600.json',
    expectNodes: 600,
    expectEdges: 37845,
    checkpointRequired: true // 600 细胞重训已完成 (checkpoint600.json, 拓扑自描述+哈希守卫)
  },
  {
    label: 'MaleCNS-600a additive-norm (PLAN_520 A)',
    graph: 'public/data/connectome/graph600a.json',
    manifest: 'public/data/connectome/manifest600a.json',
    checkpoint: 'public/data/checkpoint600a.json',
    expectNodes: 600,
    expectEdges: 37845,
    checkpointRequired: true
  },
  {
    label: 'MaleCNS-600b v1-readout restore (PLAN_520 C)',
    graph: 'public/data/connectome/graph600b.json',
    manifest: 'public/data/connectome/manifest600b.json',
    checkpoint: 'public/data/checkpoint600b.json',
    expectNodes: 600,
    expectEdges: 37462,
    checkpointRequired: true
  }
];

async function runDataset(ds) {
  console.log(`\n── ${ds.label} ────────────────────────────`);
  const graphPath = path.join(__dirname, ds.graph);
  const graphData = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, ds.manifest), 'utf8'));

  if (manifest.graphSha256 !== sha256File(graphPath)) {
    throw new Error(`manifest.graphSha256 与 ${ds.graph} 实际哈希不符`);
  }
  if (manifest.nodes !== ds.expectNodes || manifest.edges !== ds.expectEdges) {
    throw new Error(`manifest 计数异常: ${manifest.nodes}/${manifest.edges}`);
  }
  if (graphData.nodes.length !== manifest.nodes || graphData.edges.length !== manifest.edges) {
    throw new Error(`graph 文件与 manifest 计数不符`);
  }
  const contacts = graphData.edges.reduce((a, e) => a + e[2], 0);
  if (contacts !== manifest.synapticContacts) {
    throw new Error(`突触接触点总数不符: graph ${contacts} vs manifest ${manifest.synapticContacts}`);
  }
  console.log(`✓ 数据完整性链: ${manifest.nodes} 节点 / ${manifest.edges} 边 / ${contacts} 接触点, sha256 匹配`);

  const brain = new MaleCNSConnectome(graphData);
  if (!brain.isReady || brain.count !== ds.expectNodes) throw new Error('Connectome 初始化失败');

  let policy;
  const ckPath = path.join(__dirname, ds.checkpoint);
  if (fs.existsSync(ckPath)) {
    const checkpointData = JSON.parse(fs.readFileSync(ckPath, 'utf8'));
    if (checkpointData.topology && checkpointData.topology.neurons && checkpointData.topology.neurons !== graphData.nodes.length) {
      throw new Error(`checkpoint 拓扑自描述 (${checkpointData.topology.neurons}) 与当前 graph (${graphData.nodes.length}) 不符`);
    }
    policy = new ReadoutPolicy(new Float64Array(checkpointData.weights));
    console.log(`✓ ReadoutPolicy checkpoint 载入 (${policy.weights.length} 参数, 拓扑匹配)`);
  } else {
    if (ds.checkpointRequired) throw new Error(`缺少 checkpoint: ${ds.checkpoint}`);
    policy = new ReadoutPolicy();
    console.log(`⚠ checkpoint 未就绪 (${ds.checkpoint})，使用随机权重跑通链路（软通过）`);
  }

  const gameCanvas = createMockCanvas(460, 580);
  const brainCanvas = createMockCanvas(560, 268);
  const game = new DanmakuGame(gameCanvas, { difficulty: 'Normal' });
  const visualizer = new BrainVisualizer(brainCanvas, brain);
  visualizer.prepareIndices();
  visualizer.layoutNodes();
  visualizer.baseDirty = true;

  for (let f = 0; f < 120; f++) {
    const obs = game.getBiologicalSensoryInput();
    if (obs.length !== 8) throw new Error('观察值长度应为 8');
    const dnOutputs = brain.step(obs, false);
    if (dnOutputs.length !== 16) throw new Error('DN 输出长度应为 16');
    if (!dnOutputs.every(Number.isFinite)) throw new Error('DN 输出出现非有限值');
    const motor = policy.forward(dnOutputs);
    if (typeof motor.moveX !== 'number' || typeof motor.moveY !== 'number') throw new Error('动作输出格式异常');
    if (!nodesFinite(brain)) throw new Error('神经元 activity 出现 NaN');
    game.update(motor);
    visualizer.update();
    visualizer.render();
  }
  console.log('✓ 正常模式 120 帧 (渲染全链路, 无 NaN)');

  brain.lesions.silenced = true;
  for (let f = 0; f < 60; f++) {
    const obs = game.getBiologicalSensoryInput();
    const dnOutputs = brain.step(obs, true);
    if (dnOutputs.some((v) => v !== 0)) throw new Error('消融状态下 DN 输出应全为 0');
    const motor = policy.forward(dnOutputs);
    if (motor.moveX !== 0 || motor.moveY !== 0) throw new Error('零偏置策略消融静音输出应严格为 0');
    game.update(motor);
    visualizer.update();
    visualizer.render();
  }
  brain.lesions.silenced = false;
  console.log('✓ 消融静音模式 60 帧 (因果输出全 0)');

  for (let s = 1; s <= 3; s++) {
    game.setGameMode('stage');
    game.startStage(s);
    for (let f = 0; f < 30; f++) {
      const obs = game.getBiologicalSensoryInput();
      const dnOutputs = brain.step(obs, false);
      const motor = policy.forward(dnOutputs);
      game.update(motor);
      visualizer.update();
      visualizer.render();
    }
  }
  console.log('✓ 闯关 Stage 1-3 模拟通过');

  // matched control 度保持性质冒烟
  const ctrl = createMatchedControlGraph(graphData, 42);
  if (ctrl.nodes.length !== graphData.nodes.length || ctrl.edges.length !== graphData.edges.length) {
    throw new Error('matched control 节点/边数不守恒');
  }
  const degOf = (edges, which) => {
    const m = new Map();
    for (const e of edges) { const k = e[which]; m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const dOutA = degOf(graphData.edges, 0), dOutB = degOf(ctrl.edges, 0);
  const dInA = degOf(graphData.edges, 1), dInB = degOf(ctrl.edges, 1);
  const sameDeg = (a, b) => a.size === b.size && [...a.keys()].every(k => a.get(k) === b.get(k));
  if (!sameDeg(dOutA, dOutB) || !sameDeg(dInA, dInB)) throw new Error('matched control 度分布不守恒');
  if (ctrl.successfulSwaps < graphData.edges.length * 0.1) {
    console.log(`⚠ matched control 交换次数偏低: ${ctrl.successfulSwaps}`);
  } else {
    console.log(`✓ matched control 度守恒冒烟通过 (swaps=${ctrl.successfulSwaps})`);
  }
}

function nodesFinite(brain) {
  for (let i = 0; i < brain.count; i++) if (!Number.isFinite(brain.nodes[i].activity)) return false;
  return true;
}

async function runTest() {
  console.log('🧪 开始执行全链路端到端测试（双拓扑数据集）...');
  if (PARAMETERS !== 320) throw new Error('PARAMETERS 应恒为 320（16x16+16x4 解码器契约）');
  for (const ds of DATASETS) await runDataset(ds);
  console.log('\n🎉 所有端到端集成测试全部通过 (0 错误)！系统完全就绪！');
}

runTest().catch(err => {
  console.error('❌ 集成测试失败:', err);
  process.exit(1);
});
