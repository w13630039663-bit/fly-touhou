/**
 * 定位：为何 trained/silenced/random 都能打满 1800 帧
 * 关键怀疑：train.js 评估循环里的 while 条件用 sim.frame < 1800，
 * 但 sim.step 内部 return 的那个 res.dead 被用了……真的吗？
 * 另外：brain.step 在 ablated 时返回全 0 -> forwardPolicy(0向量) 输出可能是常数值
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/connectome/graph.json'), 'utf8'));
const ckpt = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/checkpoint.json'), 'utf8'));
const DYNAMICS = { iterations: 3, leak: 0.7, gain: 1.4, outputGain: 4.0 };
const count = graph.nodes.length;
const totals = new Float64Array(count);
for (const [pre, post, contacts] of graph.edges) totals[post] += contacts * Math.abs(graph.nodes[pre].sign);
const edges = graph.edges.map(([pre, post, c]) => [pre, post, totals[post] ? (c * graph.nodes[pre].sign) / totals[post] : 0]);
const W = new Float64Array(ckpt.weights);

class Brain {
  constructor() { this.a = new Float64Array(count); this.s = new Float64Array(count); this.d = new Float64Array(count); }
  reset() { this.a.fill(0); this.s.fill(0); this.d.fill(0); }
  step(inputs, ablated = false) {
    if (ablated) { this.a.fill(0); return graph.outputs.map(() => 0); }
    this.d.fill(0);
    for (const [cell, ch] of graph.inputs) this.d[cell] = 2.0 * (inputs[ch] - 0.5);
    for (let t = 0; t < DYNAMICS.iterations; t++) {
      this.s.set(this.d);
      for (let e = 0; e < edges.length; e++) { const [p, q, w] = edges[e]; this.s[q] += DYNAMICS.gain * w * this.a[p]; }
      for (let i = 0; i < count; i++) this.a[i] = (1 - DYNAMICS.leak) * this.a[i] + DYNAMICS.leak * Math.tanh(this.s[i]);
    }
    return graph.outputs.map((i) => this.a[i] * DYNAMICS.outputGain);
  }
}
function fwd(dn) {
  const h = new Float64Array(16); let k = 0;
  for (let i = 0; i < 16; i++) { let s = 0; for (let j = 0; j < 16; j++) s += W[k++] * dn[j]; h[i] = Math.tanh(s + W[k++]); }
  const sc = new Float64Array(4);
  for (let a = 0; a < 4; a++) { let s = 0; for (let i = 0; i < 16; i++) s += W[k++] * h[i]; sc[a] = s + W[k++]; }
  return { moveX: Math.tanh(sc[1] - sc[0]), moveY: Math.tanh(sc[3] - sc[2]), sc };
}

const brain = new Brain();

console.log('=== 关键检查1：静音时 forwardPolicy 输出什么？ ===');
{
  brain.reset();
  const dn = brain.step(new Array(8).fill(0.5), true);
  const m = fwd(dn);
  console.log(`  静音时 DN 输出全零 -> moveX=${m.moveX.toFixed(6)}, moveY=${m.moveY.toFixed(6)}, scores=[${Array.from(m.sc).map(v=>v.toFixed(3))}]`);
}

console.log('\n=== 关键检查2：trained 模式下 moveX/moveY 的实际范围与均值 ===');
{
  brain.reset();
  let sumX = 0, sumY = 0, n = 0, minX = 9, maxX = -9, minY = 9, maxY = -9, staticFrames = 0;
  const sim = new (class { })();
  // 用简化 sim 跑
  const S = { seed: 1, width: 520, height: 700, player: { x: 260, y: 560, speed: 3.6, radius: 4 }, bullets: [], frame: 0,
    nextRandom() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; } };
  while (S.frame < 600) {
    // obs 简化：全 0.5（因为我们要看的是策略在"无信息"时的输出）
    const obs = new Array(8).fill(0.5);
    const dn = brain.step(obs, false);
    const m = fwd(dn);
    sumX += m.moveX; sumY += m.moveY; n++;
    minX = Math.min(minX, m.moveX); maxX = Math.max(maxX, m.moveX);
    minY = Math.min(minY, m.moveY); maxY = Math.max(maxY, m.moveY);
    if (Math.abs(m.moveX) < 1e-9 && Math.abs(m.moveY) < 1e-9) staticFrames++;
    S.frame++;
  }
  console.log(`  恒定 obs=0.5 时: moveX 范围 [${minX.toFixed(4)}, ${maxX.toFixed(4)}] 均值 ${(sumX/n).toFixed(4)}`);
  console.log(`                   moveY 范围 [${minY.toFixed(4)}, ${maxY.toFixed(4)}] 均值 ${(sumY/n).toFixed(4)}`);
  console.log(`  完全静止帧数: ${staticFrames}/${n}`);
}

console.log('\n=== 关键检查3：obs=0.5 恒定输入时 80 神经元活动 ===');
{
  brain.reset();
  const dn = brain.step(new Array(8).fill(0.5), false);
  console.log(`  drive 全 0 时 DN 输出: [${Array.from(dn).map(v=>v.toFixed(4)).join(', ')}]`);
  let active = 0;
  for (let i = 0; i < count; i++) if (Math.abs(brain.a[i]) > 1e-6) active++;
  console.log(`  有非零活动的神经元: ${active}/80`);
}

console.log('\n=== 关键检查4：真实弹幕下 trained 的实际动作序列 (种子80001) ===');
{
  const S = { seed: 80001, width: 520, height: 700, player: { x: 260, y: 560, speed: 3.6, radius: 4 }, bullets: [], frame: 0, grazeCount: 0,
    nextRandom() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; } };
  function spawn() {
    const f = S.frame; const bx = S.width/2 + Math.sin(f*0.025)*160; const by = 90;
    if (f % 20 === 0) { for (let i=0;i<12;i++){ const a=f*0.08+(i/12)*Math.PI*2; S.bullets.push({x:bx,y:by,vx:Math.cos(a)*2.4,vy:Math.sin(a)*2.4,radius:4.5,grazed:false}); } }
    if (f % 45 === 0) { const dx=S.player.x-bx, dy=S.player.y-by, ang=Math.atan2(dy,dx); for(let sp=-1;sp<=1;sp++){const a=ang+sp*0.12; S.bullets.push({x:bx,y:by,vx:Math.cos(a)*3.2,vy:Math.sin(a)*3.2,radius:5,grazed:false});} }
    if (f % 28 === 0) { const rx=50+S.nextRandom()*(S.width-100); S.bullets.push({x:rx,y:40,vx:(S.nextRandom()-0.5)*0.6,vy:2.6+S.nextRandom()*1.0,radius:4.5,grazed:false}); }
  }
  function obs8() {
    const px=S.player.x, py=S.player.y, md=220;
    let ft=0,lt=0,rt=0,rr=0,vxs=0,vys=0,vc=0;
    for (const b of S.bullets) { const dx=b.x-px, dy=b.y-py, d=Math.sqrt(dx*dx+dy*dy);
      if (d<md&&d>0.1){vc++;const px2=1-d/md;vxs+=b.vx;vys+=b.vy;const ap=-(dx*b.vx+dy*b.vy)/d;const lo=ap>0?px2*1.2:px2*0.6;
        if(dy<0&&Math.abs(dx)<45&&lo>ft)ft=lo; if(dx<0&&d<180){if(lo>lt)lt=lo;}else if(dx>0&&d<180){if(lo>rt)rt=lo;} if(dy>0&&d<140&&lo>rr)rr=lo; } }
    const mvx=vc>0?vxs/vc:0, mvy=vc>0?vys/vc:0;
    return [Math.min(1,Math.max(0,ft)),Math.min(1,Math.max(0,lt)),Math.min(1,Math.max(0,rt)),Math.min(1,Math.max(0,rr)),Math.max(0,Math.min(1,(mvx+3)/6)),Math.max(0,Math.min(1,mvy/4)),Math.min(1,Math.abs(px-S.width/2)/(S.width/2)),Math.max(0,Math.min(1,(S.height-py)/S.height))];
  }
  brain.reset();
  const samples = [];
  for (let f = 0; f < 900; f++) {
    S.frame++; spawn();
    const obs = obs8();
    const dn = brain.step(obs, false);
    const m = fwd(dn);
    if (f % 100 === 0) samples.push({ f, obs: obs.map(v=>v.toFixed(2)).join(','), mx: m.moveX.toFixed(3), my: m.moveY.toFixed(3) });
    S.player.x += m.moveX * 3.6; S.player.y += m.moveY * 3.6;
    S.player.x = Math.max(20, Math.min(500, S.player.x)); S.player.y = Math.max(20, Math.min(680, S.player.y));
    for (let i=S.bullets.length-1;i>=0;i--){const b=S.bullets[i];b.x+=b.vx;b.y+=b.vy;
      if(b.y>730||b.y<-30||b.x<-30||b.x>550)S.bullets.splice(i,1);}
  }
  console.log('  帧 | obs(8通道) | moveX | moveY');
  for (const s of samples) console.log(`  ${String(s.f).padStart(3)} | ${s.obs} | ${s.mx} | ${s.my}`);
}
