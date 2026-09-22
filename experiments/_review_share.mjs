// _review_share.mjs — PLAN_520 前提复核: DN 输入"直连份额"到底是多少?
// 按多种可定义口径复算 v1-80 与 v600 的 DN 归一化输入构成。
import fs from 'fs';

const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const g1 = rd('public/data/connectome/graph.json');
const g2 = rd('public/data/connectome/graph600.json');

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function analyze(g, label, v1set, v1edgeKeys) {
  const n = g.nodes.length;
  const totals = new Float64Array(n);
  for (const [pre, post, c] of g.edges) totals[post] += c * Math.abs(g.nodes[pre].sign);

  const inputCells = new Set(g.inputs.map(([cell]) => cell));
  const outs = g.outputs;

  // 每个 DN 的归一化输入来源拆解
  const per = outs.map((o) => ({ dn: o, tot: totals[o], fromV1: 0, fromNew: 0, fromInputDirect: 0, fromV1Edge: 0, contacts: 0, contactsV1: 0 }));
  const idxOf = new Map(outs.map((o, i) => [o, i]));

  for (const [pre, post, c] of g.edges) {
    const i = idxOf.get(post);
    if (i === undefined) continue;
    const w = totals[post] ? (c * g.nodes[pre].sign) / totals[post] : 0;
    const aw = Math.abs(w);
    const r = per[i];
    r.contacts += c;
    if (v1set.has(g.nodes[pre].id)) { r.fromV1 += aw; r.contactsV1 += c; } else { r.fromNew += aw; }
    if (inputCells.has(pre)) r.fromInputDirect += aw;
    if (v1edgeKeys && v1edgeKeys.has(pre + '>' + post)) r.fromV1Edge += aw;
  }

  const shareV1cells = mean(per.map((r) => r.fromV1));       // 来自 v1-80 细胞的权重份额
  const shareNewCells = mean(per.map((r) => r.fromNew));      // 来自 520 新细胞的权重份额
  const shareInputDirect = mean(per.map((r) => r.fromInputDirect)); // 输入->DN 直达份额
  const shareV1Edge = v1edgeKeys ? mean(per.map((r) => r.fromV1Edge)) : null;
  const meanTot = mean(per.map((r) => r.tot));
  const meanContacts = mean(per.map((r) => r.contacts));

  console.log(`\n══ ${label} (${n} 节点 / ${g.edges.length} 边) ══`);
  console.log(`  DN 平均入度(联系人次)      : ${meanContacts.toFixed(0)}`);
  console.log(`  DN 归一化分母 Σcontacts|s| : ${meanTot.toFixed(0)}`);
  console.log(`  份额: 来自 v1-80 细胞      : ${(100 * shareV1cells).toFixed(1)}%`);
  console.log(`  份额: 来自 520 新细胞      : ${(100 * shareNewCells).toFixed(1)}%`);
  console.log(`  份额: 输入细胞->DN 直达    : ${(100 * shareInputDirect).toFixed(1)}%`);
  if (shareV1Edge !== null) console.log(`  份额: 原 v1 同款边(pre,post): ${(100 * shareV1Edge).toFixed(1)}%`);
  return per;
}

const v1ids = new Set(g1.nodes.map((x) => x.id));
const v1edgeKeys = new Set(g1.edges.map(([p, q]) => p + '>' + q));

// v1 里"v1set"就是全集, 份额应=100%; 主要看 v600
analyze(g1, 'v1-80', v1ids, null);
const per2 = analyze(g2, 'v600', v1ids, v1edgeKeys);

console.log('\n--- v600 每个 DN 的"来自 v1 细胞"份额明细 (16 个) ---');
per2.forEach((r, i) => {
  console.log(`  DN#${String(i).padStart(2)} (node idx ${r.dn}): v1份额 ${(100 * r.fromV1).toFixed(1)}%  | 新细胞份额 ${(100 * r.fromNew).toFixed(1)}%  | 入联系 ${r.contacts}`);
});
