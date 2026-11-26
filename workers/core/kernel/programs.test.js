// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kdb, setv, probe, item, one, rows } from './testkit.js';
import { registerMetric, readAllMetrics } from './metrics.js';
import { registerProgram, riskScore, snapshotRisk, allocateSlots, allocate, setFocus } from './programs.js';
import { parsePrediction } from './decisions.js';
import { runL2 } from './index.js';

const progs = (risks, extra = {}) => risks.map((risk, i) => ({ id: `p${i}`, risk, open: 1, ...(extra[i] || {}) }));
const slotsOf = (o, n) => Array.from({ length: n }, (_, i) => o[`p${i}`].slots);

test('US-03-T06: risks 120/40/20/15/5 with T=25 allocate 10/5/4/3/3 and OPS constrains', () => {
  const a = allocateSlots(progs([120, 40, 20, 15, 5]), 25);
  assert.deepEqual(slotsOf(a, 5), [10, 5, 4, 3, 3]);
  assert.equal(a.p0.class, 'constrain');
});

test('an escalated program gets 1.5x slots and the total stays at T (worked example)', () => {
  const a = allocateSlots(progs([120, 40, 20, 15, 5], { 1: { escalate: true } }), 25);
  assert.equal(a.p1.slots, 7); assert.equal(a.p1.class, 'escalate');
  assert.equal(slotsOf(a, 5).reduce((s, n) => s + n, 0), 25);
  assert.ok(a.p4.slots < 3, 'the excess came off the lowest-risk program');
});

test('allocation never exceeds T and idle programs get none (US-03-R13)', () => {
  for (const T of [1, 7, 25, 40]) for (const risks of [[1, 1, 1], [0, 0, 0], [100, 1], [3, 9, 27, 81, 243]]) {
    const a = allocateSlots(progs(risks, { 0: { escalate: true } }), T);
    assert.ok(slotsOf(a, risks.length).reduce((s, n) => s + n, 0) <= T, `T=${T} risks=${risks}`);
  }
  const a = allocateSlots([{ id: 'a', risk: 5, open: 1 }, { id: 'b', risk: 50, open: 0 }], 25);
  assert.equal(a.b.slots, 0); assert.equal(a.b.class, 'idle'); assert.equal(a.a.slots, 25);
});

test('risk = 3H + 0.3O + 15G + 2S', () => assert.equal(riskScore({ high: 2, open: 4, guards: 1, stalled: 1 }), 24.2));

async function world() {
  const db = kdb();
  await registerProgram(db, { id: 'P1', name: 'Reach', primary_metric_id: 'm1' });
  await registerMetric(db, { id: 'm1', program_id: 'P1', op: '>=', target: 10, read_probe: probe('m1') });
  await registerMetric(db, { id: 'g1', program_id: 'P1', kind: 'guard', op: '<=', target: 1, read_probe: probe('g1') });
  setv(db, 'm1', 5); setv(db, 'g1', 3);
  await readAllMetrics(db);
  item(db, 'A', { project: 'P1' }); item(db, 'B', { project: 'P1' }); item(db, 'C', { project: 'P1', priority: 5 });
  item(db, 'D', { project: 'P1' }); item(db, 'E', { project: 'P1', status: 'blocked' });
  db.raw.exec(`UPDATE items SET priority = 1 WHERE id = 'E'`);
  db.raw.exec(`INSERT INTO kernel_item_meta (item_id, metric_id, doer) VALUES ('A','m1','coder'), ('B','m1',NULL)`);
  return db;
}

test('risk snapshot: guard breach makes the program RED and the numbers follow the formula (US-03-R12)', async () => {
  const db = await world();
  const [s] = await snapshotRisk(db, { tickId: 1, now: Date.now() });
  assert.equal(s.verdict, 'RED'); assert.equal(s.guards, 1); assert.equal(s.stalled, 1); assert.equal(s.high, 2);
  assert.equal(s.risk, riskScore({ high: 2, open: 5, guards: 1, stalled: 1 }));
  assert.equal(s.quality_index, 0);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_risk_snapshot WHERE tick_id=1`).n, 1);
});

test('focus: primary-metric items first, and within a tier the item with no doer ranks first', async () => {
  const db = await world();
  const now = Date.now();
  await snapshotRisk(db, { tickId: 1, now }); await allocate(db, { tickId: 1, now });
  const focus = await setFocus(db, { tickId: 1, now });
  assert.equal(focus.P1[0], 'B'); assert.equal(focus.P1[1], 'A');
  const f = rows(db, `SELECT item_id, tier, has_doer FROM kernel_focus ORDER BY rank`);
  assert.equal(f[0].tier, 0); assert.equal(f[0].has_doer, 0); assert.equal(f[1].has_doer, 1);
  assert.equal(f[2].item_id, 'E'); assert.equal(f[2].tier, 3);
  assert.deepEqual(focus.P1, ['B', 'A', 'E', 'C', 'D']);
});

test('every allocation writes a decision_log row with a parsable prediction (US-03-R15)', async () => {
  const db = await world();
  const now = Date.now();
  await snapshotRisk(db, { tickId: 7, now }); await allocate(db, { tickId: 7, now });
  const d = one(db, `SELECT * FROM kernel_decisions WHERE id='ALLOC-7'`);
  assert.ok(d); assert.ok(d.authority); assert.ok(d.revert_path); assert.ok(parsePrediction(d.prediction));
  assert.equal(one(db, `SELECT slots FROM kernel_allocations WHERE tick_id=7`).slots, 25);
});

test('manager operations can be switched off while measurement continues (US-03-R14)', async () => {
  const db = await world();
  const ctx = { config: { kernel: { manager_ops: false } }, now: Date.now(), tickId: 3, notes: [], errors: [] };
  await runL2(db, ctx);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_risk_snapshot`).n, 1, 'risk is still measured');
  assert.ok(one(db, `SELECT COUNT(*) AS n FROM kernel_metric_readings`).n >= 2);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_allocations`).n, 0, 'no allocation was made');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_focus`).n, 0);
  const off = { ...ctx, tickId: 4, config: { kernel: { enabled: false } }, notes: [] };
  await runL2(db, off);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_step_evidence WHERE tick_id=4`).n, 0);
});

// ---- US-01 section 4.2 program_focus_log: the history of focus sets ----
const log = (db) => rows(db, `SELECT tick_id, program_id, items_json, count FROM kernel_focus_log ORDER BY id`);

test('US-01-R08 and US-03 s4: the first focus set writes one kernel_focus_log row holding the ranked item ids in order and the tick that wrote it', async () => {
  const db = await world();
  const now = Date.now();
  await snapshotRisk(db, { tickId: 1, now }); await allocate(db, { tickId: 1, now });
  await setFocus(db, { tickId: 1, now });
  const l = log(db);
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].tick_id, l[0].program_id, l[0].count], [1, 'P1', 5]);
  assert.deepEqual(JSON.parse(l[0].items_json), ['B', 'A', 'E', 'C', 'D']);
});

test('US-01-R08: an unchanged focus set writes no new row; a changed set writes one, and a shrunken set is logged too', async () => {
  const db = await world();
  const t = Date.now();
  const tick = async (id) => { await snapshotRisk(db, { tickId: id, now: t }); await allocate(db, { tickId: id, now: t }); return setFocus(db, { tickId: id, now: t }); };
  await tick(1); await tick(2); await tick(3);
  assert.equal(log(db).length, 1, 'three ticks, one set: one row');
  item(db, 'F', { project: 'P1', priority: 0 });                                  // a new critical item takes the top of the ranking
  await tick(4);
  const l = log(db);
  assert.equal(l.length, 2); assert.equal(l[1].tick_id, 4);
  assert.equal(JSON.parse(l[1].items_json)[2], 'F', 'the new item entered the set (tier 2, after the primary-metric items)');
  db.raw.exec(`UPDATE items SET status = 'done', disposition = 'shipped' WHERE project = 'P1' AND id <> 'A'`);
  await tick(5);
  const last = log(db).at(-1);
  assert.deepEqual([last.tick_id, last.count, last.items_json], [5, 1, '["A"]']);
});

test('US-01-R08: a program whose set is unchanged does not log while another program that changed does', async () => {
  const db = await world();
  await registerProgram(db, { id: 'P2', name: 'Other' });
  item(db, 'X', { project: 'P2' });
  const t = Date.now();
  const tick = async (id) => { await snapshotRisk(db, { tickId: id, now: t }); await allocate(db, { tickId: id, now: t }); return setFocus(db, { tickId: id, now: t }); };
  await tick(1);
  assert.deepEqual(log(db).map(r => r.program_id).sort(), ['P1', 'P2']);
  item(db, 'Y', { project: 'P2', priority: 0 });
  await tick(2);
  assert.deepEqual(log(db).slice(2).map(r => [r.program_id, r.tick_id]), [['P2', 2]]);
});

test('US-01-R08: a database without the focus-log table still gets its focus; the missing table is said in the tick notes, and is an error for a caller that gave no place for notes', async () => {
  const db = await world();
  db.raw.exec('DROP TABLE kernel_focus_log');
  const now = Date.now(); const notes = [];
  await snapshotRisk(db, { tickId: 1, now }); await allocate(db, { tickId: 1, now });
  const focus = await setFocus(db, { tickId: 1, now, notes });
  assert.deepEqual(focus.P1, ['B', 'A', 'E', 'C', 'D']);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_focus`).n, 5);
  assert.deepEqual(notes, ['kernel_focus_log is missing: 0003_focus_log.sql is not applied yet, so the focus history is not recorded']);
  await snapshotRisk(db, { tickId: 2, now }); await allocate(db, { tickId: 2, now });
  item(db, 'Z', { project: 'P1', priority: 0 });
  await assert.rejects(() => setFocus(db, { tickId: 2, now }), /no such table: kernel_focus_log/);
});
