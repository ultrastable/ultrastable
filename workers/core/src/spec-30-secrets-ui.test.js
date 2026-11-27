// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-30 (owner actions and credentials), section 4.5: the Connect screen's back end, the one door where a key that no consent flow can issue is pasted
// once and only its presence is ever shown again. Each test names the requirement it proves (US-00-R03).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createVault } from '../vault/index.js';
import { CONNECTIONS, routerConnections, listConnections, saveSecret, removeSecret } from './secrets-ui.js';

const MIG = fileURLToPath(new URL('../vault/migrations/', import.meta.url));
const SECRET = 'sk-test-VALUE-1234567890';
const vaultOf = () => createVault({ db: makeDb([MIG]) });
const router = { providers: { edge: { kind: 'workers_ai', key_env: null }, paid: { kind: 'openai', key_env: 'OPENAI_API_KEY' }, odd: { kind: 'openai', key_env: 'NOT_ALLOWED_NAME' }, keyless: { kind: 'openai' } } };

test('US-30-R54: the Connect screen lists each connection with its presence, source and time and never a value; names the vault does not allow are dropped and the keyless model route asks for nothing', async () => {
  assert.deepEqual(routerConnections(router).map(c => c.name), ['OPENAI_API_KEY', 'NOT_ALLOWED_NAME']); assert.deepEqual(routerConnections({}), []); assert.deepEqual(routerConnections(), []);
  const vault = vaultOf(); assert.deepEqual(await listConnections(null), [], 'no vault, no screen');
  await vault.put('OPENAI_API_KEY', SECRET);
  const list = await listConnections(vault, { ANTHROPIC_API_KEY: 'from-the-environment' }, { router });
  assert.deepEqual(list.map(c => c.name), ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'], 'not allowlisted: dropped; each name once; GitHub access is not a paste (US-30-R55)');
  const by = Object.fromEntries(list.map(c => [c.name, c])); assert.deepEqual([by.ANTHROPIC_API_KEY.present, by.ANTHROPIC_API_KEY.source, by.ANTHROPIC_API_KEY.set_at], [true, 'environment', null]);
  assert.deepEqual([by.OPENAI_API_KEY.present, by.OPENAI_API_KEY.source], [true, 'console']); assert.ok(by.OPENAI_API_KEY.set_at);
  assert.ok(!JSON.stringify(list).includes(SECRET)); for (const c of list) assert.ok(c.label && c.help, c.name);
  assert.deepEqual(CONNECTIONS.map(c => c.name), ['ANTHROPIC_API_KEY']);
});

test('US-30-R54: a pasted value is stored through the vault and never echoed: the reply and every error are free of it, a refused name or value is a plain 400, and a value that came from the environment cannot be removed here', async () => {
  const vault = vaultOf();
  assert.deepEqual(await saveSecret(vault, { name: 'ANTHROPIC_API_KEY', value: SECRET }), { status: 200, body: { name: 'ANTHROPIC_API_KEY', stored: true } });
  for (const bad of [{ name: 'EVIL', value: SECRET }, { name: 'VCS_TOKEN', value: 'short' }, { name: '', value: SECRET }, {}]) { const r = await saveSecret(vault, bad); assert.equal(r.status, 400); assert.ok(!JSON.stringify(r).includes(SECRET)); }
  assert.deepEqual(await saveSecret(vault, { name: 'EVIL', value: SECRET }), { status: 400, body: { error: 'name not allowed' } });
  assert.deepEqual(await saveSecret(null, {}), { status: 503, body: { error: 'secrets cannot be stored here' } }); assert.equal((await removeSecret(null, {})).status, 503);
  assert.deepEqual(await removeSecret(vault, { name: 'EVIL' }), { status: 400, body: { error: 'name not allowed' } });
  assert.deepEqual(await removeSecret(vault, { name: 'VCS_TOKEN' }), { status: 404, body: { error: 'nothing stored under that name' } }, 'a secret that lives in the environment is not here to remove');
  assert.deepEqual(await removeSecret(vault, { name: 'ANTHROPIC_API_KEY' }), { status: 200, body: { name: 'ANTHROPIC_API_KEY', removed: true } }); assert.equal(await vault.has('ANTHROPIC_API_KEY'), false);
});

test('US-30-R55: the Connect screen offers no paste for a credential that a consent flow can issue: GitHub access is the one-click link, never a token to create and paste', () => {
  assert.ok(!CONNECTIONS.some(c => c.name === 'VCS_TOKEN'));
  assert.ok(!CONNECTIONS.some(c => /\b(create|paste)\b/i.test(c.help) && /GitHub|VCS/i.test(c.name + c.label)));
});
