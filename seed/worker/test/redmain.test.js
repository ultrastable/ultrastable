// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revertRedMain } from '../src/redmain.js';
const NOW = Date.parse('2026-11-21T12:00:00Z');
function fake(s) {
  const calls = [];
  const f = async (url, o = {}) => {
    const m = o.method || 'GET', path = url.replace('https://api.github.com', ''); calls.push(m + ' ' + path);
    const R = (j, ok = true, status = 200) => ({ ok, status, text: async () => JSON.stringify(j) });
    if (path.endsWith('/commits/main')) return R({ sha: 'abc1234567', parents: s.parents || [{ sha: 'par0000' }], commit: { message: s.message || 'Add x (#1)', committer: { date: s.date || '2026-11-21T11:00:00Z' } } });
    if (path.includes('/check-runs')) return R({ check_runs: s.runs ?? [{ name: 'checks', status: 'completed', conclusion: 'failure' }] });
    if (path.includes('/pulls?state=open')) return R(s.open || []);
    if (path.endsWith('/git/commits/par0000')) return R({ tree: { sha: 'tree0' } });
    if (m === 'POST' && path.endsWith('/git/commits')) return R({ sha: 'new1' });
    if (m === 'POST' && path.endsWith('/git/refs')) return R({});
    if (m === 'POST' && path.endsWith('/pulls')) return R({ number: 77 });
    return R({}, false, 404);
  };
  return { f, calls };
}
test('US-07-R21, US-07-T09: a gate red past the limit opens one revert PR that restores the parent tree', async () => {
  const { f, calls } = fake({});
  const r = await revertRedMain({ token: 't', repo: 'o/r', fetch: f, now: NOW });
  assert.equal(r.status, 'reverted'); assert.equal(r.pr, 77); assert.equal(r.branch, 'agent/revert-abc1234');
  assert.ok(calls.includes('POST /repos/o/r/git/commits') && calls.includes('POST /repos/o/r/git/refs'));
});
test('US-07-R21, US-07-T09: green, running, missing gate, fresh red, a revert head and an open revert PR all do nothing', async () => {
  const run = (s) => revertRedMain({ token: 't', repo: 'o/r', fetch: fake(s).f, now: NOW });
  assert.equal((await run({ runs: [{ name: 'checks', status: 'completed', conclusion: 'success' }] })).status, 'green');
  assert.equal((await run({ runs: [{ name: 'checks', status: 'in_progress', conclusion: null }] })).status, 'pending');
  assert.equal((await run({ runs: [] })).status, 'no-gate');
  assert.equal((await run({ date: '2026-11-21T11:55:00Z' })).status, 'waiting');
  assert.equal((await run({ message: 'Revert abc: x' })).status, 'skip');
  assert.equal((await run({ parents: [{ sha: 'a' }, { sha: 'b' }] })).status, 'skip');
  assert.equal((await run({ open: [{ number: 5 }] })).status, 'open');
  assert.equal((await revertRedMain({ repo: 'o/r' })).status, 'no-token');
});
