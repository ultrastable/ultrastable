// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The blast-radius command line (tools/fleet_graph.mjs) over a temporary working tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFiles, analyse } from '../../tools/fleet_graph.mjs';

const CLI = fileURLToPath(new URL('../../tools/fleet_graph.mjs', import.meta.url));
function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'fleet-graph-'));
  for (const [p, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); writeFileSync(path.join(root, p), text); }
  return root;
}
const FILES = {
  'core/a.js': "import './b.js';", 'core/b.js': '', 'web/page.ts': "import type { T } from './types.js';", 'web/types.ts': '',
  'svc/main.py': 'from .util import f\nimport core.x', 'svc/util.py': '', 'node_modules/skip/x.js': "import '../../core/b.js';", 'notes.md': "import './core/b.js'",
};

test('US-12-R22: the scan reads JS, TS and Python files and skips vendored directories and other file types', () => {
  const root = tree(FILES);
  try { assert.deepEqual(scanFiles(root).map(f => f.path).sort(), ['core/a.js', 'core/b.js', 'svc/main.py', 'svc/util.py', 'web/page.ts', 'web/types.ts']); }
  finally { rmSync(root, { recursive: true }); }
});

test('US-12-R23: the command line prints what depends on a change, across languages, and a declared edge joins the graph', async () => {
  const root = tree(FILES);
  try {
    const r = await analyse({ root, changed: ['core/b.js', 'web/types.ts', 'svc/util.py'], declared: [['svc/main.py', 'core/a.js']] });
    assert.deepEqual(r.sources, [{ source: 'scan', ok: true, files: 6 }]);
    assert.deepEqual(r.affected, ['core/a.js', 'svc/main.py', 'web/page.ts']);
    assert.equal(r.truncated, false);
    const cli = JSON.parse(execFileSync('node', [CLI, '--root', root, '--changed', 'svc/util.py'], { encoding: 'utf8' }));
    assert.deepEqual(cli.affected, ['svc/main.py']);
  } finally { rmSync(root, { recursive: true }); }
});
