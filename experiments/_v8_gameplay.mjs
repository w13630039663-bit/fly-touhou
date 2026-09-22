/**
 * v8 新机制端到端断言 (headless，浏览器同款配置)：
 *  1. 苍蝇阵亡瞬间 → 全屏弹幕被清空
 *  2. 重生后难度从入门微风重新计算 (mult 回到 0.18 附近)
 *  3. 轮次随每次重生 +1
 *  4. Boss 血条打空 → bossDefeated=true, bossKillRounds 记录轮数
 *  5. 击破后 update() 停机：frame/combatTime/survivalTime 全部冻结，场上无弹幕
 */
import { DanmakuGame } from '../src/game/danmaku.js';

const game = new DanmakuGame(null, { width: 460, height: 580, seed: 80001 });
game.setSpellcard(2);            // 自机狙符卡：挂机果蝇会被反复点名 → 多轮累积
game.endOnBossDefeat = true;     // 浏览器游戏模式
// 默认 player: lives=3, autoRespawn=true —— 与 app.js 现场一致

let deathClears = 0, respawns = 0, respawnMult = null;
let prevDead = false;
const CAP = 60 * 60 * 8; // 8 分钟仿真上限

let f = 0;
while (!game.bossDefeated && f < CAP) {
  game.update({ moveX: 0, moveY: 0 }); // 纯挂机走位，考验轮次消耗
  f++;
  const dead = game.player.isDead;
  if (dead && !prevDead) deathClears += (game.bullets.length === 0 ? 1 : 0);
  if (!dead && prevDead) { respawns++; if (respawnMult === null) respawnMult = game.getDifficultyProgress().mult; }
  prevDead = dead;
}

const defeated = game.bossDefeated;
const { frame: frozenFrame, combatTime, survivalTime } = game;
game.update({ moveX: 1, moveY: 1 });
game.update({ moveX: -1, moveY: 0 });

const report = {
  defeated,
  simFrames: f,
  bossKillRounds: game.bossKillRounds,
  roundCounter: game.round,
  combatTime_s: +combatTime.toFixed(2),
  deathClears,
  respawns,
  respawnMult,                    // 期望 ≈ 0.18 (难度重算回起点)
  bossHp: game.boss.hp,
  frozen: defeated && game.frame === frozenFrame && game.combatTime === combatTime && game.survivalTime === survivalTime,
  bulletsAfterKill: game.bullets.length,
  totalHits: game.player.totalHits
};
console.log(JSON.stringify(report, null, 1));

const pass = defeated
  && game.boss.hp === 0
  && report.frozen
  && report.bulletsAfterKill === 0
  && report.deathClears >= 1
  && report.respawns >= 1
  && game.bossKillRounds === report.roundCounter
  && respawnMult !== null && respawnMult < 0.25;
console.log(pass ? '✅ v8 机制全链路断言通过' : '❌ 机制断言失败');
process.exit(pass ? 0 : 1);
