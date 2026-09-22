/**
 * connectome.js - HHMI Janelia MaleCNS v1.0 真实局部连接组动力学引擎
 * 
 * 80 个真实测定神经元 (32 视觉传入 + 32 桥接中继 + 16 下行运动)
 * 1,296 条真实突触测量有向边, 26,029 个物理接触点 (CC BY 4.0)
 * 
 * 纯动力学储备池演化 (Reservoir Computing):
 * h[i] = 0.3 * h[i] + 0.7 * tanh(u[i] + 1.4 * sum_j(W[j,i] * h[j]))
 * 绝无人工势场外挂与直接灌流作弊
 */

export const DYNAMICS = { iterations: 3, leak: 0.7, gain: 1.4, outputGain: 4.0 };

export class MaleCNSConnectome {
  constructor(graphData = null) {
    this.graph = graphData;
    this.isReady = false;
    this.nodes = [];
    this.edges = [];
    this.inputs = [];
    this.outputs = [];
    this.channels = [];

    this.activity = null;
    this.scratch = null;
    this.drive = null;

    // 消融实验状态
    this.lesions = {
      silenced: false // 大脑静音 (Circuit Silenced)
    };

    // 脉冲事件记录（供可视化高亮）
    this.recentSpikes = [];

    if (graphData) {
      this.initGraph(graphData);
    }
  }

  async loadFromUrl(url = '/public/data/connectome/graph.json') {
    const res = await fetch(url);
    const data = await res.json();
    this.initGraph(data);
    return this;
  }

  initGraph(graph) {
    this.graph = graph;
    const count = graph.nodes.length;
    this.count = count;
    this.nodes = graph.nodes.map((n, idx) => ({
      ...n,
      idx,
      // 归一化解剖坐标到 0~1 空间便于 Canvas 渲染
      normX: (n.position[0] - 30000) / 60000,
      normY: (n.position[1] - 10000) / 40000,
      normZ: (n.position[2] - 10000) / 40000,
      activity: 0.0,
      spiked: false
    }));

    this.inputs = graph.inputs;
    this.outputs = graph.outputs;
    this.channels = graph.channels;

    const totals = new Float64Array(count);
    for (const [pre, post, contacts] of graph.edges) {
      totals[post] += contacts * Math.abs(graph.nodes[pre].sign);
    }

    this.edges = graph.edges.map(([pre, post, contacts]) => ({
      pre,
      post,
      contacts,
      weight: totals[post] ? (contacts * graph.nodes[pre].sign) / totals[post] : 0,
      type: graph.nodes[pre].sign < 0 ? 'inhibitory' : 'excitatory'
    }));

    this.activity = new Float64Array(count);
    this.scratch = new Float64Array(count);
    this.drive = new Float64Array(count);

    // 建立 ID 与 Type 快速索引
    this.neuronMap = new Map();
    this.nodes.forEach(n => {
      this.neuronMap.set(String(n.id), n);
      this.neuronMap.set(n.type, n);
      this.neuronMap.set(n.idx, n);
    });

    this.synapses = this.edges;
    this.neurons = this.nodes;
    this.isReady = true;
    console.log(`[MaleCNS] 成功初始化连接组: ${count} 节点, ${this.edges.length} 突触边`);
  }

  reset() {
    if (this.activity) {
      this.activity.fill(0);
      this.scratch.fill(0);
      this.drive.fill(0);
    }
  }

  /**
   * 单步动力学推演
   * @param {number[]} sensoryInputs 8 通道归一化视觉感觉输入 [0, 1]
   * @param {boolean} ablated 是否处于消融静音状态
   * @returns {number[]} 16 个下行神经元的放电输出
   */
  step(sensoryInputs, ablated = false) {
    if (!this.isReady) return new Array(16).fill(0);

    // 若处于消融静音测试状态，全部神经元置零
    if (ablated || this.lesions.silenced) {
      this.activity.fill(0);
      for (let i = 0; i < this.count; i++) {
        this.nodes[i].activity = 0;
        this.nodes[i].spiked = false;
      }
      return this.outputs.map(() => 0);
    }

    // 1. 注入 8 通道特征到 32 个视觉细胞
    this.drive.fill(0);
    for (const [cell, channel] of this.inputs) {
      const val = sensoryInputs[channel] !== undefined ? sensoryInputs[channel] : 0.5;
      this.drive[cell] = 2.0 * (val - 0.5);
    }

    // 2. 泄漏循环动力学迭代 (Leaky Recurrent Tanh Dynamics)
    this.recentSpikes = [];
    for (let t = 0; t < DYNAMICS.iterations; t++) {
      this.scratch.set(this.drive);
      for (let e = 0; e < this.edges.length; e++) {
        const edge = this.edges[e];
        this.scratch[edge.post] += DYNAMICS.gain * edge.weight * this.activity[edge.pre];
      }
      for (let i = 0; i < this.count; i++) {
        const prev = this.activity[i];
        const next = (1 - DYNAMICS.leak) * prev + DYNAMICS.leak * Math.tanh(this.scratch[i]);
        this.activity[i] = next;

        // 记录放电瞬态
        if (Math.abs(next) > 0.45 && Math.abs(next - prev) > 0.15) {
          this.recentSpikes.push(i);
        }
      }
    }

    // 同步到节点对象供可视化读取
    for (let i = 0; i < this.count; i++) {
      this.nodes[i].activity = this.activity[i];
      this.nodes[i].v = this.activity[i];
      this.nodes[i].spiked = Math.abs(this.activity[i]) > 0.4;
    }

    // 3. 返回 16 个下行运动神经元的输出
    return this.outputs.map((idx) => this.activity[idx] * DYNAMICS.outputGain);
  }
}

/**
 * Maslov-Sneppen 度保持边交换算法 (Degree-Preserving Edge Rewiring)
 * 构建科研级 Matched Control 随机重连网络对照组：
 * 1. 严格保持 80 个神经元节点属性 (ID, 递质类型, sign, 解剖坐标)
 * 2. 严格保持 32 个视觉感受野输入通道 (inputs) 与 16 个下行输出神经元 (outputs)
 * 3. 严格保持每个节点的入度 (in-degree)、出度 (out-degree) 以及边总数 (1296)
 * 4. 通过随机边交换破坏生物演化特异微环路拓扑与前馈通路
 * 
 * @param {object} graph 原始 MaleCNS 图数据
 * @param {number} seed 随机数种子 (保证可复现)
 * @returns {object} 重连后的对照组图数据
 */
export function createMatchedControlGraph(graph, seed = 42) {
  function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rng = mulberry32(seed);
  const newEdges = graph.edges.map(e => [e[0], e[1], e[2]]);
  const edgeCount = newEdges.length;

  const edgeSet = new Set();
  for (let i = 0; i < edgeCount; i++) {
    edgeSet.add(`${newEdges[i][0]}->${newEdges[i][1]}`);
  }

  const swapAttempts = edgeCount * 4;
  let successfulSwaps = 0;

  for (let step = 0; step < swapAttempts; step++) {
    const i = Math.floor(rng() * edgeCount);
    const j = Math.floor(rng() * edgeCount);
    if (i === j) continue;

    const u = newEdges[i][0];
    const v = newEdges[i][1];
    const x = newEdges[j][0];
    const y = newEdges[j][1];

    if (u === y || x === v) continue;
    if (u === x || v === y) continue;

    const key1 = `${u}->${y}`;
    const key2 = `${x}->${v}`;

    if (edgeSet.has(key1) || edgeSet.has(key2)) continue;

    edgeSet.delete(`${u}->${v}`);
    edgeSet.delete(`${x}->${y}`);
    edgeSet.add(key1);
    edgeSet.add(key2);

    newEdges[i][1] = y;
    newEdges[j][1] = v;
    successfulSwaps++;
  }

  return {
    version: 'malecns-matched-control-v1',
    isControl: true,
    successfulSwaps,
    nodes: JSON.parse(JSON.stringify(graph.nodes)),
    edges: newEdges,
    inputs: JSON.parse(JSON.stringify(graph.inputs)),
    outputs: JSON.parse(JSON.stringify(graph.outputs)),
    channels: JSON.parse(JSON.stringify(graph.channels))
  };
}

