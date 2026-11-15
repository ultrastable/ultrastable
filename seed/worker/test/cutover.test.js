// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// ACCOUNT-SPLIT-2: one primary across two Cloudflare accounts; the standby promotes itself when it holds a GitHub credential.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { decide, healthView, readState, RESUME_BEATS, GATE_ID, copyFromSource, retireSource } from '../src/cutover.js';

const peer = (body, ok = true) => async () => { if (!ok) throw new Error('unreachable'); return { json: async () => body }; };
const gate = db => db.raw.prepare('SELECT status FROM gate_cards WHERE id=?').get(GATE_ID);

test('without a peer the tick is primary and runs (no change for a single account)', async () => {
  const db = makeDb();
  const r = await decide(db, {}, { fetch: peer(null) });
  assert.equal(r.run, true); assert.equal(r.slot, 'primary'); assert.equal(r.epoch, 1);
});

test('a standby without a GitHub credential runs nothing, and the primary keeps one gate card open', async () => {
  const t = makeDb(), s = makeDb();
  const r = await decide(t, { SLOT: 'standby', CUTOVER_PEER: 'https://src' }, { fetch: peer({ cutover: { slot: 'primary', epoch: 1 } }), githubOk: async () => false });
  assert.equal(r.run, false); assert.equal((await healthView(t, { SLOT: 'standby' })).ready, false);
  const p = await decide(s, { CUTOVER_PEER: 'https://dst' }, { fetch: peer({ cutover: { slot: 'standby', epoch: 1, github_ok: false } }) });
  assert.equal(p.run, true); assert.equal(gate(s).status, 'open');
  await decide(s, { CUTOVER_PEER: 'https://dst' }, { fetch: peer({ cutover: { slot: 'standby', epoch: 1, github_ok: true } }) });
  assert.equal(gate(s).status, 'closed', 'the gate closes itself when the target holds the credential');
});

test('the standby promotes itself: final copy, epoch above the peer, source retired; it runs from the next beat', async () => {
  const t = makeDb(); const calls = [];
  const env = { SLOT: 'standby', CUTOVER_PEER: 'https://src' };
  const r = await decide(t, env, { fetch: peer({ cutover: { slot: 'primary', epoch: 1 } }), githubOk: async () => true,
    copy: async () => { calls.push('copy'); return { ok: true }; }, retire: async () => { calls.push('retire'); return []; } });
  assert.equal(r.promoted, true); assert.equal(r.epoch, 2); assert.deepEqual(calls, ['copy', 'retire']);
  const next = await decide(t, env, { fetch: peer({ cutover: { slot: 'primary', epoch: 1 } }) });
  assert.equal(next.run, true, 'the stored slot overrides env.SLOT after promotion'); assert.equal(next.slot, 'primary');
});

test('a failed final copy defers promotion; nothing is retired', async () => {
  const t = makeDb(); let retired = false;
  const r = await decide(t, { SLOT: 'standby', SOURCE_CF_TOKEN: 'x' }, { fetch: peer(null), githubOk: async () => true, copy: async () => ({ ok: false, detail: 'boom' }), retire: async () => { retired = true; } });
  assert.equal(r.run, false); assert.equal(r.slot, 'standby'); assert.equal(retired, false);
});

test('the old primary demotes itself when the peer is primary at a higher epoch, and resumes only after the peer is gone', async () => {
  const s = makeDb(); const env = { CUTOVER_PEER: 'https://dst' };
  const d = await decide(s, env, { fetch: peer({ cutover: { slot: 'primary', epoch: 2 } }) });
  assert.equal(d.run, false); assert.equal(d.slot, 'demoted');
  for (let i = 1; i < RESUME_BEATS; i++) assert.equal((await decide(s, env, { fetch: peer(null, false) })).run, false);
  const back = await decide(s, env, { fetch: peer(null, false) });
  assert.equal(back.run, true); assert.equal(back.epoch, 3, 'resumes above the epoch it last saw');
});

test('a peer on older code counts as primary at epoch 1', async () => {
  const t = makeDb();
  const r = await decide(t, { SLOT: 'standby', CUTOVER_PEER: 'https://src' }, { fetch: peer({ ok: true }), githubOk: async () => true, copy: async () => ({ ok: true }), retire: async () => [] });
  assert.equal(r.epoch, 2);
});

test('the final copy writes every source table except local ones, with bound values', async () => {
  const db = makeDb();
  db.raw.exec("CREATE TABLE IF NOT EXISTS credentials (tenant TEXT NOT NULL, provider TEXT NOT NULL, sealed TEXT, meta TEXT NOT NULL DEFAULT '{}', access_sealed TEXT, expires_at TEXT, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, updated_at TEXT, PRIMARY KEY (tenant, provider))");
  db.raw.exec("INSERT INTO credentials (tenant, provider, sealed) VALUES ('t','github-app','mine')");
  const src = { items: { sql: 'CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT)', rows: [{ id: 'A', title: "it's" }] }, credentials: { sql: 'CREATE TABLE credentials (x TEXT)', rows: [{ x: 'theirs' }] } };
  const f = async (url, o) => {
    const sql = JSON.parse(o.body).sql; let results = [];
    if (/FROM sqlite_master WHERE type = 'table'/.test(sql)) results = Object.entries(src).map(([name, t]) => ({ name, sql: t.sql }));
    else if (/pragma_table_info\('items'\)/.test(sql)) results = [{ name: 'id' }, { name: 'title' }];
    else if (/FROM "items" LIMIT/.test(sql)) results = /OFFSET 0/.test(sql) ? src.items.rows : [];
    return { json: async () => ({ success: true, result: [{ results }] }) };
  };
  const r = await copyFromSource({ SOURCE_CF_TOKEN: 't', SOURCE_ACCOUNT: 'a', SOURCE_ORG_D1: 'd' }, db, f);
  assert.equal(r.ok, true); assert.equal(r.tables, 1);
  assert.equal(db.raw.prepare("SELECT title FROM items WHERE id='A'").get().title, "it's");
  assert.equal(db.raw.prepare('SELECT sealed FROM credentials').get().sealed, 'mine', 'this account keeps its own credentials');
});

test('retiring the source turns its crons off and makes its site forward', async () => {
  const seen = [];
  const out = await retireSource({ SOURCE_CF_TOKEN: 't', SOURCE_ACCOUNT: 'a', TARGET_SITE_ORIGIN: 'https://site.dst' }, async (url, o) => { seen.push(o.method + ' ' + url.replace('https://api.cloudflare.com/client/v4/accounts/a', '')); return { ok: true, status: 200 }; });
  assert.equal(out.length, 4); assert.ok(out.every(x => x.ok));
  assert.ok(seen.includes('PUT /workers/scripts/ultrastable-tick/schedules') && seen.includes('PUT /workers/scripts/ultrastable-site/secrets'));
});

test('a primary without its own GitHub credential keeps its gate open, and closes it when the credential arrives', async () => {
  const db = makeDb(); const env = { SELF_ORIGIN: 'https://tick.dst' };
  assert.equal((await decide(db, env, { fetch: peer(null), githubOk: async () => false })).run, true);
  assert.equal(gate(db).status, 'open');
  await decide(db, env, { fetch: peer(null), githubOk: async () => true });
  assert.equal(gate(db).status, 'closed');
});
