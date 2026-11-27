// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as claims from '../claims/index.js';
import * as fleet from './index.js';

const mig = fileURLToPath(new URL('./migrations/', import.meta.url));
const claimsMig = fileURLToPath(new URL('../claims/migrations/', import.meta.url));
const T = s => Date.parse(s.replace(' ', 'T') + 'Z');
const HASH = 'a'.repeat(64);
function mk(extra = {}) {
  const clock = { t: T('2026-03-02 12:03:00') };
  const ctx = { db: makeDb([claimsMig, mig]), now: () => clock.t, config: {}, ...extra };
  return { ctx, clock, at: s => { clock.t = T(s); } };
}
const all = async (ctx, sql, ...a) => (await ctx.db.prepare(sql).bind(...a).all()).results;
const one = async (ctx, sql, ...a) => ctx.db.prepare(sql).bind(...a).first();
const inline = ctx => { ctx.executor = m => fleet.execute(ctx, m); return ctx; };

test('US-11-T01: next_fire of */10 * * * * at 12:03 is 12:10', () => {
  assert.equal(fleet.iso(fleet.nextFire('*/10 * * * *', T('2026-03-02 12:03:00'))), '2026-03-02 12:10:00');
});

test('cron matcher: comma lists, */n, ranges, literals, day of week; malformed expressions return null', () => {
  assert.equal(fleet.iso(fleet.nextFire('15,45 9-17 * * 1-5', T('2026-03-06 17:45:00'))), '2026-03-09 09:15:00'); // Friday evening -> Monday
  assert.equal(fleet.iso(fleet.nextFire('0 0 1 */6 *', T('2026-03-02 00:00:00'))), '2026-06-01 00:00:00');
  assert.equal(fleet.iso(fleet.nextFire('30 4 * * 7', T('2026-03-02 00:00:00'))), '2026-03-08 04:30:00');           // 7 is Sunday too
  assert.equal(fleet.iso(fleet.nextFire('10 12 * * *', T('2026-03-02 12:10:00'))), '2026-03-03 12:10:00');          // strictly after
  assert.equal(fleet.nextFire('* * * *', 0), null);
  assert.equal(fleet.nextFire('a * * * *', 0), null);
  assert.equal(fleet.nextFire('0 0 31 2 *', T('2026-03-02 00:00:00')), null);                                        // never matches in 366 days
  assert.equal(fleet.expectedSlots('*/10 * * * *', T('2026-03-02 12:00:00'), T('2026-03-02 13:00:00')).length, 6);
});

test('US-11-R04: a schedule change is a row write; the dispatcher follows the new row without a redeploy', async () => {
  const { ctx, at } = mk(); inline(ctx);
  await fleet.setTask(ctx, { id: 'count-items', type: 'sql', definition: { statement: 'SELECT COUNT(*) AS n FROM items' } });
  await fleet.setCron(ctx, { name: 'count', expr: '0 * * * *', task_id: 'count-items' });
  assert.equal((await fleet.dispatch(ctx)).fired.length, 1);            // next_fire null: due now
  at('2026-03-02 12:05:00');
  assert.equal((await fleet.dispatch(ctx)).fired.length, 0);            // next is 13:00
  await ctx.db.prepare(`UPDATE fleet_crons SET expr = '*/5 * * * *', next_fire = NULL WHERE name = 'count'`).run();
  assert.equal((await fleet.dispatch(ctx)).fired.length, 1);
  assert.equal((await one(ctx, `SELECT next_fire FROM fleet_crons WHERE name = 'count'`)).next_fire, '2026-03-02 12:10:00');
});

test('US-11-T02 and US-11-R03: with the executor down the row stays queued, next_fire advances, no re-fire next minute', async () => {
  const { ctx, at } = mk({ executor: async () => { throw new Error('executor unreachable'); } });
  await fleet.setTask(ctx, { id: 't1', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  await fleet.setCron(ctx, { name: 'j1', expr: '*/10 * * * *', task_id: 't1' });
  const d = await fleet.dispatch(ctx);
  assert.equal(d.errors.length, 1);
  assert.match(d.errors[0].error, /unreachable/);
  const c = await one(ctx, `SELECT * FROM fleet_crons WHERE name = 'j1'`);
  assert.equal(c.last_fired, '2026-03-02 12:03:00');
  assert.equal(c.next_fire, '2026-03-02 12:10:00');
  assert.deepEqual((await all(ctx, `SELECT status FROM fleet_runs`)).map(r => r.status), ['queued']);
  at('2026-03-02 12:04:00');
  const again = await fleet.dispatch(ctx);
  assert.deepEqual([again.fired.length, again.errors.length, again.skipped.length], [0, 0, 0]);
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM fleet_runs`)).n, 1);
});

test('US-11-R11: a live run of the task blocks a second dispatch; a stale queued row is reaped to failed with an item', async () => {
  const { ctx, at } = mk({ executor: async () => { throw new Error('down'); } });
  await fleet.setTask(ctx, { id: 't1', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  await fleet.setCron(ctx, { name: 'j1', expr: '*/10 * * * *', task_id: 't1' });
  await fleet.dispatch(ctx);
  at('2026-03-02 12:10:00');
  const d = await fleet.dispatch(ctx);
  assert.equal(d.skipped[0].reason, 'overlap');
  assert.equal((await one(ctx, `SELECT next_fire FROM fleet_crons`)).next_fire, '2026-03-02 12:20:00'); // still advanced
  assert.deepEqual((await fleet.reapStale(ctx)).reaped, []);            // 7 minutes old, ttl 15
  at('2026-03-02 12:19:00');
  assert.equal((await fleet.reapStale(ctx)).reaped.length, 1);
  const r = await one(ctx, `SELECT status, error_class FROM fleet_runs`);
  assert.deepEqual([r.status, r.error_class], ['failed', 'stale_queued']);
  assert.ok(await one(ctx, `SELECT id FROM items WHERE id = 'FLEET-STALE-t1'`));
  at('2026-03-02 12:20:00');
  assert.equal((await fleet.dispatch(ctx)).errors.length, 1);           // dispatch is possible again
});

test('US-11-T03 and US-11-R05: an unknown task type is rejected and still leaves a run record', async () => {
  const { ctx } = mk();
  const r = await fleet.execute(ctx, { task: { type: 'shell', definition: { cmd: 'ls' } }, trigger: 'http' });
  assert.equal(r.ok, false);
  assert.equal(r.error_class, 'unknown_type');
  const row = await one(ctx, `SELECT * FROM fleet_runs WHERE run_id = ?`, r.run_id);
  assert.deepEqual([row.status, row.error_class, row.trigger], ['failed', 'unknown_type', 'http']);
  await fleet.setTask(ctx, { id: 'stored', type: 'python', definition: {} });
  assert.equal((await fleet.execute(ctx, { task_id: 'stored', trigger: 'manual' })).error_class, 'unknown_type');
  assert.equal((await fleet.execute(ctx, { task_id: 'absent', trigger: 'manual' })).error_class, 'no_task');
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM fleet_runs`)).n, 3);
  const res = await fleet.handle(new Request('https://w.example/fleet/execute', { method: 'POST', body: JSON.stringify({ task: { type: 'shell', definition: {} } }) }), { ...ctx, authorize: async () => true });
  assert.equal(res.status, 422);
});

test('US-11-R05: sql, http, ai and workflow tasks run by type and fill the eleven ledger columns', async () => {
  const calls = [];
  const { ctx } = mk({
    fetch: async (url, init) => { calls.push([url, init.method]); return new Response('x'.repeat(900), { status: 200 }); },
    ai: async req => { calls.push(req); return { text: 'summary', cost: 0.002 }; },
    config: { worker: 'fleet-exec', allowed_models: [{ id: 'large', cost: 5 }, { id: 'small', cost: 1 }] },
  });
  await ctx.db.prepare(`INSERT INTO items (id,title,owner_role,done_check) VALUES ('a','A','staff','x'),('b','B','staff','x'),('c','C','staff','x'),('d','D','staff','x')`).run();
  const sql = await fleet.execute(ctx, { task: { type: 'sql', definition: { statement: 'SELECT id FROM items ORDER BY id' } }, trigger: 'manual' });
  assert.equal(sql.result.row_count, 4);
  assert.equal(sql.result.rows.length, 3);                               // first three rows only
  const http = await fleet.execute(ctx, { task: { type: 'http', definition: { url: 'https://svc.example/ping' } }, trigger: 'http' });
  assert.deepEqual([http.result.status, http.result.body.length], [200, 500]);
  const ai = await fleet.execute(ctx, { task: { type: 'ai', definition: { prompt: 'summarize', max_tokens: 9999 } }, trigger: 'manual' });
  assert.deepEqual([ai.result.model, ai.result.max_tokens], ['small', 1024]); // cheapest allowed model, bounded tokens
  assert.equal((await fleet.execute(ctx, { task: { type: 'ai', definition: { prompt: 'x', model: 'huge' } }, trigger: 'manual' })).error_class, 'model_not_allowed');
  const wf = await fleet.execute(ctx, { trigger: 'manual', parent_run: sql.run_id, task: { type: 'workflow', definition: { steps: [
    { type: 'sql', definition: { statement: "UPDATE items SET priority = 1 WHERE id = 'a'" } }, { type: 'ai', definition: { prompt: 'p' } }] } } });
  assert.equal(wf.ok, true);
  assert.equal(wf.result.steps[0].row_count, 1);
  const bad = await fleet.execute(ctx, { trigger: 'manual', task: { type: 'workflow', definition: { steps: [{ type: 'sql', definition: { statement: 'SELECT 1; SELECT 2' } }, { type: 'http', definition: { url: 'https://svc.example/never' } }] } } });
  assert.equal(bad.error_class, 'bad_definition');
  assert.equal(calls.filter(c => Array.isArray(c) && c[0].endsWith('/never')).length, 0); // the workflow stopped at the failing step
  const row = await one(ctx, `SELECT * FROM fleet_runs WHERE run_id = ?`, wf.run_id);
  for (const col of ['run_id', 'worker', 'trigger', 'ts_start', 'ts_end', 'status', 'error_class', 'summary', 'evidence_refs', 'parent_run', 'cost']) assert.ok(col in row, col);
  assert.deepEqual([row.worker, row.trigger, row.status, row.error_class, row.parent_run, row.cost], ['fleet-exec', 'manual', 'ok', null, sql.run_id, 0.002]);
  assert.match(row.evidence_refs, /fleet_events:run-\d+:accepted/);
  assert.equal((await fleet.execute(ctx, { task: { type: 'sql', definition: { statement: 'SELECT 1 AS x' } }, trigger: 'timer' })).rejected_before_start, true);
});

test('US-11-R05: results are truncated to 4000 characters and errors to 1000', async () => {
  const { ctx } = mk({ fetch: async () => { throw new Error('e'.repeat(3000)); } });
  await ctx.db.prepare(`INSERT INTO items (id,title,owner_role,done_check) VALUES ('a',?, 'staff','x'),('b',?, 'staff','x'),('c',?, 'staff','x')`).bind('t'.repeat(3000), 'u'.repeat(3000), 'v'.repeat(3000)).run();
  const ok = await fleet.execute(ctx, { task: { type: 'sql', definition: { statement: 'SELECT title FROM items' } }, trigger: 'manual' });
  assert.equal((await one(ctx, `SELECT result FROM fleet_runs WHERE run_id = ?`, ok.run_id)).result.length, 4000);
  const bad = await fleet.execute(ctx, { task: { type: 'http', definition: { url: 'https://svc.example/x' } }, trigger: 'manual' });
  assert.equal((await one(ctx, `SELECT error FROM fleet_runs WHERE run_id = ?`, bad.run_id)).error.length, 1000);
});

test('US-11-R06: envelopes are validated before writing; rejects are stored with their error', async () => {
  const { ctx } = mk();
  const payload = { n: 1 };
  const env = await fleet.buildEnvelope({ kind: 'probe.result', id: 'e-1', ts: '2026-03-02 12:03:00', emitter: 'prober', session: 's-1', payload });
  assert.deepEqual(await fleet.recordEvent(ctx, env, payload), { accepted: true, id: 'e-1' });
  assert.equal((await fleet.recordEvent(ctx, env, payload)).error, 'duplicate event id');
  assert.match((await fleet.recordEvent(ctx, env, { n: 2 })).error, /does not match the payload/);
  assert.match((await fleet.recordEvent(ctx, { ...env, id: 'e-2', provenance: { ...env.provenance, session: '' } }, payload)).error, /session/);
  assert.match((await fleet.recordEvent(ctx, { ...env, id: 'e-3', schema_version: '9' }, payload)).error, /schema_version/);
  assert.match((await fleet.recordEvent(ctx, null, payload)).error, /envelope missing/);
  const rows = await all(ctx, `SELECT state, error FROM fleet_events ORDER BY id`);
  assert.deepEqual(rows.map(r => r.state), ['accepted', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
  assert.ok(rows.slice(1).every(r => r.error));
  const r = await fleet.execute(ctx, { task: { type: 'sql', definition: { statement: 'SELECT 1 AS x' } }, trigger: 'manual' });
  assert.equal(r.event.accepted, true);                                  // the executor stores its own completion envelope
  assert.equal((await one(ctx, `SELECT kind, emitter FROM fleet_events WHERE run_id = ?`, r.run_id)).kind, 'fleet.run');
});

test('US-11-R07: a batch that scans 25 and books 0 is itself a failure; the gate stays closed until a batch balances', async () => {
  const { ctx } = mk();
  const run = await fleet.execute(ctx, { task: { type: 'sql', definition: { statement: 'SELECT 1 AS x' } }, trigger: 'manual' });
  const ids = Array.from({ length: 25 }, (_, i) => `i${i}`);
  const bad = await fleet.recordBatch(ctx, { executor: 'backlog-exec', run_id: run.run_id, scanned_ids: ids, executed: [], failed: [], needs_human: [], no_action: [] });
  assert.deepEqual([bad.ok, bad.gap, bad.status, bad.unaccounted.length], [false, 25, 'failed', 25]);
  const row = await one(ctx, `SELECT status, error_class FROM fleet_runs WHERE run_id = ?`, run.run_id);
  assert.deepEqual([row.status, row.error_class], ['failed', 'accounting_gap']);
  assert.ok(await one(ctx, `SELECT id FROM items WHERE id = 'FLEET-UNACCOUNTED-backlog-exec'`));
  const gate = await fleet.batchGate(ctx, 'backlog-exec');
  assert.deepEqual([gate.pass, gate.reason, gate.gap], [false, 'accounting_gap', 25]);
  assert.equal((await fleet.batchGate(ctx, 'other-exec')).pass, true);
  const good = await fleet.drain(ctx, { executor: 'backlog-exec', items: ids.map(id => ({ id })), handle: async it => (it.id === 'i3' ? Promise.reject(new Error('x')) : it.id === 'i4' ? 'needs_human' : it.id === 'i5' ? 'no_action' : 'executed') });
  assert.deepEqual([good.ok, good.gap], [true, 0]);
  const b = await one(ctx, `SELECT * FROM fleet_batches WHERE id = ?`, good.batch_id);
  assert.deepEqual([b.scanned, b.executed, b.failed, b.needs_human, b.no_action], [25, 22, 1, 1, 1]);
  assert.equal((await fleet.batchGate(ctx, 'backlog-exec')).pass, true);
  const lost = await fleet.drain(ctx, { executor: 'backlog-exec', items: [{ id: 'x' }, { id: 'y' }], handle: async it => (it.id === 'x' ? 'executed' : undefined) });
  assert.deepEqual([lost.gap, lost.unaccounted], [1, ['y']]);            // a handler that books nothing leaves the item unaccounted
});

async function runAt(ctx, clock, procedure, scheduler, when) {
  clock.t = T(when);
  await ctx.db.prepare(`INSERT INTO fleet_runs (worker, trigger, ts_start, ts_end, status, cron_name, scheduler, queued_at) VALUES ('w','cron',?,?,'ok',?,?,?)`).bind(when, when, procedure, scheduler, when).run();
}

test('US-11-T04 and US-11-R08: a slot of a declared procedure with no record opens an alert naming procedure and slot', async () => {
  const { ctx, clock, at } = mk();
  await fleet.declareProcedure(ctx, { name: 'manager-tick', expr: '*/10 * * * *', schedulers: ['platform-cron'] });
  for (const m of ['00', '10', '30', '40', '50']) await runAt(ctx, clock, 'manager-tick', 'platform-cron', `2026-03-02 12:${m}:30`);
  at('2026-03-02 13:00:00');
  const d = await fleet.deadman(ctx);
  assert.equal(d.procedures[0].slots, 6);
  assert.equal(d.alerts.length, 1);
  assert.deepEqual([d.alerts[0].procedure, d.alerts[0].slot, d.alerts[0].kind], ['manager-tick', '2026-03-02 12:20:00', 'stop']);
  const item = await one(ctx, `SELECT title, priority FROM items WHERE id = ?`, d.alerts[0].item_id);
  assert.match(item.title, /manager-tick.*2026-03-02 12:20:00.*platform-cron/);
  assert.equal((await fleet.deadman(ctx)).alerts.length, 0);             // idempotent: one alert per slot
});

test('US-11-R09: one silent scheduler of two is a single-path failure; both silent is a stop (worked example, 5 of 6)', async () => {
  const { ctx, clock, at } = mk();
  await fleet.declareProcedure(ctx, { name: 'manager-tick', expr: '*/10 * * * *', schedulers: ['A', 'B'] });
  const slots = ['00', '10', '20', '30', '40', '50'];
  for (const m of slots) await runAt(ctx, clock, 'manager-tick', 'A', `2026-03-02 12:${m}:05`);
  for (const m of slots.filter(x => x !== '20')) await runAt(ctx, clock, 'manager-tick', 'B', `2026-03-02 12:${m}:20`);
  at('2026-03-02 13:00:00');
  const d = await fleet.deadman(ctx);
  assert.deepEqual(d.alerts.map(a => [a.kind, a.slot, a.missing]), [['single_path', '2026-03-02 12:20:00', ['B']]]);
  assert.equal(d.procedures[0].reliability.A, 1);
  assert.ok(Math.abs(d.procedures[0].reliability.B - 5 / 6) < 1e-9);
  assert.equal(d.procedures[0].stops, 0);
  // the next hour: both silent in slot 4 (13:30)
  for (const m of slots.filter(x => x !== '30')) { await runAt(ctx, clock, 'manager-tick', 'A', `2026-03-02 13:${m}:05`); await runAt(ctx, clock, 'manager-tick', 'B', `2026-03-02 13:${m}:20`); }
  at('2026-03-02 14:00:00');
  const d2 = await fleet.deadman(ctx);
  assert.deepEqual(d2.alerts.map(a => [a.kind, a.slot]), [['stop', '2026-03-02 13:30:00']]);
  const stop = await one(ctx, `SELECT priority FROM fleet_alerts WHERE kind = 'stop'`), single = await one(ctx, `SELECT priority FROM fleet_alerts WHERE kind = 'single_path'`);
  assert.ok(stop.priority < single.priority);                            // 0 is highest: a stop outranks degraded redundancy
});

test('dead-man: seed tick rows count as records for the configured procedure; an unfinished slot is not judged', async () => {
  const { ctx, at } = mk({ config: { tick_procedure: 'tick', tick_scheduler: 'platform-cron' } });
  await fleet.declareProcedure(ctx, { name: 'tick', expr: '*/30 * * * *', schedulers: ['platform-cron'] });
  await ctx.db.prepare(`INSERT INTO tick_runs (started_at, steps_total) VALUES ('2026-03-02 12:00:10', 7)`).run();
  at('2026-03-02 12:45:00');
  assert.equal((await fleet.deadman(ctx)).alerts.length, 0);             // 12:30 slot is still open
  at('2026-03-02 13:00:00');
  assert.deepEqual((await fleet.deadman(ctx)).alerts.map(a => a.slot), ['2026-03-02 12:30:00']);
});

test('US-11-T05 and US-11-R10: the tick fired by both schedulers in one slot acts once; the other ends without acting', async () => {
  const { ctx, at } = mk({ claims, config: {} });
  let acted = 0;
  const a = await fleet.fireOnce(ctx, { procedure: 'manager-tick', scheduler: 'platform-cron', expr: '*/10 * * * *' }, async () => { acted++; return 'done'; });
  at('2026-03-02 12:04:00');
  const b = await fleet.fireOnce(ctx, { procedure: 'manager-tick', scheduler: 'dispatcher', expr: '*/10 * * * *' }, async () => { acted++; });
  assert.deepEqual([a.acted, b.acted, acted], [true, false, 1]);
  assert.equal(a.slot, '2026-03-02 12:00:00');
  const runs = await all(ctx, `SELECT scheduler, summary FROM fleet_runs ORDER BY run_id`);
  assert.equal(runs.length, 2);                                          // both firings leave a record
  assert.match(runs[1].summary, /ended without acting/);
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM claims_lock WHERE key = 'procedure:manager-tick'`)).n, 1); // a US-08 work claim was taken
  at('2026-03-02 12:10:00');
  assert.equal((await fleet.fireOnce(ctx, { procedure: 'manager-tick', scheduler: 'dispatcher', expr: '*/10 * * * *' }, async () => { acted++; })).acted, true);
  assert.equal(acted, 2);
});

test('US-11-R10: while a holder still works under the claim, a firing in a later slot does not act', async () => {
  const { ctx, at } = mk({ claims });
  const held = await claims.acquire(ctx, { key: 'procedure:manager-tick', holder: 'platform-cron', intent: 'long tick' });
  assert.equal(held.acquired, true);
  at('2026-03-02 12:10:00');
  const r = await fleet.fireOnce(ctx, { procedure: 'manager-tick', scheduler: 'dispatcher', expr: '*/10 * * * *' }, async () => assert.fail('must not act'));
  assert.deepEqual([r.acted, r.reason], [false, 'held']);
});

test('US-11-R12: collisions per minute are measured from the enabled schedules', async () => {
  const { ctx } = mk();
  await fleet.setCron(ctx, { name: 'a', expr: '*/10 * * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'b', expr: '*/15 * * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'off', expr: '* * * * *', task_id: 't', enabled: false });
  const c = await fleet.collisions(ctx, { from: T('2026-03-02 12:00:00'), to: T('2026-03-02 13:00:00') });
  assert.deepEqual(c.minutes.map(m => m.minute), ['2026-03-02 12:00:00', '2026-03-02 12:30:00']);
  assert.deepEqual([c.collisions, c.max_per_minute, c.fired_minutes], [2, 2, 8]);
  await fleet.setCron(ctx, { name: 'b', expr: '5-59 * * * *', task_id: 't' });
  await assert.rejects(() => fleet.setCron(ctx, { name: 'bad', expr: 'every minute', task_id: 't' }));
});

test('US-11-R12, US-11-R18 and US-11-T08: stagger moves periodic schedules apart, keeps period and other fields, and a second run changes nothing', async () => {
  const { ctx } = mk();
  const win = { from: T('2026-03-02 12:00:00'), to: T('2026-03-03 12:00:00') };
  await fleet.setCron(ctx, { name: 'a', expr: '*/10 * * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'b', expr: '*/10 * * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'c', expr: '*/15 9-17 * * 1-5', task_id: 't' });
  await fleet.setCron(ctx, { name: 'daily', expr: '0 3 * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'odd', expr: '5-59 * * * *', task_id: 't', enabled: false });
  assert.deepEqual(fleet.minutePhase('*/10'), { period: 10, offset: 0 });
  assert.deepEqual(fleet.minutePhase('3,13,23,33,43,53'), { period: 10, offset: 3 });
  assert.deepEqual(fleet.minutePhase('7'), { period: 60, offset: 7 });
  for (const bad of ['*', '*/7', '1,2,4', '0-30', '5,65']) assert.equal(fleet.minutePhase(bad), null);
  const plan = await fleet.stagger(ctx, win);                                  // a plan writes nothing
  assert.equal(plan.applied, false);
  assert.ok(plan.collisions_before > 0);
  assert.equal((await one(ctx, `SELECT expr FROM fleet_crons WHERE name = 'b'`)).expr, '*/10 * * * *');
  const done = await fleet.stagger(ctx, { ...win, apply: true });
  assert.deepEqual([done.collisions_after, done.max_per_minute_after], [0, 1]);
  assert.deepEqual(done.fixed, ['daily']);                                     // a time of day is not moved unless asked
  const rows = Object.fromEntries((await all(ctx, `SELECT name, expr, next_fire FROM fleet_crons WHERE enabled = 1`)).map(r => [r.name, r]));
  assert.equal(rows.a.expr, '1,11,21,31,41,51 * * * *');                       // 0 is taken by the daily job at 03:00
  assert.equal(rows.b.expr, '2,12,22,32,42,52 * * * *');
  assert.equal(rows.c.expr.split(' ').slice(1).join(' '), '9-17 * * 1-5');     // only the minute field moves
  assert.equal(fleet.minutePhase(rows.c.expr.split(' ')[0]).period, 15);
  assert.equal(rows.daily.expr, '0 3 * * *');
  assert.equal((await fleet.collisions(ctx, win)).collisions, 0);              // the measurement agrees with the plan
  assert.equal(fleet.expectedSlots(rows.b.expr, win.from, win.to).length, 144); // six an hour, as before
  assert.deepEqual((await fleet.stagger(ctx, { ...win, apply: true })).changes, []);
});

test('US-11-R12 and US-11-R18: auto_stagger in step is off by default; on, the step staggers before it dispatches; literals move only when asked', async () => {
  const { ctx } = mk(); inline(ctx);
  await fleet.setTask(ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  await fleet.setTask(ctx, { id: 'u', type: 'sql', definition: { statement: 'SELECT 2 AS x' } });
  await fleet.setCron(ctx, { name: 'j', expr: '*/10 * * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'k', expr: '*/10 * * * *', task_id: 'u' });
  assert.equal((await fleet.step({ ...ctx, config: { enabled: true } })).staggered, undefined);
  assert.equal((await one(ctx, `SELECT expr FROM fleet_crons WHERE name = 'k'`)).expr, '*/10 * * * *');
  const s = await fleet.step({ ...ctx, config: { auto_stagger: true } });
  assert.equal(s.staggered, 1);
  assert.equal((await one(ctx, `SELECT expr FROM fleet_crons WHERE name = 'k'`)).expr, '1,11,21,31,41,51 * * * *');
  assert.equal((await fleet.step({ ...ctx, config: { auto_stagger: true } })).staggered, 0);
  await fleet.setCron(ctx, { name: 'm', expr: '0 3 * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'n', expr: '0 3 * * *', task_id: 'u' });
  const kept = await fleet.stagger(ctx, {});                                   // two jobs named for 03:00 stay there and still share the minute
  assert.deepEqual([kept.fixed, kept.collisions_after, kept.max_per_minute_after], [['m', 'n'], 1, 2]);
  const lit = await fleet.stagger(ctx, { literals: true });
  assert.deepEqual([lit.fixed, lit.collisions_after, lit.max_per_minute_after], [[], 0, 1]);
});

const member = (name, over = {}) => ({
  name, purpose: 'p', kind: 'worker', status: 'active', crons: ['*/10 * * * *'], dependencies: [], health_url: '/health', autonomy_level: 'L1', owner: 'operations',
  version: '1.2.0', source_hash: HASH, header: { purpose: 'p', capabilities: ['x'], deploy_method: 'api', canonical_source: `workers/${name}` }, secret_names: ['API_TOKEN'], flags_source: 'kv:flags', ...over,
});
const live = (name, over = {}) => ({ name, version: '1.2.0', source_hash: HASH, health: { status: 'ok', worker: name, version: '1.2.0', enabled: true, bindings_ok: true }, ...over });

test('US-11-R01: the worker contract names each unmet part; secret values are refused', async () => {
  const { ctx } = mk();
  assert.deepEqual(fleet.contractGaps(member('ok'), live('ok')), []);
  const gaps = fleet.contractGaps(member('w', { version: 'v2', header: { purpose: 'p' }, source_hash: null, owner: null, flags_source: null, secret_names: ['sk live value'] }), { health: { status: 'ok' } });
  assert.deepEqual(gaps.map(g => g[0]), ['1', '2', '3', '4', '5', '6', '7']);
  await assert.rejects(() => fleet.register(ctx, member('w', { secret_names: ['not a name: abc123'] })), /names only/);
  const h = await fleet.health(ctx);
  assert.deepEqual(Object.keys(h).sort(), ['bindings_ok', 'enabled', 'status', 'version', 'worker']);
  assert.match(h.version, /^\d+\.\d+\.\d+$/);
});

test('US-11-R02: deployed state is reconciled against the registry; one state per worker and three drift counts', async () => {
  const deployedList = [
    live('alpha'), live('beta', { version: '1.1.0', health: { status: 'ok', worker: 'beta', version: '1.1.0', enabled: true, bindings_ok: true } }),
    live('gamma', { health: { status: 'ok', worker: 'gamma', version: '1.2.0', enabled: true, bindings_ok: false } }),
    live('delta', { health: { status: 'ok', worker: 'delta', version: '1.2.0', enabled: false, bindings_ok: true } }),
    live('zeta', { version: null, health: { status: 'ok', worker: 'zeta', enabled: true, bindings_ok: true } }),
    live('eta', { source_hash: 'b'.repeat(64) }), live('stray', { version: null, health: { status: 'ok' } }),
  ];
  const { ctx, at } = mk({ deployed: { list: async () => deployedList } });
  for (const n of ['alpha', 'beta', 'gamma', 'delta', 'zeta', 'eta', 'ghost']) await fleet.register(ctx, member(n));
  await fleet.register(ctx, member('old', { status: 'retired' }));
  const r = await fleet.reconcile(ctx);
  assert.deepEqual(r.states, { alpha: 'live', beta: 'drifted', gamma: 'degraded', delta: 'paused', zeta: 'drifted', eta: 'drifted', ghost: 'degraded', old: 'retired' });
  assert.deepEqual(r.counts, { live: 1, drifted: 3, degraded: 2, paused: 1, retired: 1 });
  assert.deepEqual([r.ghosts, r.unregistered, r.unversioned], [['ghost'], ['stray'], ['zeta', 'stray']]);
  const row = await one(ctx, `SELECT * FROM fleet_reconciliations`);
  assert.deepEqual([row.ghosts, row.unregistered, row.unversioned], [1, 1, 2]);
  assert.equal((await one(ctx, `SELECT state FROM fleet_registry WHERE name = 'beta'`)).state, 'drifted');
  assert.ok(await one(ctx, `SELECT id FROM items WHERE id = 'FLEET-UNREGISTERED-stray'`));
  assert.ok(await one(ctx, `SELECT id FROM items WHERE id = 'FLEET-DRIFTED-beta'`));
  // on a schedule: step reconciles again only when the interval has passed
  at('2026-03-02 12:30:00'); await fleet.step(ctx);
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM fleet_reconciliations`)).n, 1);
  at('2026-03-02 13:03:00'); await fleet.step(ctx);
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM fleet_reconciliations`)).n, 2);
  assert.equal((await fleet.reconcile({ ...ctx, deployed: undefined })).reason, 'no_deployed_port');
});

test('US-11-R23: event-triggered scheduling: an accepted event starts its tasks once; rejected and repeated events start nothing', async () => {
  const { ctx } = mk(); inline(ctx);
  await fleet.setTask(ctx, { id: 'recount', type: 'sql', definition: { statement: 'SELECT COUNT(*) AS n FROM items' } });
  await fleet.setTrigger(ctx, { id: 'on-merge', event_kind: 'repo.merged', task_id: 'recount' });
  await fleet.setTrigger(ctx, { id: 'unused', event_kind: 'deploy.done', task_id: 'recount' });
  const payload = { sha: 'abc' };
  const env = await fleet.buildEnvelope({ kind: 'repo.merged', id: 'merge-1', ts: '2026-03-02 12:03:00', emitter: 'vcs', session: 's-9', payload });
  const first = await fleet.emit(ctx, env, payload);
  assert.deepEqual([first.accepted, first.started.length], [true, 1]);
  const row = await one(ctx, `SELECT trigger, status, scheduler FROM fleet_runs WHERE run_id = ?`, first.started[0].run_id);
  assert.deepEqual([row.trigger, row.status, row.scheduler], ['event', 'ok', 'event:on-merge']);
  const again = await fleet.emit(ctx, env, payload);
  assert.deepEqual([again.accepted, again.error, again.started.length], [false, 'duplicate event id', 0]);
  const forged = await fleet.emit(ctx, { ...env, id: 'merge-2' }, { sha: 'tampered' });
  assert.deepEqual([forged.accepted, forged.started.length], [false, 0]);
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM fleet_runs WHERE trigger = 'event'`)).n, 1);
});

test('step and routes: one tick dispatches, reaps and checks; status and health are served; execute needs authorization', async () => {
  const { ctx } = mk(); inline(ctx);
  await fleet.setTask(ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  await fleet.setCron(ctx, { name: 'j', expr: '*/10 * * * *', task_id: 't' });
  const s = await fleet.step(ctx);
  assert.equal(s.dispatch.fired.length, 1);
  assert.deepEqual(await fleet.step({ ...ctx, config: { enabled: false } }), { enabled: false });
  const st = await (await fleet.handle(new Request('https://w.example/fleet/status'), ctx)).json();
  assert.deepEqual([st.runs.ok, st.crons_enabled, st.unbalanced_batches], [1, 1, 0]);
  assert.equal((await (await fleet.handle(new Request('https://w.example/health'), ctx)).json()).status, 'ok');
  const post = body => new Request('https://w.example/fleet/execute', { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await fleet.handle(post({ task_id: 't' }), ctx)).status, 401);
  const ok = await fleet.handle(post({ task_id: 't' }), { ...ctx, authorize: async () => true });
  assert.equal((await ok.json()).status, 'ok');
});

// ---- round 1 additions ---------------------------------------------------------------------------

const kernelMig = fileURLToPath(new URL('../kernel/migrations/', import.meta.url));
const observeMig = fileURLToPath(new URL('../observe/migrations/', import.meta.url));
const remediationMig = fileURLToPath(new URL('../remediation/migrations/', import.meta.url));
const LONG_AGO = '2020-01-01 00:00:00', FAR_AHEAD = '2999-01-01 00:00:00';

test('US-11-R13: a monitor refuses to run in the worker that writes its probe table, and fires from outside when the writer stops', async () => {
  // The detector is core/remediation externalLiveness; this fleet-side test proves the requirement against the fleet's own probe table name.
  const remediation = await import('../remediation/index.js');
  const db = makeDb([kernelMig, claimsMig, mig, observeMig, remediationMig]);
  const ctx = { db, now: () => T('2026-03-02 12:00:00'), config: { host: 'watcher' } };
  const probeDb = makeDb([]);
  probeDb.raw.exec(`CREATE TABLE fleet_probe_log (name TEXT, ts TEXT)`);
  const spec = { table: 'fleet_probe_log', interval_min: 15, writer: 'prober' };
  const same = await remediation.externalLiveness({ ...ctx, probeDb, config: { host: 'prober' } }, spec);
  assert.deepEqual([same.ok, same.reason], [false, 'same_host']);
  assert.ok(await one(ctx, `SELECT id FROM items WHERE id = 'LIVENESS-fleet-probe-log-SAME-HOST'`));
  const out = { ...ctx, probeDb };
  assert.equal((await remediation.externalLiveness(out, spec)).fired, true);     // never written: not a pass
  probeDb.raw.prepare(`INSERT INTO fleet_probe_log VALUES ('w', ?)`).run(FAR_AHEAD);
  assert.equal((await remediation.externalLiveness(out, spec)).fired, false);    // a fresh row
  probeDb.raw.exec(`DELETE FROM fleet_probe_log`); probeDb.raw.prepare(`INSERT INTO fleet_probe_log VALUES ('w', ?)`).run(LONG_AGO);
  const stopped = await remediation.externalLiveness(out, spec);
  assert.equal(stopped.fired, true);
  assert.match((await one(ctx, `SELECT title FROM items WHERE id = ?`, stopped.item_id)).title, /prober stopped writing fleet_probe_log/);
  assert.match((await remediation.externalLiveness({ ...ctx, probeDb: makeDb([]) }, spec)).evidence, /unreadable/); // the monitor cannot see: an alarm, not silence
});

test('US-11-R03: with no executor port a due schedule is executed inline and ends ok in the run ledger', async () => {
  const { ctx } = mk();
  await fleet.setTask(ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  await fleet.setCron(ctx, { name: 'j', expr: '*/10 * * * *', task_id: 't' });
  const d = await fleet.dispatch(ctx);
  assert.deepEqual([d.fired.length, d.errors.length], [1, 0]);
  const r = await one(ctx, `SELECT status, trigger, scheduler FROM fleet_runs`);
  assert.deepEqual([r.status, r.trigger, r.scheduler], ['ok', 'cron', 'dispatcher']);
  assert.equal((await one(ctx, `SELECT next_fire FROM fleet_crons`)).next_fire, '2026-03-02 12:10:00');
  const down = mk({ executor: async () => { throw new Error('down'); } });     // an explicit executor port still decides
  await fleet.setTask(down.ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  await fleet.setCron(down.ctx, { name: 'j', expr: '*/10 * * * *', task_id: 't' });
  assert.equal((await fleet.dispatch(down.ctx)).errors.length, 1);
  assert.equal((await one(down.ctx, `SELECT status FROM fleet_runs`)).status, 'queued');
});

test('US-11-R11: two concurrent dispatchers queue one run of a task; the store enforces it, not a read before the write', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const { ctx } = mk({ executor: async () => { await gate; } });
  await fleet.setTask(ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  await fleet.setCron(ctx, { name: 'j', expr: '*/10 * * * *', task_id: 't' });
  const both = Promise.all([fleet.dispatch(ctx), fleet.dispatch(ctx)]);
  await new Promise(r => setTimeout(r, 5)); release();
  const [a, b] = await both;
  assert.deepEqual([a.fired.length + b.fired.length, a.skipped.length + b.skipped.length], [1, 1]);
  assert.equal([...a.skipped, ...b.skipped][0].reason, 'overlap');
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM fleet_runs`)).n, 1);
  // events obey the same guard
  await fleet.setTrigger(ctx, { id: 'on-x', event_kind: 'x.happened', task_id: 't' });
  const env = await fleet.buildEnvelope({ kind: 'x.happened', id: 'x-1', ts: '2026-03-02 12:03:00', emitter: 'e', session: 's', payload: {} });
  const ev = await fleet.emit(ctx, env, {});
  assert.deepEqual([ev.started.length, ev.skipped.map(s => s.reason)], [0, ['overlap']]);
});

test('US-11-R08: slots that elapsed while the dead-man check was not running are judged on its next pass, up to the lookback', async () => {
  const { ctx, at } = mk();
  await fleet.declareProcedure(ctx, { name: 'job', expr: '*/10 * * * *', schedulers: ['platform-cron'] });
  at('2026-03-02 12:00:00');
  assert.equal((await fleet.deadman(ctx)).alerts.length, 6);               // 11:00 to 11:50: the first pass judges one window
  at('2026-03-02 15:00:00');                                               // the monitor was down for three hours
  const d = await fleet.deadman(ctx);
  assert.deepEqual([d.alerts.length, d.alerts[0].slot, d.alerts[d.alerts.length - 1].slot], [18, '2026-03-02 12:00:00', '2026-03-02 14:50:00']);
  assert.equal((await fleet.deadman(ctx)).alerts.length, 0);               // idempotent: one alert per slot
  at('2026-03-06 15:00:00');                                               // four days of silence: only the lookback (default 24 hours) is judged
  assert.equal((await fleet.deadman(ctx)).from, '2026-03-05 15:00:00');
});

test('US-11-R05: a request with an unknown trigger is rejected before it starts and still leaves a failed run row', async () => {
  const { ctx } = mk();
  const r = await fleet.execute(ctx, { task: { type: 'sql', definition: { statement: 'SELECT 1 AS x' } }, trigger: 'timer' });
  assert.deepEqual([r.ok, r.rejected_before_start], [false, true]);
  assert.match(r.error, /unknown trigger timer/);
  const row = await one(ctx, `SELECT status, error_class, error, trigger FROM fleet_runs WHERE run_id = ?`, r.run_id);
  assert.deepEqual([row.status, row.error_class, row.trigger], ['failed', 'unknown_trigger', 'http']);
  assert.match(row.error, /unknown trigger timer/);
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM fleet_runs`)).n, 1);
});

test('US-11-R01 and US-11-R02: reconcile compares the registered crons and reads the deployed {ok} health shape as a status', async () => {
  let list = [{ name: 'a', version: '1.2.0', source_hash: HASH, crons: ['*/5 * * * *'], health: { ok: true, org: 'x' } }];
  const { ctx } = mk({ deployed: { list: async () => list } });
  await fleet.register(ctx, member('a', { crons: ['*/10 * * * *'] }));
  const r = await fleet.reconcile(ctx);
  assert.equal(r.states.a, 'drifted');
  assert.match((await one(ctx, `SELECT state_detail FROM fleet_registry WHERE name = 'a'`)).state_detail, /crons differ: deployed \[\*\/5 \* \* \* \*\], registry \[\*\/10 \* \* \* \*\]/);
  list = [{ name: 'a', version: '1.2.0', source_hash: HASH, crons: ['*/10 * * * *'], health: { ok: true, org: 'x' } }];
  assert.equal((await fleet.reconcile(ctx)).states.a, 'live');               // {ok: true} is read as status ok; the cron set matches
  assert.deepEqual(fleet.normalizeHealth({ ok: false }), { ok: false, status: 'degraded' });
  list = [{ name: 'a', version: '1.2.0', source_hash: HASH, health: { ok: false } }];
  assert.equal((await fleet.reconcile(ctx)).states.a, 'degraded');
  const gaps = fleet.contractGaps(member('a'), { health: { ok: true, org: 'x' } });
  assert.match(gaps.find(g => g.startsWith('2')), /missing worker, version, enabled, bindings_ok$/); // status is satisfied by ok; the four identity fields are not
});

test('US-11-R20: an item the module filed closes when the reading clears and reopens when it recurs; foreign items are never touched', async () => {
  let list = [live('a', { health: { status: 'degraded', worker: 'a', version: '1.2.0', enabled: true, bindings_ok: true } }), live('stray', { version: null, health: { status: 'ok' } })];
  const { ctx } = mk({ deployed: { list: async () => list } });
  await fleet.register(ctx, member('a'));
  await ctx.db.prepare(`INSERT INTO items (id,title,owner_role,done_check) VALUES ('FLEET-OTHER-x','someone else''s','staff','x')`).run();
  await fleet.reconcile(ctx);
  assert.ok(await one(ctx, `SELECT id FROM items WHERE id = 'FLEET-DEGRADED-a' AND status = 'open'`));
  assert.ok(await one(ctx, `SELECT id FROM items WHERE id = 'FLEET-UNREGISTERED-stray' AND status = 'open'`));
  assert.deepEqual((await fleet.settleItems(ctx)).closed, []);               // the reading has not cleared
  list = [live('a')];
  await fleet.reconcile(ctx);
  const s = await fleet.settleItems(ctx);
  assert.deepEqual(s.closed.sort(), ['FLEET-DEGRADED-a', 'FLEET-UNREGISTERED-stray']);
  const done = await one(ctx, `SELECT status, disposition FROM items WHERE id = 'FLEET-DEGRADED-a'`);
  assert.equal(done.status, 'done'); assert.match(done.disposition, /^probe green: fleet_registry\.state = live for a/);
  assert.equal((await one(ctx, `SELECT status FROM items WHERE id = 'FLEET-OTHER-x'`)).status, 'open');
  list = [live('a', { health: { status: 'degraded', worker: 'a', version: '1.2.0', enabled: true, bindings_ok: true } })];
  await fleet.reconcile(ctx);                                                // it degrades again: the same id is open again, with no stale disposition
  const again = await one(ctx, `SELECT status, disposition FROM items WHERE id = 'FLEET-DEGRADED-a'`);
  assert.deepEqual([again.status, again.disposition], ['open', null]);
  await ctx.db.prepare(`UPDATE items SET status = 'cancelled', disposition = 'withdrawn' WHERE id = 'FLEET-DEGRADED-a'`).run();
  await fleet.reconcile(ctx);
  assert.equal((await one(ctx, `SELECT status FROM items WHERE id = 'FLEET-DEGRADED-a'`)).status, 'cancelled'); // a deliberate disposition is not undone
});

test('US-11-R20: stale-run, unaccounted-batch, dead-man and single-path items close only by the same reading', async () => {
  const { ctx, clock, at } = mk({ executor: async () => { throw new Error('down'); } });
  await fleet.setTask(ctx, { id: 't1', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  await fleet.setCron(ctx, { name: 'j1', expr: '*/10 * * * *', task_id: 't1' });
  await fleet.dispatch(ctx);
  at('2026-03-02 12:19:00'); await fleet.reapStale(ctx);
  assert.deepEqual((await fleet.settleItems(ctx)).closed, []);
  await fleet.execute(ctx, { task_id: 't1', trigger: 'manual' });          // the next run of the task ends ok
  assert.deepEqual((await fleet.settleItems(ctx)).closed, ['FLEET-STALE-t1']);
  await fleet.recordBatch(ctx, { executor: 'exec-a', scanned_ids: ['a', 'b'], executed: ['a'], failed: [], needs_human: [], no_action: [] });
  assert.deepEqual((await fleet.settleItems(ctx)).closed, []);
  await fleet.recordBatch(ctx, { executor: 'exec-a', scanned_ids: ['a', 'b'], executed: ['a', 'b'], failed: [], needs_human: [], no_action: [] });
  assert.deepEqual((await fleet.settleItems(ctx)).closed, ['FLEET-UNACCOUNTED-exec-a']);
  // dead-man: two stop alerts, closed once a later slot has a record
  await fleet.declareProcedure(ctx, { name: 'job', expr: '*/10 * * * *', schedulers: ['A', 'B'] });
  await runAt(ctx, clock, 'job', 'A', '2026-03-02 12:20:30'); await runAt(ctx, clock, 'job', 'B', '2026-03-02 12:20:40');
  await runAt(ctx, clock, 'job', 'A', '2026-03-02 12:30:30');
  at('2026-03-02 12:50:00');
  const d = await fleet.deadman(ctx, { from: T('2026-03-02 12:20:00') });
  assert.deepEqual(d.alerts.map(a => [a.kind, a.slot]), [['single_path', '2026-03-02 12:30:00'], ['stop', '2026-03-02 12:40:00']]);
  assert.deepEqual((await fleet.settleItems(ctx)).closed, []);               // 12:40 stop: nothing after it; B is still silent in the newest slot (12:40)
  await runAt(ctx, clock, 'job', 'A', '2026-03-02 12:51:00'); await runAt(ctx, clock, 'job', 'B', '2026-03-02 12:51:10');
  at('2026-03-02 13:10:00');
  await runAt(ctx, clock, 'job', 'A', '2026-03-02 13:00:30'); await runAt(ctx, clock, 'job', 'B', '2026-03-02 13:00:40');
  const closed = (await fleet.settleItems(ctx)).closed.sort();
  assert.deepEqual(closed, ['DEADMAN-job-202603021240', 'FLEET-PATH-job-B']);
});

test('US-11-R12: automatic staggering moves minutes within bounds, keeps firings per hour, is idempotent and logs every rewrite', async () => {
  const { ctx } = mk();
  for (const [name, expr] of [['a', '*/10 * * * *'], ['b', '*/15 * * * *'], ['c', '*/30 * * * *'], ['d', '*/10 * * * *'], ['hourly', '0 * * * *'], ['odd', '*/7 * * * *'], ['daily', '0 3 * * *'], ['pinned', '*/20 * * * *']])
    await fleet.setCron(ctx, { name, expr, task_id: 't' });
  ctx.config = { stagger_pin: ['pinned'] };
  const plan = await fleet.staggerHourly(ctx);                                      // dry run
  assert.equal(plan.applied, false);
  assert.ok((await all(ctx, `SELECT expr FROM fleet_crons WHERE name = 'a'`))[0].expr === '*/10 * * * *'); // nothing written
  assert.deepEqual(plan.skipped.map(s => [s.name, s.reason]).sort(), [['daily', 'not_every_hour'], ['odd', 'minute_field_unsupported'], ['pinned', 'pinned']]);
  assert.ok(plan.collisions_before > plan.collisions_after);
  assert.equal(plan.collisions_after, 0);
  const done = await fleet.staggerHourly(ctx, { apply: true });
  assert.equal(done.applied, true);
  const rows = Object.fromEntries((await all(ctx, `SELECT name, expr, next_fire FROM fleet_crons`)).map(r => [r.name, r]));
  const minutes = name => { const f = fleet.parseCron(rows[name].expr); const out = []; for (let m = 0; m < 60; m++) if (fleet.matchField(f[0], m)) out.push(m); return out; };
  assert.deepEqual([minutes('a').length, minutes('b').length, minutes('c').length, minutes('d').length, minutes('hourly').length], [6, 4, 2, 6, 1]); // firings per hour unchanged
  assert.equal(rows.pinned.expr, '*/20 * * * *');                              // the pinned schedule keeps its minutes and the others move off them
  assert.ok(minutes('a').every(m => !minutes('pinned').includes(m)) && minutes('b').every(m => !minutes('a').includes(m)));
  assert.equal(rows.daily.expr, '0 3 * * *');
  const managed = ['a', 'b', 'c', 'd', 'hourly', 'pinned'], seen = new Map();
  for (const name of managed) for (const m of minutes(name)) seen.set(m, [...(seen.get(m) || []), name]);
  assert.deepEqual([...seen.values()].filter(v => v.length > 1), []);          // no two managed schedules fire in the same minute of the hour
  const log = await all(ctx, `SELECT name, old_expr, new_expr, collisions_before, collisions_after FROM fleet_stagger_log ORDER BY id`);
  assert.deepEqual(log.map(l => l.name).sort(), done.changes.map(x => x.name).sort());
  assert.ok(log.every(l => l.collisions_before === plan.collisions_before && l.collisions_after === 0));
  assert.ok(done.changes.every(x => rows[x.name].next_fire === null));        // a changed expression clears next_fire
  const again = await fleet.staggerHourly(ctx, { apply: true });
  assert.deepEqual([again.changes.length, again.collisions_before, again.collisions_after], [0, 0, 0]);   // idempotent
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM fleet_stagger_log`)).n, log.length);
});

test('US-11-R12: staggering rewrites a declared procedure with its schedule so the dead-man check expects the new slots; step runs it only when switched on', async () => {
  const { ctx } = mk({ config: { stagger_auto: true } });
  await fleet.setTask(ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  await fleet.setCron(ctx, { name: 'p', expr: '*/10 * * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'q', expr: '*/10 * * * *', task_id: 't' });
  await fleet.declareProcedure(ctx, { name: 'q', expr: '*/10 * * * *', schedulers: ['dispatcher'] });
  await fleet.step(ctx);
  const q = await one(ctx, `SELECT expr FROM fleet_crons WHERE name = 'q'`), proc = await one(ctx, `SELECT expr FROM fleet_procedures WHERE name = 'q'`);
  assert.equal(q.expr, '1,11,21,31,41,51 * * * *');
  assert.equal(proc.expr, q.expr);
  const off = mk(); await fleet.setCron(off.ctx, { name: 'p', expr: '*/10 * * * *', task_id: 't' }); await fleet.setCron(off.ctx, { name: 'q', expr: '*/10 * * * *', task_id: 't' });
  await fleet.step(off.ctx);
  assert.equal((await one(off.ctx, `SELECT COUNT(*) AS n FROM fleet_stagger_log`)).n, 0);
});

test('US-11-R03 and US-11-R04: an external scheduler drives the dispatcher through an authorized route; schedules finer than the cadence are reported', async () => {
  const { ctx } = mk(); inline(ctx);
  await fleet.setTask(ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  await fleet.setCron(ctx, { name: 'fine', expr: '*/5 * * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'ok', expr: '*/10 * * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'hourly', expr: '0 * * * *', task_id: 't' });
  const req = () => new Request('https://w.example/fleet/dispatch', { method: 'POST' });
  assert.equal((await fleet.handle(req(), ctx)).status, 401);
  const res = await fleet.handle(req(), { ...ctx, authorize: async () => true });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fired.length + body.skipped.length, 3);
  assert.deepEqual(body.cadence.coarsened.map(c => [c.cron, c.min_gap_minutes]), [['fine', 5]]);
  assert.deepEqual((await fleet.cadenceReport(ctx, { every_minutes: 3 })).coarsened, []);
  assert.equal((await fleet.step(ctx)).coarsened, 1);
});

test('US-11-R21: a task may declare a timeout and bounded retries; every attempt leaves its own run record', async () => {
  const hits = [];
  const answers = [503, 200];
  const { ctx } = mk({ fetch: async url => { hits.push(url); const s = answers.shift() ?? 200; return new Response(`status ${s}`, { status: s }); } });
  const http = { type: 'http', retries: 2, definition: { url: 'https://svc.example/x' } };
  const r = await fleet.execute(ctx, { task: http, task_id: 'flaky', trigger: 'manual' });
  assert.deepEqual([r.ok, r.attempts, hits.length], [true, 2, 2]);
  const parent = await one(ctx, `SELECT status, summary, parent_run FROM fleet_runs WHERE run_id = ?`, r.run_id);
  assert.deepEqual(parent.status, 'ok'); assert.match(parent.summary, /after 2 attempts \(1 http_status, 2 ok\)/);
  const kids = await all(ctx, `SELECT status, error_class, parent_run, summary FROM fleet_runs WHERE parent_run = ?`, r.run_id);
  assert.deepEqual(kids.map(k => [k.status, k.error_class, k.parent_run]), [['failed', 'http_status', r.run_id]]);
  assert.match(kids[0].summary, /attempt 1 of 2 failed/);
  // retries exhausted: the parent ends with the last attempt's failure
  const bad = mk({ fetch: async () => new Response('down', { status: 502 }) });
  const x = await fleet.execute(bad.ctx, { task: { ...http, retries: 1 }, task_id: 'down', trigger: 'manual' });
  assert.deepEqual([x.ok, x.attempts, x.error_class], [false, 2, 'http_status']);
  assert.equal((await one(bad.ctx, `SELECT COUNT(*) AS n FROM fleet_runs WHERE parent_run = ?`, x.run_id)).n, 1);
  // no retry for a failure that cannot clear: a 4xx, a bad definition
  const nf = mk({ fetch: async () => new Response('missing', { status: 404 }) });
  assert.equal((await fleet.execute(nf.ctx, { task: { ...http, retries: 3 }, trigger: 'manual' })).attempts, 1);
  assert.equal((await fleet.execute(nf.ctx, { task: { type: 'sql', retries: 3, definition: { statement: 'SELECT 1; SELECT 2' } }, trigger: 'manual' })).attempts, 1);
});

test('US-11-R21: a timeout ends the run failed with class timeout (the work is not cancelled); backoff goes through the sleep port; stored options apply', async () => {
  const hang = mk({ fetch: () => new Promise(() => {}) });
  const t = await fleet.execute(hang.ctx, { task: { type: 'http', timeout_ms: 20, definition: { url: 'https://svc.example/slow' } }, trigger: 'manual' });
  assert.deepEqual([t.ok, t.error_class], [false, 'timeout']);
  assert.match(t.error, /20 ms/);
  const sleeps = []; let n = 0;
  const { ctx } = mk({ config: { retry_backoff_ms: 50 }, sleep: ms => (ms === 1000 ? new Promise(() => {}) : (sleeps.push(ms), Promise.resolve())), fetch: async () => { n++; if (n < 3) throw new Error('reset'); return new Response('ok', { status: 200 }); } });
  await fleet.setTask(ctx, { id: 'stored', type: 'http', definition: { url: 'https://svc.example/y' }, name: 'ping', timeout_ms: 1000, retries: 3, version: '2' });
  const r = await fleet.execute(ctx, { task_id: 'stored', trigger: 'manual' });
  assert.deepEqual([r.ok, r.attempts, sleeps], [true, 3, [50, 50]]);   // an exception is retried; each retry waits the configured backoff
  assert.deepEqual({ ...await one(ctx, `SELECT name, timeout_ms, retries, version FROM fleet_task_options WHERE task_id = 'stored'`) }, { name: 'ping', timeout_ms: 1000, retries: 3, version: '2' });
  await assert.rejects(() => fleet.setTask(ctx, { id: 'x', type: 'sql', retries: 99 }), /retries/);
  await assert.rejects(() => fleet.setTask(ctx, { id: 'x', type: 'sql', timeout_ms: -1 }), /timeout_ms/);
});

test('US-11-R05: the key aliases db and sql are accepted for sql tasks, and a workflow step echoes its name', async () => {
  const other = makeDb([]); other.raw.exec(`CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (7)`);
  const { ctx } = mk({ bindings: { OTHER: other } });
  const r = await fleet.execute(ctx, { trigger: 'manual', task: { type: 'workflow', definition: { steps: [{ name: 'read-n', type: 'sql', definition: { db: 'OTHER', sql: 'SELECT n FROM t' } }] } } });
  assert.equal(r.ok, true);
  assert.deepEqual([r.result.steps[0].name, r.result.steps[0].rows[0].n], ['read-n', 7]);
});

test('US-11-R22: the fleet envelope round-trips as a CloudEvents 1.0 event; a tampered payload and a nonconforming event are rejected with the reason', async () => {
  const { ctx } = mk();
  const payload = { sha: 'abc' };
  const env = await fleet.buildEnvelope({ kind: 'repo.merged', id: 'ev-1', ts: '2026-03-02 12:03:00', emitter: 'vcs', session: 's-1', payload });
  const ce = fleet.toCloudEvent(env, payload, { source: 'urn:test:vcs' });
  assert.deepEqual([ce.specversion, ce.type, ce.time, ce.datacontenttype, ce.emitter, ce.payloadsha256], ['1.0', 'io.ultrastable.repo.merged', '2026-03-02T12:03:00.000Z', 'application/json', 'vcs', env.provenance.sha256]);
  assert.equal(fleet.validateCloudEvent(ce), null);
  const back = fleet.fromCloudEvent(ce);
  assert.deepEqual([back.ok, back.envelope, back.payload], [true, env, payload]);
  assert.deepEqual(await fleet.recordEvent(ctx, ce), { accepted: true, id: 'ev-1' });
  assert.equal((await fleet.recordEvent(ctx, ce)).error, 'duplicate event id');
  assert.match((await fleet.recordEvent(ctx, { ...ce, id: 'ev-2', data: { sha: 'tampered' } })).error, /does not match the payload/);
  // checks written from the CloudEvents 1.0 core attributes
  assert.match(fleet.validateCloudEvent({ ...ce, specversion: '1.1' }), /specversion/);
  assert.match(fleet.validateCloudEvent({ ...ce, source: undefined }), /source is required/);
  assert.match(fleet.validateCloudEvent({ ...ce, source: 'has space' }), /source/);
  assert.match(fleet.validateCloudEvent({ ...ce, time: '2026-03-02 12:03:00' }), /RFC 3339/);
  assert.match(fleet.validateCloudEvent({ ...ce, data_base64: 'e30=' }), /mutually exclusive/);
  assert.match(fleet.validateCloudEvent({ ...ce, bad_name: 'x' }), /attribute name/);
  assert.match(fleet.validateCloudEvent({ ...ce, Upper: 'x' }), /attribute name/);
  assert.match(fleet.validateCloudEvent({ ...ce, extra: { nested: 1 } }), /string, number or boolean/);
  const rej = await fleet.recordEvent(ctx, { ...ce, id: 'ev-3', bad_name: 'x' });
  assert.equal(rej.accepted, false); assert.match(rej.error, /^cloudevent: attribute name/);
  assert.equal((await one(ctx, `SELECT state FROM fleet_events WHERE event_id = 'ev-3'`)).state, 'rejected');
  assert.match(fleet.fromCloudEvent({ ...ce, type: 'com.other.repo.merged' }).error, /type must start with io\.ultrastable\./);
  // a CloudEvent starts event-triggered tasks the same way the envelope does
  inline(ctx);
  await fleet.setTask(ctx, { id: 'recount', type: 'sql', definition: { statement: 'SELECT COUNT(*) AS n FROM items' } });
  await fleet.setTrigger(ctx, { id: 'on-merge', event_kind: 'repo.merged', task_id: 'recount' });
  const env2 = await fleet.buildEnvelope({ kind: 'repo.merged', id: 'ev-9', ts: '2026-03-02 12:03:00', emitter: 'vcs', session: 's-2', payload });
  const started = await fleet.emit(ctx, fleet.toCloudEvent(env2, payload), undefined);
  assert.deepEqual([started.accepted, started.started.length], [true, 1]);
});

// ---- round 2 additions: findings of the verification of US-SPEC-11 --------------------------------

test('US-11-R12: the hour-minute planner: moving a schedule that already fired this hour does not fire it again in that hour', async () => {
  const { ctx, at } = mk(); inline(ctx);
  await fleet.setTask(ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  await fleet.setCron(ctx, { name: 'a', expr: '0 * * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'b', expr: '0 * * * *', task_id: 't' });
  const firedB = async () => (await one(ctx, `SELECT COUNT(*) AS n FROM fleet_runs WHERE cron_name = 'b'`)).n;
  at('2026-03-02 12:00:00');
  assert.deepEqual((await fleet.dispatch(ctx)).fired.map(f => f.cron), ['a', 'b']);
  at('2026-03-02 12:01:00');
  const moved = await fleet.staggerHourly(ctx, { apply: true });
  assert.deepEqual(moved.changes.map(c => [c.name, c.to]), [['b', '1 * * * *']]);
  assert.equal((await one(ctx, `SELECT next_fire FROM fleet_crons WHERE name = 'b'`)).next_fire, '2026-03-02 13:01:00'); // the first new slot at or after the old next slot
  at('2026-03-02 12:02:00'); await fleet.dispatch(ctx);
  assert.equal(await firedB(), 1);                                            // not due again in the hour of the move
  at('2026-03-02 13:00:00'); await fleet.dispatch(ctx);
  assert.equal(await firedB(), 1);
  at('2026-03-02 13:01:00'); assert.deepEqual((await fleet.dispatch(ctx)).fired.map(f => f.cron), ['b']);
  assert.equal(await firedB(), 2);
  // a schedule that has not fired yet (next_fire null: due) stays due after a move, so its pending firing is not lost
  await fleet.setCron(ctx, { name: 'c', expr: '1 * * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'd', expr: '1 * * * *', task_id: 't' });
  await fleet.staggerHourly(ctx, { apply: true });
  const rows = await all(ctx, `SELECT name, expr, next_fire FROM fleet_crons WHERE name IN ('c','d') ORDER BY name`);
  assert.ok(rows.some(r => r.expr !== '1 * * * *'));
  assert.ok(rows.every(r => r.next_fire === null));
});

test('US-11-R11: a running row older than the running ttl ends failed as stale_running and files FLEET-STALE; a younger one is left', async () => {
  const { ctx } = mk();                                                       // now 12:03, running_ttl_minutes 60
  const ins = (task, start) => ctx.db.prepare(`INSERT INTO fleet_runs (worker, trigger, status, task_id, ts_start, queued_at) VALUES ('fleet', 'cron', 'running', ?, ?, ?)`).bind(task, start, start).run();
  await ins('old', '2026-03-02 11:00:00');                                    // 63 minutes
  await ins('young', '2026-03-02 11:30:00');                                  // 33 minutes
  const r = await fleet.reapStale(ctx);
  assert.equal(r.reaped.length, 1);
  assert.deepEqual({ ...await one(ctx, `SELECT status, error_class, error FROM fleet_runs WHERE task_id = 'old'`) }, { status: 'failed', error_class: 'stale_running', error: 'never finished' });
  assert.equal((await one(ctx, `SELECT status FROM fleet_runs WHERE task_id = 'young'`)).status, 'running');
  assert.ok(await one(ctx, `SELECT id FROM items WHERE id = 'FLEET-STALE-old'`));
  assert.equal(await one(ctx, `SELECT id FROM items WHERE id = 'FLEET-STALE-young'`), null);
});

test('US-11-R21: a retry count above max_retries is clamped for an inline task, and a configured max_retries is honoured', async () => {
  let hits = 0;
  const { ctx } = mk({ fetch: async () => { hits++; return new Response('down', { status: 503 }); } });
  const task = { type: 'http', retries: 1000, definition: { url: 'https://svc.example/x' } };
  const r = await fleet.execute(ctx, { task, task_id: 'clamped', trigger: 'manual' });
  assert.deepEqual([r.ok, r.attempts, hits], [false, 6, 6]);                  // 1 + max_retries (default 5)
  hits = 0; ctx.config = { max_retries: 2 };
  assert.equal((await fleet.execute(ctx, { task, task_id: 'clamped2', trigger: 'manual' })).attempts, 3);
  assert.equal(hits, 3);
});

test('US-11-R02: a paused worker is paused even when its health is bad: paused is checked before health, and files no degraded item', async () => {
  const bad = live('p', { health: { status: 'degraded', worker: 'p', version: '1.2.0', enabled: false, bindings_ok: false } });
  const bad2 = live('q', { health: { status: 'degraded', worker: 'q', version: '1.2.0', enabled: true, bindings_ok: false } });
  const { ctx } = mk({ deployed: { list: async () => [bad, bad2] } });
  await fleet.register(ctx, member('p')); await fleet.register(ctx, member('q'));
  const r = await fleet.reconcile(ctx);
  assert.deepEqual([r.states.p, r.states.q], ['paused', 'degraded']);
  assert.equal(await one(ctx, `SELECT id FROM items WHERE id LIKE 'FLEET-DEGRADED-p'`), null);
  assert.ok(await one(ctx, `SELECT id FROM items WHERE id LIKE 'FLEET-DEGRADED-q'`));
});

// ---- round 3 additions: one writer for both stagger planners ------------------------------------

test('US-11-R12: the day-window planner: a */30 pair moved after it fired does not fire twice in the half hour, and an unfired schedule stays due', async () => {
  const { ctx, at } = mk(); inline(ctx);
  await fleet.setTask(ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  await fleet.setCron(ctx, { name: 'a', expr: '*/30 * * * *', task_id: 't' });
  await fleet.setCron(ctx, { name: 'b', expr: '*/30 * * * *', task_id: 't' });
  const fired = async name => (await all(ctx, `SELECT ts_start FROM fleet_runs WHERE cron_name = ? ORDER BY run_id`, name)).map(r => r.ts_start);
  at('2026-03-02 12:00:00');
  assert.deepEqual((await fleet.dispatch(ctx)).fired.map(f => f.cron), ['a', 'b']);
  at('2026-03-02 12:01:00');
  const moved = await fleet.stagger(ctx, { apply: true });
  assert.deepEqual(moved.changes.map(c => [c.name, c.to]), [['b', '1,31 * * * *']]);
  assert.equal((await one(ctx, `SELECT next_fire FROM fleet_crons WHERE name = 'b'`)).next_fire, '2026-03-02 12:31:00'); // the first new slot at or after the old next slot
  for (const t of ['12:02', '12:30', '12:31']) { at(`2026-03-02 ${t}:00`); await fleet.dispatch(ctx); }
  assert.deepEqual(await fired('b'), ['2026-03-02 12:00:00', '2026-03-02 12:31:00']);   // once in each half hour, never at 12:02
  assert.deepEqual(await fired('a'), ['2026-03-02 12:00:00', '2026-03-02 12:30:00']);
  // a schedule that has not fired yet (next_fire null: due) stays due after a move
  await fleet.setCron(ctx, { name: 'c', expr: '*/30 * * * *', task_id: 't' });
  const again = await fleet.stagger(ctx, { apply: true });
  assert.deepEqual(again.changes.map(c => c.name), ['c']);
  assert.equal((await one(ctx, `SELECT next_fire FROM fleet_crons WHERE name = 'c'`)).next_fire, null);
});

test('US-11-R12: the day-window planner never moves a pinned schedule, moves a declared procedure with its schedule and logs every rewrite', async () => {
  const { ctx } = mk({ config: { auto_stagger: true, stagger_pin: ['b'] } }); inline(ctx);
  await fleet.setTask(ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  for (const name of ['a', 'b', 'c']) await fleet.setCron(ctx, { name, expr: '*/10 * * * *', task_id: 't' });
  await fleet.declareProcedure(ctx, { name: 'c', expr: '*/10 * * * *', schedulers: ['dispatcher'] });
  const s = await fleet.step(ctx);
  assert.deepEqual([s.stagger_planner, s.staggered], ['day', 2]);
  const rows = Object.fromEntries((await all(ctx, `SELECT name, expr FROM fleet_crons`)).map(r => [r.name, r.expr]));
  assert.deepEqual(rows, { a: '1,11,21,31,41,51 * * * *', b: '*/10 * * * *', c: '2,12,22,32,42,52 * * * *' });   // the pinned name keeps its minutes; the others move off them
  assert.equal((await one(ctx, `SELECT expr FROM fleet_procedures WHERE name = 'c'`)).expr, rows.c);           // the dead-man check expects the new slots
  const log = await all(ctx, `SELECT name, old_expr, new_expr, collisions_before, collisions_after FROM fleet_stagger_log ORDER BY id`);
  assert.deepEqual(log.map(l => [l.name, l.old_expr, l.new_expr]), [['a', '*/10 * * * *', rows.a], ['c', '*/10 * * * *', rows.c]]);
  assert.ok(log.every(l => l.collisions_before > 0 && l.collisions_after === 0));
  const plan = await fleet.stagger(ctx, {});
  assert.deepEqual([plan.changes, plan.pinned], [[], ['b']]);
  assert.equal((await fleet.step(ctx)).staggered, 0);
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM fleet_stagger_log`)).n, 2);                          // a second tick rewrites nothing
});

test('US-11-R12: with both planners switched on one runs per tick, so a second tick rewrites nothing', async () => {
  const { ctx, at } = mk({ config: { auto_stagger: true, stagger_auto: true } }); inline(ctx);
  await fleet.setTask(ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  for (const [name, expr] of [['a', '*/10 * * * *'], ['b', '*/10 * * * *'], ['daily', '0 3 * * *'], ['h', '0 * * * *']]) await fleet.setCron(ctx, { name, expr, task_id: 't' });
  const first = await fleet.step(ctx);
  assert.equal(first.stagger_planner, 'day');
  const exprs = async () => (await all(ctx, `SELECT name, expr FROM fleet_crons ORDER BY name`)).map(r => `${r.name}=${r.expr}`);
  const after = await exprs(), logged = (await one(ctx, `SELECT COUNT(*) AS n FROM fleet_stagger_log`)).n;
  assert.ok(logged > 0);
  for (const t of ['12:13', '12:23', '12:33']) { at(`2026-03-02 ${t}:00`); assert.equal((await fleet.step(ctx)).staggered, 0); }
  assert.deepEqual(await exprs(), after);
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM fleet_stagger_log`)).n, logged);
  const hourOnly = await fleet.step({ ...ctx, config: { stagger_auto: true } });
  assert.equal(hourOnly.stagger_planner, 'hour');
});

// ---- round 4 additions: the dead-man check after a stagger move ---------------------------------

// Two schedules with declared procedures, dispatched every 10 minutes from 11:00 to `until`, moved apart at 12:01 by one planner.
// `silentFrom` switches b's dispatcher off from that minute on, so b's scheduler goes silent after the move.
async function movedPair(planner, { until, silentFrom = null }) {
  const { ctx, at } = mk(); inline(ctx);
  const expr = planner === 'day' ? '*/30 * * * *' : '0 * * * *';
  await fleet.setTask(ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  for (const name of ['a', 'b']) { await fleet.setCron(ctx, { name, expr, task_id: 't' }); await fleet.declareProcedure(ctx, { name, expr, schedulers: ['dispatcher'] }); }
  let moved = null;
  for (let t = T('2026-03-02 11:00:00'); t <= T(until); t += 60000) {
    at(new Date(t).toISOString().slice(0, 19).replace('T', ' '));
    if (t === T('2026-03-02 12:01:00')) moved = planner === 'day' ? await fleet.stagger(ctx, { apply: true }) : await fleet.staggerHourly(ctx, { apply: true });
    if (silentFrom && t === T(silentFrom)) await ctx.db.prepare(`UPDATE fleet_crons SET enabled = 0 WHERE name = 'b'`).run();
    if ((t / 60000) % 10 === 0) await fleet.dispatch(ctx);
  }
  const dm = await fleet.deadman(ctx, { from: T('2026-03-02 11:00:00'), to: T(until) });
  return { ctx, moved, dm, alerts: dm.alerts.map(a => [a.procedure, a.slot, a.kind]), b: dm.procedures.find(p => p.procedure === 'b') };
}

test('US-11-R08 and US-11-R12: the day-window planner: the slot a move leaves unfired on purpose is not judged; a silence from the first new slot still stops', async () => {
  const ok = await movedPair('day', { until: '2026-03-02 13:10:00' });
  assert.deepEqual(ok.moved.changes.map(c => [c.name, c.to]), [['b', '1,31 * * * *']]);
  assert.deepEqual(ok.alerts, []);                                             // b ran at 12:00 and next at 12:40: the 12:01 slot was skipped by the move
  assert.deepEqual([ok.b.slots, ok.b.skipped, ok.b.reliability.dispatcher], [3, 1, 1]);
  assert.deepEqual({ ...await one(ok.ctx, `SELECT procedure, expr, moved_at, first_fire FROM fleet_stagger_skips`) },
    { procedure: 'b', expr: '1,31 * * * *', moved_at: '2026-03-02 12:01:00', first_fire: '2026-03-02 12:31:00' });
  const silent = await movedPair('day', { until: '2026-03-02 13:10:00', silentFrom: '2026-03-02 12:32:00' });
  assert.deepEqual(silent.alerts, [['b', '2026-03-02 12:31:00', 'stop']]);       // the first slot the move left to fire is judged
  const later = await movedPair('day', { until: '2026-03-02 13:40:00', silentFrom: '2026-03-02 12:41:00' });
  assert.deepEqual(later.alerts, [['b', '2026-03-02 13:01:00', 'stop']]);        // silent after its first new firing (12:40): one stop
});

test('US-11-R08 and US-11-R12: the hour-minute planner: the slot a move leaves unfired on purpose is not judged; a silence from the first new slot still stops', async () => {
  const ok = await movedPair('hour', { until: '2026-03-02 14:10:00' });
  assert.deepEqual(ok.moved.changes.map(c => [c.name, c.to]), [['b', '1 * * * *']]);
  assert.deepEqual(ok.alerts, []);                                             // b ran at 12:00 and next at 13:10: the 12:01 slot was skipped by the move
  assert.deepEqual([ok.b.slots, ok.b.skipped, ok.b.reliability.dispatcher], [2, 1, 1]);
  const silent = await movedPair('hour', { until: '2026-03-02 14:10:00', silentFrom: '2026-03-02 12:32:00' });
  assert.deepEqual(silent.alerts, [['b', '2026-03-02 13:01:00', 'stop']]);       // the first slot the move left to fire is judged
});

test('US-11-R08 and US-11-R12: a schedule moved while it was still due skips nothing, and a planner switched on in step for a firing fleet files no false stop', async () => {
  // still due at the move (next_fire null): it fires at the next dispatch, so no slot is left unfired and nothing is skipped
  const { ctx, at } = mk(); inline(ctx);
  await fleet.setTask(ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  for (const name of ['a', 'b']) { await fleet.setCron(ctx, { name, expr: '*/30 * * * *', task_id: 't' }); await fleet.declareProcedure(ctx, { name, expr: '*/30 * * * *', schedulers: ['dispatcher'] }); }
  at('2026-03-02 12:01:00'); await fleet.stagger(ctx, { apply: true });
  assert.equal((await one(ctx, `SELECT next_fire FROM fleet_crons WHERE name = 'b'`)).next_fire, null);
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM fleet_stagger_skips`)).n, 0);
  // a schedule with no declared procedure at its old expression moves alone: the dead-man check has nothing to skip for it
  const lone = mk(); inline(lone.ctx);
  await fleet.setTask(lone.ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  for (const name of ['a', 'b']) await fleet.setCron(lone.ctx, { name, expr: '*/30 * * * *', task_id: 't' });
  lone.at('2026-03-02 12:00:00'); await fleet.dispatch(lone.ctx);
  lone.at('2026-03-02 12:01:00'); await fleet.stagger(lone.ctx, { apply: true });
  assert.equal((await one(lone.ctx, `SELECT COUNT(*) AS n FROM fleet_stagger_skips`)).n, 0);
  // through step: a */30 pair fires for an hour, then auto_stagger is switched on at 12:10
  const s = mk(); inline(s.ctx);
  await fleet.setTask(s.ctx, { id: 't', type: 'sql', definition: { statement: 'SELECT 1 AS x' } });
  for (const name of ['a', 'b']) { await fleet.setCron(s.ctx, { name, expr: '*/30 * * * *', task_id: 't' }); await fleet.declareProcedure(s.ctx, { name, expr: '*/30 * * * *', schedulers: ['dispatcher'] }); }
  for (let m = 0; m <= 180; m += 10) {
    s.at(new Date(T('2026-03-02 11:00:00') + m * 60000).toISOString().slice(0, 19).replace('T', ' '));
    s.ctx.config = m >= 70 ? { auto_stagger: true } : {};
    await fleet.step(s.ctx);
  }
  assert.equal((await one(s.ctx, `SELECT expr FROM fleet_procedures WHERE name = 'b'`)).expr, '1,31 * * * *');
  const items = (await all(s.ctx, `SELECT id FROM items WHERE id LIKE 'DEADMAN-%' ORDER BY id`)).map(r => r.id);
  assert.deepEqual(items.filter(id => !/-2026030210\d\d$/.test(id)), []);    // only the slots before the first tick (10:00, 10:30) had no record
});
