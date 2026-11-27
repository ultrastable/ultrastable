// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTenantSql } from '../../adapters/sqlite/tenant-sqlite.js';
import { TenantStore, BudgetError } from './store.js';
import { estimateMonth, worstCase, probe, maxVecDimsMonth } from './spend.js';
import { PRICES } from './prices.js';
import { vectorizeGateCard } from './vectorport.js';
import { crossCheck, sumSelf } from './crosscheck.js';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { PAID_PLAN_BUDGET, FREE_PLAN_BUDGET, worstCaseDay } from './budget.js';
import { doSqlPort, tenantStub, makeTenantDO } from '../../adapters/cloudflare/src/tenant-do.js';

const mk = (budget = {}, now) => new TenantStore({ tenantId: 'acme', sql: openTenantSql(), budget, now });

test('US-25-R02 TS-2: write budget is a hard cap and resets next day', () => {
  let t = new Date('2026-11-16T10:00:00Z');
  const s = mk({ day: { writes: 3 } }, () => t);
  s.query('CREATE TABLE a(x)');
  for (let i = 0; i < 3; i++) s.query('INSERT INTO a VALUES(?)', [i]);
  assert.throws(() => s.query('INSERT INTO a VALUES(9)'), (e) => e instanceof BudgetError && e.limit === 'writes' && e.period === 'day');
  t = new Date('2026-11-17T00:00:01Z');
  assert.doesNotThrow(() => s.query('INSERT INTO a VALUES(9)'));
});

test('US-25-R03 TS-3: full-table scan over the per-query cap is refused and charged', () => {
  const s = mk({ perQueryReads: 10 });
  s.query('CREATE TABLE a(x, y)');
  for (let i = 0; i < 50; i++) s.query('INSERT INTO a VALUES(?,?)', [i, i]);
  assert.throws(() => s.query('SELECT * FROM a WHERE y=7'), (e) => e.code === 'query_too_wide');
  s.query('CREATE INDEX ay ON a(y)');
  assert.equal(s.query('SELECT * FROM a WHERE y=7').rows.length, 1); // indexed lookup stays cheap
  assert.ok(s.status().month.reads >= 50);
});

test('US-25-R04 TS-4: rollup replaces a scan with a one-row read', () => {
  const s = mk();
  for (let i = 0; i < 100; i++) s.rollups.add('jobs_by_status', i % 2 ? 'ok' : 'fail');
  const before = s.status().month.reads;
  assert.equal(s.rollups.get('jobs_by_status', 'ok').n, 50);
  assert.equal(s.status().month.reads - before, 1);
});

test('US-25-R05 TS-5: vectors rank by cosine, stay in namespace, and cap at maxVectors', () => {
  const s = mk({ maxVectors: 3 });
  s.vectors.upsert('a', [1, 0, 0], { ns: 'n1', meta: { t: 'a' } });
  s.vectors.upsert('b', [0.9, 0.1, 0], { ns: 'n1' });
  s.vectors.upsert('c', [0, 1, 0], { ns: 'n2' });
  const r = s.vectors.query([1, 0, 0], { k: 2, ns: 'n1' });
  assert.deepEqual(r.map(x => x.id), ['a', 'b']);
  assert.equal(r[0].meta.t, 'a');
  assert.throws(() => s.vectors.upsert('d', [0, 0, 1]), (e) => e.code === 'vector_cap');
  s.vectors.upsert('a', [0, 0, 1]); // overwrite is allowed at the cap
  assert.ok(s.status().month.vec_dims > 0);
});

test('US-25-R06 TS-6: hot read falls back to stale cache when the budget is spent', async () => {
  const m = new Map();
  const cache = { get: async k => m.get(k) ?? null, put: async (k, v) => m.set(k, v) };
  const s = new TenantStore({ tenantId: 'acme', sql: openTenantSql(), budget: { day: { requests: 2 } }, cache });
  assert.equal(await s.cached('k', 0, async () => 1), 1);
  s.query('SELECT 1'); s.query('SELECT 1');
  assert.equal(await s.cached('k', 0, async x => x.query('SELECT 1')), 1); // stale served, no throw
});

test('US-25-R07 TS-7: worst case is bounded by the budgets and spend probe flags a breach', () => {
  const wc = worstCase([PAID_PLAN_BUDGET, PAID_PLAN_BUDGET, PAID_PLAN_BUDGET, PAID_PLAN_BUDGET, PAID_PLAN_BUDGET]);
  assert.ok(wc.estimate && wc.total < 8, 'five tenants at full budget stay under the ceiling: ' + wc.total);
  const heavy = estimateMonth({ reads: 60e9, writes: 100e6, requests: 5e6 });
  assert.ok(heavy.total > 50);
  const p = probe([{ tenantId: 'a', month: { reads: 5e9, writes: 1e6, requests: 1e6 } }, { tenantId: 'b', month: { reads: 9e9, writes: 1e6, requests: 1e6 } }], { dayOfMonth: 5, ceilingUsd: 8 });
  assert.equal(p.status, 'breach'); assert.equal(p.topReaders[0], 'b'); assert.equal(p.estimate, true);
});

test('US-25-R08 TS-8 US-25-R01 TS-1: DO port aborts a runaway cursor and tenant ids are validated', () => {
  const cur = (function* () { for (let i = 0; i < 1000; i++) yield { i }; })();
  cur.rowsRead = 0; const it = { [Symbol.iterator]() { const g = cur; return { next() { const n = g.next(); g.rowsRead++; return n; } }; }, get rowsRead() { return cur.rowsRead; }, rowsWritten: 0 };
  const r = doSqlPort({ exec: () => it }, 10).exec('SELECT 1');
  assert.ok(r.rows.length < 50);
  assert.throws(() => tenantStub({ TENANT: {} }, '../other'), /bad_tenant_id/);
});

test('US-25-R02 free profile: five tenants fit inside the free plan account-wide daily limits, and metering is batched', () => {
  const sum = (f) => 5 * FREE_PLAN_BUDGET.day[f];
  assert.ok(sum('requests') <= 100_000 && sum('writes') <= 100_000 && sum('reads') <= 5_000_000);
  // The worst case, not only the budget: one statement past what is left, the count flushes and the alarm after the refusal (worstCaseDay).
  const w = worstCaseDay(FREE_PLAN_BUDGET);
  assert.ok(5 * w.writes <= 100_000, `five tenants' worst case writes ${5 * w.writes} rows`);
  assert.ok(5 * w.requests <= 100_000, `five tenants' worst case is ${5 * w.requests} requests`);
  assert.ok(5 * w.reads <= 5_000_000, `five tenants' worst case reads ${5 * w.reads} rows`);
  assert.ok(5 * worstCaseDay({ ...FREE_PLAN_BUDGET, perQueryWrites: 5_000 }).writes > 100_000, 'a wider statement cap would break the bound, which is why the Free cap is 3,000');
  const s = new TenantStore({ tenantId: 'acme', sql: openTenantSql(), budget: {} });
  s.query('CREATE TABLE a(x)');
  const before = s.sql.exec('SELECT COUNT(*) n FROM _budget').rows[0].n;
  for (let i = 0; i < 10; i++) s.query('SELECT 1');
  assert.equal(s.sql.exec('SELECT COUNT(*) n FROM _budget').rows[0].n, before, 'no storage writes per operation below flushEvery');
  s.guard.flush();
  assert.equal(s.sql.exec('SELECT requests FROM _budget WHERE period LIKE ?', ['d:%']).rows[0].requests, 11);
});

test('US-25-R08 TS-8: TenantDO runs behind a fake platform base and returns errors as data', () => {
  const sql = openTenantSql();
  const fakeStorage = { sql: { exec: (t, ...p) => { const r = sql.exec(t, p); const it = r.rows[Symbol.iterator](); return { [Symbol.iterator]: () => it, rowsRead: r.rowsRead, rowsWritten: r.rowsWritten }; }, databaseSize: 1 } };
  const DO = makeTenantDO(class { constructor(ctx, env) { this.base = true; } });
  const d = new DO({ storage: fakeStorage }, { TENANT_BUDGETS: JSON.stringify({ acme: { day: { writes: 1 } } }) });
  assert.equal(d.base, true);
  assert.equal(d.query('acme', 'CREATE TABLE a(x)').ok, true);
  assert.equal(d.query('acme', 'INSERT INTO a VALUES(1)').ok, true);
  const e = d.query('acme', 'INSERT INTO a VALUES(2)');
  assert.equal(e.ok, false); assert.equal(e.error.code, 'budget_exceeded');
});

// ---------------- metering invariant (US-25-R14, TS-2) ----------------
// A SqlPort wrapper that sums the platform's own rowsRead and rowsWritten for every statement the store issues, except the statements the
// store declares exempt (the tenant pin and the budget table: PIN_ROWS, the first load of a period and the flush).
function metered(sql) {
  const m = { reads: 0, writes: 0, log: [] };
  const port = { raw: sql.raw, storageBytes: sql.storageBytes, exec(text, params, limits) {
    const r = sql.exec(text, params, limits);
    const exempt = /\b_budget\b|\b_tenant\b/.test(text);
    m.log.push({ text, rowsRead: r.rowsRead, exempt });
    if (!exempt) { m.reads += r.rowsRead; m.writes += r.rowsWritten; }
    return r;
  } };
  return { port, m };
}
const tick = (s) => s.guard.flush();

test('US-25-R14: 300 vector upserts charge the guard within 1 percent of the rows the SqlPort reported', () => {
  const { port, m } = metered(openTenantSql());
  const s = new TenantStore({ tenantId: 'acme', sql: port, budget: { maxVectors: 1000 } });
  for (let i = 0; i < 300; i++) s.vectors.upsert('v' + i, [1, i % 7, 3], { ns: 'n' });
  tick(s);
  const charged = s.status().month;
  assert.ok(m.reads > 0 && m.writes > 0);
  assert.ok(Math.abs(charged.reads - m.reads) <= Math.max(1, m.reads * 0.01), `charged ${charged.reads} reads vs platform ${m.reads}`);
  assert.ok(Math.abs(charged.writes - m.writes) <= Math.max(1, m.writes * 0.01), `charged ${charged.writes} writes vs platform ${m.writes}`);
  assert.ok(m.reads < 3 * 300, 'no upsert scans the vector table: the platform read fewer than 3 rows per upsert');
});

test('US-25-R14: status() reads one row and does not scan _vec', () => {
  const { port, m } = metered(openTenantSql());
  const s = new TenantStore({ tenantId: 'acme', sql: port, budget: { maxVectors: 1000 } });
  for (let i = 0; i < 50; i++) s.vectors.upsert('v' + i, [1, 0, i], {});
  m.log.length = 0;
  assert.equal(s.status().vectors, 50);
  assert.deepEqual(m.log.map(l => [l.text.replace(/\s+/g, ' '), l.rowsRead]), [["SELECT n FROM _vec_meta WHERE k = 'count'", 1]]);
  assert.ok(!m.log.some(l => /COUNT\(\*\)/i.test(l.text)));
});

test('US-25-R14: the counter follows overwrite and remove, and a store with vectors but no counter backfills once, charged', () => {
  const sql = openTenantSql();
  const s = new TenantStore({ tenantId: 'acme', sql, budget: {} });
  s.vectors.upsert('a', [1, 0], {}); s.vectors.upsert('b', [0, 1], {}); s.vectors.upsert('a', [1, 1], {});
  assert.equal(s.status().vectors, 2);
  s.vectors.remove('a'); s.vectors.remove('nope');
  assert.equal(s.status().vectors, 1);
  sql.raw.exec('DELETE FROM _vec_meta');                                             // a store written before the counter existed
  const s2 = new TenantStore({ tenantId: 'acme', sql, budget: {} });
  const before = s2.status().month.reads;
  s2.vectors.upsert('c', [1, 0], {});
  assert.equal(s2.status().vectors, 2);
  assert.ok(s2.status().month.reads > before, 'the backfill read is charged');
});

test('US-25-R02: a month budget resets on the first of the next month', () => {
  let t = new Date('2026-11-30T23:00:00Z');
  const s = mk({ month: { writes: 3 }, day: { writes: 100 } }, () => t);
  s.query('CREATE TABLE a(x)');
  for (let i = 0; i < 3; i++) s.query('INSERT INTO a VALUES(?)', [i]);
  assert.throws(() => s.query('INSERT INTO a VALUES(9)'), (e) => e instanceof BudgetError && e.limit === 'writes' && e.period === 'month' && e.resetsAt === '2026-12-01T00:00:00.000Z');
  t = new Date('2026-12-01T00:00:01Z');
  assert.doesNotThrow(() => s.query('INSERT INTO a VALUES(9)'));
});

test('US-25-R02: reads, requests and vector dimensions each refuse with budget_exceeded when spent', () => {
  for (const [limit, budget, act] of [
    ['reads', { day: { reads: 5 } }, s => { for (let i = 0; i < 20; i++) s.query('SELECT 1'); }],
    ['requests', { day: { requests: 3 } }, s => { for (let i = 0; i < 20; i++) s.query('SELECT 1'); }],
    ['vecDims', { day: { vecDims: 10 } }, s => { for (let i = 0; i < 20; i++) { s.vectors.upsert('v' + i, [1, 0, 0], {}); s.vectors.query([1, 0, 0], {}); } }],
  ]) {
    const s = mk(budget);
    assert.throws(() => act(s), (e) => e instanceof BudgetError && e.limit === limit && e.period === 'day', limit);
  }
});

test('US-25-R05: a vector upsert at maxVectors still fails vector_cap after the counter change; overwrite at the cap works', () => {
  const s = mk({ maxVectors: 2 });
  s.vectors.upsert('a', [1, 0, 0]); s.vectors.upsert('b', [0, 1, 0]);
  assert.throws(() => s.vectors.upsert('c', [0, 0, 1]), (e) => e.code === 'vector_cap' && e.max === 2);
  s.vectors.upsert('a', [0, 0, 1]);
  s.vectors.remove('b'); s.vectors.upsert('c', [0, 0, 1]);                           // removing frees a slot
  assert.equal(s.status().vectors, 2);
});

// ---------------- one tenant per store, per-tenant halt (US-25-R12, R13) ----------------
test('US-25-R12: a second tenant id on the same storage is refused with tenant_mismatch and its budget is not used', () => {
  const sql = openTenantSql();
  const a = new TenantStore({ tenantId: 'a', sql, budget: {} });
  a.query('CREATE TABLE t(x)'); a.query('INSERT INTO t VALUES(1)');
  assert.throws(() => new TenantStore({ tenantId: 'b', sql, budget: { day: { writes: 1_000_000 } } }), (e) => e.code === 'tenant_mismatch');
  assert.equal(sql.raw.prepare(`SELECT v FROM _tenant WHERE k = 'id'`).get().v, 'a');
  assert.doesNotThrow(() => new TenantStore({ tenantId: 'a', sql, budget: {} }));    // the same id, a new object over the same storage, is fine
});

test('US-25-R13: halting one tenant refuses its reads, writes, vectors and rollups with tenant_halted and leaves another tenant working; resume restores service', () => {
  const a = mk(), b = new TenantStore({ tenantId: 'b', sql: openTenantSql(), budget: {} });
  a.query('CREATE TABLE t(x)');
  a.halt('investigating a runaway loop');
  for (const f of [() => a.query('SELECT 1'), () => a.query('INSERT INTO t VALUES(1)'), () => a.vectors.upsert('v', [1, 0]), () => a.vectors.query([1, 0]), () => a.rollups.add('r', 'k'), () => a.rollups.get('r', 'k')]) {
    assert.throws(f, (e) => e.code === 'tenant_halted' && /investigating/.test(e.message));
  }
  assert.equal(a.status().halted, 'investigating a runaway loop');
  assert.doesNotThrow(() => b.query('SELECT 1'));
  const reads = a.status().month.requests;
  a.resume();
  assert.equal(a.query('SELECT 1').rows.length, 1);
  assert.equal(a.status().halted, null);
  assert.ok(a.status().month.requests > reads, 'metering resumes');
});

test('US-25-R13: a halt survives a new object over the same storage', () => {
  const sql = openTenantSql();
  new TenantStore({ tenantId: 'a', sql, budget: {} }).halt('stop');
  const again = new TenantStore({ tenantId: 'a', sql, budget: {} });
  assert.throws(() => again.query('SELECT 1'), (e) => e.code === 'tenant_halted');
});

// ---------------- the hard bound: statement write cap, scanning writes, storage ceiling (US-25-R03, R15) ----------------
test('US-25-R03: an UPDATE without an index over more than perQueryReads rows is refused, charged and rolled back', () => {
  const s = mk({ perQueryReads: 10, perQueryWrites: 1000 });
  s.query('CREATE TABLE a(x, y)');
  for (let i = 0; i < 50; i++) s.query('INSERT INTO a VALUES(?,?)', [i, 0]);
  const before = { ...s.status().month };
  assert.throws(() => s.query('UPDATE a SET x = 99 WHERE y = 0'), (e) => e.code === 'query_too_wide');
  assert.equal(s.sql.exec('SELECT COUNT(*) n FROM a WHERE x = 99').rows[0].n, 0, 'the refused UPDATE changed nothing');
  assert.ok(s.status().month.reads >= before.reads + 50, 'it was charged for the rows it scanned');
  assert.throws(() => s.query('DELETE FROM a WHERE y = 0'), (e) => e.code === 'query_too_wide');
  assert.equal(s.sql.exec('SELECT COUNT(*) n FROM a').rows[0].n, 50);
});

test('US-25-R03 US-25-R02: the SQLite adapter reads the query plan first and turns down a scanning write past the per-query read cap without executing it, leaving no rows to roll back', () => {
  const s = mk({ perQueryReads: 100, perQueryWrites: 3000, day: { writes: 100_000, reads: 1_000_000 } });
  s.query('CREATE TABLE t(x INTEGER)');
  s.sql.raw.exec('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 1200) INSERT INTO t SELECT x FROM c');
  const changes = () => Number(s.sql.raw.prepare('SELECT total_changes() n').get().n);
  for (const text of ['UPDATE t SET x = x + 1', 'DELETE FROM t WHERE x > 0', 'CREATE TABLE copy AS SELECT * FROM t', 'INSERT INTO t SELECT x FROM t']) {
    const c0 = changes();
    let err = null; try { s.sql.exec(text, [], { maxRowsRead: 100, maxRowsWritten: 3000 }); } catch (e) { err = e; }
    assert.equal(err && err.code, 'statement_too_wide', text);
    assert.deepEqual([err.rowsRead, err.rowsWritten], [1200, 0], `${text}: refused on its plan's scan, with nothing written`);
    assert.equal(changes() - c0, 0, `${text}: the statement never ran`);
  }
  assert.throws(() => s.query('UPDATE t SET x = x + 1'), (e) => e.code === 'query_too_wide' && e.rowsRead === 1200 && e.rowsWritten === 0);
  assert.equal(s.sql.raw.prepare('SELECT SUM(x) n FROM t').get().n, 1200 * 1201 / 2, 'the table is as it was');
});

test('US-25-R15: an INSERT ... SELECT writing more than perQueryWrites rows is refused, charged and rolled back', () => {
  const s = mk({ perQueryReads: 1000, perQueryWrites: 20 });
  s.query('CREATE TABLE a(x)'); s.query('CREATE TABLE b(x)');
  for (let i = 0; i < 15; i++) s.query('INSERT INTO a VALUES(?)', [i]);
  assert.doesNotThrow(() => s.query('INSERT INTO b SELECT x FROM a'));                 // 15 rows: inside the cap
  const w0 = s.status().month.writes;   // a number, not the live row
  assert.throws(() => s.query('INSERT INTO b SELECT x FROM a UNION ALL SELECT x FROM a'), (e) => e.code === 'write_too_wide' && e.rowsWritten === 30);
  assert.equal(s.sql.exec('SELECT COUNT(*) n FROM b').rows[0].n, 15, 'the refused statement wrote nothing');
  assert.ok(s.status().month.writes >= w0 + 30, 'the refused statement is still charged for the rows it tried to write');
});

test('US-25-R15: a tenant that states day.writes gets a statement write cap of a third of it, and a profile states its own', () => {
  assert.equal(mk({ day: { writes: 900 } }).guard.budget.perQueryWrites, 300);
  assert.ok(FREE_PLAN_BUDGET.perQueryWrites <= Math.floor(FREE_PLAN_BUDGET.day.writes / 3), 'the Free profile states a cap no wider than a third of its day');
  assert.equal(PAID_PLAN_BUDGET.perQueryWrites, Math.floor(PAID_PLAN_BUDGET.day.writes / 3));
  assert.equal(mk({ perQueryWrites: 7, day: { writes: 900 } }).guard.budget.perQueryWrites, 7);
});

test('US-25-R15: writes are refused once storageBytes reaches maxStorageBytes and reads and deletes still work', () => {
  const sql = openTenantSql();
  const limit = new TenantStore({ tenantId: 'probe', sql: openTenantSql(), budget: {} }).sql.storageBytes() + 30_000;   // the empty store plus room for a few pages
  const s = new TenantStore({ tenantId: 'acme', sql, budget: { maxStorageBytes: limit } });
  s.query('CREATE TABLE a(x)');
  let refused = null;
  for (let i = 0; i < 2000 && !refused; i++) { try { s.query('INSERT INTO a VALUES(?)', ['x'.repeat(200) + i]); } catch (e) { refused = e; } }
  assert.ok(refused instanceof BudgetError, 'a write is eventually refused');
  assert.deepEqual([refused.limit, refused.period], ['storage', 'total']);
  assert.ok(sql.storageBytes() >= limit);
  assert.doesNotThrow(() => s.query('SELECT COUNT(*) n FROM a'));
  assert.throws(() => s.vectors.upsert('v', [1, 0]), (e) => e instanceof BudgetError && e.limit === 'storage');
  assert.throws(() => s.rollups.add('r', 'k'), (e) => e instanceof BudgetError && e.limit === 'storage');
  assert.doesNotThrow(() => s.query('DELETE FROM a WHERE x LIKE ?', ['xxxx%']));        // deleting frees space and is never gated by it
});

// ---------------- spend probe: plan, worst case, Worker-safe prices (US-25-R07, R11, R17) ----------------
test('US-25-R17: five Free budgets on the Free plan estimate USD 0 and a paid equivalent of 5.20', () => {
  const five = Array(5).fill(FREE_PLAN_BUDGET);
  const free = worstCase(five, undefined, { plan: 'free' });
  assert.equal(free.total, 0); assert.equal(free.plan, 'free');
  assert.equal(Number(free.paidEquivalentUsd.toFixed(2)), 5.2);
  assert.equal(Number(worstCase(five).total.toFixed(2)), 5.2);                           // the default plan is paid, as before
});

test('US-25-R17: five Paid budgets on the Paid plan still estimate 7.10', () => {
  const wc = worstCase(Array(5).fill(PAID_PLAN_BUDGET), undefined, { plan: 'paid' });
  assert.equal(Number(wc.total.toFixed(2)), 7.1); assert.ok(wc.total < 8);
});

test('US-25-R07: probe returns ok under 80 percent of the ceiling, warn between 80 and 100, breach above, and states worstCase and plan', () => {
  const snap = (requests) => [{ tenantId: 'a', month: { reads: 0, writes: 0, requests } }];
  // paid base 5 + 0.15 per million requests over 1 million: 1M -> 5.00, 17M -> 7.40, 21M -> 8.00 (ceiling 8 -> warn above 6.4, breach above 8)
  assert.equal(probe(snap(1e6), { ceilingUsd: 8, dayOfMonth: 30, daysInMonth: 30 }).status, 'ok');
  assert.equal(probe(snap(14e6), { ceilingUsd: 8, dayOfMonth: 30, daysInMonth: 30 }).status, 'warn');
  assert.equal(probe(snap(40e6), { ceilingUsd: 8, dayOfMonth: 30, daysInMonth: 30 }).status, 'breach');
  const p = probe(snap(1e6), { ceilingUsd: 8, plan: 'free', budgets: Array(5).fill(FREE_PLAN_BUDGET) });
  assert.equal(p.plan, 'free'); assert.equal(p.projectedUsd, 0); assert.equal(p.status, 'ok');
  assert.deepEqual(p.worstCase, { totalUsd: 0, paidEquivalentUsd: 5.2, plan: 'free', vectorize: false });
  assert.equal(probe(snap(1e6), { budgets: Array(5).fill(PAID_PLAN_BUDGET) }).worstCase.totalUsd, 7.1);
});

test('US-25-R17: gbSeconds above 400,000 add 12.50 per million', () => {
  const base = estimateMonth({ gbSeconds: 400_000 }).total, more = estimateMonth({ gbSeconds: 1_400_000 }).total;
  assert.equal(Number((more - base).toFixed(2)), 12.5);
});

test('US-25-R11: no module in core/tenantstore imports node:, cloudflare: or reads import.meta.url, and prices.js equals prices.json', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  for (const f of readdirSync(dir).filter(n => n.endsWith('.js') && !n.endsWith('.test.js'))) {
    const src = readFileSync(path.join(dir, f), 'utf8').replace(/\/\/[^\n]*/g, '');
    assert.ok(!/from\s+['"](node|cloudflare):/.test(src) && !/import\.meta\.url/.test(src) && !/\brequire\(/.test(src), `${f} reaches a platform`);
  }
  assert.deepEqual(PRICES, JSON.parse(readFileSync(path.join(dir, 'prices.json'), 'utf8')));
});

// ---------------- promotion past maxVectors (US-25-R09, TS-9) ----------------
function fakeVectorize() {
  const idx = { rows: new Map(), upserts: 0, queries: [], deleted: [], failNext: 0 };
  idx.upsert = async (rows) => { if (idx.failNext > 0) { idx.failNext--; throw new Error('vectorize unavailable'); } idx.upserts++; for (const r of rows) idx.rows.set(r.id, r); };
  idx.deleteByIds = async (ids) => { for (const id of ids) { idx.rows.delete(id); idx.deleted.push(id); } };
  idx.query = async (vec, { topK = 5, namespace, filter } = {}) => {
    idx.queries.push({ topK, namespace, filter });
    const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; } return na && nb ? d / Math.sqrt(na * nb) : 0; };
    const m = [...idx.rows.values()].filter(r => r.namespace === namespace && (!filter || r.metadata.ns === filter.ns)).map(r => ({ id: r.id, score: cos(vec, r.values), metadata: r.metadata }));
    return { matches: m.sort((a, b) => b.score - a.score).slice(0, topK) };
  };
  return idx;
}
const mkv = (budget, binding) => new TenantStore({ tenantId: 'acme', sql: openTenantSql(), budget, vectorize: binding });

test('US-25-R09: at maxVectors with a fake binding the next upsert promotes, all earlier vectors are queryable through the port and none is lost', async () => {
  const idx = fakeVectorize(), s = mkv({ maxVectors: 3 }, idx);
  for (const [id, v] of [['a', [1, 0, 0]], ['b', [0, 1, 0]], ['c', [0, 0, 1]]]) await s.tv.upsert(id, v, { ns: 'n', meta: { t: id } });
  assert.equal(s.tv.mode(), 'local');
  await s.tv.upsert('d', [1, 1, 0], { ns: 'n' });                          // the 4th does not fit: promotion starts, the new vector goes to the port
  assert.equal(s.tv.mode(), 'promoting');
  assert.deepEqual((await s.tv.query([1, 0, 0], { k: 4, ns: 'n' })).map(x => x.id).sort(), ['a', 'b', 'c', 'd'], 'while promoting, local and port results are merged');
  const r = await s.tv.promote({ maxBatches: 5 });
  assert.deepEqual([r.done, r.copied, r.mode], [true, 3, 'vectorize']);
  assert.equal(s.vectors.count(), 0, 'nothing is left locally');
  assert.deepEqual([...idx.rows.keys()].sort(), ['a', 'b', 'c', 'd']);
  assert.ok([...idx.rows.values()].every(x => x.namespace === 'acme' && x.metadata.ns === 'n'), 'namespaced by tenant');
  const top = await s.tv.query([1, 0, 0], { k: 2, ns: 'n' });
  assert.equal(top[0].id, 'a'); assert.deepEqual(top[0].meta, { t: 'a' });
  assert.deepEqual(idx.queries.at(-1).filter, { ns: 'n' });
  await s.tv.upsert('e', [0, 1, 1], { ns: 'n' });                          // later upserts go straight to the port
  assert.ok(idx.rows.has('e'));
  assert.equal(s.status().vectorMode, 'vectorize');
});

test('US-25-R09: promotion resumes after an interrupted batch without duplicates and a newer value is never overwritten by the old local row', async () => {
  const idx = fakeVectorize(), s = mkv({ maxVectors: 5 }, idx);
  s.tv.batch = 2;
  for (const id of 'abcde') await s.tv.upsert(id, [1, id.charCodeAt(0) % 5, 1], {});
  await s.tv.upsert('a', [0, 0, 9], {});                                    // an overwrite at the cap is local and fine
  await s.tv.upsert('f', [9, 9, 9], {});                                    // promotes
  await s.tv.upsert('b', [7, 7, 7], {});                                    // b changes while promoting: the port holds the newest, the local row is dropped
  idx.failNext = 1;
  await assert.rejects(() => s.tv.promote({ maxBatches: 1 }), /vectorize unavailable/);   // the port refuses the first batch: nothing was deleted locally
  assert.equal(s.vectors.count(), 4);
  const r = await s.tv.promote({ maxBatches: 10 });
  assert.equal(r.done, true);
  assert.deepEqual([...idx.rows.keys()].sort(), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(idx.rows.get('b').values, [7, 7, 7]);
  assert.deepEqual(idx.rows.get('a').values.map(x => Math.round(x)), [0, 0, 9]);
  assert.equal(new Set([...idx.rows.keys()]).size, 6);
});

test('US-25-R09: without a binding the same upsert still fails with vector_cap', async () => {
  const s = mkv({ maxVectors: 2 }, null);
  await s.tv.upsert('a', [1, 0]); await s.tv.upsert('b', [0, 1]);
  await assert.rejects(() => s.tv.upsert('c', [1, 1]), (e) => e.code === 'vector_cap');
  assert.equal(s.tv.mode(), 'local');
  assert.deepEqual(await s.tv.promote(), { done: false, reason: 'no_binding', mode: 'local' });
});

test('US-25-R09: a port query is charged (stored + 1) x dimensions', async () => {
  const idx = fakeVectorize(), s = mkv({ maxVectors: 2 }, idx);
  await s.tv.upsert('a', [1, 0, 0]); await s.tv.upsert('b', [0, 1, 0]); await s.tv.upsert('c', [0, 0, 1]);
  await s.tv.promote({ maxBatches: 3 });
  assert.equal(s.tv.status().stored, 3);
  const before = s.status().month.vec_dims;
  await s.tv.query([1, 0, 0], { k: 1 });
  assert.equal(s.status().month.vec_dims - before, (3 + 1) * 3);
});

test('US-25-R09: the promotion state survives a new object over the same storage, and the gate card names its default and probe', async () => {
  const sql = openTenantSql(), idx = fakeVectorize();
  const s = new TenantStore({ tenantId: 'acme', sql, budget: { maxVectors: 1 }, vectorize: idx });
  await s.tv.upsert('a', [1, 0]); await s.tv.upsert('b', [0, 1]);
  assert.equal(s.tv.mode(), 'promoting');
  const again = new TenantStore({ tenantId: 'acme', sql, budget: { maxVectors: 1 }, vectorize: idx });
  assert.equal(again.tv.mode(), 'promoting');
  assert.equal((await again.tv.promote()).mode, 'vectorize');
  const card = vectorizeGateCard();
  assert.match(card.default_in_effect, /vector_cap/); assert.deepEqual(card.probe, { get: '/health', path: 'vectors.mode', expect: 'vectorize' });
});

// ---------------- cross-check against the platform (US-25-R10, TS-10) ----------------
test('US-25-R10: 100 self versus 130 platform requests (30 percent) is a finding; 100 versus 115 is not', () => {
  const hit = crossCheck({ self: { requests: 100 }, platform: { requests: 130 } });
  assert.equal(hit.findings.length, 1); assert.deepEqual([hit.findings[0].meter, hit.findings[0].self, hit.findings[0].platform], ['requests', 100, 130]);
  assert.ok(hit.findings[0].divergence > 0.2 && hit.findings[0].divergence < 0.25);
  assert.equal(crossCheck({ self: { requests: 100 }, platform: { requests: 115 } }).findings.length, 0);
  assert.equal(crossCheck({ self: { requests: 100 }, platform: { requests: 70 }, threshold: 0.5 }).findings.length, 0);
});

test('US-25-R10: a null platform reading is reported unmeasured, not as zero or as a finding; no reading at all is not ok', () => {
  const r = crossCheck({ self: { requests: 100, reads: 5000, writes: 10 }, platform: { requests: 100, reads: null } });
  assert.deepEqual(r.unmeasured, ['reads', 'writes']); assert.deepEqual(r.findings, []); assert.equal(r.ok, true);
  assert.equal(crossCheck({ self: { requests: 100 }, platform: {} }).ok, false);
  assert.equal(crossCheck({ self: { requests: 0 }, platform: { requests: 0 } }).compared[0].divergence, 0);
});

test('US-25-R10: declared overhead (the hourly self-test calls) is added before comparing, and sumSelf adds tenant statuses', () => {
  const self = sumSelf([{ month: { requests: 60, reads: 1, writes: 1 } }, { month: { requests: 30, reads: 2, writes: 0 } }]);
  assert.deepEqual(self, { requests: 90, reads: 3, writes: 1 });
  assert.equal(crossCheck({ self, platform: { requests: 130 } }).findings.length, 1);
  assert.equal(crossCheck({ self, platform: { requests: 130 }, overhead: { requests: 35 } }).findings.length, 0);
});

// ---------------- statement classification: a CTE write is a write (US-25-R03, R15) ----------------
import { statementKind, isWriteStatement, freesSpace, stripSql } from './sqlclass.js';

test('US-25-R15: statementKind reads past the first keyword: WITH ... INSERT, UPDATE and DELETE are DML, a WITH ... SELECT using replace() is a read', () => {
  assert.equal(statementKind('SELECT 1'), 'read');
  assert.equal(statementKind('  -- note\n SELECT 1'), 'read');
  assert.equal(statementKind('PRAGMA page_count'), 'read');
  assert.equal(statementKind('WITH c AS (SELECT 1 x) SELECT replace(x, 1, 2) FROM c'), 'read');
  assert.equal(statementKind("WITH c AS (SELECT 1 x) SELECT 'insert into t' FROM c"), 'read');            // a keyword inside text is text
  assert.equal(statementKind('WITH c(x) AS (SELECT 1) INSERT INTO t SELECT x FROM c'), 'dml');
  assert.equal(statementKind('WITH c(x) AS (SELECT 1) UPDATE t SET a = (SELECT x FROM c)'), 'dml');
  assert.equal(statementKind('WITH c(x) AS (SELECT 1) DELETE FROM t WHERE a IN (SELECT x FROM c)'), 'dml');
  assert.equal(statementKind('WITH c(x) AS (SELECT 1) REPLACE INTO t SELECT x FROM c'), 'dml');
  assert.equal(statementKind('/* hide */ INSERT INTO t VALUES (1)'), 'dml');
  assert.equal(statementKind('CREATE TABLE t(a)'), 'ddl');
  assert.ok(isWriteStatement('WITH c AS (SELECT 1) DELETE FROM t'));
  assert.ok(freesSpace('DELETE FROM t') && !freesSpace('INSERT INTO t VALUES (1)'));
});

test('US-25-R15: a WITH ... INSERT at the storage ceiling is refused like a plain INSERT, and a CTE write is metered and capped per statement (US-25-R03)', () => {
  const s = mk({ day: { writes: 3000 }, perQueryWrites: 10 });
  s.query('CREATE TABLE t(a INTEGER)');
  const cte = (n) => `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < ${n}) INSERT INTO t SELECT x FROM c`;
  assert.throws(() => s.query(cte(100)), (e) => e.code === 'write_too_wide');           // refused by the statement write cap ...
  assert.equal(s.sql.raw.prepare('SELECT COUNT(*) n FROM t').get().n, 0);                // ... and rolled back
  const before = s.status().day.writes;
  assert.equal(s.query(cte(5)).rowsWritten, 5);
  assert.equal(s.status().day.writes - before, 5, 'the CTE write is metered as written rows, not as a read');
  s.guard.budget.maxStorageBytes = 1;                                                    // the store is full
  assert.throws(() => s.query('INSERT INTO t VALUES (9)'), (e) => e.code === 'budget_exceeded' && e.limit === 'storage');
  assert.throws(() => s.query(cte(2)), (e) => e.code === 'budget_exceeded' && e.limit === 'storage');
  assert.equal(s.sql.raw.prepare('SELECT COUNT(*) n FROM t').get().n, 5);
  assert.doesNotThrow(() => s.query('WITH c AS (SELECT 1 x) SELECT x FROM c'));         // reads still work at the ceiling
});

test('US-25-R03: a -- or /* inside a string literal is text, so it hides neither a CTE write nor a later keyword (one left-to-right scan)', () => {
  const dash = "WITH RECURSIVE n(note) AS (SELECT '--'), c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 100) INSERT INTO t SELECT x FROM c";
  const block = "WITH n(note) AS (SELECT '/*'), c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 100) INSERT INTO t SELECT x FROM c -- */";
  assert.equal(statementKind(dash), 'dml');
  assert.equal(statementKind(block), 'dml');
  assert.equal(statementKind("SELECT 'it''s -- text' FROM t"), 'read');
  assert.equal(statementKind('SELECT "insert" FROM t'), 'read', 'a quoted identifier is a name, not a keyword');
  assert.equal(stripSql("a '--' b /* c */ d -- e\nf"), "a '' b   d  \nf");
  for (const q of [dash, block]) {
    const s = mk({ day: { writes: 3000 }, perQueryWrites: 10 });
    s.query('CREATE TABLE t(x INTEGER)');
    assert.throws(() => s.query(q), (e) => e.code === 'write_too_wide', q);               // capped per statement ...
    assert.equal(s.sql.raw.prepare('SELECT COUNT(*) n FROM t').get().n, 0);              // ... and rolled back
    s.guard.budget.maxStorageBytes = 1;                                                  // the store is full
    assert.throws(() => s.query(q), (e) => e.code === 'budget_exceeded' && e.limit === 'storage', q);
  }
});

test('US-25-R03: CREATE TABLE ... AS SELECT on the SQLite adapter is metered and capped: its scan and the rows it copies count, and a refused one is rolled back', () => {
  const s = mk({ day: { writes: 100000, reads: 100000 }, perQueryReads: 50, perQueryWrites: 10 });
  s.query('CREATE TABLE src(a INTEGER)');
  s.sql.raw.exec('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 3000) INSERT INTO src SELECT x FROM c');
  assert.throws(() => s.query('CREATE TABLE copy AS SELECT * FROM src'), (e) => e.code === 'query_too_wide' || e.code === 'write_too_wide');
  assert.equal(s.sql.raw.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name = 'copy'`).get().n, 0, 'the refused CTAS left no table');
  assert.ok(s.status().day.reads >= 3000, 'the refused CTAS was charged for what it read');
  const before = s.status().day.writes;
  const r = s.query('CREATE TABLE few AS SELECT * FROM src WHERE rowid <= 5');
  assert.equal(r.rowsWritten, 5);
  assert.equal(s.status().day.writes - before, 5, 'the rows a CTAS copies are metered as written');
});

// A fake ctx.storage.sql with the platform's documented exec semantics: every ';'-separated statement runs, and the returned cursor (rows,
// rowsRead, rowsWritten) is the last statement's. The test texts hold no ';' inside a literal, so a plain split is enough here.
function multiExecStorage() {
  const raw = new DatabaseSync(':memory:');
  const isRead = (t) => /^\s*(select|with|values|pragma)/i.test(t) && !/\b(insert|update|delete)\b/i.test(t);
  return {
    raw,
    sql: {
      get databaseSize() { return raw.prepare('PRAGMA page_count').get().page_count * raw.prepare('PRAGMA page_size').get().page_size; },
      exec(text, ...params) {
        const parts = text.split(';').map(s => s.trim()).filter(Boolean);
        for (const p of parts.slice(0, -1)) raw.exec(p);
        const last = parts[parts.length - 1], st = raw.prepare(last);
        const rows = isRead(last) ? st.all(...params) : [], written = isRead(last) ? 0 : Number(st.run(...params).changes);
        return { rowsRead: rows.length, rowsWritten: written, [Symbol.iterator]() { return rows[Symbol.iterator](); } };
      },
    },
    transactionSync(fn) { raw.exec('SAVEPOINT t'); try { const v = fn(); raw.exec('RELEASE t'); return v; } catch (e) { raw.exec('ROLLBACK TO t'); raw.exec('RELEASE t'); throw e; } },
  };
}

test('US-25-R03: a text of several statements is refused with multiple_statements before it runs, on the Durable Object and the SQLite adapter, and charged as a request', () => {
  const ctas = 'SELECT 1; CREATE TABLE c2 AS SELECT * FROM src; SELECT 1', ins = 'INSERT INTO src SELECT x FROM src; SELECT 1';
  const fill = (raw) => raw.exec('CREATE TABLE src(x); WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 5000) INSERT INTO src SELECT x FROM c');
  const budget = { day: { writes: 30, reads: 1_000_000, requests: 1000 }, perQueryWrites: 10, perQueryReads: 50_000 };
  // Durable Object adapter: the store is not full, then full. Both texts are refused and change nothing.
  const storage = multiExecStorage(); fill(storage.raw);
  const d = new (makeTenantDO(class {}))({ storage, id: { name: 'acme' } }, { TENANT_BUDGETS: JSON.stringify({ acme: budget }) });
  for (const full of [false, true]) {
    if (full) { d.store('acme').guard.budget.maxStorageBytes = 1; assert.equal(d.query('acme', 'CREATE TABLE c1 AS SELECT * FROM src').error.code, 'budget_exceeded'); }
    for (const t of [ctas, ins]) {
      const before = { ...d.status('acme').value.day };                         // a copy: status returns the live row
      const r = d.query('acme', t);
      assert.deepEqual([r.ok, r.error && r.error.code], [false, 'multiple_statements'], `${t} (store full: ${full})`);
      const after = d.status('acme').value.day;
      assert.deepEqual([after.requests - before.requests, after.writes - before.writes], [1, 0], 'charged as one request, nothing written');
    }
    assert.equal(storage.raw.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name = 'c2'`).get().n, 0, 'the hidden CTAS never ran');
    assert.equal(storage.raw.prepare('SELECT COUNT(*) n FROM src').get().n, 5000, 'the hidden INSERT ... SELECT never ran');
  }
  // SQLite adapter: the same refusal, before node:sqlite sees the text.
  const s = mk(budget); fill(s.sql.raw);
  for (const t of [ctas, ins]) assert.throws(() => s.query(t), (e) => e.code === 'multiple_statements', t);
  // One statement with a trailing ';', a trailing comment, or a ';' inside a literal or a quoted name is still one statement.
  for (const t of ['SELECT 1;', 'SELECT 1; -- note', "SELECT ';' AS x", 'SELECT 1 AS "a;b"', 'SELECT 1; /* end */  ']) assert.doesNotThrow(() => s.query(t), t);
});

// ---------------- promotion writes are metered (US-25-R14) ----------------
test('US-25-R14: in promoting mode every row the facade writes is charged: metered writes equal the SqlPort rows written, apart from the declared exemptions', async () => {
  const sql = openTenantSql(); let actual = 0;
  const ex = sql.exec.bind(sql);
  const port = { raw: sql.raw, storageBytes: sql.storageBytes, exec(text, params, limits) {
    const r = ex(text, params, limits);
    if (!/\b_budget\b|\b_tenant\b/.test(text)) actual += r.rowsWritten;       // the same exemptions as the local-mode test: the pin and the budget table
    return r;
  } };
  const idx = fakeVectorize();
  const s = new TenantStore({ tenantId: 'acme', sql: port, budget: { maxVectors: 2 }, vectorize: idx });
  for (let i = 0; i < 2; i++) await s.tv.upsert('v' + i, [1, 0, 0]);              // local mode
  s.guard.flush();
  actual = 0; const before = s.guard.usage().day.writes;
  for (let i = 2; i < 12; i++) await s.tv.upsert('v' + i, [1, 0, 0]);             // the first one switches the mode; all go through the port
  assert.equal(s.tv.mode(), 'promoting');
  const metered = s.guard.usage().day.writes - before;
  assert.ok(actual > 0, 'promotion wrote rows');
  assert.equal(metered, actual, `charged ${metered} rows written vs the SqlPort's ${actual}`);
  actual = 0; const b2 = s.guard.usage().day.writes;
  assert.equal((await s.tv.promote({ maxBatches: 10 })).mode, 'vectorize');
  assert.equal(s.guard.usage().day.writes - b2, actual, 'the promotion batches (delete, counter update, state rows) are charged too');
});

// ---------------- the worst case covers Vectorize (US-25-R07, R09) ----------------
test('US-25-R07: the worst case costs Vectorize queried dimensions when a binding exists, and is stated as local-mode only when it does not', () => {
  const five = Array(5).fill(PAID_PLAN_BUDGET);
  const local = worstCase(five), vec = worstCase(five, undefined, { vectorize: true });
  assert.equal(Number(local.total.toFixed(2)), 7.1); assert.equal(local.vectorize, false);
  assert.equal(vec.vectorize, true);
  assert.ok(vec.total > 100, `five Paid budgets with Vectorize reachable cost ${vec.total.toFixed(2)}, far above the USD 8 ceiling`);
  assert.ok(worstCase(Array(5).fill(FREE_PLAN_BUDGET), undefined, { plan: 'free', vectorize: true }).paidEquivalentUsd > 100);
});

test('US-25-R07: a tenant promoting to Vectorize (or a configured binding) makes the probe cost Vectorize, in the projection and in the worst case', () => {
  const snap = (vectorMode) => [{ tenantId: 'a', month: { reads: 0, writes: 0, requests: 1e6, vec_dims: 20e9 }, vectorMode }];
  const budgets = Array(5).fill(PAID_PLAN_BUDGET);
  const loc = probe(snap('local'), { budgets, dayOfMonth: 30, daysInMonth: 30 });
  assert.equal(loc.vectorize, false); assert.equal(loc.worstCase.totalUsd, 7.1); assert.equal(loc.status, 'ok');
  const prom = probe(snap('promoting'), { budgets, dayOfMonth: 30, daysInMonth: 30 });
  assert.equal(prom.vectorize, true); assert.equal(prom.worstCase.vectorize, true); assert.ok(prom.worstCase.totalUsd > 100);
  assert.equal(prom.status, 'breach', 'the projected month of queried dimensions breaches the ceiling');
  assert.equal(probe(snap('local'), { budgets, vectorize: true, dayOfMonth: 30, daysInMonth: 30 }).worstCase.vectorize, true);   // the host says a binding is configured
});

test('US-25-R07: capping every tenant at maxVecDimsMonth keeps the Vectorize worst case under the ceiling', () => {
  const five = Array(5).fill(PAID_PLAN_BUDGET);
  const cap = maxVecDimsMonth(five, { ceilingUsd: 8 });
  assert.ok(cap > 0 && cap < PAID_PLAN_BUDGET.month.vecDims);
  const capped = five.map(b => ({ ...b, month: { ...b.month, vecDims: cap } }));
  const wc = worstCase(capped, undefined, { vectorize: true });
  assert.ok(wc.total <= 8 + 1e-9, `capped Vectorize worst case ${wc.total}`);
  assert.ok(worstCase(five.map(b => ({ ...b, month: { ...b.month, vecDims: cap + 1_000_000 } })), undefined, { vectorize: true }).total > 8, 'and a larger cap would breach it');
});
