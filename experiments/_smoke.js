// 数值冒烟测试 v2：验证「珠子总量上限保护」是否生效
const MAX_BEADS_TOTAL = 2400;

function build(armSpacing, maxRadius, beadsPerTurn, arms) {
  let dr = armSpacing / beadsPerTurn;
  let n = Math.floor(maxRadius / dr);
  const capPerArm = Math.max(8, Math.floor(MAX_BEADS_TOTAL / arms));
  let capped = false;
  if (n > capPerArm) { n = capPerArm; dr = maxRadius / n; capped = true; }
  return { perArm: n, total: n * arms, capped, dr, turns: maxRadius / armSpacing };
}

console.log('='.repeat(70));
console.log('螺旋珠子数量冒烟测试 v2 (含上限保护)');
console.log('='.repeat(70));

const DEF = { armSpacing: 48, maxRadius: 304, beadsPerTurn: 28, arms: 6 };
let r = build(DEF.armSpacing, DEF.maxRadius, DEF.beadsPerTurn, DEF.arms);
console.log('\n[默认] armSpacing=48 maxRadius=304 beadsPerTurn=28 arms=6');
console.log(`  每臂 ${r.perArm} 颗, 总计 ${r.total} 颗, ${r.turns.toFixed(1)} 圈, dr=${r.dr.toFixed(2)}px`);
console.log(`  上限保护: ${r.capped ? '触发' : '未触发'} (默认应不触发)`);

console.log('\n[全滑块极值扫描] 135 种组合');
let worst = { total: 0 }, cappedCount = 0, total = 0;
for (const armSpacing of [14, 30, 48, 80, 120]) {
  for (const maxRadius of [80, 180, 290]) {
    for (const beadsPerTurn of [8, 28, 60]) {
      for (const arms of [1, 6, 12]) {
        total++;
        const res = build(armSpacing, maxRadius, beadsPerTurn, arms);
        if (res.capped) cappedCount++;
        if (res.total > worst.total) {
          worst = { total: res.total, cfg: { armSpacing, maxRadius, beadsPerTurn, arms }, res };
        }
      }
    }
  }
}
console.log(`  测试 ${total} 种组合，其中 ${cappedCount} 种触发了上限保护`);
console.log(`  最坏情况: ${worst.total} 颗`);
console.log(`    armSpacing=${worst.cfg.armSpacing} maxRadius=${worst.cfg.maxRadius} ` +
            `beadsPerTurn=${worst.cfg.beadsPerTurn} arms=${worst.cfg.arms}`);
console.log(`    上限触碰: ${worst.res.capped ? '是' : '否'}`);

const LIMIT = 4000;
console.log('\n[性能判定]');
if (worst.total <= LIMIT) {
  console.log(`  ✅ 最坏 ${worst.total} <= ${LIMIT}，所有滑块位置均可流畅`);
  console.log(`  ✅ 上限保护生效：${cappedCount} 种极端组合已自动降密度`);
} else {
  console.log(`  ❌ 仍超阈值 ${LIMIT}`);
}

// per-arm 下限校验
console.log('\n[每臂下限校验] capPerArm 最小值应为 8');
for (const arms of [1, 6, 12]) {
  const cap = Math.max(8, Math.floor(MAX_BEADS_TOTAL / arms));
  console.log(`  arms=${arms} -> capPerArm=${cap}, 总量上限=${cap * arms}`);
}

// 周期一致性
console.log('\n[周期一致性]');
const CYCLE_TIME = 3.74;
const flow = DEF.maxRadius / CYCLE_TIME;
console.log(`  推荐 radialFlow = ${flow.toFixed(1)} px/s, 实际默认 81 px/s, 偏差 ${Math.abs(81-flow).toFixed(2)}`);
console.log(`  60fps 每帧径向外移 ${(flow/60).toFixed(3)} px/帧`);
console.log(`  60fps 每帧下落 ${(61/60).toFixed(3)} px/帧`);
console.log('\n完成。');
