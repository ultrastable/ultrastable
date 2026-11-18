// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick, STEP_ORDER } from '../src/tick.js';
import { beat, failed, judgeLoop, watch, readPulse, tickCadenceMin, PULSE_DDL, LANE_LOOPS, ensurePulseSchema } from '../src/pulse.js';
import { judge, readIgnition, STAGES, DEFAULTS, REQUIRED_TABLES } from '../src/ignition.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, criticality: crit, tick_every_min: 10 };
const T0 = Date.parse('2026-11-10T00:00:00Z'), MIN = 60e3;
const norm = s => s.replace(/\s+/g, ' ').trim();

test('SCHEMA-SELF-1: the DDL the Worker carries equals the migration, and the Worker can create its own tables', async () => {
  const mig = readFileSync(new URL('../migrations/0013_pulse.sql', import.meta.url), 'utf8').split('\n').filter(l => !l.startsWith('--')).join('\n').split(';').map(norm).filter(Boolean);
  assert.deepEqual(mig, PULSE_DDL.map(norm));
  const db = makeDb();
  for (const t of ['loop_beats', 'loop_clock', 'ignition_log']) db.raw.exec(`DROP TABLE ${t}`);
  await ensurePulseSchema(db);  // code deployed ahead of its migration
  const r = await runTick(db, { config, now: T0 });
  assert.equal(r.completed, STEP_ORDER.length, JSON.stringify(r.errors));
});

test('beat leaves the proof: a good run, a thrown error and a returned error are all rows, and nothing throws', async () => {
  const db = makeDb(); let t = T0;
  assert.deepEqual(await beat(db, 'a', async () => ({ status: 'ok', n: 2 }), { now: () => t }), { status: 'ok', n: 2 });
  const out = await beat(db, 'b', async () => { throw new Error('boom'); }, { now: () => t });
  assert.match(out.status, /^error boom/);
  await beat(db, 'c', async () => ({ status: 'error http-500' }), { now: () => t });
  const rows = (await db.prepare(`SELECT loop, ok, error, finished_at FROM loop_beats ORDER BY id`).all()).results;
  assert.deepEqual(rows.map(r => [r.loop, r.ok]), [['a', 1], ['b', 0], ['c', 0]]);
  assert.equal(rows[1].error, 'boom');
  assert.ok(rows.every(r => r.finished_at));
});

test('IDLE-IS-NOT-OK-1: a loop that returns without doing its work is a failed beat, and one working route of several is a good one', async () => {
  assert.equal(failed({ status: 'ok', merged: [] }), null);
  assert.equal(failed(undefined), null);
  assert.equal(failed({ status: 'no-token', merged: [] }), 'no-token');
  assert.equal(failed({ status: 'error http-500' }), 'error http-500');
  assert.equal(failed({ ok: false, error: 'installation suspended' }), 'installation suspended');
  assert.equal(failed({ ok: false }), 'ok=false');
  assert.equal(failed([{ ok: false, detail: 'github dispatch HTTP 403' }, { ok: true, detail: 'code agents answering: workers-ai' }]), null);
  assert.equal(failed([{ ok: false, detail: 'github dispatch HTTP 403' }]), 'github dispatch HTTP 403');
  assert.equal(failed([{ error: 'no analytics token' }, { error: 'no analytics token' }]), 'no analytics token');
  assert.equal(failed([]), null);
  assert.equal(failed({ status: 'errors', checked: [], errors: ['o/r#424 status 403', 'o/r#423 status 403'] }), 'errors: o/r#424 status 403');  // the gate's live result, 2026-11-15 19:40
  assert.equal(failed({ status: 'errors', checked: ['o/r#1'], errors: ['o/r#2 status 403'] }), null);  // some work done: good, its errors stay in the detail
  const db = makeDb();
  await beat(db, 'lane', async () => ({ status: 'no-token', merged: [] }), { now: () => T0 });
  await beat(db, 'executor', async () => [{ ok: false, detail: 'HTTP 403' }, { ok: true }], { now: () => T0 });
  const rows = (await db.prepare(`SELECT loop, ok, error FROM loop_beats ORDER BY id`).all()).results;
  assert.deepEqual(rows, [{ loop: 'lane', ok: 0, error: 'no-token' }, { loop: 'executor', ok: 1, error: null }]);
});

test('judgeLoop counts expected, ran, good and missed slots and names the state', () => {
  const now = T0 + 24 * 60 * MIN, runs = [];
  for (let i = 1; i <= 144; i++) if (i % 12 !== 0) runs.push({ at: now - i * 10 * MIN + 30e3, ok: i % 10 === 0 ? 0 : 1 });
  const j = judgeLoop({ everyMin: 10, runs, firstAt: now - 3 * 86400e3, now });
  assert.equal(j.expected, 144); assert.equal(j.ran, 132); assert.equal(j.missed, 12);
  assert.equal(j.state, 'ticking');
  assert.equal(judgeLoop({ everyMin: 10, runs: [{ at: now - 50 * MIN, ok: 1 }], firstAt: now - 50 * MIN, now }).state, 'stopped');
  assert.equal(judgeLoop({ everyMin: 10, runs: [{ at: now - 18 * MIN, ok: 1 }], firstAt: now - 18 * MIN, now }).state, 'late');
  assert.equal(judgeLoop({ everyMin: 10, runs: [{ at: now - 8 * MIN, ok: null }], firstAt: now - 8 * MIN, now }).state, 'hung');
  assert.equal(judgeLoop({ everyMin: 10, runs: [{ at: now - 2 * MIN, ok: 0 }], firstAt: now - 2 * MIN, now }).state, 'failing');
  assert.equal(judgeLoop({ everyMin: 10, runs: [], firstAt: null, now, sinceMs: now - 5 * MIN }).state, 'warming');
  assert.equal(judgeLoop({ everyMin: 10, runs: [], firstAt: null, now, sinceMs: now - 60 * MIN }).state, 'never');
  // a loop is not charged for slots before it first existed
  assert.equal(judgeLoop({ everyMin: 10, runs: [{ at: now - 25 * MIN, ok: 1 }, { at: now - 15 * MIN, ok: 1 }, { at: now - 5 * MIN, ok: 1 }], firstAt: now - 25 * MIN, now }).missed, 0);
});

async function drive(db, n, { skip = () => false, start = T0, lane = LANE_LOOPS, failing = null } = {}) {
  let last;
  for (let i = 0; i < n; i++) {
    const now = start + i * 10 * MIN;
    for (const l of lane) if (!skip(l, i)) await beat(db, l, async () => { if (l === failing) throw new Error('x'); return { status: 'ok' }; }, { now: () => now + 2000 });
    await watch(db, async () => { throw new Error('tick must not run: not stale'); }, { now: () => now + 5 * MIN, config }).catch(() => null);
    last = await runTick(db, { config, now });
  }
  return last;
}

test('pulse: every loop that runs every slot is ticking; a loop that stops is found, filed as MISSED-<loop>, and closed when it runs again', async () => {
  const db = makeDb();
  await drive(db, 8, { lane: [] });  // the tick and its watchdog run before the lane exists: no false alarm in the first slots
  await drive(db, 8, { start: T0 + 80 * MIN });
  let p = await readPulse(db);
  assert.equal(p.not_ticking.length, 0, JSON.stringify(p.not_ticking));
  assert.equal(p.watchdog, true);
  assert.equal(p.tick.missed_24h, 0);
  await drive(db, 6, { start: T0 + 160 * MIN, skip: l => l === 'cost-samples' });
  p = await readPulse(db);
  assert.deepEqual(p.not_ticking.map(x => x.loop), ['cost-samples']);
  assert.equal(p.clock.find(c => c.loop === 'cost-samples').state, 'stopped');
  const it = await db.prepare(`SELECT status, closing_probe FROM items WHERE id='MISSED-cost-samples'`).first();
  assert.equal(it.closing_probe, 'pulse:cost-samples');
  assert.notEqual(it.status, 'done');
  assert.ok(await db.prepare(`SELECT 1 AS x FROM ignition_gaps WHERE link='loop:cost-samples:not-ticking' AND status='open'`).first());
  await drive(db, 3, { start: T0 + 220 * MIN });
  assert.equal((await db.prepare(`SELECT status FROM items WHERE id='MISSED-cost-samples'`).first()).status, 'done');
  assert.equal((await db.prepare(`SELECT status FROM ignition_gaps WHERE link='loop:cost-samples:not-ticking'`).first()).status, 'closed');
  assert.ok((await readPulse(db)).clock.find(c => c.loop === 'cost-samples').missed_24h >= 5);  // the missed slots stay counted for 24 h
});

test('pulse: a loop that keeps throwing is failing, not ticking, and the loops after it still ran', async () => {
  const db = makeDb();
  await drive(db, 5, { failing: 'gate' });
  const p = await readPulse(db);
  assert.deepEqual(p.not_ticking.map(x => [x.loop, x.state]), [['gate', 'failing']]);
  assert.equal(p.clock.find(c => c.loop === 'cost-samples').state, 'ticking');
});

test('watchdog: a stale heartbeat is restarted by the second producer, and the tick it ran is in the ledger', async () => {
  const db = makeDb();
  await runTick(db, { config, now: T0 });
  let ran = 0;
  const fresh = await watch(db, async () => { ran++; }, { now: () => T0 + 12 * MIN, config });
  assert.equal(fresh.stale, false); assert.equal(ran, 0);
  const late = T0 + 45 * MIN;
  const r = await watch(db, () => runTick(db, { config, now: late }), { now: () => late, config });
  assert.equal(r.stale, true);
  assert.equal(r.completed, STEP_ORDER.length);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM tick_runs`).first()).n, 2);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM loop_beats WHERE loop='watchdog' AND ok=1`).first()).n, 2);
  const p = await readPulse(db);
  assert.ok(p.tick.missed_24h >= 3, 'the slots the heartbeat missed are counted, not forgotten');
});

test('the tick reads its own cadence from its own history', async () => {
  const db = makeDb();
  for (let i = 0; i < 8; i++) await runTick(db, { config: { ...config, tick_every_min: undefined }, now: T0 + i * 15 * MIN });
  assert.equal(await tickCadenceMin(db, {}), 15);
});

const ev = (o = {}) => ({ missing_tables: [], roles: 3, tick_streak: 10, tick_missed_1h: 0, closed_verified: 2, silent_drops: 0, metrics: 6, declared_metrics: 0, objectives_without_probe: 0,
  dispatches: 10, dispatch_verified: 8, k_streak: 0, pulse: { not_ticking: [], warming: 0, coverage_24h: 0.99, missed_24h: 1, ticking: 13, loops: 13, watchdog: true },
  criticality: { k_eff: 0.2, k_min: 1, open_ignition_gaps: 0, human_touches: 0, credited_deploys: 2, originated_credited: 0, spend_units: 10 }, ...o });

test('ignition ladder: the stage is the highest whose condition and every one below it hold', () => {
  assert.equal(judge(ev({ missing_tables: ['loop_beats'] })).stage, 'unseeded');
  assert.equal(judge(ev({ tick_streak: 2 })).stage, 'seeded');
  assert.equal(judge(ev({ pulse: null })).blocking.stage, 'looping');
  assert.equal(judge(ev({ pulse: { ...ev().pulse, watchdog: false } })).stage, 'ticking');
  assert.equal(judge(ev({ closed_verified: 0 })).stage, 'looping');
  assert.equal(judge(ev({ declared_metrics: 1 })).stage, 'closing');
  const boot = judge(ev());
  assert.equal(boot.stage, 'instrumented'); assert.equal(boot.bootstrapped, true); assert.equal(boot.critical, false);
  assert.match(boot.blocking.why, /k_eff 0\.2 against k_min 1/);
  assert.equal(judge(ev({ k_streak: 6, criticality: { ...ev().criticality, k_eff: 1.4, open_ignition_gaps: 2 } })).stage, 'critical');
  assert.equal(judge(ev({ k_streak: 144, criticality: { ...ev().criticality, k_eff: 1.4 } })).stage, 'self-sustaining');
  // a higher condition holding does not skip a lower one that fails
  assert.equal(judge(ev({ k_streak: 200, tick_streak: 0 })).stage, 'seeded');
});

test('ignition step: the system records each stage it reaches or loses, and keeps IGNITE-<stage> true to the reading', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('watch-1','watcher',1,'m')");  // a role with no items: the stage is judged, nothing is dispatched
  await drive(db, 9);
  let ig = await readIgnition(db);
  assert.ok(STAGES.includes(ig.stage));
  assert.equal(ig.holds.seeded.ok, true, ig.holds.seeded.why);
  assert.equal(ig.holds.ticking.ok, true, ig.holds.ticking.why);
  assert.ok(ig.blocking);
  const open = await db.prepare(`SELECT id, status, closing_probe FROM items WHERE id=?`).bind(`IGNITE-${ig.blocking.stage}`).first();
  assert.equal(open.closing_probe, `ignition:${ig.blocking.stage}`);
  assert.notEqual(open.status, 'done');
  assert.equal((await db.prepare(`SELECT status FROM items WHERE id='IGNITE-ticking'`).first())?.status ?? 'done', 'done');
  assert.ok(ig.log.length >= 2, 'transitions are appended');
  assert.equal(ig.log[ig.log.length - 1].direction, 'first');
  // losing the heartbeat's completeness loses the stage, and the loss is recorded
  db.raw.exec(`DROP TABLE trust_ledger`);
  await runTick(db, { config, now: T0 + 90 * MIN }); await runTick(db, { config, now: T0 + 100 * MIN });
  ig = await readIgnition(db);
  assert.equal(ig.stage, 'unseeded');
  assert.equal(ig.log[0].direction, 'down');
  assert.deepEqual(REQUIRED_TABLES.filter(t => t === 'trust_ledger'), ['trust_ledger']);
  assert.equal(DEFAULTS.sustained_ticks, 144);
});

test('an hourly watchdog is judged against its own cadence: ticking, no MISSED-watchdog, and the ladder sees a watching producer', async () => {
  const db = makeDb();
  await runTick(db, { config, now: T0 - 10 * MIN });  // a heartbeat exists before the watchdog first looks
  let last;
  for (let i = 0; i < 14; i++) {
    const now = T0 + i * 10 * MIN;
    for (const l of LANE_LOOPS) await beat(db, l, async () => ({ status: 'ok' }), { now: () => now + 2000 });
    if (i % 6 === 0) await watch(db, async () => { throw new Error('not stale'); }, { now: () => now + 5 * MIN, config }).catch(() => null);  // once an hour, like the site cron
    last = await runTick(db, { config, now });
  }
  const p = await readPulse(db);
  const w = p.clock.find(c => c.loop === 'watchdog');
  assert.equal(w.every_min, 60);
  assert.equal(w.state, 'ticking', JSON.stringify(w));
  assert.equal(p.watchdog, true);
  assert.equal(await db.prepare(`SELECT 1 AS x FROM items WHERE id='MISSED-watchdog'`).first(), null);
  assert.equal(last.completed, STEP_ORDER.length);
});

test('PACE-1: beats_24h and beats_productive_share_24h read the loop clock; idle runs do not count as progress', async () => {
  const { METRICS } = await import('../src/tick.js');
  const db = makeDb(); let t = T0;
  await beat(db, 'a', async () => ({ status: 'ok', n: 2 }), { now: () => t });
  await beat(db, 'b', async () => ({}), { now: () => t });
  await beat(db, 'c', async () => { throw new Error('x'); }, { now: () => t });
  await beat(db, 'd', async () => ({ done: ['x'] }), { now: () => t });
  assert.equal(await METRICS.beats_24h(db, T0 + 60e3), 4);
  assert.equal(await METRICS.beats_productive_share_24h(db, T0 + 60e3), 0.5);
  const empty = makeDb(); empty.raw.exec('DROP TABLE loop_beats');
  assert.equal(await METRICS.beats_24h(empty, T0), 0);
});
