// 用 GitHub Pages 项目页的「子路径」形态跑一遍本项目，提前暴露根绝对路径问题。
//   node tools/serve_subpath.mjs   →   http://localhost:3001/fly-touhou/
// 与 server.js 的区别：server.js 把仓库根当域名根（`/public/...` 恰好能用），
// 这个脚本把所有资源挂在 /fly-touhou/ 前缀下，等同于 Pages 的真实情况。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = '/fly-touhou';
const PORT = 3001;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.gif': 'image/gif',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (!urlPath.startsWith(PREFIX)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — 这个探针服务器只服务 ' + PREFIX + '/ 前缀');
    return;
  }
  let rel = urlPath.slice(PREFIX.length);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    const code = err ? 404 : 200;
    console.log(`${code} ${req.method} ${urlPath}`);
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 ' + rel); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`Pages 子路径探针: http://localhost:${PORT}${PREFIX}/`));
