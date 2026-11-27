// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the Durable Object adapter of the tenant store (US-SPEC-25 TS-8) against a fake ctx.storage. No Cloudflare runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTenantSql } from '../../sqlite/tenant-sqlite.js';
import { doSqlPort, tenantStub, makeTenantDO, MIN_FLUSH_DELAY_MS } from './tenant-do.js';

// A fake Durable Object storage over node:sqlite: exec returns a cursor with rowsRead and rowsWritten, transactionSync rolls back on a throw.
function fakeCtx({ name = null, sql = openTenantSql() } = {}) {
  const raw = sql.raw;
  const exec = (text, ...params) => {
    const r = sql.exec(text, params);
    const it = r.rows[Symbol.iterator]();
    return { [Symbol.iterator]: () => it, rowsRead: r.rowsRead, rowsWritten: r.rowsWritten };
  };
  const storage = {
    sql: { exec, get databaseSize() { return sql.storageBytes(); } },
    transactionSync(fn) { raw.exec('SAVEPOINT fake_tx'); try { const v = fn(); raw.exec('RELEASE fake_tx'); return v; } catch (e) { raw.exec('ROLLBACK TO fake_tx'); raw.exec('RELEASE fake_tx'); throw e; } },
  };
  return { storage, id: { name }, sql };
}
const mkDO = (ctx, env = {}) => new (makeTenantDO(class { constructor(c, e) { this.base = true; } }))(ctx, env);
const budgets = (o) => ({ TENANT_BUDGETS: JSON.stringify(o) });

test('US-25-R08 TS-8: the DO port stops a runaway SELECT cursor at twice the per-query cap and reports rows written', () => {
  const g = (function* () { for (let i = 0; i < 1000; i++) yield { i }; })();
  let read = 0;
  const cur = { [Symbol.iterator]() { return { next() { const n = g.next(); if (!n.done) read++; return n; } }; }, get rowsRead() { return read; }, rowsWritten: 0 };
  const r = doSqlPort({ exec: () => cur, databaseSize: 4096 }, 10).exec('SELECT 1');
  assert.ok(r.rows.length > 0 && r.rows.length <= 25, `stopped early: ${r.rows.length}`);
  assert.equal(doSqlPort({ exec: () => ({ [Symbol.iterator]: () => [][Symbol.iterator](), rowsRead: 0, rowsWritten: 3 }), databaseSize: 1 }).exec('INSERT INTO t VALUES(1)').rowsWritten, 3);
  assert.equal(doSqlPort({ exec: () => cur, databaseSize: 8192 }).storageBytes(), 8192);
});

test('US-25-R08: every RPC error keeps code, limit, period and resetsAt across the boundary', () => {
  const d = mkDO(fakeCtx(), budgets({ acme: { day: { writes: 1 }, perQueryReads: 5 } }));
  assert.equal(d.query('acme', 'CREATE TABLE a(x, y)').ok, true);
  assert.equal(d.query('acme', 'INSERT INTO a VALUES(1, 1)').ok, true);
  const b = d.query('acme', 'INSERT INTO a VALUES(2, 2)');
  assert.deepEqual([b.ok, b.error.code, b.error.limit, b.error.period, typeof b.error.resetsAt], [false, 'budget_exceeded', 'writes', 'day', 'string']);
  const d2 = mkDO(fakeCtx(), budgets({ acme: { perQueryReads: 5 } }));
  d2.query('acme', 'CREATE TABLE a(x, y)'); for (let i = 0; i < 20; i++) d2.query('acme', 'INSERT INTO a VALUES(?,?)', [i, i]);
  assert.equal(d2.query('acme', 'SELECT * FROM a WHERE y = 3').error.code, 'query_too_wide');
  const d3 = mkDO(fakeCtx(), budgets({ acme: { maxVectors: 1 } }));
  d3.vectorUpsert('acme', 'a', [1, 0], {});
  assert.equal(d3.vectorUpsert('acme', 'b', [0, 1], {}).error.code, 'vector_cap');
  assert.equal(d3.status('acme').ok, true);
});

test('US-25-R01: tenantStub rejects path-like, upper-case and over-long ids and accepts a plain one', () => {
  const env = { TENANT: { idFromName: n => n, get: id => ({ id }) } };
  for (const bad of ['../x', 'A', 'a', 'x'.repeat(64), 'a/b', '', 'a b']) assert.throws(() => tenantStub(env, bad), /bad_tenant_id/, bad);
  assert.deepEqual(tenantStub(env, 'acme-1'), { id: 'acme-1' });
  assert.deepEqual(tenantStub(env, 'x'.repeat(63)), { id: 'x'.repeat(63) });
});

test('US-25-R08: status reports storageBytes from the database size', () => {
  const d = mkDO(fakeCtx());
  const s = d.status('acme');
  assert.equal(s.ok, true); assert.ok(s.value.storageBytes > 0); assert.equal(s.value.tenantId, 'acme');
});

test('US-25-R12: a second tenant id on the same object is refused with tenant_mismatch and its budget is not used', () => {
  const d = mkDO(fakeCtx(), budgets({ a: { day: { writes: 1 } }, b: { day: { writes: 1_000_000 } } }));
  assert.equal(d.query('a', 'CREATE TABLE t(x)').ok, true);
  const r = d.query('b', 'INSERT INTO t VALUES(1)');
  assert.deepEqual([r.ok, r.error.code], [false, 'tenant_mismatch']);
  assert.equal(d.status('a').value.tenantId, 'a');
  assert.equal(d.query('a', 'INSERT INTO t VALUES(1)').ok, true);
  assert.equal(d.query('a', 'INSERT INTO t VALUES(2)').error.code, 'budget_exceeded', 'tenant a is still held to its own budget');
});

test('US-25-R12: the object name must equal the tenant id when the platform provides one, and the pin survives a new DO instance over the same storage', () => {
  const ctx = fakeCtx({ name: 'a' });
  assert.equal(mkDO(ctx).query('b', 'SELECT 1').error.code, 'tenant_mismatch');
  assert.equal(mkDO(ctx).query('a', 'SELECT 1').ok, true);
  const shared = fakeCtx();
  assert.equal(mkDO(shared).query('a', 'CREATE TABLE t(x)').ok, true);
  assert.equal(mkDO({ ...shared }).query('b', 'SELECT 1').error.code, 'tenant_mismatch');           // a fresh instance, the same storage
  assert.equal(mkDO({ ...shared }).query('a', 'SELECT 1').ok, true);
});

test('US-25-R13: halting one tenant refuses its reads and writes with tenant_halted; status stays readable; resume restores service', () => {
  const d = mkDO(fakeCtx());
  d.query('a', 'CREATE TABLE t(x)');
  assert.equal(d.halt('a', 'runaway loop').value.halted, true);
  assert.equal(d.query('a', 'SELECT 1').error.code, 'tenant_halted');
  assert.equal(d.query('a', 'INSERT INTO t VALUES(1)').error.code, 'tenant_halted');
  assert.equal(d.status('a').value.halted, 'runaway loop');
  assert.equal(d.resume('a').ok, true);
  assert.equal(d.query('a', 'SELECT 1').ok, true);
});

test('US-25-R13: HALT=1 refuses every RPC except status', () => {
  const ctx = fakeCtx();
  const live = mkDO(ctx); live.query('a', 'CREATE TABLE t(x)');
  const halted = mkDO(ctx, { HALT: '1' });
  for (const r of [halted.query('a', 'SELECT 1'), halted.vectorUpsert('a', 'v', [1, 0]), halted.vectorQuery('a', [1, 0]), halted.rollupAdd('a', 'r', 'k'), halted.rollupGet('a', 'r', 'k'), halted.halt('a', 'x'), halted.resume('a')]) assert.equal(r.error.code, 'tenant_halted');
  assert.equal(halted.status('a').ok, true);
});

test('US-25-R03 US-25-R15: a write that crosses a statement cap is rolled back by the DO transaction, and the store charges and refuses it', () => {
  const ctx = fakeCtx();
  const d = mkDO(ctx, budgets({ a: { perQueryReads: 10, perQueryWrites: 5 } }));
  d.query('a', 'CREATE TABLE t(x, y)');
  for (let i = 0; i < 4; i++) d.query('a', 'INSERT INTO t VALUES(?, ?)', [i, 0]);
  d.query('a', 'CREATE TABLE u(x)');
  const w = d.query('a', 'INSERT INTO u SELECT x FROM t UNION ALL SELECT x FROM t');        // 8 rows > 5 written
  assert.equal(w.error.code, 'write_too_wide');
  assert.equal(d.query('a', 'SELECT COUNT(*) n FROM u').value.rows[0].n, 0, 'rolled back');
  for (let i = 0; i < 20; i++) d.query('a', 'INSERT INTO t VALUES(?, 1)', [i]);
  assert.equal(d.query('a', 'UPDATE t SET x = 999 WHERE y = 1').error.code, 'query_too_wide');   // a scanning UPDATE over more than perQueryReads rows
  assert.equal(ctx.sql.exec('SELECT COUNT(*) n FROM t WHERE x = 999').rows[0].n, 0, 'the refused UPDATE was rolled back');
  assert.ok(d.status('a').value.month.reads >= 20, 'and charged for the rows it scanned');
});

test('US-25-R15: the DO store refuses writes past maxStorageBytes from databaseSize', () => {
  const ctx = fakeCtx();
  const base = ctx.sql.storageBytes();
  const d = mkDO(ctx, budgets({ a: { maxStorageBytes: base + 40_000 } }));
  d.query('a', 'CREATE TABLE t(x)');
  let refused = null;
  for (let i = 0; i < 3000 && !refused; i++) { const r = d.query('a', 'INSERT INTO t VALUES(?)', ['y'.repeat(300) + i]); if (!r.ok) refused = r.error; }
  assert.ok(refused && refused.code === 'budget_exceeded' && refused.limit === 'storage', JSON.stringify(refused));
  assert.equal(d.status('a').ok, true);
});

test('US-25-R09: with a VECTORIZE binding the DO promotes past maxVectors through the same RPC; without one it stays local and fails with vector_cap', async () => {
  const rows = new Map();
  const VECTORIZE = { upsert: async rs => { for (const r of rs) rows.set(r.id, r); }, query: async () => ({ matches: [...rows.values()].map(r => ({ id: r.id, score: 1, metadata: r.metadata })) }) };
  const d = mkDO(fakeCtx(), { ...budgets({ a: { maxVectors: 1 } }), VECTORIZE });
  assert.equal((await d.vectorUpsert('a', 'v1', [1, 0], {})).ok, true);
  assert.equal((await d.vectorUpsert('a', 'v2', [0, 1], {})).ok, true);          // promotes
  assert.equal(d.status('a').value.vectorMode, 'promoting');
  assert.equal((await d.vectorPromote('a')).value.mode, 'vectorize');
  assert.deepEqual((await d.vectorQuery('a', [1, 0], { k: 5 })).value.map(x => x.id).sort(), ['v1', 'v2']);
  const local = mkDO(fakeCtx(), budgets({ a: { maxVectors: 1 } }));
  local.vectorUpsert('a', 'v1', [1, 0], {});
  assert.equal(local.vectorUpsert('a', 'v2', [0, 1], {}).error.code, 'vector_cap');
});

// ---------------- metering survives an eviction (US-25-R21) ----------------
test('US-25-R21: an object evicted before 25 operations still carries its usage into the next object, so a daily budget bounds across lifetimes', () => {
  const sql = openTenantSql();
  const alarms = [];
  const lives = () => { const ctx = fakeCtx({ sql }); ctx.storage.setAlarm = (t) => { alarms.push(t); }; return { ctx, d: mkDO(ctx, budgets({ acme: { day: { requests: 100 } } })) }; };
  let served = 0, refusedAt = null;
  for (let life = 0; life < 20 && refusedAt === null; life++) {
    const { d } = lives();
    for (let i = 0; i < 24 && refusedAt === null; i++) { const r = d.query('acme', 'SELECT 1 AS x'); if (r.ok) served++; else { assert.equal(r.error.code, 'budget_exceeded'); refusedAt = served; } }
    if (refusedAt === null) d.alarm();            // the alarm armed by the burst fires before the platform evicts the idle object
  }
  assert.ok(refusedAt !== null && refusedAt <= 100, `refused once the day's 100 requests were served (served ${refusedAt}), not after 480`);
  assert.ok(alarms.length >= 1, 'a flush alarm was armed');
});

test('US-25-R21: one alarm is armed per burst, none while nothing is unflushed, and the alarm flushes the usage so a new object reloads it', () => {
  const sql = openTenantSql(), alarms = [];
  const ctx = fakeCtx({ sql }); ctx.storage.setAlarm = (t) => { alarms.push(t); };
  const d = mkDO(ctx, budgets({ acme: {} }));
  d.status('acme');                                    // status is exempt from metering: nothing to flush
  d.query('acme', 'CREATE TABLE a(x)'); d.query('acme', 'INSERT INTO a VALUES(1)'); d.query('acme', 'SELECT * FROM a');
  assert.equal(alarms.length, 1, 'one alarm for the whole burst');
  assert.equal(sql.raw.prepare('SELECT * FROM _budget').all().length, 0, 'nothing is in the store before the alarm');
  d.alarm();
  const stored = sql.raw.prepare("SELECT requests FROM _budget WHERE period LIKE 'd:%'").get();
  assert.equal(stored.requests, 4, 'the alarm wrote the three requests and its own, charged to the tenant (chargeFlush)');
  d.query('acme', 'SELECT 1');
  assert.equal(alarms.length, 2, 'a new burst arms a new alarm');
  const d2 = mkDO(fakeCtx({ sql }), budgets({ acme: {} }));
  assert.equal(d2.status('acme').value.day.requests, 4, 'a new object over the same storage reloads the flushed usage');
});

test('US-25-R21: a failure to arm the alarm is recorded in status, never thrown into the request', async () => {
  const ctx = fakeCtx(); ctx.storage.setAlarm = () => Promise.reject(new Error('alarm refused'));
  const d = mkDO(ctx, budgets({ acme: {} }));
  assert.equal(d.query('acme', 'SELECT 1').ok, true);
  await new Promise(r => setImmediate(r));
  assert.equal(d.status('acme').value.flushError, 'alarm refused');
  d.alarm();
  assert.equal(d.status('acme').value.flushError, null);
});

test('US-25-R21 US-25-R02: spaced bursts cost the account nothing outside the budget: every alarm is charged, and the budget stops them', () => {
  const sql = openTenantSql(), alarms = [];
  const ctx = fakeCtx({ sql }); ctx.storage.setAlarm = (t) => { alarms.push(t); };
  const d = mkDO(ctx, budgets({ acme: { day: { requests: 300, writes: 1000 } } }));
  let ok = 0, refused = null;
  for (let i = 0; i < 1000 && refused === null; i++) {   // one operation per burst: its alarm fires before the next operation
    const r = d.query('acme', i === 0 ? 'CREATE TABLE t(x)' : 'INSERT INTO t VALUES (?)', i === 0 ? [] : [i]);
    if (r.ok) ok++; else refused = r.error;
    d.alarm();
  }
  assert.equal(refused && refused.code, 'budget_exceeded', 'the budget stops spaced bursts');
  assert.equal(refused.limit, 'requests');
  const day = d.status('acme').value.day;
  assert.equal(alarms.length, ok, 'one alarm per spaced burst that was served; the refused call arms none');
  assert.ok(day.requests >= 2 * ok && day.requests <= 300 + 1, `each alarm is one request of the tenant's own: ${day.requests} for ${ok} operations`);
  assert.ok(day.writes >= (ok - 1) + 2 * ok, `each alarm counts the two rows it writes: ${day.writes} written for ${ok - 1} rows of data`);
  assert.ok(ok <= 150, `the budget held ${ok} spaced operations, half of 300, because the alarms are inside it`);
});

test('US-25-R21 US-25-R02: a caller that keeps retrying past a spent budget arms no alarm and writes no row: one platform request per call', () => {
  const sql = openTenantSql(), alarms = [];
  const ctx = fakeCtx({ sql }); ctx.storage.setAlarm = (t) => { alarms.push(t); };
  const d = mkDO(ctx, budgets({ acme: { day: { requests: 20, writes: 1000 } } }));
  let spentAt = null;
  for (let i = 0; i < 100 && spentAt === null; i++) { const r = d.query('acme', 'SELECT 1'); d.alarm(); if (!r.ok) spentAt = i; }
  assert.ok(spentAt !== null, 'the budget was spent');
  const a0 = alarms.length;
  const changes = () => Number(sql.raw.prepare('SELECT total_changes() n').get().n);
  const w0 = changes();
  for (let k = 0; k < 1000; k++) { const r = d.query('acme', 'SELECT 1'); assert.equal(r.error && r.error.code, 'budget_exceeded'); d.alarm(); }   // each retry spaced past the alarm delay
  assert.equal(alarms.length - a0, 0, 'a refusal arms no alarm');
  assert.equal(changes() - w0, 0, 'and writes no row: neither an alarm flush nor a count flush');
  const before = { ...d.status('acme').value.day };
  assert.ok(before.requests <= 20 + 2, `requests stay at the budget plus the first refusal and one alarm: ${before.requests}`);
  d.store('acme').flush();
  const stored = sql.raw.prepare("SELECT denied FROM _budget WHERE period LIKE 'd:%'").get();
  assert.ok(stored.denied >= 1000, `the refusals are counted and written with the next flush: ${stored.denied}`);
});

test('US-25-R21: arming the alarm is charged as one row written, because the platform bills each setAlarm as a row', () => {
  const sql = openTenantSql(), alarms = [];
  const ctx = fakeCtx({ sql }); ctx.storage.setAlarm = (t) => { alarms.push(t); };
  const d = mkDO(ctx, budgets({ acme: {} }));
  d.query('acme', 'SELECT 1');                          // reads and writes no row of data
  assert.equal(alarms.length, 1);
  assert.equal(d.status('acme').value.day.writes, 1, 'the setAlarm row is charged when the alarm is armed');
  d.alarm();
  assert.equal(sql.raw.prepare("SELECT writes FROM _budget WHERE period LIKE 'd:%'").get().writes, 3, 'and the alarm adds the two rows its flush writes');
});

test('US-25-R21: TENANT_FLUSH_MS has a floor, so a zero cannot make every request its own burst', () => {
  const at = [];
  const ctx = fakeCtx(); ctx.storage.setAlarm = (t) => { at.push(t); };
  const d = mkDO(ctx, { TENANT_FLUSH_MS: '0', ...budgets({ acme: {} }) });
  const t0 = Date.now(); d.query('acme', 'SELECT 1');
  assert.equal(at.length, 1);
  assert.ok(at[0] - t0 >= MIN_FLUSH_DELAY_MS, `armed ${at[0] - t0} ms ahead`);
});
