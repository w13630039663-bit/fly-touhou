// 生成 graph32ch.json：把 v1 的 8 通道 4:1 输入映射改为 32 通道 1:1
// 分配规则：原通道 i 的第 1 个细胞保留给基础通道 i（保住原语义），其余 24 个细胞顺序分给扇区通道 8..31
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public/data/connectome/graph.json');
const DST = path.join(ROOT, 'public/data/connectome/graph32ch.json');

const g = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const byCh = new Map();
for (const [cell, ch] of g.inputs) {
  if (!byCh.has(ch)) byCh.set(ch, []);
  byCh.get(ch).push(cell);
}
const groups = [...byCh.keys()].sort((a, b) => a - b);
console.log(`原映射: ${g.inputs.length} 个细胞 / ${groups.length} 个通道`);
console.log(`每通道细胞数: ${groups.map(c => byCh.get(c).length).join(', ')}`);

const base = [];
const rest = [];
for (const ch of groups) {
  const cells = byCh.get(ch);
  base.push([cells[0], ch]);
  for (let k = 1; k < cells.length; k++) rest.push(cells[k]);
}
const newInputs = base.slice();
rest.forEach((cell, j) => newInputs.push([cell, 8 + j]));

const channels = ['LC4', 'LC11', 'LC9', 'LC15', 'LC16', 'LC17', 'LC21', 'LPLC2'];
for (let s = 0; s < 8; s++) {
  channels.push(`Sec${s}_loom`, `Sec${s}_appr`, `Sec${s}_dens`);
}

const out = {
  version: 'malecns-v1-wide32ch',
  note: '输入映射实验变体：节点与边与 v1 逐位相同，仅 inputs 从 8 通道 4:1 改为 32 通道 1:1。'
      + '基础通道 0-7 沿用原组首细胞以保住原语义；扇区通道 8-31 承接其余 24 个视觉传入细胞。',
  nodes: g.nodes,
  edges: g.edges,
  inputs: newInputs,
  outputs: g.outputs,
  channels
};

fs.writeFileSync(DST, JSON.stringify(out, null, 2));

const used = new Set(newInputs.map(i => i[0]));
const chans = new Set(newInputs.map(i => i[1]));
console.log(`\n输出: ${path.relative(ROOT, DST)}`);
console.log(`  节点 ${out.nodes.length} / 边 ${out.edges.length} (与 v1 相同)`);
console.log(`  inputs ${newInputs.length} 对, 唯一细胞 ${used.size}, 唯一通道 ${chans.size}`);
console.log(`  通道覆盖 0..31: ${[...chans].sort((a, b) => a - b).join(',') === Array.from({ length: 32 }, (_, i) => i).join(',') ? '完整' : '不完整'}`);
console.log(`  细胞无重复: ${used.size === newInputs.length ? '是' : '否'}`);
console.log(`  基础通道占用细胞: ${base.map(b => b[0]).join(',')}`);
console.log(`  扇区通道占用细胞 (前 8 个): ${rest.slice(0, 8).join(',')} ...`);
