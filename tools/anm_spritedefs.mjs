// Dump etama3.anm spritedef records (the (id,offset) table that follows the 154 rect records).
import fs from 'node:fs';
const b = fs.readFileSync(process.argv[2]);
const i32 = (o) => b.readInt32LE(o), u32 = (o) => b.readUInt32LE(o), f32 = (o) => b.readFloatLE(o);
const M = i32(4);
const base = 0x40 + 4 * i32(0); // right after the 154-entry offset table
const ends = [];
for (let i = 0; i < M; i++) ends.push({ id: i32(base + 8 * i), off: u32(base + 8 * i + 4) });
console.log(`pair table @0x${base.toString(16)}, ${M} entries`);
for (let i = 0; i < M; i++) {
  const next = i + 1 < M ? ends[i + 1].off : 0x390; // filename string starts @0x390
  const len = next - ends[i].off;
  const words = [];
  for (let k = 0; k + 4 <= len; k += 4) {
    const o = ends[i].off + k;
    words.push(`0x${u32(o).toString(16).padStart(8, '0')}/${f32(o).toPrecision(6)}/${i32(o)}`);
  }
  console.log(`def ${String(ends[i].id).padStart(2)} @0x${ends[i].off.toString(16).padStart(4, '0')} len=${len}\n    ${words.join(' ')}`);
}
