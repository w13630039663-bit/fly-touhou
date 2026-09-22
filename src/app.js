/**
 * app.js - 东方Project 弹幕避障系统主入口
 * 
 * 核心架构:
 * 1. HHMI Janelia MaleCNS v1.0 真实局部连接组 (80 神经元, 1,296 突触边)
 * 2. 8 通道生物学感觉特征感知 (LC4, LC11, LC9, LC15, LC16, LC17, LC21, LPLC2)
 * 3. 320 参数零偏置 Readout 动作解码器 (16 DNs -> 16 Tanh -> 4 方向, 严格零偏置因果反射)
 * 4. 科学消融基准对照 (已训练脑 vs 静音大脑 vs 随机基线)
 */

import { MaleCNSConnectome } from './brain/connectome.js';
import { ReadoutPolicy, PARAMETERS } from './brain/policy.js';
import { DanmakuGame } from './game/danmaku.js';
import { BrainVisualizer } from './visualizer/brain_view.js';
import { KeyboardRigVisualizer } from './visualizer/keyboard_rig.js';
import { initI18n, applyLanguage, getLanguage, t, setI18nContext } from './i18n.js';

function bootstrap() {
  // 初始化国际化多语言系统（默认 v1 拓扑上下文，数据集就绪后自动刷新）
  setI18nContext({ n: '80', e: '1,296', bt: '—', st: '—' });
  initI18n();

  const gameCanvas = document.getElementById('gameCanvas');
  const brainCanvas = document.getElementById('brainCanvas');
  const curveCanvas = document.getElementById('curveCanvas');
  const keyboardRigCanvas = document.getElementById('keyboardRigCanvas');

  // 初始化核心组件
  const brain = new MaleCNSConnectome();
  const policy = new ReadoutPolicy();
  const randomWeights = new Float64Array(PARAMETERS).map(() => (Math.random() - 0.5) * 0.8);
  const randomPolicy = new ReadoutPolicy(randomWeights);
  const game = new DanmakuGame(gameCanvas, { difficulty: 'Normal' });
  // v8 浏览器猎杀模式：苍蝇把 Boss 血条打空 → 立即停止仿真计算并定格战报。
  // headless 训练/测试评估 (eval_core.js / train.js) 从不开启此开关，适应度口径逐位不变。
  game.endOnBossDefeat = true;
  const visualizer = new BrainVisualizer(brainCanvas, brain);
  // 02 卡片重做：画布铺满面板并按 devicePixelRatio 重绑定 backing store
  visualizer.syncSize();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => visualizer.syncSize()).observe(brainCanvas);
  } else {
    window.addEventListener('resize', () => visualizer.syncSize());
  }
  if (window.matchMedia) {
    const watchDpr = () => {
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', () => { visualizer.syncSize(); watchDpr(); }, { once: true });
    };
    watchDpr();
  }
  const keyboardRig = new KeyboardRigVisualizer(keyboardRigCanvas);

  // 运行状态与控制模式: 'trained' | 'silenced' | 'random' | 'human'
  let controlMode = 'trained';
  let simSpeed = 1;
  let generation = 1;
  let bestSurvival = 0.0;
  let totalGraze = 0;
  const survivalHistory = [0.0];

  // 日志打印辅助
  const eventLogList = document.getElementById('eventLogList');
  function updateEventLog(text) {
    if (!eventLogList) return;
    const li = document.createElement('li');
    const timeStr = game.survivalTime.toFixed(1) + 's';
    li.innerHTML = `<span class="log-time">[${timeStr}]</span> ${text}`;
    eventLogList.prepend(li);
    if (eventLogList.children.length > 25) {
      eventLogList.removeChild(eventLogList.lastChild);
    }
  }

  // 后台无阻塞载入真实 MaleCNS 数据与训练好的 Checkpoint
  // 数据集开关：v1 = 80 细胞原通路；v600 = 600 细胞闭包 (规模对照, 稀释受害版)；
  // v600a = 加性两段归一化修复版 (PLAN_520 A 冠军)；v600b = v1 读出恢复版 (C 冠军)。
  const DATASETS = {
    v1: {
      graph: '/public/data/connectome/graph.json',
      manifest: '/public/data/connectome/manifest.json',
      checkpoint: '/public/data/checkpoint.json',
      label: 'MaleCNS-80'
    },
    v600: {
      graph: '/public/data/connectome/graph600.json',
      manifest: '/public/data/connectome/manifest600.json',
      checkpoint: '/public/data/checkpoint600.json',
      label: 'MaleCNS-600'
    },
    v600a: {
      graph: '/public/data/connectome/graph600a.json',
      manifest: '/public/data/connectome/manifest600a.json',
      checkpoint: '/public/data/checkpoint600a.json',
      label: 'MaleCNS-600a'
    },
    v600b: {
      graph: '/public/data/connectome/graph600b.json',
      manifest: '/public/data/connectome/manifest600b.json',
      checkpoint: '/public/data/checkpoint600b.json',
      label: 'MaleCNS-600b'
    }
  };
  let currentDataset = (() => {
    try {
      const q = new URLSearchParams(window.location.search).get('brain');
      return q && DATASETS[q] ? q : 'v1';
    } catch { return 'v1'; }
  })();
  let brainNodeCount = 80, brainEdgeCount = 1296;
  let lastGraphSha = null;   // 当前拓扑的实际哈希，供 checkpoint 拓扑守卫复用

  const fmtNum = (n) => Number(n).toLocaleString('en-US');

  function syncGraphChrome(retranslate = false) {
    setI18nContext({ n: fmtNum(brainNodeCount), e: fmtNum(brainEdgeCount) });
    const sub = document.getElementById('netSub');
    if (sub) sub.textContent = `${fmtNum(brainNodeCount)} NODES / ${fmtNum(brainEdgeCount)} SYNAPSES`;
    const badgeStatus = document.getElementById('badgeConnectomeStatus');
    if (badgeStatus && brain.isReady) {
      badgeStatus.textContent = `${DATASETS[currentDataset].label} · ${t('toolbar.status_active')}`;
    }
    // hero/methods/benchmark 等 data-i18n 静态文案随数据集重渲染（一次性，由数据集切换触发）
    if (retranslate) applyLanguage(getLanguage());
  }

  function applyCheckpointBenchmarks(ckptData) {
    if (!ckptData || !ckptData.benchmark) {
      setI18nContext({ bt: '—', st: '—' });
      return;
    }
    const bm = ckptData.benchmark;
    const setEl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    if (bm.trained && bm.circuitSilenced) {
      setI18nContext({ bt: bm.trained.seconds.toFixed(2), st: bm.circuitSilenced.seconds.toFixed(2) });
    }
    if (bm.trained) {
      setEl('tblTrainedSec', `${bm.trained.seconds.toFixed(2)}s`);
      setEl('tblTrainedFrames', `${Math.round(bm.trained.frames)} frames`);
    }
    const mcList = (bm.matchedControls && bm.matchedControls.length)
      ? bm.matchedControls
      : (bm.matchedControl ? [bm.matchedControl] : []);
    if (mcList.length) {
      const meanSec = mcList.reduce((a, c) => a + c.seconds, 0) / mcList.length;
      const meanFrames = mcList.reduce((a, c) => a + c.frames, 0) / mcList.length;
      const multi = mcList.length > 1 ? ` (×${mcList.length} 均值)` : '';
      setEl('tblControlSec', `${meanSec.toFixed(2)}s${multi}`);
      setEl('tblControlFrames', `${Math.round(meanFrames)} frames${multi}`);
    }
    if (bm.circuitSilenced) {
      setEl('tblSilencedSec', `${bm.circuitSilenced.seconds.toFixed(2)}s`);
      setEl('tblSilencedFrames', `${Math.round(bm.circuitSilenced.frames)} frames`);
    }
    if (bm.idle) {
      setEl('tblStaticSec', `${bm.idle.seconds.toFixed(2)}s`);
      setEl('tblStaticFrames', `${Math.round(bm.idle.frames)} frames`);
    }
  }

  async function loadDataset(key) {
    const ds = DATASETS[key] || DATASETS.v1;
    currentDataset = DATASETS[key] ? key : 'v1';
    const res = await fetch(ds.graph);
    const buf = await res.arrayBuffer();
    const data = JSON.parse(new TextDecoder('utf-8').decode(buf));
    // 拓扑自描述守卫：用同一份字节算 SHA-256，与 checkpoint.topology.graphSha256 对账
    let graphSha = null;
    if (window.crypto && window.crypto.subtle) {
      try {
        const digest = await crypto.subtle.digest('SHA-256', buf);
        graphSha = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      } catch { /* 无法取证时不做否决 */ }
    }
    lastGraphSha = graphSha;
    brain.initGraph(data);
    brainNodeCount = data.nodes.length;
    brainEdgeCount = data.edges.length;
    visualizer.prepareIndices();
    visualizer.layoutNodes();
    // 载入该拓扑专属训练读出层；缺失时回退为未训练权重并如实标注
    policy.weights = new Float64Array(PARAMETERS).map(() => (Math.random() - 0.5) * 0.8);
    policy.loaded = false;
    let ck = await policy.loadCheckpoint(ds.checkpoint);
    if (ck && ck.topology && graphSha && ck.topology.graphSha256 && ck.topology.graphSha256 !== graphSha) {
      // checkpoint 声明的拓扑与当前图实际哈希不符 → 视为未训练（诚实回退）
      policy.weights = new Float64Array(PARAMETERS).map(() => (Math.random() - 0.5) * 0.8);
      policy.loaded = false;
      ck = false;
    }
    applyCheckpointBenchmarks(ck);
    // v7: 322 冠军向量的增益把手装到大脑上 (320/随机回退 ⇒ 1/1 无作用)
    brain.applyDnGains(policy.gains.exc, policy.gains.inh);
    syncGraphChrome(true);
    const isZh = getLanguage() === 'zh';
    updateEventLog(ck
      ? (isZh
        ? `✅ 已载入 ${DATASETS[currentDataset].label} 真实连接组 (${fmtNum(brainNodeCount)} 神经元 / ${fmtNum(brainEdgeCount)} 突触) 与配套已训练 Readout Checkpoint！`
        : `✅ Loaded ${DATASETS[currentDataset].label} connectome (${fmtNum(brainNodeCount)} neurons / ${fmtNum(brainEdgeCount)} synapses) with trained Readout checkpoint!`)
      : (isZh
        ? `⚠️ 已载入 ${DATASETS[currentDataset].label} 真实连接组，但该拓扑暂无训练权重（随机未训练状态，测试后自动可用）。`
        : `⚠️ ${DATASETS[currentDataset].label} connectome loaded, but no trained readout checkpoint yet (untrained random weights).`));
    return ck;
}

  const datasetSelect = document.getElementById('brainDataset');
  if (datasetSelect) datasetSelect.value = currentDataset;
  if (datasetSelect) {
    datasetSelect.addEventListener('change', (e) => {
      loadDataset(e.target.value).catch((err) => {
        console.error('连接组数据集切换异常:', err);
        updateEventLog('⚠️ 数据集切换失败: ' + err.message);
      });
    });
  }

  loadDataset(currentDataset).catch((err) => {
    console.error('连接组载入异常:', err);
    updateEventLog('⚠️ 连接组数据载入异常: ' + err.message);
  });

  // 键盘操作输入
  const humanKeys = { up: false, down: false, left: false, right: false, shift: false };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') humanKeys.up = true;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') humanKeys.down = true;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') humanKeys.left = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') humanKeys.right = true;
    if (e.shiftKey || e.code === 'ShiftLeft') humanKeys.shift = true;
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') humanKeys.up = false;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') humanKeys.down = false;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') humanKeys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') humanKeys.right = false;
    if (!e.shiftKey && e.code === 'ShiftLeft') humanKeys.shift = false;
  });

  // 结算与历代曲线
  function recordEpisodeEnd(time) {
    if (time > 0.1) {
      survivalHistory.push(parseFloat(time.toFixed(1)));
      if (survivalHistory.length > 40) survivalHistory.shift();
      generation++;
      if (time > bestSurvival) {
        bestSurvival = time;
      }
      const statGen = document.getElementById('statGen');
      const statBest = document.getElementById('statBestSurvive');
      const statMaxSurvive = document.getElementById('statMaxSurvive');
      const statAvgGraze = document.getElementById('statAvgGraze');
      if (statGen) statGen.textContent = `第 ${generation} 轮`;
      if (statBest) statBest.textContent = `${bestSurvival.toFixed(1)}s`;
      if (statMaxSurvive) statMaxSurvive.textContent = `${bestSurvival.toFixed(1)}s`;
      if (statAvgGraze) statAvgGraze.textContent = `${(totalGraze / Math.max(1, generation - 1)).toFixed(1)}次`;
      drawLearningCurve();
    }
  }

  function drawLearningCurve() {
    if (!curveCanvas) return;
    const ctx = curveCanvas.getContext('2d');
    const w = curveCanvas.width;
    const h = curveCanvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#131620';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    for (let y = 20; y < h; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (survivalHistory.length < 2) {
      ctx.fillStyle = '#8b95a5';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText('WAITING FOR EPISODES...', 30, h / 2 + 3);
      return;
    }

    const maxVal = Math.max(10.0, ...survivalHistory);

    // 平面单色微透填充 (无渐变)
    ctx.beginPath();
    survivalHistory.forEach((val, idx) => {
      const x = (idx / (survivalHistory.length - 1)) * (w - 20) + 10;
      const y = h - 14 - (val / maxVal) * (h - 28);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(w - 10, h - 14);
    ctx.lineTo(10, h - 14);
    ctx.closePath();
    ctx.fillStyle = 'rgba(74, 222, 128, 0.08)';
    ctx.fill();

    // 矢量折线轮廓 (#4ade80)
    ctx.beginPath();
    survivalHistory.forEach((val, idx) => {
      const x = (idx / (survivalHistory.length - 1)) * (w - 20) + 10;
      const y = h - 14 - (val / maxVal) * (h - 28);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 游戏物理回调
  game.onGraze = () => {
    totalGraze++;
    if (simSpeed === 1) {
      updateEventLog('✨ 果蝇近距离极限擦弹 (Graze)! 验证生物动力学避障敏锐度');
    }
  };

  game.onHit = () => {
    if (simSpeed === 1) {
      if (controlMode === 'silenced') {
        updateEventLog('💥 自机中弹! [消融验证] 大脑处于静音状态，失去感知无法规避弹幕！');
      } else {
        updateEventLog('💥 自机中弹! 扣除生命。');
      }
    }
  };

  game.onDeath = (finalTime) => {
    if (simSpeed === 1) {
      updateEventLog(`💀【第 ${game.round} 轮阵亡】本轮存活 ${finalTime.toFixed(1)}s (最高纪录: ${bestSurvival.toFixed(1)}s)。全屏弹幕已清除，脑活动与感知暂停休眠，重生后难度自入门微风重新计算。`);
    }
    recordEpisodeEnd(finalTime);
  };

  game.onRespawn = () => {
    // P4-1：局内可塑 —— 复活即让 W 从生物原件重新长起（否则漂移会跨局无限累积）
    brain.restoreBioWeights();
    if (simSpeed === 1) {
      const plOn = brain.plasticity && brain.plasticity.enabled;
      updateEventLog(`🌱 果蝇重塑复活！开启第 ${game.round} 轮存活计时，难度从零重算 (0.18x)，感知与连接组恢复运算${plOn ? '，突触可塑性已重置（W 回到生物原件）' : ''}。`);
    }
  };

  game.onStageClear = (stage, time, graze) => {
    updateEventLog(`🎉【恭喜通关！】果蝇成功突破 Stage ${stage} 弹幕逆流登顶鸟居！用时: ${time.toFixed(1)}s, 擦弹: ${graze}次`);
  };

  // v8: Boss 血条打空 → 停止计算，单独汇报「击杀耗费轮数」
  game.onBossDefeat = (rounds, combatTime) => {
    updateEventLog(`🏆【Boss 击破】果蝇共耗 ${rounds} 轮打空 Boss 血条！累计战斗 ${combatTime.toFixed(1)}s，中弹 ${game.player.totalHits} 次。仿真已定格，点击「重置本局」再次挑战。`);
    recordEpisodeEnd(game.survivalTime);
  };

  // 常驻激活真实生物连接组冠军策略 (controlMode = 'trained')
  const labelAblationStatus = document.getElementById('labelAblationStatus');
  if (labelAblationStatus) {
    labelAblationStatus.textContent = '● CONNECTOME ACTIVE (Trained)';
    labelAblationStatus.style.color = '#4ade80';
    // 点击切换因果消融：同一解码器、同一输入，仅大脑归零 —— 现场演示因果性
    labelAblationStatus.style.cursor = 'pointer';
    labelAblationStatus.title = getLanguage() === 'zh' ? '点击切换大脑消融静音' : 'Click to toggle circuit ablation';
    labelAblationStatus.addEventListener('click', () => {
      brain.lesions.silenced = !brain.lesions.silenced;
      const isZh = getLanguage() === 'zh';
      labelAblationStatus.textContent = brain.lesions.silenced
        ? (isZh ? '○ 消融静音中 (活动全归零)' : '○ CIRCUIT SILENCED (all-zero)')
        : (isZh ? '● 连接组神经元放电中' : '● CONNECTOME ACTIVE');
      labelAblationStatus.style.color = brain.lesions.silenced ? '#f97316' : '#4ade80';
      updateEventLog(isZh
        ? (brain.lesions.silenced ? '🔇 [消融实验] 大脑连接组已静音：解码器与输入不变，运动输出应由因果律恒为 0。'
                                  : '🧠 [消融实验] 连接组恢复放电，避障行为应立刻回归。')
        : (brain.lesions.silenced ? '🔇 [Ablation] circuit silenced: same decoder, outputs must be causally zero.'
                                  : '🧠 [Ablation] connectome restored.'));
    });
  }

  // ================= 喵玉殿同款 恋恋 Fumo 交互彩蛋 =================
  const fumoWidget = document.getElementById('fumoWidget');
  const fumoBubble = document.getElementById('fumoBubble');
  const fumoImg = document.getElementById('fumoImg');

  if (fumoWidget && fumoBubble) {
    const fumoQuotesZh = [
      'Fumo Fumo~ (晃来晃去)',
      '恋恋在偷看连接组躲弹幕哦！',
      '闭上第三只眼，弹幕就撞不到我~',
      '擦弹 +1！苍蝇比我还灵巧？',
      '无意识的果蝇微操，好神奇呀~',
      'duang~ duang~ 弹性十足！',
      '加油小果蝇，不要撞到发光光核！'
    ];
    const fumoQuotesEn = [
      'Fumo Fumo~ (Wobble Wobble)',
      "Koishi is watching the connectome dodge bullets!",
      "Close the third eye and bullets can't hit me~",
      'Graze +1! Is this fly more agile than me?',
      'Subconscious fly reflexes are so magical~',
      'duang~ duang~ bouncy fumo!',
      "Keep going little fly, don't hit the energy core!"
    ];

    let quoteIdx = 0;
    fumoWidget.addEventListener('click', () => {
      const isEn = getLanguage() === 'en';
      const quotes = isEn ? fumoQuotesEn : fumoQuotesZh;
      quoteIdx = (quoteIdx + 1) % quotes.length;
      fumoBubble.textContent = quotes[quoteIdx];
      fumoBubble.classList.add('show');

      // 弹性跳动特效
      if (fumoImg) {
        fumoImg.style.transform = 'scale(1.2, 0.8)';
        setTimeout(() => {
          fumoImg.style.transform = 'scale(0.9, 1.1)';
          setTimeout(() => {
            fumoImg.style.transform = '';
          }, 150);
        }, 120);
      }

      setTimeout(() => {
        fumoBubble.classList.remove('show');
      }, 3500);
    });
  }

  // 仿真倍速
  const btnSpeed1x = document.getElementById('btnSpeed1x');
  const btnSpeed5x = document.getElementById('btnSpeed5x');
  const btnSpeed20x = document.getElementById('btnSpeed20x');

  function setSpeed(speed, btn) {
    simSpeed = speed;
    [btnSpeed1x, btnSpeed5x, btnSpeed20x].forEach(b => b?.classList.remove('active'));
    btn.classList.add('active');
    updateEventLog(`⚡ 仿真时空推进倍速: ${speed}x`);
  }

  if (btnSpeed1x) btnSpeed1x.addEventListener('click', () => setSpeed(1, btnSpeed1x));
  if (btnSpeed5x) btnSpeed5x.addEventListener('click', () => setSpeed(5, btnSpeed5x));
  if (btnSpeed20x) btnSpeed20x.addEventListener('click', () => setSpeed(20, btnSpeed20x));

  // ================= P4-1 Hebbian 突触可塑性档位 =================
  // OFF        W 冻结。连接组是出厂（生物）权重，与项目原始口径逐位一致。
  // η=1e-5     开启局部 Hebbian 规则 W += η(h_pre·h_post − decay·W)，并守恒 Σ|W_in|=1。
  // η=1e-4     同上，学习率提高一档。
  // 实测标定（80 节点 / 1296 边 / 单局 1800 帧）：η=1e-5 相对漂移约 3%，
  // η=1e-4 约 25~53%，η≥1e-3 会因真实输入下的正反馈而失控（漂移 >1000%）。
  // 这是**局部生物规则**（不需全局误差、不需反向传播），它确实会改变系统行为，
  // 但**没有可复现的能力提升**：同一臂换一颗 CEM 训练随机种子，η=1e-5 与冻结臂的
  // 差值从 +82 帧翻转为 −17 帧，而冻结臂自身跨种子的抖动就有 63 帧。
  // 详见 experiments/P4-1_突触可塑性实验报告.md
  const PLASTICITY_LEVELS = {
    off: { eta: 0, decay: 0, renorm: true },
    low: { eta: 1e-5, decay: 0.01, renorm: true },
    mid: { eta: 1e-4, decay: 0.01, renorm: true },
  };
  let plasticityLevel = 'off';
  const plasticityButtons = {
    off: document.getElementById('btnPlasticityOff'),
    low: document.getElementById('btnPlasticityLow'),
    mid: document.getElementById('btnPlasticityMid'),
  };
  const labelPlasticityDrift = document.getElementById('labelPlasticityDrift');

  function setPlasticityLevel(level) {
    if (!PLASTICITY_LEVELS[level]) level = 'off';
    const cfg = PLASTICITY_LEVELS[level];
    plasticityLevel = level;
    brain.setPlasticity(cfg);
    brain.restoreBioWeights();   // 切档即从生物原件重新起算，漂移归零（生物权重永不丢失）
    for (const k of Object.keys(plasticityButtons)) {
      plasticityButtons[k]?.classList.toggle('active', k === level);
    }
    if (labelPlasticityDrift && level === 'off') labelPlasticityDrift.style.display = 'none';
    const isZh = getLanguage() === 'zh';
    if (level === 'off') {
      updateEventLog(isZh
        ? '🧬 [P4-1] 突触可塑性关闭：W 已回到冻结的生物连接组原件，行为与原始口径逐位一致。'
        : '🧬 [P4-1] Plasticity OFF: W restored to the frozen biological original (bit-identical behaviour).');
    } else {
      updateEventLog(isZh
        ? `🧬 [P4-1] Hebbian 突触可塑性开启 η=${cfg.eta}：W 每帧按 W += η(h_pre·h_post − 0.01·W) 自更新，并守恒每个突触后神经元的 Σ|W_in|=1。这是一条局部生物规则（无全局误差、无反向传播），它确实改变了储备池的行为，但**没有可复现的能力提升**——换一颗训练随机种子，「比冻结臂好 +82 帧」就翻转为「差 17 帧」。`
        : `🧬 [P4-1] Hebbian plasticity ON (η=${cfg.eta}): W self-updates per frame with homeostatic renormalisation (Σ|W_in|=1). A local biological rule — no global error signal, no backprop. It does change reservoir behaviour, but yields NO reproducible skill gain: with a different training seed the "+82 frames vs frozen" flips to "−17 frames".`);
    }
  }
  plasticityButtons.off?.addEventListener('click', () => setPlasticityLevel('off'));
  plasticityButtons.low?.addEventListener('click', () => setPlasticityLevel('low'));
  plasticityButtons.mid?.addEventListener('click', () => setPlasticityLevel('mid'));

  // 模型管理
  const btnTrainStep = document.getElementById('btnTrainStep');
  const btnResetRandom = document.getElementById('btnResetRandom');
  const btnLoadMaster = document.getElementById('btnLoadMaster');

  if (btnResetRandom) {
    btnResetRandom.addEventListener('click', () => {
      for (let i = 0; i < PARAMETERS; i++) {
        policy.weights[i] = (Math.random() - 0.5) * 0.8;
      }
      updateEventLog('🎲 已重置 Readout 为随机初始权重，避弹能力归零。');
    });
  }

  if (btnLoadMaster) {
    btnLoadMaster.addEventListener('click', async () => {
      const ds = DATASETS[currentDataset];
      const ck = await policy.loadCheckpoint(ds.checkpoint);
      if (ck && ck.topology && lastGraphSha && ck.topology.graphSha256 && ck.topology.graphSha256 !== lastGraphSha) {
        policy.weights = new Float64Array(PARAMETERS).map(() => (Math.random() - 0.5) * 0.8);
        policy.loaded = false;
        updateEventLog(`⚠️ ${ds.label} 冠军权重与当前拓扑哈希不符，已拒绝载入（防串台）。`);
        return;
      }
      if (!ck) {
        updateEventLog(`⚠️ ${ds.label} 暂无可用冠军权重（未训练状态）。`);
        return;
      }
      controlMode = 'trained';
      brain.applyDnGains(policy.gains.exc, policy.gains.inh); // v7 增益把手 (320 版恒 1/1)
      const gens = ck.benchmark && ck.benchmark.trained ? ` (${ck.benchmark.trained.seconds.toFixed(1)}s 独立测试)` : '';
      updateEventLog(`👑 已重新载入 ${ds.label} 冠军读出策略${gens}！`);
    });
  }

  if (btnTrainStep) {
    btnTrainStep.addEventListener('click', () => {
      for (let i = 0; i < PARAMETERS; i++) {
        policy.weights[i] += (Math.random() - 0.5) * 0.08;
      }
      generation++;
      updateEventLog(`🚀 已在浏览器端执行在线神经微进化更新！当前进化代数: 第 ${generation} 代`);
    });
  }

  // 符卡选择与动态难度
  const rowSurvivalSelect = document.getElementById('rowSurvivalSelect');
  const selectSpellcard = document.getElementById('selectSpellcard');

  // 动态渐进难度指示条 DOM 引用
  const diffEmoji = document.getElementById('diffEmoji');
  const diffLabel = document.getElementById('diffLabel');
  const diffProgressBar = document.getElementById('diffProgressBar');
  const diffPercent = document.getElementById('diffPercent');

  // 语言切换与动态国际化绑定
  const btnLangZh = document.getElementById('btnLangZh');
  const btnLangEn = document.getElementById('btnLangEn');

  function refreshDynamicTexts() {
    const isZh = getLanguage() === 'zh';
    if (btnShowRadar) {
      btnShowRadar.textContent = game.showRadar ? t('toolbar.radar_on') : t('toolbar.radar_off');
    }
    if (btnAutoRespawn) {
      btnAutoRespawn.textContent = game.player.autoRespawn ? t('toolbar.respawn_on') : t('toolbar.respawn_off');
    }
    const badgeStatus = document.getElementById('badgeConnectomeStatus');
    if (badgeStatus && brain.isReady) {
      syncGraphChrome();
    }
    const labelAblation = document.getElementById('labelAblationStatus');
    if (labelAblation) {
      labelAblation.textContent = brain.lesions.silenced ? t('panel.net_silenced') : t('panel.net_active');
    }
  }

  if (btnLangZh) {
    btnLangZh.addEventListener('click', () => {
      applyLanguage('zh');
      refreshDynamicTexts();
    });
  }
  if (btnLangEn) {
    btnLangEn.addEventListener('click', () => {
      applyLanguage('en');
      refreshDynamicTexts();
    });
  }

  window.addEventListener('languageChange', refreshDynamicTexts);

  if (selectSpellcard) {
    selectSpellcard.addEventListener('change', (e) => {
      const idx = parseInt(e.target.value, 10);
      game.setSpellcard(idx);
      const isZh = getLanguage() === 'zh';
      updateEventLog(isZh ? `🎴 Boss 切换符卡: ${game.boss.spellcardName}` : `🎴 Boss switched spellcard: ${game.boss.spellcardName}`);
    });
  }

  // 重置与显示
  const btnRestart = document.getElementById('btnRestart');
  if (btnRestart) {
    btnRestart.addEventListener('click', () => {
      game.reset();
      brain.reset();
      brain.restoreBioWeights();   // P4-1：重置战场同时把 W 复位到生物原件
      const isZh = getLanguage() === 'zh';
      updateEventLog(isZh ? '🔄 重置本局战场与神经元状态。' : '🔄 Reset arena and neural state.');
    });
  }

  const btnShowRadar = document.getElementById('btnShowRadar');
  if (btnShowRadar) {
    btnShowRadar.addEventListener('click', () => {
      game.showRadar = !game.showRadar;
      btnShowRadar.classList.toggle('active', game.showRadar);
      btnShowRadar.textContent = game.showRadar ? t('toolbar.radar_on') : t('toolbar.radar_off');
    });
  }

  const btnAutoRespawn = document.getElementById('btnAutoRespawn');
  if (btnAutoRespawn) {
    btnAutoRespawn.addEventListener('click', () => {
      game.player.autoRespawn = !game.player.autoRespawn;
      btnAutoRespawn.classList.toggle('active', game.player.autoRespawn);
      btnAutoRespawn.textContent = game.player.autoRespawn ? t('toolbar.respawn_on') : t('toolbar.respawn_off');
    });
  }

  // 遥测仪表 DOM 引用
  const statSurvive = document.getElementById('statSurvive');
  const statGraze = document.getElementById('statGraze');
  const statHits = document.getElementById('statHits');
  const statSpikes = document.getElementById('statSpikes');
  const statGFHits = document.getElementById('statGFHits');
  const statRound = document.getElementById('statRound');

  // 8 通道感知指示条 DOM 引用
  const obsFills = Array.from({ length: 8 }, (_, i) => document.getElementById(`obsFill_${i}`));
  const obsVals = Array.from({ length: 8 }, (_, i) => document.getElementById(`obsVal_${i}`));

  let frameCount = 0;
  let latestMotorCmd = { moveX: 0, moveY: 0, focusMode: false, isHuman: false };

  // 主仿真推进循环：固定 60Hz 步进。
  // 原作 ECL 里所有弹速/角速度/加速度的单位都是「px(或rad)/帧 @60fps」，所以仿真必须按
  // 真实时间以 60Hz 推进。旧写法是「每个 requestAnimationFrame 帧推进一次」，在 120/144Hz
  // 显示器上整张符卡会跑成 2~2.4 倍速 —— 这就是「感觉弹速太快」的直接原因。
  // simSpeed 现在是倍速旋钮：1 = 实时 60Hz，2/3 = 快进（对应原作慢速模式的反面）。
  const SIM_STEP_MS = 1000 / 60;
  const MAX_STEPS_PER_FRAME = 8;   // 掉帧/切后台回来时丢弃追不上的时间，避免爆步
  let simAccum = 0;
  let simLastTs = 0;
  function loop() {
    try {
      const nowMs = performance.now();
      if (simLastTs === 0) simLastTs = nowMs;
      simAccum += Math.min(nowMs - simLastTs, 250) * simSpeed;
      simLastTs = nowMs;
      let stepped = 0;
      while (simAccum >= SIM_STEP_MS && stepped < MAX_STEPS_PER_FRAME) {
        stepped++;
        let motorCommand;

        // 如果果蝇处于 Game Over 阵亡状态或 Boss 已被击破定格：暂停所有脑活动与感知推演
        if (game.player.isDead || game.bossDefeated) {
          brain.reset(); // 全脑活动归零，神经元静止休眠
          motorCommand = { moveX: 0, moveY: 0 };
        } else {
          // 1. 获取 8 通道生物视觉感觉输入 (LC4, LC11 等)
          const obs = game.getBiologicalSensoryInput();

          // 2. MaleCNS 真实局部连接组储备池单步动力学求解
          const ablated = (controlMode === 'silenced');
          const dnOutputs = brain.step(obs, ablated);

          // 3. 计算自机控制位移指令
          if (controlMode === 'human') {
            let mx = 0, my = 0;
            if (humanKeys.left) mx -= 1;
            if (humanKeys.right) mx += 1;
            if (humanKeys.up) my -= 1;
            if (humanKeys.down) my += 1;
            motorCommand = {
              moveX: mx,
              moveY: my,
              focusMode: humanKeys.shift,
              isHuman: true
            };
          } else if (controlMode === 'random') {
            motorCommand = randomPolicy.forward(dnOutputs);
          } else {
            motorCommand = policy.forward(dnOutputs);
          }
        }

        latestMotorCmd = motorCommand;
        // 4. 更新东方游戏物理引擎
        game.update(motorCommand);
        simAccum -= SIM_STEP_MS;
      }
      if (stepped >= MAX_STEPS_PER_FRAME) simAccum = 0;

      // 5. 渲染游戏、全脑放电拓扑与机械键盘装置
      game.render();
      visualizer.update();
      visualizer.render();
      keyboardRig.update(latestMotorCmd);
      keyboardRig.render();

      // 6. 更新遥测仪表与 8 通道特征条
      frameCount++;
      if (frameCount % (simSpeed > 1 ? 10 : 3) === 0) {
        const statMaxSurvive = document.getElementById('statMaxSurvive');

        // v8: 轮次仪表 —— 存活中显示当前轮，击破后定格显示总耗轮数
        if (statRound) {
          const enRound = getLanguage() === 'en';
          statRound.textContent = game.bossDefeated
            ? (enRound ? `${game.bossKillRounds} rounds to kill` : `${game.bossKillRounds} 轮击杀`)
            : (enRound ? `Round ${game.round}` : `第 ${game.round} 轮`);
          statRound.style.color = game.bossDefeated ? '#f1c40f' : 'var(--ink)';
        }

        if (game.bossDefeated) {
          // 击破定格显示 (单独口径：跨轮累计战斗时长)
          if (statSurvive) {
            statSurvive.textContent = `${game.combatTime.toFixed(1)}s (已击破)`;
            statSurvive.style.color = '#f1c40f';
          }
          if (statSpikes) statSpikes.textContent = `0 / ${brainNodeCount} (击破停机)`;
          for (let i = 0; i < 8; i++) {
            if (obsFills[i]) obsFills[i].style.width = '0%';
            if (obsVals[i]) obsVals[i].textContent = '0%';
          }
        } else if (game.player.isDead) {
          // 阵亡状态显示与冻结
          if (statSurvive) {
            statSurvive.textContent = `${game.survivalTime.toFixed(1)}s (第 ${game.round} 轮阵亡)`;
            statSurvive.style.color = '#9ca3af';
          }
          if (statSpikes) statSpikes.textContent = `0 / ${brainNodeCount} (阵亡休眠)`;

          // 下方 8 通道感知全面暂停
          for (let i = 0; i < 8; i++) {
            if (obsFills[i]) obsFills[i].style.width = '0%';
            if (obsVals[i]) obsVals[i].textContent = '0%';
          }
        } else {
          // 正常存活状态显示
          if (statSurvive) {
            statSurvive.textContent = `${game.survivalTime.toFixed(1)}s`;
            statSurvive.style.color = '#4ade80';
          }

          // 动态刷新单轮最多存活时间
          if (game.survivalTime > bestSurvival) {
            bestSurvival = game.survivalTime;
            const statBest = document.getElementById('statBestSurvive');
            if (statBest) statBest.textContent = `${bestSurvival.toFixed(1)}s`;
            if (statMaxSurvive) statMaxSurvive.textContent = `${bestSurvival.toFixed(1)}s`;
          }

          // 统计 MaleCNS 神经元放电率
          if (brain.isReady && statSpikes) {
            let activeCount = 0;
            for (let i = 0; i < brain.count; i++) {
              if (brain.nodes[i].spiked) activeCount++;
            }
            statSpikes.textContent = `${activeCount} / ${fmtNum(brainNodeCount)}`;
          }

          // 更新 8 通道实时感知场
          if (game.cachedObservations) {
            for (let i = 0; i < 8; i++) {
              const val = game.cachedObservations[i] || 0;
              const pct = Math.round(val * 100);
              if (obsFills[i]) obsFills[i].style.width = `${pct}%`;
              if (obsVals[i]) obsVals[i].textContent = `${pct}%`;
            }
          }
        }

        // 刷新动态渐进难度卡片指示 (随存活时间自适应)
        const diffInfo = game.getDifficultyProgress();
        if (diffEmoji) diffEmoji.textContent = diffInfo.emoji;
        if (diffLabel) {
          const isEn = getLanguage() === 'en';
          const diffMap = {
            '超级简单': isEn ? 'Super Easy' : '超级简单',
            '入门微风': isEn ? 'Gentle Breeze' : '入门微风',
            '温和微风': isEn ? 'Mild Breeze' : '温和微风',
            '渐进加速': isEn ? 'Accelerating' : '渐进加速',
            'Normal 经典': isEn ? 'Classic Normal' : 'Normal 经典',
            '简单': isEn ? 'Easy' : '简单',
            '普通': isEn ? 'Normal' : '普通',
            '困难': isEn ? 'Hard' : '困难',
            '疯狂': isEn ? 'Lunatic' : '疯狂'
          };
          diffLabel.textContent = diffMap[diffInfo.label] || diffInfo.label;
        }
        if (diffProgressBar) diffProgressBar.style.width = `${diffInfo.percent}%`;
        if (diffPercent) diffPercent.textContent = `${diffInfo.percent}% (${diffInfo.mult.toFixed(2)}x)`;

        if (statGraze) statGraze.textContent = game.player.graze;
        if (statHits) statHits.textContent = game.player.totalHits;
        if (statGFHits) statGFHits.textContent = game.player.graze;
        if (statMaxSurvive) statMaxSurvive.textContent = `${bestSurvival.toFixed(1)}s`;

        // P4-1：可塑性开启时展示实时相对权重漂移（低频 O(E)，1,296 边约 3 µs，不进逐帧热路径）
        if (labelPlasticityDrift) {
          if (brain.plasticity && brain.plasticity.enabled) {
            labelPlasticityDrift.style.display = '';
            labelPlasticityDrift.textContent = `${t('panel.net_plasticity_on')} ${(brain.measureDrift() * 100).toFixed(2)}%`;
          } else {
            labelPlasticityDrift.style.display = 'none';
          }
        }
      }
    } catch (err) {
      console.error('[Render Loop Exception]:', err);
    } finally {
      requestAnimationFrame(loop);
    }
  }

  // 启动主渲染循环与首帧绘制
  refreshDynamicTexts();
  drawLearningCurve();
  const isZh = getLanguage() === 'zh';
  updateEventLog(isZh ? '🚀 MaleCNS 真实局部连接组系统启动中...' : '🚀 MaleCNS Measured Local Connectome System Booting...');
  requestAnimationFrame(loop);
}

// 确保 DOM 无论是何种状态都能立即安全启动
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
