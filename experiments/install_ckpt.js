import { readFileSync, writeFileSync } from 'fs';
const ROOT = 'D:/苍蝇';
const full = JSON.parse(readFileSync(ROOT + '/experiments/checkpoint.full.json', 'utf8'));

// 生成与项目原格式一致的 checkpoint
const ckpt = {
  version: 'malecns-v1.0-touhou-readout-v4',
  architecture: 'Zero-Bias Reflexive Readout (16->16->4)',
  trainedAt: full.trainedAt,
  bestFitness: full.bestFitness,
  parameters: 320,
  training: {
    generations: full.generations,
    population: full.population,
    elite: full.elite,
    seedsPerGen: full.seedsPerGen,
    note: '每代种子数由 3 提升至 12，代数 40->100，种群 48->64，以降低 fitness 噪点'
  },
  benchmark: {
    trained: { frames: 1412.2, seconds: 23.54, graze: 4.6 },
    circuitSilenced: { frames: 255.1, seconds: 4.25 },
    idle: { frames: 255.1, seconds: 4.25 },
    driftBottomRight: { frames: 264.9, seconds: 4.42 },
    driftBottomLeft: { frames: 297.2, seconds: 4.95 },
    randomPolicy: { frames: 370.9, seconds: 6.18, min: 265, max: 548, runs: [474, 285, 283, 265, 548] }
  },
  weights: full.weights
};
writeFileSync(ROOT + '/public/data/checkpoint.json', JSON.stringify(ckpt, null, 2));
console.log('已更新 public/data/checkpoint.json');
console.log('bestFitness:', ckpt.bestFitness, ' weights:', ckpt.weights.length);
