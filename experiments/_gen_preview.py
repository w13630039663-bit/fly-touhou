# -*- coding: utf-8 -*-
"""把 DanmakuGame + HailstormSpellcard 内联成单文件预览页（无需本地服务器）。"""
import os, re

SRC = r'D:\苍蝇\src'
OUT = r'D:\苍蝇\hailstorm_project_preview.html'

def read(p):
    return open(p, encoding='utf-8').read()

hail = read(os.path.join(SRC, 'game', 'spellcards', 'hailstorm.js'))
danm = read(os.path.join(SRC, 'game', 'danmaku.js'))

# 去掉 import / export
hail = hail.replace("export const HAILSTORM_SOURCE", "const HAILSTORM_SOURCE")
hail = hail.replace("export class HailstormSpellcard", "class HailstormSpellcard")
danm = re.sub(r"^import \{ HailstormSpellcard \}.*$", "", danm, flags=re.M)
danm = danm.replace("export class DanmakuGame", "class DanmakuGame")

HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>雹符「Hailstorm」· 移植到 FlyTouhou 项目后的实际渲染</title>
<style>
  :root{--bg:#0b0f1a;--panel:#151d31;--line:#26314f;--txt:#dbe4f5;--dim:#8b9ac0;--ice:#7fd4ff;--ice2:#bfeaff}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1000px 700px at 50% -10%,#16203a 0%,var(--bg) 60%);
       color:var(--txt);font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px}
  .app{max-width:1100px;margin:0 auto;padding:18px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:var(--dim);font-size:12.5px;margin-bottom:14px;line-height:1.7}
  main{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
  .stage{background:#05070d;border:1px solid var(--line);border-radius:10px;padding:8px}
  canvas{display:block;border-radius:6px;background:#0F111A}
  .panel{flex:1;min-width:300px;display:flex;flex-direction:column;gap:12px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
  .card h2{margin:0 0 10px;font-size:12.5px;color:var(--ice);letter-spacing:1px;
           display:flex;align-items:center;gap:8px}
  .card h2::before{content:"";width:3px;height:12px;background:var(--ice);border-radius:2px}
  button{background:#1b2540;color:var(--txt);border:1px solid var(--line);border-radius:7px;
         padding:6px 12px;cursor:pointer;font-size:13px;font-family:inherit}
  button:hover{background:#243255}
  button.primary{background:linear-gradient(180deg,#2b6ea8,#1d4f7d);border-color:#3d8ac4;font-weight:600}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:8px}
  .stat{background:#0e1526;border:1px solid #1e2942;border-radius:7px;padding:6px 9px}
  .stat .k{color:#5f6d92;font-size:10.5px;letter-spacing:.5px}
  .stat .v{font-size:16px;font-weight:600;color:var(--ice2);font-variant-numeric:tabular-nums}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  td{padding:3px 0;color:var(--dim)}
  td:last-child{text-align:right;color:var(--ice2);font-variant-numeric:tabular-nums}
  code{background:#0e1526;padding:1px 5px;border-radius:4px;font-size:11.5px;color:#b9c8e8}
  .warn{background:#2a2013;border:1px solid #5c4520;color:#ffd479;border-radius:7px;
        padding:8px 10px;font-size:12px;line-height:1.65;margin-top:10px}
  .ecl{max-height:260px;overflow:auto;font-family:Consolas,monospace;font-size:11px;line-height:1.6}
  .ecl div{padding:1px 6px;border-radius:4px;white-space:pre;color:#7f8db0}
  .ecl div.cur{background:#1d3a5c;color:#eaf4ff;box-shadow:inset 2px 0 0 var(--ice)}
</style>
</head>
<body>
<div class="app">
  <h1>❄ 雹符「Hailstorm」 — 移植到 FlyTouhou（果蝇连接组）项目后的实际渲染</h1>
  <div class="sub">
    数据来源 <code>th06ST.dat → ecldata2.ecl</code> sub 34（宣言）/ sub 35（弹幕），逐指令还原为 ECL 虚拟机。<br>
    画布 <code>460 × 580</code>（项目 gameCanvas 原始尺寸）；playfield <code>384 × 448</code> 等比缩放 <code>×1.198</code> 居中映射。
  </div>

  <main>
    <div class="stage"><canvas id="cv" width="460" height="580"></canvas></div>
    <aside class="panel">
      <div class="card">
        <h2>控制</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="run" class="primary">▶ 开始</button>
          <button id="pause">⏸ 暂停</button>
          <button id="reset">↺ 重置</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <button id="c0" class="primary">❄ Hailstorm</button>
          <button id="c1">环状漫天符</button>
          <button id="c2">高密自机狙</button>
          <button id="c3">交错螺旋</button>
        </div>
        <div style="margin-top:8px;font-size:12.5px;color:var(--dim)">
          <label>密度 <input id="dens" type="range" min="0.3" max="1.5" step="0.05" value="1" style="width:130px">
          <span id="densv">1.00</span></label>
        </div>
      </div>

      <div class="card">
        <h2>ECL 虚拟机状态</h2>
        <div class="stats">
          <div class="stat"><div class="k">FRAME</div><div class="v" id="sF">0</div></div>
          <div class="stat"><div class="k">WAVE</div><div class="v" id="sW">0</div></div>
          <div class="stat"><div class="k">RING</div><div class="v" id="sR">0</div></div>
          <div class="stat"><div class="k">BULLETS</div><div class="v" id="sB">0</div></div>
          <div class="stat"><div class="k">HITS</div><div class="v" id="sH">0</div></div>
          <div class="stat"><div class="k">GRAZE</div><div class="v" id="sG">0</div></div>
        </div>
        <table style="margin-top:10px">
          <tr><td>每环弹数 num1</td><td id="tN">-</td></tr>
          <tr><td>三层速度 (画布)</td><td id="tS">-</td></tr>
          <tr><td>下落速度</td><td id="tF">-</td></tr>
          <tr><td>累计下落角</td><td id="tA">-</td></tr>
          <tr><td>自适应难度 mult</td><td id="tM">-</td></tr>
        </table>
        <div class="warn" id="w0">
          <b>转向机制（et_extra a=60, b=1）</b>：每颗弹出膛后先按等分布径向飞 60 帧，
          随后<b>整批统一转向</b>为固定角度下落。下落角每环 ±22.5°（波次奇偶决定方向），
          下落速度每波 +0.15（起 1.40）。这就是「雹」——先炸开，再成片斜着落下来。
        </div>
      </div>

      <div class="card">
        <h2>ECL 执行追踪 · sub 35</h2>
        <div class="ecl" id="ecl"></div>
      </div>
    </aside>
  </main>
</div>

<script>
"use strict";
// ====== 内联：HailstormSpellcard ======
__HAIL__
// ====== 内联：DanmakuGame ======
__DANM__
// ====== 驱动 ======
const cv = document.getElementById('cv');
const game = new DanmakuGame(cv, { width: 460, height: 580 });
game.setSpellcard(0);
game.reset();

let running = true, paused = false;
const $ = id => document.getElementById(id);

// ECL 追踪面板
const eclBox = $('ecl');
const ECLP = HAILSTORM_SOURCE.prog;
ECLP.forEach(ins => {
  const d = document.createElement('div');
  d.textContent = '@' + ins.o.toString(16).padStart(4,'0') + '  ' + ins.s.split('//')[0].trim();
  eclBox.appendChild(d);
});
let lastCur = -2;
function syncEcl(){
  const cur = (game.hailstorm && game.hailstorm.curIns) || -1;
  if (cur === lastCur) return;
  lastCur = cur;
  for (let i = 0; i < eclBox.children.length; i++)
    eclBox.children[i].className = (i === cur) ? 'cur' : '';
  if (cur >= 0 && eclBox.children[cur]) {
    const el = eclBox.children[cur];
    if (el.offsetTop < eclBox.scrollTop || el.offsetTop > eclBox.scrollTop + eclBox.clientHeight - 20)
      eclBox.scrollTop = el.offsetTop - eclBox.clientHeight / 2;
  }
}

function step(){
  if (!running || paused) return;
  game.update({ moveX: 0, moveY: 0, focusMode: false });
  game.render();
  syncEcl();
  const hs = game.hailstorm;
  const st = hs.getStatus();
  $('sF').textContent = game.frame;
  $('sW').textContent = st.wave;
  $('sR').textContent = st.ring;
  $('sB').textContent = game.bullets.length;
  $('sH').textContent = game.player.totalHits;
  $('sG').textContent = game.player.graze;
  $('tN').textContent = st.num1 + ' × 3 层';
  const s = hs.s;
  $('tS').textContent = [0,1,2].map(i => (hs.layerSpeed(i,3) * s).toFixed(2)).join(' / ');
  $('tF').textContent = st.fallSpd.toFixed(2) + ' (画布 ' + (st.fallSpd * s).toFixed(2) + ' px/帧)';
  $('tA').textContent = st.fallAngDeg.toFixed(1) + '°';
  $('tM').textContent = game.getDifficultyProgress().mult.toFixed(2) + ' — ' + game.getDifficultyProgress().label;
}
setInterval(step, 1000/60);

$('run').onclick = () => { running = true; paused = false; };
$('pause').onclick = () => { paused = !paused; };
$('reset').onclick = () => { game.reset(); };
[[0,'c0'],[1,'c1'],[2,'c2'],[3,'c3']].forEach(([i,id]) => {
  $(id).onclick = () => {
    game.setSpellcard(i); game.reset();
    [0,1,2,3].forEach(k => $('c'+k).classList.remove('primary'));
    $(id).classList.add('primary');
  };
});
$('dens').oninput = e => {
  game.hailstorm.densityScale = parseFloat(e.target.value);
  $('densv').textContent = parseFloat(e.target.value).toFixed(2);
};
game.render();
</script>
</body>
</html>
"""

HTML = HTML.replace('__HAIL__', hail).replace('__DANM__', danm)
open(OUT, 'w', encoding='utf-8').write(HTML)
print('written', OUT, len(HTML), 'chars')
