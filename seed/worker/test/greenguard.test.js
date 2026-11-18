// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notGreen } from '../src/greenguard.js';
const call = (runs, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: { check_runs: runs } });
test('GREEN-GUARD-1: a run still going, a red run and an unreadable answer all hold; skipped and neutral do not', async () => {
  assert.match(await notGreen(null, 't', 'o/r', 'abc1234', call([{ name: 'x', status: 'in_progress' }])), /still running/);
  assert.match(await notGreen(null, 't', 'o/r', 'abc1234', call([{ name: 'x', status: 'completed', conclusion: 'failure' }])), /failure/);
  assert.match(await notGreen(null, 't', 'o/r', 'abc1234', call([], false)), /check-runs 500/);
  assert.equal(await notGreen(null, 't', 'o/r', 'abc1234', call([{ name: 'a', status: 'completed', conclusion: 'skipped' }, { name: 'lane', status: 'in_progress' }])), null);
});
test('GREEN-GUARD-1: ultrastable/ultrastable needs its full-suite `checks` run green on the head commit (#595 merged without it)', async () => {
  const other = [{ name: 'ciwatch', status: 'completed', conclusion: 'success' }];
  assert.match(await notGreen(null, 't', 'ultrastable/ultrastable', 'abc1234', call(other)), /checks has not passed/);
  assert.equal(await notGreen(null, 't', 'ultrastable/ultrastable', 'abc1234', call([...other, { name: 'checks', status: 'completed', conclusion: 'success' }])), null);
});
