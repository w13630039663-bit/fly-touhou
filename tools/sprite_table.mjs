/**
 * tools/sprite_table.mjs — 把 ANM 的 sprite def 表 + 实际像素合成一张索引表
 *
 * 对每个 def 测量：不透明包围盒(实心尺寸)、平均核心色、是否"针状"(h/w>1.5)或"球形"(w≈h)
 * 目的：验证 (spr,col) -> activeSpriteIndex(spr) + col 这条规则在 etama3.anm 里落到哪个精灵，
 *      并确认每个颜色族里哪个 id 是红色 / 青色。
 *
 * 用法: node tools/sprite_table.mjs <anm> <png> [idFrom] [idTo]
 */
import fs from 'node:fs';
import { readPng } from './pngkit.mjs';

const [anmPath, pngPath, idA = 0, idB = 999] = process.argv.slice(2);
const buf = fs.readFileSync(anmPath);
const countDefs = buf.readUInt32LE(0);
const countScripts = buf.readUInt32LE(4);
const nameTab = buf.readUInt32LE(0x1c);
const tex = buf.slice(nameTab, buf.indexOf(0, nameTab)).toString('latin1');
const defs = [];
for (let i = 0; i < countDefs; i++) {
  const o = buf.readUInt32LE(0x40 + 4 * i);
  defs.push({
    id: buf.readUInt32LE(o),
    u: buf.readFloatLE(o + 4), v: buf.readFloatLE(o + 8),
    w: buf.readFloatLE(o + 12), h: buf.readFloatLE(o + 16),
    e5: buf.readFloatLE(o + 20), e6: buf.readFloatLE(o + 24),
  });
}
console.log(`${anmPath}: ${countDefs} defs / ${countScripts} scripts, texture=${tex}`);

const im = readPng(pngPath);
const rd = (x, y) => {
  const i = (y * im.w + x) * 4;
  return [im.data[i], im.data[i + 1], im.data[i + 2], im.data[i + 3]];
};

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
for (const d of defs) {
  if (d.id < +idA || d.id > +idB) continue;
  const x0 = Math.round(d.u), y0 = Math.round(d.v), w = Math.round(d.w), h = Math.round(d.h);
  let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1, n = 0, sr = 0, sg = 0, sb = 0;
  let brR = 0, brG = 0, brB = 0, brL = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x0 + x, py = y0 + y;
    if (px < 0 || py < 0 || px >= im.w || py >= im.h) continue;
    const [r, g, b, a] = rd(px, py);
    if (a >= 200) {
      n++; sr += r; sg += g; sb += b;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
      const L = lum(r, g, b);
      if (L > brL) { brL = L; brR = r; brG = g; brB = b; }
    }
  }
  if (!n) { console.log(`def ${String(d.id).padStart(3)} rect ${x0},${y0} ${w}x${h}  EMPTY(a<200)`); continue; }
  const ow = bx1 - bx0 + 1, oh = by1 - by0 + 1;
  const R = sr / n | 0, G = sg / n | 0, B = sb / n | 0;
  const shape = oh > w * 1.3 || oh > ow * 1.5 ? 'NEEDLE' : (Math.abs(ow - oh) <= 2 ? 'BALL' : 'BLOB');
  const warm = R > G + 24 && R > B + 24 ? 'red' : (B > R + 24 && B > G ? 'blue' : (G > R + 12 && G > B ? 'green' : (R > 200 && G > 170 && B > 60 && B < 170 ? 'gold' : (R > 200 && G > 200 && B > 200 ? 'white' : 'grey'))));
  console.log(`def ${String(d.id).padStart(3)} rect ${x0},${y0} ${w}x${h}  solid ${ow}x${oh}  opaque=${String(n).padStart(4)}  avg=(${R},${G},${B}) ${warm}  bright=(${brR},${brG},${brB})  ${shape}  e5=${d.e5} e6=${d.e6}`);
}
