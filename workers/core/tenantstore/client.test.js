// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the tenant client handle and the spend report body (US-25-R16, R07). A fake Worker built from TenantStore over the SQLite adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTenantSql } from '../../adapters/sqlite/tenant-sqlite.js';
import { TenantStore, BudgetError } from './store.js';
import { FREE_PLAN_BUDGET } from './budget.js';
import { createTenantClient } from './client.js';
import { spendReport } from './spend-route.js';

// The same routes and status codes as adapters/cloudflare/src/tenants-worker.js, without the platform.
function fakeWorker(budgets = {}, token = 'tok') {
  const stores = new Map(), calls = [];
  const store = id => { if (!stores.has(id)) stores.set(id, new TenantStore({ tenantId: id, sql: openTenantSql(), budget: budgets[id] || {} })); return stores.get(id); };
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, auth: init.headers?.authorization });
    if (init.headers?.authorization !== `Bearer ${token}`) return json({ code: 'unauthorized' }, 401);
    const m = /\/t\/([a-z0-9-]+)\/(query|vec\/upsert|vec\/query|rollup|status)$/.exec(new URL(url).pathname);
    if (!m) return json({ code: 'not_found' }, 404);
    const s = store(m[1]), b = init.body ? JSON.parse(init.body) : {};
    try {
      if (m[2] === 'query') return json(s.query(b.sql, b.params || []));
      if (m[2] === 'vec/upsert') { s.vectors.upsert(b.id, b.vector, { ns: b.ns, meta: b.meta }); return json(true); }
      if (m[2] === 'vec/query') return json(s.vectors.query(b.vector, { k: b.k, ns: b.ns }));
      if (m[2] === 'rollup') { s.rollups.add(b.name, b.key, b); return json(true); }
      return json(s.status());
    } catch (e) { return json({ code: e.code || 'error', message: e.message, limit: e.limit, period: e.period, resetsAt: e.resetsAt }, e.code === 'budget_exceeded' ? 429 : 400); }
  };
  return { fetch, calls, stores };
}
const client = (w, o = {}) => createTenantClient({ fetcher: w, token: 'tok', tenantId: 'acme', ...o });

test('US-25-R16: the client refuses a path-like tenant id before any request', () => {
  const w = fakeWorker();
  for (const bad of ['../x', 'A', 'a', 'a/b', '', undefined, 'x'.repeat(64)]) assert.throws(() => client(w, { tenantId: bad }), /bad_tenant_id/, String(bad));
  assert.throws(() => createTenantClient({ fetcher: w, tenantId: 'acme' }), /token required/);
  assert.equal(w.calls.length, 0);
});

test('US-25-R16: query, vector and rollup calls round-trip through a fake worker, with a service binding or a plain fetch', async () => {
  const w = fakeWorker();
  for (const c of [client(w), createTenantClient({ fetcher: w.fetch, token: 'tok', tenantId: 'acme' })]) {
    await c.query('CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, st TEXT)');
    await c.query('INSERT OR REPLACE INTO jobs VALUES(?, ?)', [7, 'ok']);
    assert.deepEqual((await c.query('SELECT st FROM jobs WHERE id = ?', [7])).rows, [{ st: 'ok' }]);
    await c.rollups.add('jobs_by_status', 'ok'); await c.rollups.add('jobs_by_status', 'ok');
    assert.equal((await c.rollups.get('jobs_by_status', 'ok')).n >= 2, true);
    assert.equal(await c.rollups.get('jobs_by_status', 'missing'), null);
    await c.vectors.upsert('a', [1, 0, 0], { ns: 'n' }); await c.vectors.upsert('b', [0, 1, 0], { ns: 'n' });
    assert.equal((await c.vectors.query([0.9, 0.1, 0], { k: 1, ns: 'n' }))[0].id, 'a');
    assert.equal((await c.status()).tenantId, 'acme');
  }
  assert.ok(w.calls.every(c => c.auth === 'Bearer tok' && c.url.includes('/t/acme/')), 'every call is for the handle\'s own tenant');
});

test('US-25-R16: a budget_exceeded reply becomes a BudgetError with limit, period and resetsAt; other refusals keep their code', async () => {
  const w = fakeWorker({ acme: { day: { writes: 2 }, maxVectors: 1, perQueryReads: 3 } });
  const c = client(w);
  await c.query('CREATE TABLE t(x, y)');
  await c.query('INSERT INTO t VALUES(1, 1)'); await c.query('INSERT INTO t VALUES(2, 2)');
  await assert.rejects(() => c.query('INSERT INTO t VALUES(3, 3)'), (e) => e instanceof BudgetError && e.code === 'budget_exceeded' && e.limit === 'writes' && e.period === 'day' && typeof e.resetsAt === 'string' && e.status === 429);
  const v = client(fakeWorker({ acme: { maxVectors: 1 } }));
  await v.vectors.upsert('a', [1, 0]);
  await assert.rejects(() => v.vectors.upsert('b', [0, 1]), (e) => e.code === 'vector_cap' && e.status === 400);
  await assert.rejects(() => createTenantClient({ fetcher: w, token: 'wrong', tenantId: 'acme' }).status(), (e) => e.code === 'unauthorized' && e.status === 401);
});

test('US-25-R07: spendReport returns ok, warn or breach for synthetic statuses, the worst case, and the cross-check when a platform reading is given', () => {
  const st = (requests) => [{ tenantId: 'a', month: { reads: 0, writes: 0, requests, vec_dims: 0 }, storageBytes: 1 }];
  const at = new Date('2026-11-30T12:00:00Z');
  assert.equal(spendReport({ statuses: st(1e6), plan: 'paid', now: () => at }).status, 'ok');
  assert.equal(spendReport({ statuses: st(14e6), plan: 'paid', now: () => at }).status, 'warn');
  assert.equal(spendReport({ statuses: st(40e6), plan: 'paid', now: () => at }).status, 'breach');
  const free = spendReport({ statuses: st(40e6), budgets: Array(5).fill(FREE_PLAN_BUDGET), now: () => at, platform: { requests: 20e6, reads: null } });
  assert.equal(free.plan, 'free'); assert.equal(free.status, 'ok'); assert.equal(free.worstCase.paidEquivalentUsd, 5.2);
  assert.equal(free.crossCheck.findings[0].meter, 'requests'); assert.deepEqual(free.crossCheck.unmeasured, ['reads', 'writes']);
  assert.equal(spendReport({ statuses: st(1), now: () => at }).crossCheck, null);
  assert.equal(free.estimate, true); assert.ok(free.pricesAsOf);
});
