// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-18 T18-10 and T18-11: viewers and the confirm step in session mode, and Connect storing a pasted value as presence only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from '../test/d1shim.js';
import { createVault } from '../vault/index.js';
import { issueSession } from '../auth/index.js';
import { handleConsole } from '../src/console.js';

const U = 'https://x.example', KEY = 'k'.repeat(32), NOW = Date.UTC(2026, 10, 12), SECRET = 'sk-test-VALUE-9876543210';
async function setup() {
  const db = makeDb();
  for (const m of ['vault/migrations/0001_vault.sql', 'runner/migrations/0001_runner.sql', 'router/migrations/0001_router.sql']) db.raw.exec(readFileSync(new URL('../' + m, import.meta.url), 'utf8'));
  db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G1','Approve a spend','money','stays at zero','manual')`);
  const vault = createVault({ db });
  await vault.put('GITHUB_APP_CLIENT_ID', 'cid-12345678'); await vault.put('GITHUB_APP_CLIENT_SECRET', 'csecret-12345678'); await vault.put('SESSION_KEY', KEY);
  const as = async role => ({ cookie: 'us_session=' + await issueSession({ login: 'ann', role, key: KEY, now: NOW }) });
  const call = (path, headers = {}, init = {}) => handleConsole(new Request(U + path, { headers, ...init }), { DB: db }, { vault, config: { vcs: { repo: 'o/r' } }, now: () => NOW });
  const post = async (path, role, body, { confirm = true } = {}) => call(path, { ...(await as(role)), origin: U, 'content-type': 'application/json' }, { method: 'POST', body: JSON.stringify(confirm ? { ...body, confirm: true } : body) });
  return { db, vault, call, as, post };
}

test('T18-10 and US-18-R14: a viewer is refused every owner route, including the records route', async () => {
  const { call, as, post } = await setup();
  const viewer = await as('viewer');
  for (const path of ['/api/console', '/api/console/records', '/api/console/records?table=items', '/api/console/walkthrough']) assert.equal((await call(path, viewer)).status, 403, path);
  assert.equal((await post('/api/console/card', 'viewer', { id: 'G1', choice: 'done' })).status, 403);
  assert.equal((await post('/api/console/ask', 'viewer', { text: 'hello' })).status, 403);
  assert.equal((await call('/api/console/records')).status, 401, 'signed out');
});

test('T18-10 and US-18-R15: an owner write without the confirm step is refused with 428 and a confirmed one is recorded with who did it; explain is read only and records nothing', async () => {
  const { db, post } = await setup();
  assert.equal((await post('/api/console/card', 'owner', { id: 'G1', choice: 'done' }, { confirm: false })).status, 428);
  assert.equal(db.raw.prepare("SELECT status FROM gate_cards WHERE id='G1'").get().status, 'open');
  assert.equal((await post('/api/console/card', 'owner', { id: 'G1', choice: 'explain' })).status, 200);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM console_actions").get().n, 0);
  assert.equal((await post('/api/console/card', 'owner', { id: 'G1', choice: 'done' })).status, 200);
  const rows = db.raw.prepare("SELECT kind, ref, text FROM console_actions ORDER BY id").all().map(r => ({ ...r }));
  assert.deepEqual(rows, [{ kind: 'card_done', ref: 'G1', text: null }, { kind: 'signed_action', ref: 'card', text: 'ann' }]);
});

test('T18-11 and US-18-R16: a pasted value is stored, reported present with its source, and never returned, echoed or logged', async () => {
  const { db, call, as, post } = await setup();
  const r = await post('/api/console/secret', 'owner', { name: 'ANTHROPIC_API_KEY', value: SECRET });
  assert.equal(r.status, 200); assert.ok(!(await r.text()).includes(SECRET));
  const data = await (await call('/api/console', await as('owner'))).json();
  const c = data.connections.find(x => x.name === 'ANTHROPIC_API_KEY');
  assert.equal(c.present, true); assert.equal(c.source, 'console');
  assert.ok(!JSON.stringify(data).includes(SECRET));
  const logged = JSON.stringify([db.raw.prepare('SELECT * FROM console_actions').all()]);
  assert.ok(!logged.includes(SECRET), 'the value is not in the action log');
  const recs = await (await call('/api/console/records?table=console_actions', await as('owner'))).json();
  assert.ok(!JSON.stringify(recs).includes(SECRET));
  assert.equal((await post('/api/console/secret/remove', 'owner', { name: 'ANTHROPIC_API_KEY' })).status, 200);
  assert.equal((await (await call('/api/console', await as('owner'))).json()).connections.find(x => x.name === 'ANTHROPIC_API_KEY').present, false);
});
