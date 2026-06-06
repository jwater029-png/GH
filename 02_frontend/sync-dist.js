// sync-dist.js — 把 5 个前端源文件复制进 dist/(Tauri 的 frontendDist)。
// tauri.conf.json 的 beforeDevCommand/beforeBuildCommand 会在 dev/build 前自动跑这个,
// 保证 dist 永远和源文件一致,不用手动 copy、不会两份走样。
const fs = require('fs');
const path = require('path');

// 顶层源文件 + 子目录文件(vendor 里的第三方库,如 Cytoscape.js)
const FILES = ['index.html', 'style.css', 'starnet-format.js', 'storage.js', 'app.js', 'graph.js'];
const SUBDIR_FILES = ['vendor/cytoscape.min.js'];
const distDir = path.join(__dirname, 'dist');
fs.mkdirSync(distDir, { recursive: true });

for (const f of FILES) {
  fs.copyFileSync(path.join(__dirname, f), path.join(distDir, f));
}
for (const f of SUBDIR_FILES) {
  const dest = path.join(distDir, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(__dirname, f), dest);
}
console.log(`[sync-dist] 已同步 ${FILES.length + SUBDIR_FILES.length} 个文件到 dist/`);
