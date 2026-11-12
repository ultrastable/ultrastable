// Renders brand/generated/**/*.svg to PNG at their native size (2x for README clarity): node brand/tools/render-generated.js
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const dir = path.join(__dirname, '..', 'generated');
const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : f.name.endsWith('.svg') && files.push(path.join(d, f.name)); })(dir);
(async () => { const b = await chromium.launch(); for (const f of files) {
  const svg = fs.readFileSync(f, 'utf8'); const [w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/).slice(1).map(Number);
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0">${svg}</body>`); await p.screenshot({ path: f.replace(/\.svg$/, '.png'), clip: { x: 0, y: 0, width: w, height: h } }); await p.close(); }
  await b.close(); console.log('rendered', files.length); })();
