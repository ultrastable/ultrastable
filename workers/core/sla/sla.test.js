// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-13: service-level policy (R07 to R10, T03), weekly audit, step budgets (R11, R12, T04), six-term F, monthly autonomy card (T05).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createSla, CARD_LIMITS, SYSTEMS_CARD_NAME as SYSTEMS } from './index.js';
import { createConsoleL3, LIMITS_MUST_MENTION } from '../console-l3/index.js';
import { evalProbe } from '../src/tick.js';

const MIG = [fileURLToPath(new URL('./migrations/', import.meta.url)), fileURLToPath(new URL('../console-l3/migrations/', import.meta.url))];
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
const D = 86400e3; const H = 3600e3;
const stamp = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const mk = (config = {}) => { const db = makeDb(MIG); const t = { v: T0 }; const now = () => t.v; return { db, t, sla: createSla({ db, now, config }), l3: createConsoleL3({ db, now }) }; };
const item = (db, id, { created = T0, status = 'open', priority = 10, owner = 'staff', blocker = null } = {}) =>
  db.raw.prepare(`INSERT INTO items (id,title,owner_role,done_check,status,priority,created_at,updated_at,blocker,disposition) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, id, owner, 'x', status, priority, stamp(created), stamp(created), blocker, status === 'done' ? 'done with evidence' : null);
const row = (db, id) => db.raw.prepare(`SELECT * FROM sla_rows WHERE item_id=?`).get(id);
const get = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

test('US-13-R07: every open row gets a severity and a due date no later than open date plus the time for its severity', async () => {
  const { db, sla } = mk({ accelerate: false });
  item(db, 'A'); item(db, 'B'); item(db, 'C'); item(db, 'Z', { status: 'done' });
  await sla.classify('A', { severity: 'SEV1' }); await sla.classify('B', { severity: 'SEV2', due_at: T0 + 10 * D });
  const r = await sla.recompute();
  assert.equal(r.rows, 3); assert.equal(r.added, 1); assert.equal(r.tightened, 1);
  assert.equal(row(db, 'A').due_at, stamp(T0 + 24 * H));
  assert.equal(row(db, 'B').due_at, stamp(T0 + 72 * H));
  assert.equal(row(db, 'C').severity, 'SEV3'); assert.equal(row(db, 'C').due_at, stamp(T0 + 7 * D));
  assert.equal(row(db, 'Z'), undefined);
  assert.deepEqual((await sla.classify('A', { severity: 'SEV9' })).ok, false);
  assert.deepEqual(await sla.recompute(), { rows: 3, added: 0, tightened: 0, capped: 0, accelerated: 0, raised: 0, notified: 0 });
});

test('US-13-T03 and R08: an open SEV3 row due in 30 days is set to now plus the SEV3 cap; the three exemptions keep their date', async () => {
  const { db, t, sla } = mk();
  for (const id of ['A', 'CAL', 'EXT', 'DRAIN', 'OLD4']) item(db, id);
  await sla.classify('A', { severity: 'SEV3', due_at: T0 + 30 * D });
  await sla.classify('CAL', { due_at: T0 + 40 * D, exempt: 'calendar', exempt_reason: 'annual filing date' });
  await sla.classify('EXT', { due_at: T0 + 50 * D, exempt: 'external_event', exempt_reason: 'waits for the provider release' });
  assert.equal((await sla.classify('DRAIN', { due_at: T0 + 20 * D, exempt: 'rate_limited_drain', exempt_reason: 'slow' })).ok, false);
  await sla.classify('DRAIN', { due_at: T0 + 20 * D, exempt: 'rate_limited_drain', exempt_reason: '329 records at about 18 per day' });
  assert.equal((await sla.classify('A', { exempt: 'because' })).ok, false);
  assert.equal((await sla.classify('A', { exempt: 'calendar' })).ok, false);
  await sla.recompute();
  assert.equal(row(db, 'A').due_at, stamp(T0 + 7 * D));
  assert.equal(row(db, 'CAL').due_at, stamp(T0 + 40 * D));
  assert.equal(row(db, 'EXT').due_at, stamp(T0 + 50 * D));
  assert.equal(row(db, 'DRAIN').due_at, stamp(T0 + 20 * D));
  const far = get(db, `SELECT COUNT(*) AS n FROM sla_rows WHERE exempt IS NULL AND due_at > ?`, stamp(T0 + 14 * D)).n;
  assert.equal(far, 0);
  // the hard cap itself: a row whose stored due date is beyond 14 days (policy widened earlier) is pulled to the SEV3 cap
  const wide = mk({ severity_hours: { SEV1: 24, SEV2: 72, SEV3: 168, SEV4: 24 * 40 }, accelerate: false });
  item(wide.db, 'W'); await wide.sla.classify('W', { severity: 'SEV4' });
  assert.equal((await wide.sla.recompute()).capped, 1);
  assert.equal(row(wide.db, 'W').due_at, stamp(T0 + 7 * D));
  // acceleration: an agent-owned SEV4 row beyond the SEV3 limit is pulled to it; a row owned by the person is not
  item(db, 'S4'); item(db, 'MINE', { owner: 'owner' });
  await sla.classify('S4', { severity: 'SEV4' }); await sla.classify('MINE', { severity: 'SEV4' });
  assert.equal((await sla.recompute()).accelerated, 1);
  assert.equal(row(db, 'S4').due_at, stamp(T0 + 7 * D)); assert.equal(row(db, 'MINE').due_at, stamp(T0 + 14 * D));
  t.v += D; await sla.recompute();
  assert.equal(row(db, 'S4').due_at, stamp(T0 + 7 * D), 'a due date never slides later');
});

test('US-13-R17 and US-13-R09: a row past due is raised one priority level and the manager notified, once per missed date', async () => {
  const { db, t, sla } = mk();
  item(db, 'A', { priority: 10 }); item(db, 'TOP', { priority: 0 });
  await sla.classify('A', { severity: 'SEV1' }); await sla.classify('TOP', { severity: 'SEV1' });
  await sla.recompute();
  assert.equal(get(db, `SELECT priority FROM items WHERE id='A'`).priority, 10);
  t.v += 25 * H;
  const r = await sla.recompute();
  assert.equal(r.raised, 2); assert.equal(r.notified, 2);
  assert.equal(get(db, `SELECT priority FROM items WHERE id='A'`).priority, 9);
  assert.equal(get(db, `SELECT priority FROM items WHERE id='TOP'`).priority, 0);
  const n = get(db, `SELECT role, text FROM sla_notices WHERE item_id='A'`);
  assert.equal(n.role, 'portfolio-manager'); assert.match(n.text, /SEV1.*priority raised/);
  t.v += H; assert.equal((await sla.recompute()).raised, 0);
  assert.equal(get(db, `SELECT priority FROM items WHERE id='A'`).priority, 9);
  assert.equal((await sla.summary()).past_due, 2);
});

test('US-13-R10: the count of items that wait on a person is a metric with target zero; a breach files one item whose probe closes it', async () => {
  const { db, sla } = mk();
  assert.deepEqual((await sla.waitingOnPerson()).breach, false);
  db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G1','Approve','money','zero','manual')`);
  item(db, 'HELD', { status: 'blocked', blocker: 'Out of scope by default' });
  item(db, 'PARKED', { status: 'blocked', blocker: 'waiting on probe: env:X (absent)' });
  const w = await sla.waitingOnPerson(); await sla.waitingOnPerson();
  assert.equal(w.value, 2); assert.equal(w.target, 0); assert.equal(w.breach, true);
  const it = get(db, `SELECT * FROM items WHERE id='SLA-WAITING-ON-A-PERSON'`);
  assert.ok(it); assert.equal(get(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'SLA-WAITING%'`).n, 1);
  assert.equal((await evalProbe(db, {}, it)).ok, false);
  db.raw.exec(`UPDATE gate_cards SET status='closed'; UPDATE items SET status='done', disposition='enabled' WHERE id='HELD'`);
  assert.equal((await evalProbe(db, {}, it)).ok, true);
  assert.deepEqual(db.raw.prepare(`SELECT value, target FROM sla_metrics ORDER BY id`).all().map(r => [r.value, r.target]), [[0, 0], [2, 0], [2, 0]]);
});

test('US-13-R18: weekly audit: an open row with neither a due date nor an executor fails and gets one item; the audit is stored', async () => {
  const { db, sla } = mk();
  db.raw.exec(`INSERT INTO roles (id, role, model) VALUES ('ops-1', 'operations', 'small')`);
  item(db, 'HAS-ROLE', { owner: 'operations' }); item(db, 'ORPHAN', { owner: 'nobody' }); item(db, 'DATED', { owner: 'nobody' });
  await sla.classify('DATED', { severity: 'SEV2' });
  const a = await sla.weeklyAudit();
  assert.equal(a.checked, 3); assert.equal(a.failing, 1);
  assert.deepEqual(a.findings.find(f => f.item_id === 'ORPHAN'), { item_id: 'ORPHAN', problem: 'no due date and no executor' });
  assert.equal(a.findings.find(f => f.item_id === 'DATED').problem, 'no executor for its owner role');
  assert.ok(get(db, `SELECT id FROM items WHERE id='SLA-AUDIT-ORPHAN'`));
  assert.equal(get(db, `SELECT failing FROM sla_audits`).failing, 1);
});

test('US-13-T04 and R11: step runs are timed from the table; 5 h of a 4 h budget files an item, 9 h exactly one blocking question', async () => {
  const { db, t, sla, l3 } = mk();
  assert.equal((await sla.startStep({ process: 'change', step: 'review' })).ok, false);
  await sla.defineProcess({ process: 'change', done_check: 'merged and probed', steps: [{ step: 'review', budget_hours: 4, paths: ['reviewer agent', 'second model'] }, { step: 'deploy', budget_hours: 1, paths: ['canary', 'direct with revert'] }] });
  const s = await sla.startStep({ process: 'change', step: 'review', ref: 'ITEM-1' });
  const d = await sla.startStep({ process: 'change', step: 'deploy' }); await sla.finishStep(d.id);
  t.v += 5 * H;
  assert.deepEqual((await sla.step({}, { l3 })).step_budget, [{ key: 'CHANGE-REVIEW', kind: 'item' }]);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM gate_cards`).n, 0);
  t.v += 4 * H;
  await sla.step({}, { l3 }); await sla.step({}, { l3 });
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM gate_cards WHERE id='stepq-change-review'`).n, 1);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM items WHERE id='STEPBUDGET-CHANGE-REVIEW'`).n, 1);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'STEPBUDGET-CHANGE-DEPLOY%'`).n, 0, 'a finished step is not a breach');
  await sla.finishStep(s.id);
  assert.deepEqual(await sla.stepRuns(), []);
});

test('US-13-R12: a process defines its done check once; a step with one path is a gap and is filed once', async () => {
  const { db, sla } = mk();
  assert.equal((await sla.defineProcess({ process: 'p', steps: [{ step: 'a', budget_hours: 1 }] })).ok, false);
  await sla.defineProcess({ process: 'publish', done_check: 'page live and probed', steps: [{ step: 'build', budget_hours: 1, paths: ['ci', 'ci'] }, { step: 'ship', budget_hours: 1, paths: ['primary', 'workaround'] }] });
  assert.deepEqual(await sla.processGaps(), [{ process: 'publish', step: 'build', paths: 2 }]);
  await sla.processGaps();
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'SLA-PATHGAP-%'`).n, 1);
});

test('US-13-R20: six-term F: computed from tables with the weights in effect, stored with the triad, marked uncalibrated; unmeasured terms are named', async () => {
  const { db, t, sla } = mk({ weights: { loop_closure_rate: 10, drift_count: 2, human_interventions: 1, cost_overrun: 1, integration_gap: 1, throughput: 0.5 } });
  db.raw.exec(`INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES ('${stamp(T0 - H)}','${stamp(T0 - H)}',8,8),('${stamp(T0 - 2 * H)}','${stamp(T0 - 2 * H)}',8,8),('${stamp(T0 - 3 * H)}',NULL,3,8),('${stamp(T0 - 4 * H)}','${stamp(T0 - 4 * H)}',8,8);
    INSERT INTO console_actions (kind, ref, at) VALUES ('card_done','G0','${stamp(T0 - H)}'),('ask','ASK-1','${stamp(T0 - H)}');
    INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G1','Approve','money','zero','manual')`);
  item(db, 'D1', { status: 'done' }); item(db, 'D2', { status: 'done' }); item(db, 'OLD', { status: 'done', created: T0 - 90 * D });
  const o = await sla.objective({ drift_count: 3 });
  assert.equal(o.terms.loop_closure_rate.value, 0.75); assert.equal(o.terms.human_interventions.value, 1); assert.equal(o.terms.throughput.value, 2);
  assert.equal(o.f, 10 * 0.75 - 2 * 3 - 1 * 1 - 0 - 0 + 0.5 * 2);
  assert.deepEqual(o.unmeasured, ['cost_overrun', 'integration_gap']); assert.equal(o.calibrated, false);
  assert.deepEqual(o.triad, { human_gated: 1, drift: 3, self_healing: true }); assert.equal(o.good, null);
  db.raw.exec(`UPDATE gate_cards SET status='closed'`); t.v += H;
  const o2 = await sla.objective({ drift_count: 0 });
  assert.equal(o2.good, 1); assert.deepEqual(o2.triad, { human_gated: 0, drift: 0, self_healing: true });
  db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G2','Sign','identity','unsigned','manual')`);
  assert.equal((await sla.objective({ drift_count: 0 })).good, 0);
  const stored = get(db, `SELECT f, calibrated, weights FROM sla_objective ORDER BY id LIMIT 1`);
  assert.equal(stored.f, o.f); assert.equal(stored.calibrated, 0); assert.equal(JSON.parse(stored.weights).loop_closure_rate, 10);
});

const seedMonth = db => {
  for (let i = 0; i < 10; i++) db.raw.prepare(`INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES (?,?,?,8)`).run(stamp(T0 - (i + 1) * H), stamp(T0 - (i + 1) * H), i < 8 ? 8 : 5);
  db.raw.exec(`INSERT INTO outcomes (item_id,surface,action_class,result,at) VALUES ('A','s','merge','verified','${stamp(T0 - H)}'),('A','s','merge','verified','${stamp(T0 - H)}'),('A','s','merge','failed','${stamp(T0 - H)}'),('A','s','merge','verified','${stamp(T0 - H)}');
    INSERT INTO predictions (id,item_id,metric,op,target,due_at,verdict) VALUES ('P1','A','m','>=',1,'${stamp(T0 - D)}','hit'),('P2','A','m','>=',1,'${stamp(T0 - D)}','hit');
    INSERT INTO trust_ledger (surface,action_class,rung,reliability,outcomes,updated_at) VALUES ('s','merge','delegated',0.8,4,'${stamp(T0)}')`);
};

test('US-13-R19: monthly autonomy card: ten dimensions scored 0 to 5 from tables, each with evidence, confidence and status; limits stated; three largest gaps filed', async () => {
  const { db, sla, l3 } = mk();
  seedMonth(db); item(db, 'A'); item(db, 'DONE', { status: 'done' });
  assert.match(CARD_LIMITS, LIMITS_MUST_MENTION);
  const c = await sla.recomputeAutonomyCard({ l3 });
  assert.equal(c.ok, true); assert.equal(c.dimensions.length, 10);
  const by = Object.fromEntries(c.dimensions.map(d => [d.dimension, d]));
  assert.equal(by.check_completion.score, 4); assert.match(by.check_completion.evidence, /tick_runs: 8 of 10/); assert.equal(by.check_completion.confidence, 'medium');
  assert.equal(by.verified_outcomes.score, 3.8); assert.equal(by.verified_outcomes.confidence, 'low');
  assert.equal(by.prediction_accuracy.score, 5); assert.match(by.prediction_accuracy.status, /^gap: a top score is not accepted/);
  assert.equal(by.dispatch_success.score, 0); assert.match(by.dispatch_success.status, /^unmeasured/);
  assert.equal(by.earned_trust.score, 1.7);
  for (const d of c.dimensions) { assert.ok(d.score >= 0 && d.score <= 5); assert.ok(d.evidence && d.confidence && d.status); }
  const card = await l3.reportCard('autonomy');
  assert.equal(card.scores.length, 10); assert.match(card.limits, /grades itself/);
  assert.equal(Math.round(card.overall * 100) / 100, c.overall);
  assert.equal(c.kaizen.length, 3);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'KAIZEN-AUTONOMY-%-2026-11'`).n, 3);
  assert.equal((await sla.recomputeAutonomyCard({})).ok, false);
});

test('US-13-T05 and R05: a dimension that falls 0.6 on the recomputed card with no cause becomes a work item; a stated cause does not', async () => {
  const { db, t, sla, l3 } = mk();
  seedMonth(db); item(db, 'A');
  await sla.recomputeAutonomyCard({ l3 });
  t.v += 30 * D;
  for (let i = 0; i < 10; i++) db.raw.prepare(`INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES (?,?,?,8)`).run(stamp(t.v - (i + 1) * H), stamp(t.v - (i + 1) * H), i < 6 ? 8 : 5);
  const c = await sla.recomputeAutonomyCard({ l3, causes: { verified_outcomes: 'no outcomes were recorded this month: the window is empty' } });
  assert.ok(c.fell.includes('L3-DROP-AUTONOMY-CHECK-COMPLETION'));
  assert.ok(!c.fell.includes('L3-DROP-AUTONOMY-VERIFIED-OUTCOMES'));
  assert.ok(get(db, `SELECT id FROM items WHERE id='L3-DROP-AUTONOMY-CHECK-COMPLETION'`));
});

test('step(): recompute runs every tick, the audit weekly and the card monthly, by dated register rows', async () => {
  const { db, t, sla, l3 } = mk();
  seedMonth(db); item(db, 'A');
  const ctx = { notes: [] };
  const first = await sla.step(ctx, { l3 });
  assert.ok(first.audit && first.card && first.objective); assert.match(ctx.notes[0], /^sla: 1 open rows/);
  t.v += D;
  const next = await sla.step(ctx, { l3 });
  assert.ok(!next.audit && !next.card); assert.equal(next.waiting.value, 0);
  t.v += 6 * D + H;
  assert.ok((await sla.step(ctx, { l3 })).audit);
  t.v += 24 * D;
  assert.ok((await sla.step(ctx, { l3 })).card);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM l3_cards WHERE name='autonomy'`).n, 2); // the systems card is recorded beside it each month
  assert.equal(get(db, `SELECT next_due_at FROM sla_register WHERE name='autonomy_card'`).next_due_at, stamp(t.v + 30 * D));
  assert.ok((await sla.step({}, {})).sla, 'runs without the report-card writer');
});

test('US-00-R07: the service-level numbers are defaults; other values may be set, and the values in effect are recorded in configuration', async () => {
  const d = mk(); const c = mk({ severity_hours: { SEV1: 4, SEV2: 24, SEV3: 72, SEV4: 168 }, hard_cap_days: 7 });
  assert.deepEqual(d.sla.config.severity_hours, { SEV1: 24, SEV2: 72, SEV3: 168, SEV4: 336 }); assert.equal(d.sla.config.hard_cap_days, 14);
  assert.equal(c.sla.config.severity_hours.SEV1, 4); assert.equal(c.sla.config.hard_cap_days, 7);
  item(c.db, 'A'); await c.sla.classify('A', { severity: 'SEV1' }); await c.sla.recompute();
  assert.equal(row(c.db, 'A').due_at, stamp(T0 + 4 * H));
});

test('US-13-R05: an exact 0.5 fall between two monthly cards files an item', async () => {
  const { db, t, sla, l3 } = mk();
  seedMonth(db); item(db, 'A');
  await l3.recordCard({ name: 'autonomy', rubric: 'r', limits: CARD_LIMITS, scores: [{ dimension: 'check_completion', score: 2.3, evidence: 'tick_runs: 2 of 10', confidence: 'medium', status: 'measured' }] });
  await l3.recordCard({ name: 'autonomy', rubric: 'r', limits: CARD_LIMITS, scores: [{ dimension: 'check_completion', score: 1.8, evidence: 'tick_runs: 1.8 of 5', confidence: 'medium', status: 'measured' }] });
  assert.ok(get(db, `SELECT id FROM items WHERE id='L3-DROP-AUTONOMY-CHECK-COMPLETION'`));
  void t;
});

test('US-13-R16 and US-13-R10: a breach after the item was closed reopens it, once', async () => {
  const { db, sla } = mk();
  db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G1','Approve','money','zero','manual')`);
  await sla.waitingOnPerson();
  db.raw.exec(`UPDATE items SET status='done', disposition='card answered' WHERE id='SLA-WAITING-ON-A-PERSON'; UPDATE gate_cards SET status='closed'`);
  await sla.waitingOnPerson();                              // back at zero: nothing to file
  assert.equal(get(db, `SELECT status FROM items WHERE id='SLA-WAITING-ON-A-PERSON'`).status, 'done');
  db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G2','Sign','identity','unsigned','manual')`);
  await sla.waitingOnPerson(); await sla.waitingOnPerson();
  const it = get(db, `SELECT status, disposition FROM items WHERE id='SLA-WAITING-ON-A-PERSON'`);
  assert.equal(it.status, 'open'); assert.equal(it.disposition, null);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'SLA-WAITING%'`).n, 1);
});

test('US-13-R16: weekly audit and path gap items reopen when the finding recurs', async () => {
  const { db, sla } = mk();
  item(db, 'ORPHAN', { owner: 'nobody' });
  await sla.weeklyAudit();
  db.raw.exec(`UPDATE items SET status='done', disposition='x' WHERE id='SLA-AUDIT-ORPHAN'; DELETE FROM sla_rows WHERE item_id='ORPHAN'`);
  await sla.weeklyAudit();
  assert.equal(get(db, `SELECT status FROM items WHERE id='SLA-AUDIT-ORPHAN'`).status, 'open');
  await sla.defineProcess({ process: 'publish', done_check: 'live', steps: [{ step: 'build', budget_hours: 1, paths: ['ci'] }] });
  await sla.processGaps();
  db.raw.exec(`UPDATE items SET status='done', disposition='x' WHERE id='SLA-PATHGAP-PUBLISH-BUILD'`);
  await sla.processGaps();
  assert.equal(get(db, `SELECT status FROM items WHERE id='SLA-PATHGAP-PUBLISH-BUILD'`).status, 'open');
});

test('US-13-T06 and US-13-R16 and US-13-R11: a new over-budget run after the item and question were closed files an item and exactly one new question (through the service-level step)', async () => {
  const { db, t, sla, l3 } = mk();
  await sla.defineProcess({ process: 'change', done_check: 'merged', steps: [{ step: 'review', budget_hours: 4, paths: ['a', 'b'] }] });
  const s1 = await sla.startStep({ process: 'change', step: 'review' });
  t.v += 9 * H; await sla.step({}, { l3 });
  db.raw.exec(`UPDATE items SET status='done', disposition='x' WHERE id='STEPBUDGET-CHANGE-REVIEW'; UPDATE gate_cards SET status='closed'`);
  await sla.finishStep(s1.id);
  await sla.startStep({ process: 'change', step: 'review' });
  t.v += 9 * H; await sla.step({}, { l3 });
  assert.equal(get(db, `SELECT status FROM items WHERE id='STEPBUDGET-CHANGE-REVIEW'`).status, 'open');
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM gate_cards WHERE status='open'`).n, 1);
});

test('US-13-R17 and US-13-R09: a row at priority 0 is noticed once with the words "already at top priority"; the priority is not lowered below 0', async () => {
  const { db, t, sla } = mk();
  item(db, 'TOP', { priority: 0 }); await sla.classify('TOP', { severity: 'SEV1' });
  await sla.recompute(); t.v += 25 * H;
  const r = await sla.recompute();
  assert.equal(r.at_top, 1); assert.equal(get(db, `SELECT priority FROM items WHERE id='TOP'`).priority, 0);
  assert.match(get(db, `SELECT text FROM sla_notices WHERE item_id='TOP'`).text, /already at top priority/);
  t.v += H; await sla.recompute();
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM sla_notices WHERE item_id='TOP'`).n, 1);
});

// ---- calibration of the weights of F (R20) --------------------------------------------------------------------------------------
const seedObjectiveHistory = (db, n, { drive = 'throughput' } = {}) => {
  // The triad improves each cycle by the throughput of the cycle before; the other measured terms vary on their own and say nothing.
  let gated = 200; let k = 0;
  const ins = db.raw.prepare(`INSERT INTO sla_objective (at, f, terms, weights, calibrated, triad, good) VALUES (?,?,?,?,?,?,?)`);
  for (let i = 0; i < n; i++) {
    const thr = 1 + ((i * 7) % 5);                       // 1..5, not monotone
    const lcr = [0.2, 0.9, 0.5, 0.7, 0.3, 0.8, 0.4][i % 7];
    const hi = [3, 1, 4, 1, 5, 9, 2, 6][i % 8];
    const terms = { loop_closure_rate: { value: lcr, measured: true }, drift_count: { value: 0, measured: false }, human_interventions: { value: hi, measured: true },
      cost_overrun: { value: 0, measured: false }, integration_gap: { value: 0, measured: false }, throughput: { value: thr, measured: true } };
    ins.run(stamp(T0 + i * H), 0, JSON.stringify(terms), '{}', 0, JSON.stringify({ human_gated: gated, drift: 0, self_healing: true }), null);
    gated -= drive === 'throughput' ? thr : 0; k++;
  }
  return k;
};

test('US-13-R20: calibration: with twelve stored cycles the weights follow the term that moves the triad and a proposal is filed', async () => {
  const { db, sla, l3 } = mk();
  seedObjectiveHistory(db, 14);
  const r = await sla.calibrate({ l3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.rows_used, 14); assert.equal(r.fit.n, 13);
  const w = r.weights;
  assert.ok(w.throughput > 5 * (w.loop_closure_rate + w.human_interventions), `throughput ${w.throughput} vs the others ${w.loop_closure_rate} and ${w.human_interventions}`);
  assert.deepEqual([w.drift_count, w.cost_overrun, w.integration_gap], [1, 1, 1], 'unmeasured terms keep the weight in effect');
  assert.match(r.fit.kept.drift_count, /unmeasured/);
  assert.ok(r.fit.r2 > 0.9, `r2 ${r.fit.r2}`); assert.ok(r.fit.terms.throughput.t > 5);
  // the fitted weights keep the sum the fitted terms had (three terms at weight 1), so F stays on its scale
  assert.ok(Math.abs(w.loop_closure_rate + w.human_interventions + w.throughput - 3) < 1e-4);
  const stored = get(db, `SELECT * FROM sla_calibrations WHERE id=?`, r.id);
  assert.deepEqual(JSON.parse(stored.weights), w); assert.deepEqual(JSON.parse(stored.previous), sla.config.weights); assert.ok(stored.proposal_id);
  const prop = get(db, `SELECT text, status FROM l3_proposals WHERE id=?`, stored.proposal_id);
  assert.equal(prop.status, 'proposed'); assert.match(prop.text, new RegExp(`Calibration ${r.id}`)); assert.match(prop.text, /sla\.adopted_calibration/);
});

test('US-13-R06: calibration never writes the weights in effect; calibrated stays false until configuration adopts exactly the proposed weights', async () => {
  const { db, sla, l3 } = mk();
  seedObjectiveHistory(db, 14);
  const r = await sla.calibrate({ l3 });
  assert.deepEqual(sla.config.weights, { loop_closure_rate: 1, drift_count: 1, human_interventions: 1, cost_overrun: 1, integration_gap: 1, throughput: 1 });
  assert.equal((await sla.objective()).calibrated, false);
  // an operator adopts: the proposed weights and the calibration id go into configuration
  const adopted = createSla({ db, now: () => T0 + 20 * H, config: { weights: r.weights, adopted_calibration: r.id } });
  const o = await adopted.objective();
  assert.equal(o.calibrated, true); assert.deepEqual(o.weights, r.weights);
  assert.ok(get(db, `SELECT adopted_at FROM sla_calibrations WHERE id=?`, r.id).adopted_at);
  // the id with other weights is not an adoption
  const half = createSla({ db, now: () => T0 + 21 * H, config: { weights: { ...r.weights, throughput: r.weights.throughput + 0.5 }, adopted_calibration: r.id } });
  assert.equal((await half.objective()).calibrated, false);
  assert.equal((await createSla({ db, now: () => T0, config: { adopted_calibration: 999 } }).objective()).calibrated, false);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM l3_proposals WHERE status='adopted'`).n, 0);
});

test('US-13-R20: calibration refuses below the minimum history and says why; a term that predicts the wrong way gets weight 0 and is named', async () => {
  const { db, sla, l3 } = mk();
  seedObjectiveHistory(db, 5);
  const few = await sla.calibrate({ l3 });
  assert.equal(few.ok, false); assert.equal(few.refused, 'history'); assert.match(few.reason, /5 stored objective row\(s\); 12 are needed/);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM sla_calibrations`).n, 0);
  // history with no improvement anywhere: nothing predicts it, so the run is refused instead of inventing weights
  const flat = mk(); seedObjectiveHistory(flat.db, 14, { drive: 'none' });
  const r = await flat.sla.calibrate({ l3: flat.l3 });
  assert.equal(r.ok, false); assert.equal(r.refused, 'direction');
  // human_interventions rises exactly when the triad improves: it predicts improvement the wrong way for a term that should be low
  const wrong = mk(); wrong.db.raw.exec(`DELETE FROM sla_objective`);
  const ins = wrong.db.raw.prepare(`INSERT INTO sla_objective (at, f, terms, weights, calibrated, triad, good) VALUES (?,?,?,?,?,?,?)`);
  let g = 100;
  for (let i = 0; i < 14; i++) { const hi = 1 + (i * 3) % 5; const t = { loop_closure_rate: { value: 0.5 + (i % 3) * 0.1, measured: true }, human_interventions: { value: hi, measured: true }, throughput: { value: 2 + (i % 4), measured: true }, drift_count: { value: 0, measured: false }, cost_overrun: { value: 0, measured: false }, integration_gap: { value: 0, measured: false } };
    ins.run(stamp(T0 + i * H), 0, JSON.stringify(t), '{}', 0, JSON.stringify({ human_gated: g, drift: 0, self_healing: true }), null); g -= hi; }
  const w = await wrong.sla.calibrate({ l3: wrong.l3 });
  assert.equal(w.ok, true); assert.equal(w.weights.human_interventions, 0); assert.match(w.fit.terms.human_interventions.direction, /wrong direction/);
});

// ---- audit of report cards (R23) ------------------------------------------------------------------------------------------------
test('US-13-R23: card audit: a stored score that disagrees with the second path files one item; an honest card files none', async () => {
  const { db, sla, l3 } = mk();
  seedMonth(db); item(db, 'A'); item(db, 'DONE', { status: 'done' });
  await sla.recomputeAutonomyCard({ l3 });
  const clean = await sla.auditCard({});
  assert.equal(clean.ok, true); assert.deepEqual(clean.disagree, []); assert.equal(clean.dimensions, 10);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'AUDIT-CARD-%'`).n, 0);
  db.raw.exec(`UPDATE l3_scores SET score = 4.9 WHERE dimension = 'check_completion'`);
  const bad = await sla.auditCard({});
  assert.deepEqual(bad.disagree.map(d => [d.dimension, d.stored, d.second_path]), [['check_completion', 4.9, 4]]);
  assert.equal(get(db, `SELECT status FROM items WHERE id='AUDIT-CARD-AUTONOMY-CHECK-COMPLETION'`).status, 'open');
  await sla.auditCard({});                                                             // the same disagreement again: still one item
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'AUDIT-CARD-%'`).n, 1);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM sla_card_audits`).n, 3);
  assert.equal((await sla.auditCard({ name: 'nothing' })).ok, false);
});

test('US-13-R23: card audit: the second path agrees with the first on every dimension of the seeded month', async () => {
  const { db, sla, l3 } = mk();
  seedMonth(db); item(db, 'A'); item(db, 'DONE', { status: 'done' });
  const { secondPath } = await import('./card-audit.js');
  const second = await secondPath({ db, cfg: sla.config, asOf: T0 });
  for (const d of await sla.autonomyDimensions()) assert.equal(second[d.dimension].score, d.score, d.dimension);
  void l3;
});

test('US-13-R23: card audit: closures by a person role with no console action are the phantom class and are filed; the attestor port is called with the evidence', async () => {
  const { db, sla, l3 } = mk();
  seedMonth(db); item(db, 'A'); item(db, 'MINE', { status: 'done', owner: 'owner' }); item(db, 'TOUCHED', { status: 'done', owner: 'owner' });
  db.raw.exec(`INSERT INTO console_actions (kind, ref, at) VALUES ('card_done','TOUCHED','${stamp(T0)}')`);
  await sla.recomputeAutonomyCard({ l3 });
  const seen = [];
  const attestor = async ({ card, evidence }) => { seen.push({ card, n: evidence.length }); return { verdicts: evidence.map(e => ({ dimension: e.dimension, agree: e.dimension !== 'on_time', note: e.dimension === 'on_time' ? 'the due dates are not independent evidence' : '' })) }; };
  Object.defineProperty(attestor, 'name', { value: 'second-model' });
  const a = await sla.auditCard({ attestor });
  assert.deepEqual(a.phantom, ['MINE']);
  assert.ok(get(db, `SELECT id FROM items WHERE id='AUDIT-CARD-PHANTOM'`));
  assert.equal(seen[0].n, 10); assert.equal(seen[0].card.name, 'autonomy');
  assert.deepEqual(a.attested, { by: 'second-model', agree: false }); assert.equal(a.self_measured, false);
  assert.ok(get(db, `SELECT id FROM items WHERE id='AUDIT-CARD-ATTEST-AUTONOMY-ON-TIME'`));
  assert.equal(get(db, `SELECT agree FROM sla_card_audits ORDER BY id DESC LIMIT 1`).agree, 0);
  assert.equal((await l3.reportCard('autonomy')).attestation.state, 'attested with disagreement');
  // an attestor that throws is recorded as a failure to attest, not as an agreement
  const boom = async () => { throw new Error('the model was unreachable'); };
  const f = await sla.auditCard({ attestor: boom });
  assert.equal(f.attested.agree, false); assert.match(f.verdicts[0].error, /unreachable/);
});

test('US-13-R23: card audit: without an attestor the card says it is self-measured; with an agreeing attestor it says who attested', async () => {
  const { db, sla, l3 } = mk();
  seedMonth(db); item(db, 'A');
  await sla.recomputeAutonomyCard({ l3 });
  assert.equal((await l3.reportCard('autonomy')).attestation.state, 'self-measured, not independently attested');
  const r = await sla.auditCard({});
  assert.equal(r.self_measured, true); assert.equal(r.attested, null);
  assert.equal((await l3.reportCard('autonomy')).attestation.state, 'self-measured, not independently attested');
  const ok = async ({ evidence }) => ({ verdicts: evidence.map(e => ({ dimension: e.dimension, agree: true })) });
  Object.defineProperty(ok, 'name', { value: 'reviewer' });
  await sla.auditCard({ attestor: ok });
  const card = await l3.reportCard('autonomy');
  assert.equal(card.attestation.state, 'attested'); assert.equal(card.attestation.by, 'reviewer');
  const via = createSla({ db, now: () => T0, config: {} });
  assert.ok(via.auditCard);
});

test('US-13-R19 and US-13-R23: the monthly pass records the autonomy card, the systems card and an audit of the autonomy card; the audit finds nothing wrong', async () => {
  const { db, sla, l3 } = mk();
  seedMonth(db); item(db, 'A');
  const out = await sla.step({ notes: [] }, { l3 });
  assert.ok(out.card.ok && out.systems_card.ok); assert.equal(out.card_audit.disagree.length, 0);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM l3_cards WHERE name='systems'`).n, 1);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM sla_card_audits`).n, 1);
});

// ---- the systems report card (R22) ----------------------------------------------------------------------------------------------
test('US-13-R22: systems card: six rubric dimensions, each with evidence, confidence and status, recorded through the report-card writer', async () => {
  const { db, sla, l3 } = mk();
  seedMonth(db); item(db, 'A'); item(db, 'DONE', { status: 'done' });
  db.raw.exec(`INSERT INTO roles (id, role, model, last_tick_at) VALUES ('ops-1','operations','m','${stamp(T0 - H)}');
    INSERT INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES ('A','ops-1','${stamp(T0 - H)}','${stamp(T0 - H / 2)}');
    INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe,status) VALUES ('G1','x','y','z','manual','closed');
    INSERT INTO items (id,title,owner_role,kind,done_check,status,created_at,updated_at,disposition) VALUES ('L1','l','staff','ladder','x','done','${stamp(T0 - D)}','${stamp(T0 - D)}','done'),('L2','l','staff','ladder','x','open','${stamp(T0 - D)}','${stamp(T0 - D)}',NULL);`);
  await sla.classify('A', { severity: 'SEV3' }); await sla.recompute();
  const r = await sla.recomputeSystemsCard({ l3 });
  assert.equal(r.ok, true); assert.deepEqual(r.dimensions.map(d => d.dimension), ['levels_of_automation', 'organizational_viability', 'decision_cycle_closure', 'self_adaptive_loops', 'control_loop_automation', 'time_horizon']);
  const by = Object.fromEntries(r.dimensions.map(d => [d.dimension, d]));
  assert.match(by.levels_of_automation.evidence, /trust_ledger: 2 of 6 rungs climbed/); assert.equal(by.levels_of_automation.score, 1.7);
  assert.match(by.organizational_viability.evidence, /5 of 5 of the five functions/); assert.equal(by.organizational_viability.score, 5);
  assert.match(by.organizational_viability.status, /^gap: a top score is not accepted/);
  assert.match(by.self_adaptive_loops.evidence, /1 of 2 ladder and amendment items/); assert.equal(by.self_adaptive_loops.score, 2.5);
  assert.match(by.decision_cycle_closure.status, /inferred from receipt counts/); assert.notEqual(by.decision_cycle_closure.confidence, 'high');
  for (const d of r.dimensions) { assert.ok(d.score >= 0 && d.score <= 5); assert.ok(d.evidence && d.confidence && d.status); }
  const card = await l3.reportCard(SYSTEMS);
  assert.equal(card.scores.length, 6); assert.match(card.limits, /grades itself/); assert.match(card.limits, /designed for vehicles, people and organizations/);
});

test('US-13-R22: systems card: decision-cycle closure counts receipts; with no rows the dimension is unmeasured and scores 0, never an estimate', async () => {
  const { db, sla, l3 } = mk();
  const empty = await sla.recomputeSystemsCard({ l3 });
  for (const d of empty.dimensions) assert.match(d.status, /^unmeasured/, d.dimension);
  assert.ok(empty.dimensions.every(d => d.score === 0));
  seedMonth(db);                                              // 2 predictions scored, 4 outcomes
  const r = await sla.recomputeSystemsCard({ l3 });
  const c = r.dimensions.find(d => d.dimension === 'decision_cycle_closure');
  assert.match(c.evidence, /predictions, gate_cards, items: 2 of 2 loops closed/); assert.equal(c.score, 5);
  const th = r.dimensions.find(d => d.dimension === 'time_horizon');
  assert.match(th.evidence, /days of a year run since the first check \(no person has touched it\)/); assert.equal(th.score, 0);
});

test('US-13-R22: systems card: a fall of 0.5 with no cause files a work item through the same writer (R05)', async () => {
  const { db, t, sla, l3 } = mk();
  db.raw.exec(`INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES ('${stamp(T0 - 2 * D)}','${stamp(T0 - 2 * D)}',8,8)`);
  await sla.recomputeSystemsCard({ l3 });                                       // control_loop_automation 5 of 5
  t.v += 30 * D;
  db.raw.exec(`INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES ('${stamp(t.v - H)}',NULL,2,8)`);
  const r = await sla.recomputeSystemsCard({ l3 });
  assert.ok(r.fell.includes('L3-DROP-SYSTEMS-CONTROL-LOOP-AUTOMATION'), JSON.stringify(r.fell));
});

// ---- default processes, derived step runs and the bounded recompute (R11, R12) -----------------------------------------------------
test('US-13-R12: the default processes have a done check and at least two paths per step, so no path gap is filed', async () => {
  const { db, sla } = mk();
  const { DEFAULT_PROCESSES } = await import('./processes.js');
  for (const [p, def] of Object.entries(DEFAULT_PROCESSES)) { assert.ok(def.done_check, p); for (const s of def.steps) { assert.ok(new Set(s.paths).size >= 2, `${p}/${s.step}`); assert.ok(s.budget_hours > 0); } }
  await sla.step({}, {});
  assert.deepEqual(Object.keys(DEFAULT_PROCESSES).sort(), db.raw.prepare(`SELECT process FROM sla_processes ORDER BY process`).all().map(r => r.process).sort());
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'SLA-PATHGAP-%'`).n, 0);
  const before = get(db, `SELECT updated_at FROM sla_processes WHERE process='item'`).updated_at;
  await sla.step({}, {}); assert.equal(get(db, `SELECT updated_at FROM sla_processes WHERE process='item'`).updated_at, before, 'seeded once');
  const own = mk(); await own.sla.defineProcess({ process: 'mine', done_check: 'x', steps: [{ step: 's', budget_hours: 1, paths: ['a', 'b'] }] }); await own.sla.step({}, {});
  assert.equal(get(own.db, `SELECT COUNT(*) AS n FROM sla_processes`).n, 1, 'a defined process stops the seeding');
});

test('US-13-R11: a claim with no heartbeat for longer than the claim budget files one item with no hooks installed', async () => {
  const { db, t, sla, l3 } = mk();
  item(db, 'WORK', { status: 'claimed' });
  db.raw.exec(`INSERT INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES ('WORK','ops-1','${stamp(T0)}','${stamp(T0)}')`);
  await sla.step({}, { l3 });                                                            // seeds the default processes
  t.v += 1 * H; assert.deepEqual((await sla.step({}, { l3 })).step_budget, [], 'inside the 2 h claim budget');
  t.v += 2 * H;                                                                          // 3 h of silence against a 2 h budget
  assert.deepEqual((await sla.step({}, { l3 })).step_budget, [{ key: 'ITEM-CLAIM', kind: 'item' }]);
  assert.equal(get(db, `SELECT status FROM items WHERE id='STEPBUDGET-ITEM-CLAIM'`).status, 'open');
  db.raw.exec(`UPDATE claims SET heartbeat_at='${stamp(t.v)}'`);                           // a heartbeat ends the silence
  assert.deepEqual((await sla.stepRuns()), []);
});

test('derived runs and stored runs for one (process, step, ref) count once; an overdue prediction and a queued dispatch are derived', async () => {
  const { db, t, sla } = mk();
  await sla.step({}, {});
  db.raw.exec(`INSERT INTO predictions (id, item_id, metric, op, target, due_at) VALUES ('P1','A','m','>=',1,'${stamp(T0 - 10 * H)}');
    INSERT INTO dispatches (tick_id, role_id, item_id, model, status, at) VALUES (1,'r','A','m','queued','${stamp(T0 - 3 * H)}')`);
  const runs = await sla.stepRuns();
  assert.deepEqual(runs.map(r => [r.process, r.step, r.budget_hours]), [['dispatch', 'execute', 1], ['prediction', 'score', 6]]);
  await sla.defineProcess({ process: 'prediction', done_check: 'scored', steps: [{ step: 'score', budget_hours: 6, paths: ['a', 'b'] }] });
  await sla.startStep({ process: 'prediction', step: 'score', ref: 'P1' });                // the same (process, step, ref) stored beside the derived one
  const again = (await sla.stepRuns()).filter(r => r.process === 'prediction');
  assert.equal(again.length, 1); assert.equal(again[0].started_at, T0 - 10 * H, 'the earlier start wins');
  void t;
});

test('recompute rotates a backlog larger than max_rows_per_tick and visits every row within the rotation', async () => {
  const { db, sla } = mk({ max_rows_per_tick: 4 });
  for (let i = 0; i < 10; i++) item(db, `R${String(i).padStart(2, '0')}`);
  const a = await sla.recompute(); assert.equal(a.rows, 4); assert.deepEqual(a.rotating, { visited: 4, next_after: 'R03' });
  const b = await sla.recompute(); assert.equal(b.rows, 4); assert.equal(b.rotating.next_after, 'R07');
  const c = await sla.recompute(); assert.equal(c.rows, 4);                                 // R08, R09, then back to R00, R01
  assert.equal(c.rotating, undefined);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM sla_rows`).n, 10, 'every row has a due date after one rotation');
});

test('recompute with nothing new, changed or past due reads counts and no rows; a new item, a classification or a missed due date brings the full pass back', async () => {
  const { db, t, sla } = mk();
  for (const id of ['A', 'B', 'C']) item(db, id);
  await sla.recompute(); t.v += 5; // five milliseconds: the same second, rows are still "just changed"
  t.v += 2000;
  const reads = [];
  const spy = { ...db, prepare(sql) { reads.push(sql); return db.prepare(sql); } };
  const quiet = createSla({ db: spy, now: () => t.v, config: {} });
  const r = await quiet.recompute();
  assert.equal(r.skipped, 'nothing is new, changed or past due'); assert.equal(r.rows, 3);
  assert.ok(reads.length <= 4 && reads.every(q => /COUNT\(\*\)|sla_register/.test(q)), reads.join(' | '));
  item(db, 'NEW'); t.v += 1000; assert.equal((await sla.recompute()).rows, 4);
  t.v += 1000; await sla.classify('A', { severity: 'SEV1' }); assert.equal((await sla.recompute()).rows, 4);
  t.v += 8 * D; const late = await sla.recompute(); assert.equal(late.rows, 4); assert.equal(late.raised, 4, 'every row is now past its due date');
});

test('US-13-R18 and US-13-R19: a failed card or weekly audit leaves its register row due, so the next tick retries; a part after the card that throws files an item and the card is not recorded twice', async () => {
  const { db, t, sla, l3 } = mk();
  seedMonth(db); item(db, 'A');
  // the card writer throws once: step() throws, the dated row for the card is not advanced
  const real = l3.recordCard; let boom = true;
  const flaky = { ...l3, recordCard: async (...a) => { if (boom) { boom = false; throw new Error('write failed'); } return real(...a); } };
  await assert.rejects(() => sla.step({}, { l3: flaky }), /write failed/);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM sla_register WHERE name='autonomy_card'`).n, 0, 'the card is still due');
  t.v += H;
  const again = await sla.step({}, { l3: flaky });
  assert.ok(again.card?.ok, 'the next tick records the card'); assert.ok(get(db, `SELECT next_due_at FROM sla_register WHERE name='autonomy_card'`));
  const cards = get(db, `SELECT COUNT(*) AS n FROM l3_cards WHERE name='autonomy'`).n;
  // the audit of the card throws: an item is filed, the card's month stays spent and no second card is written
  const { db: db2, t: t2, sla: sla2, l3: l32 } = mk(); seedMonth(db2); item(db2, 'A');
  // the audit is internal to step(): break its table so it throws
  db2.raw.exec('DROP TABLE sla_card_audits');
  const r = await sla2.step({}, { l3: l32 });
  assert.equal(r.card_audit.ok, false);
  assert.equal(get(db2, `SELECT status FROM items WHERE id='SLA-CARD-AUDIT-FAILED'`).status, 'open');
  assert.ok(get(db2, `SELECT name FROM sla_register WHERE name='autonomy_card'`));
  t2.v += H; await sla2.step({}, { l3: l32 });
  assert.equal(get(db2, `SELECT COUNT(*) AS n FROM l3_cards WHERE name='autonomy'`).n, 1, 'one autonomy card in the month');
  assert.equal(cards, 1, 'the failed first attempt left no card, the retry wrote exactly one');
  // a throwing weekly audit leaves its row due
  const w = mk(); item(w.db, 'B');
  w.db.raw.exec('DROP TABLE sla_audits');
  await assert.rejects(() => w.sla.step({}, {}));
  assert.equal(get(w.db, `SELECT COUNT(*) AS n FROM sla_register WHERE name='weekly_audit'`).n, 0);
});
