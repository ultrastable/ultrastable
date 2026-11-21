// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// node --test tests/test_sweeper.js. A non-2xx answer is returned with its status (callers record it in out.errors), never thrown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gh, sweepOpenLoops } from '../seed/worker/src/sweeper.js';

const res = (ok, status, body) => async () => ({ ok, status, text: async () => body });

test('gh returns the status on a non-2xx answer instead of throwing', async () => {
  const r = await gh(res(false, 404, 'Not Found'), 't', 'GET', '/repos/o/r/branches');
  assert.equal(r.ok, false); assert.equal(r.status, 404); assert.deepEqual(r.json, { raw: 'Not Found' });
});

test('gh returns parsed json on success', async () => {
  const r = await gh(res(true, 200, JSON.stringify({ name: 'main' })), 't', 'GET', '/x');
  assert.equal(r.ok, true); assert.deepEqual(r.json, { name: 'main' });
});

test('an unreadable pulls list is recorded as an error, not swallowed', async () => {
  const r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: res(false, 500, '{}'), now: Date.parse('2026-11-13T12:00:00Z') });
  assert.equal(r.status, 'errors'); assert.ok(r.errors.some(e => e.includes('pulls 500')));
});
