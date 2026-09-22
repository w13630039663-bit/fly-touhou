import { readFileSync } from "fs";
import { DanmakuGame } from "../src/game/danmaku.js";
import { MaleCNSConnectome } from "../src/brain/connectome.js";
import { ReadoutPolicy, PARAMETERS } from "../src/brain/policy.js";
const ROOT = "D:/苍蝇";
const graphData = JSON.parse(readFileSync(ROOT + "/public/data/connectome/graph.json", "utf8"));
const brain = new MaleCNSConnectome(graphData);
const w = new Float64Array(PARAMETERS);
for (let i=0;i<PARAMETERS;i++) w[i]=(Math.random()-0.5)*0.8;
const p = new ReadoutPolicy(w);
const t0 = Date.now();
let n = 0;
for (let k=0;k<20;k++){
  brain.reset();
  const g = new DanmakuGame(null,{width:460,height:580,seed:1000+k});
  g.setSpellcard(k%3); g.player.lives=1; g.player.maxLives=1; g.player.autoRespawn=false;
  let f=0;
  while(!g.player.isDead && f<1200){ g.update(p.forward(brain.step(g.getBiologicalSensoryInput(),false))); f++; }
  n++;
}
console.log("20 局耗时:", (Date.now()-t0), "ms  => 单局", ((Date.now()-t0)/20).toFixed(1), "ms");
