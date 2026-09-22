/**
 * src/game/etama3.js — th06 弹体精灵表（etama3.anm 直读取证，非目测）
 *
 * 取证链（全部可复现）：
 *   1) `BulletManager::AddedCallback()` 用 `ANM_OFFSET_BULLET3 (0x200) + spr` 号脚本烤出每种弹型的
 *      模板 VM ⇒ 弹型 spr 的起始精灵号 = 该脚本里 `0401 <def>` 的操作数。
 *   2) `BulletManager::SpawnSingleBullet()`：
 *         bullet->sprites.spriteBullet = bulletTypeTemplates[spr].spriteBullet;
 *         g_AnmManager->SetActiveSprite(&bullet->sprites.spriteBullet,
 *                                       spriteBullet.activeSpriteIndex + bulletProps->spriteOffset);
 *      ⇒ **精灵号 = BASE[spr] + col**（col 走 GetVar，可被敌人变量动态控制）
 *      （出弹/消弹特效才用 `g_BulletSpriteOffset16Px[16]` / `{32Px}[8]` 把颜色折叠到 5 档）
 *   3) 脚本体里的 `041a 0001` = autoRotate 开关 ⇒ 只有非圆形的弹型（RICE/KUNAI/SHARD/FIREBALL/
 *      DAGGER）会跟着速度转，圆玉类不转。绘制时 `rotation.z = π/2 - angle`，换算到 canvas 的
 *      顺时针正角即 **canvas 旋转 = angle - π/2**。
 *
 * BASE 表来自 tools/anm_dump2.mjs 对 etama3.anm 脚本 0..9 的实测：
 *   scr0 0401 0x0e=14 | scr1 0x1e=30 | scr2 0x2e=46 (+041a 1) | scr3 0x3e=62 | scr4 0x4e=78 (+041a 1)
 *   scr5 0x5e=94 (+041a 1) | scr6 0x6e=110 | scr7 0x76=118 (+041a 1, 多帧动画) | scr8 0x7a=122 (+041a 1)
 *   scr9 0x92=146 (etama4 水泡路径)
 *
 * 精灵矩形 = tools/sprite_table.mjs 对 public/images/etama3.png 逐 def 实测（1024x1024 图集，
 * NC 复刻版的 ANM/纹理同为原作的 2 倍 ⇒ playfield px = 矩形 px / 2）。
 */

/** ANM 精灵矩形 px → playfield px：NC 复刻纹理是原作的 2 倍（stg6enm2 待机帧 230 矩形 / 不透明
 *  内容 149 对应原作约 74 px 的 BOSS 视觉尺寸；etama3 与 etama3_4k 恰为 2 倍关系）⇒ 1/2 */
export const ETAMA_PF_PER_TEX = 0.5;

/** 弹型 spr → 该弹型第 0 号颜色的 sprite def */
export const ETAMA3_SPRITE_BASE = [14, 30, 46, 62, 78, 94, 110, 118, 122, 146];

/** 弹型名（GensokyoClub/th06 `BulletManager.cpp` 模板表顺序） */
export const ETAMA3_SPRITE_NAME = [
  'PELLET', 'RING_BALL', 'RICE', 'BALL', 'KUNAI', 'SHARD', 'BIG_BALL', 'FIREBALL', 'DAGGER', 'BUBBLE',
];

/** 脚本体带 `041a 0001`（绘制时跟随速度方向旋转）的弹型 */
export const ETAMA3_AUTO_ROTATE = [false, false, true, false, true, true, false, true, true, false];

/**
 * def 号 → 图集矩形 [u, v, w, h] + 实测实心尺寸。
 * 只收录本项目符卡真正会用到的 def（etama3.anm 154 个 def 的完整表可用
 * `node tools/sprite_table.mjs <anm> <png>` 重新导出）。
 */
export const ETAMA3_DEFS = {
  // PELLET 族 18x18 圆玉（def 14..29）
  14: { u: 727, v: 254, w: 18, h: 18, solid: [18, 18] },   // col0 白
  15: { u: 746, v: 254, w: 18, h: 18, solid: [18, 18] },   // col1 赤
  // RICE 族 32x36（实心 16x36）—— 冥符的交错网弹 spr=2
  46: { u: 611, v: 217, w: 32, h: 36, solid: [16, 36] },   // col0 白
  47: { u: 331, v: 254, w: 32, h: 36, solid: [16, 36] },   // col1 赤
  48: { u: 430, v: 254, w: 32, h: 36, solid: [16, 36] },   // col2 赤（淡）<= spr=2, col=2
  // SHARD 族 32x36（实心 14x34）—— 冥符的落雨弹 spr=5、冰符的 ice spray spr=5
  93: { u: 743, v: 217, w: 32, h: 36, solid: [17, 35] },   // col0 白
  94: { u: 1, v: 221, w: 32, h: 36, solid: [14, 34] },     // col1
  95: { u: 34, v: 221, w: 32, h: 36, solid: [14, 34] },    // col1 赤
  96: { u: 67, v: 221, w: 32, h: 36, solid: [14, 34] },    // col2 赤（淡）<= spr=5, col=2
  100: { u: 149, v: 217, w: 32, h: 36, solid: [14, 34] },  // col6 青紫 <= spr=5, col=6（雹符）
  102: { u: 215, v: 217, w: 32, h: 36, solid: [14, 34] },  // col8 青（旧实现目测取的，见 HANDOVER 待办）
};

/**
 * 按原作规则解出 (spr, col) 的精灵矩形；表里没有的 def 退回同族第 0 号颜色。
 * @returns {{u:number,v:number,w:number,h:number,solid:number[]}}
 */
export function etama3Sprite(spr, col) {
  const base = ETAMA3_SPRITE_BASE[spr] ?? ETAMA3_SPRITE_BASE[0];
  return ETAMA3_DEFS[base + col] || ETAMA3_DEFS[base] || ETAMA3_DEFS[15];
}
