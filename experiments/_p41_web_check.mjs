/**
 * _p41_web_check.mjs —— P4-1 网页接入的静态一致性检查（不启动服务、不打开浏览器）
 *
 * 校验：
 *   W1 index.html 里 app.js 引用的新 DOM id 全部存在
 *   W2 i18n 新增键在 zh/en 两套里都存在且非占位
 *   W3 app.js 里用到的 t('...') 键全部可解析
 *   W4 connectome.js 暴露的 P4-1 API 齐备
 *   W5 代码里没有 HTML 模板残留（{n} 之类未插值的占位符出现在最终文案里）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { translations, t } from '../src/i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
const brainJs = fs.readFileSync(path.join(ROOT, 'src/brain/connectome.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? '  ' + detail : ''}`);
  ok ? pass++ : fail++;
};

console.log('='.repeat(78));
console.log('P4-1 网页接入静态检查');
console.log('='.repeat(78));

console.log('\n[W1] index.html 中新增 DOM id');
for (const id of ['btnPlasticityOff', 'btnPlasticityLow', 'btnPlasticityMid', 'labelPlasticityDrift']) {
  check(`#${id} 存在`, html.includes(`id="${id}"`));
}

console.log('\n[W2] i18n 新增键（zh / en 双语齐备）');
const newKeys = ['toolbar.plasticity', 'toolbar.plasticity_title', 'panel.net_plasticity_off', 'panel.net_plasticity_on'];
for (const k of newKeys) {
  const zh = t(k, 'zh'), en = t(k, 'en');
  const okZh = zh !== k && zh !== undefined && String(zh).length > 0;
  const okEn = en !== k && en !== undefined && String(en).length > 0;
  check(`${k}`, okZh && okEn, `zh="${zh}" en="${en}"`);
}

console.log('\n[W3] app.js 里用到的 t() 键全部可解析');
const used = [...appJs.matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1]);
const uniq = [...new Set(used)];
const broken = uniq.filter((k) => {
  const zh = t(k, 'zh');
  return zh === k;   // 未命中会原样返回 key
});
// 允许动态拼接的键（toolbar.radar_* 这类由三元拼出的不会出现在这一步）
console.log(`    发现 ${uniq.length} 个字面量键，未解析 ${broken.length} 个`);
check('无未解析的 t() 键', broken.length === 0, broken.length ? broken.join(', ') : '');
check("app.js 使用 t('panel.net_plasticity_on')", appJs.includes("t('panel.net_plasticity_on')"));

console.log('\n[W4] connectome.js 的 P4-1 API');
for (const api of ['setPlasticity', 'restoreBioWeights', 'measureDrift', 'this.plasticity =']) {
  check(`${api}`, brainJs.includes(api));
}
check('默认关闭（eta=0 ⇒ enabled:false）', brainJs.includes('{ enabled: false, eta: 0, decay: 0, renorm: true }'));
check('eWeightBase 为独立副本', brainJs.includes('this.eWeightBase = new Float64Array(this.eWeight)'));
check('applyDnGains(1,1) 不再共享引用', brainJs.includes('this.eWeight = new Float64Array(this.eWeightBase)'));

console.log('\n[W5] 默认档位一致性（网页默认必须是 OFF）');
const offBtnActive = /id="btnPlasticityOff"[^>]*class="active"/.test(html);
check('btnPlasticityOff 默认带 active 类', offBtnActive);
check('漂移读数默认隐藏', html.includes('id="labelPlasticityDrift"') && /id="labelPlasticityDrift"[^>]*display:\s*none/.test(html));
check('app.js 初始档位 = off', appJs.includes("let plasticityLevel = 'off'"));
check('PLASTICITY_LEVELS.off.eta === 0', /off:\s*\{\s*eta:\s*0,\s*decay:\s*0,\s*renorm:\s*true\s*\}/.test(appJs));

console.log('\n[W6] 可塑性档位与实测标定一致');
for (const eta of ['1e-5', '1e-4']) {
  check(`app.js 含 η=${eta} 档`, appJs.includes(`eta: ${eta}`));
}
check('重生时复位 W（局内可塑分界）', /game\.onRespawn[\s\S]{0,400}?restoreBioWeights\(\)/.test(appJs));
check('重置战场时复位 W', /btnRestart\.addEventListener[\s\S]{0,400}?restoreBioWeights\(\)/.test(appJs));

console.log(`\n${'='.repeat(78)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(78));
process.exit(fail ? 1 : 0);
