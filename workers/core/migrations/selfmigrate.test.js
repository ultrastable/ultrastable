// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSql, selfMigrateStep } from './selfmigrate.js';

test('splitSql keeps a trigger body whole and drops comments', () => {
  const st = splitSql('-- c\nCREATE TABLE a (x);\nCREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1; SELECT 2; END;');
  assert.equal(st.length, 2);
  assert.match(st[1], /END;$/);
});

test('the step names itself and takes its table from the caller', () => {
  const s = selfMigrateStep({ files: {}, allow: [], table: 'x_applied', stepName: 'x_step' });
  assert.equal(s.name, 'x_step');
});
