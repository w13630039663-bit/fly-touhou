/**
 * tools/render_pattern.mjs — 符卡弹幕离线渲染 / 轨迹取证图
 *
 * 用真实的 DanmakuGame 物理跑 N 帧（无 ctx，纯逻辑），再用自研 PNG 编解码把
 * public/images/etama3.png 里的**原作精灵**按 danmaku.js 里同一套矩形/尺寸/旋转
 * 规则 blit 成一张位图，用来肉眼核对「紅色の冥界」的弹型、朝向、密度与轨迹。
 *
 * 用法: node tools/render_pattern.mjs [frames] [outPrefix] [opts]
 *   --full     把渐进难度钉死在 mult=1（=原作 Normal 满密度 24/24/16/16）
 *   --no-live  不画当前帧弹体
 *   --trace    画每颗弹从出膛到当前的完整轨迹
 *   --ring=N   只追踪第 N 个大波（0 起）的弹
 */
import { DanmakuGame } from '../src/game/danmaku.js';
import { ETAMA_PF_PER_TEX, etama3Sprite, ETAMA3_AUTO_ROTATE, ETAMA3_SPRITE_BASE } from '../src/game/etama3.js';
import { readPng, writePng } from './pngkit.mjs';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const frames = Number(positional[0]) || 400;
const outPrefix = positional[1] || 'tools/pattern';
const opts = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '')));
const FULL = opts.has('full');
const TRACES = opts.has('trace');
const LIVE = !opts.has('no-live');
// --wave=N 只保留第 N 大波（fireEmitter 打的 b.wave 标）
const waveArg = argv[argv.indexOf('--wave') + 1];
const ONLY_WAVE = argv.includes('--wave') ? Number(waveArg) : -1;
const keep = (b) => ONLY_WAVE < 0 || b.wave === ONLY_WAVE;

const W = 460, H = 580;
const PF_W = 384, PF_H = 448;

class Raster {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.d = new Uint8Array(w * h * 4);
  }
  clear(r, g, b) {
    for (let i = 0; i < this.w * this.h; i++) {
      this.d[i * 4] = r; this.d[i * 4 + 1] = g; this.d[i * 4 + 2] = b; this.d[i * 4 + 3] = 255;
    }
  }
  blend(x, y, r, g, b, a) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4, af = a / 255;
    this.d[i] = this.d[i] * (1 - af) + r * af;
    this.d[i + 1] = this.d[i + 1] * (1 - af) + g * af;
    this.d[i + 2] = this.d[i + 2] * (1 - af) + b * af;
    this.d[i + 3] = 255;
  }
  rect(x0, y0, x1, y1, r, g, b, a) {
    for (let x = x0; x <= x1; x++) { this.blend(x, y0, r, g, b, a); this.blend(x, y1, r, g, b, a); }
    for (let y = y0; y <= y1; y++) { this.blend(x0, y, r, g, b, a); this.blend(x1, y, r, g, b, a); }
  }
  line(x0, y0, x1, y1, r, g, b, a) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) | 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.blend(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, g, b, a);
    }
  }
  /** 与 danmaku.js 的 drawImage(src, sx,sy,sw,sh, -dw/2,-dh/2, dw,dh) + rotate(angle-π/2) 等价 */
  blit(img, sx, sy, sw, sh, cx, cy, dw, dh, rot) {
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const rx = Math.ceil(Math.abs(cos * dw) + Math.abs(sin * dh)) / 2 + 1;
    const ry = Math.ceil(Math.abs(sin * dw) + Math.abs(cos * dh)) / 2 + 1;
    for (let yy = Math.floor(cy - ry); yy <= cy + ry; yy++) {
      for (let xx = Math.floor(cx - rx); xx <= cx + rx; xx++) {
        const dx = xx - cx, dy = yy - cy;
        // 逆旋转
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        const u = Math.floor((lx / dw + 0.5) * sw);
        const v = Math.floor((ly / dh + 0.5) * sh);
        if (u < 0 || v < 0 || u >= sw || v >= sh) continue;
        const si = ((sy + v) * img.w + (sx + u)) * 4;
        const a = img.data[si + 3];
        if (!a) continue;
        this.blend(xx, yy, img.data[si], img.data[si + 1], img.data[si + 2], a);
      }
    }
  }
}

const game = new DanmakuGame(null, { width: W, height: H });
game.setSpellcard(4);

const etama = readPng('public/images/etama3.png');
const rn = game.redNetherworld;
const ETK = ETAMA_PF_PER_TEX * rn.s;
const ox = rn.ox, oy = rn.oy, s = rn.s;

// 轨迹记录
const tracked = [];
const byId = new Map();
let nextId = 0;

for (let f = 1; f <= frames; f++) {
  if (FULL) game.survivalTime = 999;
  for (const b of game.bullets) b.__id = b.__id ?? nextId++;
  game.update();
  if (TRACES) {
    for (const b of game.bullets) {
      if (!keep(b)) continue;
      if (!b.__id) b.__id = nextId++;
      let t = byId.get(b.__id);
      if (!t) { t = { b, pts: [] }; byId.set(b.__id, t); tracked.push(t); }
      t.pts.push(b.x, b.y);
    }
  }
}

const img = new Raster(W, H);
img.clear(15, 17, 26);
img.rect(Math.round(ox), Math.round(oy), Math.round(ox + PF_W * s), Math.round(oy + PF_H * s), 90, 90, 120, 255);

if (TRACES) {
  for (const t of tracked) {
    const col = t.b.isRedRice ? [255, 120, 40] : t.b.curveAngularSpd > 0 ? [255, 40, 40] : [80, 160, 255];
    for (let i = 2; i < t.pts.length; i += 2) {
      img.line(t.pts[i - 2], t.pts[i - 1], t.pts[i], t.pts[i + 1], col[0], col[1], col[2], 70);
    }
  }
}

if (LIVE) {
  // 与 danmaku.js 的绘制分支严格同源：def = BASE[spr] + col，autoRotate 时旋转 angle - π/2
  for (const b of game.bullets) {
    if (!keep(b)) continue;
    if (b.isRedNetherBall || b.isRedRice) {
      const sp = etama3Sprite(b.spr, b.col);
      const rot = (b.angle !== undefined ? b.angle : Math.atan2(b.vy, b.vx)) - Math.PI / 2;
      img.blit(etama, sp.u, sp.v, sp.w, sp.h, b.x, b.y, sp.w * ETK, sp.h * ETK,
        ETAMA3_AUTO_ROTATE[b.spr] ? rot : 0);
    }
  }
}
// BOSS 位置十字
const bx = game.boss.x, by = game.boss.y;
img.line(bx - 12, by, bx + 12, by, 255, 255, 255, 200);
img.line(bx, by - 12, bx, by + 12, 255, 255, 255, 200);

const out = `${outPrefix}_f${String(frames).padStart(4, '0')}.png`;
writePng(out, W, H, img.d);

const shown = game.bullets.filter(keep);
const balls = shown.filter((b) => b.isRedNetherBall).length;
const rice = shown.filter((b) => b.isRedRice).length;
const cw = shown.filter((b) => b.curveAngularSpd > 0).length;
const ccw = shown.filter((b) => b.curveAngularSpd < 0).length;
console.log(`${out}  frames=${frames} ${FULL ? 'mult=1(原作满密度)' : '渐进难度'} 过滤=${ONLY_WAVE < 0 ? '全部波' : '仅第 ' + ONLY_WAVE + ' 波'}`);
console.log(`  在场弹体 ${game.bullets.length}，本次绘制 ${shown.length}：交错网弹(rice) ${balls} [CW ${cw} / CCW ${ccw}]，落雨弹(shard) ${rice}`);
console.log(`  BOSS canvas(${bx.toFixed(1)}, ${by.toFixed(1)}) playfield(${((bx - ox) / s).toFixed(1)}, ${((by - oy) / s).toFixed(1)})  s=${s.toFixed(4)} ox=${ox.toFixed(1)} oy=${oy.toFixed(1)}`);
for (const b of shown.filter((x) => x.spr !== undefined).slice(0, 1)) {
  const sp = etama3Sprite(b.spr, b.col);
  console.log(`  精灵解析: (spr=${b.spr},col=${b.col}) -> def ${ETAMA3_SPRITE_BASE[b.spr] + b.col} rect ${sp.u},${sp.v} ${sp.w}x${sp.h}` +
    ` 实心 ${sp.solid.join('x')} autoRotate=${ETAMA3_AUTO_ROTATE[b.spr]} → 画布 ${(sp.w * ETK).toFixed(1)}x${(sp.h * ETK).toFixed(1)} px`);
}
for (const b of shown.filter((x) => x.spr === 5).slice(0, 1)) {
  const sp = etama3Sprite(b.spr, b.col);
  console.log(`  落雨弹:   (spr=5,col=${b.col}) -> def ${ETAMA3_SPRITE_BASE[5] + b.col} rect ${sp.u},${sp.v} ${sp.w}x${sp.h}` +
    ` 实心 ${sp.solid.join('x')} autoRotate=${ETAMA3_AUTO_ROTATE[5]}`);
}
