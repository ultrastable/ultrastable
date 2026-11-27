// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-30 (owner actions and credentials), section 4.5: the vault, where a secret that arrives through a consent flow (or, for a key no flow can issue,
// a paste) is kept so that its value is never returned through an API. Each test names the requirement it proves (US-00-R03).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createVault, DEFAULT_ALLOWED } from './index.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const SECRET = 'sk-test-0123456789abcdef', OTHER = 'sk-other-fedcba9876543210';

test('US-30-R53: the vault keeps a secret under an allowlisted name and returns its presence, never its value, through any listing; a module reads it at call time and the read is recorded', async () => {
  const db = makeDb([MIG]), v = createVault({ db });
  assert.deepEqual(await v.put('ANTHROPIC_API_KEY', '  ' + SECRET + '\n', { by: 'owner-link' }), { name: 'ANTHROPIC_API_KEY', stored: true }, 'the reply never holds the value');
  assert.equal(await v.read('ANTHROPIC_API_KEY'), SECRET, 'a value is trimmed on the way in');
  assert.equal(await v.has('ANTHROPIC_API_KEY'), true); assert.equal(await v.has('OPENAI_API_KEY'), false); assert.equal(await v.read('OPENAI_API_KEY'), null);
  const [row] = await v.names(); assert.deepEqual(Object.keys(row).sort(), ['last_used_at', 'name', 'set_at', 'set_by']); assert.equal(row.set_by, 'owner-link'); assert.ok(!JSON.stringify(await v.names()).includes(SECRET));
  assert.ok(row.last_used_at, 'reading it recorded its last use');
  await v.put('ANTHROPIC_API_KEY', OTHER); assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM vault_secrets').get().n, 1, 'replaced in place'); assert.equal(await v.read('ANTHROPIC_API_KEY'), OTHER);
  assert.deepEqual(await v.remove('ANTHROPIC_API_KEY'), { removed: true }); assert.equal(await v.has('ANTHROPIC_API_KEY'), false);
});

test('US-30-R53: only well-formed names on the allowlist and plausible values are accepted, the list is a copy, and the names the owner-link flows write are on it', async () => {
  const v = createVault({ db: makeDb([MIG]) });
  for (const name of ['rm -rf', 'lower_case', 'SOME_OTHER_NAME', 'AB', 'A'.repeat(70), '']) assert.deepEqual(await v.put(name, SECRET), { error: 'name not allowed' }, name);
  for (const value of ['short', 'x'.repeat(8193), '       ', null]) assert.deepEqual(await v.put('ANTHROPIC_API_KEY', value), { error: 'value length not accepted' }, String(value).slice(0, 8));
  assert.deepEqual(await v.put('ANTHROPIC_API_KEY', 'x'.repeat(8)), { name: 'ANTHROPIC_API_KEY', stored: true }, 'eight characters is the least'); assert.equal((await v.put('ANTHROPIC_API_KEY', 'x'.repeat(8192))).stored, true);
  const list = v.allowed(); list.push('EVIL'); assert.ok(!v.allowed().includes('EVIL'), 'the allowlist cannot be widened through the copy');
  for (const n of ['MASTODON_TOKEN', 'MASTODON_CLIENT_ID', 'MASTODON_CLIENT_SECRET', 'MASTODON_INSTANCE', 'BLUESKY_OAUTH', 'SESSION_KEY', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_INSTALLATION_ID']) assert.ok(DEFAULT_ALLOWED.includes(n), n);
  const mine = createVault({ db: makeDb([MIG]), allowed: ['MY_OWN_KEY'] }); assert.equal((await mine.put('MY_OWN_KEY', SECRET)).stored, true); assert.ok((await mine.put('ANTHROPIC_API_KEY', SECRET)).error, 'a deployment narrows the allowlist');
});

test('US-30-R53: a real environment value wins over the vault, and any text can be scrubbed of every stored value before it reaches a log or a stored row', async () => {
  const v = createVault({ db: makeDb([MIG]) });
  await v.put('ANTHROPIC_API_KEY', SECRET); await v.put('OPENAI_API_KEY', OTHER);
  assert.deepEqual(await v.withVault({ OPENAI_API_KEY: 'env-wins-1234', KEEP: 'k' }), { OPENAI_API_KEY: 'env-wins-1234', KEEP: 'k', ANTHROPIC_API_KEY: SECRET });
  assert.deepEqual(await v.withVault(), { ANTHROPIC_API_KEY: SECRET, OPENAI_API_KEY: OTHER });
  assert.equal(await v.redact(`error calling with ${SECRET} and again ${SECRET}; also ${OTHER}`), 'error calling with [redacted] and again [redacted]; also [redacted]');
  assert.equal(await v.redact('nothing secret here'), 'nothing secret here');
});

// The vault takes a key the deploy binds (the `key` option, 32 bytes in base64, like CREDENTIAL_KEY) and seals every value under it; the key is never written
// to the database, so a copy of the database alone opens nothing (US-SPEC-30 section 4.5).
test('US-30-R53: the vault seals a value at rest under a key held outside the database', async () => {
  const b64 = bytes => Buffer.from(bytes).toString('base64');
  const key = b64(crypto.getRandomValues(new Uint8Array(32)));
  const db = makeDb([MIG]), v = createVault({ db, key });
  await v.put('ANTHROPIC_API_KEY', SECRET);
  const dump = JSON.stringify(db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(t => db.raw.prepare(`SELECT * FROM "${t.name}"`).all()));
  assert.ok(!dump.includes(SECRET), 'no table holds the value as given');
  assert.ok(!dump.includes(key), 'the key is not kept beside the values it seals');
  assert.equal(await v.read('ANTHROPIC_API_KEY'), SECRET, 'the value reads back with the key');
  const other = createVault({ db, key: b64(new Uint8Array(32)) });
  assert.notEqual(await other.read('ANTHROPIC_API_KEY').catch(() => null), SECRET, 'another key does not open it');
});

test('US-30-R53: a sealing vault still reads a value stored before it had a key, seals it on the next write, redacts and fills env from sealed values, and refuses a key of the wrong size', async () => {
  const b64 = bytes => Buffer.from(bytes).toString('base64');
  const key = b64(crypto.getRandomValues(new Uint8Array(32)));
  const db = makeDb([MIG]);
  await createVault({ db }).put('OPENAI_API_KEY', OTHER);
  const v = createVault({ db, key });
  assert.equal(v.sealed(), true); assert.equal(createVault({ db }).sealed(), false);
  assert.equal(await v.read('OPENAI_API_KEY'), OTHER, 'a value stored before the key is read as it was');
  await v.put('ANTHROPIC_API_KEY', SECRET); await v.put('OPENAI_API_KEY', OTHER);
  const stored = db.raw.prepare('SELECT value FROM vault_secrets ORDER BY name').all().map(r => r.value);
  assert.ok(stored.every(s => s.startsWith('enc:v1:')), 'both values are sealed once written with the key');
  assert.deepEqual(await v.withVault({ KEEP: 'k' }), { KEEP: 'k', ANTHROPIC_API_KEY: SECRET, OPENAI_API_KEY: OTHER });
  assert.equal(await v.redact(`a ${SECRET} b ${OTHER}`), 'a [redacted] b [redacted]');
  const keyless = createVault({ db });
  assert.equal(await keyless.read('ANTHROPIC_API_KEY'), null, 'without the key a sealed value reads as absent, never as its sealed text');
  assert.deepEqual(await keyless.withVault(), {});
  assert.throws(() => createVault({ db, key: b64(new Uint8Array(16)) }), /32 bytes/);
});

test('US-30-R53: a sealed value is bound to its name, has() agrees with read(), and with legacy off an unsealed row reads as absent', async () => {
  const b64 = bytes => Buffer.from(bytes).toString('base64');
  const key = b64(crypto.getRandomValues(new Uint8Array(32)));
  const db = makeDb([MIG]), v = createVault({ db, key });
  await v.put('ANTHROPIC_API_KEY', SECRET); await v.put('OPENAI_API_KEY', OTHER);
  // anyone who can write the database moves a sealed value to another name: it does not open there
  const sealed = db.raw.prepare("SELECT value FROM vault_secrets WHERE name = 'ANTHROPIC_API_KEY'").get().value;
  db.raw.prepare("UPDATE vault_secrets SET value = ? WHERE name = 'OPENAI_API_KEY'").run(sealed);
  assert.equal(await v.read('OPENAI_API_KEY'), null, 'a value sealed for one name does not open under another');
  assert.equal(await v.has('OPENAI_API_KEY'), false, 'has() reports what read() can use');
  assert.equal(await v.has('ANTHROPIC_API_KEY'), true);
  assert.equal(await createVault({ db, key: b64(new Uint8Array(32)) }).has('ANTHROPIC_API_KEY'), false, 'a key that does not open the value reads it as absent');
  // a plain value stored before the key is sealed at its first read, and once a deployment turns legacy off a planted plain row is absent
  db.raw.prepare("UPDATE vault_secrets SET value = ? WHERE name = 'OPENAI_API_KEY'").run(OTHER);
  assert.equal(await v.read('OPENAI_API_KEY'), OTHER);
  assert.ok(db.raw.prepare("SELECT value FROM vault_secrets WHERE name = 'OPENAI_API_KEY'").get().value.startsWith('enc:v1:'), 'sealed at its first read');
  const strict = createVault({ db, key, legacy: false });
  assert.equal(await strict.read('OPENAI_API_KEY'), OTHER, 'a sealed row still reads');
  db.raw.prepare("UPDATE vault_secrets SET value = ? WHERE name = 'OPENAI_API_KEY'").run('planted-plain-value');
  assert.equal(await strict.read('OPENAI_API_KEY'), null); assert.equal(await strict.has('OPENAI_API_KEY'), false);
  assert.deepEqual(Object.keys(await strict.withVault()), ['ANTHROPIC_API_KEY'], 'a planted plain row never reaches the env');
});
