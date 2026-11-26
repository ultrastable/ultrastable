// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../sqlite/d1-sqlite.js';
import { createServer, loadConfig } from '../server.js';

import { fileURLToPath } from 'node:url';
const MIG = fileURLToPath(new URL('../../../core/migrations', import.meta.url));

async function boot(env) {
  const db = openDb(':memory:', MIG);
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('A','a','staff','x',10,'open');`);
  const srv = createServer({ db, config: loadConfig({}), env });
  await new Promise(r => srv.listen(0, r));
  return { db, srv, base: `http://127.0.0.1:${srv.address().port}` };
}

test('Cloud Run adapter: unauthenticated /tick is refused, authenticated /tick runs every step', async () => {
  const { srv, base, db } = await boot({ TICK_TOKEN: 's3cret' });
  assert.equal((await fetch(`${base}/tick`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${base}/health`)).status, 503); // no tick yet
  const r = await fetch(`${base}/tick`, { method: 'POST', headers: { 'x-tick-token': 's3cret' } });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.completed, body.total);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  srv.close(); db.close();
});

test('no TICK_TOKEN configured: /tick refuses everyone', async () => {
  const { srv, base, db } = await boot({});
  assert.equal((await fetch(`${base}/tick`, { method: 'POST', headers: { 'x-tick-token': '' } })).status, 401);
  srv.close(); db.close();
});

test('the guided console runs on the Cloud Run adapter too: off without a key, on with one', async () => {
  const off = await boot({});
  assert.equal((await fetch(`${off.base}/console`)).status, 503);
  off.srv.close(); off.db.close();
  const { srv, base, db } = await boot({ CONSOLE_TOKEN: 'k3y' });
  assert.equal((await fetch(`${base}/api/console`)).status, 401);
  const login = await fetch(`${base}/console/login`, { method: 'POST', body: new URLSearchParams({ key: 'k3y' }), redirect: 'manual' });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const api = await fetch(`${base}/api/console`, { headers: { cookie } });
  assert.equal(api.status, 200);
  assert.ok((await api.json()).headline);
  const ask = await fetch(`${base}/api/console/ask`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'a page to book drills' }) });
  assert.equal(ask.status, 200);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM console_actions').get().n, 1);
  srv.close(); db.close();
});

test('US-14-R10 and US-14-R16: the Cloud Run server refuses to start when reviewer and doer resolve to one family while two are available', () => {
  const aliases = { small: { endpoint: 'edge', model: 'm1', family: 'family-a' }, medium: { endpoint: 'edge', model: 'm2', family: 'family-a' }, large: { endpoint: 'hosted', model: 'm3', family: 'family-b' } };
  const endpoints = { edge: async () => ({ text: '', tokens_in: 0, tokens_out: 0 }), hosted: async () => ({ text: '', tokens_in: 0, tokens_out: 0 }) };
  const mk = roles => {
    const db = openDb(':memory:', MIG);
    try { return createServer({ db, config: { ...loadConfig({}), modelport: { aliases, roles } }, env: {}, org: { endpoints } }); } finally { db.close(); }
  };
  assert.throws(() => mk({ doer: 'medium', reviewer: 'small' }), /modelport deploy check failed: reviewer and doer both resolve to family family-a/);
  const ok = mk({ doer: 'medium', reviewer: 'large' });
  assert.equal(typeof ok.listen, 'function', 'a good configuration starts');
});
