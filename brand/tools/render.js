// Renders brand SVGs to PNG with Playwright: node brand/tools/render.js
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const jobs = [
  ['logo/ultrastable-icon.svg', 'logo/ultrastable-icon-512.png', 512, 512],
  ['logo/favicon.svg', 'logo/favicon-32.png', 32, 32],
  ['logo/favicon.svg', 'logo/apple-touch-icon.png', 180, 180],
  ['logo/ultrastable-primary.svg', 'logo/ultrastable-primary.png', 1440, 256],
  ['social/social-card.svg', 'social/social-card.png', 1280, 640],
  ['social/readme-banner.svg', 'social/readme-banner.png', 1280, 320],
];
(async () => { const b = await chromium.launch(); for (const [src, out, w, h] of jobs) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const svg = fs.readFileSync(path.join(root, src), 'utf8').replace(/ width="\d+" height="\d+"/, ` width="${w}" height="${h}"`);
  await p.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
  await p.screenshot({ path: path.join(root, out), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } }); await p.close(); }
  await b.close(); })();
