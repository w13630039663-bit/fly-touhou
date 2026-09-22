
'use strict';

// ============ 画布 ============
const W = 460, H = 580;
const CX = W / 2, CY = H / 2;

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const DPR = Math.min(2, window.devicePixelRatio || 1);
cv.width = W * DPR;
cv.height = H * DPR;
cv.style.width = W + 'px';
cv.style.height = H + 'px';
ctx.scale(DPR, DPR);

// ============ 参数（画布坐标 460x580）============
// ===== 以下默认值全部来自 th12.dat 解包出的 ECL 源码（stage02.ecl / MBossCard1At）=====
// 符号表(ins_* 名字)在 thpatch 已废弃，故用"数值反推 + 实测交叉验证"确认语义：
//   角增量 0.121767(HL)/0.124174(EN) -> 实测同链相邻珠角差 6.98°  ✓
//   周期 218 帧 -> 换算 3.633s，与 GIF 实测 3.74s 吻合（误差 2.9%）  ✓
//   螺距 = v*2π/ω = 46.4px(画布)，实测 85~93px(GIF)=46~50px(画布)  ✓
const DEFAULTS = {
  // 中心螺旋
  arms: 5,              // [ECL] ins_502(0, 5, 4) 第一参数
  armSpacing: 46,       // [ECL] 螺距 = 弹速 × 2π/角增量
  maxRadius: 290,       // [实测] 螺旋最大半径
  rotationSpeed: 427,   // [ECL] 角增量 0.124174 rad/帧 × 60
  radialFlow: 55,       // [ECL] 弹速 0.7662421 px/帧 × 60（画布放大 1.198×）
  beadsPerTurn: 50,     // [ECL] 一圈帧数 = 2π/0.124174 = 50.6（每帧发一颗）
  beadRadius: 3.2,      // [实测] 珠子半径 (px)

  // 下落幕
  fallSpeed: 61,        // [实测] 下落速度 (px/s)
  fallMax: 180,         // 同屏上限
  fallRate: 40,         // 每秒生成数
};

const CYCLE_TIME = 3.633;  // [ECL] 波周期 = 160 + 58 = 218 帧
const BURST_FRAMES = 112;  // [ECL] 每波持续发射帧数 ($E = 112)
const MAX_BEADS_TOTAL = 2400;   // 螺旋珠子总量上限（性能保护）

let P = Object.assign({}, DEFAULTS);

const COLORS = {
  beadCore:  '#ffffff',
  beadEdge:  '#c060e0',
  fallA:     '#40e0c0',
  fallB:     '#ffe060',
  bgRed:     '#8b1a3a',
  coreGlow:  '#ffffff',
};

// ============ 状态 ============
let phase = 0;              // 螺旋基准角 (rad)
let flowOffset = 0;         // 沿径向的累积流动量 (px)
let running = true;
let showHud = true;

const fallBullets = [];
let fallAccum = 0;

let spiralCache = null;     // { count, baseR:Float64Array, baseTheta:Float64Array, turns }

// ============ 螺旋几何构建 ============
// 每条臂: theta(r) = armBase + tightness * r,  tightness = (2*PI)/armSpacing
//
// 关键推导：若要求每圈 beadsPerTurn 颗珠子，则沿半径的步长必为
//     dr = armSpacing / beadsPerTurn        (恒定值)
// 推导：一圈转 2π rad，对应径向增量 armSpacing；该圈弧长近似 2π*r，
//       故圆弧上的间距为 (2π*r)/beadsPerTurn；再除以螺旋的局部分形系数
//       sqrt(1+(tightness*r)^2) ≈ tightness*r (r 较大时)，得
//       dr = [(2π*r)/N] / [(2π/armSpacing)*r] = armSpacing / N
function buildSpiral() {
  const tightness = (2 * Math.PI) / P.armSpacing;   // rad per px
  const maxR = P.maxRadius;
  const arms = Math.max(1, P.arms | 0);

  let dr = P.armSpacing / P.beadsPerTurn;           // 理论步长
  let n = Math.floor(maxR / dr);

  // 总量保护：极端的「小圈间距 + 多臂」组合会算出上万颗珠子拖垮帧率。
  // 这里不改用户参数，而是放宽步长把密度降下来，保证任何滑块位置都不卡。
  const capPerArm = Math.max(8, Math.floor(MAX_BEADS_TOTAL / arms));
  let capped = false;
  if (n > capPerArm) {
    n = capPerArm;
    dr = maxR / n;                                  // 逆推步长，保持沿半径均匀
    capped = true;
  }

  const baseR = new Float64Array(n);
  const baseTheta = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const r = j * dr;
    baseR[j] = r;
    baseTheta[j] = tightness * r;
  }

  spiralCache = {
    count: n,
    dr: dr,
    capped: capped,
    baseR: baseR,
    baseTheta: baseTheta,
    turns: maxR / P.armSpacing,
  };
}

// ============ 下落幕 ============
function spawnFall() {
  if (fallBullets.length >= P.fallMax) return;
  fallBullets.push({
    x: Math.random() * W,
    y: -8,
    c: Math.random() < 0.5 ? COLORS.fallA : COLORS.fallB,
    r: 2.6 + Math.random() * 0.8,
    w: 0.6 + Math.random() * 0.8,     // 轻微左右摆动
    p: Math.random() * Math.PI * 2,
  });
}

// ============ 绘制 ============
function drawBossCore() {
  // 中心遮挡：珠子 curR 从 maxRadius 取模跳回 0 时，恰好落在这个圆盘背后，
  // 被完全遮住 —— 这正是原作「boss 站在螺旋中心持续吐弹」的做法，
  // 顺带解决了「珠子瞬间出现在中心」的突兀感。
  ctx.save();
  ctx.fillStyle = '#12080f';
  ctx.beginPath();
  ctx.arc(CX, CY, 28, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = COLORS.beadEdge;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.fillStyle = COLORS.coreGlow;
  ctx.beginPath();
  ctx.arc(CX, CY, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBackground() {
  ctx.fillStyle = '#08080c';
  ctx.fillRect(0, 0, W, H);

  // 暗红背景螺旋纹（静态，低透明度），跟随当前圈间距
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.strokeStyle = COLORS.bgRed;
  ctx.lineWidth = 2;
  const k = (2 * Math.PI) / (P.armSpacing * 1.9);
  for (let a = 0; a < P.arms; a++) {
    ctx.beginPath();
    const base = (a / P.arms) * Math.PI * 2;
    for (let r = 0; r < 460; r += 4) {
      const th = base + k * r;
      const x = CX + r * Math.cos(th);
      const y = CY + r * Math.sin(th);
      if (r === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 中心光晕
  const g = 52;
  ctx.save();
  for (let i = 6; i >= 1; i--) {
    ctx.globalAlpha = 0.035;
    ctx.fillStyle = COLORS.coreGlow;
    ctx.beginPath();
    ctx.arc(CX, CY, g * i / 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSpiral() {
  if (!spiralCache) return;
  const n = spiralCache.count;
  const arms = P.arms | 0;
  const maxR = P.maxRadius;
  const br = P.beadRadius;

  // 批量 path：先画所有紫边，再一次 fill
  ctx.save();
  ctx.fillStyle = COLORS.beadEdge;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  for (let a = 0; a < arms; a++) {
    const armBase = (a / arms) * Math.PI * 2 + phase;
    for (let j = 0; j < n; j++) {
      const rr = (spiralCache.baseR[j] + flowOffset) % maxR;
      const th = armBase + spiralCache.baseTheta[j];
      const x = CX + rr * Math.cos(th);
      const y = CY + rr * Math.sin(th);
      ctx.moveTo(x + br * 1.9, y);
      ctx.arc(x, y, br * 1.9, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();

  // 批量 path：白色珠心
  ctx.save();
  ctx.fillStyle = COLORS.beadCore;
  ctx.beginPath();
  for (let a = 0; a < arms; a++) {
    const armBase = (a / arms) * Math.PI * 2 + phase;
    for (let j = 0; j < n; j++) {
      const rr = (spiralCache.baseR[j] + flowOffset) % maxR;
      const th = armBase + spiralCache.baseTheta[j];
      const x = CX + rr * Math.cos(th);
      const y = CY + rr * Math.sin(th);
      ctx.moveTo(x + br, y);
      ctx.arc(x, y, br, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();
}

function drawFall() {
  if (fallBullets.length === 0) return;
  // 按颜色分两批，减少 fill 次数
  for (const col of [COLORS.fallA, COLORS.fallB]) {
    ctx.save();
    ctx.fillStyle = col;
    ctx.beginPath();
    let any = false;
    for (const b of fallBullets) {
      if (b.c !== col) continue;
      any = true;
      ctx.moveTo(b.x + b.r, b.y);
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    }
    if (any) ctx.fill();
    ctx.restore();
  }
}

function drawHud() {
  ctx.save();
  ctx.font = '500 12px -apple-system, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(232,232,240,.85)';
  ctx.textAlign = 'left';
  ctx.fillText('HARD', 12, 20);
  ctx.textAlign = 'right';
  ctx.fillText('Bonus  8000000', W - 12, 20);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(232,232,240,.55)';
  ctx.fillText('Spell Card Attack!!', 12, H - 12);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(232,232,240,.85)';
  ctx.fillText('History  07 / 10', W - 12, H - 12);
  ctx.restore();
}

// ============ 主循环 ============
let lastT = 0;
let fpsAcc = 0, fpsFrames = 0, fpsShown = 0;

function frame(t) {
  const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
  lastT = t;

  if (running && dt > 0) {
    // 螺旋整体旋转
    phase += (P.rotationSpeed * Math.PI / 180) * dt;
    if (phase > Math.PI * 2) phase -= Math.PI * 2;

    // 珠子向外流动
    flowOffset = (flowOffset + P.radialFlow * dt) % P.maxRadius;

    // 下落幕生成 + 更新
    fallAccum += P.fallRate * dt;
    while (fallAccum >= 1) { spawnFall(); fallAccum -= 1; }
    for (let i = fallBullets.length - 1; i >= 0; i--) {
      const b = fallBullets[i];
      b.y += P.fallSpeed * dt;
      b.p += dt * 2;
      b.x += Math.sin(b.p) * b.w * dt * 12;
      if (b.y > H + 10) fallBullets.splice(i, 1);
    }
  }

  drawBackground();
  drawSpiral();
  drawBossCore();
  drawFall();
  if (showHud) drawHud();

  // FPS
  if (dt > 0) {
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) {
      fpsShown = fpsFrames / fpsAcc;
      fpsAcc = 0; fpsFrames = 0;
      updateStats();
    }
  }

  requestAnimationFrame(frame);
}

// ============ UI 绑定 ============
const FMT = {
  arms:          v => v + ' 条',
  armSpacing:    v => v.toFixed(0) + ' px',
  maxRadius:     v => v.toFixed(0) + ' px',
  rotationSpeed: v => v.toFixed(0) + ' °/s',
  radialFlow:    v => v.toFixed(0) + ' px/s',
  beadsPerTurn:  v => v.toFixed(0),
  beadRadius:    v => v.toFixed(1) + ' px',
  fallSpeed:     v => v.toFixed(0) + ' px/s',
  fallMax:       v => v.toFixed(0),
  fallRate:      v => v.toFixed(0) + ' /s',
};

const sliders = Array.from(document.querySelectorAll('input[data-key]'));

function refreshUI() {
  for (const el of sliders) {
    const k = el.dataset.key;
    el.value = P[k];
    const v = document.querySelector('[data-val="' + k + '"]');
    if (v) v.textContent = FMT[k] ? FMT[k](P[k]) : P[k];
  }
  document.getElementById('cvSize').textContent = W + ' × ' + H;
}

function updateStats() {
  document.getElementById('stFps').textContent = fpsShown.toFixed(0);
  let sc = 0;
  if (spiralCache) sc = spiralCache.count * (P.arms | 0);
  document.getElementById('stSpiral').textContent =
    sc + (spiralCache && spiralCache.capped ? ' (限)' : '');
  document.getElementById('stFall').textContent = fallBullets.length;
  document.getElementById('stCount').textContent = sc + fallBullets.length;
  document.getElementById('stTurns').textContent =
    spiralCache ? spiralCache.turns.toFixed(1) + ' 圈' : '--';

  // 径向周期 = 一颗珠子从中心走到最大半径所需时间，应与实测周期 3.74s 一致
  const life = P.radialFlow > 0 ? (P.maxRadius / P.radialFlow) : Infinity;
  const stLife = document.getElementById('stLife');
  if (isFinite(life)) {
    stLife.textContent = life.toFixed(2) + ' s';
    const dev = Math.abs(life - CYCLE_TIME) / CYCLE_TIME;
    stLife.style.color = dev <= 0.1 ? 'var(--ok)' : 'var(--warn)';
  } else {
    stLife.textContent = '∞';
    stLife.style.color = 'var(--warn)';
  }
}

for (const el of sliders) {
  el.addEventListener('input', () => {
    const k = el.dataset.key;
    P[k] = parseFloat(el.value);
    if (k === 'armSpacing' || k === 'maxRadius' ||
        k === 'beadRadius' || k === 'beadsPerTurn') buildSpiral();
    refreshUI();
    updateStats();
  });
}

document.getElementById('btnPause').addEventListener('click', e => {
  running = !running;
  e.target.textContent = running ? '暂停' : '继续';
});

document.getElementById('btnReset').addEventListener('click', () => {
  P = Object.assign({}, DEFAULTS);
  fallBullets.length = 0;
  phase = 0; flowOffset = 0;
  buildSpiral();
  refreshUI();
  updateStats();
});

document.getElementById('btnHud').addEventListener('click', e => {
  showHud = !showHud;
  e.target.textContent = 'HUD: ' + (showHud ? '开' : '关');
});

// ============ 启动 ============
buildSpiral();
refreshUI();
updateStats();
requestAnimationFrame(frame);
