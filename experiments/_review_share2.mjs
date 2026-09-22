// _review_share2.mjs — 穷举"直连份额"口径, 找 23.4% / 8.5% 的出处; 并核对 v1 DN 入边保留
import fs from 'fs';
const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const g1 = rd('public/data/connectome/graph.json');
const g2 = rd('public/data/connectome/graph600.json');
const id1 = g1.nodes.map((n) => String(n.id));
const id2 = g2.nodes.map((n) => String(n.id));
const v1idset = new Set(id1);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

function totals(g) { const t = new Float64Array(g.nodes.length); for (const [p, q, c] of g.edges) t[q] += c * Math.abs(g.nodes[p].sign); return t; }

function dnIncoming(g, ids, label) {
  const t = totals(g);
  const outSet = new Set(g.outputs);
  const inCells = new Set(g.inputs.map(([c]) => c));
  const origIn = g.inputs.filter(([c]) => v1idset.has(ids[c])).map(([c]) => c);
  const origInSet = new Set(origIn);
  const rows = g.outputs.map((o) => ({ o, cAll: 0, cOrigIn: 0, cV1: 0, cIn: 0, wAll: 0, wOrigIn: 0, wV1: 0 }));
  const idx = new Map(g.outputs.map((o, i) => [o, i]));
  for (const [p, q, c] of g.edges) {
    const i = idx.get(q); if (i === undefined) continue;
    const r = rows[i];
    const w = t[q] ? Math.abs(c * g.nodes[p].sign / t[q]) : 0;
    r.cAll += c; r.wAll += w;
    if (inCells.has(p)) r.cIn += c;
    if (origInSet.has(p)) { r.cOrigIn += c; r.wOrigIn += w; }
    if (v1idset.has(ids[p])) { r.cV1 += c; r.wV1 += w; }
  }
  const s = (f) => (100 * mean(rows.map(f))).toFixed(1) + '%';
  console.log(`\n══ ${label} ══`);
  console.log(`  [按 权重|w|] 原32输入→DN   : ${s((r) => r.wOrigIn / (r.wAll || 1))}`);
  console.log(`  [按 权重|w|] 全部输入→DN   : ${s((r) => r.wV1 / (r.wAll || 1))}  (v1-细胞口径)`);
  console.log(`  [按 联系数] 原32输入→DN     : ${s((r) => r.cOrigIn / (r.cAll || 1))}`);
  console.log(`  [按 联系数] v1-80细胞→DN    : ${s((r) => r.cV1 / (r.cAll || 1))}`);
  console.log(`  [按 联系数] 全部输入→DN     : ${s((r) => r.cIn / (r.cAll || 1))}`);
  console.log(`  DN 平均入边数              : ${mean(rows.map((r) => r.cAll))}`);
  return rows;
}

dnIncoming(g1, id1, 'v1-80');
dnIncoming(g2, id2, 'v600');

// v1 DN 入边在 v600 的保留 (按 body id)
const ek1 = new Set(g1.edges.map(([p, q]) => id1[p] + '>' + id1[q]));
const e2 = new Set(g2.edges.map(([p, q]) => id2[p] + '>' + id2[q]));
const out1 = new Set(g1.outputs);
const v1dnEdges = g1.edges.filter(([, q]) => out1.has(q));
const v1dnKept = v1dnEdges.filter(([p, q]) => e2.has(id1[p] + '>' + id1[q])).length;
console.log(`\n== v1→DN 入边在 v600 的保留 ==`);
console.log(`  v1 中指向 DN 的边 = ${v1dnEdges.length}; 在 v600 仍存在 = ${v1dnKept}`);
// 全部 v1 边丢失情况
console.log(`  v1 全部边 = ${g1.edges.length}; 在 v600 命中 = ${[...ek1].filter((k) => e2.has(k)).length}`);
