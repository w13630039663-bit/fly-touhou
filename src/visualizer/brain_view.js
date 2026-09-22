/**
 * brain_view.js - HHMI Janelia MaleCNS 真实连接组电生理与解剖结构可视化引擎 (v2, LOD)
 *
 * 规模自适应设计 (80 → 600+ 神经元)：
 * 1. 全量边离屏烘焙 (bake layer)：仅在布局/静音态/悬停态变化时重绘，每帧一次 drawImage
 * 2. 活跃边叠加：只重绘 pre 突触活动 |a|>ACTIVE_EDGE_GATE的边（按活动强度分色）
 * 3. 功能分层布局：按 role + inputs 通道真实分组（修复 v1 中按数组序错排的问题）
 * 4. 实时活动直方图 + 底部细胞类型图例条（数量全部从 brain 数据动态计算，无硬编码）
 * 5. 毫秒级 Hover 高亮：图例标签命中区 + 节点命中，放大 1.6 倍并高亮关联突触
 *
 * 官方口径：着色必须用喂给动作解码器的同一批状态值；活动值是无量纲计算状态，
 * 不是放电率、不是膜电位（文案避免 spike / firing rate / membrane potential）。
 */

const ACTIVE_EDGE_GATE = 0.35;   // |activity| 超过此值的突触前细胞，其出边每帧高亮重绘
const HIST_TOP = 168;
const HIST_BOTTOM = 196;
const LEGEND_TOP = 214;
const NET_BOTTOM = 162;          // 网络区下边界（画布 320 高时约 y<0.51h）

export class BrainVisualizer {
  constructor(canvas, brain) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.brain = brain;
    this.width = canvas.width;
    this.height = canvas.height;
    this.dpr = 1; // syncSize() 会按真实显示尺寸与设备像素比重绑定

    // 活跃突触脉冲动画粒子
    this.synapticPulses = [];
    this.rotationAngle = 0.0;
    this.viewMode = 'functional'; // 'functional' (功能分层) 或 'anatomical' (真实解剖3D)

    // 交互状态与图例命中检测包围盒
    this.hoveredType = null;
    this.legendTags = []; // [{ type, x, y, w, h }]
    this.orderedNodes = []; // 神经元按 input → interneuron → output 排序缓存

    // LOD 离屏烘焙层
    this.baseCanvas = null;
    this.baseDirty = true;
    this.baseSig = null;
    this.baseNeedsSilence = false;

    // 出边 CSR（供活跃边叠加与脉冲采样）
    this.outStart = null;
    this.outIdx = null;

    if (this.brain && this.brain.isReady) this.prepareIndices();

    // 注册鼠标交互事件 (复用单一 canvas，无新增 DOM)
    this.setupInteractions();

    // 预计算功能分层布局坐标
    this.layoutNodes();
  }

  /** 依赖 brain 数据的索引重建（数据集切换后需重新调用） */
  prepareIndices() {
    const count = this.brain.count;
    const degree = new Int32Array(count + 1);
    for (const e of this.brain.edges) degree[e.pre + 1]++;
    for (let i = 0; i < count; i++) degree[i + 1] += degree[i];
    this.outStart = degree;
    this.outIdx = new Int32Array(this.brain.edges.length);
    const fill = degree.slice(0, count);
    this.brain.edges.forEach((e, i) => { this.outIdx[fill[e.pre]++] = i; });
    this.baseDirty = true;
  }

  /** 供 app 层在数据集切换后重新绑定 brain */
  setBrain(brain) {
    this.brain = brain;
    this.synapticPulses = [];
    this.hoveredType = null;
    this.baseDirty = true;
    if (brain && brain.isReady) this.prepareIndices();
    this.layoutNodes();
  }

  /**
   * 重绑定画布到 CSS 显示尺寸 (02 卡片铺满面板 + 高分屏清晰化)。
   * 逻辑坐标系 = CSS 像素；backing store = CSS × devicePixelRatio。
   * 返回 true 表示尺寸确实变了（调用方可据此跳过后续工作）。
   */
  syncSize() {
    if (typeof window === 'undefined' || !this.canvas.getBoundingClientRect) return false;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width < 2 || rect.height < 2) return false;
    const bw = Math.round(rect.width * dpr);
    const bh = Math.round(rect.height * dpr);
    if (this.canvas.width === bw && this.canvas.height === bh && this.dpr === dpr) return false;
    this.canvas.width = bw;
    this.canvas.height = bh;
    this.dpr = dpr;
    this.width = bw / dpr;
    this.height = bh / dpr;
    this.baseCanvas = null;
    this.baseCtx = null;
    this.baseDirty = true;
    this.layoutNodes();
    return true;
  }

  setupInteractions() {
    if (!this.canvas || !this.canvas.addEventListener) return;

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      let found = null;
      // 1. 优先检测图例文字区域命中
      for (let i = 0; i < this.legendTags.length; i++) {
        const tag = this.legendTags[i];
        if (tag.type && mouseX >= tag.x && mouseX <= tag.x + tag.w && mouseY >= tag.y && mouseY <= tag.y + tag.h) {
          found = tag.type;
          break;
        }
      }

      // 2. 如果未命中图例，支持直接悬停在网络图节点上高亮同类神经元
      if (!found && mouseY < this.height * (HIST_TOP / 320) && this.brain && this.brain.nodes) {
        for (let i = 0; i < this.brain.nodes.length; i++) {
          const n = this.brain.nodes[i];
          const nx = n.layoutX * this.width;
          const ny = n.layoutY * this.height;
          if (Number.isFinite(nx) && Number.isFinite(ny)) {
            const dist = Math.hypot(mouseX - nx, mouseY - ny);
            if (dist <= 8) {
              found = n.type;
              break;
            }
          }
        }
      }

      if (this.hoveredType !== found) {
        this.hoveredType = found;
        this.baseDirty = true; // 烘焙层含 hover 语义，需重烤
        if (this.canvas.style) {
          this.canvas.style.cursor = found ? 'pointer' : 'default';
        }
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      if (this.hoveredType !== null) {
        this.hoveredType = null;
        this.baseDirty = true;
        if (this.canvas.style) {
          this.canvas.style.cursor = 'default';
        }
      }
    });
  }

  layoutNodes() {
    if (!this.brain.isReady || !this.brain.nodes) return;

    const nodes = this.brain.nodes;
    const inputNodes = nodes.filter(n => n.role === 'input');
    const interNodes = nodes.filter(n => n.role === 'interneuron' || n.role === 'intermediate');
    const outputNodes = nodes.filter(n => n.role === 'output');

    // 按 role 分组缓存 (input → interneuron → output) 供直方图使用
    this.orderedNodes = [...inputNodes, ...interNodes, ...outputNodes];
    this.inputCount = inputNodes.length;
    this.interCount = interNodes.length;
    this.outputCount = outputNodes.length;

    // 1. 输入层：按通道排布（每通道 = 该细胞所属 inputs channel），真实通道感分组
    const chanOf = new Map();
    for (const [idx, ch] of this.brain.inputs) chanOf.set(idx, ch);
    const nChannels = Math.max(1, this.brain.channels.length || 8);
    const byChan = new Map();
    inputNodes.forEach(n => {
      const ch = chanOf.has(n.idx) ? chanOf.get(n.idx) : 0;
      if (!byChan.has(ch)) byChan.set(ch, []);
      byChan.get(ch).push(n);
    });
    for (const [ch, list] of byChan) {
      const cy = 0.14 + (ch + 0.5) * (0.72 / nChannels);
      list.forEach((n, j) => {
        const rows = Math.ceil(list.length / 4);
        const col = j % 4, row = Math.floor(j / 4);
        n.layoutX = 0.075 + col * 0.032;
        n.layoutY = cy - (rows - 1) * 0.014 + row * 0.028;
      });
    }

    // 2. 中继层：按 type 名字母序在中央网格排布（确定性，消除对象键序依赖）
    const interSorted = [...interNodes].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.id - b.id));
    const interCols = 6;
    const interRows = Math.ceil(interSorted.length / interCols);
    interSorted.forEach((n, i) => {
      const col = i % interCols, row = Math.floor(i / interCols);
      n.layoutX = 0.36 + col * 0.052;
      n.layoutY = 0.12 + row * (0.74 / interRows);
    });

    // 3. 输出层：16 个下行运动神经元排布在右侧，驱动自机
    outputNodes.forEach((n, i) => {
      n.layoutX = 0.80 + (i % 2) * 0.06;
      n.layoutY = 0.10 + i * (0.78 / outputNodes.length);
    });

    // 网络区只占画布上部（底部留给直方图与图例条），scaleY 依此推导
    const netFrac = NET_BOTTOM / this.height;      // 网络区纵向占比
    const cx0 = 0.48, cy0 = 0.50;
    const sx = 0.82 / 0.96;                        // 让最终 x 跨度约 0.82（以 0.5 为中心）
    const sy = netFrac * 0.92;                     // y ∈ [netFrac*0.06, netFrac*0.98]
    nodes.forEach(n => {
      const rawX = (typeof n.layoutX === 'number' && Number.isFinite(n.layoutX)) ? n.layoutX : 0.48;
      const rawY = (typeof n.layoutY === 'number' && Number.isFinite(n.layoutY)) ? n.layoutY : 0.50;
      n.layoutX = 0.5 + (rawX - cx0) * sx;
      n.layoutY = netFrac * (0.5 + (rawY - cy0) * sy / 0.5 * 0.5);
    });
    this.baseDirty = true;
  }

  update() {
    if (!this.brain.isReady) return;

    this.rotationAngle += 0.005;

    // 随机采样活跃突触产生放电微粒
    if (this.outStart && this.brain.recentSpikes && this.brain.recentSpikes.length > 0) {
      const spikeIdx = this.brain.recentSpikes[Math.floor(Math.random() * this.brain.recentSpikes.length)];
      const preNode = this.brain.nodes[spikeIdx];
      const s = this.outStart[spikeIdx], e = this.outStart[spikeIdx + 1];
      if (e > s && this.synapticPulses.length < 50) {
        const edge = this.brain.edges[this.outIdx[s + Math.floor(Math.random() * (e - s))]];
        const postNode = this.brain.nodes[edge.post];
        if (preNode && postNode) {
          this.synapticPulses.push({
            x1: preNode.layoutX * this.width,
            y1: preNode.layoutY * this.height,
            x2: postNode.layoutX * this.width,
            y2: postNode.layoutY * this.height,
            preType: preNode.type,
            postType: postNode.type,
            progress: 0,
            speed: 0.14 + Math.random() * 0.08,
            color: edge.type === 'inhibitory' ? '#38bdf8' : '#2ed573'
          });
        }
      }
    }

    // 更新飞行中的突触信号粒子
    for (let i = this.synapticPulses.length - 1; i >= 0; i--) {
      const pulse = this.synapticPulses[i];
      pulse.progress += pulse.speed;
      if (pulse.progress >= 1.0) {
        this.synapticPulses.splice(i, 1);
      }
    }
  }

  /** 烘焙全量静态边到底层 canvas（只在布局/silence/hover 状态变化时重烤） */
  bakeBaseLayer(isSilenced, hovered) {
    const w = this.width, h = this.height;
    const dpr = this.dpr || 1;
    const dw = Math.round(w * dpr), dh = Math.round(h * dpr);
    const sig = `${isSilenced ? 'S' : '-'}|${hovered || '-'}`;
    if (!this.baseCanvas) {
      let surface = null;
      if (typeof OffscreenCanvas !== 'undefined') {
        surface = new OffscreenCanvas(dw, dh);
      } else if (typeof document !== 'undefined') {
        surface = document.createElement('canvas');
        surface.width = dw;
        surface.height = dh;
      }
      if (!surface) {
        // 无头测试环境：跳过烘焙层（动态叠加层仍会完整执行，验证无异常）
        this.baseSig = sig;
        this.baseDirty = false;
        return;
      }
      surface.width = surface.width || dw;
      surface.height = surface.height || dh;
      this.baseCanvas = surface;
      this.baseCtx = surface.getContext('2d');
      this.baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0); // 烘焙逻辑坐标 = CSS px
    }
    const ctx = this.baseCtx;
    ctx.clearRect(0, 0, w, h);
    const edges = this.brain.edges, nodes = this.brain.nodes;

    if (hovered) {
      // hover 态：底图只画弱化边（单样式批量），高亮边每帧动态重绘不进底图
      ctx.strokeStyle = 'rgba(75, 85, 99, 0.06)';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const pre = nodes[edge.pre], post = nodes[edge.post];
        if (!pre || !post) continue;
        if (pre.type === hovered || post.type === hovered) continue;
        const x1 = pre.layoutX * w, y1 = pre.layoutY * h;
        const x2 = post.layoutX * w, y2 = post.layoutY * h;
        if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) continue;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    } else {
      // 静态势：按接触点数（静态量）分桶画到烘焙层——与逐帧变化的 activity 无关，底图永不陈旧。
      // 实时活动高亮由 render() 的叠加层负责。
      const bucketCount = 6;
      const buckets = new Array(bucketCount);
      for (let b = 0; b < bucketCount; b++) buckets[b] = [];
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const pre = nodes[edge.pre], post = nodes[edge.post];
        if (!pre || !post) continue;
        const x1 = pre.layoutX * w, y1 = pre.layoutY * h;
        const x2 = post.layoutX * w, y2 = post.layoutY * h;
        if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) continue;
        const t = Math.min(1, Math.log10(Math.max(1, edge.contacts)) / 3); // 1 → 1000+ contacts
        const b = Math.min(bucketCount - 1, Math.floor(t * bucketCount));
        buckets[b].push(x1, y1, x2, y2);
      }
      for (let b = 0; b < bucketCount; b++) {
        const arr = buckets[b];
        if (!arr.length) continue;
        if (isSilenced) {
          ctx.strokeStyle = '#1f2937';
          ctx.lineWidth = 0.4;
        } else {
          const t = (b + 0.5) / bucketCount;
          ctx.strokeStyle = `rgba(100, 116, 139, ${(0.05 + t * 0.10).toFixed(3)})`;
          ctx.lineWidth = 0.35 + t * 0.35;
        }
        ctx.beginPath();
        for (let k = 0; k < arr.length; k += 4) {
          ctx.moveTo(arr[k], arr[k + 1]);
          ctx.lineTo(arr[k + 2], arr[k + 3]);
        }
        ctx.stroke();
      }
    }
    this.baseSig = `${isSilenced ? 'S' : '-'}|${hovered || '-'}`;
    this.baseNeedsSilence = isSilenced;
    this.baseDirty = false;
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const dpr = this.dpr || 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 逻辑坐标 = CSS px (每帧幂等设置)
    ctx.clearRect(0, 0, w, h);

    // 1. 现代产品深灰蓝卡片背景与柔和微网格
    ctx.fillStyle = '#181B26';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (!this.brain.isReady) {
      ctx.fillStyle = '#8b95a5';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('MaleCNS v1.0 真实连接组图谱加载中...', w / 2, h / 2);
      return;
    }

    const brain = this.brain;
    const nodes = brain.nodes, edges = brain.edges;
    const nInput = nodes.reduce((a, n) => a + (n.role === 'input' ? 1 : 0), 0);
    const nInter = nodes.reduce((a, n) => a + (n.role === 'interneuron' || n.role === 'intermediate' ? 1 : 0), 0);
    const nOut = nodes.reduce((a, n) => a + (n.role === 'output' ? 1 : 0), 0);

    // 2. 绘制层级分区指示标头 (数量动态)
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8b95a5';
    ctx.textAlign = 'center';
    ctx.fillText(`INFLOW // ${nInput} SENSORY`, w * 0.24, 18);
    ctx.fillText(`RESERVOIR // ${nInter} BRIDGE`, w * 0.50, 18);
    ctx.fillText(`MOTOR // ${nOut} DNs`, w * 0.76, 18);

    const isSilenced = brain.lesions.silenced;
    const hovered = this.hoveredType;

    // 3. 全量边：LOD 烘焙底图 + 每帧一次性合成
    const sig = `${isSilenced ? 'S' : '-'}|${hovered || '-'}`;
    if (this.baseDirty || this.baseSig !== sig) this.bakeBaseLayer(isSilenced, hovered);
    if (this.baseCanvas) ctx.drawImage(this.baseCanvas, 0, 0, w, h);

    // 活跃边动态叠加（hover 高亮边 / 强活动边），批量样式
    if (!isSilenced) {
      if (hovered) {
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.65)';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i];
          const pre = nodes[edge.pre], post = nodes[edge.post];
          if (!pre || !post || (pre.type !== hovered && post.type !== hovered)) continue;
          ctx.moveTo(pre.layoutX * w, pre.layoutY * h);
          ctx.lineTo(post.layoutX * w, post.layoutY * h);
        }
        ctx.stroke();
      } else {
        ctx.lineWidth = 0.6;
        let open = false;
        ctx.beginPath();
        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i];
          const pre = nodes[edge.pre];
          if (!pre || Math.abs(pre.activity) <= ACTIVE_EDGE_GATE) continue;
          const post = nodes[edge.post];
          if (!post) continue;
          const a = Math.abs(pre.activity);
          ctx.strokeStyle = `rgba(74, 222, 128, ${(0.12 + a * 0.4).toFixed(3)})`;
          ctx.moveTo(pre.layoutX * w, pre.layoutY * h);
          ctx.lineTo(post.layoutX * w, post.layoutY * h);
          open = true;
        }
        if (open) ctx.stroke();
      }
    }

    // 4. 绘制突触电脉冲微粒
    if (!isSilenced) {
      this.synapticPulses.forEach(p => {
        if (hovered && p.preType !== hovered && p.postType !== hovered) return;
        const curX = p.x1 + (p.x2 - p.x1) * p.progress;
        const curY = p.y1 + (p.y2 - p.y1) * p.progress;

        ctx.beginPath();
        ctx.arc(curX, curY, 2.0, 0, Math.PI * 2);
        ctx.fillStyle = '#4ade80';
        ctx.fill();
      });
    }

    // 5. 绘制神经元胞体 (支持 Hover 1.6x 放大与未选中节点 0.25 弱化)
    const smallGraph = nodes.length > 200;   // 大拓扑：缩小胞体、隐藏常规标签，防糊
    nodes.forEach(n => {
      const nx = n.layoutX * w;
      const ny = n.layoutY * h;
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;

      const act = isSilenced ? 0 : (Number.isFinite(n.activity) ? n.activity : 0);
      const absAct = Math.abs(act);
      const isTarget = hovered && n.type === hovered;
      const isDimmed = hovered && n.type !== hovered;

      ctx.globalAlpha = isDimmed ? 0.25 : 1.0;

      let radius = smallGraph ? 2.2 : 4.2;
      let fillColor = '#1f2937';
      let strokeColor = '#4b5563';
      let strokeWidth = smallGraph ? 0.6 : 1.0;

      if (isSilenced) {
        fillColor = '#131622';
        strokeColor = '#252b3d';
      } else if (n.role === 'input') {
        radius = smallGraph ? 2.1 : 4.0;
        fillColor = absAct > 0.3 ? '#2d3748' : '#1e2433';
        strokeColor = absAct > 0.3 ? '#cbd5e1' : '#475569';
      } else if (n.role === 'interneuron' || n.role === 'intermediate') {
        radius = smallGraph ? 1.8 : 3.6;
        fillColor = absAct > 0.3 ? '#2d3748' : '#161b26';
        strokeColor = absAct > 0.3 ? '#94a3b8' : '#334155';
      } else if (n.role === 'output') {
        radius = smallGraph ? 2.8 : 4.6;
        fillColor = absAct > 0.3 ? '#166534' : '#14291f';
        strokeColor = '#4ade80';
      }

      if (!isSilenced && n.spiked) {
        radius *= 1.25;
        fillColor = '#4ade80';
        strokeColor = '#f3f4f6';
      }

      if (isTarget) {
        radius *= 1.6;
        fillColor = '#166534';
        strokeColor = '#4ade80';
        strokeWidth = 2.0;
      }

      ctx.beginPath();
      ctx.arc(nx, ny, radius, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();

      // 输出下行神经元或 Hover 高亮目标显示名称标签（大拓扑时只给 hover 目标标名，防糊）
      if (isTarget || (n.role === 'output' && !smallGraph)) {
        ctx.fillStyle = isTarget ? '#4ade80' : '#9ca3af';
        ctx.font = isTarget ? 'bold 10px "JetBrains Mono", monospace' : '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(n.type, nx + 7, ny + 3);
      }

      ctx.globalAlpha = 1.0;
    });

    // 6. 实时动力学活动直方图 (y: 168 ~ 196)
    this.renderActivityHistogram(ctx, w, isSilenced, hovered);

    // 7. 底部细胞类型图例条与 Hover 命中区 (y: 214 ~ 268)
    this.renderCellTypeLegend(ctx, w, h, hovered);
  }

  renderActivityHistogram(ctx, w, isSilenced, hovered) {
    if (!this.orderedNodes || this.orderedNodes.length === 0) this.layoutNodes();

    const histX = 18;
    const histW = w - 36;
    const histHeight = HIST_BOTTOM - HIST_TOP;
    const count = this.orderedNodes.length || 1;
    const step = histW / count;
    const barW = Math.max(0.75, step - (count > 200 ? 0.2 : 1.2));

    // 基准线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(histX, HIST_BOTTOM);
    ctx.lineTo(histX + histW, HIST_BOTTOM);
    ctx.stroke();

    // N 根实时动力学活动柱 (Green + / Orange -)
    for (let i = 0; i < count; i++) {
      const node = this.orderedNodes[i];
      const rawAct = (isSilenced || !node || !Number.isFinite(node.activity)) ? 0 : node.activity;
      const absAct = Math.min(1.0, Math.abs(rawAct));
      const barX = histX + i * step;

      const isTarget = hovered && node && node.type === hovered;
      const isDimmed = hovered && node && node.type !== hovered;

      ctx.globalAlpha = isDimmed ? 0.25 : 1.0;

      if (isSilenced || absAct < 0.03) {
        ctx.fillStyle = isSilenced ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.09)';
        ctx.fillRect(barX, HIST_BOTTOM - 1.5, barW, 1.5);
      } else {
        const barH = Math.max(2.5, absAct * histHeight);
        const barY = HIST_BOTTOM - barH;
        // 官方口径：正向为绿 (#4ade80)，负向为橙 (#f97316)
        ctx.fillStyle = rawAct >= 0 ? '#4ade80' : '#f97316';
        ctx.fillRect(barX, barY, barW, barH);

        if (isTarget) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.strokeRect(barX, barY, barW, barH);
        }
      }

      ctx.globalAlpha = 1.0;
    }

    // 分组分隔线（真实 role 计数）
    const divX1 = histX + (this.inputCount || 0) * step;
    const divX2 = divX1 + (this.interCount || 0) * step;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    if (ctx.setLineDash) ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(divX1, HIST_TOP - 4);
    ctx.lineTo(divX1, HIST_BOTTOM + 11);
    ctx.moveTo(divX2, HIST_TOP - 4);
    ctx.lineTo(divX2, HIST_BOTTOM + 11);
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);

    // 分组说明小标签
    ctx.font = '8.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.fillText(`SENSORY (${this.inputCount})`, (histX + divX1) / 2, 207);
    ctx.fillText(`RESERVOIR (${this.interCount})`, (divX1 + divX2) / 2, 207);
    ctx.fillText(`MOTOR (${this.outputCount})`, (divX2 + histX + histW) / 2, 207);
  }

  renderCellTypeLegend(ctx, w, h, hovered) {
    this.legendTags = [];
    const nodes = this.brain.nodes;

    // 真实 role 组内按细胞类型聚合计数（确定性排序：计数降序 → 名称升序）
    const tally = (pred) => {
      const m = new Map();
      for (const n of nodes) if (pred(n)) m.set(n.type, (m.get(n.type) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    };
    this.inputCount = nodes.filter(n => n.role === 'input').length;
    this.interCount = nodes.filter(n => n.role === 'interneuron' || n.role === 'intermediate').length;
    const inTypes = tally(n => n.role === 'input');
    const bridgeTypes = tally(n => n.role === 'interneuron' || n.role === 'intermediate');
    const motorTypes = tally(n => n.role === 'output');

    // 每行容量：按测宽动态换行；BRIDGE 全量类型可翻页
    this.legendPage = this.legendPage || 0;
    const bridgePageCount = Math.max(1, Math.ceil(bridgeTypes.length / 26));
    this.legendPage = this.legendPage % bridgePageCount;

    const rows = [
      { label: 'INFLOW', y: LEGEND_TOP + 13, tags: inTypes, extra: null },
      {
        label: 'BRIDGE',
        y: LEGEND_TOP + 29,
        tags: bridgeTypes.slice(this.legendPage * 26, this.legendPage * 26 + 10),
        extra: bridgeTypes.length > 10 ? `+${bridgeTypes.length - 10} more (页 ${this.legendPage + 1}/${bridgePageCount})` : null
      },
      { label: 'MOTOR', y: LEGEND_TOP + 45, tags: motorTypes, extra: null }
    ];

    // 1. 图例底栏深色底色与分隔顶线
    ctx.fillStyle = '#131620';
    ctx.fillRect(0, LEGEND_TOP, w, h - LEGEND_TOP);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, LEGEND_TOP);
    ctx.lineTo(w, LEGEND_TOP);
    ctx.stroke();

    // 2. 测量文本宽度工具函数 (兼容无头测试环境)
    const measure = (txt) => {
      if (ctx.measureText) {
        const m = ctx.measureText(txt);
        if (m && typeof m.width === 'number') return m.width;
      }
      return (txt || '').length * 5.2;
    };

    rows.forEach(r => {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
      ctx.fillText(r.label, 14, r.y);

      let curX = 64;
      ctx.font = '8.5px "JetBrains Mono", monospace';

      r.tags.forEach(([tag, cnt], idx) => {
        const isHovered = hovered === tag;
        const tw = measure(tag);

        this.legendTags.push({
          type: tag,
          x: curX - 2,
          y: r.y - 8.5,
          w: tw + 4,
          h: 11
        });

        if (isHovered) {
          ctx.fillStyle = 'rgba(74, 222, 128, 0.22)';
          ctx.fillRect(curX - 2, r.y - 8.5, tw + 4, 11);
          ctx.fillStyle = '#4ade80';
          ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
        } else {
          ctx.fillStyle = '#94a3b8';
          ctx.font = '8.5px "JetBrains Mono", monospace';
        }

        ctx.fillText(tag, curX, r.y);
        curX += tw;

        // 计数后缀 (×N)
        const cntTxt = `×${cnt}`;
        ctx.fillStyle = '#475569';
        ctx.fillText(cntTxt, curX, r.y);
        curX += measure(cntTxt);

        if (idx < r.tags.length - 1 || r.extra) {
          ctx.fillStyle = '#475569';
          const dot = ' · ';
          ctx.fillText(dot, curX, r.y);
          curX += measure(dot);
        }
      });

      if (r.extra) {
        ctx.fillStyle = '#64748b';
        ctx.font = '8.5px "JetBrains Mono", monospace';
        ctx.fillText(r.extra, curX, r.y);
      }
    });
  }
}
