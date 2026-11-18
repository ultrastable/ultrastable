// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, sampleFreeTier, FREE_LIMITS } from '../src/freetier.js';

const noon = new Date('2026-11-17T12:00:00Z');
test('under 80% and a flat pace is ok', () => {
  const r = evaluate({ d1_rows_read: 1_000_000, d1_rows_written: 10_000, workers_requests: 10_000, ai_neurons: 1_000 }, noon);
  assert.equal(r.level, 'ok');
});
test('a pace that passes the day limit degrades before the limit is hit', () => {
  const r = evaluate({ d1_rows_read: 2_600_000 }, noon);  // 52% by noon -> 104% projected
  assert.equal(r.level, 'degrade');
});
test('95% sheds', () => assert.equal(evaluate({ ai_neurons: 9_600 }, noon).level, 'shed'));
test('an unmeasured resource is never a breach', () => assert.equal(evaluate({}, noon).level, 'ok'));
test('sampler records usage, neurons from the ledger, and redacts the token on error', async () => {
  const rows = [];
  const db = { prepare: (sql) => ({ bind: (...a) => ({ first: async () => ({ u: 123 }), run: async () => { rows.push(a); } }) }) };
  const f = async () => ({ ok: true, status: 200, json: async () => ({ data: { viewer: { accounts: [{ d1: [{ sum: { rowsRead: 10, rowsWritten: 2 } }], w: [{ sum: { requests: 7 } }] }] } } }) });
  const r = await sampleFreeTier(db, { token: 't', account_id: 'a', fetch: f, now: noon });
  assert.deepEqual([r.used.d1_rows_read, r.used.d1_rows_written, r.used.workers_requests, r.used.ai_neurons], [10, 2, 7, 123]);
  assert.equal(rows.length, Object.keys(FREE_LIMITS).length);
  const bad = async () => { throw new Error('boom secrettoken'); };
  const r2 = await sampleFreeTier(db, { token: 'secrettoken', account_id: 'a', fetch: bad, now: noon });
  assert.ok(!String(r2.error).includes('secrettoken'));
});

import { alertFreeTier } from '../src/freetier.js';
test('READ-BUDGET-8: an item is filed once per resource per day when a free limit is projected past 70%', async () => {
  const rows = new Map();
  const db = { prepare: () => ({ bind: (...a) => ({ run: async () => { const had = rows.has(a[0]); if (!had) rows.set(a[0], a); return { meta: { changes: had ? 0 : 1 } }; } }) }) };
  const res = { resources: { d1_rows_read: { used: 3_600_000, frac: 0.72, projected_frac: 0.9, level: 'ok' }, workers_requests: { used: 10, frac: 0.0001, projected_frac: 0.001, level: 'ok' } } };
  const now = new Date('2026-11-18T12:00:00Z');
  assert.deepEqual(await alertFreeTier(db, res, now), ['FREE-TIER-ALERT-d1_rows_read-2026-11-18']);
  assert.deepEqual(await alertFreeTier(db, res, now), []);
});
