// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Q-TEST-TIMEBOMB-1: a test that pins a calendar date while the code it loads asks SQLite for a real-clock window (datetime('now', '-7 days'))
// passes until the pinned date ages out of the window, then fails with no code change (cloud.test.js, 2026-11-18). This finds that shape at
// authoring time: a test file whose clock is a fixed date and whose direct imports or loaded manifests contain a real-clock SQL window.
// Usage: node workers/tools/timebomb.mjs [root]   (exit 1 on findings outside the shrink-only baseline)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PINNED = /(?:Date\.parse|new Date)\(\s*['"`]20\d\d-\d\d-\d\d/;
export const WINDOW = /datetime\(\s*'now'\s*,\s*'[-+]/;  // a window relative to the real clock; a bare datetime('now') default is not one
const SELF = fileURLToPath(import.meta.url);
const SKIP = new Set(['node_modules', '.git', '.wrangler']);

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n), s = statSync(p);
    if (s.isDirectory()) yield* walk(p); else yield p;
  }
}

// Relative modules and JSON/SQL files a test loads directly: static and dynamic imports, and new URL('…', import.meta.url) reads.
export function loaded(file, src) {
  const out = new Set(), dir = dirname(file);
  for (const re of [/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g, /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]/g, /new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url/g, /require\(\s*['"](\.{1,2}\/[^'"]+)['"]/g]) {
    for (const m of src.matchAll(re)) {
      const p = resolve(dir, m[1]);
      for (const c of [p, p + '.js', p + '.mjs', join(p, 'index.js')]) if (existsSync(c) && statSync(c).isFile()) { out.add(c); break; }
    }
  }
  // A pack test loads its manifest by name through the pack runtime, not by path.
  const manifest = join(dir, 'pack.json');
  if (existsSync(manifest)) out.add(manifest);
  return [...out];
}

export function scan(root) {
  const findings = [];
  for (const f of walk(root)) {
    if (!/\.test\.(m?js)$/.test(f)) continue;
    const src = readFileSync(f, 'utf8');
    if (!PINNED.test(src)) continue;
    const hits = loaded(f, src).filter(p => p !== SELF && WINDOW.test(readFileSync(p, 'utf8')));  // the scanner's own patterns are not a window
    if (hits.length) findings.push({ test: relative(root, f), loads: hits.map(p => relative(root, p)) });
  }
  return findings;
}

export function baseline(root) {
  const p = join(root, 'tools/timebomb-baseline.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).tests : [];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'));
  const base = new Set(baseline(root)), found = scan(root);
  const fresh = found.filter(x => !base.has(x.test)), gone = [...base].filter(t => !found.some(x => x.test === t));
  for (const x of fresh) console.error(`timebomb: ${x.test} pins a calendar date and loads a real-clock SQL window in ${x.loads.join(', ')}; start the clock relative to Date.now()`);
  for (const t of gone) console.error(`timebomb: ${t} is clean now; remove it from tools/timebomb-baseline.json (shrink-only)`);
  console.log(`timebomb: ${found.length} found, ${base.size} baselined, ${fresh.length} new, ${gone.length} stale`);
  process.exit(fresh.length || gone.length ? 1 : 0);
}
