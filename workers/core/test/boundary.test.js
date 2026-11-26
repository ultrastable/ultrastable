// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// KERNEL-BOUNDARY-1: core/ is the versioned kernel. Its runtime code imports only node built-ins and other core/ files, so it
// can be released and consumed on its own; adapters, apps, packs outside core and tenants depend on core, never the reverse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Shrink-only baseline: known leaks still to be moved behind an injected dependency. Removing one is progress; adding one fails.
const KNOWN = new Set([
  'org/surfaces.js -> ../../adapters/github/stage2.js',
  'org/surfaces.js -> ../../adapters/shared/slot.js',
]);

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || (dir === CORE && name === 'test')) continue; // the test harness builds stores from adapters and is not runtime code
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.m?js$/.test(name) && !/\.test\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

test('core runtime code imports nothing outside core/', () => {
  const leaks = [];
  for (const file of walk(CORE)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const target = resolve(join(file, '..'), spec);
      const edge = `${relative(CORE, file)} -> ${spec}`;
      if (relative(CORE, target).startsWith('..') && !KNOWN.has(edge)) leaks.push(edge);
    }
  }
  assert.deepEqual(leaks, []);
});
