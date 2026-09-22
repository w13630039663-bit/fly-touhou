// _review_struct.mjs — 复核 PLAN_520 的结构性承诺
import fs from 'fs';
import crypto from 'crypto';

const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const g1 = rd('public/data/connectome/graph.json');
const g2 = rd('public/data/connectome/graph600.json');
const m2 = rd('public/data/connectome/manifest600.json');

const ck1 = rd('public/data/checkpoint.json');
const ck2 = rd('public/data/checkpoint600.json');

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// 1. sha 链
const realSha = sha256('public/data/connectome/graph600.json');
console.log('== sha 链 ==');
console.log('  graph600.json 实算 sha256 :', realSha);
console.log('  manifest600  声明         :', m2.graphSha256, realSha === m2.graphSha256 ? '✓' : '✗');
console.log('  checkpoint600 声明        :', ck2.topology?.graphSha256, '\n');

// 2. v1 id ⊂ v600 id ?
const id1 = g1.nodes.map((n) => n.id);
const set2 = new Map(g2.nodes.map((n) => [String(n.id), n]));
const missing = id1.filter((id) => !set2.has(String(id)));
console.log('== P0.1 名单可推导性 ==');
console.log(`  v1-80 节点数 = ${id1.length}; v600 节点数 = ${g2.nodes.length}`);
console.log(`  v1 节点在 v600 中缺失数 = ${missing.length} ${missing.length === 0 ? '✓ (80⊂600)' : '✗ ' + missing.slice(0, 5)}`);
const v1idset = new Set(id1.map(String));
const newCells = g2.nodes.filter((n) => !v1idset.has(String(n.id)));
console.log(`  v600 中"新细胞"数 = ${newCells.length} ${newCells.length === 520 ? '✓ (=520)' : '✗'}`);
// 新细胞角色分布
const roleOf = (n) => {
  const g2inputs = new Set(g2.inputs.map(([c]) => c));
  if (g2.outputs.includes(n.idx)) return 'output/DN';
  if (g2inputs.has(n.idx)) return 'input';
  return 'interneuron';
};
const rc = { input: 0, interneuron: 0, 'output/DN': 0 };
newCells.forEach((n) => rc[roleOf(n)]++);
console.log('  新细胞角色分布:', JSON.stringify(rc));

// 3. v1 节点元数据是否逐字节包含于 v600 (byte-for-byte claim)
const keyOf = (n) => JSON.stringify({ id: n.id, type: n.type, sign: n.sign, position: n.position, bodyId: n.bodyId ?? null });
let same = 0, diff = 0;
for (const n of g1.nodes) {
  const m = set2.get(String(n.id));
  if (!m) continue;
  // 只比较共有键
  const keys = Object.keys(n);
  let ok = true;
  for (const k of keys) if (JSON.stringify(n[k]) !== JSON.stringify(m[k])) { ok = false; break; }
  ok ? same++ : diff++;
}
console.log(`  v1 节点在 v600 中同键值逐字段一致 = ${same}/${id1.length} (不一致 ${diff})`);

// 4. 原 v1 边在 v600 中是否全部保留
const e2 = new Set(g2.edges.map(([p, q]) => p + '>' + q));
const kept = g1.edges.filter(([p, q]) => e2.has(p + '>' + q)).length;
console.log(`\n== 边保留 ==`);
console.log(`  v1 1296 条边在 v600 中保留 = ${kept}/1296`);
const e1set = new Set(g1.edges.map(([p,q])=>p+'>'+q));
const newEdges = g2.edges.filter(([p,q])=>!e1set.has(p+'>'+q));
console.log(`  v600 新增边 = ${newEdges.length} (总 ${g2.edges.length})`);
// 新增边中有多少指向 16 个 DN (plan C: 剔除"新→原DN")
const outSet = new Set(g2.outputs);
const newToDN = newEdges.filter(([p, q]) => outSet.has(q));
console.log(`  其中「新→DN」边 = ${newToDN.length} ${newToDN.length===0?'':'← C.1 要剔除的对象'}`);
const preInV1 = newToDN.filter(([p]) => v1idset.has(String(g2.nodes[p].id))).length;
console.log(`  「新→DN」边里, 来自 v1 细胞的(其实非新) = ${preInV1}`);

// 5. 输入通道与 outputs
console.log(`\n== 输入/输出 ==`);
console.log(`  v1  inputs=${g1.inputs.length}, outputs=${g1.outputs.length}`);
console.log(`  v600 inputs=${g2.inputs.length}, outputs=${g2.outputs.length}`);

// 6. checkpoint 作用域
console.log(`\n== checkpoint 守卫 ==`);
console.log('  ck1 version:', ck1.version, '| topology:', ck1.topology ? 'has' : 'NONE(旧格式)');
console.log('  ck2 version:', ck2.version, '| topology:', ck2.topology?.graph, ck2.topology?.neurons, '/', ck2.topology?.edges);
