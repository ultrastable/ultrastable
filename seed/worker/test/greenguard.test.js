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

test('NO-RUNS-NOT-GREEN-1: no runs yet is not green (what-works#8 merged 7 s after opening, before its checks existed)', async () => {
  const route = (map) => async (f, t, m, path) => { for (const [k, v] of Object.entries(map)) if (path.includes(k)) return { ok: true, status: 200, json: v }; return { ok: false, status: 404 }; };
  const fresh = new Date().toISOString(), old = new Date(Date.now() - 3600e3).toISOString();
  const commit = (d) => ({ commit: { committer: { date: d } } });
  assert.match(await notGreen(null, 't', 'o/r', 'abc1234', route({ 'check-runs': { check_runs: [] }, 'check-suites': { check_suites: [{ app: { slug: 'github-actions' }, status: 'queued' }] }, '/commits/abc1234': commit(old) })), /checks queued/);
  assert.match(await notGreen(null, 't', 'o/r', 'abc1234', route({ 'check-runs': { check_runs: [] }, 'check-suites': { check_suites: [] }, '/commits/abc1234': commit(fresh) })), /no checks reported yet/);
  // a repository with no CI at all: an hour-old head with no suites is not held forever
  assert.equal(await notGreen(null, 't', 'o/r', 'abc1234', route({ 'check-runs': { check_runs: [] }, 'check-suites': { check_suites: [] }, '/commits/abc1234': commit(old) })), null);
});
