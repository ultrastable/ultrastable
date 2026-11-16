// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// MIGRATION-DRIFT-1 (Q-LESSON-DEPLOY-VERSION): deploy/apply-d1-migrations.mjs applies a file once; an applied file whose sha256 changed is drift, never re-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planMigrations } from '../../../deploy/migration-plan.mjs';

test('new files apply, unchanged applied files skip, an edited applied file is drift and is not re-applied', () => {
  const plan = planMigrations([{ file: '0002_b.sql', sha256: 'b2' }, { file: '0001_a.sql', sha256: 'a1' }, { file: '0003_c.sql', sha256: 'c1' }], { '0001_a.sql': 'a1', '0002_b.sql': 'b1' });
  assert.deepEqual(plan.map(m => [m.file, m.action]), [['0001_a.sql', 'skip'], ['0002_b.sql', 'drift'], ['0003_c.sql', 'apply']]);
  assert.equal(plan[1].was, 'b1');
});

test('the runner uses the plan and runs only files planned for apply', () => {
  const src = readFileSync(new URL('../../../deploy/apply-d1-migrations.mjs', import.meta.url), 'utf8');
  assert.match(src, /planMigrations\(files, ledger\)/);
  assert.match(src, /m\.action === "drift"[^\n]*continue;/, 'drift is reported and skipped');
});
