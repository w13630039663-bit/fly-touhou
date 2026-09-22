/**
 * 东方Project风格经典弹幕物理与规则引擎
 */

import { HailstormSpellcard } from './spellcards/hailstorm.js';
import { RedNetherworldSpellcard } from './spellcards/red_netherworld.js';
import { etama3Sprite, ETAMA3_AUTO_ROTATE, ETAMA_PF_PER_TEX } from './etama3.js';

export class DanmakuGame {
  constructor(canvas = null, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.width = canvas ? canvas.width : (options.width || 460);
    this.height = canvas ? canvas.height : (options.height || 580);
    this.seed = options.seed !== undefined ? options.seed : null;

    // 自机状态
    this.player = {
      x: this.width / 2,
      y: this.height * 0.85,
      radius: 3.5,            // 核心判定点半径 (东方特色微小判定)
      grazeRadius: 28.0,      // 擦弹判定半径
      speed: 5.0,             // 常规移动速度 (调优以灵活动态走位)
      focusSpeed: 3.0,        // 低速微操速度
      lives: 3,
      maxLives: 3,
      totalHits: 0,           // 累计中弹次数
      bombs: 2,
      graze: 0,
      score: 0,
      invulnerableTimer: 0,   // 无敌帧计时
      isDead: false,
      respawnTimer: 0,        // 阵亡重生倒计时
      autoRespawn: true,      // 默认开启实验室无缝连续观察模式
      color: '#e74c3c'
    };

    // Boss 状态
    this.boss = {
      x: this.width / 2,
      y: 90,
      radius: 18,
      hp: 1000,
      maxHp: 1000,
      color: '#9b59b6',
      // [顶置] 默认符卡 = 雹符「Hailstorm」(th06 原作 ECL 移植)
      spellcardName: '雹符「Hailstorm」',
      spellcardIndex: 0,
      castTimer: 0
    };

    // 预载游戏图像资源 (琪露诺BOSS / 冰晶弹 / 发射光核)
    if (typeof Image !== 'undefined') {
      this.bossImage = new Image();
      this.bossImage.src = './public/images/boss_emitter.png';
      this.bossImageLoaded = false;
      this.bossImage.onload = () => { this.bossImageLoaded = true; };

      this.cirnoImage = new Image();
      this.cirnoImage.src = './public/images/cirno_boss.png';
      this.cirnoImageLoaded = false;
      this.cirnoImage.onload = () => { this.cirnoImageLoaded = true; };

      this.etamaImage = new Image();
      this.etamaImage.src = './public/images/etama3.png';
      this.etamaImageLoaded = false;
      this.etamaImage.onload = () => { this.etamaImageLoaded = true; };

      this.remiliaImage = new Image();
      this.remiliaImage.src = './public/images/remilia_boss.png';
      this.remiliaImageLoaded = false;
      this.remiliaImage.onload = () => { this.remiliaImageLoaded = true; };
    }

    this.bullets = [];
    this.playerBullets = [];
    this.particles = [];
    this.frame = 0;
    this.difficulty = options.difficulty || 'Normal'; // Easy, Normal, Hard, Lunatic
    this.isPaused = false;
    this.survivalTime = 0;

    // ===== Boss 战状态 (v8: 弹幕回合制猎杀模式) =====
    // 浏览器游戏专属开关：headless 训练/测试评估 (eval_core / train.js) 从不置 true，
    // 故「击破停钟 / 击破判定」整条链路对既有适应度口径逐位无影响。
    this.endOnBossDefeat = false;   // boss 血条打空后是否立即停算 (仅 app.js 浏览器端开启)
    this.round = 1;                 // 当前轮次：每次阵亡自动重生 +1，击杀战报用
    this.combatTime = 0;            // 跨轮累计战斗时长 (秒，仅存活帧计入；survivalTime 是单轮口径)
    this.bossDefeated = false;      // boss 是否已被打空血条
    this.bossKillRounds = null;     // 打死 boss 所用的轮数 (击破瞬间定格)

    // 视网膜雷达与特效配置
    this.showRadar = true;            // 开启自机周围 360° 视网膜雷达可视化光环
    this.bombEffect = null;           // 灵击震荡波特效
    this.cachedEyeInputs = new Array(16).fill(0);

    // 感觉编码方案选择器 (v9 实验开关)
    //   'v1'   已上线口径: 8 通道 (4 象限威胁 + 2 全局光流 + 2 本体位置)，32 传入细胞按 4:1 分组
    //   'wide' 实验口径  : 32 通道 = 原 8 通道 + 8 扇区 × 3 特征 (威胁 / 接近速度 / TTC 危险度)
    // 两者 (cell, channel) 配对数都是 32 ⇒ 注入大脑的总驱动规模相等，可直接对照。
    // 默认 'v1'，浏览器端与既有 checkpoint 的行为逐位不变。
    this.sensoryMode = options.sensoryMode || 'v1';

    // 关卡闯关模式系统 (Danmaku Gauntlet / Stage Clear Mode)
    this.gameMode = 'survival'; // 'survival' (自由生存特训) 或 'stage' (弹幕穿越闯关)
    this.currentStage = 1;      // 1, 2, 3
    this.stageClear = false;
    this.cherryParticles = [];  // 通关满屏樱花粒子
    this.goalPortal = {
      x: this.width / 2,
      y: 60,
      radius: 24,
      reached: false
    };
    this.stages = [
      {
        id: 1,
        title: 'Stage 1:「初试啼声·雾之湖竹林突破」',
        goalY: 55,
        targetDesc: '穿越雾之湖竹林风暴，冲向顶部金色鸟居！'
      },
      {
        id: 2,
        title: 'Stage 2:「逆风飞翔·红魔馆回旋魔弹阵」',
        goalY: 55,
        targetDesc: '穿透双向回旋魔弹，追踪动态漂移的神社鸟居！'
      },
      {
        id: 3,
        title: 'Stage 3:「死线超越·博丽大结界终极试炼」',
        goalY: 50,
        targetDesc: '突破密不透风的花瓣死线，登顶博丽神圣结界！'
      }
    ];

    // 事件回调 (供外部果蝇大脑和UI接入)
    this.onGraze = null;
    this.onHit = null;
    this.onBomb = null;
    this.onStageClear = null;

    // 移植自 th06 原作 ECL 的符卡：雹符「Hailstorm」(ecldata2.ecl sub 35)
    this.hailstorm = new HailstormSpellcard(this);

    // 移植自 th06 原作 ECL 的符卡：冥符「紅色の冥界」(ecldata6.ecl sub 40)
    this.redNetherworld = new RedNetherworldSpellcard(this);

    // 简易 WebAudio 音效系统
    this.initAudio();
  }

  /**
   * 切换游戏模式 ('survival' 或 'stage')
   */
  setGameMode(mode) {
    this.gameMode = mode;
    this.reset();
  }

  /**
   * 启动指定关卡
   */
  startStage(stageNum) {
    this.currentStage = Math.max(1, Math.min(3, stageNum));
    this.gameMode = 'stage';
    this.reset();
  }

  /**
   * 获取果蝇自机到当前关卡鸟居终点的目标航向向量 (供大脑中央复合体感知)
   */
  getGoalVector() {
    if (this.gameMode !== 'stage') return null;
    const dx = this.goalPortal.x - this.player.x;
    const dy = this.goalPortal.y - this.player.y;
    const dist = Math.hypot(dx, dy);
    return {
      dx: dx / (this.width * 0.5),
      dy: dy / (this.height * 0.5),
      dist,
      targetX: this.goalPortal.x,
      targetY: this.goalPortal.y,
      reached: this.goalPortal.reached
    };
  }


  initAudio() {
    this.soundBuffers = {};
    this.soundFiles = {
      tan00: './public/audio/tan00.wav',
      kira00: './public/audio/kira00.wav',
      enep00: './public/audio/enep00.wav',
      graze: './public/audio/graze.wav',
      pldead00: './public/audio/pldead00.wav',
      damage00: './public/audio/damage00.wav',
      cat00: './public/audio/cat00.wav'
    };
    try {
      if (typeof window !== 'undefined') {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.audioCtx = new AudioContext();
          if (typeof fetch !== 'undefined') {
            Object.entries(this.soundFiles).forEach(([name, url]) => {
              fetch(url)
                .then(res => res.arrayBuffer())
                .then(buf => this.audioCtx.decodeAudioData(buf))
                .then(decoded => {
                  this.soundBuffers[name] = decoded;
                })
                .catch(() => {});
            });
          }
        }
      }
    } catch (e) {
      this.audioCtx = null;
    }
  }

  playSound(name, vol = 0.2) {
    if (this.muteAudio || !this.audioCtx) return false;
    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      const buf = this.soundBuffers && this.soundBuffers[name];
      if (buf) {
        const src = this.audioCtx.createBufferSource();
        const gain = this.audioCtx.createGain();
        src.buffer = buf;
        gain.gain.setValueAtTime(vol, this.audioCtx.currentTime);
        src.connect(gain);
        gain.connect(this.audioCtx.destination);
        src.start();
        return true;
      }
    } catch (e) {}
    return false;
  }

  playBeep(freq, type = 'sine', duration = 0.08, vol = 0.05) {
    if (this.muteAudio || !this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(vol, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch (e) {}
  }

  playGrazeSound() {
    if (!this.playSound('graze', 0.22)) {
      this.playBeep(1800, 'triangle', 0.04, 0.04);
    }
  }

  playHitSound() {
    if (!this.playSound('pldead00', 0.35)) {
      this.playBeep(180, 'sawtooth', 0.35, 0.15);
    }
  }

  /**
   * 设置符卡与难度
   */
  setSpellcard(index) {
    this.boss.spellcardIndex = index;
    // 挂到实例上，供 UI / 预览页枚举符卡（避免出现第二份符卡清单）
    const cards = (this.spellcards = [
      '雹符「Hailstorm」',           // [0] 顶置 · 琪露诺
      '「博丽逃逸·环状漫天符」',     // [1]
      '「梦想封印·高密自机狙」',     // [2]
      '「八方狂岚·交错螺旋弹幕」',   // [3]
      '冥符「紅色の冥界」'           // [4] 顶置 · 蕾米莉亚
    ]);
    this.boss.spellcardName = cards[index % cards.length];
    this.bullets = []; // 清空弹幕
    if (index === 0 && this.hailstorm) this.hailstorm.reset();
    if (index === 4 && this.redNetherworld) this.redNetherworld.reset();
  }

  getDifficultyProgress() {
    // 动态渐进难度系统：入门微风 (0.18) 起步，随存活时间平滑提升，60秒平滑达到 Normal (1.00) 经典封顶
    const progress = Math.min(1.0, this.survivalTime / 60.0);
    const mult = 0.18 + 0.82 * Math.pow(progress, 1.2);
    let label = '入门微风';
    let emoji = '🌱';
    if (progress >= 0.85) {
      label = 'Normal 经典';
      emoji = '🔥';
    } else if (progress >= 0.50) {
      label = '渐进加速';
      emoji = '⚡';
    } else if (progress >= 0.20) {
      label = '温和微风';
      emoji = '🌿';
    }
    return {
      progress,
      mult,
      label,
      emoji,
      percent: Math.round(mult * 100)
    };
  }

  setDifficulty(diff) {
    this.difficulty = 'Dynamic';
  }

  random() {
    if (this.seed !== null) {
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      return this.seed / 4294967296;
    }
    return Math.random();
  }

  /**
   * 重置游戏局
   */
  reset(seed = null) {
    if (seed !== null) this.seed = seed;
    this.player.x = this.width / 2;
    this.player.y = this.height * 0.88;
    this.player.lives = this.player.maxLives;
    this.player.totalHits = 0;
    this.player.graze = 0;
    this.player.score = 0;
    this.player.invulnerableTimer = 60;
    this.player.isDead = false;
    this.player.respawnTimer = 0;
    this.bullets = [];
    this.playerBullets = [];
    this.particles = [];
    this.frame = 0;
    this.survivalTime = 0;
    this.round = 1;
    this.combatTime = 0;
    this.bossDefeated = false;
    this.bossKillRounds = null;
    this.stageClear = false;
    this.cherryParticles = [];
    this.boss.castTimer = 0;
    this.boss.hp = this.boss.maxHp;
    if (this.hailstorm) this.hailstorm.reset();
    if (this.redNetherworld) this.redNetherworld.reset();
    if (this.goalPortal) {
      this.goalPortal.reached = false;
      this.goalPortal.x = this.width / 2;
      this.goalPortal.y = (this.stages && this.stages[this.currentStage - 1]) ? this.stages[this.currentStage - 1].goalY : 55;
    }
  }

  /**
   * 发射 Boss 弹幕 (兼容自由生存模式与关卡穿越闯关模式)
   */
  spawnBossDanmaku() {
    // 击破后全屏静默 (仅浏览器猎杀模式会置位，headless 训练不受影响)
    if (this.bossDefeated) return;
    // 无缝观察模式阵亡休眠期：Boss 停火，保持全屏洁净，等待重生后难度从零重算
    // (eval_core / train.js 均为 autoRespawn=false，单命即死即出环，此门对训练口径无影响)
    if (this.player.isDead && this.player.autoRespawn) return;

    // 动态渐进难度系统：超级简单 (0.35) 起步，随存活时间逐渐加大，45秒平滑达到 Normal (1.00) 难度封顶
    const diffInfo = this.getDifficultyProgress();
    const mult = diffInfo.mult;

    // ================= 闯关模式专属弹幕走廊 (超温和引导闯关，比 Easy 更简单) =================
    if (this.gameMode === 'stage') {
      if (this.stageClear) return; // 通关后停止发射新弹幕

      // Stage 1:「初试啼声·雾之湖竹林微风」(超宽敞安全走廊 + 极慢速飘落)
      if (this.currentStage === 1) {
        // 安全走廊宽度拓宽至 180 像素，留出巨大无阻挡中央大道供果蝇直冲鸟居
        const gapX = (this.width / 2) + Math.sin(this.frame * 0.015) * (this.width * 0.22);
        if (this.frame % 55 === 0) {
          const colCount = 8;
          for (let i = 0; i < colCount; i++) {
            const bx = (i / (colCount - 1)) * (this.width - 40) + 20;
            // 留出 180 像素宽的超大安全通道
            if (Math.abs(bx - gapX) < 90) continue;
            this.bullets.push({
              x: bx,
              y: 50,
              vx: (this.random() - 0.5) * 0.15,
              vy: 1.15 + this.random() * 0.3, // 极慢飘落速度 (1.15 ~ 1.45)
              radius: 3.5,
              color: '#38bdf8',
              grazed: false
            });
          }
        }
      }

      // Stage 2:「逆风飞翔·红魔馆双向回旋微光」(左右慢速微光弹，超大间隙)
      else if (this.currentStage === 2) {
        if (this.frame % 30 === 0) {
          const a1 = this.frame * 0.05;
          const a2 = -this.frame * 0.05;
          const spd = 1.2;
          this.bullets.push({
            x: 50,
            y: 75,
            vx: Math.cos(a1) * spd,
            vy: Math.sin(a1) * spd + 0.45,
            radius: 3.5,
            color: '#e056fd',
            grazed: false
          });
          this.bullets.push({
            x: this.width - 50,
            y: 75,
            vx: Math.cos(a2) * spd,
            vy: Math.sin(a2) * spd + 0.45,
            radius: 3.5,
            color: '#ff4757',
            grazed: false
          });
        }
        // 慢速自机微光提示狙 (每 95 帧发射一颗，极易观察避开)
        if (this.frame % 95 === 0) {
          const angle = Math.atan2(this.player.y - 70, this.player.x - this.width / 2);
          this.bullets.push({
            x: this.width / 2,
            y: 70,
            vx: Math.cos(angle) * 1.5,
            vy: Math.sin(angle) * 1.5,
            radius: 4.2,
            color: '#ffa502',
            grazed: false
          });
        }
      }

      // Stage 3:「死线超越·博丽大结界落樱微雨」(8 瓣开阔花瓣落樱，安全空当极多)
      else if (this.currentStage === 3) {
        if (this.frame % 50 === 0) {
          const count = 8;
          const baseA = this.frame * 0.04;
          for (let i = 0; i < count; i++) {
            const angle = baseA + (i / count) * Math.PI * 2;
            const spd = 1.25 + (i % 2) * 0.25;
            this.bullets.push({
              x: this.goalPortal.x,
              y: this.goalPortal.y + 12,
              vx: Math.cos(angle) * spd,
              vy: Math.sin(angle) * spd + 0.25,
              radius: 3.8,
              color: (i % 2 === 0) ? '#ff4757' : '#f1c40f',
              grazed: false
            });
          }
        }
      }
      return;
    }

    // ================= 自由生存模式原始符卡 =================
    // 符卡 0 【顶置】: 雹符「Hailstorm」— th06 ecldata2.ecl sub 35 原作移植
    // Boss 位置、发弹节奏、三层等分布、et_extra 转向全部由 ECL 虚拟机驱动，故不走通用漂移。
    if (this.boss.spellcardIndex === 0) {
      this.hailstorm.update(mult);
      return;
    }

    // 符卡 4 【顶置】: 冥符「紅色の冥界」— th06 ecldata6.ecl sub 40 原作移植 (6面Boss 蕾米莉亚)
    if (this.boss.spellcardIndex === 4) {
      this.redNetherworld.update(mult);
      return;
    }

    // Boss 左右漂移
    this.boss.x = (this.width / 2) + Math.sin(this.frame * 0.02) * (this.width * 0.35);

    // 符卡 1: 环状扩散弹幕 (动态渐进)
    if (this.boss.spellcardIndex === 1) {
      // 射击间隔更宽裕：初期约 230 帧 (近 4 秒一波)，后期 18 帧
      if (this.frame % Math.max(18, Math.round(42 / mult)) === 0) {
        // 初始只有 4 颗，极开阔的 90° 逃逸空隙；后期渐进至 15 颗
        const count = Math.max(4, Math.round(15 * mult));
        const baseAngle = (this.frame * 0.05);
        for (let i = 0; i < count; i++) {
          const angle = baseAngle + (i / count) * Math.PI * 2;
          // 初始速度降至 0.85 ~ 1.05 px/frame
          const speed = (1.3 + (i % 2) * 0.35) * (0.55 + 0.45 * mult);
          this.bullets.push({
            x: this.boss.x,
            y: this.boss.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: 3.8,
            color: i % 2 === 0 ? '#ff4757' : '#2ed573',
            grazed: false
          });
        }
      }

      // 自机狙：前段 (mult < 0.35) 绝不发射自机狙！后期温和介入
      if (mult >= 0.35 && this.frame % Math.max(24, Math.round(60 / mult)) === 0) {
        const aimAngle = Math.atan2(this.player.y - this.boss.y, this.player.x - this.boss.x);
        const speed = 1.6 + 1.2 * mult;
        const spreads = mult < 0.65 ? [0] : [-1, 0, 1];
        for (const sp of spreads) {
          const a = aimAngle + sp * 0.14;
          this.bullets.push({
            x: this.boss.x,
            y: this.boss.y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            radius: 4.0,
            color: '#38bdf8',
            grazed: false
          });
        }
      }
    }

    // 符卡 2: 自机狙 + 散射针弹 (动态渐进)
    else if (this.boss.spellcardIndex === 2) {
      // 周期性朝玩家精准狙击：初期每 200 帧 (3.3秒) 一发，且初期为单发！
      if (this.frame % Math.max(16, Math.round(36 / mult)) === 0) {
        const angleToPlayer = Math.atan2(this.player.y - this.boss.y, this.player.x - this.boss.x);
        const spreads = mult < 0.40 ? [0] : (mult < 0.70 ? [-0.14, 0.14] : [-0.22, 0, 0.22]);
        const speed = 1.7 + 1.1 * mult;
        spreads.forEach(offset => {
          const a = angleToPlayer + offset;
          this.bullets.push({
            x: this.boss.x,
            y: this.boss.y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            radius: 3.6,
            color: '#1e90ff',
            grazed: false
          });
        });
      }

      // 伴随随机缓速环境光弹 (初期仅 1 颗慢漂，极其安全)
      if (mult >= 0.25 && this.frame % 45 === 0) {
        const ambCount = Math.max(1, Math.round(5 * mult));
        for (let i = 0; i < ambCount; i++) {
          const a = this.random() * Math.PI * 2;
          const spd = 0.7 + 0.5 * mult;
          this.bullets.push({
            x: this.boss.x + (this.random() - 0.5) * 40,
            y: this.boss.y,
            vx: Math.cos(a) * spd,
            vy: Math.sin(a) * spd,
            radius: 4.5,
            color: '#ffa502',
            grazed: false
          });
        }
      }
    }

    // 符卡 3: 双向旋转螺旋风暴 (动态渐进)
    else if (this.boss.spellcardIndex === 3) {
      // 初期每 55 帧才出一组双螺旋，空当巨大
      if (this.frame % Math.max(4, Math.round(10 / mult)) === 0) {
        const a1 = this.frame * 0.08;
        const a2 = -this.frame * 0.08;
        const speed = 1.3 + 0.9 * mult;

        this.bullets.push({
          x: this.boss.x,
          y: this.boss.y,
          vx: Math.cos(a1) * speed,
          vy: Math.sin(a1) * speed,
          radius: 3.5,
          color: '#e056fd',
          grazed: false
        });

        this.bullets.push({
          x: this.boss.x,
          y: this.boss.y,
          vx: Math.cos(a2) * speed,
          vy: Math.sin(a2) * speed,
          radius: 3.5,
          color: '#00d2d3',
          grazed: false
        });
      }

      // 伴随周期性自机狙：前期不触发，中后期介入
      if (mult >= 0.35 && this.frame % Math.max(20, Math.round(54 / mult)) === 0) {
        const aimAngle = Math.atan2(this.player.y - this.boss.y, this.player.x - this.boss.x);
        const speed = 1.8 + 1.2 * mult;
        this.bullets.push({
          x: this.boss.x,
          y: this.boss.y,
          vx: Math.cos(aimAngle) * speed,
          vy: Math.sin(aimAngle) * speed,
          radius: 4.0,
          color: '#f1c40f',
          grazed: false
        });
      }
    }
  }

  /**
   * 自机自动发射攻击子弹
   * 🔥 v8 火力加强：双发 → 三发齐射，节奏 6 帧 → 4 帧，单发伤害 1.2 → 1.8
   * 理论 DPS 由 24 → 81 (×3.4)；1000 血 Boss 全命中约 12.3 秒打空。
   * (注：自机弹仅影响 boss.hp，不参与适应度公式；headless 训练口径逐位不变)
   */
  spawnPlayerBullets() {
    if (this.frame % 4 === 0 && !this.player.isDead && !this.bossDefeated) {
      // 经典灵梦御币护符三发齐射 (中央 + 左右双翼)
      for (const off of [-10, 0, 10]) {
        this.playerBullets.push({
          x: this.player.x + off,
          y: this.player.y - 10,
          vx: 0,
          vy: -9.5,
          radius: 3.0,
          color: '#ff6b81'
        });
      }
    }
  }

  /**
   * 收集以自机为中心、8 通道生物学感觉输入 (对应 MaleCNS 8 类视觉小叶/空间细胞)
   * LC4: 正前方 Looming 逼近威胁
   * LC11: 左侧小目标威胁
   * LC9: 右侧小目标威胁
   * LC15: 后方/下方威胁
   * LC16: 水平光流
   * LC17: 垂直光流
   * LC21: 水平本体位置 (Proprioception X, 0.0=左, 0.5=中, 1.0=右)
   * LPLC2: 垂直本体位置 (Proprioception Y, 0.0=顶, 1.0=底)
   */
  getBiologicalSensoryInput() {
    if (this.sensoryMode === 'wide') return this.getWideSensoryInput();
    // 阵亡休眠：若自机处于死亡状态，立即归零并暂停全部感知输出
    if (this.player.isDead) {
      const zeroObs = new Array(8).fill(0.0);
      zeroObs.eyeSectors = new Array(16).fill(0.0);
      this.cachedEyeInputs = zeroObs.eyeSectors;
      this.cachedObservations = zeroObs;
      return zeroObs;
    }

    const px = this.player.x;
    const py = this.player.y;
    const visionRange = 240;

    let frontThreat = 0;
    let leftThreat = 0;
    let rightThreat = 0;
    let rearThreat = 0;
    let flowVxSum = 0;
    let flowVySum = 0;
    let approachCount = 0;

    // 16 扇区经典复眼视网膜分布 (仅作视觉雷达图渲染，不参与外挂计算)
    const eyeSectors = new Array(16).fill(0.0);

    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      const dx = b.x - px;
      const dy = b.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < visionRange && dist > 1.0) {
        // 计算子弹逼近自机的法向相对速度 (接近为正，背离为负)
        const approachSpeed = -(dx * b.vx + dy * b.vy) / dist;

        // 仅当子弹正逼近自机 (approachSpeed > 0.05) 或已经极近 (< 36px) 时才激活威胁感知
        if (approachSpeed > 0.05 || dist < 36.0) {
          approachCount++;
          const distFactor = Math.pow((visionRange - dist) / visionRange, 1.15);
          const speedFactor = 0.5 + Math.min(1.5, Math.max(0, approachSpeed / 2.6));
          const looming = Math.min(1.0, distFactor * speedFactor);

          flowVxSum += b.vx;
          flowVySum += b.vy;

          // 方位角计算 (0 为正前上方，顺时针为正，逆时针为负，范围 [-PI, PI])
          const theta = Math.atan2(dx, -dy);

          // 映射到 16 扇区雷达图
          let radarAngle = Math.atan2(dy, dx);
          if (radarAngle < 0) radarAngle += Math.PI * 2;
          const sec = Math.floor((radarAngle / (Math.PI * 2)) * 16) % 16;
          eyeSectors[sec] = Math.max(eyeSectors[sec], looming);

          // 严格互斥、无重叠的 4 象限威胁分配:
          // 1. 正前方顶角 90° 前锥 (|theta| <= PI / 4) -> LC4
          if (Math.abs(theta) <= Math.PI / 4) {
            if (looming > frontThreat) frontThreat = looming;
          }
          // 2. 左侧扇区 (-3*PI/4 < theta < -PI/4) -> LC11
          else if (theta < -Math.PI / 4 && theta > -3 * Math.PI / 4) {
            if (looming > leftThreat) leftThreat = looming;
          }
          // 3. 右侧扇区 (PI/4 < theta < 3*PI/4) -> LC9
          else if (theta > Math.PI / 4 && theta < 3 * Math.PI / 4) {
            if (looming > rightThreat) rightThreat = looming;
          }
          // 4. 后方扇区 (|theta| >= 3*PI/4) -> LC15
          else {
            if (looming > rearThreat) rearThreat = looming;
          }
        }
      }
    }

    const meanVx = approachCount > 0 ? flowVxSum / approachCount : 0;
    const meanVy = approachCount > 0 ? flowVySum / approachCount : 0;

    // 二维自机本体感知 (Proprioception)
    // Ch6: 水平归一化位置 (0.0=最左, 0.5=正中, 1.0=最右) -> 彻底消除左右盲区与对称死锁
    const proprioX = px / this.width;
    // Ch7: 垂直归一化位置 (0.0=顶端, 1.0=底端)
    const proprioY = py / this.height;

    const obs = [
      Math.min(1.0, frontThreat),                                      // Ch 0: LC4 (正前方迎面逼近)
      Math.min(1.0, leftThreat),                                       // Ch 1: LC11 (左侧逼近威胁)
      Math.min(1.0, rightThreat),                                      // Ch 2: LC9 (右侧逼近威胁)
      Math.min(1.0, rearThreat),                                       // Ch 3: LC15 (后方/下方威胁)
      Math.max(0, Math.min(1.0, 0.5 + meanVx / 6.0)),                  // Ch 4: LC16 (水平全局光流)
      Math.max(0, Math.min(1.0, meanVy / 5.0)),                        // Ch 5: LC17 (垂直下落光流)
      Math.max(0, Math.min(1.0, proprioX)),                            // Ch 6: LC21 (水平本体位置 X)
      Math.max(0, Math.min(1.0, proprioY))                             // Ch 7: LPLC2 (垂直本体位置 Y)
    ];

    obs.eyeSectors = eyeSectors;
    this.cachedEyeInputs = eyeSectors;
    this.cachedObservations = obs;
    return obs;
  }

  /**
   * v9 实验口径「宽感知」：32 通道 = 原 8 通道 + 8 扇区 × 3 特征
   *
   * Ch 0-7   与原 8 通道逐位同义 (4 象限威胁 / 水平光流 / 垂直光流 / 本体 X / 本体 Y)
   *          —— 保证宽口径是原口径的严格超集，不是替换。
   * Ch 8-31  8 个 45° 扇区 × (威胁 looming, 接近速度, 弹幕密度)
   *          扇区 0 为正前方 (±22.5°)，顺时针递增；扇区 4 为正后方。
   *
   * 设计意图：原口径把每个象限沿 MAX 池化压成 1 个数 → 「一颗远处弹」和「一片弹幕的
   * 最外沿」感知上等价，密度与方向结构全部丢失。本口径保留扇区结构，并补上原口径
   * 完全没有的两个物理量：接近速度、弹幕密度。
   *
   * 注：第 3 特征原设计为 time-to-collision，实测弃用 —— 本场景弹幕多为垂直下落而非
   * 朝自机飞行，法向接近速度中位数仅 0.87 px/帧，TTC = dist/approachSpeed 长期远超任何
   * 合理阈值，该通道 99% 帧恒为 0（实测激活率 0.2%~5.6%），属死通道。换成密度后既补上
   * MAX 池化丢失的数量信息，也保证通道真正有响应。
   *
   * 与 v1 的可对照性：v1 是 8 通道 × 4 细胞 = 32 个 (cell, channel) 配对；
   * 本口径是 32 通道 × 1 细胞 = 32 配对 ⇒ 注入大脑的总驱动规模相等。
   */
  getWideSensoryInput() {
    const SECTORS = 8;
    const SEC_ANGLE = (Math.PI * 2) / SECTORS;
    const DENSITY_REF = 6; // 单扇区内 6 颗弹幕记为满密度

    if (this.player.isDead) {
      const zeroObs = new Array(32).fill(0.0);
      zeroObs.eyeSectors = new Array(16).fill(0.0);
      this.cachedEyeInputs = zeroObs.eyeSectors;
      this.cachedObservations = zeroObs;
      return zeroObs;
    }

    const px = this.player.x;
    const py = this.player.y;
    const visionRange = 240;

    let frontThreat = 0;
    let leftThreat = 0;
    let rightThreat = 0;
    let rearThreat = 0;
    let flowVxSum = 0;
    let flowVySum = 0;
    let approachCount = 0;

    const eyeSectors = new Array(16).fill(0.0);
    const secLooming = new Array(SECTORS).fill(0.0);
    const secApproach = new Array(SECTORS).fill(0.0);
    const secCount = new Array(SECTORS).fill(0);

    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      const dx = b.x - px;
      const dy = b.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= visionRange || dist <= 1.0) continue;

      // 扇区归属先算 —— 密度统计要覆盖视距内全部弹幕（不筛是否逼近）
      const theta = Math.atan2(dx, -dy);
      let s = Math.floor((theta + Math.PI / SECTORS) / SEC_ANGLE);
      s = ((s % SECTORS) + SECTORS) % SECTORS;
      secCount[s]++;

      const approachSpeed = -(dx * b.vx + dy * b.vy) / dist;
      if (!(approachSpeed > 0.05 || dist < 36.0)) continue;

      approachCount++;
      const distFactor = Math.pow((visionRange - dist) / visionRange, 1.15);
      const speedFactor = 0.5 + Math.min(1.5, Math.max(0, approachSpeed / 2.6));
      const looming = Math.min(1.0, distFactor * speedFactor);

      flowVxSum += b.vx;
      flowVySum += b.vy;

      let radarAngle = Math.atan2(dy, dx);
      if (radarAngle < 0) radarAngle += Math.PI * 2;
      const sec16 = Math.floor((radarAngle / (Math.PI * 2)) * 16) % 16;
      eyeSectors[sec16] = Math.max(eyeSectors[sec16], looming);

      if (Math.abs(theta) <= Math.PI / 4) {
        if (looming > frontThreat) frontThreat = looming;
      } else if (theta < -Math.PI / 4 && theta > -3 * Math.PI / 4) {
        if (looming > leftThreat) leftThreat = looming;
      } else if (theta > Math.PI / 4 && theta < 3 * Math.PI / 4) {
        if (looming > rightThreat) rightThreat = looming;
      } else {
        if (looming > rearThreat) rearThreat = looming;
      }

      if (looming > secLooming[s]) secLooming[s] = looming;
      if (approachSpeed > secApproach[s]) secApproach[s] = approachSpeed;
    }

    const meanVx = approachCount > 0 ? flowVxSum / approachCount : 0;
    const meanVy = approachCount > 0 ? flowVySum / approachCount : 0;

    const obs = [
      Math.min(1.0, frontThreat),                                      // Ch 0
      Math.min(1.0, leftThreat),                                       // Ch 1
      Math.min(1.0, rightThreat),                                      // Ch 2
      Math.min(1.0, rearThreat),                                       // Ch 3
      Math.max(0, Math.min(1.0, 0.5 + meanVx / 6.0)),                  // Ch 4
      Math.max(0, Math.min(1.0, meanVy / 5.0)),                        // Ch 5
      Math.max(0, Math.min(1.0, px / this.width)),                     // Ch 6
      Math.max(0, Math.min(1.0, py / this.height))                     // Ch 7
    ];

    for (let s = 0; s < SECTORS; s++) {
      obs.push(Math.min(1.0, secLooming[s]));                          // 威胁 (looming MAX)
      obs.push(Math.max(0, Math.min(1.0, secApproach[s] / 2.6)));      // 接近速度
      obs.push(Math.min(1.0, secCount[s] / DENSITY_REF));              // 弹幕密度
    }

    obs.eyeSectors = eyeSectors;
    this.cachedEyeInputs = eyeSectors;
    this.cachedObservations = obs;
    return obs;
  }

  // 兼容旧调用名
  getRetinalSensoryInput() {
    return this.getBiologicalSensoryInput();
  }

  /**
   * 单帧游戏物理循环
   */
  update(motorCommand = null) {
    if (this.isPaused) return;

    // ★★★ 击破定格：Boss 血条打空后停止一切仿真与计时，只让余烬粒子飘落 ★★★
    // (endOnBossDefeat 仅浏览器端开启，headless 训练评估不会走进这个分支)
    if (this.bossDefeated) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.05;
        if (p.life <= 0) this.particles.splice(i, 1);
      }
      return;
    }

    this.frame++;
    if (this.boss.castTimer > 0) this.boss.castTimer--;
    // 存活时间只计算存活状态下的单轮时长；阵亡后立即定格冻结
    if (!this.player.isDead && !this.stageClear) {
      this.survivalTime += 1 / 60;
      this.combatTime += 1 / 60; // 跨轮累计战斗时长 (击破战报口径)
    }

    // 1. 生成弹幕与自机射击
    this.spawnBossDanmaku();
    this.spawnPlayerBullets();

    // 2. 自机移动更新 (由果蝇大脑运动神经元或玩家按键驱动)
    if (motorCommand && !this.player.isDead) {
      let mx = motorCommand.moveX;
      let my = motorCommand.moveY;

      // 闯关模式专属：果蝇负趋地性 (Negative Gravitaxis) 与 鸟居光引力 (Goal Phototaxis)
      // 保持大脑神经元的左右灵活躲避主权 (moveX 100% 敏锐作用)，同时赋予向鸟居终点逆流攀升的动力
      if (this.gameMode === 'stage' && !this.stageClear && !motorCommand.isHuman) {
        const goal = this.getGoalVector();
        if (goal) {
          const upwardProgress = -0.52;
          const lateralAlign = Math.sign(goal.dx) * Math.min(0.18, Math.abs(goal.dx) * 0.3);
          mx = mx + lateralAlign;
          my = Math.min(0.08, my * 0.22) + upwardProgress;
        }
      }

      // 自由生存模式专属：经典东方底部走位中轴锚定 (消除策略固有的盲目向上冲撞 Boss 的漂移偏置)
      // 保持大脑神经元 100% 敏捷的左右躲避主权 (moveX 完全由连接组控制)，在 Y 轴上使苍蝇稳定在底部走位安全区 (y ≈ 440~505)
      if (this.gameMode === 'survival' && !motorCommand.isHuman) {
        const homeY = this.height * 0.83; // 约 481px (经典东方底部走位中轴)
        if (this.player.y < homeY - 35) {
          // 苍蝇若向上漂移出底部走位区，平滑施加下压回正力，越往上推力越大，防止它一直往上飞到 Boss 脸上
          const pullDown = Math.min(0.88, (homeY - 35 - this.player.y) * 0.015);
          my = my * 0.15 + pullDown;
        } else if (this.player.y > homeY + 45) {
          // 靠近最底部边界时适度回拉，防止贴死在最底边
          my = my * 0.2 - 0.35;
        } else {
          // 在底部黄金走位区内，适度抑制大冲刺，允许小幅度前后腾挪
          my = my * 0.3;
        }
      }

      const currentSpeed = motorCommand.focusMode ? this.player.focusSpeed : this.player.speed;
      this.player.x += mx * currentSpeed;
      this.player.y += my * currentSpeed;

      // 边界限制与安全空间缓冲
      const margin = 28;
      this.player.x = Math.max(margin, Math.min(this.width - margin, this.player.x));
      this.player.y = Math.max(margin, Math.min(this.height - margin, this.player.y));

      // 果蝇振翅悬停移动的荧光尾迹 (让走位肉眼清晰可见)
      if (this.frame % 3 === 0) {
        this.particles.push({
          x: this.player.x + (Math.random() - 0.5) * 6,
          y: this.player.y + 6,
          vx: (Math.random() - 0.5) * 0.4,
          vy: 1.0,
          life: 0.6,
          color: 'rgba(56, 189, 248, 0.45)',
          size: 2.0
        });
      }
    }

    if (this.player.invulnerableTimer > 0) {
      this.player.invulnerableTimer--;
    }

    // 周期性补充灵击决死炸弹 (每生存 35 秒充能 1 枚，上限 3 枚)
    if (this.frame % (60 * 35) === 0 && this.player.bombs < 3) {
      this.player.bombs++;
    }

    // 玩家手动或事件触发决死炸弹 (不再由作弊算法自动代按)
    // 纯靠神经元躲避，绝不外挂插手

    // 更新灵击光波特效
    if (this.bombEffect) {
      this.bombEffect.radius += 9.0;
      this.bombEffect.life -= 0.035;
      if (this.bombEffect.life <= 0) this.bombEffect = null;
    }

    // 自动重塑复活逻辑 (用于连续实验观察)
    if (this.player.isDead) {
      if (this.player.autoRespawn) {
        this.player.respawnTimer--;
        if (this.player.respawnTimer <= 0) {
          // 重新克隆并复活果蝇
          this.player.x = this.width / 2;
          this.player.y = this.height * 0.85;
          this.player.lives = this.player.maxLives;
          this.player.isDead = false;
          this.player.invulnerableTimer = 120; // 2秒无敌保护
          this.survivalTime = 0; // 重置存活时间为 0，开启新一轮生存计时！
          // ★★★ 难度重新计算：渐进难度是 survivalTime 的纯函数，
          // 归零后倍率立刻回到 0.18 入门微风，随新一轮存活平滑重新爬升 ★★★
          this.round++;          // 轮次推进：又一条命葬送在弹幕里，猎杀战报按轮计数
          this.clearNearbyBullets(this.player.x, this.player.y, 160);
          this.createGrazeParticles(this.player.x, this.player.y);
          if (this.onRespawn) this.onRespawn();
        }
      }
    }

    // 3. 更新敌方弹幕物理与碰撞检测
    let turnedThisFrame = false;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];

      // 子弹寿命与「定时转向」行为 (et_extra: 出弹 N 帧后统一改为固定方向下落)
      b.age = (b.age || 0) + 1;
      // 出膛初段平滑减速凝结 (至转向点时收缩，保持冰晶云团在场内凝结)
      if (b.turn && !b.turn.done && b.decel) {
        b.vx *= b.decel;
        b.vy *= b.decel;
      }
      if (b.turn && !b.turn.done && b.age >= b.turn.at) {
        b.vx = Math.cos(b.turn.ang) * b.turn.spd;
        b.vy = Math.sin(b.turn.ang) * b.turn.spd;
        b.turn.done = true;
        turnedThisFrame = true;
      }

      // ===== ECL 弹体运动学（th06 `BulletManager::OnUpdate()` BULLET_STATE_FIRED 位链直译）=====
      // 语义取证：GensokyoClub/th06 src/BulletManager.cpp L716~760（详见 spellcards/red_netherworld.js 文件头）
      //   t = 弹体进入 FIRED 状态后的帧号（本项目的 b.age 在帧首自增，故 t = b.age - 1）
      //   判定发生在施加运动之前，所以运动恰好作用在 t = 0 .. ex5Int0-1 共 ex5Int0 帧上。
      //   0x1 / 0x10 / 0x20 是 else-if 互斥链（同一帧只走一条）；0x40/0x80/0x100 走下面的旧 turn 通道。
      if (b.exFlags) {
        const t = b.age - 1;
        if (b.exFlags & 1) {
          // 出膛冲击：前 16 帧在基础速度上叠加 5 → 0 的线性衰减
          if (t <= 16) {
            const burst = 5 - (t * 5) / 16;
            const sp = (b.speed || Math.hypot(b.vx, b.vy)) + burst;
            b.vx = Math.cos(b.angle) * sp;
            b.vy = Math.sin(b.angle) * sp;
          } else {
            b.exFlags ^= 1;
          }
        } else if (b.exFlags & 0x10) {
          // 恒定世界坐标加速度（ex4Acceleration）→ 真抛物线，angle 只是 atan2 的同步量
          if (t >= (b.ex5Int0 ?? 0)) {
            b.exFlags &= ~0x10;
          } else {
            b.vx += b.ex4Ax || 0;
            b.vy += b.ex4Ay || 0;
            b.angle = Math.atan2(b.vy, b.vx);
          }
        } else if (b.exFlags & 0x20) {
          // 圆周运动：angle += 角速度(rad/f)，speed += 线加速度，再重建速度矢量
          if (t >= (b.ex5Int0 ?? 0)) {
            b.exFlags &= ~0x20;
          } else {
            b.angle = Math.atan2(Math.sin(b.angle + (b.ex5F1 || 0)), Math.cos(b.angle + (b.ex5F1 || 0)));
            b.speed = (b.speed || Math.hypot(b.vx, b.vy)) + (b.ex5F0 || 0);
            b.vx = Math.cos(b.angle) * b.speed;
            b.vy = Math.sin(b.angle) * b.speed;
          }
        }
      }

      b.x += b.vx;
      b.y += b.vy;

      // 出界移除
      // 原作 `BulletManager::UpdateBulletsAndCollision()` 用的是 playfield 矩形 + unk_cc/unk_d0(16px)
      // 的剔除框（不是 640x480 全画面），所以带 pfBounded 的 ECL 弹按映射后的 playfield 剔除，
      // 免得弹体飘进上下黑边（letterbox）里继续存在。
      if (b.pfBounded && this.redNetherworld) {
        const rn = this.redNetherworld;
        const m = 16 * rn.s;
        const x0 = rn.ox - m, y0 = rn.oy - m;
        const x1 = rn.ox + 384 * rn.s + m, y1 = rn.oy + 448 * rn.s + m;
        if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) {
          this.bullets.splice(i, 1);
          continue;
        }
      } else if (b.x < -20 || b.x > this.width + 20 || b.y < -20 || b.y > this.height + 20) {
        this.bullets.splice(i, 1);
        continue;
      }

      // 擦弹判定 (Graze Check)
      const dx = b.x - this.player.x;
      const dy = b.y - this.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!this.player.isDead && !b.grazed && dist < this.player.grazeRadius) {
        b.grazed = true;
        this.player.graze++;
        this.player.score += 50;
        this.playGrazeSound();
        this.createGrazeParticles(b.x, b.y);
        if (this.onGraze) this.onGraze();
      }

      // 致命碰撞判定 (Hitbox Hit Check)
      if (!this.player.isDead && this.player.invulnerableTimer === 0 && dist < (this.player.radius + b.radius)) {
        // 自机中弹！(Pichuun!)
        this.player.totalHits++;
        this.player.lives--;
        this.player.invulnerableTimer = 90; // 1.5 秒无敌
        this.playHitSound();
        this.createHitExplosion(this.player.x, this.player.y);
        if (this.onHit) this.onHit();

        // 受到致命伤清除自机周边弹幕 (Bomb 护体效果)
        this.clearNearbyBullets(this.player.x, this.player.y, 140);

        if (this.player.lives <= 0) {
          this.player.lives = 0;
          this.player.isDead = true;
          // ★★★ 苍蝇阵亡：即刻清除全屏弹幕，场面完全清空 ★★★
          // (headless 评估在死亡帧当帧出环，此清理不发生任何后续影响，适应度口径不变)
          this.bullets = [];
          if (this.onDeath) this.onDeath(this.survivalTime);
          if (this.player.autoRespawn) {
            this.player.respawnTimer = 90; // 1.5秒后自动重生开启新一轮
          }
        }
        break;
      }
    }
    if (turnedThisFrame) {
      this.playSound('kira00', 0.25);
    }

    // 4. 更新自机子弹
    for (let i = this.playerBullets.length - 1; i >= 0; i--) {
      const pb = this.playerBullets[i];
      pb.x += pb.vx;
      pb.y += pb.vy;
      if (pb.y < -10) {
        this.playerBullets.splice(i, 1);
        continue;
      }

      // 击中 Boss (v8: 单发伤害 1.2 → 1.8，与三发齐射/4帧节奏共同构成 ×3.4 火力)
      const bdx = pb.x - this.boss.x;
      const bdy = pb.y - this.boss.y;
      if (Math.sqrt(bdx * bdx + bdy * bdy) < this.boss.radius + pb.radius) {
        this.boss.hp = Math.max(0, this.boss.hp - 1.8);
        this.player.score += 10;
        this.playerBullets.splice(i, 1);
        if (this.frame % 3 === 0) {
          this.playSound('damage00', 0.12);
        }
      }
    }

    // ★★★ Boss 血条打空：停止计算并单独记录「打死 Boss 用了几轮」★★★
    // 该判定整块挂在 endOnBossDefeat 开关下 —— headless 训练评估从不置位，
    // 既不会清空 bullets 也不会改 bossDefeated，适应度逐位可复现。
    if (this.endOnBossDefeat && !this.bossDefeated && this.boss.hp <= 0) {
      this.bossDefeated = true;
      this.bossKillRounds = this.round; // 本轮存活期间打空血条 → 共耗费 N 轮
      this.bullets = [];                // 符卡崩坏，全场残弹肃清
      this.createHitExplosion(this.boss.x, this.boss.y);
      this.createHitExplosion(this.boss.x - 24, this.boss.y + 10);
      this.createHitExplosion(this.boss.x + 24, this.boss.y - 8);
      this.playHitSound();
      this.playBeep(880, 'triangle', 0.5, 0.2);
      if (this.onBossDefeat) this.onBossDefeat(this.bossKillRounds, this.combatTime, this.round);
    }

    // 5. 更新粒子特效
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.05;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // 6. 关卡模式终点抵达判定 (Stage Clear Check)
    if (this.gameMode === 'stage' && !this.stageClear && !this.player.isDead) {
      // 动态移动终点 (Stage 2 & 3)
      if (this.currentStage === 2) {
        this.goalPortal.x = (this.width / 2) + Math.sin(this.frame * 0.02) * (this.width * 0.35);
      } else if (this.currentStage === 3) {
        this.goalPortal.x = (this.width / 2) + Math.sin(this.frame * 0.03) * (this.width * 0.38);
      }

      const distToGoal = Math.hypot(this.player.x - this.goalPortal.x, this.player.y - this.goalPortal.y);
      if (distToGoal <= this.goalPortal.radius + this.player.radius || this.player.y <= this.goalPortal.y + 12) {
        // ★★★ 恭喜通关！突破弹幕结界！★★★
        this.stageClear = true;
        this.goalPortal.reached = true;
        this.player.invulnerableTimer = 400; // 维持安全状态
        this.clearNearbyBullets(this.goalPortal.x, this.goalPortal.y, 450); // 震散全屏弹幕

        // 生成满屏盛开的樱花花瓣雨粒子 (Cherry Blossom Rain)
        for (let i = 0; i < 110; i++) {
          const a = Math.random() * Math.PI * 2;
          const spd = 2.0 + Math.random() * 6.5;
          this.cherryParticles.push({
            x: this.goalPortal.x,
            y: this.goalPortal.y,
            vx: Math.cos(a) * spd,
            vy: Math.sin(a) * spd - 1.5,
            radius: 3 + Math.random() * 4,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.18,
            color: Math.random() > 0.25 ? '#ff9ff3' : '#feca57',
            alpha: 1.0,
            life: 1.0
          });
        }

        this.playBeep(880, 'triangle', 0.5, 0.2);
        if (this.onStageClear) {
          this.onStageClear(this.currentStage, this.survivalTime, this.player.graze);
        }
      }
    }

    // 更新通关樱花花瓣粒子
    for (let i = this.cherryParticles.length - 1; i >= 0; i--) {
      const cp = this.cherryParticles[i];
      cp.x += cp.vx;
      cp.y += cp.vy;
      cp.vy += 0.04; // 柔和重力飘落
      cp.vx *= 0.98;
      cp.rotation += cp.rotSpeed;
      cp.life -= 0.008;
      if (cp.life <= 0 || cp.y > this.height + 20) {
        this.cherryParticles.splice(i, 1);
      }
    }
  }

  clearNearbyBullets(x, y, radius) {
    this.bullets = this.bullets.filter(b => {
      const dist = Math.hypot(b.x - x, b.y - y);
      return dist > radius;
    });
  }

  createGrazeParticles(x, y) {
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 1.0 + Math.random() * 2.0;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 1.0,
        color: '#ffffff',
        size: 2.0
      });
    }
  }

  createHitExplosion(x, y) {
    for (let i = 0; i < 36; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 2.0 + Math.random() * 5.0;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 1.2,
        color: i % 2 === 0 ? '#ff4757' : '#ffa502',
        size: 3.5
      });
    }
  }

  /**
   * 渲染弹幕战场
   */
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // 1. 现代深灰蓝竞技场底色
    ctx.fillStyle = '#0F111A';
    ctx.fillRect(0, 0, this.width, this.height);

    // 1. 符卡法阵光圈 (根据 Boss 类型绘制专属法阵)
    const bobY = Math.sin(this.frame * 0.06) * 3.5;
    ctx.save();
    ctx.translate(this.boss.x, this.boss.y + bobY);

    if (this.boss.spellcardIndex === 4) {
      // 蕾米莉亚·斯卡蕾特 猩红吸血鬼同心魔法阵
      ctx.rotate(-this.frame * 0.02);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, 52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 40, 0, Math.PI * 2);
      ctx.stroke();
      // 八角绯红星阵与逆时针蝠翼符印
      for (let t = 0; t < 4; t++) {
        const baseA = t * (Math.PI / 2);
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = baseA + (i * 2 * Math.PI / 3);
          const r = 46;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(254, 202, 202, 0.45)';
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }
      // 8 颗外环红宝石血核
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI / 4) + this.frame * 0.03;
        const x = Math.cos(a) * 52;
        const y = Math.sin(a) * 52;
        ctx.fillStyle = '#ff4d6d';
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // 琪露诺 冰晶六芒星魔法阵 (正反两个等边三角形相错)
      ctx.rotate(this.frame * 0.015);
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 36, 0, Math.PI * 2);
      ctx.stroke();
      for (let t = 0; t < 2; t++) {
        const baseA = t * (Math.PI / 3);
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = baseA + (i * 2 * Math.PI / 3);
          const r = 42;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(191, 234, 255, 0.5)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      // 6 个卫星冰晶节点
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI / 3) - this.frame * 0.02;
        const x = Math.cos(a) * 48;
        const y = Math.sin(a) * 48;
        ctx.fillStyle = '#bfeaff';
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // 2. 绘制 Boss 精灵 (支持蕾米莉亚 stg6enm2 / 琪露诺 stg2enm2 / 通用发弹器)
    if (this.remiliaImage && this.remiliaImageLoaded && this.boss.spellcardIndex === 4) {
      ctx.save();
      ctx.translate(this.boss.x, this.boss.y + bobY);
      let sx = 1, sy = 1;
      const sw = 230, sh = 230;
      if (this.boss.castTimer > 0) {
        // 施法展翅发弹姿势 (Sprites 193~197)
        const cf = Math.min(4, Math.floor((18 - this.boss.castTimer) / 4));
        sx = cf < 4 ? 925 + cf * 231 : 1;
        sy = cf < 4 ? 232 : 463;
      } else {
        // 6 帧丝滑浮空振翅待机动画 (Sprites 179~184)
        const f = Math.floor((this.frame / 7) % 6);
        sx = 1 + f * 231;
        sy = 1;
      }
      const drawSize = 88;
      ctx.drawImage(this.remiliaImage, sx, sy, sw, sh, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      ctx.restore();
    } else if (this.cirnoImage && this.cirnoImageLoaded && this.boss.spellcardIndex === 0) {
      ctx.save();
      ctx.translate(this.boss.x, this.boss.y + bobY);
      let sx = 1, sy = 1;
      const sw = 218, sh = 218;
      if (this.boss.castTimer > 0) {
        // 施法抬手发弹姿态 (3帧过渡)
        const cFrame = Math.min(2, Math.floor((18 - this.boss.castTimer) / 6));
        sx = 1 + cFrame * 219;
        sy = 658;
      } else {
        // 常规待机浮空振翅 (4帧平滑循环)
        const f = Math.floor((this.frame / 7) % 4);
        sx = 1 + f * 219;
        sy = 1;
      }
      const drawSize = 84;
      ctx.drawImage(this.cirnoImage, sx, sy, sw, sh, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      ctx.restore();
    } else if (this.bossImage && this.bossImageLoaded) {
      ctx.save();
      ctx.translate(this.boss.x, this.boss.y);
      const pulse = 1.0 + 0.06 * Math.sin(this.frame * 0.08);
      const drawSize = 72 * pulse;
      ctx.rotate(-this.frame * 0.01);
      ctx.drawImage(this.bossImage, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(this.boss.x, this.boss.y, this.boss.radius, 0, Math.PI * 2);
      ctx.fillStyle = this.boss.color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    // Boss 血条
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(20, 16, this.width - 40, 5);
    ctx.fillStyle = '#e056fd';
    ctx.fillRect(20, 16, (this.width - 40) * (this.boss.hp / this.boss.maxHp), 5);

    // v8: 血条数字读数 + 右侧「第 N 轮」轮次指示 (击杀后定格显示总轮数)
    ctx.font = 'bold 10px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(`${Math.ceil(this.boss.hp)} / ${this.boss.maxHp} HP`, 20, 31);
    ctx.textAlign = 'right';
    ctx.fillStyle = this.bossDefeated ? '#f1c40f' : '#ffa502';
    ctx.fillText(this.bossDefeated ? `⚔ 击破 · 共 ${this.bossKillRounds} 轮` : `第 ${this.round} 轮`, this.width - 20, 31);
    ctx.textAlign = 'left';

    // 3. 绘制自机子弹
    this.playerBullets.forEach(pb => {
      ctx.beginPath();
      ctx.arc(pb.x, pb.y, pb.radius, 0, Math.PI * 2);
      ctx.fillStyle = pb.color;
      ctx.fill();
    });

    // 符卡宣言展示 (Spellcard Cut-in Banner: 避免开局前 120 帧静默无反馈感)
    if (this.boss.spellcardIndex === 0 && this.frame <= 120) {
      ctx.save();
      const alpha = this.frame < 25 ? this.frame / 25 : (this.frame > 95 ? (120 - this.frame) / 25 : 1.0);
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.fillRect(20, 140, this.width - 40, 52);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(20, 140, this.width - 40, 52);
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px "Segoe UI", sans-serif';
      ctx.fillStyle = '#7fd4ff';
      ctx.fillText('❄ 雹符「Hailstorm」', this.width / 2, 163);
      ctx.font = '11.5px "Segoe UI", sans-serif';
      ctx.fillStyle = '#bfeaff';
      ctx.fillText('TH06 Embodiment of Scarlet Devil · Stage 2 Boss (Cirno)', this.width / 2, 180);
      ctx.restore();
    } else if (this.boss.spellcardIndex === 4 && this.frame <= 120) {
      ctx.save();
      const alpha = this.frame < 25 ? this.frame / 25 : (this.frame > 95 ? (120 - this.frame) / 25 : 1.0);
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillStyle = 'rgba(40, 10, 20, 0.85)';
      ctx.fillRect(20, 140, this.width - 40, 52);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(20, 140, this.width - 40, 52);
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px "Segoe UI", sans-serif';
      ctx.fillStyle = '#fca5a5';
      ctx.fillText('🦇 冥符「紅色の冥界」', this.width / 2, 163);
      ctx.font = '11.5px "Segoe UI", sans-serif';
      ctx.fillStyle = '#fecaca';
      ctx.fillText('TH06 Embodiment of Scarlet Devil · Stage 6 Boss (Remilia Scarlet)', this.width / 2, 180);
      ctx.restore();
    }

    // 4. 绘制敌方弹幕
    // ANM 精灵矩形是 2x 复刻纹理空间，playfield px = 矩形/2，画布 px = playfield px * s
    const ETK = ETAMA_PF_PER_TEX * (this.redNetherworld ? this.redNetherworld.s : 1);
    this.bullets.forEach(b => {
      const r = b.drawRadius || b.radius;
      if (b.isRedNetherBall || b.isRedRice) {
        // 弹型/颜色由 ECL 的 (spr,col) 经原作规则 `精灵号 = BASE[spr] + col` 解出：
        //   交错网弹 spr=2 (RICE)  col=2 -> def 48  rect 32x36（实测实心 16x36）
        //   落雨弹   spr=5 (SHARD) col=2 -> def 96  rect 32x36（实测实心 14x34）
        // 两种弹型的脚本体都带 `041a 0001` ⇒ autoRotate ⇒ 长轴跟随速度方向
        // （BulletManager.cpp L1306: anmVm->rotation.z = π/2 - angle；canvas 侧等价 angle - π/2）
        const spr = etama3Sprite(b.spr, b.col);
        const rot = (b.angle !== undefined ? b.angle : Math.atan2(b.vy, b.vx)) - Math.PI / 2;
        if (this.etamaImage && this.etamaImageLoaded) {
          // 纯 alpha 混合（render mode 5 = SRCALPHA/INVSRCALPHA），不加算、无出现白闪：
          // flags 0x220/0x210 没有开启 0x2/0x4/0x8 三个 BULLET_STATE_SPAWNING_* 位
          ctx.save();
          ctx.translate(b.x, b.y);
          if (ETAMA3_AUTO_ROTATE[b.spr]) ctx.rotate(rot);
          const dw = spr.w * ETK, dh = spr.h * ETK;
          ctx.drawImage(this.etamaImage, spr.u, spr.v, spr.w, spr.h, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();
        } else {
          // 矢量备用：按 def 实测的"实心"尺寸画针状弹体（淡红体 + 白芯），跟随速度旋转
          const hw = spr.solid[0] * ETK / 2, hh = spr.solid[1] * ETK / 2;
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(rot);
          ctx.beginPath();
          ctx.moveTo(0, -hh);
          ctx.lineTo(hw, -hh * 0.4);
          ctx.lineTo(hw, hh * 0.4);
          ctx.lineTo(0, hh);
          ctx.lineTo(-hw, hh * 0.4);
          ctx.lineTo(-hw, -hh * 0.4);
          ctx.closePath();
          ctx.fillStyle = '#c84040';
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(0, -hh * 0.86);
          ctx.lineTo(hw * 0.4, -hh * 0.4);
          ctx.lineTo(hw * 0.4, hh * 0.4);
          ctx.lineTo(0, hh * 0.86);
          ctx.lineTo(-hw * 0.4, hh * 0.4);
          ctx.lineTo(-hw * 0.4, -hh * 0.4);
          ctx.closePath();
          ctx.fillStyle = '#fff0f0';
          ctx.fill();
          ctx.restore();
        }
      } else if (b.isHail) {
        if (this.etamaImage && this.etamaImageLoaded) {
          // 原作 etama3.dds 冰晶针弹 (spr=5, col=6)
          ctx.save();
          ctx.translate(b.x, b.y);
          // etama3 原图中晶体尖端朝正下方 (+Y)，旋转补偿 -PI/2
          ctx.rotate(Math.atan2(b.vy, b.vx) - Math.PI / 2);
          const bw = 24, bh = 28;
          ctx.drawImage(this.etamaImage, 215, 217, 32, 36, -bw / 2, -bh / 2, bw, bh);
          ctx.restore();
        } else {
          // 东方正统冰锥/刺弹矢量备用 (尖端严格沿运动方向旋转，针状晶体带高光白芯与冰晶辉光)
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(Math.atan2(b.vy, b.vx));

          // 外部晶体尖菱形 (尖端朝前)
          ctx.beginPath();
          ctx.moveTo(r * 1.55, 0);          // 锋利针尖
          ctx.lineTo(0, r * 0.58);          // 侧翼右
          ctx.lineTo(-r * 1.15, 0);         // 尾部分叉
          ctx.lineTo(0, -r * 0.58);         // 侧翼左
          ctx.closePath();
          ctx.fillStyle = b.color;
          ctx.fill();

          // 内部高光晶核
          ctx.beginPath();
          ctx.moveTo(r * 1.0, 0);
          ctx.lineTo(0, r * 0.28);
          ctx.lineTo(-r * 0.72, 0);
          ctx.lineTo(0, -r * 0.28);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
          ctx.fill();

          // 霜冻外轮廓高亮
          ctx.strokeStyle = 'rgba(215, 245, 255, 0.85)';
          ctx.lineWidth = 1.0;
          ctx.stroke();

          ctx.restore();
        }
      } else {
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();
      }
    });

    // 5. 绘制粒子
    this.particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    });

    // 6. 绘制自机 (果蝇与东方灵梦结合体)
    if (!this.player.isDead) {
      // 无敌帧闪烁
      if (this.player.invulnerableTimer % 6 < 3) {
        ctx.save();
        ctx.translate(this.player.x, this.player.y);

        // 擦弹判定圈 (淡白色微弱虚线)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, this.player.grazeRadius, 0, Math.PI * 2);
        ctx.stroke();

        // 自机外观 (果蝇双翅扇动剪影，平稳优雅飞行)
        const wingFlap = Math.sin(this.frame * 0.3) * 3.5;
        ctx.fillStyle = 'rgba(200, 220, 240, 0.5)';
        // 左翅
        ctx.beginPath();
        ctx.ellipse(-10, -4 + wingFlap * 0.3, 11, 5, -0.4, 0, Math.PI * 2);
        ctx.fill();
        // 右翅
        ctx.beginPath();
        ctx.ellipse(10, -4 + wingFlap * 0.3, 11, 5, 0.4, 0, Math.PI * 2);
        ctx.fill();

        // 灵梦红白巫女服主体
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff4757';
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();

        // 核心微小判定点 (红心白边)
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, this.player.radius + 1.0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath();
        ctx.arc(0, 0, this.player.radius, 0, Math.PI * 2);
        ctx.fill();

        // 绘制果蝇 360° 复眼视网膜雷达光环 (高科技神经全景)
        if (this.showRadar) {
          const rBase = 32;
          for (let i = 0; i < 16; i++) {
            const aStart = (i / 16) * Math.PI * 2;
            const aEnd = ((i + 1) / 16) * Math.PI * 2;
            const th = this.cachedEyeInputs ? (this.cachedEyeInputs[i] || 0) : 0;
            const rOffset = th * 18;

            ctx.beginPath();
            ctx.arc(0, 0, rBase + rOffset, aStart, aEnd);
            if (th > 0.6) {
              ctx.strokeStyle = `rgba(255, 71, 87, ${0.45 + th * 0.5})`;
              ctx.lineWidth = 3.5;
            } else if (th > 0.2) {
              ctx.strokeStyle = `rgba(241, 196, 15, ${0.3 + th * 0.4})`;
              ctx.lineWidth = 2.0;
            } else {
              ctx.strokeStyle = 'rgba(46, 213, 115, 0.18)'; // 绿色安全通道
              ctx.lineWidth = 1.2;
            }
            ctx.stroke();
          }
        }

        ctx.restore();
      }
    } else {
      // 阵亡状态渲染
      ctx.save();
      if (this.player.autoRespawn) {
        // 自动克隆复活中动效
        const countdownSec = ((this.player.respawnTimer || 0) / 60).toFixed(1);
        ctx.textAlign = 'center';
        ctx.font = 'bold 15px "Segoe UI", sans-serif';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`🧬 果蝇中弹重构中... ${countdownSec}s`, this.width / 2, this.height * 0.78);

        // 重生光圈聚能
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.width / 2, this.height * 0.85, 15 + Math.sin(this.frame * 0.2) * 5, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // 传统硬核 Game Over
        ctx.textAlign = 'center';
        ctx.font = 'bold 24px "Segoe UI", sans-serif';
        ctx.fillStyle = '#ff4757';
        ctx.fillText('💀 GAME OVER', this.width / 2, this.height * 0.5);
        ctx.font = '13px "Segoe UI", sans-serif';
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText('果蝇残机耗尽，请点击下方「重置局数」或开启「无缝观察」', this.width / 2, this.height * 0.5 + 30);
      }
      ctx.restore();
    }

    // 绘制灵击决死冲击波
    if (this.bombEffect) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.bombEffect.x, this.bombEffect.y, this.bombEffect.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 210, 211, ${this.bombEffect.life * 0.9})`;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.fillStyle = `rgba(0, 210, 211, ${this.bombEffect.life * 0.12})`;
      ctx.fill();
      ctx.restore();
    }

    // ================= 7. 闯关模式专属元素渲染 (Torii Gate, Portal & Banner) =================
    if (this.gameMode === 'stage') {
      const gx = this.goalPortal.x;
      const gy = this.goalPortal.y;
      const gr = this.goalPortal.radius;

      ctx.save();
      // (1) 虚线目标引导光束 (自机到鸟居的方向指示)
      if (!this.player.isDead && !this.stageClear) {
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = 'rgba(241, 196, 15, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(this.player.x, this.player.y);
        ctx.lineTo(gx, gy);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // (2) 传送门旋转魔法光环与光晕
      const pulseR = gr + Math.sin(this.frame * 0.08) * 4;
      const rot = this.frame * 0.03;
      
      ctx.shadowColor = '#f1c40f';
      ctx.shadowBlur = 16;

      // 旋转外环
      ctx.strokeStyle = 'rgba(254, 202, 87, 0.85)';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(gx, gy, pulseR, 0, Math.PI * 2);
      ctx.stroke();

      // 放射状结界刻度
      for (let i = 0; i < 8; i++) {
        const a = rot + (i / 8) * Math.PI * 2;
        const x1 = gx + Math.cos(a) * (pulseR - 4);
        const y1 = gy + Math.sin(a) * (pulseR - 4);
        const x2 = gx + Math.cos(a) * (pulseR + 4);
        const y2 = gy + Math.sin(a) * (pulseR + 4);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // (3) 绘制朱红鸟居 (Torii Gate) 造型
      ctx.shadowBlur = 0;
      // 两根红金立柱
      ctx.fillStyle = '#eb4d4b';
      ctx.fillRect(gx - 14, gy - 12, 4, 24);
      ctx.fillRect(gx + 10, gy - 12, 4, 24);

      // 上层双横梁 (笠木 & 岛木)
      ctx.fillStyle = '#1e272e';
      ctx.fillRect(gx - 20, gy - 16, 40, 4);
      ctx.fillStyle = '#eb4d4b';
      ctx.fillRect(gx - 17, gy - 12, 34, 3);
      ctx.fillRect(gx - 15, gy - 5, 30, 2.5);

      // 门匾文字「通关」
      ctx.fillStyle = '#f1c40f';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('通关', gx, gy - 6);

      ctx.restore();

      // (4) 绘制飘落的樱花花瓣粒子
      this.cherryParticles.forEach(cp => {
        ctx.save();
        ctx.translate(cp.x, cp.y);
        ctx.rotate(cp.rotation);
        ctx.fillStyle = cp.color;
        ctx.globalAlpha = Math.max(0, cp.life);
        ctx.beginPath();
        ctx.ellipse(0, 0, cp.radius, cp.radius * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // (5) 通关大横幅 (Stage Clear Banner)
      if (this.stageClear) {
        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.fillRect(20, this.height * 0.35, this.width - 40, 115);
        ctx.strokeStyle = '#f1c40f';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(20, this.height * 0.35, this.width - 40, 115);

        ctx.textAlign = 'center';
        ctx.font = 'bold 20px "Segoe UI", sans-serif';
        ctx.fillStyle = '#f1c40f';
        ctx.fillText('🌸 STAGE CLEARED! 恭喜通关 🌸', this.width / 2, this.height * 0.35 + 36);

        ctx.font = '13px "Segoe UI", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`果蝇突破弹幕结界！用时: ${this.survivalTime.toFixed(1)}s | 擦弹: ${this.player.graze}次`, this.width / 2, this.height * 0.35 + 66);

        ctx.font = '12px "Segoe UI", sans-serif';
        ctx.fillStyle = '#2ed573';
        ctx.fillText('【点击下方控制台「晋级下一关」继续挑战】', this.width / 2, this.height * 0.35 + 95);
        ctx.restore();
      }
    }

    // ================= 8. 顶部 UI 状态栏 (HUD) =================
    const livesDisplay = this.player.autoRespawn ? '♾️ 无缝' : '★'.repeat(this.player.lives);

    if (this.gameMode === 'stage') {
      const curStage = this.stages[this.currentStage - 1];
      const dist = Math.round(Math.hypot(this.player.x - this.goalPortal.x, this.player.y - this.goalPortal.y));
      ctx.font = 'bold 13px "Segoe UI", sans-serif';
      ctx.fillStyle = '#f1c40f';
      ctx.fillText(`🚩 ${curStage.title}`, 20, 36);
      ctx.font = '12px "Segoe UI", sans-serif';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`⛩️ 距离鸟居: ${dist}px | 灵击: 💣×${this.player.bombs}`, 20, 56);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`残机: ${livesDisplay}`, this.width - 90, 36);
      ctx.fillText(`Graze: ${this.player.graze}`, this.width - 90, 56);
    } else {
      ctx.font = '13px "Segoe UI", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`符卡: ${this.boss.spellcardName}`, 20, 38);
      ctx.fillText(`残机: ${livesDisplay} | 灵击: 💣×${this.player.bombs}`, 20, 56);
      ctx.fillText(`Graze: ${this.player.graze}`, this.width - 120, 38);
      ctx.fillText(`得分: ${this.player.score}`, this.width - 120, 56);
    }

    // ================= 9. Boss 击破定格战报 (v8: 单独统计打死 Boss 需要几轮) =================
    if (this.bossDefeated) {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.fillRect(20, this.height * 0.36, this.width - 40, 138);
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(20, this.height * 0.36, this.width - 40, 138);

      ctx.textAlign = 'center';
      ctx.font = 'bold 22px "Segoe UI", sans-serif';
      ctx.fillStyle = '#f1c40f';
      ctx.fillText('🏆 BOSS 击破! 符卡崩坏', this.width / 2, this.height * 0.36 + 40);

      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      ctx.fillStyle = '#4ade80';
      ctx.fillText(`打死 Boss 共耗时 ${this.bossKillRounds} 轮`, this.width / 2, this.height * 0.36 + 74);

      ctx.font = '12px "Segoe UI", sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(`累计战斗 ${this.combatTime.toFixed(1)}s · 中弹 ${this.player.totalHits} 次 · 擦弹 ${this.player.graze} 次`, this.width / 2, this.height * 0.36 + 100);
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.fillText('仿真已在击破瞬间停止计算，点击「重置本局」可再次挑战', this.width / 2, this.height * 0.36 + 122);
      ctx.restore();
    }
  }
}
