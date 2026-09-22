// 校验 i18n：
//  1) 新加的键必须在 zh / en 两个 block 里各出现一次
//  2) 页面与代码里引用的每个键，必须能被 t() 解析出非空、且不等于键名本身
//     （直接 import 真模块，不靠正则猜）
import fs from 'node:fs';
import { t } from '../src/i18n.js';

const src = fs.readFileSync('src/i18n.js', 'utf8');
const NEW_KEYS = [
  'plasticity', 'plasticity_title', 'plasticity_off', 'plasticity_low', 'plasticity_mid',
  'net_plasticity_on', 'net_plasticity_off',
  'dataset_title', 'ds_v1', 'ds_v600', 'ds_v600a', 'ds_v600b',
  'brain_80', 'brain_600', 'brain_600a', 'brain_600b',
  'net_title', 'tbl_baseline', 'tbl_significance', 'row_silenced_desc',
];

let bad = 0;
for (const k of NEW_KEYS) {
  const n = (src.match(new RegExp(`\\n\\s+${k}:`, 'g')) || []).length;
  if (n !== 2) { bad++; console.log(` ✗ ${k} 出现 ${n} 次（应为 2：zh + en）`); }
}
console.log(`双语键成对检查：${NEW_KEYS.length - bad}/${NEW_KEYS.length} 通过`);

// 收集被引用的完整键名
const used = new Set();
const html = fs.readFileSync('index.html', 'utf8');
for (const m of html.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)) used.add(m[1]);
const app = fs.readFileSync('src/app.js', 'utf8');
// 只认真正的 t('key')：前面不能是字母/数字/_/$/. （排除 createElement('li') 之类）
for (const m of app.matchAll(/(?:^|[^A-Za-z0-9_$.])t\(\s*'([a-z0-9]+\.[A-Za-z0-9_]+)'/g)) used.add(m[1]);

const broken = [];
for (const key of used) {
  const zh = t(key, 'zh'), en = t(key, 'en');
  if (!zh || !en || zh === key || en === key) broken.push(key);
}
console.log(`被引用键 ${used.size} 个，解析失败 ${broken.length} 个`);
broken.forEach(k => console.log('   ✗ ' + k));

// 抽查新文案在两种语言下的实际渲染
console.log('\n实际渲染抽查：');
for (const k of ['toolbar.plasticity', 'toolbar.plasticity_off', 'toolbar.plasticity_low',
  'panel.ds_v1', 'panel.ds_v600a', 'panel.brain_600a', 'panel.net_title',
  'train.tbl_baseline', 'train.row_silenced_desc']) {
  console.log(`   ${k.padEnd(28)} zh="${t(k, 'zh')}"  en="${t(k, 'en')}"`);
}
console.log(bad === 0 && broken.length === 0 ? '\n✅ i18n 校验通过' : '\n❌ 有问题');
