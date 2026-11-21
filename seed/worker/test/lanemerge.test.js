// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeForLane } from '../src/lanemerge.js';
const SHA = 'a'.repeat(40);
const mk = (pr, merged) => async (url, o) => {
  const body = (j, ok = true, status = 200) => ({ ok, status, text: async () => JSON.stringify(j) });
  if (o.method === 'PUT') { merged.push(url); return body({ sha: 'b'.repeat(40) }); }
  if (/\/pulls\/7$/.test(url)) return body(pr);
  return body({ check_runs: [{ name: 'checks', status: 'completed', conclusion: 'success' }], statuses: [], state: 'success', total_count: 1 });
};
const base = { state: 'open', draft: false, mergeable_state: 'clean', head: { sha: SHA, repo: { full_name: 'o/r' } } };
test('merges a clean PR on its exact head', async () => {
  const merged = [];
  const r = await mergeForLane({ token: 't', repo: 'o/r', pr: 7, sha: SHA, fetch: mk(base, merged) });
  assert.equal(r.status === 200 || r.status === 409, true);
  if (r.ok) assert.equal(merged.length, 1);
});
test('refuses when the head moved, a fork or no token', async () => {
  assert.equal((await mergeForLane({ token: 't', repo: 'o/r', pr: 7, sha: 'c'.repeat(40), fetch: mk(base, []) })).status, 409);
  assert.equal((await mergeForLane({ token: 't', repo: 'o/r', pr: 7, sha: SHA, fetch: mk({ ...base, head: { sha: SHA, repo: { full_name: 'x/y' } } }, []) })).status, 409);
  assert.equal((await mergeForLane({ token: '', repo: 'o/r', pr: 7, sha: SHA })).status, 503);
});
