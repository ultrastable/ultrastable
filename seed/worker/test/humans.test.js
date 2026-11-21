// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importCredentials, reconcileBuffer } from '../src/humans.js';

const req = (tok, body) => new Request('https://x/internal/social/import', { method: 'POST', headers: { authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
test('import refuses a wrong or missing token', async () => {
  assert.equal((await importCredentials({}, { SOCIAL_RELAY_TOKEN: 'a' }, 't', req('b', {}))).status, 401);
  assert.equal((await importCredentials({}, {}, 't', req('', {}))).status, 401);
});
test('reconcileBuffer skips when no credential is sealed', async () => {
  const db = { prepare: () => ({ bind() { return this; }, first: async () => null, run: async () => ({}), all: async () => ({ results: [] }) }) };
  assert.deepEqual(await reconcileBuffer({ db, env: {}, tenant: 't' }), { skipped: 'no buffer credential' });
});
