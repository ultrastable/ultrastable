// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../../core/_shared/testdb.js';
import { runTick } from '../../core/src/tick.js';
import { claimSlot, runOncePerSlot, SLOT_MS } from './slot.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
const ticks = db => db.raw.prepare(`SELECT COUNT(*) AS n FROM tick_runs`).get().n;

test('US-14-T03 and R09: the scheduler request sent twice in one slot leaves one tick row for the slot', async () => {
  const db = makeDb([MIG]);
  const fire = now => runOncePerSlot(db, () => runTick(db, { config, now }), { now });
  const first = await fire(T0); const second = await fire(T0 + 30e3);
  assert.equal(first.ran, true); assert.deepEqual(second, { ran: false, slot: first.slot, duplicate: true });
  assert.equal(ticks(db), 1);
  const row = db.raw.prepare(`SELECT * FROM sched_slots`).get();
  assert.equal(row.slot, Math.floor(T0 / SLOT_MS)); assert.equal(row.tick_run_id, first.result.tickId); assert.equal(row.outcome, 'completed'); assert.equal(row.claimed_at, '2026-11-15 12:00:00');
  assert.equal((await fire(T0 + SLOT_MS)).ran, true, 'the next slot runs');
  assert.equal(ticks(db), 2);
});

test('US-14-R03: two instances receiving the same firing at once run one tick between them', async () => {
  const db = makeDb([MIG]);
  let running = 0; let peak = 0;
  const tick = async () => { running++; peak = Math.max(peak, running); await new Promise(r => setImmediate(r)); const r = await runTick(db, { config, now: T0 }); running--; return r; };
  const results = await Promise.all(Array.from({ length: 8 }, () => runOncePerSlot(db, tick, { now: T0 })));
  assert.equal(results.filter(r => r.ran).length, 1); assert.equal(peak, 1); assert.equal(ticks(db), 1);
});

test('a tick that throws keeps its slot (never two ticks in one slot) and records the error; an incomplete tick is marked', async () => {
  const db = makeDb([MIG]);
  await assert.rejects(() => runOncePerSlot(db, async () => { throw new Error('store offline'); }, { now: T0 }), /store offline/);
  assert.equal(db.raw.prepare(`SELECT outcome FROM sched_slots`).get().outcome, 'error');
  assert.equal((await runOncePerSlot(db, async () => ({ tickId: 9, completed: 8, total: 8 }), { now: T0 })).ran, false);
  const r = await runOncePerSlot(db, async () => ({ tickId: 3, completed: 7, total: 8 }), { now: T0 + SLOT_MS });
  assert.equal(r.ran, true);
  assert.equal(db.raw.prepare(`SELECT outcome FROM sched_slots WHERE slot=?`).get(r.slot).outcome, 'incomplete');
  assert.deepEqual(await claimSlot(db, T0 + 5 * SLOT_MS, { slotMs: SLOT_MS }), { won: true, slot: Math.floor(T0 / SLOT_MS) + 5 });
});

test('US-14-R03 and US-14-R17: a tick still running when the next slot starts is not overlapped; a claim abandoned past the bound is taken over', async () => {
  const db = makeDb([MIG]);
  let finish; const long = new Promise(r => { finish = r; });
  const first = runOncePerSlot(db, async () => { await long; return { tickId: 1, completed: 8, total: 8 }; }, { now: T0 });
  await new Promise(r => setImmediate(r));
  const next = await runOncePerSlot(db, async () => { throw new Error('must not run'); }, { now: T0 + SLOT_MS });
  assert.deepEqual([next.ran, next.overlap, next.running_slot], [false, true, Math.floor(T0 / SLOT_MS)], 'the earlier tick holds the store until it ends');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM sched_slots`).get().n, 1, 'the overlapped slot was not taken');
  finish(); await first;
  assert.equal((await runOncePerSlot(db, async () => ({ tickId: 2, completed: 8, total: 8 }), { now: T0 + SLOT_MS })).ran, true, 'once it has ended the next slot runs');
  // a process that died: its slot row never got an outcome
  db.raw.exec(`INSERT INTO sched_slots (slot, claimed_at) VALUES (${Math.floor(T0 / SLOT_MS) + 10}, '2026-11-15 13:40:00')`);
  const at = Date.UTC(2026, 10, 15, 13, 40, 0);
  const soon = await runOncePerSlot(db, async () => ({ tickId: 3, completed: 8, total: 8 }), { now: at + SLOT_MS });
  assert.equal(soon.overlap, true, 'inside the bound the claim may still be running');
  const late = await runOncePerSlot(db, async () => ({ tickId: 4, completed: 8, total: 8 }), { now: at + 3 * SLOT_MS });
  assert.equal(late.ran, true, 'past the bound the abandoned claim is taken over');
  assert.equal(db.raw.prepare(`SELECT outcome FROM sched_slots WHERE slot=?`).get(Math.floor(T0 / SLOT_MS) + 10).outcome, 'abandoned');
  assert.equal((await runOncePerSlot(db, async () => ({ tickId: 5, completed: 8, total: 8 }), { now: at + 3 * SLOT_MS, noOverlapMs: 1 })).duplicate, true, 'the same slot is still a duplicate');
});
