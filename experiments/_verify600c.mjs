/**
 * _verify600c.mjs — 边集差异归因（方向约定？阈值？源表不同？）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const g80 = readJson('public/data/connectome/graph.json');
const g600 = readJson('public/data/connectome/graph600.json');
const N80 = g80.nodes, N600 = g600.nodes;

const idx600of80 = new Map(N600.map((n, i) => [String(n.id), i]));
const isIn80 = new Set(N80.map(n => String(n.id)));

// v1 边（ID 命名空间）
const v1 = new Map();
for (const [a, b, c] of g80.edges) v1.set(`${N80[a].id}->${N80[b].id}`, c);

// v2 在 80 节点上的诱导边（ID 命名空间）
const v2 = new Map();
for (const [a, b, c] of g600.edges) {
  const ka = String(N600[a].id), kb = String(N600[b].id);
  if (isIn80.has(ka) && isIn80.has(kb)) v2.set(`${ka}->${kb}`, c);
}

console.log(`v1 边 ${v1.size} (contacts 合计 ${[...v1.values()].reduce((a, b) => a + b, 0)})`);
console.log(`v2 诱导边 ${v2.size} (contacts 合计 ${[...v2.values()].reduce((a, b) => a + b, 0)})`);

const onlyV1 = [...v1.entries()].filter(([k]) => !v2.has(k));
const onlyV2 = [...v2.entries()].filter(([k]) => !v1.has(k));
const rev = (k) => { const [a, b] = k.split('->'); return `${b}->${a}`; };

let v1RevInV2 = 0;
for (const [k] of onlyV1) if (v2.has(rev(k))) v1RevInV2++;
let v2RevInV1 = 0;
for (const [k] of onlyV2) if (v1.has(rev(k))) v2RevInV1++;
console.log(`\n[方向假设检验]`);
console.log(`  仅 v1 有的 ${onlyV1.length} 条中，反向边存在于 v2 的: ${v1RevInV2}  → 方向约定不同 ? ${v1RevInV2 === onlyV1.length}`);
console.log(`  仅 v2 有的 ${onlyV2.length} 条中，反向边存在于 v1 的: ${v2RevInV1}  → 方向约定不同 ? ${v2RevInV1 === onlyV2.length}`);

console.log(`\n[仅 v1 有的边 — 按 contacts 排序 Top 12]`);
onlyV1.sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, c]) => {
  const [x, y] = k.split('->');
  const xi = N80.findIndex(n => String(n.id) === x), yi = N80.findIndex(n => String(n.id) === y);
  const tyX = N80[xi]?.type, tyY = N80[yi]?.type, ntX = N80[xi]?.nt;
  const gx = idx600of80.get(x), gy = idx600of80.get(y);
  const cyc = v2.get(rev(k));
  console.log(`   ${k}  contacts=${c}  [${tyX}/${ntX} -> ${tyY}]  反向在 v2? ${cyc ? 'YES c=' + cyc : 'no'}`);
});

console.log(`\n[仅 v2 有的边 — 按 contacts 排序 Top 12]`);
onlyV2.sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, c]) => {
  const [x, y] = k.split('->');
  const xi = N600.findIndex(n => String(n.id) === x), yi = N600.findIndex(n => String(n.id) === y);
  console.log(`   ${k}  contacts=${c}  [${N600[xi]?.type} -> ${N600[yi]?.type}]  反向在 v1? ${v1.has(rev(k)) ? 'YES' : 'no'}`);
});

console.log(`\n[contacts 分布对比]`);
const bucket = (arr) => { const b = { '1-2': 0, '3-9': 0, '10-49': 0, '50-199': 0, '200+': 0 }; for (const [, c] of arr) { if (c < 3) b['1-2']++; else if (c < 10) b['3-9']++; else if (c < 50) b['10-49']++; else if (c < 200) b['50-199']++; else b['200+']++; } return b; };
console.log('  仅 v1 有:', JSON.stringify(bucket(onlyV1)));
console.log('  仅 v2 有:', JSON.stringify(bucket(onlyV2)));
console.log('  v1 全体:', JSON.stringify(bucket([...v1.entries()])));
console.log('  v2 全体:', JSON.stringify(bucket([...v2.entries()])));

console.log(`\n[阈值假设检验] v2 声称 "induced directed edges >=3 contacts"`);
const v1lt3 = [...v1.values()].filter(c => c < 3).length;
console.log(`  v1 中 contacts<3 的边: ${v1lt3} 条 → 若 v2 用 >=3 阈值，这部分(≤${v1lt3})应被剔除`);
const v1ge3only = onlyV1.filter(([, c]) => c >= 3).length;
console.log(`  仅 v1 有且 contacts>=3 的边: ${v1ge3only} 条 → 这部分【无法】用阈值解释`);
console.log(`  → 结论: ${v1ge3only > 0 ? '存在无法用 >=3 阈值解释的差异 → 源边表不同 (v1 "edges" vs v2 "edgesTracedOnly")' : '差异可完全由 >=3 阈值 + 方向约定解释'}`);

console.log(`\n[两图 sources 哈希]`);
console.log('  v1 sources:', JSON.stringify(readJson('public/data/connectome/manifest.json').sources));
console.log('  v2 sources:', JSON.stringify(readJson('public/data/connectome/manifest600.json').sources));
