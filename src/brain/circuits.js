/**
 * 果蝇中枢神经系统（MaleCNS / FlyWire 架构子集）神经回路定义
 * 包含：
 * 1. 视网膜复眼感受野 (Ommatidia: 16方位角分区)
 * 2. 运动与光流检测层 (T4/T5 方向选择性细胞)
 * 3. 中央复合体环形罗盘 (EPG 罗盘神经元，用于空间定位与屏幕中下部归中偏好)
 * 4. 巨纤维逃生系统 (Giant Fiber System: GF-L, GF-R，高阈值爆发式闪避)
 * 5. 下行运动神经元 (Descending Neurons: DN_UP, DN_DOWN, DN_LEFT, DN_RIGHT, DN_FOCUS)
 * 6. 多巴胺神经递质回路 (PPL101 痛觉惩罚, PAM 擦弹奖励)
 */

export const NEURON_TYPES = {
  SENSORY: 'sensory',      // 复眼感受器
  INTER: 'inter',          // 中间神经元 (光流/罗盘)
  GIANT_FIBER: 'gf',       // 巨纤维逃生中枢
  KENYON: 'kenyon',        // 蘑菇体 Kenyon 细胞 (稀疏特征编码)
  MBON: 'mbon',            // 蘑菇体输出神经元 (强化学习决策)
  MOTOR: 'motor',          // 下行运动神经元
  MODULATORY: 'mod'        // 多巴胺奖惩神经元
};

export function createFruitFlyCircuits() {
  const neurons = [];
  const synapses = [];

  const addNeuron = (id, label, type, layer, x, y, custom = {}) => {
    neurons.push({
      id,
      label,
      type,
      layer,
      x,
      y,
      v: -65.0,            // 静息膜电位 (mV)
      vRest: -65.0,
      vThresh: -48.0,      // 动作电位阈值 (mV)
      vReset: -68.0,       // 复位电位 (mV)
      refractory: 0,       // 不应期剩余步数
      refractoryPeriod: 2, // 不应期步数
      spiked: false,
      spikeCount: 0,
      lastSpikeTime: 0,
      ...custom
    });
  };

  const addSynapse = (preId, postId, weight, type = 'excitatory', options = {}) => {
    synapses.push({
      pre: preId,
      post: postId,
      weight,
      initialWeight: weight,
      type, // 'excitatory' or 'inhibitory'
      plastic: !!options.plastic,
      minWeight: options.minWeight !== undefined ? options.minWeight : (type === 'inhibitory' ? -35.0 : 0.0),
      maxWeight: options.maxWeight !== undefined ? options.maxWeight : (type === 'inhibitory' ? 0.0 : 35.0),
      name: options.name || `${preId}->${postId}`,
      eligibility: 0
    });
  };

  // ==================== 1. 复眼视网膜感受野 (Ommatidia: 16 扇区) ====================
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const nx = 0.15 + Math.cos(angle) * 0.10;
    const ny = 0.50 + Math.sin(angle) * 0.38;
    addNeuron(`EYE_${i}`, `复眼-${i*22.5}°`, NEURON_TYPES.SENSORY, 0, nx, ny, {
      vRest: -65.0,
      vThresh: -52.0
    });
  }

  // ==================== 2. 光流与运动检测中间神经元 (T4/T5 & Looming) ====================
  addNeuron('T4_LEFT',   'T4-左向光流', NEURON_TYPES.INTER, 1, 0.36, 0.25);
  addNeuron('T4_RIGHT',  'T4-右向光流', NEURON_TYPES.INTER, 1, 0.36, 0.75);
  addNeuron('T4_UP',     'T4-前向推进', NEURON_TYPES.INTER, 1, 0.36, 0.40);
  addNeuron('T4_DOWN',   'T4-后向收缩', NEURON_TYPES.INTER, 1, 0.36, 0.60);

  addNeuron('LOOMING_L', 'Looming-左逼近', NEURON_TYPES.INTER, 1, 0.40, 0.20);
  addNeuron('LOOMING_R', 'Looming-右逼近', NEURON_TYPES.INTER, 1, 0.40, 0.80);
  addNeuron('LOOMING_F', 'Looming-正前逼近', NEURON_TYPES.INTER, 1, 0.40, 0.50);

  // ==================== 3. 中央复合体罗盘神经元 (EPG Ring Neurons) ====================
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const nx = 0.56 + Math.cos(angle) * 0.07;
    const ny = 0.50 + Math.sin(angle) * 0.20;
    addNeuron(`EPG_${i}`, `EPG-方位${i*45}°`, NEURON_TYPES.INTER, 2, nx, ny);
  }

  // ==================== 4. 蘑菇体 (Mushroom Body: KC & MBON 强化学习中枢) ====================
  // Kenyon 细胞 (KC: 稀疏时空特征抽取)
  addNeuron('KC_THREAT_L', 'KC-左侧威胁', NEURON_TYPES.KENYON, 2.5, 0.48, 0.28);
  addNeuron('KC_THREAT_R', 'KC-右侧威胁', NEURON_TYPES.KENYON, 2.5, 0.48, 0.72);
  addNeuron('KC_THREAT_F', 'KC-正前死线', NEURON_TYPES.KENYON, 2.5, 0.48, 0.50);
  addNeuron('KC_GAP_L',    'KC-左侧通道', NEURON_TYPES.KENYON, 2.5, 0.52, 0.38);
  addNeuron('KC_GAP_R',    'KC-右侧通道', NEURON_TYPES.KENYON, 2.5, 0.52, 0.62);
  addNeuron('KC_DENSE',    'KC-弹幕密度', NEURON_TYPES.KENYON, 2.5, 0.52, 0.50);

  // MBON 蘑菇体输出神经元 (决策输出)
  addNeuron('MBON_EVADE_L',  'MBON-左侧侧滑', NEURON_TYPES.MBON, 3.5, 0.78, 0.32);
  addNeuron('MBON_EVADE_R',  'MBON-右侧侧滑', NEURON_TYPES.MBON, 3.5, 0.78, 0.68);
  addNeuron('MBON_DIVE_UP',  'MBON-前冲钻缝', NEURON_TYPES.MBON, 3.5, 0.80, 0.44);
  addNeuron('MBON_BACK_OFF', 'MBON-减速后拉', NEURON_TYPES.MBON, 3.5, 0.80, 0.56);
  addNeuron('MBON_FOCUS',    'MBON-低速微操', NEURON_TYPES.MBON, 3.5, 0.82, 0.50);

  // ==================== 5. 巨纤维逃生神经元 (Giant Fiber System) ====================
  addNeuron('GF_LEFT', '左巨纤维(GF-L)', NEURON_TYPES.GIANT_FIBER, 3, 0.72, 0.35, {
    vThresh: -45.0,
    burstWeight: 28.0
  });
  addNeuron('GF_RIGHT', '右巨纤维(GF-R)', NEURON_TYPES.GIANT_FIBER, 3, 0.72, 0.65, {
    vThresh: -45.0,
    burstWeight: 28.0
  });

  // ==================== 6. 下行运动神经元 (Descending Neurons -> 映射为按键) ====================
  addNeuron('DN_LEFT',  'DNp-向左平移 (←)', NEURON_TYPES.MOTOR, 4, 0.90, 0.25);
  addNeuron('DN_RIGHT', 'DNp-向右平移 (→)', NEURON_TYPES.MOTOR, 4, 0.90, 0.75);
  addNeuron('DN_UP',    'DNp-向上推进 (↑)', NEURON_TYPES.MOTOR, 4, 0.90, 0.42);
  addNeuron('DN_DOWN',  'DNp-向下撤退 (↓)', NEURON_TYPES.MOTOR, 4, 0.90, 0.58);
  addNeuron('DN_FOCUS', 'DNp-低速微操 (Shift)', NEURON_TYPES.MOTOR, 4, 0.94, 0.50);

  // ==================== 7. 多巴胺奖惩神经元 (Neuromodulators) ====================
  addNeuron('PPL101', 'PPL101-痛觉惩罚', NEURON_TYPES.MODULATORY, 2, 0.60, 0.15);
  addNeuron('PAM',    'PAM-擦弹奖励',    NEURON_TYPES.MODULATORY, 2, 0.60, 0.85);

  // ==================== 突触连接拓扑定义 ====================

  // 复眼到光流与 Looming 感受神经元连接
  for (let i = 0; i < 16; i++) {
    if (i >= 7 && i <= 11) {
      addSynapse(`EYE_${i}`, 'LOOMING_L', 16.0);
      addSynapse(`EYE_${i}`, 'T4_LEFT', 14.0);
      addSynapse(`EYE_${i}`, 'KC_THREAT_L', 12.0);
    }
    if (i === 13 || i === 14 || i === 15 || i === 0 || i === 1) {
      addSynapse(`EYE_${i}`, 'LOOMING_R', 16.0);
      addSynapse(`EYE_${i}`, 'T4_RIGHT', 14.0);
      addSynapse(`EYE_${i}`, 'KC_THREAT_R', 12.0);
    }
    if (i === 11 || i === 12 || i === 13) {
      addSynapse(`EYE_${i}`, 'LOOMING_F', 18.0);
      addSynapse(`EYE_${i}`, 'T4_UP', 10.0);
      addSynapse(`EYE_${i}`, 'KC_THREAT_F', 14.0);
    }
    if (i >= 3 && i <= 5) {
      addSynapse(`EYE_${i}`, 'T4_DOWN', 10.0);
    }
  }

  // Looming -> GF 逃生中枢 (硬编码本能)
  addSynapse('LOOMING_L', 'GF_LEFT', 20.0);
  addSynapse('LOOMING_R', 'GF_RIGHT', 20.0);

  // GF -> DN (爆发式避障)
  addSynapse('GF_LEFT', 'DN_RIGHT', 25.0);
  addSynapse('GF_LEFT', 'DN_DOWN', 10.0);
  addSynapse('GF_LEFT', 'DN_LEFT', -15.0, 'inhibitory');

  addSynapse('GF_RIGHT', 'DN_LEFT', 25.0);
  addSynapse('GF_RIGHT', 'DN_DOWN', 10.0);
  addSynapse('GF_RIGHT', 'DN_RIGHT', -15.0, 'inhibitory');

  // T4/T5 光流本能连接
  addSynapse('T4_LEFT', 'DN_RIGHT', 12.0);
  addSynapse('T4_RIGHT', 'DN_LEFT', 12.0);
  addSynapse('T4_UP', 'DN_DOWN', 10.0);
  addSynapse('T4_DOWN', 'DN_UP', 8.0);

  // EPG 罗盘神经元稳态引导
  addSynapse('EPG_4', 'DN_DOWN', 8.0);
  addSynapse('EPG_0', 'DN_UP', 6.0);
  addSynapse('EPG_2', 'DN_LEFT', 8.0);
  addSynapse('EPG_6', 'DN_RIGHT', 8.0);

  // ==================== ★★★ 蘑菇体可塑性突触 (三因子 Hebb 强化学习连接) ★★★ ====================
  // 这些突触将根据 PAM 奖赏与 PPL1 惩罚动态增强(LTP)或削弱(LTD)！
  addSynapse('KC_THREAT_L', 'MBON_EVADE_R', 16.0, 'excitatory', { plastic: true, name: '左威胁->右避闪' });
  addSynapse('KC_THREAT_L', 'MBON_EVADE_L',  2.0, 'excitatory', { plastic: true, name: '左威胁->左避闪' });
  addSynapse('KC_THREAT_R', 'MBON_EVADE_L', 16.0, 'excitatory', { plastic: true, name: '右威胁->左避闪' });
  addSynapse('KC_THREAT_R', 'MBON_EVADE_R',  2.0, 'excitatory', { plastic: true, name: '右威胁->右避闪' });
  
  addSynapse('KC_THREAT_F', 'MBON_EVADE_L', 10.0, 'excitatory', { plastic: true, name: '正前方->左侧滑' });
  addSynapse('KC_THREAT_F', 'MBON_EVADE_R', 10.0, 'excitatory', { plastic: true, name: '正前方->右侧滑' });
  
  addSynapse('KC_GAP_L', 'MBON_EVADE_L', 14.0, 'excitatory', { plastic: true, name: '左空隙->左侧钻' });
  addSynapse('KC_GAP_R', 'MBON_EVADE_R', 14.0, 'excitatory', { plastic: true, name: '右空隙->右侧钻' });
  addSynapse('KC_GAP_L', 'MBON_DIVE_UP',  8.0, 'excitatory', { plastic: true, name: '左空隙->前冲' });
  addSynapse('KC_GAP_R', 'MBON_DIVE_UP',  8.0, 'excitatory', { plastic: true, name: '右空隙->前冲' });

  addSynapse('KC_DENSE', 'MBON_FOCUS',    15.0, 'excitatory', { plastic: true, name: '密弹幕->开启低速' });
  addSynapse('KC_DENSE', 'MBON_BACK_OFF',  8.0, 'excitatory', { plastic: true, name: '密弹幕->后撤防守' });

  // MBON 输出连接至下行运动神经元 (固定传导桥梁)
  addSynapse('MBON_EVADE_L',  'DN_LEFT',  18.0);
  addSynapse('MBON_EVADE_R',  'DN_RIGHT', 18.0);
  addSynapse('MBON_DIVE_UP',  'DN_UP',    14.0);
  addSynapse('MBON_BACK_OFF', 'DN_DOWN',  14.0);
  addSynapse('MBON_FOCUS',    'DN_FOCUS', 16.0);

  return { neurons, synapses };
}
