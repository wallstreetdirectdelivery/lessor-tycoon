// 把 src/ 内联成单文件：dist/lessor-tycoon.html（本地双击打开）与 dist/artifact.html（发布用，无文档骨架）
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

let html = src('index.html');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${src('style.css')}\n</style>`);
html = html.replace(/<script src="([\w.-]+\.js)"><\/script>/g, (_, f) => `<script>\n${src(f).replace(/<\/script/gi, '<\\/script')}\n</script>`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), html);
const local = `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${html}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(root, 'dist', 'lessor-tycoon.html'), local);
console.log('built', (local.length / 1024).toFixed(0) + 'KB');
