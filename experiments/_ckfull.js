import { readFileSync } from "fs";
const c = JSON.parse(readFileSync("D:/苍蝇/experiments/checkpoint.full.json","utf8"));
const W = c.weights;
let mn=Infinity,mx=-Infinity,s=0,s2=0,nb=0;
for(const w of W){mn=Math.min(mn,w);mx=Math.max(mx,w);s+=w;s2+=w*w;if(Math.abs(w)>1)nb++;}
const mean=s/W.length,std=Math.sqrt(s2/W.length-mean*mean);
console.log("=== 新训练 checkpoint.full.json 权重统计 ===");
console.log("bestFitness:", c.bestFitness, " 代数:", c.generations, " 种子/代:", c.seedsPerGen);
console.log(`min=${mn.toFixed(3)} max=${mx.toFixed(3)} mean=${mean.toFixed(4)} std=${std.toFixed(4)}`);
console.log(`|w|>1.0: ${nb}/${W.length} (${(nb/W.length*100).toFixed(1)}%)`);
console.log("weights 长度:", W.length);
const h = c.history;
console.log("\n=== 适应度曲线(每10代) ===");
for(const p of h.filter(x=>x.gen%10===0||x.gen===1)) console.log(`代${String(p.gen).padStart(3)}: 精英均值 ${p.eliteAvg.toFixed(1)} | 历史最佳 ${p.best.toFixed(1)}`);
