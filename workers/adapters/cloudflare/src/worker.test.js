// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-03 R01, R06, R16: the Worker built from a configuration, over the generated migrations, with an injected clock. No platform, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDb } from '../../../core/_shared/testdb.js';
import { OUT_DIR } from '../../../tools/build_migrations.mjs';
import { createWorker } from './worker.js';
import { STEP_ORDER } from '../../../core/src/tick.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const policy = JSON.parse(readFileSync(path.join(ROOT, 'autonomy/policy.json'), 'utf8'));
const config = { org_slug: 'worker-test', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy: { trust: policy.trust, ladder: policy.ladder, surfaces: policy.surfaces } };
const T0 = Date.UTC(2026, 10, 26, 12, 0, 0);
const SLOT = 600000;

function boot() {
  const db = makeDb([OUT_DIR]);
  const clock = { t: Math.ceil(T0 / SLOT) * SLOT }; // start on a slot boundary so "the next slot" is exactly ten minutes on
  const worker = createWorker(config, { now: () => clock.t });
  const env = { DB: db };
  const ctx = { pending: [], waitUntil(p) { this.pending.push(p); } };
  const fire = async () => { ctx.pending = []; await worker.handler.scheduled({}, env, ctx); return Promise.all(ctx.pending); };
  const health = async () => worker.handler.fetch(new Request('https://org.example/health'), env);
  const ticks = () => db.raw.prepare('SELECT COUNT(*) AS n FROM tick_runs').get().n;
  return { db, worker, env, clock, fire, health, ticks };
}
// A Durable Object state the Heartbeat can use: storage with an alarm.
function alarmState() {
  const data = new Map(); let alarm = null;
  return { storage: { async get(k) { return data.get(k); }, async put(k, v) { data.set(k, v); }, async getAlarm() { return alarm; }, async setAlarm(t) { alarm = t; } } };
}
const applyAll = raw => { for (const f of readdirSync(OUT_DIR).filter(n => n.endsWith('.sql')).sort()) raw.exec(readFileSync(path.join(OUT_DIR, f), 'utf8')); };

test('US-03-R16: two scheduled() firings in one slot write one tick_runs row and the second ends without acting', async () => {
  const w = boot();
  const [first] = await w.fire();
  const [second] = await w.fire();
  assert.equal(first.ran, true);
  assert.deepEqual({ ran: second.ran, duplicate: second.duplicate }, { ran: false, duplicate: true });
  assert.equal(w.ticks(), 1);
  assert.equal(w.db.raw.prepare('SELECT COUNT(*) AS n FROM sched_slots').get().n, 1, 'one slot claimed');
});

test('US-03-R16: a cron firing and a Heartbeat alarm in the same slot run one tick; the next slot runs normally', async () => {
  const w = boot();
  const hb = new w.worker.Heartbeat(alarmState(), w.env);
  await w.fire();                       // the cron takes the slot
  await hb.alarm();                     // the alarm lands in the same ten minutes
  assert.equal(w.ticks(), 1, 'the alarm did not run a second tick');
  assert.ok((await hb.state.storage.get('last_tick')).at, 'the alarm still records that it ran and re-arms');
  assert.ok(await hb.state.storage.getAlarm());
  w.clock.t += SLOT;
  await hb.alarm();                     // the next slot: the alarm is now the one that ticks
  assert.equal(w.ticks(), 2);
  await w.fire();                       // and the cron in that slot is the duplicate
  assert.equal(w.ticks(), 2);
});

test('US-03-R06 and US-03-T04: /health is 503 after a tick whose step failed and 200 after a clean tick', async () => {
  const w = boot();
  w.db.raw.exec('DROP TABLE predictions');
  await w.fire();
  const bad = await w.health();
  assert.equal(bad.status, 503);
  const body = await bad.json();
  assert.equal(body.ok, false); assert.ok(body.last_tick.steps_completed < body.last_tick.steps_total);
  applyAll(w.db.raw);                   // the table is back (every migration is idempotent)
  w.clock.t += SLOT;
  await w.fire();
  const good = await w.health();
  assert.equal(good.status, 200);
  assert.equal((await good.json()).ok, true);
});

test('US-03-R01: scheduled() and the alarm both end in runTick over env.DB: the tick_runs row counts the L1 steps plus the composed ones', async () => {
  const w = boot();
  const hb = new w.worker.Heartbeat(alarmState(), w.env);
  await w.fire();
  w.clock.t += SLOT;
  await hb.alarm();
  const rows = w.db.raw.prepare('SELECT steps_total, steps_completed FROM tick_runs ORDER BY id').all();
  assert.equal(rows.length, 2);
  for (const r of rows) { assert.ok(r.steps_total >= STEP_ORDER.length); assert.equal(r.steps_completed, r.steps_total); }
  assert.equal(rows[0].steps_total, rows[1].steps_total, 'the same composed step list ran in both');
  assert.equal(w.db.raw.prepare('SELECT COUNT(*) AS n FROM sched_slots').get().n, 2);
});

test('createWorker builds the Worker from a configuration alone, with no rendered config.js, and a path no route answers is a plain 404', async () => {
  const w = boot();
  const r = await w.worker.handler.fetch(new Request('https://org.example/nope'), w.env);
  assert.equal(r.status, 404);
});
