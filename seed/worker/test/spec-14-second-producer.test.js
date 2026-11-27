// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-14 (portability seams): US-14-R12 and US-14-T06, the scheduler port's second producer (src/pulse.js `watch`, served as POST /pulse/watch),
// proved against the seed runtime. Clocks are frozen and the database is in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick } from '../src/tick.js';
import { watch } from '../src/pulse.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, tick_every_min: 10 };
const T0 = Date.parse('2026-11-10T00:00:00Z'), MIN = 60e3;
const count = async (db, sql) => (await db.prepare(sql).first()).n;
const ticks = db => count(db, `SELECT COUNT(*) AS n FROM tick_runs`);
const beats = db => count(db, `SELECT COUNT(*) AS n FROM loop_beats WHERE loop='watchdog'`);

test('US-14-T06 and US-14-R12: with the newest tick older than two intervals the second producer runs one tick and leaves one beat; called again at once it runs none', async () => {
  const db = makeDb();
  await runTick(db, { config, now: T0 });
  const late = T0 + 25 * MIN;                                  // two intervals of 10 minutes have passed with no tick
  const r = await watch(db, () => runTick(db, { config, now: late }), { now: () => late, config });
  assert.equal(r.stale, true);
  assert.equal(await ticks(db), 2, 'one new tick row');
  assert.equal(await beats(db), 1, 'one beat of the second producer');
  let ran = 0;
  const again = await watch(db, async () => { ran++; }, { now: () => late, config });
  assert.equal(again.stale, false); assert.equal(ran, 0, 'called again at once, it runs no tick');
  assert.equal(await ticks(db), 2);
  assert.equal(await beats(db), 2, 'each run of the second producer is recorded, the idle one too');
});

test('US-14-R12: inside two intervals the second producer runs no tick but still records its run', async () => {
  const db = makeDb();
  await runTick(db, { config, now: T0 });
  let ran = 0;
  const r = await watch(db, async () => { ran++; }, { now: () => T0 + 19 * MIN, config });
  assert.equal(r.stale, false); assert.equal(ran, 0);
  assert.equal(await beats(db), 1);
});
