// 冒烟测试：wide 口径的 Ch0-7 必须与 v1 口径逐位相同（证明没改坏原有感知）
import { DanmakuGame } from '../src/game/danmaku.js';

function run(mode, seed, frames) {
  const game = new DanmakuGame(null, { width: 460, height: 580, seed, sensoryMode: mode });
  game.setSpellcard(seed % 3);
  game.player.lives = 1; game.player.maxLives = 1;
  game.player.autoRespawn = false; game.player.invulnerableTimer = 0;
  const trace = [];
  for (let f = 0; f < frames; f++) {
    const obs = game.getBiologicalSensoryInput();
    trace.push(Array.from(obs));
    // 用固定机动让两个模式的游戏状态完全同步（与大脑无关）
    let mx = Math.sin(f * 0.03), my = Math.cos(f * 0.017);
    game.update({ moveX: mx, moveY: my });
    if (game.player.isDead) break;
  }
  return trace;
}

let checked = 0, headMismatch = 0, worstDelta = 0, widestDim = 0;
for (const seed of [11, 42, 97, 1234, 80001]) {
  const a = run('v1', seed, 300);
  const b = run('wide', seed, 300);
  if (a.length !== b.length) { console.log(`! 帧数不一致 seed=${seed}: ${a.length} vs ${b.length}`); }
  for (let f = 0; f < Math.min(a.length, b.length); f++) {
    if (a[f].length !== 8) { console.log(`! v1 维度异常 ${a[f].length}`); break; }
    if (b[f].length !== 32) { console.log(`! wide 维度异常 ${b[f].length}`); break; }
    checked++;
    for (let c = 0; c < 8; c++) {
      const d = Math.abs(a[f][c] - b[f][c]);
      if (d > 0) { headMismatch++; worstDelta = Math.max(worstDelta, d); break; }
    }
    for (let c = 0; c < 32; c++) {
      const v = b[f][c];
      if (!(v >= 0 && v <= 1)) { console.log(`! wide Ch${c} 越界 ${v} (seed ${seed} 帧 ${f})`); }
    }
    widestDim = Math.max(widestDim, b[f].length);
  }
}
console.log(`检查 ${checked} 帧`);
console.log(`Ch0-7 与 v1 不一致的帧数: ${headMismatch} (最大偏差 ${worstDelta})`);
console.log(`wide 通道数: ${widestDim}`);
console.log(headMismatch === 0 && widestDim === 32 ? '✅ 通过：wide 是 v1 的严格超集' : '❌ 失败');

// 新通道的活跃度体检：24 个扇区通道是否真的在动
const g = new DanmakuGame(null, { width: 460, height: 580, seed: 77, sensoryMode: 'wide' });
g.setSpellcard(2);
let act = new Array(32).fill(0), maxV = new Array(32).fill(0), n = 0;
for (let f = 0; f < 600; f++) {
  const obs = g.getBiologicalSensoryInput();
  for (let c = 0; c < 32; c++) { if (obs[c] > 0.01) act[c]++; maxV[c] = Math.max(maxV[c], obs[c]); }
  n++;
  g.update({ moveX: Math.sin(f * 0.02), moveY: Math.cos(f * 0.013) });
  if (g.player.isDead) break;
}
const dead = [];
for (let c = 8; c < 32; c++) if (act[c] === 0) dead.push(c);
console.log(`\n新通道活跃度 (${n} 帧): 24 个扇区通道中 ${24 - dead.length} 个有响应`);
if (dead.length) console.log(`  全程无响应: Ch${dead.join(', Ch')}`);
console.log('  峰值采样:', Array.from({ length: 8 }, (_, s) => `S${s}[${maxV[8 + s * 3].toFixed(2)},${maxV[9 + s * 3].toFixed(2)},${maxV[10 + s * 3].toFixed(2)}]`).join(' '));
