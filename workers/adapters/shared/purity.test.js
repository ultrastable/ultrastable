// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-14-R19 (and R01): no core module outside a recorded baseline calls a platform. The core reaches a platform only through a port, so
// a core file that imports node: modules, reads process, uses caches, a cloudflare: module, env.DB, or an adapter (a port named fetch, even defaulting to the global, is allowed) fails
// here unless adapters/shared/purity-baseline.json names it with a reason. The baseline only shrinks: an entry whose finding is gone
// must be removed, so a cleaned file cannot regress unnoticed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORE = path.join(ROOT, 'core');
const BASELINE = JSON.parse(readFileSync(new URL('./purity-baseline.json', import.meta.url), 'utf8'));
const RULES = [
  ['node-import', /(?:^|\n)\s*(?:import\b[^\n;]*\bfrom\s*|import\s*|export\b[^\n;]*\bfrom\s*)['"]node:/],
  ['process', /(?<![\w.$])process\s*\./],
  ['caches', /(?<![\w.$])caches\s*\./],
  ['cloudflare-import', /from\s*['"]cloudflare:/],
  ['env-db', /\benv\.DB\b/],
  ['adapter-import', /from\s*['"](?:\.\.\/)+adapters\//],
];
const SKIP_FILE = /\.test\.js$|\.generated\.js$/;
const SKIP_DIR = new Set(['node_modules', 'migrations']);

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) { if (!SKIP_DIR.has(n)) walk(p, out); } else if (n.endsWith('.js') && !SKIP_FILE.test(n)) out.push(p);
  }
  return out;
}
// Comments and string-free scanning is not attempted: a finding in a comment is rare and would be named in the baseline with its reason.
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const findings = () => {
  const out = {};
  for (const f of walk(CORE)) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const src = stripComments(readFileSync(f, 'utf8'));
    const hit = RULES.filter(([, re]) => re.test(src)).map(([n]) => n);
    if (hit.length) out[rel] = hit;
  }
  return out;
};

test('US-14-R19: no core module outside the baseline imports a platform, and the baseline only shrinks', () => {
  const found = findings();
  const known = BASELINE.entries;
  const fresh = Object.entries(found).flatMap(([file, rules]) => rules.filter(r => !(known[file]?.rules || []).includes(r)).map(r => `${file}: ${r}`));
  assert.deepEqual(fresh, [], 'a core file reaches a platform: pass it a port, or add it to adapters/shared/purity-baseline.json with a reason');
  const stale = Object.entries(known).flatMap(([file, e]) => e.rules.filter(r => !(found[file] || []).includes(r)).map(r => `${file}: ${r}`));
  assert.deepEqual(stale, [], 'the baseline lists a finding that is gone: remove it (the baseline only shrinks)');
  for (const [file, e] of Object.entries(known)) assert.ok(String(e.reason || '').trim().length > 10, `${file} needs a reason`);
});

test('US-14-R19: the scanner sees each kind of platform call', () => {
  const sample = { 'node-import': `import fs from 'node:fs';`, process: `const x = process.env.A;`, caches: `await caches.default.match(r);`, 'cloudflare-import': `import { DurableObject } from 'cloudflare:workers';`, 'env-db': `env.DB.prepare('x')`, 'adapter-import': `import { x } from '../../adapters/github/stage2.js';` };
  for (const [name, re] of RULES) assert.ok(re.test(sample[name]), name);
  for (const [name, re] of RULES) assert.ok(!re.test(`const ok = port.fetch(u); const p = myprocess.x; // ${sample[name]}`.replace(/\/\/.*/, '')), `${name} ignores a method call and a comment`);
});
