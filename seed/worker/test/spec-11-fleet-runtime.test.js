// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-11 (fleet runtime) requirements the platform meets in the seed: R15 (a second producer for the heartbeat), R17 (a loop writes its
// beat before its body and is judged by slots) and R18 (a loop that stops files one item that only the same reading closes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick, STEP_ORDER } from '../src/tick.js';
import { beat, failed, judgeLoop, watch, readPulse, LANE_LOOPS } from '../src/pulse.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, criticality: crit, tick_every_min: 10 };
const T0 = Date.parse('2026-11-10T00:00:00Z'), MIN = 60e3;
const count = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()).n;

test('US-11-R15: a stale heartbeat is run by the second producer and a fresh one is not; every call leaves a record', async () => {
  const db = makeDb();
  await runTick(db, { config, now: T0 });
  let ran = 0;
  const fresh = await watch(db, async () => { ran++; }, { now: () => T0 + 12 * MIN, config });          // 12 minutes old: inside two intervals
  assert.deepEqual([fresh.stale, ran, await count(db, `SELECT COUNT(*) AS n FROM tick_runs`)], [false, 0, 1]);
  const late = T0 + 25 * MIN;                                                                             // 25 minutes old: more than two intervals
  const r = await watch(db, () => runTick(db, { config, now: late }), { now: () => late, config });
  assert.deepEqual([r.stale, r.completed, r.total], [true, STEP_ORDER.length, STEP_ORDER.length]);
  assert.equal(await count(db, `SELECT COUNT(*) AS n FROM tick_runs`), 2);                               // the tick the producer ran is in the ledger
  assert.equal(await count(db, `SELECT COUNT(*) AS n FROM loop_beats WHERE loop = 'watchdog' AND ok = 1`), 2); // a fresh call and a stale call both left a beat
  // no tick has ever run: the second producer starts the clock
  const empty = makeDb();
  assert.equal((await watch(empty, () => runTick(empty, { config, now: T0 }), { now: () => T0, config })).stale, true);
  assert.equal(await count(empty, `SELECT COUNT(*) AS n FROM tick_runs`), 1);
});

test('US-11-R17: the beat is written before the body runs; a thrown error, a missing credential and ok:false are failed beats; the state names what is wrong', async () => {
  const db = makeDb();
  let during = null;
  await beat(db, 'x', async () => { during = await db.prepare(`SELECT finished_at, ok FROM loop_beats WHERE loop = 'x'`).first(); return { status: 'ok' }; }, { now: () => T0 });
  assert.deepEqual(during, { finished_at: null, ok: null });                                              // the row exists, unfinished, while the body runs
  assert.deepEqual({ ...await db.prepare(`SELECT ok FROM loop_beats WHERE loop = 'x'`).first() }, { ok: 1 });
  await beat(db, 'thrown', async () => { throw new Error('boom'); }, { now: () => T0 });
  await beat(db, 'nocred', async () => ({ status: 'no-token', merged: [] }), { now: () => T0 });
  await beat(db, 'notok', async () => ({ ok: false, error: 'suspended' }), { now: () => T0 });
  const rows = (await db.prepare(`SELECT loop, ok FROM loop_beats ORDER BY id`).all()).results;
  assert.deepEqual(rows.map(r => [r.loop, r.ok]), [['x', 1], ['thrown', 0], ['nocred', 0], ['notok', 0]]);
  assert.equal(failed({ status: 'no-token' }), 'no-token');
  const now = T0 + 24 * 60 * MIN, one = (age, ok) => ({ everyMin: 10, runs: [{ at: now - age * MIN, ok }], firstAt: now - age * MIN, now });
  assert.deepEqual([one(50, 1), one(18, 1), one(8, null), one(2, 0), one(5, 1)].map(a => judgeLoop(a).state), ['stopped', 'late', 'hung', 'failing', 'ticking']);
  assert.equal(judgeLoop({ everyMin: 10, runs: [], firstAt: null, now, sinceMs: now - 60 * MIN }).state, 'never');
  assert.equal(judgeLoop({ everyMin: 10, runs: [], firstAt: null, now, sinceMs: now - 5 * MIN }).state, 'warming');
  // slots expected against slots run, over 24 hours: one slot in twelve missed
  const runs = []; for (let i = 1; i <= 144; i++) if (i % 12 !== 0) runs.push({ at: now - i * 10 * MIN + 30e3, ok: 1 });
  const j = judgeLoop({ everyMin: 10, runs, firstAt: now - 3 * 86400e3, now });
  assert.deepEqual([j.expected, j.ran, j.good, j.missed, j.coverage], [144, 132, 132, 12, 0.9167]);
});

test('US-11-R18: a loop that stops files one item on the second bad reading, only the same reading closes it, and a later stop reopens it', async () => {
  const db = makeDb();
  const tickAt = async (i, silent) => {
    const now = T0 + i * 10 * MIN;
    for (const l of LANE_LOOPS) if (l !== silent) await beat(db, l, async () => ({ status: 'ok' }), { now: () => now + 2000 });
    await watch(db, async () => null, { now: () => now + 5 * MIN, config }).catch(() => null);
    await runTick(db, { config, now });
  };
  const streak = async () => (await db.prepare(`SELECT bad_streak, state FROM loop_clock WHERE loop = 'cost-samples'`).first());
  const item = async () => db.prepare(`SELECT status, disposition, closing_probe FROM items WHERE id = 'MISSED-cost-samples'`).first();
  let i = 0;
  for (; i < 16; i++) await tickAt(i, null);
  assert.equal(await item(), null);                                                                       // a loop that runs every slot files nothing
  let reading = 0;
  while ((await streak()).bad_streak < 1 && reading++ < 8) await tickAt(i++, 'cost-samples');
  assert.equal((await streak()).bad_streak, 1);
  assert.equal(await item(), null);                                                                       // one bad reading is a late run, not an item
  await tickAt(i++, 'cost-samples');
  assert.equal((await streak()).bad_streak, 2);
  const filed = await item();
  assert.equal(filed.closing_probe, 'pulse:cost-samples'); assert.notEqual(filed.status, 'done');
  assert.equal(await count(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'MISSED-cost-samples%'`), 1);   // one item, however many readings
  while ((await streak()).state !== 'ticking' && i < 80) await tickAt(i++, null);
  const closed = await item();
  assert.equal(closed.status, 'done'); assert.match(closed.disposition, /^probe green: pulse:cost-samples ticking/);   // closed by the reading that filed it
  for (let n = 0; n < 8; n++) await tickAt(i++, 'cost-samples');                                          // it stops again
  const reopened = await item();
  assert.deepEqual([reopened.status, reopened.disposition], ['ready', null]);
  assert.equal((await readPulse(db)).not_ticking.some(x => x.loop === 'cost-samples'), true);
});
