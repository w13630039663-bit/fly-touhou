// 生成 graph8ch1.json：把 v1 的 8 通道 4:1 输入映射压缩为 8 通道 1:1
// 目的：C 组对照 —— 与 A 组（8 通道 4:1）同为 8 个通道，但每个通道只驱动 1 个细胞。
// 这样 A vs C 只变「同一信号广播到几个细胞」（驱动广度），A vs B 只变「信号维度」。
// 分配规则：每个通道保留其细胞列表中的第一个（与 _gen_graph32.mjs 的 base 保持一致）。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public/data/connectome/graph.json');
const DST = path.join(ROOT, 'public/data/connectome/graph8ch1.json');

const g = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const byCh = new Map();
for (const [cell, ch] of g.inputs) {
  if (!byCh.has(ch)) byCh.set(ch, []);
  byCh.get(ch).push(cell);
}
const groups = [...byCh.keys()].sort((a, b) => a - b);

const newInputs = groups.map((ch) => [byCh.get(ch)[0], ch]);

const out = {
  version: 'malecns-v1-8ch1cell',
  note: '输入映射实验变体：节点与边与 v1 逐位相同，仅 inputs 从 8 通道 4:1 改为 8 通道 1:1'
      + '（每通道只保留原细胞组的首细胞，其余 24 个视觉传入细胞不再接受驱动）。'
      + '用途：分离「通道数」与「每通道细胞冗余」两个变量。',
  nodes: g.nodes,
  edges: g.edges,
  inputs: newInputs,
  outputs: g.outputs,
  channels: g.channels
};

fs.writeFileSync(DST, JSON.stringify(out, null, 2));

console.log(`输出: ${path.relative(ROOT, DST)}`);
console.log(`  节点 ${out.nodes.length} / 边 ${out.edges.length} (与 v1 逐位相同)`);
console.log(`  inputs: ${g.inputs.length} 对 (v1) → ${newInputs.length} 对 (本变体)`);
console.log(`  映射: ${newInputs.map(([c, ch]) => `ch${ch}→cell${c}`).join(', ')}`);
console.log(`  通道数 ${new Set(newInputs.map(i => i[1])).size} / 驱动细胞数 ${new Set(newInputs.map(i => i[0])).size}`);
