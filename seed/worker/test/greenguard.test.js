// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notGreen } from '../src/greenguard.js';
const call = (runs, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: { check_runs: runs } });
test('GREEN-GUARD-1 (US-07-R18, US-07-T07): a run still going, a red run and an unreadable answer all hold; skipped and neutral do not', async () => {
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

test('NO-RUNS-NOT-GREEN-1 (US-07-R18, US-07-T07): no runs yet is not green (what-works#8 merged 7 s after opening, before its checks existed)', async () => {
  const route = (map) => async (f, t, m, path) => { for (const [k, v] of Object.entries(map)) if (path.includes(k)) return { ok: true, status: 200, json: v }; return { ok: false, status: 404 }; };
  const fresh = new Date().toISOString(), old = new Date(Date.now() - 3600e3).toISOString();
  const commit = (d) => ({ commit: { committer: { date: d } } });
  assert.match(await notGreen(null, 't', 'o/r', 'abc1234', route({ 'check-runs': { check_runs: [] }, 'check-suites': { check_suites: [{ app: { slug: 'github-actions' }, status: 'queued' }] }, '/commits/abc1234': commit(old) })), /checks queued/);
  assert.match(await notGreen(null, 't', 'o/r', 'abc1234', route({ 'check-runs': { check_runs: [] }, 'check-suites': { check_suites: [] }, '/commits/abc1234': commit(fresh) })), /no checks reported yet/);
  // a repository with no CI at all: an hour-old head with no suites is not held forever
  assert.equal(await notGreen(null, 't', 'o/r', 'abc1234', route({ 'check-runs': { check_runs: [] }, 'check-suites': { check_suites: [] }, '/commits/abc1234': commit(old) })), null);
});

test('SKIPPED-NOT-GREEN-1: the newest run of each check name gives the verdict, and a skipped `checks` is not a pass (#2661)', async () => {
  const run = (name, conclusion, started_at) => ({ name, status: 'completed', conclusion, started_at });
  // #2661: the dispatched run failed, then a re-run of the draft-time pull_request run skipped every job; GitHub read that as passed and merged it
  const incident = [run('checks', 'failure', '2026-11-27T06:13:00Z'), run('tests-a', 'failure', '2026-11-27T06:08:00Z'), run('checks', 'skipped', '2026-11-27T06:18:00Z'), run('tests-a', 'skipped', '2026-11-27T06:18:00Z')];
  assert.match(await notGreen(null, 't', 'ultrastable/ultrastable', 'e544d5e', call(incident)), /checks has not passed/);
  // a newer green run replaces an older red one of the same name
  assert.equal(await notGreen(null, 't', 'ultrastable/ultrastable', 'abc1234', call([run('checks', 'failure', '2026-11-27T06:00:00Z'), run('checks', 'success', '2026-11-27T06:30:00Z')])), null);
  // and a newer red run is not hidden by an older green one
  assert.match(await notGreen(null, 't', 'ultrastable/ultrastable', 'abc1234', call([run('checks', 'success', '2026-11-27T06:00:00Z'), run('checks', 'failure', '2026-11-27T06:30:00Z')])), /checks failure/);
});
