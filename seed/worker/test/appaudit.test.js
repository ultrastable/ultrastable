// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// APP-INVENTORY-1
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { makeDb } from './d1shim.js';
import * as store from '../src/auth/store.js';
import { auditApps } from '../src/appaudit.js';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const env = { CREDENTIAL_KEY: 'k'.repeat(32) };
const J = (s, j) => ({ status: s, json: async () => j });

test('keeps the stored installation, removes extras, reports an app with no key', async () => {
  const db = makeDb(); await store.ensureSchema(db);
  await store.put(db, env, 't', 'github-app', { secret: { pem }, meta: { app_id: 1, installation_id: 10 } });
  const calls = [];
  const f = async (u, o = {}) => { calls.push((o.method || 'GET') + ' ' + u.replace('https://api.github.com', ''));
    if (u.endsWith('/app')) return J(200, { id: 1, slug: 'a' });
    if (u.includes('/app/installations?')) return J(200, [{ id: 10, account: { login: 'ultrastable' } }, { id: 11, account: { login: 'other-org' } }]);
    return J(204, {}); };
  const r = await auditApps(db, env, 't', { fetch: f });
  assert.deepEqual(calls.filter(c => c.startsWith('DELETE')), ['DELETE /app/installations/11']);
  assert.equal(r.active, 1); assert.equal(r.apps[1].reachable, false);
  assert.equal((await auditApps(db, env, 't', { fetch: f })).skipped, 'ran within a day');
});
