// A/B 对照结果汇总
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));

let A, B;
try {
  A = load('checkpoint_ab_v1.json');
  B = load('checkpoint_ab_wide.json');
} catch (e) {
  console.log('缺少结果文件:', e.message);
  process.exit(1);
}

const f1 = x => (x === undefined || x === null ? 'n/a' : x.toFixed(1));
const pct = (a, b) => ((b - a) / a * 100);

console.log('='.repeat(72));
console.log('  8 通道 vs 32 通道 · 同拓扑同超参同种子 A/B 对照');
console.log('='.repeat(72));
console.log(`                          A: 8 通道原口径      B: 32 通道宽口径`);
console.log(`  输入通道数              ${String(A.channels).padStart(10)}          ${String(B.channels).padStart(10)}`);
console.log(`  训练最佳适应度          ${f1(A.bestFitness).padStart(10)}          ${f1(B.bestFitness).padStart(10)}`);
console.log(`  独立测试集存活帧        ${f1(A.testTrained).padStart(10)}          ${f1(B.testTrained).padStart(10)}`);
console.log(`  独立测试集存活秒        ${(A.testTrained / 60).toFixed(2).padStart(10)}          ${(B.testTrained / 60).toFixed(2).padStart(10)}`);
console.log(`  随机权重基线            ${f1(A.testRandom).padStart(10)}          ${f1(B.testRandom).padStart(10)}`);
console.log(`  学到量 (训练-随机)      ${f1(A.testTrained - A.testRandom).padStart(10)}          ${f1(B.testTrained - B.testRandom).padStart(10)}`);
console.log(`  训练耗时 (min)          ${(A.elapsedSec / 60).toFixed(1).padStart(10)}          ${(B.elapsedSec / 60).toFixed(1).padStart(10)}`);

const d = pct(A.testTrained, B.testTrained);
const dr = pct(A.testRandom, B.testRandom);
console.log('\n' + '-'.repeat(72));
console.log(`  测试集存活帧差异: ${d >= 0 ? '+' : ''}${d.toFixed(1)}%  (${f1(A.testTrained)} → ${f1(B.testTrained)})`);
console.log(`  随机基线差异    : ${dr >= 0 ? '+' : ''}${dr.toFixed(1)}%  (口径本身对未训练策略的影响)`);
console.log(`  净效应 (剔除基线漂移): ${(d - dr) >= 0 ? '+' : ''}${(d - dr).toFixed(1)}%`);

console.log('\n每 10 代历史最佳适应度曲线');
console.log('  代次   A(8ch)   B(32ch)');
for (let g = 9; g < Math.max(A.history.length, B.history.length); g += 10) {
  const ha = A.history[g], hb = B.history[g];
  console.log(`  ${String(g + 1).padStart(3)}   ${f1(ha && ha.best).padStart(7)}   ${f1(hb && hb.best).padStart(7)}`);
}
const lastA = A.history[A.history.length - 1], lastB = B.history[B.history.length - 1];
console.log(`  ${String(A.history.length).padStart(3)}   ${f1(lastA && lastA.best).padStart(7)}   ${f1(lastB && lastB.best).padStart(7)}`);

console.log('\n' + '='.repeat(72));
const verdict = Math.abs(d) < 3 ? '两组基本持平 —— 通道扩展没有带来可测的收益'
  : d > 0 ? `宽口径高 ${d.toFixed(1)}% —— 通道扩展有效`
  : `宽口径低 ${Math.abs(d).toFixed(1)}% —— 通道扩展反而变差`;
console.log(`  判定: ${verdict}`);
console.log('='.repeat(72));
