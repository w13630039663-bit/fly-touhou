/**
 * i18n.js - 全站中英文双语国际化核心模块
 * 支持即时无刷新热切换与 localStorage 偏好记忆
 */

export const translations = {
  zh: {
    nav: {
      workbench: '实时工作台',
      training: '训练演化舱',
      benchmark: '基准测试',
      methods: '方法与框架'
    },
    hero: {
      eyebrow: '真实测定连接组实验 · HHMI JANELIA MALECNS',
      title: '果蝇玩东方 · 真实连接组弹幕规避实验',
      desc: '一只拥有真实测定脑神经连接组的黑腹果蝇（Drosophila melanogaster），能否在东方弹幕的枪林弹雨中实时自主规避？由 {n} 个神经元构成的局部回路、8 个生物视觉感受野（LC/LPLC）与进化出的运动解码器共同驱动。',
      spec_circuit_label: '神经回路:',
      spec_circuit_val: 'MaleCNS v1.0 ({n} 细胞 / {e} 突触)',
      spec_readout_label: '动作解码:',
      spec_readout_val: '320 个演化权重 (CEM 算法)',
      spec_frequency_label: '时钟频率:',
      spec_frequency_val: '60Hz 物理因果同步',
      spec_benchmark_label: '对照基准:',
      spec_benchmark_val: '{bt}s (训练脑) vs {st}s (消融静音)'
    },
    toolbar: {
      status_active: '{n} 神经元 · 60Hz 活跃中',
      status_silenced: 'MaleCNS 神经元处于消融静音',
      warp: '倍速:',
      controller: '控制模式:',
      mode_trained: '已训练神经脑',
      mode_silenced: '消融静音脑',
      mode_random: '随机控制基线',
      mode_human: '人工键盘接管',
      radar_on: '👁️ 复眼雷达: 开启',
      radar_off: '👁️ 复眼雷达: 关闭',
      respawn_on: '♾️ 无缝观察: 开启',
      respawn_off: '♾️ 无缝观察: 关闭',
      plasticity: '可塑性:',
      plasticity_title: 'P4-1 Hebbian 突触可塑性开关 (W 是否每帧自更新)',
      reset: '🔄 重置战场'
    },
    panel: {
      env_title: '01 // 东方 STG 弹幕战场',
      env_sub: '自机判定: 3.5PX | 擦弹区: 28PX',
      spellcard_label: '当前符卡: ',
      spellcard_1: '❄ 雹符「Hailstorm」· th06 原作移植',
      spellcard_2: '「博丽逃逸·环状漫天符」',
      spellcard_3: '「梦想封印·高密自机狙」',
      spellcard_4: '「八方狂岚·交错螺旋弹幕」',
      spellcard_5: '🦇 冥符「紅色の冥界」· Stage 6 Boss 蕾米莉亚',
      diff_label: '自适应难度: ',
      diff_cap: '45s 封顶',
      diff_super_easy: '超级简单',
      diff_easy: '简单',
      diff_normal: '普通',
      diff_hard: '困难',
      diff_lunatic: '疯狂',

      net_title: '02 // MALECNS V1.0 连接组网络',
      net_sub: '{n} 节点 / {e} 条突触',
      net_active: '● 连接组神经元放电中',
      net_silenced: '○ 消融静音中 (活动全归零)',
      net_reservoir: '动力学储备池 // 每帧3步迭代',
      net_plasticity_off: '可塑性 // 关闭 (W 冻结)',
      net_plasticity_on: '可塑性 // W 相对漂移',

      rig_title: '03 // 果蝇具身踏键拟真装置',
      rig_sub: '果蝇实时按键输出 · 60Hz 具身动作',
      rig_input: '输入源 // 16 下行神经元解码',
      rig_latency: '硬件同步 // 0 延迟帧同频',

      sensory_title: '04 // 生物视觉与本体感受野',
      sensory_sub: '8 通道威胁、光流与自机位置感知',
      lc4: 'LC4 (Looming 逼近威胁)',
      lc11: 'LC11 (左侧小目标威胁)',
      lc9: 'LC9 (右侧小目标威胁)',
      lc15: 'LC15 (后方逼近威胁)',
      lc16: 'LC16 (水平全局光流)',
      lc17: 'LC17 (垂直下落光流)',
      lc21: 'LC21 (水平本体位置 · X)',
      lplc2: 'LPLC2 (垂直本体位置 · Y)'
    },
    metrics: {
      survival: '⏱️ 存活时间',
      max_survival: '🏆 最高纪录',
      graze: '⚡ 擦弹总数',
      hits: '💥 中弹击坠',
      round: '⚔️ 击杀轮次',
      spikes: '🧬 神经放电率',
      gf_evasions: '🛡️ 巨纤维触发'
    },
    train: {
      title: '神经演化实验台 · CEM 跨熵方法',
      desc: '生物学 MaleCNS 连接组固定不变；仅对连接 16 个下行运动神经元 (DNs) 的 320 个零偏置线性解码权重进行进化更新。可直接在浏览器中单步演化，或重新载入经过 100 代训练的冠军权重。',
      badge: '跨熵演化方法<br>320 个可演化基因参数',
      step: '⚡ 演化推进 1 代',
      restore: '👑 恢复冠军策略',
      reset: '🎲 重置为随机初始',
      mode_survival: '🚩 模式: 自由生存特训 (点击切换穿越闯关)',
      mode_stage: '⛩️ 模式: 弹幕穿越闯关 (点击切换自由生存)',
      next_stage: '⏩ 晋级下一关',
      stage_label: '关卡选择:',
      stage_1: 'Stage 1:「初试啼声·雾之湖竹林突破」',
      stage_2: 'Stage 2:「逆风飞翔·红魔馆回旋魔弹阵」',
      stage_3: 'Stage 3:「死线超越·博丽大结界终极试炼」',
      gen: '当前演化代数',
      best: '历史最佳存活',
      avg_graze: '代均擦弹表现',
      optimizer: '优化器算法',
      optimizer_val: 'CEM (自适应协方差交叉熵)',
      tbl_baseline: '评估基线 (50轮均值测试)',
      tbl_survival: '存活时间 (秒)',
      tbl_frames: '平均存活帧数',
      tbl_significance: '因果机制与显著性检验',
      row_trained_label: '🧠 已训练 MaleCNS 连接组脑 (冠军权重)',
      row_trained_desc: '完整的视触觉感知-中继动力学-运动解码避弹链条',
      row_control_label: '🔀 度保持随机重连对照 (Matched Control)',
      row_control_desc: '{n} 节点 {e} 边入出度严格保持，破坏生物拓扑通路 (Maslov-Sneppen)',
      row_silenced_label: '🔇 神经元消融静音对照 (Ablated)',
      row_silenced_desc: 'p < 0.001 (失去神经反射导致短时间撞弹击坠)',
      row_static_label: '🛑 纯惯性静止悬停基线',
      row_static_desc: '中央原点静止基线对照'
    },
    methods: {
      title: '方法体系与因果框架',
      s1_tag: '视觉感知',
      s1_title: '8 通道生物复眼感受野',
      s1_desc: 'LC4、LC11、LC9 及 LPLC2 视叶投射神经元实时提取大威胁逼近速度与多维光流矢量。',
      s2_tag: '神经动力学',
      s2_title: 'MaleCNS 递归神经储备池',
      s2_desc: '{n} 个神经元与 {e} 条突触，按非线性泄漏 tanh 动力学方程每帧进行 3 次亚步演进。',
      s3_tag: '具身动作',
      s3_title: '03 / 物理机械键盘踏击装置',
      s3_desc: '16 个下行运动神经元 (DNs) 输出实时解码为按键指令，物理映射到果蝇踏击动作。',
      s4_tag: '强化演化',
      s4_title: 'CEM 跨熵零偏置演化',
      s4_desc: '无导数跨熵演化直接搜索稳健的零偏置线性解码器，不含任何手写人工势场作弊代码。',
      log_title: '遥测数据流 // 实时电生理与行为事件'
    },
    footer: {
      credit: 'Fly Touhou · 致敬 FlyDino (cobanov.dev) 与 HHMI Janelia MaleCNS 连接组',
      sync: '60Hz 浏览器端自主具身仿真'
    }
  },
  en: {
    nav: {
      workbench: 'Live Workbench',
      training: 'Training Bench',
      benchmark: 'Benchmark',
      methods: 'Methods'
    },
    hero: {
      eyebrow: 'MEASURED CONNECTOME EXPERIMENT · HHMI JANELIA MALECNS',
      title: 'Fly Touhou · A connectome evasion experiment',
      desc: 'Can a measured male fruit fly (Drosophila melanogaster) connectome circuit dodge bullet hell in real time? Driven by a {n}-neuron subcircuit, 8 biological visual receptive fields (LC/LPLC), and an evolved motor readout.',
      spec_circuit_label: 'CIRCUIT:',
      spec_circuit_val: 'MaleCNS v1.0 ({n} cells / {e} synapses)',
      spec_readout_label: 'READOUT:',
      spec_readout_val: '320 Parameters (CEM Evolved)',
      spec_frequency_label: 'FREQUENCY:',
      spec_frequency_val: '60Hz Physics Synchronous',
      spec_benchmark_label: 'BENCHMARK:',
      spec_benchmark_val: '{bt}s (Trained) vs {st}s (Silenced)'
    },
    toolbar: {
      status_active: 'MaleCNS 60Hz Active',
      status_silenced: 'MaleCNS Ablated Silenced',
      warp: 'WARP:',
      controller: 'CONTROLLER:',
      mode_trained: 'Trained Brain',
      mode_silenced: 'Silenced Circuit',
      mode_random: 'Random Control',
      mode_human: 'Manual WASD',
      radar_on: '👁️ Radar: ON',
      radar_off: '👁️ Radar: OFF',
      respawn_on: '♾️ Respawn: ON',
      respawn_off: '♾️ Respawn: OFF',
      plasticity: 'PLASTICITY:',
      plasticity_title: 'P4-1 Hebbian synaptic plasticity toggle (whether W self-updates per frame)',
      reset: '🔄 Reset'
    },
    panel: {
      env_title: '01 // TOUHOU STG ARENA',
      env_sub: 'HITBOX: 3.5PX | GRAZE: 28PX',
      spellcard_label: 'SPELLCARD: ',
      spellcard_1: 'Hail Sign "Hailstorm" (th06 ECL port)',
      spellcard_2: 'Spellcard 2: Circular Barrage',
      spellcard_3: 'Spellcard 3: High-Density Aimed',
      spellcard_4: 'Spellcard 4: Interlocking Spiral',
      spellcard_5: 'Nether Sign "Scarlet Netherworld" (th06 Stage 6 Boss Remilia)',
      diff_label: 'DIFFICULTY: ',
      diff_cap: '45s Cap',
      diff_super_easy: 'Super Easy',
      diff_easy: 'Easy',
      diff_normal: 'Normal',
      diff_hard: 'Hard',
      diff_lunatic: 'Lunatic',

      net_title: '02 // MALECNS V1.0 GRAPH',
      net_sub: '{n} NODES / {e} SYNAPSES',
      net_active: '● CONNECTOME ACTIVE',
      net_silenced: '○ SILENCED ABLATION',
      net_reservoir: 'RESERVOIR // 3 SUBSTEPS PER FRAME',
      net_plasticity_off: 'PLASTICITY // OFF (W FROZEN)',
      net_plasticity_on: 'PLASTICITY // REL. W DRIFT',

      rig_title: '03 // MOTOR KEYBOARD RIG',
      rig_sub: 'Fruit Fly Keypress Output · 60Hz Embodiment',
      rig_input: 'INPUT // 16 DNs READOUT',
      rig_latency: 'LATENCY // 0-FRAME SYNC',

      sensory_title: '04 // SENSORY & PROPRIOCEPTION',
      sensory_sub: '8-CH THREAT, FLOW & POSITION',
      lc4: 'LC4 (Looming Threat)',
      lc11: 'LC11 (Left Small Threat)',
      lc9: 'LC9 (Right Small Threat)',
      lc15: 'LC15 (Rear Threat)',
      lc16: 'LC16 (Horizontal Optical Flow)',
      lc17: 'LC17 (Vertical Optical Flow)',
      lc21: 'LC21 (Proprioception · X)',
      lplc2: 'LPLC2 (Proprioception · Y)'
    },
    metrics: {
      survival: '⏱️ SURVIVAL TIME',
      max_survival: '🏆 MAX SURVIVAL',
      graze: '⚡ GRAZE COUNT',
      hits: '💥 TOTAL HITS',
      round: '⚔️ KILL ROUNDS',
      spikes: '🧬 SPIKE RATE',
      gf_evasions: '🛡️ GF EVASIONS'
    },
    train: {
      title: 'Training Bench · CEM Neuroevolution',
      desc: 'The biological MaleCNS connectome is fixed; only the 320 linear readout parameters connecting descending neurons (DNs) to motor outputs are evolved. Run evolutionary iterations in the browser or reload the pre-trained champion policy.',
      badge: 'CROSS-ENTROPY METHOD<br>320 EVOLVABLE WEIGHTS',
      step: '⚡ Step 1 Generation',
      restore: '👑 Restore Champion Policy',
      reset: '🎲 Reset to Random',
      mode_survival: '🚩 Mode: Survival Training (Click to Stage Gauntlet)',
      mode_stage: '⛩️ Mode: Stage Gauntlet (Click to Survival Training)',
      next_stage: '⏩ Next Stage',
      stage_label: 'STAGE:',
      stage_1: 'Stage 1: Misty Lake Breakthrough',
      stage_2: 'Stage 2: Scarlet Devil Swirl',
      stage_3: 'Stage 3: Hakurei Barrier Trial',
      gen: 'GENERATION',
      best: 'BEST SURVIVAL',
      avg_graze: 'AVERAGE GRAZE',
      optimizer: 'OPTIMIZER',
      optimizer_val: 'CEM (Covariance Adaptation)',
      tbl_baseline: 'Evaluation Baseline (50 Ep. Average)',
      tbl_survival: 'Survival Time (s)',
      tbl_frames: 'Frames Survived',
      tbl_significance: 'Causal Significance',
      row_trained_label: '🧠 Trained MaleCNS Connectome (Champion)',
      row_trained_desc: 'Full biological sensory-motor evasion active',
      row_control_label: '🔀 Matched Control (Degree-Preserving)',
      row_control_desc: 'Identical degrees & synapses, biological topology randomized (Maslov-Sneppen)',
      row_silenced_label: '🔇 Circuit Silenced Control (Ablated)',
      row_silenced_desc: 'p < 0.001 (Loss of perception results in fatal collision)',
      row_static_label: '🛑 Static Inertia Baseline',
      row_static_desc: 'Stationary center baseline'
    },
    methods: {
      title: 'Methods & Causal Framework',
      s1_tag: 'Perception',
      s1_title: '8-Channel Receptive Field',
      s1_desc: 'LC4, LC11, LC9, and LPLC2 lobula projection neurons continuously extract looming threats and optical flow vectors.',
      s2_tag: 'Dynamics',
      s2_title: 'MaleCNS Reservoir',
      s2_desc: '{n} neurons and {e} synapses solved via non-linear leaky tanh recurrent dynamics over 3 sub-steps per frame.',
      s3_tag: 'Actuation',
      s3_title: '03 / Keyboard Rig',
      s3_desc: '16 descending neuron (DN) outputs decoded into real-time physical keypresses, manifested in the mechanical stepping rig.',
      s4_tag: 'Optimization',
      s4_title: 'CEM Neuroevolution',
      s4_desc: 'Derivative-free cross-entropy evolution discovers robust zero-bias linear readout parameters without hand-tuned artificial fields.',
      log_title: 'TELEMETRY STREAM // REAL-TIME ELECTROPHYSIOLOGICAL EVENTS'
    },
    footer: {
      credit: 'Fly Touhou · Inspired by FlyDino (cobanov.dev) & HHMI Janelia MaleCNS Connectome',
      sync: '60Hz Browser Autonomous Simulation'
    }
  }
};

let currentLang = 'zh';

export function getLanguage() {
  return currentLang;
}

// 动态模板上下文：{n} {e} 等占位符在 t()/applyLanguage 时插值，供拓扑数据集切换复用
let i18nContext = {};
export function setI18nContext(ctx) {
  i18nContext = Object.assign({}, i18nContext, ctx);
}

function interpolate(str) {
  if (typeof str !== 'string' || str.indexOf('{') < 0) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (i18nContext[k] !== undefined ? String(i18nContext[k]) : m));
}

export function t(path, lang = currentLang) {
  const keys = path.split('.');
  let obj = translations[lang] || translations.zh;
  for (const k of keys) {
    if (!obj || typeof obj !== 'object') return path;
    obj = obj[k];
  }
  return obj !== undefined ? interpolate(obj) : path;
}

export function applyLanguage(lang) {
  if (lang !== 'zh' && lang !== 'en') lang = 'zh';
  currentLang = lang;
  try {
    localStorage.setItem('fly_touhou_lang', lang);
  } catch (e) {}

  // 1. 更新所有具有 data-i18n 的普通 DOM 元素
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = t(key, lang);
    if (text) {
      if (text.includes('<br>') || text.includes('<b>') || text.includes('<em>') || text.includes('<strong>')) {
        el.innerHTML = text;
      } else {
        el.textContent = text;
      }
    }
  });

  // 2. 更新语言切换按钮状态
  const btnZh = document.getElementById('btnLangZh');
  const btnEn = document.getElementById('btnLangEn');
  if (btnZh) btnZh.classList.toggle('active', lang === 'zh');
  if (btnEn) btnEn.classList.toggle('active', lang === 'en');

  // 3. 广播语言变更事件
  window.dispatchEvent(new CustomEvent('languageChange', { detail: { lang } }));
}

export function initI18n() {
  let savedLang = 'zh';
  try {
    const stored = localStorage.getItem('fly_touhou_lang');
    if (stored === 'zh' || stored === 'en') {
      savedLang = stored;
    } else {
      const navLang = navigator.language || navigator.userLanguage || '';
      if (!navLang.toLowerCase().startsWith('zh')) {
        savedLang = 'en';
      }
    }
  } catch (e) {}

  applyLanguage(savedLang);
}
