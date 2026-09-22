// _review_struct2.mjs — 修正版: 全部按 body id 对齐, 不用裸索引
import fs from 'fs';

const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const g1 = rd('public/data/connectome/graph.json');
const g2 = rd('public/data/connectome/graph600.json');

const id1 = g1.nodes.map((n) => String(n.id));
const id2 = g2.nodes.map((n) => String(n.id));

// 边键: 用 body id
const ek1 = new Set(g1.edges.map(([p, q]) => id1[p] + '>' + id1[q]));
const g2keys = g2.edges.map(([p, q]) => id2[p] + '>' + id2[q]);
const e2set = new Set(g2keys);

const kept = [...ek1].filter((k) => e2set.has(k)).length;
console.log('== v1 原边在 v600 的保留 (按 body id) ==');
console.log(`  v1 边 = ${g1.edges.length}; 在 v600 中命中 = ${kept} (${(100 * kept / g1.edges.length).toFixed(1)}%)`);
console.log(`  v600 边 = ${g2.edges.length}; 其中属 v1 原有 = ${kept}; 新增 = ${g2.edges.length - kept}`);

// 新→DN 边 (post 为 DN, 且该边键不在 v1 集合)
const outIdx2 = new Set(g2.outputs);
const v1idset = new Set(id1);
const newToDN = [];
for (let i = 0; i < g2.edges.length; i++) {
  const [p, q] = g2.edges[i];
  if (!outIdx2.has(q)) continue;
  if (ek1.has(g2keys[i])) continue; // 是原 v1 边
  newToDN.push([id2[p], id2[q], p, q]);
}
const fromV1cell = newToDN.filter((r) => v1idset.has(r[0])).length;
console.log(`\n== 「新→DN」边 (C.1 要剔除的对象) ==`);
console.log(`  新增且指向 DN 的边 = ${newToDN.length}`);
console.log(`  其中 pre 是 v1 细胞(本就不该算新) = ${fromV1cell}; 真正 pre∈520新细胞 = ${newToDN.length - fromV1cell}`);

// 16 个 DN 的入边来源构成 (按 body id)
console.log(`\n== 16 个 DN 入边构成 (按 body id) ==`);
const inByDN = new Map(g2.outputs.map((o) => [o, { v1: 0, neu: 0, cV1: 0, cNeu: 0 }]));
for (let i = 0; i < g2.edges.length; i++) {
  const [p, q, c] = g2.edges[i];
  if (!inByDN.has(q)) continue;
  const r = inByDN.get(q);
  if (v1idset.has(id2[p])) { r.v1++; r.cV1 += c; } else { r.neu++; r.cNeu += c; }
}
let tv = 0, tn = 0;
inByDN.forEach((r) => { tv += r.v1; tn += r.neu; });
console.log(`  16 个 DN 合计入边: 来自 v1-80 细胞 = ${tv}, 来自 520 新细胞 = ${tn} (新占比 ${(100 * tn / (tv + tn)).toFixed(1)}%)`);

// 输入: g2.inputs 有多少来自 v1-80 / 新细胞
const in2 = g2.inputs.map(([c]) => c);
const inV1 = in2.filter((c) => v1idset.has(id2[c])).length;
console.log(`\n== 输入细胞 ==`);
console.log(`  v1 inputs=32, v600 inputs=${in2.length}`);
console.log(`  v600 输入中, id∈v1-80 = ${inV1}; id∉v1-80(新) = ${in2.length - inV1}`);
console.log(`  → 静音「520 新细胞」会顺带静音 ${in2.length - inV1} 个输入细胞`);

// 新细胞角色 (按 inputs 判定)
const newIdx = g2.nodes.filter((n, i) => !v1idset.has(id2[i]));
const inSet = new Set(in2);
const rc = { input: 0, interneuron: 0, DN: 0 };
newIdx.forEach((n) => { if (outIdx2.has(n.idx)) rc.DN++; else if (inSet.has(n.idx)) rc.input++; else rc.interneuron++; });
console.log(`  520 新细胞角色分布: ${JSON.stringify(rc)}`);
