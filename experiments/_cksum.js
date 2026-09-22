import { readFileSync } from "fs";
const c = JSON.parse(readFileSync("D:/苍蝇/public/data/checkpoint.json","utf8"));
console.log("version:", c.version);
console.log("bestFitness(bio):", c.bestFitness);
console.log("controlFitness:", c.controlFitness);
console.log("weights 长度:", c.weights.length, " controlWeights 长度:", c.controlWeights?.length);
console.log("\n=== 自报 benchmark ===");
for (const [k,v] of Object.entries(c.benchmark)) {
  if (typeof v === "number") { console.log(k + ":", v); continue; }
  console.log(k + ":", "frames=" + v.frames?.toFixed(1), " graze=" + v.graze?.toFixed(1), " avgX=" + v.avgPlayerX?.toFixed(1));
}
