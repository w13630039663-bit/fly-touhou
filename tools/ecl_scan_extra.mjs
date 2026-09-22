// Rosetta-stone scan: for every opcode-70 (equidistant emitter) in every ecldata*.ecl,
// pair it with the nearest preceding opcode-82 (et_extra) in the same sub and dump the params.
// Usage: node tools/ecl_scan_extra.mjs <dir-with-ecldata*.ecl>
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2];
const bufFor = {};

function load(file) {
  const d = fs.readFileSync(file);
  const nsub = d.readUInt32LE(0);
  const offs = [];
  for (let i = 0; i < nsub; i++) offs.push(d.readUInt32LE(0x10 + 4 * i));
  return { d, nsub, offs };
}

const f32 = (b, o) => { const t = Buffer.alloc(4); t.writeUInt32LE(b >>> 0, 0); return t.readFloatLE(0); };
const rel = (x) => (x >= 0x80000000 ? x - 0x100000000 : x);

function* walk(d, st, en) {
  let i = st + 4;
  while (i + 8 <= en) {
    const op = d.readUInt16LE(i), size = d.readUInt16LE(i + 2), msk = d.readUInt8(i + 5);
    if (op === 0xffff || size < 8 || i + size > en) return;
    const n = Math.floor((size - 8) / 4);
    const w = [];
    for (let k = 0; k < n; k++) w.push(d.readUInt32LE(i + 8 + 4 * k));
    yield { off: i - st, op, msk, w, time: w.length ? w[w.length - 1] : 0xffffffff };
    i += size;
  }
}

const rows = [];
for (const fn of fs.readdirSync(DIR).filter((f) => /^ecldata\d+\.ecl$/.test(f)).sort()) {
  const { d, nsub, offs } = load(path.join(DIR, fn));
  for (let s = 0; s < nsub; s++) {
    const en = s + 1 < nsub ? offs[s + 1] : d.length;
    let lastExtra = null;
    for (const ins of walk(d, offs[s], en)) {
      const a = ins.w.slice(0, -1);
      if (ins.op === 82) lastExtra = a;
      if (ins.op === 70 && a.length >= 8) {
        rows.push({
          file: fn, sub: s, off: ins.off, diff: ins.msk, t: ins.time,
          spr: a[0] & 0xffff, col: (a[0] >> 16) & 0xffff,
          num1: a[1], num2: a[2], spd1: f32(a[3]), spd2: f32(a[4]),
          ang1: f32(a[5]), ang2: f32(a[6]), flags: a[7],
          extra: lastExtra ? { a: rel(lastExtra[0]), b: rel(lastExtra[1]), c: rel(lastExtra[2]), d: rel(lastExtra[3]), r: f32(lastExtra[4]), s: f32(lastExtra[5]), m: f32(lastExtra[6]), n: f32(lastExtra[7]) } : null,
        });
      }
    }
  }
}

// group by flags
const by = {};
for (const r of rows) (by[r.flags] ||= []).push(r);
console.log(`total opcode-70 emitters: ${rows.length}`);
for (const k of Object.keys(by).map(Number).sort((x, y) => x - y)) {
  const g = by[k];
  const ex = g.filter((r) => r.extra);
  console.log(`\n### flags=0x${k.toString(16)}  n=${g.length}  (with preceding et_extra: ${ex.length})`);
  const rs = g.map((r) => r.spd1), ag = g.map((r) => r.ang2);
  console.log(`   spd1 range ${Math.min(...rs).toFixed(3)}..${Math.max(...rs).toFixed(3)}   ang2 distinct: ${[...new Set(ag.map((v) => v.toFixed(6)))].slice(0, 12).join(', ')}`);
  const sa = ex.map((r) => r.extra.a), sr = ex.map((r) => r.extra.r), ss = ex.map((r) => r.extra.s), sb = ex.map((r) => r.extra.b);
  if (ex.length) {
    console.log(`   et_extra.a  distinct: ${[...new Set(sa)].sort((x, y) => x - y).slice(0, 20).join(', ')}`);
    console.log(`   et_extra.b  distinct: ${[...new Set(sb)].sort((x, y) => x - y).slice(0, 20).join(', ')}`);
    console.log(`   et_extra.r  range ${Math.min(...sr).toFixed(5)}..${Math.max(...sr).toFixed(5)}  distinct: ${[...new Set(sr.map((v) => v.toFixed(5)))].slice(0, 14).join(', ')}`);
    console.log(`   et_extra.s  range ${Math.min(...ss).toFixed(5)}..${Math.max(...ss).toFixed(5)}  distinct: ${[...new Set(ss.map((v) => v.toFixed(5)))].slice(0, 14).join(', ')}`);
  }
  // sample rows
  for (const r of g.slice(0, 6)) {
    console.log(`   ${r.file.replace('ecldata', 'e').replace('.ecl', '')} sub${r.sub}@0x${r.off.toString(16)} diff=${r.diff.toString(16)} spr=${r.spr},col=${r.col} num=${r.num1}x${r.num2} spd=${r.spd1.toFixed(2)}/${r.spd2.toFixed(2)} ang2=${r.ang2.toFixed(5)}` +
      (r.extra ? ` | extra(a=${r.extra.a},b=${r.extra.b},r=${r.extra.r.toFixed(5)},s=${r.extra.s.toFixed(5)},m=${r.extra.m},n=${r.extra.n})` : ' | no extra'));
  }
}
