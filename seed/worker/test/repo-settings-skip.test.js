// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ADMIT-1: an archived repository (read-only) and a registered repository not created yet are skipped and named, never a red org-settings run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { newKey } from '../src/auth/seal.js';
import * as store from '../src/auth/store.js';
import { ensureRepoSettings } from '../src/apprepos.js';

const toPem = (der, label = 'PRIVATE KEY') => `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----`;
async function pem() { const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']); return toPem(new Uint8Array(await crypto.subtle.exportKey('pkcs8', k.privateKey))); }
const T = 'ultrastable';

test('archived and not-yet-created repositories are skipped, nothing is patched', async () => {
  const env = { CREDENTIAL_KEY: newKey() }, db = makeDb();
  await store.ensureSchema(db);
  await store.put(db, env, T, 'github-admin', { secret: { pem: await pem() }, meta: { app_id: 2, installation_id: 22 }, access: 'admin-token', expiresAt: Date.now() + 3600e3 });
  const patched = [];
  const f = async (url, init = {}) => {
    const u = new URL(url), m = init.method || 'GET';
    if (m !== 'GET') { patched.push(u.pathname); return new Response('{}', { status: 200 }); }
    if (u.pathname === '/repos/ultrastable/spec') return new Response(JSON.stringify({ archived: true, delete_branch_on_merge: true, allow_auto_merge: false }), { status: 200 });
    if (u.pathname === '/repos/ultrastable/new-tenant') return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response('{}', { status: 500 });
  };
  const a = await ensureRepoSettings(db, env, T, { repo: 'ultrastable/spec' }, { fetch: f });
  assert.equal(a.ok, true); assert.match(a.skipped, /archived/);
  const b = await ensureRepoSettings(db, env, T, { repo: 'ultrastable/new-tenant' }, { fetch: f });
  assert.equal(b.ok, true); assert.match(b.skipped, /not created/);
  assert.deepEqual(patched, []);
});
