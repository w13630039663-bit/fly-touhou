/**
 * policy.js - 零偏置反射型动作解码网络 (Zero-Bias Reflexive Readout Policy)
 * 
 * 架构: 16 个 MaleCNS 下行神经元 (DN) -> 16 隐藏层 (tanh) -> 4 动作评分 (Left, Right, Up, Down)
 * 关键设计: 无偏置项 (Zero Bias)
 * 
 * 科学因果性数学保证:
 * 当输入向量 x = 0 (大脑静音消融，或无生物神经发放) 时:
 * h = tanh(W1 * 0) = 0
 * scores = W2 * 0 = 0
 * (moveX, moveY) 严格恒等于 (0, 0)
 * 
 * 彻底杜绝策略退化为开环常数漂移，保证 100% 的位移必须且只能由 MaleCNS 连接组电活动因果驱动！
 * 参数总量: 16 * 16 + 16 * 4 = 320 个权重
 * v7 扩展 (PLAN_520 B.1): 可选第 321/322 位 = DN 总入「兴奋/抑制」两个全局增益
 * (作用于 connectome 侧, 见 MaleCNSConnectome.applyDnGains; 增益 1.0 时与 320 版逐位一致)。
 */ 

export const PARAMETERS = 16 * 16 + 16 * 4; // 320
export const PARAMETERS_V7 = PARAMETERS + 2; // 322

export class ReadoutPolicy {
  constructor(weights = null) {
    this.parameters = weights ? weights.length : PARAMETERS;
    this.weights = weights || new Float64Array(PARAMETERS);
    this.loaded = false;
  }

  /** 从权重向量取 DN 全局增益 (320 版恒为 1/1; 越界值由 applyDnGains 钳制) */
  get gains() {
    return this.weights.length > PARAMETERS
      ? { exc: this.weights[PARAMETERS], inh: this.weights[PARAMETERS + 1] }
      : { exc: 1, inh: 1 };
  }

  async loadCheckpoint(url = './public/data/checkpoint.json') {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.weights && (data.weights.length === PARAMETERS || data.weights.length === PARAMETERS_V7)) {
          this.weights = new Float64Array(data.weights);
          this.loaded = true;
          this.checkpointData = data;
          console.log(`[ReadoutPolicy] 成功载入预训练 Checkpoint (Fitness: ${data.bestFitness?.toFixed(1)})`);
          return data;
        }
      }
    } catch (e) {
      console.warn('[ReadoutPolicy] 无法加载外部 Checkpoint，使用内置权重:', e.message);
    }
    return false;
  }

  /**
   * 前向反射推断 (无偏置，严格因果对称)
   * @param {number[]} dnOutputs 16 个下行运动神经元的放电输出
   * @returns {{ moveX: number, moveY: number, scores: Float64Array, hidden: Float64Array, inputs: number[] }}
   */
  forward(dnOutputs) {
    const hidden = new Float64Array(16);
    let k = 0;

    // Layer 1: 16 DNs -> 16 Hidden (tanh), 无 bias
    for (let h = 0; h < 16; h++) {
      let sum = 0;
      for (let i = 0; i < 16; i++) {
        sum += this.weights[k++] * dnOutputs[i];
      }
      hidden[h] = Math.tanh(sum);
    }

    // Layer 2: 16 Hidden -> 4 Action scores (Left, Right, Up, Down), 无 bias
    const scores = new Float64Array(4);
    for (let a = 0; a < 4; a++) {
      let sum = 0;
      for (let h = 0; h < 16; h++) {
        sum += this.weights[k++] * hidden[h];
      }
      scores[a] = sum;
    }

    // 动作空间映射:
    // 水平: Right - Left
    // 垂直: Down - Up
    const moveX = Math.tanh(scores[1] - scores[0]);
    const moveY = Math.tanh(scores[3] - scores[2]);

    return { moveX, moveY, scores, hidden, inputs: dnOutputs };
  }
}
