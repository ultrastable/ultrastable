// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-14-R11 over the Firestore REST driver and a fake Firestore server (no network): create-only writes, indexed queries, transactions with
// optimistic conflict detection and retry, and the rewritten L1 steps running on it. The fake honours preconditions and aborts a commit whose
// reads changed, as the real service does; it yields to the event loop on every request so concurrent callers interleave.
import test from 'node:test';
import assert from 'node:assert/strict';
import { firestoreDocStore, toFields, fromFields, FirestoreError } from './firestore.js';
import { claim, STEPS, runDocTick } from './index.js';

const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
const NOW = '2026-11-15 12:00:00';
const TOKEN = 'ya29.secret-token-value';
const policy = { trust: { baseline: 0.5, prior_weight: 4 }, ladder: { rungs: ['observed', 'assisted'], ceiling_by_max_permission: {}, promote_when: { min_outcomes: 99, min_reliability: 1 }, demote_when: { reliability_below: 0 } }, surfaces: {} };
const config = { claim_ttl_minutes: 120, max_wip_per_role: 5, plus_share: 0.2, policy };

/** A fake Firestore: documents with versions, collection versions, transactions that abort on a changed read. */
function fakeFirestore() {
  const colls = new Map(); const docVer = new Map(); const collVer = new Map(); const txs = new Map();
  let txn = 0; const log = []; const root = '/v1/projects/p/databases/(default)/documents';
  const coll = c => { if (!colls.has(c)) colls.set(c, new Map()); return colls.get(c); };
  const bump = (c, key) => { docVer.set(`${c}/${key}`, (docVer.get(`${c}/${key}`) || 0) + 1); collVer.set(c, (collVer.get(c) || 0) + 1); };
  const reply = (status, body) => new Response(JSON.stringify(body ?? {}), { status, headers: { 'content-type': 'application/json' } });
  const nameOf = (c, key) => `projects/p/databases/(default)/documents/${c}/${key}`;
  const docJson = (c, key) => ({ name: nameOf(c, key), fields: coll(c).get(key) });
  const matches = (fields, filter) => {
    if (!filter) return true;
    if (filter.compositeFilter) return filter.compositeFilter.filters.every(f => matches(fields, f));
    const { field, op, value } = filter.fieldFilter; const got = fromFields({ x: fields[field.fieldPath] }).x; const want = fromFields({ x: value }).x;
    return op === 'IN' ? want.includes(got) : got === want;
  };
  const write = (w) => {
    if (w.delete) { const [c, key] = w.delete.split('/documents/')[1].split('/'); coll(c).delete(key); bump(c, key); return; }
    const [c, key] = w.update.name.split('/documents/')[1].split('/');
    const cur = coll(c).get(key);
    if (w.updateMask) coll(c).set(key, { ...(cur || {}), ...Object.fromEntries(w.updateMask.fieldPaths.map(f => [f, w.update.fields[f]])) }); else coll(c).set(key, w.update.fields);
    bump(c, key);
  };
  async function handle(rawUrl, init = {}) {
    await new Promise(r => setImmediate(r));
    const u = new URL(rawUrl); const method = init.method || 'GET'; const body = init.body ? JSON.parse(init.body) : undefined;
    assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
    log.push(`${method} ${u.pathname.replace(root, '')}`);
    const rest = u.pathname.slice(root.length);
    if (rest === ':beginTransaction') { const id = `tx-${++txn}`; txs.set(id, { docs: new Map(), colls: new Map() }); return reply(200, { transaction: id }); }
    if (rest === ':rollback') { txs.delete(body.transaction); return reply(200); }
    if (rest === ':runQuery') {
      const q = body.structuredQuery; const c = q.from[0].collectionId;
      if (body.transaction) txs.get(body.transaction).colls.set(c, collVer.get(c) || 0);
      let rows = [...coll(c)].filter(([, f]) => matches(f, q.where)).map(([key, f]) => ({ key, f }));
      rows.sort((a, b) => { for (const o of q.orderBy || []) { const fp = o.field.fieldPath; const av = fp === '__name__' ? a.key : fromFields({ x: a.f[fp] }).x; const bv = fp === '__name__' ? b.key : fromFields({ x: b.f[fp] }).x; if (av !== bv) return (av ?? '') < (bv ?? '') ? -1 : 1; } return 0; });
      if (q.limit) rows = rows.slice(0, q.limit);
      return reply(200, rows.length ? rows.map(r => ({ document: docJson(c, r.key) })) : [{ readTime: 'now' }]);
    }
    if (rest === ':commit') {
      const t = txs.get(body.transaction); if (!t) return reply(400, { error: { status: 'INVALID_ARGUMENT' } });
      for (const [p, v] of t.docs) if ((docVer.get(p) || 0) !== v) { txs.delete(body.transaction); return reply(409, { error: { status: 'ABORTED' } }); }
      for (const [c, v] of t.colls) if ((collVer.get(c) || 0) !== v) { txs.delete(body.transaction); return reply(409, { error: { status: 'ABORTED' } }); }
      for (const w of body.writes) if (w.currentDocument) { const [c, key] = (w.update?.name || w.delete).split('/documents/')[1].split('/'); if (coll(c).has(key) !== w.currentDocument.exists) { txs.delete(body.transaction); return reply(409, { error: { status: 'ABORTED' } }); } }
      for (const w of body.writes) write(w);
      txs.delete(body.transaction); return reply(200, { writeResults: [] });
    }
    const parts = rest.split('/').filter(Boolean).map(decodeURIComponent);
    const [c, key] = parts;
    if (method === 'POST') {                                              // create
      const id = u.searchParams.get('documentId');
      if (coll(c).has(id)) return reply(409, { error: { status: 'ALREADY_EXISTS' } });
      coll(c).set(id, body.fields); bump(c, id); return reply(200, docJson(c, id));
    }
    if (method === 'GET' && !key) {                                       // list, two documents per page
      const keys = [...coll(c).keys()].sort(); const start = Number(u.searchParams.get('pageToken') || 0); const size = Math.min(Number(u.searchParams.get('pageSize')), 2);
      const page = keys.slice(start, start + size);
      return reply(200, { documents: page.map(k => docJson(c, k)), ...(start + size < keys.length ? { nextPageToken: String(start + size) } : {}) });
    }
    if (method === 'GET') {
      const tid = u.searchParams.get('transaction'); if (tid) txs.get(tid).docs.set(`${c}/${key}`, docVer.get(`${c}/${key}`) || 0);
      return coll(c).has(key) ? reply(200, docJson(c, key)) : reply(404, { error: { status: 'NOT_FOUND' } });
    }
    if (method === 'PATCH') {
      const mask = u.searchParams.getAll('updateMask.fieldPaths'); const need = u.searchParams.get('currentDocument.exists');
      if (need === 'true' && !coll(c).has(key)) return reply(404, { error: { status: 'NOT_FOUND' } });
      write({ update: { name: nameOf(c, key), fields: body.fields }, ...(mask.length ? { updateMask: { fieldPaths: mask } } : {}) });
      return reply(200, docJson(c, key));
    }
    if (method === 'DELETE') { const had = coll(c).has(key); write({ delete: nameOf(c, key) }); return had ? reply(200) : reply(404); }
    return reply(400, { error: { status: 'INVALID_ARGUMENT' } });
  }
  const fetch = (u, init) => handle(u, init);
  return { fetch, log, colls };
}
const mk = (over = {}) => { const f = fakeFirestore(); return { f, store: firestoreDocStore({ fetch: f.fetch, project: 'p', token: TOKEN, now: () => T0, ...over }) }; };
const item = (o = {}) => ({ title: 't', kind: 'work', project: null, owner_role: 'staff', trigger_on: null, done_check: 'x', closing_probe: null, priority: 10, status: 'ready', disposition: null, blocker: null, surface: null, action_class: null, created_at: NOW, updated_at: NOW, ...o });

test('the driver encodes and decodes document values: integers, doubles, null, booleans, arrays and maps', () => {
  const doc = { a: 1, b: 1.5, c: null, d: true, e: 'text', f: [1, 'x'], g: { h: 2 } };
  assert.deepEqual(fromFields(toFields(doc)), doc);
  assert.deepEqual(toFields({ n: 3 }), { n: { integerValue: '3' } });
});

test('the driver passes the document port scenarios: create-only, indexed query, patch, remove, add keys that increase, a paged scan', async () => {
  const { store } = mk();
  assert.equal(await store.create('items', 'A', item()), true);
  assert.equal(await store.create('items', 'A', item({ title: 'other' })), false, 'create never overwrites');
  assert.equal((await store.get('items', 'A')).title, 't'); assert.equal(await store.get('items', 'NOPE'), null);
  await store.set('items', 'B', item({ priority: 5 })); await store.set('items', 'C', item({ status: 'done' }));
  assert.deepEqual((await store.query('items', { where: { status: 'ready', owner_role: 'staff' }, orderBy: ['priority'] })).map(r => r.key), ['B', 'A']);
  assert.deepEqual((await store.query('items', { where: { status: ['done', 'open'] } })).map(r => r.key), ['C']);
  await assert.rejects(() => store.query('items', { where: { title: 't' } }), /no index on items/);
  assert.equal(await store.patch('items', 'A', { status: 'claimed' }), true);
  assert.equal((await store.get('items', 'A')).status, 'claimed'); assert.equal((await store.get('items', 'A')).title, 't', 'a patch changes only its fields');
  assert.equal(await store.patch('items', 'NOPE', { status: 'x' }), false);
  assert.equal(await store.remove('items', 'C'), true); assert.equal(await store.remove('items', 'C'), false);
  const k1 = await store.add('outcomes', { result: 'a' }); const k2 = await store.add('outcomes', { result: 'b' });
  assert.ok(k2 > k1, 'store-assigned keys increase');
  for (const k of ['D', 'E', 'F']) await store.set('items', k, item());
  assert.equal((await store.scan('items')).length, 5, 'the scan follows the page token');
});

test('a transaction that throws writes nothing; one that returns commits its writes together', async () => {
  const { store } = mk();
  await store.set('items', 'A', item());
  await assert.rejects(() => store.transaction(async tx => { await tx.patch('items', 'A', { status: 'claimed' }); throw new Error('stop'); }), /stop/);
  assert.equal((await store.get('items', 'A')).status, 'ready');
  const r = await store.transaction(async tx => { await tx.create('claims', 'A', { item_id: 'A' }); await tx.patch('items', 'A', { status: 'claimed' }); return 'ok'; });
  assert.equal(r, 'ok'); assert.equal((await store.get('items', 'A')).status, 'claimed'); assert.ok(await store.get('claims', 'A'));
});

test('US-14-R11: fifty concurrent claimers over the Firestore REST driver and its fake server produce one winner', async () => {
  const { store } = mk();
  await store.set('items', 'A', item());
  const results = await Promise.all(Array.from({ length: 50 }, (_, i) => claim(store, 'A', `agent-${i}`, NOW)));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.filter(r => !r.ok && r.reason === 'already_claimed').length, 49);
  assert.equal((await store.scan('claims')).length, 1); assert.equal((await store.get('items', 'A')).status, 'claimed');
});

test('US-14-R11: concurrent dispatchers claim different items and never the same one twice; the transaction sees its own writes', async () => {
  const { store } = mk();
  for (let i = 0; i < 4; i++) await store.set('items', `I${i}`, item({ priority: i }));
  for (const r of ['r1', 'r2', 'r3']) await store.set('roles', r, { role: 'staff', project: null, tick_every: 1, model: 'm', last_tick_at: null });
  const ctx = () => ({ config, now: T0, nowIso: NOW, tickId: 1, notes: [], errors: [], dispatched: 0 });
  await Promise.all([1, 2, 3].map(() => STEPS.dispatch(store, ctx())));
  const claims = await store.scan('claims');
  assert.equal(new Set(claims.map(c => c.key)).size, claims.length);
  assert.ok(claims.length >= 3 && claims.length <= 4, `${claims.length} claims`);
  assert.equal((await store.scan('dispatches')).length, claims.length);
  // an item read inside a transaction after the same transaction wrote it shows the write
  const seen = await store.transaction(async tx => { await tx.add('outcomes', { surface: 'dispatch', action_class: 'claim_release', result: 'unworked', item_id: 'Z' }); return (await tx.query('outcomes', { where: { surface: 'dispatch', action_class: 'claim_release' } })).length; });
  assert.equal(seen, 1);
});

test('the rewritten L1 steps run a whole tick over the driver: all eight complete', async () => {
  const { store } = mk();
  await store.set('roles', 'staff-1', { role: 'staff', project: null, tick_every: 1, model: 'm', last_tick_at: null });
  await store.set('items', 'A', item({ status: 'open' }));
  await store.set('gate_cards', 'G', { what: 'a', why_gated: 'b', default_in_effect: 'c', closing_probe: 'env:X', status: 'open' });
  const r = await runDocTick(store, { config, env: { X: true }, now: T0, tickId: 1 });
  assert.equal(r.completed, 8); assert.deepEqual(r.errors, []);
  assert.equal((await store.get('gate_cards', 'G')).status, 'closed'); assert.ok(await store.get('claims', 'A'));
});

test('the token is never in an error; a missing token and a refusal are plain errors', async () => {
  const refused = firestoreDocStore({ fetch: async () => new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: `bad ${TOKEN}` } }), { status: 403 }), project: 'p', token: TOKEN });
  const e = await refused.get('items', 'A').catch(x => x);
  assert.ok(e instanceof FirestoreError); assert.equal(e.status, 403); assert.ok(!e.message.includes(TOKEN));
  const none = firestoreDocStore({ fetch: async () => new Response('{}'), project: 'p', token: async () => '' });
  await assert.rejects(() => none.get('items', 'A'), /no token is present/);
  assert.throws(() => firestoreDocStore({ fetch: async () => {} }), /project is required/);
});

test('a transaction aborted by other writers more than the retry bound is an error, not a silent loss', async () => {
  const { f } = mk();
  const stubborn = firestoreDocStore({ fetch: async (u, init) => (String(u).endsWith(':commit') ? new Response('{"error":{"status":"ABORTED"}}', { status: 409 }) : f.fetch(u, init)), project: 'p', token: TOKEN, retries: 3 });
  await assert.rejects(() => stubborn.transaction(async tx => { await tx.create('claims', 'A', {}); }), /aborted 3 times/);
});
