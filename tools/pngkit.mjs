// Minimal PNG codec (8-bit RGBA/RGB/palette, no interlace) + crop/atlas tools, no deps.
// Usage:
//   node tools/pngkit.mjs info <a.png>
//   node tools/pngkit.mjs crop  <in.png> <out.png> x y w h [scale]     (nearest-neighbour zoom)
//   node tools/pngkit.mjs strip  <out.png> <in.png> <scale> x,y,w,h[,label] ...
//   node tools/pngkit.mjs stats  <in.png> x y w h
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

function readPng(path) {
  const b = fs.readFileSync(path);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  let palette = null, trns = null;
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('interlace unsupported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 3 ? 1 : 0;
  if (!channels) throw new Error('colorType ' + colorType);
  const bpp = (channels * bitDepth) / 8;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  const paeth = (a, bb, c) => { const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? bb : c; };
  for (let y = 0; y < h; y++) {
    const ft = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const cur = raw[rp + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const bb = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      switch (ft) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + bb; break;
        case 3: v = cur + ((a + bb) >> 1); break;
        case 4: v = cur + paeth(a, bb, c); break;
        default: throw new Error('filter ' + ft);
      }
      out[y * stride + x] = v & 0xff;
    }
    rp += stride;
  }
  // -> RGBA8888
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (colorType === 6) {
      rgba[i * 4] = out[i * 4]; rgba[i * 4 + 1] = out[i * 4 + 1]; rgba[i * 4 + 2] = out[i * 4 + 2]; rgba[i * 4 + 3] = out[i * 4 + 3];
    } else if (colorType === 2) {
      rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1]; rgba[i * 4 + 2] = out[i * 3 + 2]; rgba[i * 4 + 3] = 255;
    } else if (colorType === 0) {
      const g = out[i]; rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g; rgba[i * 4 + 3] = 255;
    } else if (colorType === 3) {
      const p = out[i] * 3;
      rgba[i * 4] = palette[p]; rgba[i * 4 + 1] = palette[p + 1]; rgba[i * 4 + 2] = palette[p + 2];
      rgba[i * 4 + 3] = trns && out[i] < trns.length ? trns[out[i]] : 255;
    }
  }
  return { w, h, data: rgba, bitDepth, colorType };
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function writePng(path, w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const args = process.argv.slice(2);
const cmd = args.shift();
// 用 pathToFileURL 归一化，保证相对路径调用 CLI 时也能命中
const mainArg = process.argv[1];
const isMain = !!mainArg && import.meta.url === pathToFileURL(mainArg).href;
if (!isMain) {
  // imported as a module: only the codec helpers below are used
} else {

if (cmd === 'info') {
  const im = readPng(args[0]);
  console.log(`${args[0]}: ${im.w}x${im.h} colorType=${im.colorType} bitDepth=${im.bitDepth}`);
} else if (cmd === 'crop') {
  const [src, dst, x, y, w, h, scale = 1] = args.map((v, i) => (i < 2 ? v : Number(v)));
  const im = readPng(src);
  const s = Number(scale);
  const out = new Uint8Array(w * h * s * s * 4);
  for (let yy = 0; yy < h * s; yy++) for (let xx = 0; xx < w * s; xx++) {
    const sx = x + Math.floor(xx / s), sy = y + Math.floor(yy / s);
    const si = (sy * im.w + sx) * 4, di = (yy * w * s + xx) * 4;
    out[di] = im.data[si]; out[di + 1] = im.data[si + 1]; out[di + 2] = im.data[si + 2]; out[di + 3] = im.data[si + 3];
  }
  writePng(dst, w * s, h * s, out);
  console.log(`wrote ${dst} ${w * s}x${h * s}`);
} else if (cmd === 'strip') {
  // strip <out.png> <in.png> <scale> x,y,w,h x,y,w,h ...
  const [dst, src, scale, ...rects] = args;
  const s = Number(scale);
  const im = readPng(src);
  const list = rects.map((r) => r.split(',').map(Number));
  const cellW = Math.max(...list.map((r) => r[2])) * s;
  const cellH = Math.max(...list.map((r) => r[3])) * s;
  const cols = Math.min(list.length, 6);
  const rows = Math.ceil(list.length / cols);
  const W = cols * (cellW + 6), H = rows * (cellH + 6);
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = 24; out[i * 4 + 1] = 24; out[i * 4 + 2] = 30; out[i * 4 + 3] = 255; }
  list.forEach(([x, y, w, h], idx) => {
    const cx = (idx % cols) * (cellW + 6) + 3, cy = Math.floor(idx / cols) * (cellH + 6) + 3;
    for (let yy = 0; yy < h * s; yy++) for (let xx = 0; xx < w * s; xx++) {
      const si = ((y + Math.floor(yy / s)) * im.w + x + Math.floor(xx / s)) * 4;
      const di = ((cy + yy) * W + cx + xx) * 4;
      for (let k = 0; k < 4; k++) out[di + k] = im.data[si + k];
    }
  });
  writePng(dst, W, H, out);
  console.log(`wrote ${dst} ${W}x${H} :: ${list.map((r, i) => `[${i}]=${r.join(',')}`).join(' ')}`);
} else if (cmd === 'stats') {
  const [src, x, y, w, h] = [args[0], ...args.slice(1).map(Number)];
  const im = readPng(src);
  let minA = 255, maxA = 0, opaque = 0, rs = 0, gs = 0, bs = 0, bright = null;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const i = ((y + yy) * im.w + x + xx) * 4;
    const a = im.data[i + 3];
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    if (a > 200) opaque++;
    rs += im.data[i]; gs += im.data[i + 1]; bs += im.data[i + 2];
    const lum = 0.299 * im.data[i] + 0.587 * im.data[i + 1] + 0.114 * im.data[i + 2];
    if (bright === null || lum > bright.lum) bright = { lum, r: im.data[i], g: im.data[i + 1], b: im.data[i + 2], a, at: [x + xx, y + yy] };
  }
  const n = w * h;
  console.log(`rect ${x},${y} ${w}x${h}: avgRGB=(${(rs / n) | 0},${(gs / n) | 0},${(bs / n) | 0}) alpha[min,max]=(${minA},${maxA}) opaquePx=${opaque}/${n} brightest=${JSON.stringify(bright)}`);
} else if (cmd === 'extent') {
  // extent <in.png> x y w h [alphaThreshold]
  const [src, x, y, w, h] = [args[0], ...args.slice(1, 5).map(Number)];
  const thr = args[5] === undefined ? 8 : Number(args[5]);
  const im = readPng(src);
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  const rows = [], cols = [];
  for (let yy = 0; yy < h; yy++) {
    let cnt = 0;
    for (let xx = 0; xx < w; xx++) {
      const i = ((y + yy) * im.w + x + xx) * 4;
      const a = im.data[i + 3];
      if (a >= thr) {
        n++; cnt++;
        if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
        if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
        cols[xx] = (cols[xx] || 0) + 1;
      }
    }
    rows.push(cnt);
  }
  const line = (arr) => Array.from({ length: w }, (_, i) => (arr[i] || 0)).join(',');
  console.log(`rect ${x},${y} ${w}x${h} thr>=${thr}: opaque=${n}  bbox=(${x0},${y0})-(${x1},${y1}) => ${x1 - x0 + 1}x${y1 - y0 + 1} (fraction of rect: ${((x1 - x0 + 1) / w).toFixed(2)} x ${((y1 - y0 + 1) / h).toFixed(2)})`);
  console.log(`  perRowOpaque=${rows.join(',')}`);
  // colour along the vertical centre line
  const cxp = Math.round((x0 + x1) / 2);
  const prof = [];
  for (let yy = y0; yy <= y1; yy++) {
    const i = ((y + yy) * im.w + x + cxp) * 4;
    prof.push(`${im.data[i]},${im.data[i + 1]},${im.data[i + 2]}a${im.data[i + 3]}`);
  }
  console.log(`  centreColumn(x=${x + cxp}) top->bottom: ${prof.join(' | ')}`);
} else {
  console.log('commands: info | crop | strip | stats | extent');
}
}

export { readPng, writePng };
