// experiments/_verify_review.mjs — 复核评审报告的 4 个硬断言
import fs from 'fs';
const g1 = JSON.parse(fs.readFileSync('public/data/connectome/graph.json', 'utf8'));
const g2 = JSON.parse(fs.readFileSync('public/data/connectome/graph600.json', 'utf8'));
const id1 = new Set(g1.nodes.map((n) => n.id));
const id2idx = new Map(g2.nodes.map((n, i) => [n.id, i]));

// 断言1: v1 的 1296 条边在 v600 里只剩 ~846（450 条被 ≥3 contacts 阈值裁掉）
const key = (a, b) => a + '>' + b;
const set2 = new Set(g2.edges.map((e) => {
  const a = g2.nodes[e[0]].id, b = g2.nodes[e[1]].id;
  return (id1.has(a) && id1.has(b)) ? key(a, b) : null;
}));
let kept = 0, lost = [];
for (const e of g1.edges) { const a = g1.nodes[e[0]].id, b = g1.nodes[e[1]].id; if (set2.has(key(a, b))) kept++; else lost.push(e[2]); }
console.log(`[1] v1边 ${g1.edges.length} 条 → v600 中保留 ${kept}，被裁 ${lost.length}（contacts分布: <3 的 ${lost.filter((c) => c < 3).length} 条）`);

// 断言2: 520 新细胞 = 24 输入 + 496 中间
const roleOf = (n) => n.role || 'interneuron';
const newCells = g2.nodes.filter((n) => !id1.has(n.id));
const ri = newCells.filter((n) => roleOf(n) === 'input').length;
const ro = newCells.filter((n) => roleOf(n) === 'output').length;
console.log(`[2] 新细胞 ${newCells.length} = input ${ri} + output ${ro} + interneuron ${newCells.length - ri - ro}`);
console.log(`    v1 roles: input ${g1.nodes.filter((n) => roleOf(n) === 'input').length} / output ${g1.nodes.filter((n) => roleOf(n) === 'output').length}`);
console.log(`    v600 inputs 对: ${g1.inputs.length} → ${g2.inputs.length}`);

// 断言3: 直连份额口径复算（contacts 加权 vs 边数）
function share(g) {
  const inCells = new Set(g.inputs.map((p) => p[0]));
  const outSet = new Set(g.outputs);
  let cw = 0, ct = 0, ew = 0, et = 0;
  for (const e of g.edges) if (outSet.has(e[1])) {
    ct += e[2]; et++; if (inCells.has(e[0])) { cw += e[2]; ew++; }
  }
  return { contactsPct: (100 * cw / ct).toFixed(1) + '%', edgeCountPct: (100 * ew / et).toFixed(1) + '%' };
}
console.log(`[3] 直连份额 v1: ${JSON.stringify(share(g1))}  v600: ${JSON.stringify(share(g2))}`);

// 断言4: DN 入边来源拆分（新 vs 原 80）
let fromNew = 0, fromOld = 0;
const outSet = new Set(g2.outputs);
for (const e of g2.edges) if (outSet.has(e[1])) { id1.has(g2.nodes[e[0]].id) ? fromOld++ : fromNew++; }
console.log(`[4] v600 DN 入边: 原80来 ${fromOld} 条 / 新细胞来 ${fromNew} 条（新占 ${(100 * fromNew / (fromNew + fromOld)).toFixed(1)}%）`);
