import { readFileSync } from 'fs';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { ReadoutPolicy } from '../src/brain/policy.js';

const ROOT = 'D:/苍蝇';
const graph = JSON.parse(readFileSync(ROOT + '/public/data/connectome/graph.json', 'utf8'));
const ckpt = JSON.parse(readFileSync(ROOT + '/public/data/checkpoint.json', 'utf8'));

console.log('=== 1. graph.json 真实数据校验 ===');
console.log('节点数:', graph.nodes.length);
console.log('边数:', graph.edges.length);
const types = new Set(graph.nodes.map(n => n.type));
console.log('不同细胞类型数:', types.size);
console.log('样本类型:', [...types].slice(0, 12).join(', '));
const signs = graph.nodes.reduce((m, n) => { m[n.sign>0?'+':(n.sign<0?'−':'0')]=(m[n.sign>0?'+':(n.sign<0?'−':'0')]||0)+1; return m; }, {});
console.log('递质符号分布(+/−/0):', JSON.stringify(signs));
console.log('inputs(视觉映射)条数:', graph.inputs.length, ' outputs(下行)条数:', graph.outputs.length);
console.log('节点含 position 三维坐标:', Array.isArray(graph.nodes[0].position) && graph.nodes[0].position.length === 3);

console.log('\n=== 2. 真实模型实跑 (载入真实图 + 训练checkpoint) ===');
const brain = new MaleCNSConnectome(graph);
const policy = new ReadoutPolicy(new Float64Array(ckpt.weights));
console.log('checkpoint weights 长度:', ckpt.weights.length, ' bestFitness:', ckpt.bestFitness);

// 用一组真实风格观测跑 1 步
const obs = [0.7, 0.2, 0.3, 0.1, 0.5, 0.4, 0.6, 0.8];
const dn = brain.step(obs, false);
const motor = policy.forward(dn);
console.log('DN输出(16) 是否含非零:', dn.some(v => v !== 0), ' 峰值:', Math.max(...dn.map(Math.abs)).toFixed(3));
console.log('训练策略动作 moveX,moveY:', motor.moveX.toFixed(4), motor.moveY.toFixed(4));

console.log('\n=== 3. 零偏置因果检验 (输入全零) ===');
const zeroDn = new Array(16).fill(0);
const m0 = policy.forward(zeroDn);
console.log('输入零 -> moveX,moveY:', m0.moveX.toFixed(4), m0.moveY.toFixed(4), (m0.moveX===0 && m0.moveY===0) ? '✓ 严格(0,0)' : '✗ 退化');

console.log('\n=== 4. 消融静音检验 (ablated=true) ===');
const dnSilent = brain.step(obs, true);
const mS = policy.forward(dnSilent);
console.log('静音 DN 全零:', dnSilent.every(v => v === 0), ' 动作:', mS.moveX.toFixed(4), mS.moveY.toFixed(4));

console.log('\n=== 5. 连续 5 帧动力学 (确认 h 有跨帧记忆, 非常数) ===');
let acts = [];
for (let f = 0; f < 5; f++) {
  const o = [0.5 + 0.1*f, 0.3, 0.2, 0.1, 0.4, 0.3, 0.5, 0.7];
  const d = brain.step(o, false);
  acts.push(policy.forward(d).moveX.toFixed(3));
}
console.log('连续帧 moveX:', acts.join(' -> '), acts.every(a => a===acts[0]) ? '✗ 常数' : '✓ 时变');
