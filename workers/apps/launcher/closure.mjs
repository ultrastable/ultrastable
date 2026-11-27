// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The source closure of the preview Worker (US-19-R10): every file its entry point imports, transitively, with the SHA-256 of each,
// plus the migrations and the config that go into the bundle. build.mjs records it beside the bundle and the freshness test
// (test/bundle-fresh.test.mjs) recomputes it, so a source change without a rebuild fails without needing wrangler or the network.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKERS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENTRY = 'apps/launcher/preview/entry.js';
const sha = buf => createHash('sha256').update(buf).digest('hex');
// import x from './a.js'; import './a.js'; export { x } from './a.js'; export * from './a.js'. Dynamic import() is not followed: the entry uses none.
const STATIC = /(?:^|[\n;])\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

/** Files (relative to the repository root, forward slashes) the entry imports through relative specifiers, the entry first. */
export function importClosure(root = WORKERS_ROOT, entry = ENTRY) {
  const seen = new Set();
  const walk = rel => {
    if (seen.has(rel)) return;
    const abs = path.join(root, rel);
    if (!existsSync(abs)) throw new Error(`import closure: ${rel} does not exist`);
    seen.add(rel);
    if (!rel.endsWith('.js') && !rel.endsWith('.mjs')) return;
    for (const m of readFileSync(abs, 'utf8').matchAll(STATIC)) {
      if (!m[1].startsWith('.')) continue; // node: builtins and bare packages are not part of this tree
      walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    }
  };
  walk(entry);
  return [...seen];
}

/** { files: { path: sha256 }, digest } for the entry's closure, the core migrations and the preview config. */
export function sourceClosure(root = WORKERS_ROOT, entry = ENTRY) {
  const rels = new Set(importClosure(root, entry));
  rels.add('apps/launcher/preview/wrangler.jsonc');
  for (const n of readdirSync(path.join(root, 'core', 'migrations')).filter(n => n.endsWith('.sql'))) rels.add(`core/migrations/${n}`);
  const files = {};
  for (const rel of [...rels].sort()) files[rel] = sha(readFileSync(path.join(root, rel)));
  return { files, digest: sha(JSON.stringify(files)) };
}
