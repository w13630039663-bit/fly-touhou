import { readFileSync } from 'fs';
import { createMatchedControlGraph } from '../src/brain/connectome.js';

const ROOT = 'D:/苍蝇';
const graph = JSON.parse(readFileSync(ROOT + '/public/data/connectome/graph.json', 'utf8'));

const ctrl = createMatchedControlGraph(graph, 42);

console.log('=== Matched Control 图 vs 原始图 ===');
console.log('原始: 节点', graph.nodes.length, ' 边', graph.edges.length, ' inputs', graph.inputs.length, ' outputs', graph.outputs.length);
console.log('对照: 节点', ctrl.nodes.length, ' 边', ctrl.edges.length, ' inputs', ctrl.inputs.length, ' outputs', ctrl.outputs.length);
console.log('成功交换次数:', ctrl.successfulSwaps);

// 1. 检查边数守恒
console.log('\n[1] 边数守恒:', graph.edges.length === ctrl.edges.length ? '✓' : '✗');

// 2. 检查出入度守恒
function degrees(edges, n) {
  const inD = new Array(n).fill(0), outD = new Array(n).fill(0);
  for (const [p, q] of edges) { outD[p]++; inD[q]++; }
  return { inD, outD };
}
const n = graph.nodes.length;
const d1 = degrees(graph.edges, n), d2 = degrees(ctrl.edges, n);
let inSame = true, outSame = true;
for (let i = 0; i < n; i++) {
  if (d1.inD[i] !== d2.inD[i]) inSame = false;
  if (d1.outD[i] !== d2.outD[i]) outSame = false;
}
console.log('[2] 入度分布守恒:', inSame ? '✓' : '✗', ' 出度分布守恒:', outSame ? '✓' : '✗');

// 3. 检查无自环
let selfLoops = 0;
for (const [p, q] of ctrl.edges) if (p === q) selfLoops++;
console.log('[3] 自环数量:', selfLoops, selfLoops === 0 ? '✓' : '✗');

// 4. 检查无重复边 (多重边)
const seen = new Set();
let dups = 0;
for (const [p, q] of ctrl.edges) {
  const k = p + '->' + q;
  if (seen.has(k)) dups++;
  seen.add(k);
}
console.log('[4] 重复边数量:', dups, dups === 0 ? '✓' : '✗');

// 5. 检查拓扑确实变了 (有多少条边保持原样)
const origSet = new Set(graph.edges.map(([p,q])=>p+'->'+q));
let preserved = 0;
for (const [p,q] of ctrl.edges) if (origSet.has(p+'->'+q)) preserved++;
console.log(`[5] 保留原拓扑的边: ${preserved} / ${ctrl.edges.length} (${(preserved/ctrl.edges.length*100).toFixed(1)}%)`);
console.log('    → 越低说明重连越彻底; 太高说明交换次数不足');

// 6. 检查 weights 输入/输出细胞是否仍是同一批
console.log('\n[6] inputs 一致:', JSON.stringify(graph.inputs) === JSON.stringify(ctrl.inputs) ? '✓' : '✗');
console.log('    outputs 一致:', JSON.stringify(graph.outputs) === JSON.stringify(ctrl.outputs) ? '✓' : '✗');

// 7. 检查可复现性
const ctrl2 = createMatchedControlGraph(graph, 42);
console.log('[7] 同种子可复现:', JSON.stringify(ctrl.edges) === JSON.stringify(ctrl2.edges) ? '✓' : '✗');
const ctrl3 = createMatchedControlGraph(graph, 99);
console.log('    不同种子有差异:', JSON.stringify(ctrl.edges) !== JSON.stringify(ctrl3.edges) ? '✓' : '✗');
