// Dump th06 ANM (EoSD) sections: spritedef rects + script bodies (raw words).
// Usage: node tools/anm_dump2.mjs <file.anm> [--defs N] [--words]
import fs from 'node:fs';
const b = fs.readFileSync(process.argv[2]);
const i32 = (o) => b.readInt32LE(o), u32 = (o) => b.readUInt32LE(o), f32 = (o) => b.readFloatLE(o);
const N = i32(0), M = i32(4);
const defsOffTable = 0x40, pairTable = defsOffTable + 4 * N;
console.log(`${process.argv[2]}: ${N} sprite-defs @0x${defsOffTable.toString(16)}, ${M} scripts @0x${pairTable.toString(16)}`);
console.log(`hdr words: ${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => '0x' + u32(8 * k).toString(16)).join(' ')}`);
const name = b.subarray(u32(0x1c), u32(0x1c) + 40).toString('ascii').replace(/\0.*$/s, '');
console.log(`texture: ${name}`);

console.log('\n-- sprite defs (idx: u,v,w,h,e5,e6) --');
for (let i = 0; i < N; i++) {
  const o = u32(defsOffTable + 4 * i);
  const id = i32(o);
  const vals = [1, 2, 3, 4, 5, 6].map((k) => f32(o + 4 * k));
  console.log(`${String(id).padStart(3)} @0x${o.toString(16).padStart(4, '0')}: u=${vals[0]} v=${vals[1]} w=${vals[2]} h=${vals[3]} e5=${vals[4]} e6=${vals[5]}`);
}

console.log('\n-- script bodies (raw 32-bit words) --');
const scripts = [];
for (let i = 0; i < M; i++) scripts.push({ id: i32(pairTable + 8 * i), off: u32(pairTable + 8 * i + 4) });
for (let i = 0; i < M; i++) {
  const next = i + 1 < M ? scripts[i + 1].off : b.length;
  const len = next - scripts[i].off;
  const words = [];
  for (let k = 0; k + 4 <= len; k += 4) words.push(u32(scripts[i].off + k).toString(16).padStart(8, '0'));
  console.log(`scr ${String(scripts[i].id).padStart(2)} @0x${scripts[i].off.toString(16).padStart(4, '0')} len=${len}: ${words.join(' ')}`);
}
