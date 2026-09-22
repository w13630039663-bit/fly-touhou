/**
 * 验证根因：trained / silenced / random 是否退化为"固定方向狂奔"
 * 并测量：若禁用策略退化，真实避弹水平是多少
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
function fwd(weights, dn) {
  const h = new Float64Array(16); let k = 0;
  for (let i = 0; i < 16; i++) { let s = 0; for (let j = 0; j < 16; j++) s += weights[k++] * dn[j]; h[i] = Math.tanh(s + weights[k++]); }
  const sc = new Float64Array(4);
  for (let a = 0; a < 4; a++) { let s = 0; for (let i = 0; i < 16; i++) s += weights[k++] * h[i]; sc[a] = s + weights[k++]; }
  return { moveX: Math.tanh(sc[1] - sc[0]), moveY: Math.tanh(sc[3] - sc[2]), sc, k };
}

class Sim {
  constructor(seed) {
    this.seed = seed; this.width = 520; this.height = 700;
    this.player = { x: this.width / 2, y: this.height * 0.8, speed: 3.6, radius: 4.0 };
    this.bullets = []; this.frame = 0; this.grazeCount = 0;
  }
  nextRandom() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  spawnBullets() {
    const f = this.frame; const bx = this.width/2 + Math.sin(f*0.025)*160; const by = 90;
    if (f % 20 === 0) { for (let i=0;i<12;i++){ const a=f*0.08+(i/12)*Math.PI*2; this.bullets.push({x:bx,y:by,vx:Math.cos(a)*2.4,vy:Math.sin(a)*2.4,radius:4.5,grazed:false}); } }
    if (f % 45 === 0) { const dx=this.player.x-bx, dy=this.player.y-by, ang=Math.atan2(dy,dx); for(let sp=-1;sp<=1;sp++){const a=ang+sp*0.12; this.bullets.push({x:bx,y:by,vx:Math.cos(a)*3.2,vy:Math.sin(a)*3.2,radius:5,grazed:false});} }
    if (f % 28 === 0) { const rx=50+this.nextRandom()*(this.width-100); this.bullets.push({x:rx,y:40,vx:(this.nextRandom()-0.5)*0.6,vy:2.6+this.nextRandom()*1.0,radius:4.5,grazed:false}); }
  }
  getObservations() {
    const px=this.player.x, py=this.player.y, md=220;
    let ft=0,lt=0,rt=0,rr=0,vxs=0,vys=0,vc=0;
    for (const b of this.bullets) { const dx=b.x-px, dy=b.y-py, d=Math.sqrt(dx*dx+dy*dy);
      if (d<md&&d>0.1){vc++;const pr=1-d/md;vxs+=b.vx;vys+=b.vy;const ap=-(dx*b.vx+dy*b.vy)/d;const lo=ap>0?pr*1.2:pr*0.6;
        if(dy<0&&Math.abs(dx)<45&&lo>ft)ft=lo; if(dx<0&&d<180){if(lo>lt)lt=lo;}else if(dx>0&&d<180){if(lo>rt)rt=lo;} if(dy>0&&d<140&&lo>rr)rr=lo; } }
    const mvx=vc>0?vxs/vc:0, mvy=vc>0?vys/vc:0;
    return [Math.min(1,Math.max(0,ft)),Math.min(1,Math.max(0,lt)),Math.min(1,Math.max(0,rt)),Math.min(1,Math.max(0,rr)),Math.max(0,Math.min(1,(mvx+3)/6)),Math.max(0,Math.min(1,mvy/4)),Math.min(1,Math.abs(px-this.width/2)/(this.width/2)),Math.max(0,Math.min(1,(this.height-py)/this.height))];
  }
  step(mx, my) {
    this.frame++; this.spawnBullets();
    this.player.x += mx*this.player.speed; this.player.y += my*this.player.speed;
    this.player.x = Math.max(20, Math.min(this.width-20, this.player.x));
    this.player.y = Math.max(20, Math.min(this.height-20, this.player.y));
    for (let i=this.bullets.length-1;i>=0;i--){const b=this.bullets[i];b.x+=b.vx;b.y+=b.vy;
      const dx=b.x-this.player.x, dy=b.y-this.player.y, d2=dx*dx+dy*dy;
      if(!b.grazed&&d2<324&&d2>16){b.grazed=true;this.grazeCount++;}
      const hd=b.radius+this.player.radius;
      if(d2<hd*hd) return {dead:true,frame:this.frame};
      if(b.y>this.height+30||b.y<-30||b.x<-30||b.x>this.width+30)this.bullets.splice(i,1);}
    return {dead:false,frame:this.frame};
  }
}

const brain = new Brain();

console.log('=== 验证1：策略输出是否与大脑无关？ ===');
{
  const outs = [];
  brain.reset();
  for (let t = 0; t < 5; t++) {
    const dn = new Array(16).fill(0);
    const m = fwd(W, dn);
    outs.push(`${m.moveX.toFixed(4)},${m.moveY.toFixed(4)}`);
  }
  console.log(`  输入零向量 5 次: ${outs.join(' | ')}`);
  console.log(`  -> ${new Set(outs).size === 1 ? '❌ 完全恒定，策略退化为常数' : '✓ 有变化'}`);
}

console.log('\n=== 验证2：消融对照是否可区分？ ===');
{
  const testObs = [[0,0,0,0,0.5,0,0.5,0.2],[0.9,0.8,0.7,0.3,0.4,0.6,0.5,0.1],[0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5]];
  const rw = new Float64Array(340).map(() => (Math.random()-0.5)*0.8);
  for (const [name, weights, ablate] of [['trained', W, false], ['silenced', W, true], ['random', rw, false]]) {
    const outs = testObs.map(obs => {
      brain.reset();
      const dn = brain.step(obs, ablate);
      const m = fwd(weights, dn);
      return `${m.moveX.toFixed(3)},${m.moveY.toFixed(3)}`;
    });
    console.log(`  ${name.padEnd(9)}: ${outs.join(' | ')}`);
  }
}

console.log('\n=== 验证3：真实全弹幕对抗（20局 x 1800帧上限）===');
{
  const rw = new Float64Array(340).map(() => (Math.random()-0.5)*0.8);
  const modes = [['trained', W, false], ['silenced', W, true], ['random', rw, false], ['idle-only', null, false]];
  for (const [name, weights, ablate] of modes) {
    let tf=0, tg=0, capped=0, deathFrames=[];
    for (let i = 0; i < 20; i++) {
      brain.reset();
      const sim = new Sim(80001 + i);
      let deadAt = 0;
      while (sim.frame < 1800) {
        let mx = 0, my = 0;
        if (weights) { const obs = sim.getObservations(); const dn = brain.step(obs, ablate); const m = fwd(weights, dn); mx = m.moveX; my = m.moveY; }
        const r = sim.step(mx, my);
        if (r.dead) { deadAt = sim.frame; break; }
      }
      tf += sim.frame; tg += sim.grazeCount;
      if (sim.frame >= 1800) capped++;
      deathFrames.push(deadAt || 1800);
    }
    console.log(`  ${name.padEnd(10)}: 平均存活 ${(tf/20).toFixed(1)}帧 (${(tf/20/60).toFixed(2)}s) | 平均擦弹 ${(tg/20).toFixed(1)} | 打满 ${capped}/20 | 死亡帧中位数 ${deathFrames.sort((a,b)=>a-b)[10]}`);
  }
}

console.log('\n=== 验证4：策略"真实学习能力"——固定方向基线对比 ===');
{
  // 测试几个固定方向常数策略，看能不能比 trained 好
  const dirs = [[0,0],[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1],[0.707,-0.707],[-0.707,-0.707]];
  for (const [dx,dy] of dirs) {
    let tf = 0, capped = 0;
    for (let i = 0; i < 20; i++) {
      const sim = new Sim(80001 + i);
      while (sim.frame < 1800) { const r = sim.step(dx, dy); if (r.dead) break; }
      tf += sim.frame; if (sim.frame >= 1800) capped++;
    }
    console.log(`  固定方向(${dx.toFixed(3)},${dy.toFixed(3)}): 平均 ${(tf/20).toFixed(1)}帧 (${(tf/20/60).toFixed(2)}s) | 打满 ${capped}/20`);
  }
}
