/**
 * v8 口径回归：游戏机制改造 (死亡清屏/难度重算/火力加强/击破停机) 之后，
 * train.js evaluateOnTestSeeds 的 20-seed 测试必须与既有冠军数字逐位一致：
 *   v1    normal = 1544.8   (checkpoint.json)
 *   v600a normal = 1538.2   (checkpoint600a.json)
 *   idle  = 885.8 (恒定挂机基准)
 * 若有任何漂移，说明 danmaku.js 的改动泄漏进了 headless 训练/测试语义。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { evaluateOnTestSeeds } from '../train.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_SEEDS = Array.from({ length: 20 }, (_, i) => 80001 + i);
const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

/*
 * 期望值为 checkpoint 记录中的全精度原始数字 (20-seed 均值恒为 0.05 的倍数；
 * 对外口径 1544.8 / 1538.2 / 885.8 是其一位小数四舍五入)：
 */
const EXPECT = { v1: 1544.85, v600a: 1538.15, idle: 885.75 };

const g1 = load('public/data/connectome/graph.json');
const c1 = load('public/data/checkpoint.json');
const e1 = evaluateOnTestSeeds(TEST_SEEDS, new MaleCNSConnectome(g1), new Float64Array(c1.weights), 'normal');

const ga = load('public/data/connectome/graph600a.json');
const ca = load('public/data/checkpoint600a.json');
const ea = evaluateOnTestSeeds(TEST_SEEDS, new MaleCNSConnectome(ga), new Float64Array(ca.weights), 'normal');

const ei = evaluateOnTestSeeds(TEST_SEEDS, null, null, 'idle');

console.log(JSON.stringify({
  v1: e1.frames, v600a: ea.frames, idle: ei.frames,
  ok_v1: e1.frames === EXPECT.v1,
  ok_v600a: ea.frames === EXPECT.v600a,
  ok_idle: ei.frames === EXPECT.idle
}, null, 1));
if (e1.frames !== EXPECT.v1 || ea.frames !== EXPECT.v600a || ei.frames !== EXPECT.idle) {
  console.error('❌ CALIBER DRIFT — headless 语义被 v8 游戏改动污染！');
  process.exit(1);
}
console.log('✅ 口径逐位不变：v8 改动对训练/测试评估零泄漏');
