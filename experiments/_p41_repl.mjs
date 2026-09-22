/**
 * _p41_repl.mjs —— P4-1 关键复现：同一臂换一颗 CEM 随机种子，结论是否稳定？
 *
 * 动机：单跑一轮得到 h5 = 1451.7 vs none = 1369.5（+6.0%）。但本项目的历史教训是
 * 「均值比较不可信，且单次 CEM 训练本身就是一个有噪声的样本」。所以必须复现训练过程本身，
 * 而不是只换测试种子。
 *
 * 用法: node experiments/_p41_repl.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS = {
  'none@s16': 'checkpoint_p41_none.json',
  'h5@s16': 'checkpoint_p41_h5.json',
  'h4@s16': 'checkpoint_p41_h4.json',
  'none@s17': 'checkpoint_p41_none_s2.json',
  'h5@s17': 'checkpoint_p41_h5_s2.json',
};
const D = {};
for (const [k, f] of Object.entries(RUNS)) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) { console.log(`缺 ${f}`); process.exit(1); }
  D[k] = JSON.parse(fs.readFileSync(p, 'utf8'));
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const CAP = 1800;
const SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);

console.log('='.repeat(84));
console.log('P4-1 关键复现：同臂换 CEM 随机种子（各 80 代 x 64 候选 x 12 种子）');
console.log('='.repeat(84));
console.log(`\n${'运行'.padEnd(12)} | ${'CEM 种子'.padStart(9)} | ${'测试均值'.padStart(9)} | ${'触顶'.padStart(6)} | ${'随机基线'.padStart(9)} | ${'训练最佳'.padStart(9)} | 耗时`);
for (const [k, d] of Object.entries(D)) {
  console.log(
    `${k.padEnd(12)} | ${String(d.cemSeed).padStart(9)} | ${d.testTrained.toFixed(1).padStart(9)} | ` +
    `${(d.testPerSeed.filter((v) => v >= CAP).length + '/20').padStart(6)} | ${d.testRandom.toFixed(1).padStart(9)} | ` +
    `${d.bestFitness.toFixed(1).padStart(9)} | ${(d.elapsedSec / 60).toFixed(1)} min`
  );
}

console.log('\n[同臂跨 CEM 种子] 冻结臂自身的训练噪声 = 复现实验的分辨率下限');
const noneS16 = D['none@s16'].testTrained, noneS17 = D['none@s17'].testTrained;
const noise = Math.abs(noneS16 - noneS17);
console.log(`  none  : ${noneS16.toFixed(1)} (s16) vs ${noneS17.toFixed(1)} (s17)  ⇒ 极差 ${noise.toFixed(1)} 帧`);
const h5S16 = D['h5@s16'].testTrained, h5S17 = D['h5@s17'].testTrained;
console.log(`  h5    : ${h5S16.toFixed(1)} (s16) vs ${h5S17.toFixed(1)} (s17)  ⇒ 极差 ${Math.abs(h5S16 - h5S17).toFixed(1)} 帧`);

console.log(`\n[效应 vs 噪声]`);
console.log(`  s16 上 h5 − none = ${(h5S16 - noneS16).toFixed(1)}`);
console.log(`  s17 上 h5 − none = ${(h5S17 - noneS17).toFixed(1)}`);
console.log(`  ⇒ 符号翻转（${(h5S16 - noneS16) > 0 ? '+' : '-'} → ${(h5S17 - noneS17) > 0 ? '+' : '-'}）`);
console.log(`  ⇒ 训练随机源的自身极差 ${noise.toFixed(1)} 帧，与「效应」同量级`);

console.log('\n[逐种子配对：两个 CEM 种子下的 h5 − none]');
console.log(`${'种子'.padEnd(8)} | ${'card'.padStart(4)} | ${'s16: none/h5'.padStart(18)} | ${'s17: none/h5'.padStart(18)} | d(s16) | d(s17)`);
const d16 = [], d17 = [];
for (let i = 0; i < SEEDS.length; i++) {
  const n16 = D['none@s16'].testPerSeed[i], a16 = D['h5@s16'].testPerSeed[i];
  const n17 = D['none@s17'].testPerSeed[i], a17 = D['h5@s17'].testPerSeed[i];
  d16.push(a16 - n16); d17.push(a17 - n17);
  console.log(
    `${String(SEEDS[i]).padEnd(8)} | ${String(SEEDS[i] % 3).padStart(4)} | ` +
    `${(n16 + ' / ' + a16).padStart(18)} | ${(n17 + ' / ' + a17).padStart(18)} | ${String(a16 - n16).padStart(6)} | ${String(a17 - n17).padStart(6)}`
  );
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
for (const [name, dd] of [['s16', d16], ['s17', d17]]) {
  console.log(`  ${name}: 均值差 ${mean(dd).toFixed(1)} | 中位差 ${med(dd).toFixed(1)} | 胜 ${dd.filter((x) => x > 0).length} / 负 ${dd.filter((x) => x < 0).length} / 平 ${dd.filter((x) => x === 0).length}`);
}

console.log('\n[按符卡分组 · CEM s17]');
for (let c = 0; c < 3; c++) {
  const idx = SEEDS.map((s, i) => (s % 3 === c ? i : -1)).filter((i) => i >= 0);
  const st = (k) => { const v = idx.map((i) => D[k].testPerSeed[i]); return `${mean(v).toFixed(1)}(${Math.min(...v)}-${Math.max(...v)})`; };
  console.log(`  card${c} (n=${idx.length})  none@s17 ${st('none@s17').padStart(20)}   h5@s17 ${st('h5@s17').padStart(20)}`);
}

console.log('\n结论判据：若两个 CEM 种子下 (h5 − none) 符号不一致，则「h5 优于冻结」不可成立 ——');
console.log('          效应量必须显著大于「换一颗训练随机源」带来的自身抖动，才能称为提升。');
