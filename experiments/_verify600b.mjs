/**
 * _verify600b.mjs — 血缘深挖（按节点 ID 对账，修正索引 vs ID 的混淆）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (p) => path.join(ROOT, p);
const readJson = (p) => JSON.parse(fs.readFileSync(P(p), 'utf8'));

const g80 = readJson('public/data/connectome/graph.json');
const g600 = readJson('public/data/connectome/graph600.json');
const m80 = readJson('public/data/connectome/manifest.json');

const N80 = g80.nodes, N600 = g600.nodes;
const id80toIdx600 = new Map(N600.map((n, i) => [String(n.id), i]));

console.log('v1 version:', g80.version, '| v2 version:', g600.version);
console.log('v1 manifest:', JSON.stringify({ nodes: m80.nodes, edges: m80.edges, inp: m80.inputCells, out: m80.readoutCells, sha: m80.graphSha256?.slice(0, 12) }));

// ── 1. outputs 按 ID 对账 ──
const out80ids = g80.outputs.map(i => String(N80[i].id));
const out600ids = g600.outputs.map(i => String(N600[i].id));
console.log('\n[1] 输出神经元 (DN) 对账');
console.log('  v1 (local idx -> id):', g80.outputs.map((i, k) => `${i}->${N80[i].id}`).join(' '));
console.log('  v2 (global idx -> id):', g600.outputs.map((i, k) => `${i}->${N600[i].id}`).join(' '));
const s80 = [...out80ids].sort(), s600 = [...out600ids].sort();
console.log('  v1 id 集合排序:', s80.join(','));
console.log('  v2 id 集合排序:', s600.join(','));
console.log('  → 集合相同 ?', JSON.stringify(s80) === JSON.stringify(s600));
console.log('  → 顺序相同 ?', JSON.stringify(out80ids) === JSON.stringify(out600ids));
// 位置是否保持 v1 顺序
const posIn600 = out80ids.map(id => g600.outputs.indexOf(id80toIdx600.get(id)));
console.log('  v1 各 DN 在 v2 outputs 中的下标:', posIn600.join(','));

// ── 2. inputs 按 ID 对账 ──
console.log('\n[2] 输入细胞对账');
const in80 = g80.inputs.map(([i, ch]) => ({ id: String(N80[i].id), ch, local: i }));
const in600 = g600.inputs.map(([i, ch]) => ({ id: String(N600[i].id), ch, global: i }));
console.log(`  v1 inputs 数: ${in80.length}, v2 inputs 数: ${in600.length}`);
console.log('  v1 前 8 个 (id,channel):', in80.slice(0, 8).map(x => `${x.id}@${x.ch}`).join(' '));
console.log('  v2 前 8 个 (id,channel):', in600.slice(0, 8).map(x => `${x.id}@${x.ch}`).join(' '));
const set80 = new Set(in80.map(x => x.id));
const map600 = new Map(in600.map(x => [x.id, x.ch]));
const inShared = [...set80].filter(id => map600.has(id));
console.log(`  v1 输入 id 落在 v2 输入集内: ${inShared.length}/${set80.size}`);
const notIn = [...set80].filter(id => !map600.has(id));
if (notIn.length) {
  console.log('  未纳入 v2 输入的 v1 输入细胞:', notIn.join(',').slice(0, 400));
  console.log('  这些细胞在 v2 中的角色（是否有入/出边）:');
  const inDeg = new Map(), outDeg = new Map();
  for (const [a, b] of g600.edges) { outDeg.set(a, (outDeg.get(a) || 0) + 1); inDeg.set(b, (inDeg.get(b) || 0) + 1); }
  for (const id of notIn.slice(0, 10)) {
    const gi = id80toIdx600.get(id);
    console.log(`    ${id}: in=${inDeg.get(gi) || 0} out=${outDeg.get(gi) || 0}`);
  }
}
// 频道映射是否一致
let chMismatch = 0;
for (const x of in80) { const c = map600.get(x.id); if (c !== undefined && c !== x.ch) chMismatch++; }
console.log('  同名输入细胞的 channel 不一致数:', chMismatch);

// ── 3. 节点元数据 byte-for-byte ──
console.log('\n[3] 节点元数据一致性（v1 的 80 个节点 vs v2 中同 ID 节点）');
const fields = Object.keys(N80[0]);
console.log('  节点字段:', fields.join(','));
let metaDiff = [];
for (let i = 0; i < N80.length; i++) {
  const a = N80[i], b = N600[id80toIdx600.get(String(a.id))];
  if (JSON.stringify(a) !== JSON.stringify(b)) metaDiff.push(a.id);
}
console.log(`  完全相同的节点: ${N80.length - metaDiff.length}/${N80.length}`);
if (metaDiff.length) console.log(`  有差异的节点 ID: ${metaDiff.slice(0, 20).join(',')}${metaDiff.length > 20 ? ' ...' : ''}`);
console.log('  v1[0] =', JSON.stringify(N80[0]));
console.log('  v2 同 ID =', JSON.stringify(N600[id80toIdx600.get(String(N80[0].id))]));

// ── 4. 边对账 ──
console.log('\n[4] 边对账（v1 的 1296 边 vs v2 在同样 80 节点上的诱导边）');
const v1e = new Set(g80.edges.map(([a, b]) => `${a}->${b}`));
const v1contacts = new Map(g80.edges.map(([a, b, c]) => [`${a}->${b}`, c]));
const v600on80 = new Map();
for (const [a, b, c] of g600.edges) {
  const ia = id80toIdx600.get(String(N600[a].id)), ib = id80toIdx600.get(String(N600[b].id));
  if (ia === undefined || ib === undefined) continue;
  if (ia >= 80 || ib >= 80) continue;
  // 该边是否 v1 也认为存在（按 id 对）
  v600on80.set(`${N600[a].id}->${N600[b].id}`, c);
}
const v1eById = new Map();
for (const [a, b, c] of g80.edges) v1eById.set(`${N80[a].id}->${N80[b].id}`, c);

let onlyV1 = [], onlyV2 = [], bothSame = 0, bothDiff = [];
for (const [k, c] of v1eById) {
  if (v600on80.has(k)) { if (v600on80.get(k) === c) bothSame++; else bothDiff.push([k, c, v600on80.get(k)]); }
  else onlyV1.push([k, c]);
}
for (const [k, c] of v600on80) if (!v1eById.has(k)) onlyV2.push([k, c]);
console.log(`  v1 边数 ${v1eById.size} | v2 在同 80 节点上的诱导边数 ${v600on80.size}`);
console.log(`  完全一致(contacts 相同): ${bothSame}`);
console.log(`  同边但 contacts 不同:     ${bothDiff.length}` + (bothDiff.length ? `  例: ${bothDiff.slice(0, 5).map(x => `${x[0]} v1=${x[1]} v2=${x[2]}`).join(' | ')}` : ''));
console.log(`  仅 v1 有: ${onlyV1.length}` + (onlyV1.length ? `  contacts 分布: min=${Math.min(...onlyV1.map(x => x[1]))} max=${Math.max(...onlyV1.map(x => x[1]))}` : ''));
console.log(`  仅 v2 有: ${onlyV2.length}` + (onlyV2.length ? `  contacts 分布: min=${Math.min(...onlyV2.map(x => x[1]))} max=${Math.max(...onlyV2.map(x => x[1]))}` : ''));

// ── 5. v2 的 520 个新节点：类型来源 ──
console.log('\n[5] v2 新增的 520 个节点');
const newIdx = [];
for (let i = 0; i < 600; i++) if (!g80.nodes.some(n => String(n.id) === String(N600[i].id))) newIdx.push(i);
console.log(`  新增节点数: ${newIdx.length}`);
const sup = {};
for (const i of newIdx) sup[N600[i].superclass || N600[i].type] = (sup[N600[i].superclass || N600[i].type] || 0) + 1;
console.log('  新增节点 superclass 分布:', JSON.stringify(sup));
console.log('  样例:', newIdx.slice(0, 3).map(i => JSON.stringify(N600[i])).join('\n         '));
