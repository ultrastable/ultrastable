// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runTick, STEP_ORDER } from '../src/tick.js';
import { kdb, setv, probe, item, one, rows } from './testkit.js';
import { registerMetric } from './metrics.js';
import { registerProgram } from './programs.js';
import { registerFailureMode } from './failure.js';
import { runL2, L2_EXTRA_STEPS, L2_STEP_NAMES } from './index.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };

test('the tick extension hook is backward compatible: no extraSteps means the seven L1 steps', async () => {
  const db = kdb();
  const r = await runTick(db, { config });
  assert.equal(r.total, STEP_ORDER.length); assert.equal(r.completed, STEP_ORDER.length);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_step_evidence`).n, 0);
});

test('runL2 plugs into runTick as an extra step and every sub-step writes an evidence row (US-03-R11)', async () => {
  const db = kdb();
  await registerProgram(db, { id: 'P', name: 'p', primary_metric_id: 'm' });
  await registerMetric(db, { id: 'm', program_id: 'P', op: '>=', target: 1, read_probe: probe('m') });
  setv(db, 'm', 2); item(db, 'I1', { project: 'P' });
  const r = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS });
  assert.equal(r.total, STEP_ORDER.length + 1); assert.equal(r.completed, r.total); assert.deepEqual(r.errors, []);
  assert.match(r.report, /l2 9\/9/);
  const ev = rows(db, `SELECT step, ok FROM kernel_step_evidence WHERE tick_id = ?`, r.tickId);
  assert.deepEqual(ev.map(e => e.step).sort(), [...L2_STEP_NAMES].sort());
  assert.ok(ev.every(e => e.ok === 1));
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_allocations`).n, 1);
  assert.equal(one(db, `SELECT status FROM kernel_decisions WHERE id = ?`, `ALLOC-${r.tickId}`).status, 'open');
});

test('a failing L2 sub-step is guarded: the rest run, a TICKFAIL item is filed and the error is reported', async () => {
  const db = kdb();
  db.raw.exec(`DROP TABLE kernel_failure_modes`);
  const r = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS });
  assert.equal(r.completed, r.total, 'the tick itself still completes');
  assert.ok(r.errors.some(e => /detectors/.test(e)));
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'TICKFAIL-l2_detectors-%' AND priority = 0`).n, 1);
  const ev = rows(db, `SELECT step, ok FROM kernel_step_evidence`);
  assert.equal(ev.length, L2_STEP_NAMES.length); assert.equal(ev.filter(e => e.ok === 0).length, 1);
});

test('a previous slot with missing evidence rows is detected as a failure (US-03-R11)', async () => {
  const db = kdb();
  const t1 = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS });
  db.raw.prepare(`DELETE FROM kernel_step_evidence WHERE tick_id = ? AND step IN ('focus', 'lifecycle')`).run(t1.tickId);
  const t2 = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS });
  const it = one(db, `SELECT title FROM items WHERE id = ?`, `L2MISSING-${t1.tickId}`);
  assert.match(it.title, /focus, lifecycle/);
  assert.equal(t2.completed, t2.total);
});

test('end to end: a detector fires, a remediation item is filed and closed by its probe, all through the tick', async () => {
  const db = kdb(); setv(db, 'seen', 1); setv(db, 'queue_err', 3);
  await registerFailureMode(db, {
    id: 'FM-A', severity: 3, detector_sql: `SELECT v AS value FROM t_vals WHERE k = 'seen'`, fire_when: 'value < 5',
    contract: { owner: 'ops', doer: 'fixer', closing_probe: probe('queue_err'), pass: '= 0', max_attempts: 3, backoff_h: [0], deadline_h: 24 },
  });
  const t1 = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_remediations WHERE status='open'`).n, 1);
  setv(db, 'queue_err', 0); setv(db, 'seen', 10);
  const t2 = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS, now: Date.now() + 60e3 });
  assert.equal(one(db, `SELECT status FROM kernel_remediations`).status, 'closed');
  assert.equal(t2.tickId, t1.tickId + 1);
});

test('runL2 can be called directly with a context object', async () => {
  const db = kdb();
  const ctx = { config: {}, now: Date.now(), tickId: 1, notes: [], errors: [] };
  const r = await runL2(db, ctx);
  assert.equal(r.completed, L2_STEP_NAMES.length); assert.deepEqual(r.errors, []);
});

// ---- US-03-R11: a tick that ran without L2, or with L2 switched off, is not a failure; every L1 step leaves evidence ----
const T0 = Date.UTC(2026, 10, 26, 8, 0, 0);

test('US-03-R11: a tick that ran without L2 followed by a tick with L2 files no L2MISSING item', async () => {
  const db = kdb();
  const t1 = await runTick(db, { config, now: T0 });                                  // the eight L1 steps only: steps_total equals the L1 list
  assert.equal(t1.total, STEP_ORDER.length);
  const t2 = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS, now: T0 + 600e3 });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'L2MISSING-%'`).n, 0);
  assert.deepEqual(t2.errors, []);
});

test('US-03-R11: a tick skipped because kernel.enabled is false is not reported as missing evidence on the tick after it is re-enabled', async () => {
  const db = kdb();
  const off = await runTick(db, { config: { ...config, kernel: { enabled: false } }, extraSteps: L2_EXTRA_STEPS, now: T0 });
  assert.equal(off.total, STEP_ORDER.length + 1);
  assert.match(off.report, /l2 disabled/);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_step_evidence WHERE tick_id = ?`, off.tickId).n, 0, 'a disabled L2 writes no L2 evidence row');
  await runTick(db, { config, extraSteps: L2_EXTRA_STEPS, now: T0 + 600e3 });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'L2MISSING-%'`).n, 0);
});

test('US-03-R11: a previous L2 slot whose evidence rows were all deleted is still reported (a tick with extra steps and no note that L2 was off)', async () => {
  const db = kdb();
  const t1 = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS, now: T0 });
  db.raw.prepare(`DELETE FROM kernel_step_evidence WHERE tick_id = ?`).run(t1.tickId);
  await runTick(db, { config, extraSteps: L2_EXTRA_STEPS, now: T0 + 600e3 });
  assert.match(one(db, `SELECT title FROM items WHERE id = ?`, `L2MISSING-${t1.tickId}`).title, /read_metrics, risk_snapshot/);
});

test('US-03-R11: an L2 tick writes one evidence row for each of the eight L1 steps and each L2 sub-step, readable together in one view', async () => {
  const db = kdb();
  const r = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS, now: T0 });
  const l1 = rows(db, `SELECT step, ok, evidence FROM kernel_l1_step_evidence WHERE tick_id = ? ORDER BY id`, r.tickId);
  assert.deepEqual(l1.map(x => x.step), STEP_ORDER);
  assert.ok(l1.every(x => x.ok === 1 && x.evidence));
  assert.match(l1.find(x => x.step === 'dispatch').evidence, /^dispatched 0 item\(s\)$/);
  const all = rows(db, `SELECT layer, step FROM kernel_v_step_evidence WHERE tick_id = ?`, r.tickId);
  assert.equal(all.filter(x => x.layer === 'l1').length, STEP_ORDER.length);
  assert.deepEqual(all.filter(x => x.layer === 'l2').map(x => x.step).sort(), [...L2_STEP_NAMES].sort());
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_step_evidence WHERE tick_id = ?`, r.tickId).n, L2_STEP_NAMES.length, 'the L2 table keeps exactly the L2 sub-steps');
});

test('US-03-R11 and US-00-R04: the evidence of a failed L1 step is the error the step threw, and a clean step quotes what it reported', async () => {
  const db = kdb();
  db.raw.exec('DROP TABLE predictions');
  const r = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS, now: T0 });
  const bad = one(db, `SELECT ok, evidence FROM kernel_l1_step_evidence WHERE tick_id = ? AND step = 'score_predictions'`, r.tickId);
  assert.equal(bad.ok, 0); assert.match(bad.evidence, /no such table: predictions/);
  const good = one(db, `SELECT ok, evidence FROM kernel_l1_step_evidence WHERE tick_id = ? AND step = 'reconcile'`, r.tickId);
  assert.equal(good.ok, 1); assert.match(good.evidence, /^reconciled: 0 reopened, 0 became ready$/);
});

test('US-03-R11: a deleted L1 evidence row of the previous slot is reported, and a previous slot that has none from before this feature is not', async () => {
  const db = kdb();
  const t1 = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS, now: T0 });
  db.raw.prepare(`DELETE FROM kernel_l1_step_evidence WHERE tick_id = ? AND step = 'dispatch'`).run(t1.tickId);
  const t2 = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS, now: T0 + 600e3 });
  assert.match(one(db, `SELECT title FROM items WHERE id = ?`, `L2MISSING-${t1.tickId}`).title, /: dispatch$/);
  db.raw.prepare(`DELETE FROM kernel_l1_step_evidence WHERE tick_id = ?`).run(t2.tickId);   // a tick written before L1 evidence existed has no L1 rows at all
  await runTick(db, { config, extraSteps: L2_EXTRA_STEPS, now: T0 + 1200e3 });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id = ?`, `L2MISSING-${t2.tickId}`).n, 0);
});

test('US-03-R11: a database that has not applied the L1 evidence migration yet still ticks cleanly and says so in the report, once per tick', async () => {
  const db = kdb();
  db.raw.exec('DROP VIEW kernel_v_step_evidence; DROP TABLE kernel_l1_step_evidence');
  const r = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS, now: T0 });
  assert.deepEqual(r.errors, []); assert.equal(r.completed, r.total);
  assert.equal((r.report.match(/kernel_l1_step_evidence is missing/g) || []).length, 1);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_step_evidence WHERE tick_id = ?`, r.tickId).n, L2_STEP_NAMES.length, 'the L2 evidence is written as before');
  const r2 = await runTick(db, { config, extraSteps: L2_EXTRA_STEPS, now: T0 + 600e3 });
  assert.deepEqual(r2.errors, []);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'L2MISSING-%'`).n, 0, 'a missing table is not a slot that lost its evidence');
});
