// experiments/_b1_gate.mjs — B.1 验收: 增益 1.000 ⇒ 与 320 版逐位一致 + 钳制/生效性
import fs from 'fs';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { evaluateCandidate } from '../src/brain/eval_core.js';

const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const g = load('public/data/connectome/graph600a.json');
const ck = load('public/data/checkpoint600a.json');
const w320 = new Float64Array(ck.weights);
const w322 = (e, i) => { const a = new Float64Array(322); a.set(w320); a[320] = e; a[321] = i; return a; };
const seeds = [90001, 90002, 90003];

const brain = new MaleCNSConnectome(g);
const s320 = evaluateCandidate(w320, seeds, brain, 600);
const s322 = evaluateCandidate(w322(1.0, 1.0), seeds, brain, 600);
console.log(`gate1 增益1/1 vs 320 位一致: ${s320 === s322 ? 'PASS' : 'FAIL'} (${s320} vs ${s322})`);

const sUp = evaluateCandidate(w322(2.0, 2.0), seeds, brain, 600);
console.log(`gate2 增益2/2 改变适应度: ${sUp !== s320 ? 'PASS' : 'FAIL (恰好相等?换种子重试)'} (${sUp.toFixed(1)})`);

const sClamp = evaluateCandidate(w322(9.9, -3), seeds, brain, 600);
const sClampRef = evaluateCandidate(w322(4, 0), seeds, brain, 600);
console.log(`gate3 越界钳制 [0,4]: ${sClamp === sClampRef ? 'PASS' : 'FAIL'}`);
console.log(`brain.dnGains 终态: ${JSON.stringify(brain.dnGains)}`);

// 评估后恢复中性: 320 再评一次必须与 gate1 s320 位一致 (无脏状态泄漏)
const s320post = evaluateCandidate(w320, seeds, brain, 600);
console.log(`gate4 322→320 交替无残留: ${s320post === s320 ? 'PASS' : 'FAIL'}`);
