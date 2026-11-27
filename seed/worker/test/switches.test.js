// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// KILL-SWITCH-1: per-loop switch rows (US-09-R01, US-09-T01) and the drill of the global switch (US-09-R03).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick, STEP_ORDER } from '../src/tick.js';
import { beat } from '../src/pulse.js';
import { readSwitches, offReason, setSwitch, gated, drill, lastDrill, ALL, ACTION_STEPS, DRILL_MAX_MS } from '../src/switches.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.parse('2026-11-10T00:00:00Z');
function seed(db) {
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('A','a','staff','x',10,'open');`);
}

test('US-09-R01, US-09-T01: a switched-off acting step writes no action row; every measuring step still runs', async () => {
  const db = makeDb(); seed(db);
  await setSwitch(db, 'dispatch', true, { reason: 'test', by: 'test', now: T0 });
  const r = await runTick(db, { config, now: T0 });
  assert.equal(r.completed, STEP_ORDER.length, 'the tick still finishes every slot');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM claims').get().n, 0, 'no claim, no dispatch');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM dispatches').get().n, 0);
  assert.match(r.report, /dispatch skipped: dispatch switched off: test/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM tick_runs WHERE finished_at IS NOT NULL').get().n, 1, 'measurement continues: the tick row is written');
  await setSwitch(db, 'dispatch', false);
  await runTick(db, { config, now: T0 + 600e3 });
  assert.deepEqual(db.raw.prepare('SELECT item_id FROM claims').all().map(x => x.item_id), ['A'], 'on again: the item is dispatched');
});

test('US-09-R01: only acting steps can be switched off in the tick; a row for a measuring step changes nothing', async () => {
  assert.deepEqual(ACTION_STEPS.filter(s => !STEP_ORDER.includes(s)), []);
  const db = makeDb(); seed(db);
  await setSwitch(db, 'measure', true, { reason: 'test', by: 'test', now: T0 });
  const r = await runTick(db, { config, now: T0 });
  assert.doesNotMatch(r.report, /measure skipped/);
});

test('US-09-R17: the global row and the worker variable cover every loop; an expired row no longer counts; off needs a reason', async () => {
  const db = makeDb();
  assert.equal(offReason(await readSwitches(db, { now: T0 }), 'lane'), null);
  await setSwitch(db, ALL, true, { reason: 'stop', by: 'owner', until: T0 + 60e3, now: T0 });
  assert.match(offReason(await readSwitches(db, { now: T0 }), 'lane'), /every loop switched off: stop/);
  assert.equal(offReason(await readSwitches(db, { now: T0 + 61e3 }), 'lane'), null, 'past `until` the row ends by itself');
  const viaEnv = await readSwitches(db, { env: { LOOPS_OFF: 'lane, sweeper' }, now: T0 + 61e3 });
  assert.match(offReason(viaEnv, 'sweeper'), /LOOPS_OFF/); assert.equal(offReason(viaEnv, 'gate'), null);
  await assert.rejects(setSwitch(db, 'lane', true, { reason: ' ' }), /states its reason/);
});

test('US-09-R01: a switched-off loop leaves its beat (measurement) and its body does not run', async () => {
  const db = makeDb(); let ran = 0;
  const sw = { lane: { reason: 'test', set_by: 'test', until: null } };
  const out = await beat(db, 'lane', async () => gated(sw, 'lane', async () => { ran++; return { merged: [1] }; }), { now: () => T0 });
  assert.equal(ran, 0); assert.match(out.switched_off, /lane switched off/);
  const row = db.raw.prepare("SELECT ok, detail FROM loop_beats WHERE loop='lane'").get();
  assert.equal(row.ok, 1); assert.match(row.detail, /switched_off/);
});

test('US-09-R03 US-09-T07: the drill proves refusal, turns the switch off, proves resumption and records the test', async () => {
  const db = makeDb(); let t = T0;
  assert.equal((await lastDrill(db, T0)).due, true, 'no drill yet: due');
  const r = await drill(db, { now: () => (t += 5) });
  assert.equal(r.ok, true); assert.equal(r.refused, true); assert.equal(r.turned_off, true); assert.equal(r.resumed, true);
  assert.ok(r.duration_ms < DRILL_MAX_MS && DRILL_MAX_MS < 10 * 60e3, 'bounded, under 10 minutes');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM loop_switches').get().n, 0, 'nothing left on');
  const row = db.raw.prepare('SELECT ok, refused, turned_off, resumed FROM switch_drills').get();
  assert.deepEqual({ ...row }, { ok: 1, refused: 1, turned_off: 1, resumed: 1 });
  const m = await lastDrill(db, T0 + 2 * 3600e3);
  assert.equal(m.last_pass_age_h, 2); assert.equal(m.due, false);
  assert.equal((await lastDrill(db, T0 + 25 * 3600e3)).due, true);
});

test('US-09-R03 US-09-T07: the switch is turned off in every case, including an error inside the drill, and the failed drill is recorded', async () => {
  const db = makeDb(); await readSwitches(db, { now: T0 });
  let n = 0;
  // the third clock read (taken while the switch is on) throws: the check fails mid-drill
  const r = await drill(db, { now: () => { if (++n === 2) throw new Error('boom'); return T0 + n; } });
  assert.equal(r.ok, false); assert.match(r.error, /boom/);
  assert.equal(r.turned_off, true, 'off in every case');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM loop_switches').get().n, 0);
  assert.equal(db.raw.prepare('SELECT ok FROM switch_drills').get().ok, 0);
  assert.equal((await lastDrill(db, T0 + 60e3)).last_pass_age_h, null, 'a failed drill is not a passing drill');
});

test('US-09-R03 US-09-R17: if the row cannot be deleted it still ends by itself inside the bound', async () => {
  const db = makeDb(); await readSwitches(db, { now: T0 });
  const real = db.prepare.bind(db);
  const flaky = { ...db, prepare(sql) { if (/^DELETE FROM loop_switches/.test(sql)) throw new Error('db down'); return real(sql); } };
  const r = await drill(flaky, { now: () => T0 });
  assert.equal(r.ok, false); assert.equal(r.turned_off, false); assert.match(r.error, /expires by itself/);
  assert.ok(offReason(await readSwitches(db, { now: T0 + DRILL_MAX_MS - 1 }), 'lane'), 'still on inside the bound');
  assert.equal(offReason(await readSwitches(db, { now: T0 + DRILL_MAX_MS + 1 }), 'lane'), null, 'and over after it');
});

test('US-09-R03 US-09-R17: a drill never touches a global switch the owner set', async () => {
  const db = makeDb();
  await setSwitch(db, ALL, true, { reason: 'real stop', by: 'owner', now: T0 });
  const r = await drill(db, { now: () => T0 + 1 });
  assert.equal(r.status, 'skipped'); assert.match(r.skipped, /real stop is in effect|already on/);
  assert.equal(db.raw.prepare("SELECT set_by FROM loop_switches WHERE loop='*'").get().set_by, 'owner');
});
