// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateDay, level, metersFrom, tenantSpend, spendConfig, recordSpend, readSpend, BANDS, usageQuery } from '../src/spend.js';

const noon = new Date('2026-11-21T12:00:00Z');
// Measured on the ultrastable account, 24 h to 2026-11-21 10:30 UTC.
const today = { requests: 98_636, cpu_ms: 927_000, d1_rows_read: 5_742_098, d1_rows_written: 76_001, ai_neurons: 9_645, kv_reads: 116_357, kv_writes: 2_206 };

test('free plan bills nothing; the paid equivalent of today is the base fee share and almost no overage', () => {
  const e = estimateDay(today, { plan: 'free', now: noon });
  assert.equal(e.usd_today, 0);
  assert.ok(e.paid_equivalent_usd > 0.16 && e.paid_equivalent_usd < 0.3, String(e.paid_equivalent_usd));
});
test('overage is priced per meter above a 1/30 slice of the monthly allowance', () => {
  const e = estimateDay({ ai_neurons: 110_000, d1_rows_written: 50e6 / 30 + 1e6 }, { plan: 'paid', now: noon });
  assert.equal(e.by_meter.ai_neurons, 1.1);
  assert.equal(e.by_meter.d1_rows_written, 1);
});
test('graduated bands: full, ease, throttle, crawl; never a stop', () => {
  const at = (usd) => level({ plan: 'paid', usd_today: usd, fixed_usd: 0.17 }, 5, new Date('2026-11-21T01:00:00Z')).level;
  assert.deepEqual([at(1), at(3), at(4), at(6), at(500)], ['full', 'ease', 'throttle', 'crawl', 'crawl']);
  assert.ok(BANDS.every(b => b.pace > 0 && b.level !== 'stop'));
  assert.ok(BANDS[BANDS.length - 1].text.includes('Nothing stops'));
});
test('a fast morning pace throttles before the target is reached', () => {
  const lv = level({ plan: 'paid', usd_today: 1.5, fixed_usd: 0.17 }, 5, new Date('2026-11-21T06:00:00Z'));
  assert.ok(lv.projected_usd_day > 5); assert.equal(lv.level, 'crawl');
});
test('meters from one GraphQL reading, with R2 class split and Durable Object GB-s', () => {
  const m = metersFrom({ d1: [{ sum: { rowsRead: 10, rowsWritten: 2 }, dimensions: { databaseId: 'db1' } }], w: [{ sum: { requests: 7, cpuTimeUs: 5000 }, dimensions: { scriptName: 'tenant-ps-web' } }],
    ai: [{ sum: { totalNeurons: 12.5 } }], kv: [{ sum: { requests: 3 }, dimensions: { actionType: 'read' } }, { sum: { requests: 2 }, dimensions: { actionType: 'write' } }],
    r2: [{ sum: { requests: 4 }, dimensions: { actionType: 'PutObject' } }, { sum: { requests: 9 }, dimensions: { actionType: 'GetObject' } }], dor: [{ sum: { requests: 1 } }], dod: [{ sum: { activeTime: 1e6 } }] });
  assert.deepEqual([m.used.requests, m.used.cpu_ms, m.used.ai_neurons, m.used.kv_reads, m.used.kv_writes, m.used.r2_class_a, m.used.r2_class_b], [7, 5, 12.5, 3, 2, 4, 9]);
  assert.equal(m.used.do_gb_s, 0.128); assert.equal(m.byScript['tenant-ps-web'].requests, 7);
  assert.match(usageQuery('acct', 'a', 'b'), /aiInferenceAdaptiveGroups/);
});
test('per-tenant shares: a tenant past its share of the target sees its own level rise', () => {
  const spend = spendConfig({ spend: { tenants: [{ id: 'ps', share: 0.2, scripts: ['tenant-ps-*'] }, { id: 'core', share: 0.8, scripts: ['ultrastable-*'] }] } });
  const t = tenantSpend(spend, { 'tenant-ps-web': { requests: 2e6, cpu_ms: 1e6 }, 'ultrastable-tick': { requests: 1e4, cpu_ms: 1e5 } }, {}, { plan: 'paid', now: noon.getTime() });
  const ps = t.find(x => x.id === 'ps'), core = t.find(x => x.id === 'core');
  assert.ok(ps.usd_today > core.usd_today); assert.notEqual(ps.level, 'full'); assert.equal(core.level, 'full');
});
test('target knob: config, then SPEND_TARGET_USD_DAY without a deploy; nonsense falls back to 5', () => {
  assert.equal(spendConfig({}).target_usd_day, 5);
  assert.equal(spendConfig({ spend: { target_usd_day: 3 } }).target_usd_day, 3);
  assert.equal(spendConfig({}, { SPEND_TARGET_USD_DAY: '2.5' }).target_usd_day, 2.5);
  assert.equal(spendConfig({}, { SPEND_TARGET_USD_DAY: '-1' }).target_usd_day, 5);
});
test('record and read: state in org.spend_state, extra meters as samples; stale or missing reads as full', async () => {
  const rows = [], org = new Map();
  const db = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { if (/INTO org/.test(sql)) org.set('spend_state', a[0]); else rows.push(a); } }), first: async () => org.has('spend_state') ? { value: org.get('spend_state') } : null }) };
  assert.equal((await readSpend(db, noon.getTime())).level, 'full');
  const s = await recordSpend(db, { meters: { used: { ...today, ai_neurons: 400_000 } }, env: { CF_PLAN: 'paid' }, now: noon });
  assert.equal(s.level, 'crawl'); assert.ok(rows.some(r => r[1] === 'spend_usd'));
  assert.equal((await readSpend(db, noon.getTime() + 60e3)).level, 'crawl');
  assert.equal((await readSpend(db, noon.getTime() + 3 * 3600e3)).level, 'full', 'a stale reading never throttles');
  const blind = await recordSpend(db, { meters: { used: { ...today, ai_neurons: 400_000 } }, env: {}, now: noon });
  assert.equal(blind.level, 'crawl', 'PLAN-SAFE-1: paid usage throttles even when CF_PLAN was never set'); assert.equal(blind.usd_today, 0);
  assert.equal((await recordSpend(db, { meters: { used: today }, env: {}, now: noon })).level, 'full', 'free-plan-sized usage never throttles');
  const none = await recordSpend(db, { meters: null, error: 'no token', now: noon });
  assert.equal(none.measured, false); assert.equal(none.level, 'full');
});

import { planOf } from '../src/budget.js';
import { capsFor, SUBREQUEST_CAP } from '../src/subreq.js';
import { evaluate, limitsFor } from '../src/freetier.js';
test('PLAN-1: the plan comes from CF_PLAN, else the manifest; paid lifts the free-only throttles', () => {
  assert.equal(planOf({ budget: { plan: 'paid' } }, {}), 'paid');
  assert.equal(planOf({ budget: { plan: 'paid' } }, { CF_PLAN: 'free' }), 'free');
  assert.equal(planOf({}, {}), 'free');
  assert.equal(capsFor('free').cap, SUBREQUEST_CAP); assert.equal(capsFor('free').rotate, true);
  assert.equal(capsFor('paid').rotate, false); assert.ok(capsFor('paid').cap >= 1000);
  const day = { d1_rows_read: 5_742_098, d1_rows_written: 76_001, workers_requests: 98_636, ai_neurons: 9_645 };
  assert.equal(evaluate(day, noon, limitsFor('free')).level, 'shed', 'measured usage sheds on the free plan');
  assert.equal(evaluate(day, noon, limitsFor('paid')).level, 'ok', 'and runs at full speed on the paid plan');
});
