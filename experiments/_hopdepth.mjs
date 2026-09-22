// 感觉→运动 最短跳数分布：解释 600 信号衰减的传播结构
import fs from 'fs';
const g1 = JSON.parse(fs.readFileSync('public/data/connectome/graph.json', 'utf8'));
const g2 = JSON.parse(fs.readFileSync('public/data/connectome/graph600.json', 'utf8'));
function depths(g) {
  const adj = new Map();
  for (const e of g.edges) { if (!adj.has(e[0])) adj.set(e[0], []); adj.get(e[0]).push(e[1]); }
  const dist = new Map(); const q = [];
  for (const [cell] of g.inputs) if (!dist.has(cell)) { dist.set(cell, 0); q.push(cell); }
  for (let i = 0; i < q.length; i++) for (const nx of adj.get(q[i]) || []) if (!dist.has(nx)) { dist.set(nx, dist.get(q[i]) + 1); q.push(nx); }
  const ds = g.outputs.map((o) => dist.has(o) ? dist.get(o) : Infinity);
  const fin = ds.filter((d) => d !== Infinity).sort((a, b) => a - b);
  const n = g.nodes.length, m = g.edges.length;
  const indeg = new Array(n).fill(0); for (const e of g.edges) indeg[e[1]] += e[2] || 1;
  const inh = g.nodes.filter((nd) => nd.sign < 0).length;
  return {
    medianHop: fin[Math.floor(fin.length / 2)], maxHop: fin[fin.length - 1],
    hopsLE3: fin.filter((d) => d <= 3).length + '/16', unreachable: ds.length - fin.length,
    meanInDeg: (m / n).toFixed(1), meanInDegOutputs: (g.outputs.reduce((s, o) => s + indeg[o], 0) / 16).toFixed(0),
    inhibPct: (100 * inh / n).toFixed(0) + '%',
  };
}
console.log('v1-80 :', JSON.stringify(depths(g1)));
console.log('v600  :', JSON.stringify(depths(g2)));
