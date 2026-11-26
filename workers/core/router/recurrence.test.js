// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-09 recurrence and guard fixes: a hard cap that is breached, recovers and is breached again files its item again (R05),
// the same for the calibration items, a guard whose resolved target is not listed is refused (inverted guards), and a drill never
// releases a global switch it did not engage (R03).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createRouter } from './router.js';
import { guardAllowed, costChangeProbe } from './caps/upstream.js';
import * as caps from './caps/index.js';
import { calibrate, probeOne } from './calibration.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const CAPS_MIG = fileURLToPath(caps.MIGRATIONS_DIR);
const EXAMPLE = JSON.parse(readFileSync(new URL('./example-config.json', import.meta.url), 'utf8'));
const KEYS = { PROVIDER_A_API_KEY: 'k-a', PROVIDER_B_API_KEY: 'k-b' };
const DAY = 86400000, T0 = Date.UTC(2026, 10, 26, 12, 0, 0);
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

test('US-09-R05: a hard cap that recovers and is breached again reopens its SPEND item as the top item', async () => {
  const db = makeDb([MIG]), clock = { t: T0 };
  const fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  const router = createRouter({ db, fetch, now: () => clock.t, config: EXAMPLE, env: KEYS });
  const spend = (at, usd) => db.raw.prepare(`INSERT INTO router_calls (at, role, kind, outcome, cost_usd) VALUES (?,?,?,?,?)`).run(new Date(at).toISOString().replace('T', ' ').slice(0, 19), 'doer', 'doer', 'ok', usd);
  const status = () => one(db, `SELECT status, priority FROM items WHERE id='SPEND-role:doer:day'`);
  spend(T0, 3.5);
  await router.route({ role: 'doer', rung: 'small' });
  assert.deepEqual({ ...status() }, { status: 'open', priority: 0 }, 'the first breach files the item');
  clock.t += DAY;
  await router.route({ role: 'doer', rung: 'small' });
  assert.equal(status().status, 'done', 'spend under the cap on a later call closes it');
  spend(clock.t, 3.5);
  await router.route({ role: 'doer', rung: 'small' });
  assert.deepEqual({ ...status() }, { status: 'open', priority: 0 }, 'the second breach of the same scope opens it again');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'SPEND-role:doer%'`).n, 1, 'one item per capped scope, reopened, not duplicated');
});

test('US-09-R15 CAL-<provider> is reopened when a provider fails again after it recovered', async () => {
  const mode = { a: { fail: true } };
  const db = makeDb([MIG]); let t = 0;
  const fetch = async (url) => {
    const a = url.includes('provider-a');
    if (a && mode.a.fail) return new Response('x', { status: 500 });
    const text = '{"ok":true}';
    return new Response(JSON.stringify(a ? { choices: [{ message: { content: text } }], usage: {} } : { content: [{ type: 'text', text }], usage: {} }), { status: 200 });
  };
  const now = () => (t += 5), router = createRouter({ db, fetch, now, config: EXAMPLE, env: KEYS }), ctx = { db, now, config: {}, router };
  const args = { providers: EXAMPLE.providers, rungs: ['small'] };
  for (let i = 0; i < 2; i++) await calibrate(ctx, args);
  assert.equal(one(db, `SELECT status FROM items WHERE id='CAL-provider-a'`).status, 'open');
  mode.a.fail = false;
  for (let i = 0; i < 2; i++) await calibrate(ctx, args);
  assert.equal(one(db, `SELECT status FROM items WHERE id='CAL-provider-a'`).status, 'done');
  mode.a.fail = true;
  for (let i = 0; i < 3; i++) await calibrate(ctx, args);
  assert.equal(one(db, `SELECT status FROM items WHERE id='CAL-provider-a'`).status, 'open', 'the second failure reopens the item the recovery closed');
});

test('US-09-R15 CAL-LAT-<provider> is reopened when a latency anomaly recurs after the item was closed', async () => {
  const db = makeDb([MIG]), clock = { t: T0, ms: 100 };
  const fetch = async (url) => { clock.t += clock.ms; return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }), { status: 200 }); };
  const now = () => clock.t, router = createRouter({ db, fetch, now, config: EXAMPLE, env: KEYS }), ctx = { db, now, config: {}, router };
  db.raw.prepare(`INSERT INTO router_baseline (provider, rung, probe, mean_ms, dev_ms, n, updated_at) VALUES ('provider-a','small','nonempty',120,15,20,'2026-11-26 11:00:00')`).run();
  clock.ms = 240;
  await probeOne(ctx, 'provider-a', 'small');
  assert.equal(one(db, `SELECT status FROM items WHERE id='CAL-LAT-provider-a'`).status, 'open');
  db.raw.prepare(`UPDATE items SET status='done', disposition='back within the threshold' WHERE id='CAL-LAT-provider-a'`).run();
  db.raw.prepare(`UPDATE router_baseline SET mean_ms=120, dev_ms=15, n=20`).run();
  await probeOne(ctx, 'provider-a', 'small');
  assert.equal(one(db, `SELECT status FROM items WHERE id='CAL-LAT-provider-a'`).status, 'open', 'the same anomaly again reopens the closed item');
});

test('US-09 an alias that resolves to a model the configuration does not list is refused, not priced as the model asked for', async () => {
  const db = makeDb([MIG]);
  const ins = (requested, resolved) => db.raw.prepare(`INSERT INTO router_upstream (call_id, at, provider, requested, resolved) VALUES (1,'2026-11-26 12:00:00','provider-a',?,?)`).run(requested, resolved);
  ins('a-small', 'vendor-frontier-unlisted'); ins('a-medium', 'a-medium');
  const r = await guardAllowed({ db, config: EXAMPLE, guard: { model: 'a-small' }, status_quo: { model: 'a-medium' } });
  assert.deepEqual([r.ok, r.reason, r.guard.resolved, r.guard.unit_cost], [false, 'price_unknown_for_resolved', 'vendor-frontier-unlisted', null]);
  const probe = await costChangeProbe({ db, now: () => T0, config: EXAMPLE, change: { name: 'route triage small', model: 'a-small', status_quo: 'a-medium' } });
  assert.equal(probe.kept, false);
  assert.deepEqual({ ...one(db, `SELECT kept, reason FROM router_cost_probes`) }, { kept: 0, reason: 'price_unknown_for_resolved' });
  const statusUnlisted = makeDb([MIG]);
  statusUnlisted.raw.prepare(`INSERT INTO router_upstream (call_id, at, provider, requested, resolved) VALUES (1,'2026-11-26 12:00:00','p','a-small','a-small'), (2,'2026-11-26 12:00:00','p','a-medium','mystery-model')`).run();
  assert.equal((await guardAllowed({ db: statusUnlisted, config: EXAMPLE, guard: { model: 'a-small' }, status_quo: { model: 'a-medium' } })).reason, 'price_unknown_for_resolved', 'an unlisted status-quo target is not priced as the requested model either');
});

test('US-09-R03: a drill never releases a global switch it did not engage', async () => {
  const db = makeDb([CAPS_MIG]);
  await caps.setSwitch(db, '*', true, { by: 'owner', reason: 'incident: runaway spend', now: T0 });
  let probed = 0;
  const r = await caps.drill({ db, now: () => T0, probes: [{ name: 'p', refused: async () => { probed++; return true; } }] });
  assert.deepEqual([r.passed, r.skipped, probed], [false, 'switch already engaged', 0]);
  assert.deepEqual({ ...one(db, `SELECT is_on, set_by, reason FROM caps_switches WHERE name='*'`) }, { is_on: 1, set_by: 'owner', reason: 'incident: runaway spend' }, 'the incident switch is untouched');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM caps_drills`).n, 0, 'no drill row is written for a drill that did not run');
  await caps.setSwitch(db, '*', false, { by: 'owner', now: T0 });
  assert.equal((await caps.drill({ db, now: () => T0, probes: [{ name: 'p', refused: async () => true }] })).passed, true, 'with the switch off the drill runs as before');
});
