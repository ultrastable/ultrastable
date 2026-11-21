// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG, classifyFile, verdict, classifyPrFiles, fileClass } from './index.js';

const root = new URL('../../../', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

test('every shared vector matches the Python gate (doctrine/substance-vectors.json)', () => {
  const v = read('doctrine/substance-vectors.json');
  for (const c of v.cases) assert.equal(classifyFile(c.path, c.status, c.removed, c.added), c.expect, c.name);
  for (const c of v.verdicts) assert.equal(verdict(c.kinds), c.expect, c.name);
});

test('CONFIG equals doctrine/substance.json, so the two classifiers read the same rules', () => {
  const d = read('doctrine/substance.json');
  for (const k of Object.keys(CONFIG)) assert.deepEqual(CONFIG[k], d[k], k);
});

test('a pull request that removes an unused import and bumps generated data is trivial', () => {
  const r = classifyPrFiles([
    { filename: 'scripts/smoke_probe.py', status: 'modified', patch: '@@ -1 +1 @@\n-import json, os\n+import os' },
    { filename: 'site/dashboard-data.js', status: 'modified', patch: '@@ -2 +2 @@\n- "asof": "5e4a1aab",\n+ "asof": "d02d20a",' },
    { filename: 'ops/deploys.jsonl', status: 'modified', patch: '@@ -1 +1,2 @@\n+{}' }]);
  assert.equal(r.verdict, 'trivial');
});

test('a code file without a readable patch is behaviour, never trivial', () => {
  assert.equal(classifyPrFiles([{ filename: 'seed/worker/src/big.js', status: 'modified' }]).verdict, 'substantive');
  assert.equal(fileClass('docs/issues/Q-1.json'), 'record');
});
