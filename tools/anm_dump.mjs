// Dump th06 ANM (EoSD, "ANM v2"-ish) tables: script-offset table + sprite rect records.
// Usage: node tools/anm_dump.mjs <file.anm> [recordStride]
import fs from 'node:fs';

const p = process.argv[2];
const b = fs.readFileSync(p);
const u32 = (o) => b.readUInt32LE(o);
const i32 = (o) => b.readInt32LE(o);
const f32 = (o) => b.readFloatLE(o);

console.log(`${p} size=${b.length}`);
console.log(`hdr: count0=${u32(0)} count1=${u32(4)} [8]=${u32(8)} [c]=0x${u32(0xc).toString(16)} [10]=0x${u32(0x10).toString(16)} [14]=${u32(0x14)} [18]=${u32(0x18)} [1c]=0x${u32(0x1c).toString(16)}`);

const N = u32(0);
const table0 = u32(0x1c) ? 0x40 : 0x40;
// offsets table
const offs = [];
for (let i = 0; i < N; i++) offs.push(u32(0x40 + 4 * i));
const stride = offs[1] - offs[0];
console.log(`\n# ${N} offset entries @0x40, stride=${stride} (0x${stride.toString(16)}), first=0x${offs[0].toString(16)} last=0x${offs[N - 1].toString(16)}`);

console.log('\n# ---- rect-ish records (as float / int / hex) ----');
for (let i = 0; i < N; i++) {
  const o = offs[i];
  const words = [];
  for (let k = 0; k < stride / 4; k++) {
    const f = f32(o + 4 * k);
    words.push(`${u32(o + 4 * k).toString(16).padStart(8, '0')}=i${i32(o + 4 * k)}=f${Number.isFinite(f) ? +f.toPrecision(7) : f}`);
  }
  console.log(`rec ${String(i).padStart(3)} @0x${o.toString(16).padStart(4, '0')}: ${words.join('  ')}`);
}

const M = u32(4);
console.log(`\n# ---- ${M} (id,offset) pairs following the rect table ----`);
let base = 0x40 + 4 * N;
// scan pairs (id ascending, offset ascending)
for (let i = 0; i < M + 6; i++) {
  const o = base + 8 * i;
  if (o + 8 > b.length) break;
  console.log(`pair ${String(i).padStart(2)} @0x${o.toString(16).padStart(4, '0')}: id=${i32(o)} off=0x${u32(o + 4).toString(16)}`);
}
console.log(`\n# after pairs: @0x${(base + 8 * M).toString(16)} string = ${b.subarray(base + 8 * M, base + 8 * M + 40).toString('ascii').replace(/\0.*/s, '')}`);
