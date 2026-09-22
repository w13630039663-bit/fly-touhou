/**
 * connectome.js - HHMI Janelia MaleCNS v1.0 真实局部连接组动力学引擎（拓扑规模无关）
 * 
 * 数据集（public/data/connectome/，均为 FlyEM MaleCNS v1.0 真实测定子图, CC BY 4.0）:
 *   graph.json      v1: 80 神经元 (32 视觉传入 + 32 桥接 + 16 DN)，1,296 边 / 26,029 接触点
 *   graph600.json   v2: 600 神经元加权通路闭包 (自 v1 的 80 细胞确定性生长)，
 *                   37,845 边 / 1,129,414 接触点，56 传入 / 528 中继 / 16 DN 读出
 * 引擎按数据文件自适应任意规模；边权重按突触后总接触归一化 → 动力学规模不变性。
 * 
 * 纯动力学储备池演化 (Reservoir Computing):
 * h[i] = 0.3 * h[i] + 0.7 * tanh(u[i] + 1.4 * sum_j(W[j,i] * h[j]))
 * 绝无人工势场外挂与直接灌流作弊
 *
 * P4-1（可选、默认关闭）：Hebbian 局部突触可塑性 setPlasticity({eta,decay,renorm})。
 * 开启后 W 每帧按 W += η(h_pre·h_post − decay·W) 自更新，仍是一条局部生物规则
 * （不需要全局误差/反向传播），叙事上从「冻结的真连接组」变为「真连接组 + 生物可塑性」。
 * 默认 eta=0 ⇒ 关闭 ⇒ 引擎行为与 P4-1 引入前逐位一致。
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
      silenced: false, // 大脑静音 (Circuit Silenced)
      nodeMask: null   // 选择性静音节点掩码 (Uint8Array, 1=强制活动恒零); null=无
    };

    // P4-1 突触可塑性状态：默认关闭 ⇒ 引擎与 P4-1 引入前逐位一致（回归门保证）。
    // 跨 initGraph 保留，便于网页端切换数据集后仍维持用户选定的可塑性档位。
    this.plasticity = { enabled: false, eta: 0, decay: 0, renorm: true };

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
    // 可选预烘焙权重：边数组第 4 项给出即最终有符号权重（用于加性两段归一化等
    // 无法用 contacts/totals 单段口径表达的派生拓扑）。要求全有或全无，禁混用。
    const baked = graph.edges.length > 0 && graph.edges[0].length >= 4;
    if (baked && !graph.edges.every((e) => e.length >= 4)) {
      throw new Error('[MaleCNS] 边权重烘焙不允许混用: 所有边都必须带第 4 项权重');
    }
    if (!baked) {
      for (const [pre, post, contacts] of graph.edges) {
        totals[post] += contacts * Math.abs(graph.nodes[pre].sign);
      }
    }

    this.edges = graph.edges.map(([pre, post, contacts, bakedWeight]) => ({
      pre,
      post,
      contacts,
      weight: baked ? bakedWeight : (totals[post] ? (contacts * graph.nodes[pre].sign) / totals[post] : 0),
      type: graph.nodes[pre].sign < 0 ? 'inhibitory' : 'excitatory'
    }));

    // 热路径镜像 TypedArray（与 this.edges 严格同序 → 浮点累加顺序不变，位级一致）。
    // 大拓扑 (600 神经元 / 3.8 万边) 下比对象属性循环快约 3 倍。
    this.ePre = new Int32Array(this.edges.length);
    this.ePost = new Int32Array(this.edges.length);
    this.eWeight = new Float64Array(this.edges.length);
    for (let i = 0; i < this.edges.length; i++) {
      this.ePre[i] = this.edges[i].pre;
      this.ePost[i] = this.edges[i].post;
      this.eWeight[i] = this.edges[i].weight;
    }
    // v7 增益把手选择器: 边 post ∈ 输出 时按 pre 的 sign 归类 (1=兴奋, 2=抑制, 0=不作用)
    const outSet = new Set(this.outputs);
    this.eGainSel = new Uint8Array(this.edges.length);
    for (let i = 0; i < this.edges.length; i++) {
      if (outSet.has(this.edges[i].post)) {
        const s = graph.nodes[this.edges[i].pre].sign;
        this.eGainSel[i] = s > 0 ? 1 : s < 0 ? 2 : 0;
      }
    }
    // 出厂（生物）权重：真实连接组的原始归一化权重。
    // ⚠️ 必须是**独立副本**，不能写成 `this.eWeightBase = this.eWeight`：
    // P4-1 的 Hebbian 算子会就地改写 eWeight，若二者共享同一引用，生物原件会在
    // 第一局跑完后就永久丢失 —— applyDnGains 的基准镜像与 restoreBioWeights 全部失效。
    this.eWeightBase = new Float64Array(this.eWeight);
    this.dnGains = { exc: 1, inh: 1 };
    this._postAbsSum = null;   // P4-1 归一化守恒的暂存缓冲（首次用到时惰性分配）

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

  /**
   * v7 增益把手：缩放所有「post∈输出」边的权重，按 pre 神经递质符号分兴奋/抑制两路。
   * 钳制到 [0,4]；exc=inh=1 时回退基准镜像 ⇒ 与 320 参数版逐位一致（回归门保证）。
   */
  applyDnGains(exc, inh) {
    exc = Math.min(4, Math.max(0, exc));
    inh = Math.min(4, Math.max(0, inh));
    this.dnGains = { exc, inh };
    if (exc === 1 && inh === 1) {
      // 回退基准镜像：剥出独立副本（而非共享 eWeightBase 引用），
      // 这样后续 Hebbian 就地改写 eWeight 不会污染生物原件。
      this.eWeight = new Float64Array(this.eWeightBase);
      return;
    }
    const base = this.eWeightBase, sel = this.eGainSel;
    const out = new Float64Array(base.length);
    for (let e = 0; e < base.length; e++) {
      const s = sel[e];
      out[e] = s === 0 ? base[e] : base[e] * (s === 1 ? exc : inh);
    }
    this.eWeight = out;
  }

  /**
   * P4-1：配置 Hebbian 突触可塑性算子（默认关闭 ⇒ 引擎与 P4-1 引入前逐位一致）。
   *
   * 规则（每帧、每条突触各更新一次，O(E)）：
   *     W_ij ← W_ij + η · ( h_i · h_j − decay · W_ij )
   * 这里 h 是当帧 3 次动力学迭代后的最终活动。它是一条**局部**规则：不需要任何
   * 全局误差信号、也不需要反向传播，因此仍属「生物可塑性」而非「优化器改连接组」。
   *
   * 实测（80 节点 / 1296 边 / 1800 帧）标定出的可用窗口极窄：
   *   η = 1e-5 → 相对漂移 ~2%（成绩仅 −2.2%，落在权重扰动的平坦区）
   *   η = 1e-4 → 相对漂移 ~25%
   *   η ≥ 1e-3 → 相对漂移 >1000%（真实输入下正反馈失控，退化成随机网络）
   *
   * @param {{eta?:number, decay?:number, renorm?:boolean}} cfg
   *   eta    学习率；≤0 视为关闭
   *   decay  权重衰减系数（本引擎实测 0.01 量级远不足以压住雪崩，需配合 renorm）
   *   renorm 每帧守恒 Σ|W_in| = 1（连接组的原始归一化约定）
   */
  setPlasticity({ eta = 0, decay = 0, renorm = true } = {}) {
    this.plasticity = { enabled: eta > 0, eta, decay, renorm };
    return this.plasticity;
  }

  /**
   * 恢复出厂（生物）权重 —— 局内可塑的分界点：每局开始回到真实连接组原件。
   * 保留当前 dnGains 设置（v7 冠军向量的增益把手不因复位而丢失）。
   */
  restoreBioWeights() {
    const { exc, inh } = this.dnGains;
    this.eWeight = new Float64Array(this.eWeightBase);
    if (exc !== 1 || inh !== 1) this.applyDnGains(exc, inh);
  }

  /**
   * 相对权重漂移 = Σ|W − W_bio| / Σ|W_bio|，供网页端低频（≈每 30 帧）展示可塑性强度。
   * O(E)，1296 边下约 3 µs，不进逐帧热路径。
   */
  measureDrift() {
    const a = this.eWeight, b = this.eWeightBase;
    if (!a || !b || a.length !== b.length) return 0;
    let d = 0, s = 0;
    for (let i = 0; i < a.length; i++) { d += Math.abs(a[i] - b[i]); s += Math.abs(b[i]); }
    return s > 0 ? d / s : 0;
  }

  reset() {
    if (this.activity) {
      this.activity.fill(0);
      this.scratch.fill(0);
      this.drive.fill(0);
    }
  }

  /**
   * 选择性节点静音（消融用）：给定节点下标数组，其活动恒被钳为 0，
   * 既不接受驱动也不向后级联贡献；传 null 清除。病灶是配置而非状态，reset() 不清除。
   */
  silenceNodes(idxs) {
    if (!idxs) {
      this.lesions.nodeMask = null;
      this.lesions.nodeList = null;
      return;
    }
    const m = new Uint8Array(this.count);
    const l = [];
    for (const i of idxs) {
      if (!m[i]) { m[i] = 1; l.push(i); }
    }
    this.lesions.nodeMask = m;
    this.lesions.nodeList = l;
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
    // 选择性消融：被静音节点连感觉驱动一并钳零
    const mask = this.lesions.nodeMask;
    if (mask) {
      for (const i of this.lesions.nodeList) this.drive[i] = 0;
    }

    // 2. 泄漏循环动力学迭代 (Leaky Recurrent Tanh Dynamics)
    this.recentSpikes = [];
    const gain = DYNAMICS.gain;
    const ePost = this.ePost, ePre = this.ePre, eWeight = this.eWeight;
    const nEdges = ePost.length;
    for (let t = 0; t < DYNAMICS.iterations; t++) {
      this.scratch.set(this.drive);
      for (let e = 0; e < nEdges; e++) {
        this.scratch[ePost[e]] += gain * eWeight[e] * this.activity[ePre[e]];
      }
      for (let i = 0; i < this.count; i++) {
        if (mask && mask[i]) {
          this.activity[i] = 0;
          continue;
        }
        const prev = this.activity[i];
        const next = (1 - DYNAMICS.leak) * prev + DYNAMICS.leak * Math.tanh(this.scratch[i]);
        this.activity[i] = next;

        // 记录放电瞬态
        if (Math.abs(next) > 0.45 && Math.abs(next - prev) > 0.15) {
          this.recentSpikes.push(i);
        }
      }
    }

    // 2.5 P4-1: Hebbian 突触可塑性（默认关闭 ⇒ 本段整体跳过，逐位不变）。
    //     就地改写热路径镜像 eWeight，下一帧的动力学立刻采用新权重。
    const pl = this.plasticity;
    if (pl && pl.enabled && !mask) {
      const eta = pl.eta, decay = pl.decay;
      for (let e = 0; e < nEdges; e++) {
        eWeight[e] += eta * (this.activity[ePre[e]] * this.activity[ePost[e]] - decay * eWeight[e]);
      }
      if (pl.renorm) {
        // 归一化守恒：把每个突触后神经元的 Σ|W_in| 拉回基准 1。
        // 实测必需 —— 缺了它，真实弹幕输入会造出相关活动并触发正反馈失控（漂移 >1000%）。
        const acc = this._postAbsSum || (this._postAbsSum = new Float64Array(this.count));
        acc.fill(0);
        for (let e = 0; e < nEdges; e++) acc[ePost[e]] += Math.abs(eWeight[e]);
        for (let e = 0; e < nEdges; e++) {
          const a = acc[ePost[e]];
          if (a > 1e-12) eWeight[e] /= a;
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
 * 1. 严格保持全部神经元节点属性 (ID, 递质类型, sign, 解剖坐标)
 * 2. 严格保持视觉感受野输入通道 (inputs) 与 16 个下行输出神经元 (outputs)
 * 3. 严格保持每个节点的入度 (in-degree)、出度 (out-degree) 以及边总数
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
  const newEdges = graph.edges.map((e) => e.slice());
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

