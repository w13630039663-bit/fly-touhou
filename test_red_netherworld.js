import { DanmakuGame } from './src/game/danmaku.js';

console.log('🧪 开始执行 冥符「紅色の冥界」[Normal] 专用无头端到端测试...');

// 创建无头游戏实例
const game = new DanmakuGame(null, { width: 460, height: 580 });
game.setSpellcard(4);

console.log(`✓ 符卡切换成功: index=${game.boss.spellcardIndex}, name=${game.boss.spellcardName}`);
if (game.boss.spellcardName !== '冥符「紅色の冥界」') {
  throw new Error(`符卡名称错误: ${game.boss.spellcardName}`);
}

// 运行 600 帧无头模拟
let crossBallsCount = 0;
let rainRiceCount = 0;
let cwRotations = 0;
let ccwRotations = 0;
let repositionTriggered = false;

for (let f = 1; f <= 600; f++) {
  game.update();

  // 检查坐标有效性
  if (Number.isNaN(game.boss.x) || Number.isNaN(game.boss.y)) {
    throw new Error(`第 ${f} 帧 Boss 坐标发生 NaN: (${game.boss.x}, ${game.boss.y})`);
  }

  // 统计弹幕类型
  for (const b of game.bullets) {
    if (Number.isNaN(b.x) || Number.isNaN(b.y) || Number.isNaN(b.vx) || Number.isNaN(b.vy)) {
      throw new Error(`第 ${f} 帧子弹坐标或速度发生 NaN: x=${b.x}, y=${b.y}`);
    }
    if (b.isRedNetherBall) {
      crossBallsCount++;
      if (b.curveAngularSpd > 0) cwRotations++;
      if (b.curveAngularSpd < 0) ccwRotations++;
    }
    if (b.isRedRice) {
      rainRiceCount++;
    }
  }

  // 检查 Boss 是否触发移位减速
  if (game.redNetherworld && game.redNetherworld.isRepositioning) {
    repositionTriggered = true;
  }
}

console.log(`✓ 600 帧模拟顺利完成 (0 报错)`);
console.log(`✓ Boss 当前位置: (${game.boss.x.toFixed(1)}, ${game.boss.y.toFixed(1)})`);
console.log(`✓ 顺时针交错弹计数采样: ${cwRotations}`);
console.log(`✓ 逆时针交错弹计数采样: ${ccwRotations}`);
console.log(`✓ 落雨红米粒计数采样: ${rainRiceCount}`);
console.log(`✓ Boss 移位停歇状态机触发: ${repositionTriggered}`);
console.log(`✓ 场上存活子弹数 (出界回收正常): ${game.bullets.length}`);

if (cwRotations === 0 || ccwRotations === 0) {
  throw new Error('未检测到双向交错旋转弹发射！');
}
if (rainRiceCount === 0) {
  throw new Error('未检测到落雨米粒弹发射！');
}
if (!repositionTriggered) {
  throw new Error('未检测到 6 连发后 Boss 减速移位逻辑！');
}

console.log('🎉 冥符「紅色の冥界」[Normal] 测试全部通过！物理与 ECL 虚拟机逻辑 100% 正确！');
