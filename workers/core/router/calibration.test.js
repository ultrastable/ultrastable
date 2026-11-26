// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createRouter } from './router.js';
import { calibrate, probes, ema, effectiveConfig, scheduleDue, weeklyStress, monthlyCleanup, applyAdjustment, verifyAdjustments, probeOne } from './calibration.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const EX = JSON.parse(readFileSync(new URL('./example-config.json', import.meta.url), 'utf8'));
const ENV = { PROVIDER_A_API_KEY: 'sk-aaaa-secret', PROVIDER_B_API_KEY: 'sk-bbbb-secret' };
function mk(h) {
  const db = makeDb([MIG]); let t = 0;
  const fetch = async (url, init) => {
    const a = url.includes('provider-a'), mode = a ? h.a : h.b;
    if (mode.fail) return new Response('x', { status: 500 });
    const text = mode.bad ? 'garbage' : (JSON.parse(init.body).messages?.[0]?.content?.includes('JSON') ? '{"ok":true}' : 'OK');
    return new Response(JSON.stringify(a ? { choices: [{ message: { content: text } }], usage: {} } : { content: [{ type: 'text', text }], usage: {} }), { status: 200 });
  };
  const now = () => (t += 5);
  const router = createRouter({ db, fetch, now, config: EX, env: ENV });
  return { ctx: { db, now, config: {}, router }, router };
}
const args = { providers: EX.providers, rungs: ['small'] };

test('a failing provider is steered away after a streak, the other route stays', async () => {
  const { ctx, router } = mk({ a: { fail: true }, b: {} });
  let r; for (let i = 0; i < 2; i++) r = await calibrate(ctx, args);
  assert.deepEqual(r.switched_off, ['provider-a']);
  const plan = await router.route({ rung: 'small' });
  assert.ok(plan.ok && plan.candidates.every(c => c.provider === 'provider-b'));
  assert.equal((await ctx.db.prepare("SELECT status FROM items WHERE id='CAL-provider-a'").first()).status, 'open');
});

test('the last healthy route is never switched off', async () => {
  const { ctx } = mk({ a: { fail: true }, b: { fail: true } });
  for (let i = 0; i < 3; i++) await calibrate(ctx, args);
  const sw = (await ctx.db.prepare("SELECT COUNT(*) n FROM router_switches WHERE is_on=1").first()).n;
  assert.equal(sw, 0);
});

test('recovery switches the provider back on and closes the item', async () => {
  const h = { a: { fail: true }, b: {} };
  const { ctx, router } = mk(h);
  for (let i = 0; i < 2; i++) await calibrate(ctx, args);
  assert.equal((await router.route({ rung: 'small' })).candidates.some(c => c.provider === 'provider-a'), false);
  h.a.fail = false;
  let r; for (let i = 0; i < 2; i++) r = await calibrate(ctx, args);
  assert.ok(r.switched_on.includes('provider-a'));
  assert.equal((await ctx.db.prepare("SELECT status FROM items WHERE id='CAL-provider-a'").first()).status, 'done');
  assert.ok(probes.length >= 2);
});

// ---- US-09 infrastructure calibration: adaptive thresholds, schedules, verified adjustments ----

const DAY = 86400000, T0 = Date.UTC(2026, 10, 26, 12, 0, 0);
function timed() {
  const db = makeDb([MIG]), clock = { t: T0, ms: 100 };
  const fetch = async (url, init) => {
    clock.t += clock.ms;
    const a = url.includes('provider-a'), text = JSON.parse(init.body).messages?.[0]?.content?.includes('JSON') ? '{"ok":true}' : 'OK';
    return new Response(JSON.stringify(a ? { choices: [{ message: { content: text } }], usage: {} } : { content: [{ type: 'text', text }], usage: {} }), { status: 200 });
  };
  const now = () => clock.t;
  const router = createRouter({ db, fetch, now, config: EX, env: ENV });
  return { clock, ctx: { db, now, config: {}, router } };
}
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

test('the EMA baseline of mean 120 and deviation 15 gives threshold 165 and a 240 ms run is an anomaly', async () => {
  assert.equal(ema(null, 100), 100);
  assert.equal(ema(100, 200, 0.2), 120);
  const { ctx, clock } = timed();
  ctx.db.raw.prepare(`INSERT INTO router_baseline (provider, rung, probe, mean_ms, dev_ms, n, updated_at) VALUES ('provider-a','small','nonempty',120,15,20,'2026-11-26 11:00:00')`).run();
  clock.ms = 160; // under 120 + 3 x 15 = 165
  assert.equal((await probeOne(ctx, 'provider-a', 'small')).find(r => r.probe === 'nonempty').anomaly, false);
  ctx.db.raw.prepare(`UPDATE router_baseline SET mean_ms=120, dev_ms=15, n=20`).run();
  clock.ms = 240;
  const r = await probeOne(ctx, 'provider-a', 'small');
  assert.equal(r.find(x => x.probe === 'nonempty').anomaly, true);
  assert.match(one(ctx.db, `SELECT detail FROM router_calibration WHERE probe='nonempty' ORDER BY id DESC LIMIT 1`).detail, /anomaly: 240 ms over 165 ms/);
  assert.equal(one(ctx.db, `SELECT status FROM items WHERE id='CAL-LAT-provider-a'`).status, 'open');
  assert.equal(one(ctx.db, `SELECT ok FROM router_calibration WHERE probe='nonempty' ORDER BY id DESC LIMIT 1`).ok, 1, 'an anomaly is slow, not failed: the streak rule is unchanged');
});

test('a threshold does not act before min_samples', async () => {
  const { ctx, clock } = timed();
  ctx.db.raw.prepare(`INSERT INTO router_baseline (provider, rung, probe, mean_ms, dev_ms, n, updated_at) VALUES ('provider-a','small','nonempty',120,15,3,'2026-11-26 11:00:00')`).run();
  clock.ms = 5000;
  assert.equal((await probeOne(ctx, 'provider-a', 'small')).every(r => !r.anomaly), true);
  const b = one(ctx.db, `SELECT n, mean_ms FROM router_baseline WHERE probe='nonempty'`);
  assert.equal(b.n, 4);
  assert.ok(b.mean_ms > 120, 'the baseline learned from the healthy run');
});

test('a weekly stress run records p50 and p95 and a monthly cleanup writes a summary before deleting', async () => {
  const { ctx, clock } = timed();
  assert.equal(await scheduleDue({ db: ctx.db, now: T0, kind: 'weekly_stress' }), true);
  const lat = [100, 100, 100, 100, 500]; let i = 0;
  const base = ctx.router;
  ctx.router = { ...base, call: async req => { clock.t += lat[i++ % 5]; return base.call({ ...req }); } };
  clock.ms = 0;
  const out = await weeklyStress(ctx, { providers: { 'provider-a': EX.providers['provider-a'] }, rungs: ['small'] });
  assert.equal(out.length, probes.length);
  const s = one(ctx.db, `SELECT n, p50_ms, p95_ms FROM router_calibration_summary WHERE kind='stress' AND probe='echo-json'`);
  assert.deepEqual([s.n, s.p50_ms, s.p95_ms], [5, 100, 500]);
  assert.equal(await scheduleDue({ db: ctx.db, now: T0 + 3 * DAY, kind: 'weekly_stress' }), false);
  assert.equal(await scheduleDue({ db: ctx.db, now: T0 + 8 * DAY, kind: 'weekly_stress' }), true);
  // rows older than retention are summarized, then deleted
  ctx.db.raw.prepare(`INSERT INTO router_calibration (at, provider, rung, probe, ok, latency_ms, detail) VALUES ('2026-05-01 00:00:00','provider-a','small','echo-json',1,100,'ok'), ('2026-05-02 00:00:00','provider-a','small','echo-json',0,300,'failed')`).run();
  assert.equal(await scheduleDue({ db: ctx.db, now: T0, kind: 'monthly_cleanup' }), true);
  const before = one(ctx.db, `SELECT COUNT(*) AS n FROM router_calibration`).n;
  const r = await monthlyCleanup(ctx);
  assert.deepEqual([r.deleted, r.summaries], [2, 1]);
  assert.equal(one(ctx.db, `SELECT COUNT(*) AS n FROM router_calibration`).n, before - 2);
  const m = one(ctx.db, `SELECT n, ok_n, mean_ms FROM router_calibration_summary WHERE kind='monthly'`);
  assert.deepEqual([m.n, m.ok_n, m.mean_ms], [2, 1, 200]);
  assert.equal(await scheduleDue({ db: ctx.db, now: T0, kind: 'monthly_cleanup' }), false);
  await assert.rejects(scheduleDue({ db: ctx.db, now: T0, kind: 'hourly' }), /unknown schedule/);
});

test('an adjustment outside the allowlist is refused; one that regressed the metric is reverted on the next run; one that held is kept', async () => {
  const { ctx, clock } = timed();
  await assert.rejects(applyAdjustment({ ctx, key: 'api_key', value: 'x' }), /not on the allowlist/);
  await assert.rejects(applyAdjustment({ ctx, key: 'max_latency_ms', value: 5000, allow: ['fail_streak_off'] }), /not on the allowlist/);
  assert.equal((await effectiveConfig(ctx)).max_latency_ms, 20000);
  await applyAdjustment({ ctx, key: 'max_latency_ms', value: 5000, metric: 0.99 });
  assert.equal((await effectiveConfig(ctx)).max_latency_ms, 5000, 'in force once applied');
  clock.t += 60000;
  assert.deepEqual(await verifyAdjustments({ ctx, readMetric: async () => 0.7 }), [{ key: 'max_latency_ms', status: 'reverted', before: 0.99, after: 0.7 }]);
  assert.equal((await effectiveConfig(ctx)).max_latency_ms, 20000, 'a reverted adjustment is no longer in force');
  await applyAdjustment({ ctx, key: 'fail_streak_off', value: 4, metric: 0.9 });
  clock.t += 60000;
  assert.equal((await verifyAdjustments({ ctx, readMetric: async () => 0.95 }))[0].status, 'kept');
  assert.equal((await effectiveConfig(ctx)).fail_streak_off, 4);
  assert.deepEqual(await verifyAdjustments({ ctx, readMetric: async () => 0 }), [], 'a decided adjustment is not judged again');
});
