// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// US-SPEC-25 US-25-R20: the account-level soft spend governor (SPEND-SOFT-1) reads Durable Object analytics, attributes usage to tenants and
// turns it into a level that only moves knobs. This is the platform layer above the per-tenant hard budgets of workers/core/tenantstore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { usageQuery, metersFrom, tenantSpend, level, spendConfig, BANDS } from '../src/spend.js';

const noon = new Date('2026-11-21T12:00:00Z');

test('US-25-R20: usageQuery names the Durable Object datasets (requests and active time)', () => {
  const q = usageQuery('acct', '2026-11-21T00:00:00Z', '2026-11-21T12:00:00Z');
  assert.match(q, /durableObjectsInvocationsAdaptiveGroups/); assert.match(q, /durableObjectsPeriodicGroups/);
  assert.match(q, /accountTag:"acct"/);
});

test('US-25-R20: metersFrom reports do_requests and do_gb_s from the Durable Object datasets', () => {
  const m = metersFrom({ dor: [{ sum: { requests: 40 } }, { sum: { requests: 2 } }], dod: [{ sum: { activeTime: 2e6 } }] });
  assert.equal(m.used.do_requests, 42);
  assert.equal(m.used.do_gb_s, 0.256);                       // 2,000,000 microseconds at 128 MB
  assert.deepEqual(metersFrom({}).used, {});                // a missing dataset is unmeasured, not zero
});

test('US-25-R20: tenantSpend attributes usage by script name and keeps tenant levels separate', () => {
  const spend = spendConfig({ spend: { tenants: [{ id: 'tenants', share: 0.2, scripts: ['ultrastable-tenants'] }, { id: 'core', share: 0.8, scripts: ['ultrastable-tick'] }] } });
  const t = tenantSpend(spend, { 'ultrastable-tenants': { requests: 3e6, cpu_ms: 2e6 }, 'ultrastable-tick': { requests: 1e4, cpu_ms: 1e5 } }, {}, { plan: 'paid', now: noon.getTime() });
  const a = t.find(x => x.id === 'tenants'), b = t.find(x => x.id === 'core');
  assert.equal(a.used.requests, 3e6); assert.equal(b.used.requests, 1e4);
  assert.ok(a.usd_today > b.usd_today); assert.notEqual(a.level, 'full'); assert.equal(b.level, 'full');
});

test('US-25-R20: level returns throttle at 70 to 90 percent of the daily target and never stops', () => {
  const at = usd => level({ plan: 'paid', usd_today: usd, fixed_usd: 0.17 }, 5, new Date('2026-11-21T01:00:00Z'));
  assert.equal(at(4).level, 'throttle');
  assert.ok(at(4).share >= 0.7 && at(4).share < 0.9, String(at(4).share));
  assert.ok(BANDS.every(b => b.pace > 0), 'a band that stopped the clock would be a hard cap, which the owner ruled out (SPEND-SOFT-1)');
});
