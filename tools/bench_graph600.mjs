// bench_graph600.mjs — measure MaleCNSConnectome.step() cost for 80 vs 600 graphs,
// plus bit-exact regression of the typed-array hot loop against the legacy object loop.
import fs from 'fs';
import { MaleCNSConnectome, DYNAMICS } from '../src/brain/connectome.js';

// ---- legacy step for bit-exactness comparison (verbatim old object-property loop) ----
function legacyStep(brain, sensoryInputs) {
  brain.drive.fill(0);
  for (const [cell, channel] of brain.inputs) {
    const val = sensoryInputs[channel] !== undefined ? sensoryInputs[channel] : 0.5;
    brain.drive[cell] = 2.0 * (val - 0.5);
  }
  for (let t = 0; t < DYNAMICS.iterations; t++) {
    brain.scratch.set(brain.drive);
    for (let e = 0; e < brain.edges.length; e++) {
      const edge = brain.edges[e];
      brain.scratch[edge.post] += DYNAMICS.gain * edge.weight * brain.activity[edge.pre];
    }
    for (let i = 0; i < brain.count; i++) {
      const prev = brain.activity[i];
      brain.activity[i] = (1 - DYNAMICS.leak) * prev + DYNAMICS.leak * Math.tanh(brain.scratch[i]);
    }
  }
  return brain.outputs.map((idx) => brain.activity[idx] * DYNAMICS.outputGain);
}

function bitExactCheck(file, label) {
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const a = new MaleCNSConnectome(data);
  const b = new MaleCNSConnectome(JSON.parse(fs.readFileSync(file, 'utf-8')));
  let maxDiff = 0;
  const rngSeq = [];
  for (let i = 0; i < 300; i++) rngSeq.push([(Math.sin(i * 7.3) + 1) / 2, (Math.cos(i * 3.1) + 1) / 2, 0.5, 0.4, 0.6, (Math.sin(i) + 1) / 2, 0.5, 0.5]);
  for (const inp of rngSeq) {
    const outNew = a.step(inp, false);
    const outOld = legacyStep(b, inp);
    for (let i = 0; i < outNew.length; i++) maxDiff = Math.max(maxDiff, Math.abs(outNew[i] - outOld[i]));
  }
  console.log(`${label}: legacy-vs-typed max |ΔDN output| over 300 varied steps = ${maxDiff} ${maxDiff === 0 ? '(BIT-EXACT ✓)' : '(DIVERGES ✗)'}`);
  return maxDiff;
}

function bench(brain, label) {
  const N = Number(process.env.N || 20000);
  const input = [0.7, 0.2, 0.5, 0.4, 0.6, 0.3, 0.5, 0.5];
  for (let i = 0; i < 500; i++) brain.step(input, false);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) brain.step(input, false);
  const us = Number(process.hrtime.bigint() - t0) / 1000 / N;
  console.log(`${label}: nodes=${brain.count} edges=${brain.edges.length} step=${us.toFixed(2)} us/frame (game: ${(us / 16667 * 100).toFixed(2)}% of 60Hz budget)`);
}

const g80 = new MaleCNSConnectome(JSON.parse(fs.readFileSync('public/data/connectome/graph.json', 'utf-8')));
const g600 = new MaleCNSConnectome(JSON.parse(fs.readFileSync('public/data/connectome/graph600.json', 'utf-8')));
const d1 = bitExactCheck('public/data/connectome/graph.json', 'v1-80');
const d2 = bitExactCheck('public/data/connectome/graph600.json', 'v2-600');
bench(g80, 'v1-80');
bench(g600, 'v2-600');
if (d1 !== 0 || d2 !== 0) process.exitCode = 1;
