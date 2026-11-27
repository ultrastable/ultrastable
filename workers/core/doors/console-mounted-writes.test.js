// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-18 R15 for the routes a mount serves: in session mode the walkthrough, read-back and profile writes carry the same confirm step and the same signed record as a card press.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createVault } from '../vault/index.js';
import { issueSession } from '../auth/index.js';
import { createElicit } from '../elicit/index.js';
import { createWalkthrough } from '../walkthrough/index.js';
import { handleConsole, MOUNTED_WRITES, isMountedWrite } from '../src/console.js';

const dir = p => fileURLToPath(new URL(p, import.meta.url));
const CATALOG = JSON.parse(readFileSync(dir('../walkthrough/catalog.json'), 'utf8'));
const U = 'https://x.example', KEY = 'k'.repeat(32), NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

async function setup() {
  const db = makeDb([dir('../elicit/migrations/'), dir('../walkthrough/migrations/')]);
  db.raw.exec(readFileSync(dir('../vault/migrations/0001_vault.sql'), 'utf8'));
  const vault = createVault({ db });
  await vault.put('GITHUB_APP_CLIENT_ID', 'cid-12345678'); await vault.put('GITHUB_APP_CLIENT_SECRET', 'csecret-12345678'); await vault.put('SESSION_KEY', KEY);
  const elicit = createElicit({ db, now: () => NOW, config: { daily_cap: 20, max_open: 9, defer_below: 0 } });
  const wt = createWalkthrough({ db, elicit, now: () => NOW, config: { catalog: CATALOG } });
  const mounts = [async (request, { actor }) => wt.handle(request, { person: actor || 'owner' })];
  const cookie = async role => 'us_session=' + await issueSession({ login: 'ann', role, key: KEY, now: NOW });
  const post = async (path, body, { role = 'owner', confirm = true, origin = U } = {}) => handleConsole(new Request(U + path, {
    method: 'POST', headers: { cookie: await cookie(role), 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(confirm ? { ...body, confirm: true } : body) }),
  { DB: db }, { vault, mounts, config: { vcs: { repo: 'o/r' } }, now: () => NOW });
  const signed = () => db.raw.prepare("SELECT ref, text FROM console_actions WHERE kind='signed_action' ORDER BY id").all().map(r => ({ ...r }));
  return { db, wt, post, signed };
}

test('US-18-R15: a walkthrough, read-back or profile write without the confirm step is refused with 428 and changes nothing', async () => {
  const { db, post, signed } = await setup();
  for (const [path, body] of [['/api/console/walkthrough/idea', { text: 'A page for my chess club' }], ['/api/console/walkthrough/answer', { need_id: 'x', choice: 'first' }], ['/api/console/readback', { confirm_readback: true }], ['/api/console/profile', { detail: 'more' }]]) {
    const r = await post(path, body, { confirm: false });
    assert.equal(r.status, 428, path); assert.match((await r.json()).error, /confirm required/);
  }
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM walkthrough_state').get().n, 0, 'the idea was not stored');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM walkthrough_profiles').get().n, 0);
  assert.deepEqual(signed(), []);
});

test('US-18-R15: a confirmed walkthrough write succeeds and is recorded as signed_action with the login; a trailing slash is the same route', async () => {
  const { db, post, signed } = await setup();
  assert.equal((await post('/api/console/walkthrough/idea', { text: 'A page for my chess club' })).status, 200);
  assert.equal(db.raw.prepare("SELECT idea_text FROM walkthrough_state WHERE person='ann'").get().idea_text, 'A page for my chess club', 'the person is the signed-in login');
  assert.equal((await post('/api/console/profile', { detail: 'more' })).status, 200);
  assert.equal((await post('/api/console/profile/', { detail: 'brief' })).status, 200);
  assert.deepEqual(signed(), [{ ref: 'walkthrough/idea', text: 'ann' }, { ref: 'profile', text: 'ann' }, { ref: 'profile', text: 'ann' }]);
  assert.equal((await post('/api/console/profile', { detail: 'nonsense' })).status, 400);
  assert.equal(signed().length, 3, 'a refused write is not recorded as a signed action');
});

test('US-18-R15: a Tell me more press only explains and is not recorded as a signed action', async () => {
  const { wt, post, signed } = await setup();
  await post('/api/console/walkthrough/idea', { text: 'A page for my chess club' });
  const before = signed().length;
  const first = await wt.current('ann');
  const r = await post('/api/console/walkthrough/answer', { need_id: first.card.need_id, choice: 'Tell me more' });
  assert.equal(r.status, 200); assert.ok((await r.json()).explain);
  assert.equal(signed().length, before);
});

test('US-18-R09 and R15: a mounted write from another origin, from no origin, or from a viewer is refused before any confirm or change', async () => {
  const { db, post } = await setup();
  assert.equal((await post('/api/console/walkthrough/idea', { text: 'x' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/console/walkthrough/idea', { text: 'x' }, { origin: null })).status, 403);
  assert.equal((await post('/api/console/walkthrough/idea', { text: 'x' }, { role: 'viewer' })).status, 403);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM walkthrough_state').get().n, 0);
});

test('US-18-R15: the routes held to the confirm step are exactly the writes the walkthrough mount serves and the act and reverse writes of the staff screen', () => {
  assert.deepEqual([...MOUNTED_WRITES].sort(), ['/api/console/profile', '/api/console/readback', '/api/console/walkthrough/answer', '/api/console/walkthrough/idea']);
  for (const p of MOUNTED_WRITES) assert.equal(isMountedWrite(p), true, p);
  for (const p of ['/api/staff/operations/act', '/api/staff/product-manager/reverse']) assert.equal(isMountedWrite(p), true, p);
  for (const p of ['/api/staff', '/api/staff/operations', '/api/staff/operations/other', '/api/staff/a/b/act', '/api/console/card', '/api/console/ask']) assert.equal(isMountedWrite(p), false, p);
});

test('US-18-R15: a staff act or reverse without the confirm step is refused with 428 before the screen runs; a confirmed one runs and is recorded as signed_action', async () => {
  const { db, signed } = await setup();
  const vault = createVault({ db }); let ran = 0;
  const staff = async request => { const u = new URL(request.url); if (!u.pathname.startsWith('/api/staff')) return null; ran++; return Response.json({ ok: true }); };
  const cookie = 'us_session=' + await issueSession({ login: 'ann', role: 'owner', key: KEY, now: NOW });
  const send = (path, body, origin = U) => handleConsole(new Request(U + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }),
    { DB: db }, { vault, mounts: [staff], config: { vcs: { repo: 'o/r' } }, now: () => NOW });
  assert.equal((await send('/api/staff/operations/act', { action: 'x' })).status, 428); assert.equal(ran, 0);
  assert.equal((await send('/api/staff/operations/reverse', { action: 'x' }, 'https://evil.example')).status, 403); assert.equal(ran, 0);
  assert.equal((await send('/api/staff/operations/act', { action: 'x', confirm: true })).status, 200); assert.equal(ran, 1);
  assert.deepEqual(signed(), [{ ref: 'staff/operations/act', text: 'ann' }]);
});
