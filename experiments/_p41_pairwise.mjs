/**
 * _p41_pairwise.mjs —— P4-1 三臂（none / h5 / h4）逐种子配对分析
 *
 * 读法规范（沿用 P0-2 的教训）：
 *   - 本项目**均值比较不可信**，必须做逐种子配对
 *   - evalTest 用 seed % 3 选符卡 ⇒ 20 个测试种子实际只有 3 个独立场景，
 *     组内极差经常为 0 ⇒ **n_eff ≈ 3**，胜率的置信度虚高约 7 倍 → 按符卡读，别按种子读
 *
 * 用法: node experiments/_p41_pairwise.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARMS = { none: 'checkpoint_p41_none.json', h5: 'checkpoint_p41_h5.json', h4: 'checkpoint_p41_h4.json' };
const LABEL = { none: 'W 冻结', h5: 'Hebbian η=1e-5', h4: 'Hebbian η=1e-4' };
const ORDER = ['none', 'h5', 'h4'];

const D = {};
for (const k of ORDER) {
  const p = path.join(__dirname, ARMS[k]);
  if (!fs.existsSync(p)) { console.log(`缺 ${ARMS[k]}，无法分析`); process.exit(1); }
  D[k] = JSON.parse(fs.readFileSync(p, 'utf8'));
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
const CAP = 1800;

console.log('='.repeat(84));
console.log('P4-1 Hebbian 三臂对照 —— 读出层在「W 可塑」环境里协同重训，各 80 代 x 64 x 12 种子');
console.log('='.repeat(84));

console.log(`\n${'臂'.padEnd(16)} | ${'测试均值'.padStart(9)} | ${'触顶'.padStart(6)} | ${'随机基线'.padStart(9)} | ${'学习增益'.padStart(9)} | ${'峰值漂移'.padStart(9)} | 耗时`);
for (const k of ORDER) {
  const d = D[k];
  const capped = d.testPerSeed.filter((v) => v >= CAP).length;
  console.log(
    `${LABEL[k].padEnd(16)} | ${d.testTrained.toFixed(1).padStart(9)} | ${(capped + '/20').padStart(6)} | ` +
    `${d.testRandom.toFixed(1).padStart(9)} | ${(d.testTrained - d.testRandom).toFixed(0).padStart(9)} | ` +
    `${(d.peakDrift || 0).toFixed(4).padStart(9)} | ${(d.elapsedSec / 60).toFixed(1)} min`
  );
}

const aArm = JSON.parse(fs.readFileSync(path.join(__dirname, 'checkpoint_ab3_v1.json'), 'utf8'));
const regress = D.none.testTrained - aArm.testTrained;
console.log(`\n[回归门] none 臂 ${D.none.testTrained.toFixed(2)} vs 未改源码前的 A 臂 ${aArm.testTrained.toFixed(2)}  ⇒ Δ = ${regress.toFixed(2)} 帧 ${Math.abs(regress) < 0.01 ? '✅ 逐位复现' : '❌ 训练语义被改动'}`);

console.log(`\n${'种子'.padEnd(8)} | ${'card'.padStart(4)} | ${'none'.padStart(6)} | ${'h5'.padStart(6)} | ${'h4'.padStart(6)} | ${'h5-none'.padStart(8)} | ${'h4-none'.padStart(8)}`);
const diff5 = [], diff4 = [];
for (let i = 0; i < SEEDS.length; i++) {
  const n = D.none.testPerSeed[i], a = D.h5.testPerSeed[i], b = D.h4.testPerSeed[i];
  diff5.push(a - n); diff4.push(b - n);
  console.log(`${String(SEEDS[i]).padEnd(8)} | ${String(SEEDS[i] % 3).padStart(4)} | ${String(n).padStart(6)} | ${String(a).padStart(6)} | ${String(b).padStart(6)} | ${String(a - n).padStart(8)} | ${String(b - n).padStart(8)}`);
}

function pairedReport(name, diffs) {
  const win = diffs.filter((d) => d > 0).length, lose = diffs.filter((d) => d < 0).length, tie = diffs.filter((d) => d === 0).length;
  console.log(`\n[${name} vs none] 均值差 ${mean(diffs).toFixed(1)} | 配对中位差 ${median(diffs).toFixed(1)} | 胜 ${win} / 负 ${lose} / 平 ${tie}`);
}
pairedReport('h5', diff5);
pairedReport('h4', diff4);

console.log('\n[按符卡分组] card = seed % 3；组内极差为 0 说明该符卡下多个种子其实是同一场景');
console.log(`${'card'.padEnd(6)} | ${'n'.padStart(3)} | ${'none'.padStart(18)} | ${'h5'.padStart(18)} | ${'h4'.padStart(18)} | 极差 none/h5/h4`);
for (let c = 0; c < 3; c++) {
  const idx = SEEDS.map((s, i) => (s % 3 === c ? i : -1)).filter((i) => i >= 0);
  const stat = (k) => {
    const v = idx.map((i) => D[k].testPerSeed[i]);
    return { avg: mean(v), min: Math.min(...v), max: Math.max(...v) };
  };
  const s = { none: stat('none'), h5: stat('h5'), h4: stat('h4') };
  const fmt = (x) => `${x.avg.toFixed(1)} (${x.min}-${x.max})`;
  console.log(
    `${String(c).padEnd(6)} | ${String(idx.length).padStart(3)} | ${fmt(s.none).padStart(18)} | ${fmt(s.h5).padStart(18)} | ${fmt(s.h4).padStart(18)} | ` +
    `${(s.none.max - s.none.min)}/${(s.h5.max - s.h5.min)}/${(s.h4.max - s.h4.min)}`
  );
}

console.log('\n读法提醒：本项目均值比较不可信；且 20 个测试种子只有 3 个独立场景（n_eff ≈ 3），');
console.log('         胜率数字的置信度虚高约 7 倍 —— 结论要看「是否在全部三张符卡上同向」。');
