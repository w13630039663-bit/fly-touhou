// EoSD (th06) ECL disassembler — Node port of final.py, with full param dump.
// Usage: node tools/ecl_dis.mjs <ecl path> <sub...>
import fs from 'node:fs';

const path = process.argv[2] || 'ecldata6.ecl';
const subs = process.argv.slice(3).map(Number);

const d = fs.readFileSync(path);
const nsub = d.readUInt32LE(0);
const ver = d.readUInt32LE(4);
const offs = [];
for (let i = 0; i < nsub; i++) offs.push(d.readUInt32LE(0x10 + 4 * i));

const NAMES = {
  2: 'jump', 3: 'jump_ex', 4: 'set', 5: 'setf', 6: 'dec', 8: 'set_randf', 9: 'set_randi',
  13: 'add', 14: 'add2?', 17: 'mod', 20: 'addf', 21: 'subf?', 27: 'test', 29: 'jump_l',
  30: 'jump_le?', 33: 'jump_ge?', 34: 'jump_neq', 35: 'call', 36: 'return',
  41: 'move_to?', 44: 'boss_x_y?', 47: 'set_speed', 49: 'set_angle_ex?', 50: 'set_angle_rand_ex',
  52: 'move_decel', 57: 'move_to_decel', 61: 'stop_in_decel', 68: 'el_set?',
  70: 'et_set_eqdistr', 71: 'et_set_?', 82: 'et_extra', 93: 'set_spellcard', 97: 'set_anim',
  104: 'delete_bullet?', 105: 'set_damageable', 106: 'play_sound', 112: 'set_time', 115: 'set_timeout',
};

const F = (b) => {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(b >>> 0, 0);
  const v = buf.readFloatLE(0);
  if (v < 0 && Number.isInteger(v) && v > -100000) return `%${v}`;
  return v.toPrecision(8).replace(/0+$/, '').replace(/\.$/, '');
};
const rel = (x) => (x >= 0x80000000 ? x - 0x100000000 : x);
const I = (x) => {
  const s = rel(x);
  return s <= -10000 ? `$${s}` : String(s >>> 0 < 0x80000000 ? s : s);
};

function* walk(st, en) {
  let i = st + 4;
  while (i + 8 <= en) {
    const op = d.readUInt16LE(i);
    const size = d.readUInt16LE(i + 2);
    const b4 = d.readUInt8(i + 4);
    const msk = d.readUInt8(i + 5);
    if (op === 0xffff || size < 8 || i + size > en) return;
    const n = Math.floor((size - 8) / 4);
    const w = [];
    for (let k = 0; k < n; k++) w.push(d.readUInt32LE(i + 8 + 4 * k));
    yield { off: i - st, op, size, b4, msk, w, time: w.length ? w[w.length - 1] : 0 };
    i += size;
  }
}

console.log(`${path} nsub=${nsub} version=0x${ver.toString(16)}`);

if (subs.includes(-1)) {
  // scan mode: every call site + every set_spellcard across all subs
  for (let s = 0; s < nsub; s++) {
    const en = s + 1 < nsub ? offs[s + 1] : d.length;
    for (const { off, op, msk, w, time } of walk(offs[s], en)) {
      const a = w.slice(0, -1);
      if (op === 35) console.log(`  sub ${s} @${off.toString(16).padStart(4, '0')} diff=0x${msk.toString(16).padStart(2, '0')} t=${time >>> 0} call(${a.map((x) => `${x >>> 0}/${F(x)}`).join(', ')})`);
    }
  }
  process.exit(0);
}

for (const SUB of subs) {
  const en = SUB + 1 < nsub ? offs[SUB + 1] : d.length;
  console.log(`\n===== SUB ${SUB} (@0x${offs[SUB].toString(16)}) =====`);
  for (const { off, op, size, msk, w, time } of walk(offs[SUB], en)) {
    const a = w.slice(0, -1); // drop trailing time word
    let txt = '';
    if (op === 70) {
      const spr = a[0] & 0xffff, col = (a[0] >> 16) & 0xffff;
      txt = `et_set_eqdistr(spr=${spr}, col=${col}, num1=${I(a[1])}, num2=${I(a[2])}, spd1=${F(a[3])}, spd2=${F(a[4])}, ang1=${F(a[5])}, ang2=${F(a[6])}, flags=0x${a[7].toString(16)})`;
    } else if (op === 82) {
      txt = `et_extra(a=${rel(a[0])}, b=${rel(a[1])}, c=${rel(a[2])}, d=${rel(a[3])}, r=${F(a[4])}, s=${F(a[5])}, m=${F(a[6])}, n=${F(a[7])})`;
    } else if (op === 93) {
      const face = d.readInt16LE(offs[SUB] + off + 8);
      const sid = d.readInt16LE(offs[SUB] + off + 10);
      const sl = d.subarray(offs[SUB] + off + 12, offs[SUB] + off + 12 + 34);
      const nm = sl.subarray(0, sl.indexOf(0) < 0 ? sl.length : sl.indexOf(0)).toString('ascii');
      txt = `set_spellcard(face=${face}, spell_id=${sid}, "${nm}")`;
    } else if (op === 57) {
      txt = `move_to_decel(dur=${rel(a[0])}, x=${F(a[1])}, y=${F(a[2])}, z=${F(a[3])})`;
    } else if (op === 47) txt = `set_speed(${F(a[0])})`;
    else if (op === 50) txt = `set_angle_rand_ex(${F(a[0])}, ${F(a[1])})`;
    else if (op === 61) txt = `stop_in_decel(${a[0]})`;
    else if (op === 4) txt = `set(${I(a[0])}, ${I(a[1])})`;
    else if (op === 5) txt = `setf(${I(a[0])}, ${F(a[1])})`;
    else if (op === 8) txt = `set_randi(${I(a[0])}, ${I(a[1])}, ${I(a[2])})`;
    else if (op === 9) txt = `set_randf(${I(a[0])}, ${F(a[1])}, ${F(a[2])})`;
    else if (op === 13) txt = `add(${I(a[0])}, ${I(a[1])}, ${I(a[2])})`;
    else if (op === 17) txt = `mod(${I(a[0])}, ${I(a[1])}, ${I(a[2])})`;
    else if (op === 20) txt = `addf(${I(a[0])}, ${F(a[1])}, ${F(a[2])})`;
    else if (op === 27) txt = `test(${I(a[0])}, ${I(a[1])})`;
    else if (op === 2) txt = `jump(a=[${a.map((x) => x >>> 0).join(',')}], -> @${(off + rel(a[0])).toString(16)})`;
    else if (op === 3) txt = `jump_ex(a0=${a[0]}, a1=${a[1] >>> 0}/${rel(a[1])}/${F(a[1])}, a2=${a[2]})`;
    else if (op === 29) txt = `jump_l(a0=${a[0]}, a1=${a[1] >>> 0}/${rel(a[1])}, a2=${a[2]})`;
    else if (op === 34) txt = `jump_neq(a0=${a[0]}, a1=${a[1] >>> 0}/${rel(a[1])}, a2=${a[2]})`;
    else if (op === 35) txt = `call(func=${a[0]}, ${I(a[1])}, ${F(a[2])})`;
    else if (op === 36) txt = 'return()';
    else if (op === 97) txt = `set_anim(${a[0]})`;
    else if (op === 105) txt = `set_damageable(${a[0]})`;
    else if (op === 106) txt = `play_sound(${a[0]})`;
    else if (op === 112) txt = `set_time(${a[0]})`;
    else if (op === 115) txt = `set_timeout(${a[0]})`;
    else txt = `raw: ${a.map((x) => '0x' + x.toString(16).padStart(8, '0')).join(' ')}`;
    const tms = time === 0xffffffff ? 'NEVER' : String(time >>> 0);
    console.log(`  @${off.toString(16).padStart(4, '0')} op=${String(op).padEnd(3)} ${String(NAMES[op] ?? 'ins_' + op).padEnd(19)} diff=0x${msk.toString(16).padStart(2, '0')} t=${tms.padEnd(5)} | ${txt}`);
    console.log(`        raw${' '.repeat(23)} ${a.map((x) => x.toString(16).padStart(8, '0')).join(' ')}`);
  }
}
