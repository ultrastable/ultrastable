// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-09 section 3: switch rows, the global switch port and the bounded drill, over the real claim service and router.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../../_shared/testdb.js';
import * as C from '../../claims/index.js';
import { createRouter } from '../router.js';
import * as caps from './index.js';

const dirs = [caps.MIGRATIONS_DIR, C.MIGRATIONS_DIR ?? new URL('../../claims/migrations/', import.meta.url), new URL('../migrations/', import.meta.url)].map(d => fileURLToPath(d));
const EXAMPLE = JSON.parse(readFileSync(new URL('../example-config.json', import.meta.url), 'utf8'));
const KEYS = { PROVIDER_A_API_KEY: 'k-a', PROVIDER_B_API_KEY: 'k-b' };
const T0 = Date.parse('2026-11-26T10:00:00Z');

function setup() {
  const db = makeDb(dirs), clock = { t: T0 };
  const killSwitch = caps.killSwitchPort(db);
  const ctx = { db, now: () => clock.t, config: { claim_ttl_minutes: 120 }, killSwitch };
  const fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  const router = createRouter({ db, fetch, now: () => clock.t, config: EXAMPLE, env: KEYS, killSwitch });
  return { db, clock, ctx, router };
}
const n = (db, sql, ...a) => db.raw.prepare(sql).get(...a).n;

test('the migration is idempotent and every table is caps_ prefixed', () => {
  const { db } = setup();
  const sql = readFileSync(fileURLToPath(new URL('./migrations/0001_caps.sql', import.meta.url)), 'utf8');
  db.raw.exec(sql); db.raw.exec(sql);
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) assert.match(m[1], /^caps_/);
});

test('US-09-T01 US-09-R01: with a loop switch on no action row is written and measurement rows continue', async () => {
  const { db } = setup();
  db.raw.exec(`CREATE TABLE loop_actions (n INTEGER); CREATE TABLE loop_measures (n INTEGER)`);
  const once = () => caps.guardLoop(db, 'plus', { measure: async () => db.raw.prepare(`INSERT INTO loop_measures VALUES (1)`).run(), act: async () => db.raw.prepare(`INSERT INTO loop_actions VALUES (1)`).run() });
  assert.equal((await once()).acted, true);
  await caps.setSwitch(db, 'plus', true, { by: 'test', reason: 'T01' });
  const r = await once();
  assert.deepEqual([r.acted, r.stopped_by], [false, 'plus']);
  assert.equal(n(db, `SELECT COUNT(*) AS n FROM loop_actions`), 1, 'no action while off');
  assert.equal(n(db, `SELECT COUNT(*) AS n FROM loop_measures`), 2, 'the measurement continued');
  await caps.setSwitch(db, 'plus', false);
  assert.equal((await once()).acted, true);
  assert.equal((await caps.guardLoop(db, 'other', { act: async () => 1 })).acted, true, 'another loop is not affected by this loop switch');
});

test('US-09-R01: the global switch stops every guarded loop actions and not its measurement', async () => {
  const { db } = setup();
  await caps.setSwitch(db, caps.GLOBAL, true);
  let acted = 0, measured = 0;
  for (const loop of ['a', 'b', 'c']) {
    const r = await caps.guardLoop(db, loop, { measure: async () => { measured++; }, act: async () => { acted++; } });
    assert.deepEqual([r.acted, r.stopped_by], [false, '*']);
  }
  assert.deepEqual([acted, measured], [0, 3]);
});

test('US-09-T02 US-09-R02: with the global switch on the claim service refuses work, secret and deploy acquire and renewal with the observation event; off, the next claim is granted', async () => {
  const { db, ctx } = setup();
  const a = await C.acquire(ctx, { path: 'k', holder: 'a' });
  await caps.setSwitch(db, caps.GLOBAL, true);
  assert.equal((await C.acquire(ctx, { path: 'k2', holder: 'a' })).reason, 'kill-switch');
  assert.equal((await C.acquire(ctx, { kind: 'secret', key: 's', holder: 'a' })).status, 503);
  assert.equal((await C.acquire(ctx, { kind: 'deploy', key: 'd', holder: 'a' })).status, 503);
  assert.equal((await C.heartbeat(ctx, { path: 'k', token: a.token })).status, 503);
  assert.ok(n(db, `SELECT COUNT(*) AS n FROM claims_events WHERE event='kill-switch'`) >= 4, 'each refusal leaves its observation event');
  await caps.setSwitch(db, caps.GLOBAL, false);
  assert.equal((await C.acquire(ctx, { path: 'k3', holder: 'a' })).acquired, true);
});

function probesFor({ db, ctx, router }) {
  const events = k => async () => n(db, `SELECT COUNT(*) AS n FROM claims_events WHERE event='kill-switch' AND kind=?`, k) > 0;
  return [
    { name: 'claims work', refused: async () => (await C.acquire(ctx, { path: 'drill-w', holder: 'd' })).reason === 'kill-switch', event: events('work') },
    { name: 'claims secret', refused: async () => (await C.acquire(ctx, { kind: 'secret', key: 'drill-s', holder: 'd' })).status === 503, event: events('secret') },
    { name: 'claims deploy', refused: async () => (await C.acquire(ctx, { kind: 'deploy', key: 'drill-d', holder: 'd' })).status === 503, event: events('deploy') },
    { name: 'router', refused: async () => (await router.route({ rung: 'small' })).refusal === 'kill_switch_all' },
  ];
}

test('US-09-R03: a drill of the global switch refuses every path, turns the switch off, proves resumption and records the test', async () => {
  const s = setup();
  const r = await caps.drill({ db: s.db, now: () => s.clock.t, probes: probesFor(s), resume: async () => (await C.acquire(s.ctx, { path: 'after', holder: 'd' })).acquired === true });
  assert.deepEqual([r.passed, r.refused_ok, r.event_seen, r.resumed_ok, r.switch_off_after, r.error], [true, true, true, true, true, null]);
  assert.equal(await caps.killSwitchPort(s.db)(), false);
  assert.equal(n(s.db, `SELECT COUNT(*) AS n FROM caps_drills WHERE passed=1`), 1);
  assert.equal(await caps.drillAgeHours(s.db, () => s.clock.t + 5 * 3600000), 5);
});

test('US-09-R03: a drill turns the switch off when a probe throws', async () => {
  const s = setup();
  const r = await caps.drill({ db: s.db, now: () => s.clock.t, probes: [{ name: 'boom', refused: async () => { throw new Error('probe exploded'); } }], resume: async () => true });
  assert.deepEqual([r.passed, r.switch_off_after], [false, true]);
  assert.match(r.error, /probe exploded/);
  assert.equal(await caps.killSwitchPort(s.db)(), false);
  assert.equal(await caps.drillAgeHours(s.db, () => s.clock.t), null, 'a failed drill does not reset the age');
});

test('US-09-R03: a drill that overruns its bound is recorded failed and still ends with the switch off', async () => {
  const s = setup();
  const r = await caps.drill({ db: s.db, now: () => s.clock.t, boundMs: 60000, probes: [{ name: 'slow', refused: async () => { s.clock.t += 120000; return true; } }], resume: async () => true });
  assert.deepEqual([r.passed, r.switch_off_after], [false, true]);
  assert.match(r.error, /over its bound/);
});

test('US-09-R03: a drill that cannot turn the switch off through its port still leaves the row off', async () => {
  const s = setup(), real = s.db.prepare.bind(s.db); let blocked = false;
  const flaky = { ...s.db, raw: s.db.raw, prepare(sql) { if (blocked && /INSERT INTO caps_switches/.test(sql)) throw new Error('write refused'); return real(sql); } };
  const r = await caps.drill({ db: flaky, now: () => s.clock.t, probes: [{ name: 'p', refused: async () => { blocked = true; return true; } }], resume: async () => true });
  assert.equal(r.switch_off_after, true);
  assert.equal(r.passed, false);
});

test('US-09-R03: the drill own cost is bounded under 10 minutes by default', () => {
  assert.ok(caps.DEFAULT_DRILL_BOUND_MS < 10 * 60 * 1000);
});
