// 清除 public/data 中被标注 INVALID 的拓扑主张字段。
// 底线：weights 数组与其余字段必须逐字节不变 —— 先做"空改动往返"自检，不通过就直接中止。
import fs from 'node:fs';

const DIR = 'public/data/';
const FILES = ['checkpoint600a.json', 'checkpoint600b.json'];

const VALID_CONTROL = {
  status: 'INVALID 主张已移除 —— 本场对照候选由修复前 train.js 在生物图上评分产出（本文件 controlWeights[0] 与 weights 逐位相同即为铁证）',
  validControlFile: 'public/data/checkpoint600ag.json',
  validControlResult: '唯一有效对照：bio 1386.3f vs ctrl 1397.8f，Δ = −11.5f，配对双侧 bootstrap p = 0.9351 ⇒ 生物拓扑零优势',
  causalClaimStillValid: 'trained ≫ circuitSilenced ≡ idle（行为依赖这颗脑，与拓扑形状无关）',
};

let touched = 0;
for (const name of FILES) {
  const file = DIR + name;
  const original = fs.readFileSync(file, 'utf8');
  const obj = JSON.parse(original);

  // 自检 1：无改动往返必须与原文逐字节相同，否则本脚本会污染无关字段
  if (JSON.stringify(obj, null, 2) !== original) {
    throw new Error(`${name}: 序列化格式与 JSON.stringify(_,2) 不一致，中止以免破坏文件`);
  }

  const removed = [];
  const drop = (holder, key) => {
    if (holder && key in holder) { removed.push(key); delete holder[key]; }
  };

  const bm = obj.benchmark || {};
  for (const k of Object.keys(bm)) {
    if (/^topologyAdvantage/.test(k) || k === 'matchedControl' || k === 'matchedControls') drop(bm, k);
  }
  drop(obj, 'controlWeights');
  drop(obj, 'controlFitness');

  bm.topologyControl = VALID_CONTROL;
  obj.benchmark = bm;
  obj.controlIntegrity = 'INVALID 对照数据已从本文件移除（见 benchmark.topologyControl 指向的有效对照）。bio 冠军权重与 trained/circuitSilenced/idle 基准未受影响。';

  const out = JSON.stringify(obj, null, 2);

  // 自检 2：weights 必须逐位不变
  const weightsOld = JSON.parse(original).weights;
  const weightsNew = JSON.parse(out).weights;
  if (weightsOld.length !== weightsNew.length || weightsOld.some((v, i) => !Object.is(v, weightsNew[i]))) {
    throw new Error(`${name}: weights 被改动，中止`);
  }

  fs.writeFileSync(file, out);
  touched++;
  console.log(`── ${name}`);
  console.log(`   移除 ${removed.length} 个字段: ${removed.join(', ')}`);
  console.log(`   ${original.length} → ${out.length} 字节  | weights ${weightsNew.length} 项逐位不变 ✓`);
}

// 复核：全目录再扫一遍，确认没有残留的可引用"显著"主张
console.log('\n════ 复核：public/data 中仍带 topologyAdvantage* 的文件 ════');
for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(DIR + f, 'utf8'));
  const b = j.benchmark || {};
  const keys = Object.keys(b).filter(k => /^topologyAdvantage/.test(k));
  if (!keys.length) continue;
  const sig = b.topologyAdvantageSignificant;
  const integrity = j.controlIntegrity ? String(j.controlIntegrity).slice(0, 12) : '（无标注）';
  console.log(`   ${f.padEnd(24)} significant=${String(sig).padEnd(5)} integrity=${integrity}  ${b.topologyAdvantageNote ? '· 自带免责说明' : ''}`);
}
console.log(`\n完成：处理 ${touched} 个文件`);
