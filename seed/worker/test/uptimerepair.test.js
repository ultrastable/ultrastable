// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { repairSites, _reset } from '../src/uptimerepair.js';
test('dispatches deploy-site once, then throttles', async () => {
  _reset(); const calls = [];
  const f = async (u, o) => { calls.push(u); return new Response(null, { status: 204 }); };
  assert.deepEqual(await repairSites({ token: 't', repo: 'o/r', fetchImpl: f, now: () => 1e9 }), { ok: true, dispatched: 'deploy-site.yml' });
  assert.equal((await repairSites({ token: 't', repo: 'o/r', fetchImpl: f, now: () => 1e9 + 1000 })).why, 'throttled');
  assert.equal(calls.length, 1); assert.match(calls[0], /workflows\/deploy-site\.yml\/dispatches$/);
});
test('no credential, no call', async () => { _reset(); assert.equal((await repairSites({ token: '', repo: 'o/r' })).ok, false); });
