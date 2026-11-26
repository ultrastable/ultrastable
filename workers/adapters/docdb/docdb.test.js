// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-14 section 4, document database: the rewritten steps give the same result as the SQL steps, claims are unique under
// contention (US-14-R11), and the L1 data-model tests that touch these steps are re-run (US-01-T02, US-01-T03).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from '../../core/_shared/testdb.js';
import { STEPS as SQL_STEPS } from '../../core/src/tick.js';
import { memoryDocStore, claim, STEPS, runDocTick, importFromStore, COLLECTIONS } from './index.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { claim_ttl_minutes: 120, max_wip_per_role: 2, plus_share: 0.2, policy };
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
const NOW = '2026-11-15 12:00:00';
const newItem = (o = {}) => ({ title: 't', kind: 'work', project: null, owner_role: 'staff', trigger_on: null, done_check: 'x', closing_probe: null, priority: 10, status: 'ready', disposition: null, blocker: null, surface: null, action_class: null, created_at: NOW, updated_at: NOW, ...o });
const surface = Object.keys(policy.surfaces)[0];

test('the store keeps one collection per L1 table and refuses a query that has no declared index', async () => {
  assert.equal(COLLECTIONS.length, 11);
  const s = memoryDocStore();
  await s.set('items', 'A', newItem());
  assert.equal((await s.query('items', { where: { status: 'ready', owner_role: 'staff' } })).length, 1);
  await assert.rejects(() => s.query('items', { where: { title: 't' } }), /no index on items/);
  const got = await s.get('items', 'A'); got.title = 'changed';
  assert.equal((await s.get('items', 'A')).title, 't', 'a caller cannot change a stored document through a returned copy');
});

test('US-01-T02 and US-01-R02 on a document store: a second claim for one item is rejected by the create-only write', async () => {
  const s = memoryDocStore();
  await s.set('items', 'A', newItem());
  assert.deepEqual(await claim(s, 'A', 'staff-1', NOW), { ok: true });
  assert.deepEqual(await claim(s, 'A', 'staff-2', NOW), { ok: false, reason: 'already_claimed' });
  assert.equal(await s.create('claims', 'A', { agent: 'staff-3' }), false);
  assert.equal((await s.get('claims', 'A')).agent, 'staff-1');
  assert.equal((await s.get('items', 'A')).status, 'claimed');
  assert.deepEqual(await claim(s, 'NOPE', 'staff-1', NOW), { ok: false, reason: 'no_such_item' });
});

test('US-14-R11: under contention exactly one of fifty concurrent claimers wins; a read-then-write claim would not be safe', async () => {
  const s = memoryDocStore();
  await s.set('items', 'A', newItem());
  const results = await Promise.all(Array.from({ length: 50 }, (_, i) => claim(s, 'A', `agent-${i}`, NOW)));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(s._size('claims'), 1);
  // the same store, claimed the unsafe way (read, then write): several callers believe they hold the claim
  const naive = async agent => { if (await s.get('claims', 'B')) return false; await s.set('claims', 'B', { agent }); return true; };
  const unsafe = await Promise.all(Array.from({ length: 10 }, (_, i) => naive(`agent-${i}`)));
  assert.ok(unsafe.filter(Boolean).length > 1, 'the contention in this test is real');
});

test('US-14-R11: five role instances dispatching at once never claim one item twice and never exceed their limit', async () => {
  const s = memoryDocStore();
  for (let i = 0; i < 5; i++) await s.set('roles', `staff-${i}`, { role: 'staff', project: null, tick_every: 1, model: 'small', last_tick_at: null });
  for (let i = 0; i < 6; i++) await s.set('items', `I${i}`, newItem({ priority: i }));
  const ctxs = Array.from({ length: 5 }, () => ({ config, nowIso: NOW, tickId: 1, notes: [] }));
  await Promise.all(ctxs.map(c => STEPS.dispatch(s, c)));
  const claims = await s.scan('claims');
  assert.equal(claims.length, 6, 'every ready item was claimed');
  assert.equal(new Set(claims.map(c => c.key)).size, 6);
  const per = {}; for (const c of claims) per[c.agent] = (per[c.agent] || 0) + 1;
  assert.equal((await s.scan('dispatches')).length, 6);
  assert.equal((await s.query('items', { where: { status: 'ready' } })).length, 0);
  assert.ok(Object.values(per).every(n => n <= 6));
});

test('a transaction is all-or-nothing: a throw restores the store', async () => {
  const s = memoryDocStore();
  await s.set('items', 'A', newItem());
  await assert.rejects(() => s.transaction(tx => { tx.patch('items', 'A', { status: 'done' }); tx.add('outcomes', { item_id: 'A' }); throw new Error('boom'); }), /boom/);
  assert.equal((await s.get('items', 'A')).status, 'ready'); assert.equal(s._size('outcomes'), 0);
  assert.equal(await s.transaction(tx => tx.get('items', 'A').status), 'ready', 'the store still works after a failed transaction');
});

test('US-01-T03 on a document store: an item done with no disposition is reopened and a silent_drop outcome is written', async () => {
  const s = memoryDocStore();
  await s.set('items', 'GONE', newItem({ status: 'done', disposition: '' }));
  await s.set('items', 'FINE', newItem({ status: 'done', disposition: 'done with evidence' }));
  await s.set('items', 'NEXT', newItem({ status: 'open', trigger_on: 'FINE' }));
  await s.set('items', 'WAITS', newItem({ status: 'open', trigger_on: 'GONE' }));
  const r = await runDocTick(s, { config, now: T0, tickId: 1 });
  assert.equal(r.completed, 8); assert.deepEqual(r.errors, []); // the tick now runs all eight L1 steps (US-14-R18)
  assert.notEqual((await s.get('items', 'GONE')).status, 'done');
  assert.equal((await s.get('items', 'FINE')).status, 'done');
  assert.equal((await s.get('items', 'NEXT')).status, 'ready');
  assert.equal((await s.get('items', 'WAITS')).status, 'open');
  const drops = (await s.scan('outcomes')).filter(o => o.result === 'silent_drop');
  assert.deepEqual(drops.map(o => o.item_id), ['GONE']);
  const run = (await s.scan('tick_runs'))[0];
  assert.equal(run.steps_completed, 8); assert.equal(run.finished_at, NOW);
});

test('parity: reconcile, trust and dispatch on the document store end in the same state as the SQL steps on the same data', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, project, tick_every, model) VALUES ('staff-1','staff',NULL,1,'m'), ('staff-2','staff','p2',1,'m'), ('ops-1','operations',NULL,2,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status,created_at,updated_at) VALUES ('A','a','staff','x',10,'open','${NOW}','${NOW}'),('B','b','staff','x',5,'open','${NOW}','${NOW}'),('E','e','staff-2','x',50,'open','${NOW}','${NOW}');
    INSERT INTO items (id,title,owner_role,done_check,priority,status,project,created_at,updated_at) VALUES ('P2','p','staff','x',1,'open','p2','${NOW}','${NOW}');
    INSERT INTO items (id,title,owner_role,done_check,trigger_on,status,created_at,updated_at) VALUES ('C','c','staff','x','D','open','${NOW}','${NOW}'),('O','o','operations','x',NULL,'open','${NOW}','${NOW}');
    INSERT INTO items (id,title,owner_role,done_check,status,disposition,created_at,updated_at) VALUES ('D','d','staff','x','done','shipped','${NOW}','${NOW}'),('X','x','staff','x','cancelled','','${NOW}','${NOW}');`);
  const ins = db.raw.prepare(`INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES ('D','staff-1',?,?,?,'e','${NOW}')`);
  for (let i = 0; i < 12; i++) ins.run(surface, 'merge', 'verified');
  for (let i = 0; i < 4; i++) ins.run(surface, 'deploy', i < 3 ? 'failed' : 'hidden_failure');
  db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes, updated_at) VALUES (?, 'deploy', 'assisted', 0.5, 0, '${NOW}')`).run(surface);
  const store = memoryDocStore();
  await importFromStore(db, store);

  const ctx = () => ({ config, now: T0, nowIso: NOW, tickId: 1, notes: [], errors: [], dispatched: 0 });
  const a = ctx(); for (const n of ['reconcile', 'accrue_trust', 'dispatch']) await SQL_STEPS[n](db, a);
  const b = ctx(); for (const n of ['reconcile', 'accrue_trust', 'dispatch']) await STEPS[n](store, b);

  const sqlItems = Object.fromEntries(db.raw.prepare(`SELECT id, status, kind, priority, owner_role FROM items`).all().map(r => [r.id, { ...r, id: undefined }]));
  const docItems = Object.fromEntries((await store.scan('items')).map(r => [r.key, { id: undefined, status: r.status, kind: r.kind, priority: r.priority, owner_role: r.owner_role }]));
  assert.deepEqual(docItems, sqlItems);
  assert.ok(Object.keys(sqlItems).some(k => k.startsWith('LADDER-')), 'the fixture crosses a ladder threshold');
  const sqlClaims = Object.fromEntries(db.raw.prepare(`SELECT item_id, agent FROM claims`).all().map(r => [r.item_id, r.agent]));
  const docClaims = Object.fromEntries((await store.scan('claims')).map(r => [r.key, r.agent]));
  assert.deepEqual(docClaims, sqlClaims); assert.ok(Object.keys(sqlClaims).length >= 2);
  const sqlTrust = db.raw.prepare(`SELECT surface, action_class, rung, reliability, outcomes FROM trust_ledger ORDER BY action_class`).all().map(r => ({ ...r }));
  const docTrust = (await store.scan('trust_ledger')).map(({ surface: s, action_class, rung, reliability, outcomes }) => ({ surface: s, action_class, rung, reliability, outcomes })).sort((x, y) => x.action_class.localeCompare(y.action_class));
  assert.deepEqual(docTrust, sqlTrust);
  assert.equal((await store.scan('outcomes')).filter(o => o.result === 'silent_drop').length, db.raw.prepare(`SELECT COUNT(*) AS n FROM outcomes WHERE result='silent_drop'`).get().n);
  assert.equal(b.dispatched, a.dispatched);
  assert.deepEqual(b.notes, a.notes);
});

// ---- the other five L1 steps (US-14-R18) ---------------------------------------------------------------------------------------
import { FULL_STEP_ORDER, DOC_METRICS } from './index.js';
import { STEP_ORDER as SQL_ORDER, withDefaults } from '../../core/src/tick.js';

const stamp = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
function fixture() {
  const db = makeDb();
  const old = stamp(T0 - 3 * 3600e3); const recent = stamp(T0 - 10 * 60e3); const quiet = stamp(T0 - 2.5 * 3600e3);
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m'), ('op-1','operations',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,closing_probe,priority,status,kind,created_at,updated_at,disposition) VALUES
      ('S1','unworked','staff','x',NULL,10,'claimed','work','${old}','${old}',NULL), ('S2','quiet','staff','x',NULL,11,'claimed','work','${old}','${old}',NULL), ('S3','parks','staff','x',NULL,12,'claimed','work','${old}','${old}',NULL),
      ('E1','probe passes','staff','x','env:X',20,'claimed','work','${recent}','${recent}',NULL), ('E2','probe fails','staff','x','env:NOPE',21,'claimed','work','${recent}','${recent}',NULL),
      ('DONE1','finished','staff','x',NULL,5,'done','work','${old}','${old}','shipped'),
      ('PK','parked','staff','x','env:X',30,'blocked','work','${old}','${old}','parked'), ('R1','ready','staff','x',NULL,40,'ready','work','${old}','${old}',NULL);
    UPDATE items SET blocker='waiting on probe: env:X (setting X is absent)' WHERE id='PK';
    INSERT INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES ('S1','staff-1','${old}','${old}'), ('S2','staff-1','${old}','${quiet}'), ('S3','staff-1','${old}','${old}'),
      ('E1','staff-1','${recent}','${recent}'), ('E2','staff-1','${recent}','${recent}');
    INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES ('S3','staff-1','dispatch','claim_release','unworked','e','${old}'), ('S3','staff-1','dispatch','claim_release','unworked','e','${old}');
    INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G1','a','b','c','env:X'), ('G2','a','b','c','item_done:DONE1'), ('G3','a','b','c','env:NOPE');
    INSERT INTO predictions (id,item_id,metric,op,target,due_at) VALUES ('P1','A','items_done','>=',1,'${stamp(T0 - H1)}'), ('P2','A','no_such_metric','>=',1,'${stamp(T0 - H1)}'), ('P3','A','items_done','>=',1,'${stamp(T0 + 24 * H1)}'), ('P4','A','open_gate_cards','<=',0,'${stamp(T0 - H1)}');`);
  for (let i = 0; i < 12; i++) db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status,kind,updated_at,disposition) VALUES ('K${i}','k','staff','x','done','work','${stamp(T0 - i * 60e3)}','shipped')`);
  return db;
}
const H1 = 3600e3;

test('US-14-R18: the document store has all eight L1 steps, in the order of core/src/tick.js', () => {
  assert.deepEqual(FULL_STEP_ORDER, SQL_ORDER);
  for (const n of FULL_STEP_ORDER) assert.equal(typeof STEPS[n], 'function', n);
  assert.deepEqual(Object.keys(DOC_METRICS).sort(), ['items_done', 'open_gate_cards', 'silent_drops_7d', 'tick_runs_completed_1h']);
});

test('parity: reap_claims, probe_gates, score_predictions, execute and check_plus_share on the document store end in the same state as the SQL steps', async () => {
  const db = fixture(); const store = memoryDocStore(); await importFromStore(db, store);
  const mk = () => ({ config: withDefaults(config), env: { X: true }, metrics: {}, now: T0, nowIso: NOW, tickId: 1, notes: [], errors: [], dispatched: 0, openGates: 0 });
  const steps = ['reap_claims', 'probe_gates', 'score_predictions', 'accrue_trust', 'execute', 'check_plus_share'];
  const a = mk(); for (const n of steps) await SQL_STEPS[n](db, a);
  const b = mk(); for (const n of steps) await STEPS[n](store, b);
  const sql = q => db.raw.prepare(q).all().map(r => ({ ...r }));
  const docItems = (await store.scan('items')).map(i => ({ id: i.key, status: i.status, blocker: i.blocker ?? null, disposition: i.disposition ?? null })).sort((x, y) => (x.id < y.id ? -1 : 1));
  assert.deepEqual(docItems, sql(`SELECT id, status, blocker, disposition FROM items ORDER BY id`).map(r => ({ ...r, disposition: r.disposition ?? null })));
  const by = Object.fromEntries(docItems.map(i => [i.id, i]));
  assert.equal(by.S1.status, 'ready'); assert.match(by.S1.disposition, /released unworked \(1\/3\)/);          // never worked: released, counted
  assert.equal(by.S2.status, 'ready');                                                                        // worked then quiet: plain release
  assert.equal(by.S3.status, 'blocked'); assert.match(by.S3.blocker, /released unworked 3 times/);             // third unworked release parks it
  assert.equal(by.E1.status, 'done'); assert.equal(by.E2.status, 'blocked'); assert.match(by.E2.blocker, /^waiting on probe: env:NOPE/);
  assert.equal(by.PK.status, 'done', 'a parked item closes when its probe passes');
  assert.ok(docItems.some(i => i.id.startsWith('REBALANCE-')), 'twelve done items and no plus: the rebalance item is opened');
  assert.deepEqual((await store.scan('claims')).map(c => c.key).sort(), sql(`SELECT item_id FROM claims ORDER BY item_id`).map(r => r.item_id));
  assert.deepEqual((await store.scan('gate_cards')).map(g => [g.key, g.status]).sort(), sql(`SELECT id, status FROM gate_cards ORDER BY id`).map(r => [r.id, r.status]));
  assert.deepEqual((await store.scan('predictions')).map(p => [p.key, p.verdict, p.observed]).sort(), sql(`SELECT id, verdict, observed FROM predictions ORDER BY id`).map(r => [r.id, r.verdict, r.observed]));
  const outs = rows => rows.map(o => `${o.item_id}|${o.surface}|${o.action_class}|${o.result}`).sort();
  assert.deepEqual(outs(await store.scan('outcomes')), outs(sql(`SELECT item_id, surface, action_class, result FROM outcomes`)));
  assert.deepEqual(b.notes, a.notes);
  assert.deepEqual(b.executed, a.executed);
});

test('US-14-R11: a reaper and a claimer running at once never leave an item both claimed and ready', async () => {
  const store = memoryDocStore();
  const old = stamp(T0 - 3 * 3600e3);
  for (let i = 0; i < 20; i++) {
    await store.set('items', `I${i}`, newItem({ status: 'claimed' }));
    await store.create('claims', `I${i}`, { item_id: `I${i}`, agent: 'staff-1', claimed_at: old, heartbeat_at: old });
  }
  await store.set('roles', 'staff-2', { role: 'staff', project: null, tick_every: 1, model: 'm', last_tick_at: null });
  const ctx = { config: { claim_ttl_minutes: 120, max_wip_per_role: 50, max_unworked_releases: 99, execute_max_items: 20 }, env: {}, metrics: {}, now: T0, nowIso: NOW, tickId: 1, notes: [], errors: [], dispatched: 0 };
  await Promise.all([STEPS.reap_claims(store, ctx), STEPS.reap_claims(store, { ...ctx, notes: [] }), STEPS.dispatch(store, { ...ctx, notes: [] }), STEPS.dispatch(store, { ...ctx, notes: [] })]);
  const claims = new Set((await store.scan('claims')).map(c => c.key));
  for (const i of await store.scan('items')) {
    assert.ok(!(i.status === 'ready' && claims.has(i.key)), `${i.key} is ready and claimed`);
    assert.ok(!(i.status === 'claimed' && !claims.has(i.key)), `${i.key} is claimed with no claim`);
  }
});

test('runDocTick completes all eight steps in the order of core/src/tick.js and records them', async () => {
  const store = memoryDocStore(); await importFromStore(fixture(), store);
  const r = await runDocTick(store, { config, env: { X: true }, now: T0, tickId: 1 });
  assert.equal(r.total, 8); assert.equal(r.completed, 8); assert.deepEqual(r.errors, []);
  assert.equal((await store.scan('tick_runs')).at(-1).steps_total, 8);
  const three = await runDocTick(memoryDocStore(), { config, now: T0, tickId: 1, steps: ['reconcile', 'accrue_trust', 'dispatch'] });
  assert.equal(three.total, 3);
});

test('execute leaves an item whose closing probe is SQL claimed for an executor that can read it, and counts it as left', async () => {
  const store = memoryDocStore();
  await store.set('roles', 'staff-1', { role: 'staff', project: null, tick_every: 1, model: 'm', last_tick_at: null });
  await store.set('items', 'E3', newItem({ status: 'claimed', closing_probe: 'SELECT COUNT(*) FROM items' }));
  await store.create('claims', 'E3', { item_id: 'E3', agent: 'staff-1', claimed_at: NOW, heartbeat_at: NOW });
  const ctx = { config: { claim_ttl_minutes: 120, execute_max_items: 20 }, env: {}, metrics: {}, now: T0, nowIso: NOW, tickId: 1, notes: [], errors: [] };
  await STEPS.execute(store, ctx);
  assert.equal((await store.get('items', 'E3')).status, 'claimed'); assert.ok(await store.get('claims', 'E3'));
  assert.equal(ctx.executed.left, 1); assert.match(ctx.notes[0], /1 left for an executor/);
});
