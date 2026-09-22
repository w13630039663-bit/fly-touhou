import { readFileSync } from 'fs';
import { ReadoutPolicy, PARAMETERS } from '../src/brain/policy.js';

const ROOT = 'D:/苍蝇';
const ckpt = JSON.parse(readFileSync(ROOT + '/public/data/checkpoint.json', 'utf8'));
const W = new Float64Array(ckpt.weights);

console.log('=== checkpoint 自洽性检查 ===');
console.log('version:', ckpt.version);
console.log('architecture:', ckpt.architecture);
console.log('trainedAt:', ckpt.trainedAt);
console.log('bestFitness:', ckpt.bestFitness);
console.log('parameters:', ckpt.parameters, ' weights长度:', ckpt.weights.length);
console.log('benchmark:', JSON.stringify(ckpt.benchmark, null, 2));

// 权重分布特征: 训练收敛的权重通常有较大的 max 和结构化分布
let mn = Infinity, mx = -Infinity, sum = 0, sum2 = 0, nBig = 0;
for (const w of W) {
  mn = Math.min(mn, w); mx = Math.max(mx, w);
  sum += w; sum2 += w * w;
  if (Math.abs(w) > 1.0) nBig++;
}
const mean = sum / W.length, std = Math.sqrt(sum2 / W.length - mean * mean);
console.log('\n=== 权重统计 ===');
console.log(`min=${mn.toFixed(4)} max=${mx.toFixed(4)} mean=${mean.toFixed(4)} std=${std.toFixed(4)}`);
console.log(`|w|>1.0 的权重数: ${nBig} / ${PARAMETERS} (${(nBig/PARAMETERS*100).toFixed(1)}%)`);
console.log('初始 sigma=0.8, 若权重 std 远小于 0.8 说明经过收敛; 若接近 0.8 则近似随机');

// 区分度: 若权重有结构, 则它的 fitness 应显著高于随即权重
console.log('\n结论: 需要看训练脚本实际输出才能判断这份 checkpoint 的来历');
