// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from '../_shared/testdb.js';
import { runTick } from '../src/tick.js';
import { MIGRATIONS_DIR as KERNEL_DIR, CATALOG, reviewArtifact, recordReadback, registerMetric, readMetric, recordDecision, evaluateDecision, amendArtifact, decideChangeRequest, addRisk, advancePhase, checkGate, lifecycleGaps, gateExtraNames } from '../kernel/index.js';
import { OUT_OF_SCOPE } from '../src/console.js';
import {
  MIGRATIONS_DIR, selectMode, requiredArtifacts, cadence, checkForm, submitTailored, startProject, advance, recordDeliverable, runDeliverableProbe,
  startIteration, endIteration, recordRetrospective, setCommunicationPlan, produceStatusReport, refreshStatusReports, classifyScope, decidePack, requestWork, lifecycleStep,
  openClosing, archiveProject, archiveClosed, recordRiskReview, riskReviewDue, evaluateRisks, computeQuality, complianceReport, adoptOutcomes, draftArtifacts, lifecycleProbe, itemsLate, capacityVariance,
  reviewRisks, qualityMetrics, refreshMonitoring,
} from './index.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const NOW = Date.parse('2026-11-10T12:00:00Z'), HOUR = 3600e3, DAY = 24 * HOUR;
const ts = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const setup = () => { const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR]); db.raw.exec(`CREATE TABLE t_vals (k TEXT PRIMARY KEY, v REAL)`); return db; };
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a);
const item = (db, id, o = {}) => db.raw.prepare(`INSERT INTO items (id, title, owner_role, done_check, closing_probe, priority, status, project, disposition, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(id, id, 'staff', 'x', 'probe', o.priority ?? 50, o.status || 'ready', o.project ?? null, o.disposition ?? null, ts(o.at ?? NOW));

const CHARTER = { objective: 'a booking page that keeps working', definition_of_done: 'a visitor can book a slot', definition_of_done_probe: `SELECT COUNT(*) AS value FROM items WHERE status = 'done'`,
  primary_metric: 'bookings_per_week', guard_metrics: ['error_rate'], cap: '20 USD a month', authority_limits: 'reversible changes only', manager_role: 'project-manager' };
const CONTENT = {
  'A-INI-1': { want_verbatim: 'I want people to book me online', for_whom: 'my clients', first_outcomes: ['a booking page'], constraints: 'no card payments' },
  'A-INI-2': CHARTER, 'A-INI-6': { mode: 'set by the rule', reason: 'see lifecycle_mode_decisions' },
  'A-PLN-4': { items: ['B-1'], roadmap: [{ size: 'S', goal: 'book a slot', user: 'client', success_metric: 'bookings_per_week', closing_probe: 'SELECT 1 AS value' }] },
  'A-PLN-6': { capacity_per_role: { staff: 2 }, plus_share: 0.2, spend_cap: '20 USD a month' },
  'A-PLN-9': { what: 'the four-line report', period_h: 24, form: 'console' },
};
const contentFor = (mode, kind, id = 'P') => kind === 'A-PLN-1'
  ? { in_scope: 'a booking page', out_of_scope: 'card payments', requirements: [{ id: 'REQ-1', text: 'a visitor can book a slot', testable: true, items: [`${id}-W1`] }] }
  : CONTENT[kind] ?? (kind === 'A-PLN-5'
  ? { predictive: { milestones: [{ name: 'launch', date: '2026-12-01' }], dependencies: ['B-1 before B-2'] }, agile: { iteration_days: 7, forecast: '3 iterations' }, hybrid: { milestones: [{ name: 'launch', date: '2026-12-01' }], iteration_days: 7 } }[mode]
  : { note: `${kind} record` });
async function fill(db, project, phase, mode, { skip = [] } = {}) {
  for (const c of CATALOG.filter(c => c.phase === phase && !skip.includes(c.kind))) {
    await submitTailored(db, { project_id: project, kind: c.kind, path_or_ref: `docs/${project}/${c.kind}.md`, content: contentFor(mode, c.kind, project), produced_by: 'doer-1', produced_model: 'alpha-1', now: NOW });
    await reviewArtifact(db, { project_id: project, kind: c.kind, reviewer: 'reviewer-1', reviewer_model: 'beta-1', verdict: 'approved', evidence: 'read and checked' });
  }
}
// A project taken to executing, in the given mode.
async function executing(db, id, mode, base = NOW) {
  await startProject(db, { id, name: id, override: { mode, reason: 'test fixture', decided_by: 'portfolio-manager' }, now: base });
  await fill(db, id, 'initiating', mode);
  assert.equal((await advance(db, id, 'planning', { readiness: async () => ({ score: 0.9 }), now: NOW })).ok, true);
  await fill(db, id, 'planning', mode); await recordReadback(db, id, NOW); item(db, `${id}-W1`, { project: id });
  assert.equal((await advance(db, id, 'executing', { now: NOW })).ok, true);
}

test('US-15-R02: the selection rule gives predictive, agile, or hybrid as the default when the person cannot say', () => {
  assert.equal(selectMode({ requirements_stable: true, order_fixed_by_dependencies: true, external_acceptance_milestone: true }).mode, 'predictive');
  assert.equal(selectMode({ requirements_unclear: true, value_by_increments: true }).mode, 'agile');
  assert.equal(selectMode({ requirements_stable: true, order_fixed_by_dependencies: false, external_acceptance_milestone: true }).mode, 'hybrid');
  assert.deepEqual(selectMode({}), { mode: 'hybrid', reason: 'the person could not say: the default' });
  assert.deepEqual(selectMode(), { mode: 'hybrid', reason: 'the person could not say: the default' });
});

test('US-15-R01, US-15-R02: a project starts with the rule\'s mode and its reason; an override is a recorded decision', async () => {
  const db = setup();
  const a = await startProject(db, { id: 'A', name: 'a', answers: { requirements_unclear: true, value_by_increments: true }, now: NOW });
  assert.deepEqual([a.started, a.mode, a.overridden], [true, 'agile', false]);
  const kp = one(db, `SELECT delivery_mode, mode_reason, current_phase FROM kernel_projects WHERE id = 'A'`);
  assert.deepEqual([kp.delivery_mode, kp.current_phase], ['agile', 'initiating']); assert.match(kp.mode_reason, /working increments/);
  await assert.rejects(startProject(db, { id: 'B', name: 'b', answers: {}, override: { mode: 'predictive' } }), /recorded decision/);
  await assert.rejects(startProject(db, { id: 'B', name: 'b', override: { mode: 'waterfall', reason: 'r', decided_by: 'x' } }), /override mode/);
  const b = await startProject(db, { id: 'B', name: 'b', answers: {}, override: { mode: 'predictive', reason: 'a regulator fixes the date', decided_by: 'portfolio-manager' }, now: NOW });
  assert.deepEqual([b.mode, b.overridden], ['predictive', true]);
  const d = one(db, `SELECT * FROM lifecycle_mode_decisions WHERE project_id = 'B'`);
  assert.deepEqual([d.mode, d.rule_mode, d.overridden, d.decided_by], ['predictive', 'hybrid', 1, 'portfolio-manager']); assert.match(d.reason, /regulator fixes the date \(rule gave hybrid/);
});

test('US-15-R03, US-15-R13: every catalog artifact is required in every mode; the mode changes only weight and form', async () => {
  for (const mode of ['predictive', 'agile', 'hybrid']) {
    const req = requiredArtifacts(mode).map(a => a.kind);
    for (const c of CATALOG) assert.ok(req.includes(c.kind), `${mode} omits ${c.kind}`);
    assert.equal(req.includes('A-EXE-4'), mode !== 'predictive');
  }
  assert.equal(cadence('agile').iterations, true); assert.equal(cadence('predictive').iterations, false);
  assert.deepEqual(checkForm('agile', 'A-PLN-5', { iteration_days: 7, forecast: '3 iterations' }), { ok: true, missing: [], problems: [], weight: 'light' });
  assert.deepEqual(checkForm('predictive', 'A-PLN-5', { iteration_days: 7, forecast: '3 iterations' }).missing, ['milestones', 'dependencies']);
  assert.deepEqual(checkForm('hybrid', 'A-PLN-5', { milestones: [{ name: 'm' }] }).missing, ['iteration_days']);
  // a one-page charter is lighter, never shorter on fields; and its definition of done must be a runnable probe
  const { cap, ...noCap } = CHARTER;
  assert.deepEqual(checkForm('agile', 'A-INI-2', noCap).missing, ['cap']);
  assert.match(checkForm('agile', 'A-INI-2', { ...CHARTER, definition_of_done_probe: 'it works when I look at it' }).problems[0], /not a runnable probe/);
  assert.match(checkForm('agile', 'A-PLN-4', { items: ['x'], roadmap: Array(6).fill(CONTENT['A-PLN-4'].roadmap[0]) }).problems[0], /more than five/);
  assert.match(checkForm('agile', 'A-PLN-4', { items: ['x'], roadmap: [{ size: 'S' }] }).problems[0], /lacks goal, user, success_metric, closing_probe/);
  assert.match(checkForm('agile', 'A-PLN-8', {}).problems[0], /no content/);                  // phase theater: an empty artifact
});

test('US-15-R10, US-15-R05: a communication plan whose period is not a positive number of hours fails its form check and is stored as failing, with no plan set and no thrown error', async () => {
  for (const period_h of ['weekly', 0, -4, true, '', null, NaN]) assert.equal(checkForm('hybrid', 'A-PLN-9', { what: 'x', period_h, form: 'f' }).ok, false, `period_h ${String(period_h)} fails`);
  assert.match(checkForm('hybrid', 'A-PLN-9', { what: 'x', period_h: 'weekly', form: 'f' }).problems[0], /positive number of hours/);
  assert.equal(checkForm('hybrid', 'A-PLN-9', { what: 'x', period_h: 24, form: 'f' }).ok, true);
  assert.equal(checkForm('hybrid', 'A-PLN-9', { what: 'x', period_h: '48', form: 'f' }).ok, true);
  const db = setup(); await startProject(db, { id: 'CP', name: 'cp', now: NOW });
  const f = await submitTailored(db, { project_id: 'CP', kind: 'A-PLN-9', path_or_ref: 'docs/CP/plan.md', content: { what: 'x', period_h: 'weekly', form: 'f' }, produced_by: 'doer-1', now: NOW });
  assert.equal(f.ok, false);
  assert.equal(one(db, `SELECT done_check_passed AS p FROM artifacts WHERE project_id = 'CP' AND kind = 'A-PLN-9'`).p, 0, 'the artifact does not pass its done check');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM lifecycle_comm_plans WHERE project_id = 'CP'`).n, 0);
  await submitTailored(db, { project_id: 'CP', kind: 'A-PLN-9', path_or_ref: 'docs/CP/plan.md', content: { what: 'x', period_h: 24, form: 'f' }, produced_by: 'doer-1', now: NOW });
  assert.equal(one(db, `SELECT period_h AS p FROM lifecycle_comm_plans WHERE project_id = 'CP'`).p, 24);
});

test('US-15-R13, T15-1: an agile project cannot enter Executing while a planning artifact is missing or empty; the attempt files items, not an error', async () => {
  const db = setup();
  await startProject(db, { id: 'AG', name: 'ag', answers: { requirements_unclear: true, value_by_increments: true }, now: NOW });
  await fill(db, 'AG', 'initiating', 'agile');
  assert.equal((await advance(db, 'AG', 'planning', { readiness: async () => 0.8, now: NOW })).ok, true);
  await fill(db, 'AG', 'planning', 'agile', { skip: ['A-PLN-5', 'A-PLN-8'] });
  await submitTailored(db, { project_id: 'AG', kind: 'A-PLN-8', path_or_ref: 'docs/AG/quality.md', content: {}, produced_by: 'doer-1', now: NOW });   // exists, but empty
  await reviewArtifact(db, { project_id: 'AG', kind: 'A-PLN-8', reviewer: 'reviewer-1', verdict: 'approved' });
  await recordReadback(db, 'AG', NOW); item(db, 'AG-W1', { project: 'AG' });
  const r = await advance(db, 'AG', 'executing', { now: NOW });
  assert.equal(r.ok, false);
  assert.deepEqual(r.filed.sort(), ['GATE-AG-A-PLN-5', 'GATE-AG-A-PLN-8-check']);
  assert.equal(one(db, `SELECT current_phase FROM kernel_projects WHERE id = 'AG'`).current_phase, 'planning');
  // the light form of the schedule is accepted for an agile project
  await fill(db, 'AG', 'planning', 'agile');
  assert.equal(one(db, `SELECT period_h FROM lifecycle_comm_plans WHERE project_id = 'AG'`).period_h, 24);   // the communication plan sets the report period
  assert.deepEqual(await advance(db, 'AG', 'executing', { now: NOW }), { ok: true, phase: 'executing' });
});

test('G1 (US-15-R04): the charter\'s definition of done must be a runnable probe and the readiness score must reach the threshold; unreadable is not a pass', async () => {
  const db = setup();
  await startProject(db, { id: 'P', name: 'p', now: NOW });
  await fill(db, 'P', 'initiating', 'hybrid');
  const none = await advance(db, 'P', 'planning', { now: NOW });                             // no readiness port
  assert.deepEqual([none.ok, none.filed], [false, ['GATE-P-planning-readiness']]); assert.match(none.reasons[0], /could not be read/);
  assert.match((await advance(db, 'P', 'planning', { readiness: async () => ({ score: 0.4 }), now: NOW })).reasons[0], /0.40 is under the initiation threshold 0.6/);
  assert.match((await advance(db, 'P', 'planning', { readiness: async () => { throw new Error('down'); }, now: NOW })).reasons[0], /could not be read/);
  assert.equal(one(db, `SELECT current_phase FROM kernel_projects WHERE id = 'P'`).current_phase, 'initiating');
  assert.equal((await advance(db, 'P', 'planning', { readiness: async () => ({ score: 0.6 }), now: NOW })).ok, true);
  // T15-3 still holds through this layer: a charter change after G1 is a change request with a revert path
  const cr = await amendArtifact(db, { project_id: 'P', kind: 'A-INI-2', new_ref: 'docs/P/charter-v2.md', summary: 'raise the cap', revert_path: 'restore docs/P/A-INI-2.md', requested_by: 'project-manager', now: NOW });
  assert.equal(one(db, `SELECT revert_path FROM change_requests WHERE id = ?`, cr.change_request_id).revert_path, 'restore docs/P/A-INI-2.md');

  await startProject(db, { id: 'Q', name: 'q', now: NOW });
  for (const c of CATALOG.filter(c => c.phase === 'initiating')) {
    await submitTailored(db, { project_id: 'Q', kind: c.kind, path_or_ref: `docs/Q/${c.kind}.md`, content: c.kind === 'A-INI-2' ? { ...CHARTER, definition_of_done_probe: 'looks good' } : contentFor('hybrid', c.kind), produced_by: 'doer-1', now: NOW });
    await reviewArtifact(db, { project_id: 'Q', kind: c.kind, reviewer: 'reviewer-1', verdict: 'approved' });
  }
  const q = await advance(db, 'Q', 'planning', { readiness: async () => 1, now: NOW });
  assert.deepEqual(q.filed, ['GATE-Q-planning-charter-probe']);
  assert.equal(one(db, `SELECT owner_role FROM items WHERE id = 'GATE-Q-planning-charter-probe'`).owner_role, 'project-manager');
  assert.equal((await advance(db, 'Q', 'planning', { readiness: async () => 1, config: { require_readiness: false }, now: NOW })).ok, false);
});

test('US-15-R14: the portfolio manager does not start a project that would take capacity above the cap; closing a project frees it', async () => {
  const db = setup(); const cap = { config: { portfolio_cap: 10 } };
  assert.equal((await startProject(db, { id: 'A', name: 'a', capacity: 6, now: NOW }, cap)).started, true);
  const b = await startProject(db, { id: 'B', name: 'b', capacity: 5, now: NOW }, cap);
  assert.deepEqual([b.started, b.reason, b.item_id], [false, 'portfolio cap: 6 + 5 > 10', 'CAPACITY-B']);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_projects WHERE id = 'B'`).n, 0);
  assert.equal(one(db, `SELECT owner_role FROM items WHERE id = 'CAPACITY-B'`).owner_role, 'portfolio-manager');
  assert.equal((await startProject(db, { id: 'C', name: 'c', capacity: 4, now: NOW }, cap)).started, true);   // exactly at the cap
  db.raw.exec(`UPDATE kernel_projects SET current_phase = 'closed' WHERE id = 'A'`);
  assert.equal((await startProject(db, { id: 'B', name: 'b', capacity: 5, now: NOW }, cap)).started, true);
});

test('US-15-R09, T15-5: ending an iteration without a retrospective blocks the next; the retrospective files its improvements as plus items', async () => {
  const db = setup(); await executing(db, 'AG', 'agile');
  item(db, 'AG-W2', { project: 'AG' });
  const i1 = await startIteration(db, { project_id: 'AG', goal: 'a visitor can see free slots', items: ['AG-W1', 'AG-W2'], now: NOW });
  assert.deepEqual([i1.ok, i1.n], [true, 1]);
  assert.match((await startIteration(db, { project_id: 'AG', goal: 'next', now: NOW })).reason, /iteration 1 has not ended/);
  await assert.rejects(endIteration(db, i1.id, { items_done: ['AG-W1'], now: NOW }), /demonstration/);
  await assert.rejects(endIteration(db, i1.id, { items_done: ['OTHER'], demo_result: 'shown', now: NOW }), /not taken in this iteration/);
  await endIteration(db, i1.id, { items_done: ['AG-W1'], demo_result: 'shown to the proxy: slots list renders', now: NOW + 7 * DAY });
  const blocked = await startIteration(db, { project_id: 'AG', goal: 'next', now: NOW + 7 * DAY });
  assert.deepEqual([blocked.ok, blocked.reason, blocked.item_id], [false, 'iteration 1 has no retrospective', 'RETRO-AG-1']);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM lifecycle_iterations WHERE project_id = 'AG'`).n, 1);
  assert.equal(one(db, `SELECT owner_role FROM items WHERE id = 'RETRO-AG-1'`).owner_role, 'project-manager');
  await assert.rejects(recordRetrospective(db, i1.id, { outcome: 'went fine', improvements: [' '] }), /at least one improvement/);
  const retro = await recordRetrospective(db, i1.id, { outcome: 'review came late', improvements: ['review on the day the change lands', 'smaller items'], now: NOW + 7 * DAY });
  assert.deepEqual(retro.items, ['RETROPLUS-AG-1-1', 'RETROPLUS-AG-1-2']);
  const plus = one(db, `SELECT kind, owner_role, title FROM items WHERE id = 'RETROPLUS-AG-1-1'`);
  assert.deepEqual([plus.kind, plus.owner_role], ['plus', 'product-manager']); assert.match(plus.title, /review on the day/);
  assert.deepEqual([(await startIteration(db, { project_id: 'AG', goal: 'a visitor can book', now: NOW + 7 * DAY })).n], [2]);
  // a predictive project has no iterations; a project not yet executing cannot start one
  await executing(db, 'PR', 'predictive');
  await assert.rejects(startIteration(db, { project_id: 'PR', goal: 'g' }), /milestones, not iterations/);
  await startProject(db, { id: 'EARLY', name: 'e', now: NOW });
  await assert.rejects(startIteration(db, { project_id: 'EARLY', goal: 'g' }), /is in initiating/);
});

test('US-15-R08, T15-6: every deliverable has a closing probe run by a different agent; G3 fails on an unpassed probe, a missing retrospective or an item with no disposition', async () => {
  const db = setup(); await executing(db, 'AG', 'agile');
  await assert.rejects(recordDeliverable(db, { id: 'D1', project_id: 'AG', path_or_ref: 'site/book.js', produced_by: 'doer-1' }), /closing probe a different agent can run/);
  await assert.rejects(recordDeliverable(db, { id: 'D1', project_id: 'AG', path_or_ref: 'site/book.js', produced_by: 'doer-1', closing_probe: 'DELETE FROM items' }), /SELECT/);
  await assert.rejects(recordDeliverable(db, { id: 'D1', project_id: 'AG', path_or_ref: 'chat: I pasted it above', produced_by: 'doer-1', closing_probe: 'SELECT 1 AS value' }), /not chat/);
  await recordDeliverable(db, { id: 'D1', project_id: 'AG', path_or_ref: 'site/book.js', produced_by: 'doer-1', closing_probe: `SELECT v AS value FROM t_vals WHERE k = 'live'`, now: NOW });
  await assert.rejects(runDeliverableProbe(db, 'D1', { runner: 'doer-1', now: NOW }), /different agent/);
  assert.deepEqual(await runDeliverableProbe(db, 'D1', { runner: 'reviewer-1', now: NOW }), { id: 'D1', passed: false, evidence: 'value none' });
  const it = await startIteration(db, { project_id: 'AG', goal: 'g', items: ['AG-W1'], now: NOW }); await endIteration(db, it.id, { demo_result: 'shown', now: NOW });

  assert.equal((await advance(db, 'AG', 'closing', { now: NOW })).ok, true);                  // executing to closing has no gate
  await fill(db, 'AG', 'closing', 'agile');
  const g3 = await advance(db, 'AG', 'closed', { now: NOW });
  assert.equal(g3.ok, false); assert.deepEqual(g3.filed.sort(), ['GATE-AG-closed-deliverable-probes', 'GATE-AG-closed-retrospective']);
  db.raw.exec(`INSERT INTO t_vals VALUES ('live', 1)`);
  assert.equal((await runDeliverableProbe(db, 'D1', { runner: 'reviewer-1', now: NOW })).passed, true);
  await recordRetrospective(db, it.id, { outcome: 'ok', improvements: ['keep demos short'], now: NOW });
  const open = await advance(db, 'AG', 'closed', { now: NOW });                               // T15-6: AG-W1 and the retrospective's plus item have no disposition
  assert.equal(open.ok, false); assert.match(open.gate.reasons[0], /item\(s\) have no disposition/);
  db.raw.exec(`UPDATE items SET status = 'done', disposition = 'done' WHERE project = 'AG' AND id NOT LIKE 'GATE-%'`);
  assert.deepEqual(await advance(db, 'AG', 'closed', { now: NOW }), { ok: true, phase: 'closed' });
});

test('US-15-R10: the status report is four lines with metric values against targets and predicted versus actual, produced on the communication plan\'s period', async () => {
  // The kernel's trigger view reads the wall clock, so this test is placed around the present instead of a fixed date.
  const NOW = Date.now() - 26 * HOUR;
  const db = setup(); await executing(db, 'AG', 'agile', NOW);                               // its communication plan says every 24 h
  await registerMetric(db, { id: 'bookings', program_id: 'AG', op: '>=', target: 10, read_probe: `SELECT v AS value FROM t_vals WHERE k = 'b'` });
  await registerMetric(db, { id: 'errors', program_id: 'AG', kind: 'guard', op: '<=', target: 1, read_probe: `SELECT v AS value FROM t_vals WHERE k = 'e'` });
  db.raw.exec(`INSERT INTO t_vals VALUES ('b', 4), ('e', 0)`);
  await recordDecision(db, { id: 'D-1', program_id: 'AG', decision: 'add a reminder mail', authority: 'product-manager', prediction: 'bookings >= 10 within 24 h', revert_path: 'remove the mail', now: NOW });
  await recordDecision(db, { id: 'D-2', program_id: 'AG', decision: 'shorter form', authority: 'product-manager', prediction: 'bookings >= 5 within 12 h', revert_path: 'restore the form', now: NOW });
  db.raw.exec(`UPDATE t_vals SET v = 12 WHERE k = 'b'`);
  const t1 = NOW + 25 * HOUR;
  await evaluateDecision(db, 'D-1', { now: t1 }); await readMetric(db, 'errors', t1);
  item(db, 'AG-W2', { project: 'AG', status: 'done', disposition: 'done', at: NOW + HOUR }); item(db, 'AG-W3', { project: 'AG', status: 'blocked' });

  assert.deepEqual(await refreshStatusReports(db, { now: NOW + 23 * HOUR }), []);            // not due yet
  const ids = await refreshStatusReports(db, { now: t1 });
  assert.equal(ids.length, 1);
  const r = one(db, `SELECT * FROM lifecycle_status_reports WHERE id = ?`, ids[0]);
  const lines = r.text.split('\n');
  assert.deepEqual(lines.map(l => l.split(':')[0]), ['Happened', 'Decided', 'Next', 'Open']);
  assert.match(lines[0], /1 item\(s\) done/); assert.match(lines[2], /AG-W1/); assert.match(lines[3], /2 item\(s\), 1 blocked/);
  assert.match(lines[3], /bookings=12 \(>= 10: on_target\), errors=0 \(<= 1: on_target\)/);
  assert.deepEqual(JSON.parse(r.variance), [
    { id: 'D-1', predicted: 'bookings >= 10 within 24 h', actual: 12, verdict: 'kept' },
    { id: 'D-2', predicted: 'bookings >= 5 within 12 h', actual: null, verdict: 'late: not scored' }]);
  assert.match(lines[1], /2 decision\(s\) on record, 1 scored; 1 as predicted, 1 not/);
  assert.deepEqual(await refreshStatusReports(db, { now: t1 + HOUR }), []);                  // once per period
  // a stale reading is reported unmeasured, never as its old value
  const later = await produceStatusReport(db, { project_id: 'AG', now: t1 + 3 * DAY });
  assert.equal(later.metrics.find(m => m.id === 'bookings').state, 'unmeasured');
  // the tick produces it with nobody asking
  await setCommunicationPlan(db, 'AG', 1, NOW);
  const tick = await runTick(db, { config, now: t1 + 4 * DAY, extraSteps: [lifecycleStep()] });
  assert.deepEqual(tick.errors, []); assert.match(tick.report, /lifecycle: 1 status report\(s\)/);
});

test('US-15-R12, T15-4: an out-of-scope request creates a scope-gate entry with its answer and no item; nothing is dispatched until a recorded decision enables the pack', async () => {
  const db = setup();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('pm-1', 'project-manager', 1, 'm')`);
  assert.deepEqual(classifyScope('Add a booking form to the home page'), { in_scope: true });
  for (const [text, pack] of [['Write a business plan for the shop', 'business-plan'], ['Please file the trademark for our name', 'legal'], ['I need tax advice on this', 'advice'],
    ['Run our marketing on three channels', 'outreach'], ['Pay the contractor invoice today', 'payments'], ['Write a research paper on the results', 'research']]) assert.equal(classifyScope(text).pack, pack, text);

  const held = await requestWork(db, { id: 'REQ-1', text: 'Write a business plan for the shop', requested_by: 'the-person', now: NOW });
  assert.equal(held.accepted, false); assert.match(held.answer, /outside what Ultrastable does by default.*business-plan pack would cover it/);
  const e = one(db, `SELECT * FROM lifecycle_scope_gate WHERE id = ?`, held.scope_gate_id);
  assert.deepEqual([e.status, e.pack, e.rule, e.item_id, e.requested_by], ['held', 'business-plan', 'business-plan', null, 'the-person']);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items`).n, 0);
  await runTick(db, { config, now: NOW });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM dispatches WHERE item_id IS NOT NULL`).n, 0);  // T15-4: no item is dispatched

  const ok = await requestWork(db, { id: 'REQ-2', text: 'Add a booking form to the home page', now: NOW });
  assert.deepEqual(ok, { accepted: true, item_id: 'REQ-2', pack: null });
  assert.equal((await requestWork(db, { id: 'REQ-3', text: 'Draft the newsletter', pack: 'outreach', now: NOW })).accepted, false);   // tagged by an upstream classifier

  await assert.rejects(decidePack(db, { pack: 'business-plan', enabled: true, reason: 'the person asked', decided_by: 'portfolio-manager' }), /revert_path/);
  const d = await decidePack(db, { pack: 'business-plan', enabled: true, reason: 'the person asked', revert_path: 'decidePack enabled=false', decided_by: 'portfolio-manager', now: NOW });
  assert.deepEqual(d.released, [`SCOPED-${held.scope_gate_id}`]);
  assert.deepEqual({ ...one(db, `SELECT status, item_id FROM lifecycle_scope_gate WHERE id = ?`, held.scope_gate_id) }, { status: 'released', item_id: `SCOPED-${held.scope_gate_id}` });
  assert.deepEqual(await requestWork(db, { id: 'REQ-4', text: 'Update the business plan numbers', now: NOW }), { accepted: true, item_id: 'REQ-4', pack: 'business-plan' });
  await decidePack(db, { pack: 'business-plan', enabled: false, reason: 'trial over', revert_path: 'decidePack enabled=true', decided_by: 'portfolio-manager', now: NOW });
  assert.equal((await requestWork(db, { id: 'REQ-5', text: 'Another business plan', now: NOW })).accepted, false);
  assert.deepEqual(rows(db, `SELECT pack FROM lifecycle_scope_gate WHERE status = 'held' ORDER BY id`).map(r => r.pack), ['outreach', 'business-plan']);
});

// ---- US-15-R17, R20: the gate conditions are one enforcement point ----
async function toPlanning(db, id, { skipPlanning = [] } = {}) {
  await startProject(db, { id, name: id, override: { mode: 'hybrid', reason: 'test fixture', decided_by: 'portfolio-manager' }, now: NOW });
  await fill(db, id, 'initiating', 'hybrid');
  assert.equal((await advance(db, id, 'planning', { readiness: async () => 0.9, now: NOW })).ok, true);
  await fill(db, id, 'planning', 'hybrid', { skip: ['A-PLN-1', ...skipPlanning] });
  await recordReadback(db, id, NOW);
}
const putRequirements = async (db, id, requirements) => {
  await submitTailored(db, { project_id: id, kind: 'A-PLN-1', path_or_ref: `docs/${id}/A-PLN-1.md`, content: { in_scope: 'a booking page', out_of_scope: 'payments', requirements }, produced_by: 'doer-1', produced_model: 'alpha-1', now: NOW });
  await reviewArtifact(db, { project_id: id, kind: 'A-PLN-1', reviewer: 'reviewer-1', reviewer_model: 'beta-1', verdict: 'approved' });
};

test('US-15-R17, US-15-T08: a requirement with no mapped item, a mapped item that is not the project\'s or has no closing probe, or an item with a dangling trigger blocks G2 and files an item', async () => {
  const db = setup(); await toPlanning(db, 'M');
  item(db, 'M-W1', { project: 'M' }); item(db, 'M-W2', { project: 'M' }); item(db, 'OTHER-1', { project: 'OTHER' });
  db.raw.exec(`UPDATE items SET closing_probe = NULL WHERE id = 'M-W2'`);
  const gate = async () => advance(db, 'M', 'executing', { now: NOW });
  await putRequirements(db, 'M', []);
  assert.match((await gate()).reasons[0], /A-PLN-1 lists no requirement/);
  await putRequirements(db, 'M', [{ id: 'REQ-1', text: 'a visitor can book', testable: true, items: [] }, { id: 'REQ-2', text: 'a visitor gets a mail', testable: true, items: ['M-W1', 'OTHER-1', 'M-W2'] }]);
  const r = await gate();
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['requirement REQ-1 maps to no item', 'requirement REQ-2 names item OTHER-1, which is not an item of M', 'item M-W2 of requirement REQ-2 has no closing probe']);
  assert.deepEqual(r.filed.sort(), ['GATE-M-executing-map-REQ-1', 'GATE-M-executing-map-REQ-2-OTHER-1', 'GATE-M-executing-probe-REQ-2-M-W2']);
  assert.deepEqual(rows(db, `SELECT id, owner_role FROM items WHERE id LIKE 'GATE-M-executing-%' AND id <> 'GATE-M-executing-requirement-map' ORDER BY id`).map(i => [i.id, i.owner_role]),
    [['GATE-M-executing-map-REQ-1', 'product-manager'], ['GATE-M-executing-map-REQ-2-OTHER-1', 'product-manager'], ['GATE-M-executing-probe-REQ-2-M-W2', 'project-manager']]);
  assert.equal(one(db, `SELECT current_phase FROM kernel_projects WHERE id = 'M'`).current_phase, 'planning');
  db.raw.exec(`UPDATE items SET closing_probe = 'probe' WHERE id = 'M-W2'; UPDATE items SET trigger_on = 'GHOST' WHERE id = 'M-W2'`);
  await putRequirements(db, 'M', [{ id: 'REQ-1', text: 'a visitor can book', testable: true, items: ['M-W1'] }, { id: 'REQ-2', text: 'a visitor gets a mail', testable: true, items: ['M-W2'] }]);
  assert.deepEqual((await gate()).reasons, ['item M-W2 is triggered by GHOST, which does not exist']);
  db.raw.exec(`UPDATE items SET trigger_on = 'M-W1' WHERE id = 'M-W2'`);
  assert.deepEqual(await gate(), { ok: true, phase: 'executing' });
  // the form check refuses a requirement without an id or text, and two with one id
  assert.match(checkForm('hybrid', 'A-PLN-1', { in_scope: 'x', out_of_scope: 'y', requirements: [{ id: 'R', text: '' }] }).problems[0], /lacks an id or its text/);
  assert.match(checkForm('hybrid', 'A-PLN-1', { in_scope: 'x', out_of_scope: 'y', requirements: [{ id: 'R', text: 'a' }, { id: 'R', text: 'b' }] }).problems[0], /share an id/);
  assert.deepEqual(checkForm('hybrid', 'A-PLN-1', { in_scope: 'x' }).missing, ['out_of_scope', 'requirements']);
});

test('US-15-R20, US-15-T11: the kernel advancePhase enforces the G1 conditions that advance does; a caller cannot switch them off', async () => {
  const db = setup();
  await startProject(db, { id: 'Q', name: 'q', now: NOW });
  for (const c of CATALOG.filter(c => c.phase === 'initiating')) {
    await submitTailored(db, { project_id: 'Q', kind: c.kind, path_or_ref: `docs/Q/${c.kind}.md`, content: c.kind === 'A-INI-2' ? { ...CHARTER, definition_of_done_probe: 'looks good' } : contentFor('hybrid', c.kind), produced_by: 'doer-1', now: NOW });
    await reviewArtifact(db, { project_id: 'Q', kind: c.kind, reviewer: 'reviewer-1', verdict: 'approved' });
  }
  const direct = await advancePhase(db, 'Q', 'planning', { readiness: async () => 1, extras: false, now: NOW });          // the kernel call, not advance()
  assert.deepEqual([direct.ok, direct.filed], [false, ['GATE-Q-planning-charter-probe']]);
  const chk = await checkGate(db, 'Q', 'G1', { readiness: async () => 1 });
  assert.deepEqual([chk.pass, chk.extras.map(e => e[0])], [false, ['charter-probe']]);
  assert.equal(one(db, `SELECT current_phase FROM kernel_projects WHERE id = 'Q'`).current_phase, 'initiating');
  await startProject(db, { id: 'P', name: 'p', now: NOW }); await fill(db, 'P', 'initiating', 'hybrid');
  assert.deepEqual((await advancePhase(db, 'P', 'planning', { now: NOW })).filed, ['GATE-P-planning-readiness']);                   // no readiness port: not a pass
  assert.match((await advancePhase(db, 'P', 'planning', { readiness: async () => 0.2, now: NOW })).reasons[0], /0.20 is under the initiation threshold 0.6/);
  assert.deepEqual(await advancePhase(db, 'P', 'planning', { readiness: async () => 0.2, config: { require_readiness: false }, now: NOW }), { ok: true, phase: 'planning' });
});

test('US-15-R20, US-15-T11: loading core/lifecycle-gates registers all five conditions with the kernel, and the composition root loads it', async () => {
  assert.deepEqual([gateExtraNames('G1'), gateExtraNames('G2'), gateExtraNames('G3')], [['charter-probe', 'readiness'], ['requirement-map'], ['deliverable-probes', 'retrospective']]);
  assert.match(readFileSync(new URL('../org/buildout.js', import.meta.url), 'utf8'), /import \{[^}]*lifecycleStep[^}]*\} from '\.\.\/lifecycle-gates\/index\.js'/);   // the host that composes the lifecycle imports the module
});

test('US-15-R20, US-15-T11: the kernel advancePhase enforces the G3 conditions too (an unpassed deliverable probe, a missing retrospective)', async () => {
  const db = setup(); await executing(db, 'AG', 'agile');
  await recordDeliverable(db, { id: 'D1', project_id: 'AG', path_or_ref: 'site/book.js', produced_by: 'doer-1', closing_probe: `SELECT v AS value FROM t_vals WHERE k = 'live'`, now: NOW });
  const it = await startIteration(db, { project_id: 'AG', goal: 'g', items: ['AG-W1'], now: NOW }); await endIteration(db, it.id, { demo_result: 'shown', now: NOW });
  assert.equal((await advancePhase(db, 'AG', 'closing', { now: NOW })).ok, true);
  await fill(db, 'AG', 'closing', 'agile'); db.raw.exec(`UPDATE items SET status = 'done', disposition = 'done' WHERE project = 'AG' AND id NOT LIKE 'GATE-%'`);
  const r = await advancePhase(db, 'AG', 'closed', { now: NOW });
  assert.equal(r.ok, false); assert.deepEqual(r.filed.sort(), ['GATE-AG-closed-deliverable-probes', 'GATE-AG-closed-retrospective']);
});

// ---- US-15-R18: closing opens by itself, and the record is archived ----
test('US-15-R18, US-15-T09: closing opens by itself when every chartered outcome has a disposition, monitoring items do not hold it open, and the closing artifacts are filed', async () => {
  const db = setup(); await executing(db, 'AG', 'agile');
  assert.deepEqual(await openClosing(db, { now: NOW }), []);                                                    // AG-W1 has no disposition yet
  db.raw.prepare(`INSERT INTO items (id, title, owner_role, done_check, status, project) VALUES ('RISKREVIEW-AG-1', 'r', 'project-manager', 'x', 'ready', 'AG')`).run();
  db.raw.exec(`UPDATE items SET status = 'done', disposition = 'done' WHERE id = 'AG-W1'`);
  assert.deepEqual(await openClosing(db, { now: NOW }), ['AG']);
  assert.equal(one(db, `SELECT current_phase FROM kernel_projects WHERE id = 'AG'`).current_phase, 'closing');
  assert.deepEqual({ ...one(db, `SELECT status, disposition FROM items WHERE id = 'RISKREVIEW-AG-1'`) }, { status: 'superseded', disposition: 'superseded: the project is closing' });   // never dropped silently
  const filed = await lifecycleGaps(db);
  assert.deepEqual(filed.sort(), ['GATE-AG-A-CLO-1', 'GATE-AG-A-CLO-2', 'GATE-AG-A-CLO-3', 'GATE-AG-A-CLO-4', 'GATE-AG-A-CLO-5']);
  assert.deepEqual(await openClosing(db, { now: NOW }), []);                                                    // already closing: nothing to do
  const db2 = setup(); await startProject(db2, { id: 'E', name: 'e', now: NOW });
  assert.deepEqual(await openClosing(db2, { now: NOW }), []);                                                   // an initiating project, or one with no items, never closes by this rule
});

test('US-15-R18: archiving a closed project releases its claims, records what was retained once, and refuses a project that is not closed', async () => {
  const db = setup(); await executing(db, 'AG', 'agile');
  await assert.rejects(archiveProject(db, 'AG', { now: NOW }), /only a closed project is archived; AG is in executing/);
  db.raw.exec(`UPDATE items SET status = 'done', disposition = 'done' WHERE id = 'AG-W1'`);
  db.raw.exec(`INSERT INTO claims (item_id, agent) VALUES ('AG-W1', 'staff-1')`);
  await lessonAndClose(db);
  const a = await archiveProject(db, 'AG', { now: NOW + HOUR, by: 'operations' });
  assert.deepEqual([a.archived, a.items_total, a.items_done, a.claims_released], [true, 2, 2, 1]);   // AG-W1 and the lesson's plus item
  assert.equal(a.records.artifacts.length, CATALOG.length);                                                       // every catalog artifact the project submitted
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM claims WHERE item_id = 'AG-W1'`).n, 0);
  assert.equal(a.records.lessons.length, 1);
  const again = await archiveProject(db, 'AG', { now: NOW + 2 * HOUR });
  assert.deepEqual([again.archived, again.existing, again.archived_at], [false, true, ts(NOW + HOUR)]);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM lifecycle_archive`).n, 1);
  assert.deepEqual(await archiveClosed(db, { now: NOW }), []);
});
async function lessonAndClose(db) {
  const { addLesson } = await import('../kernel/index.js');
  await addLesson(db, { project_id: 'AG', text: 'keep demos short' });
  db.raw.exec(`UPDATE items SET status = 'done', disposition = 'done' WHERE project = 'AG' AND id NOT LIKE 'GATE-%'`);
  assert.equal((await advance(db, 'AG', 'closing', { now: NOW })).ok, true); await fill(db, 'AG', 'closing', 'agile');
  assert.deepEqual(await advance(db, 'AG', 'closed', { now: NOW }), { ok: true, phase: 'closed' });
}

// ---- US-15-R15, R16: risk and issue review, quality metrics, compliance ----
test('US-15-R15, US-15-T07: a risk review reads every trigger probe, marks a fired risk triggered and files it for its owner once, and flags what the register and the issues lack', async () => {
  const db = setup(); await executing(db, 'AG', 'agile');
  const a = await addRisk(db, { project_id: 'AG', cause: 'the mail service is down', effect: 'no confirmations', likelihood: 2, impact: 3, response: 'fall back to the page', owner_role: 'operations', trigger: `SELECT v AS value FROM t_vals WHERE k = 'mail_down'` });
  const b = await addRisk(db, { project_id: 'AG', cause: 'users complain', effect: 'churn', trigger: 'when users complain' });
  const c = await addRisk(db, { project_id: 'AG', cause: 'a probe that errors', effect: 'unknown', response: 'fix it', owner_role: 'operations', trigger: 'SELECT nope FROM missing_table' });
  db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, status, project) VALUES ('FIX-1', 'broken link', 'fix', 'staff', 'x', NULL, 'ready', 'AG')`).run();
  const r1 = await recordRiskReview(db, { project_id: 'AG', reviewer: 'project-manager-1', now: NOW });
  assert.deepEqual(r1.triggered, []); assert.equal(r1.open_risks, 3);
  assert.deepEqual(r1.flagged.map(f => [f.kind, f.id, f.why.split(':')[0]]), [['risk', c, 'the trigger probe fails'], ['risk', b, 'lacks response, owner_role'], ['issue', 'FIX-1', 'lacks closing probe']]);
  assert.deepEqual(rows(db, `SELECT id, owner_role FROM items WHERE id LIKE 'RISKFIX-%' OR id LIKE 'ISSUEPROBE-%' ORDER BY id`).map(i => [i.id, i.owner_role]), [[`ISSUEPROBE-FIX-1`, 'project-manager'], [`RISKFIX-AG-${b}`, 'project-manager']]);
  db.raw.exec(`INSERT INTO t_vals VALUES ('mail_down', 1)`);
  const r2 = await recordRiskReview(db, { project_id: 'AG', reviewer: 'project-manager-1', new_risks: [{ cause: 'a new one', effect: 'e', response: 'r', owner_role: 'operations', trigger: 'watch it' }], now: NOW + HOUR });
  assert.deepEqual(r2.triggered, [a]); assert.equal(r2.open_risks, 4);
  assert.equal(one(db, `SELECT status FROM risks WHERE id = ?`, a).status, 'triggered');
  assert.deepEqual({ ...one(db, `SELECT owner_role, priority, done_check FROM items WHERE id = ?`, `RISK-AG-${a}`) }, { owner_role: 'operations', priority: 10, done_check: 'fall back to the page' });
  assert.deepEqual((await evaluateRisks(db, { project_id: 'AG', now: NOW + 2 * HOUR })).triggered, []);          // a risk that already fired does not file again
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM lifecycle_risk_reviews WHERE project_id = 'AG'`).n, 2);
  await assert.rejects(recordRiskReview(db, { project_id: 'AG', reviewer: '', now: NOW }), /names its reviewer/); await assert.rejects(recordRiskReview(db, { project_id: 'NOPE', reviewer: 'x' }), /unknown project/);
});

test('US-15-R15, US-15-T07: a register not reviewed inside the communication period files one review item, numbered after the reviews so far', async () => {
  const db = setup(); await executing(db, 'AG', 'agile', NOW);                                                   // the plan says every 24 h
  assert.deepEqual(await riskReviewDue(db, { now: NOW + 23 * HOUR }), []);
  assert.deepEqual(await riskReviewDue(db, { now: NOW + 25 * HOUR }), ['RISKREVIEW-AG-1']);
  assert.deepEqual(await riskReviewDue(db, { now: NOW + 26 * HOUR }), []);                                      // once
  assert.equal(one(db, `SELECT owner_role FROM items WHERE id = 'RISKREVIEW-AG-1'`).owner_role, 'project-manager');
  await recordRiskReview(db, { project_id: 'AG', reviewer: 'project-manager-1', now: NOW + 26 * HOUR });
  assert.deepEqual(await riskReviewDue(db, { now: NOW + 40 * HOUR }), []);
  assert.deepEqual(await riskReviewDue(db, { now: NOW + 51 * HOUR }), ['RISKREVIEW-AG-2']);
  const init = setup(); await startProject(init, { id: 'I', name: 'i', now: NOW });
  assert.deepEqual(await riskReviewDue(init, { now: NOW + 30 * DAY }), []);                                      // an initiating project has no register to review yet
});

test('US-15-R16, US-15-T07: quality metrics are null when unmeasured and never 0, and match the stated formulas on seeded data', async () => {
  const db = setup(); await startProject(db, { id: 'Z', name: 'z', now: NOW });
  const none = await computeQuality(db, 'Z', { now: NOW });
  assert.deepEqual([none.rework_rate, none.defects_escaped, none.probe_pass_rate], [null, null, null]);
  assert.match((await produceStatusReport(db, { project_id: 'Z', now: NOW })).text, /quality: rework unmeasured, escaped unmeasured, probes passed unmeasured/);
  // two reviewed artifacts, one rejected, two deliverable probes (one passed, one failed), two fix items after the first pass
  for (const k of ['A-INI-1', 'A-INI-2', 'A-INI-3']) await submitTailored(db, { project_id: 'Z', kind: k, path_or_ref: `docs/Z/${k}.md`, content: contentFor('hybrid', k), produced_by: 'doer-1', produced_model: 'alpha-1', now: NOW });
  await reviewArtifact(db, { project_id: 'Z', kind: 'A-INI-1', reviewer: 'reviewer-1', reviewer_model: 'beta-1', verdict: 'approved' });
  await reviewArtifact(db, { project_id: 'Z', kind: 'A-INI-2', reviewer: 'reviewer-1', reviewer_model: 'beta-1', verdict: 'approved' });
  await reviewArtifact(db, { project_id: 'Z', kind: 'A-INI-3', reviewer: 'reviewer-1', reviewer_model: 'beta-1', verdict: 'rejected' });
  db.raw.exec(`INSERT INTO t_vals VALUES ('ok1', 1), ('ok2', 0)`);
  for (const id of ['D1', 'D2']) await recordDeliverable(db, { id, project_id: 'Z', path_or_ref: `site/${id}.js`, produced_by: 'doer-1', closing_probe: `SELECT v AS value FROM t_vals WHERE k = '${id === 'D1' ? 'ok1' : 'ok2'}'`, now: NOW });
  for (const id of ['D1', 'D2']) await runDeliverableProbe(db, id, { runner: 'reviewer-1', now: NOW });
  const fix = (id, at) => db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, status, project, created_at) VALUES (?, ?, 'fix', 'staff', 'x', 'p', 'ready', 'Z', ?)`).run(id, id, ts(at));
  fix('F-before', NOW - HOUR); fix('F-after-1', NOW + HOUR); fix('F-after-2', NOW + 2 * HOUR);
  const q = await computeQuality(db, 'Z', { now: NOW + 3 * HOUR });
  assert.deepEqual([q.rework_rate, q.defects_escaped, q.probe_pass_rate], [0.4, 2, 0.5]);                       // (1 rejected + 1 failed probe + 0) / (3 reviewed + 2 probes + 0)
  assert.deepEqual({ ...q.inputs }, { rejected: 1, reviewed: 3, probes_run: 2, probes_passed: 1, decisions_reverted: 0, decisions_scored: 0, escaped_since: ts(NOW) });
  assert.match((await produceStatusReport(db, { project_id: 'Z', now: NOW + 4 * HOUR })).text, /quality: rework 0.40, escaped 2, probes passed 0.50/);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM lifecycle_quality WHERE project_id = 'Z'`).n, 2);
});

test('US-15-R15, US-15-R16: the compliance report files one item per finding for its owner role, closes it when the finding clears, and is idempotent', async () => {
  const db = setup(); await executing(db, 'AG', 'agile', NOW);
  const t = NOW + 3 * DAY;                                                                                         // 72 h: three periods of 24 h
  const r1 = await complianceReport(db, { project_id: 'AG', now: t });
  assert.deepEqual(r1.findings.map(f => f.slug), ['status-report', 'risk-review', 'quality-metrics']);
  assert.deepEqual(rows(db, `SELECT id, owner_role FROM items WHERE id LIKE 'COMPLIANCE-AG-%' ORDER BY id`).map(i => [i.id, i.owner_role]),
    [['COMPLIANCE-AG-quality-metrics', 'reviewer'], ['COMPLIANCE-AG-risk-review', 'project-manager'], ['COMPLIANCE-AG-status-report', 'project-manager']]);
  assert.deepEqual((await complianceReport(db, { project_id: 'AG', now: t })).filed, []);                          // idempotent
  await produceStatusReport(db, { project_id: 'AG', now: t }); await recordRiskReview(db, { project_id: 'AG', reviewer: 'project-manager-1', now: t }); await computeQuality(db, 'AG', { now: t });
  const r2 = await complianceReport(db, { project_id: 'AG', now: t + HOUR });
  assert.deepEqual([r2.findings, r2.closed.sort()], [[], ['COMPLIANCE-AG-quality-metrics', 'COMPLIANCE-AG-risk-review', 'COMPLIANCE-AG-status-report']]);
  assert.deepEqual({ ...one(db, `SELECT status, disposition FROM items WHERE id = 'COMPLIANCE-AG-status-report'`) }, { status: 'done', disposition: 'done: the finding cleared' });
  // a change request with no decision is a finding; approving it sends the artifact back to review, which is a finding until a different agent reviews it
  const cr = await amendArtifact(db, { project_id: 'AG', kind: 'A-INI-2', new_ref: 'docs/AG/charter-v2.md', summary: 'raise the cap', revert_path: 'restore the first charter', requested_by: 'project-manager', now: t });
  assert.deepEqual((await complianceReport(db, { project_id: 'AG', now: t + HOUR })).findings.map(f => f.slug), [`change-request-${cr.change_request_id}`]);
  await decideChangeRequest(db, cr.change_request_id, { decision: 'approved', decided_by: 'portfolio-manager', now: t });
  assert.deepEqual((await complianceReport(db, { project_id: 'AG', now: t + HOUR })).findings.map(f => f.slug), ['review-A-INI-2']);
  await assert.rejects(complianceReport(db, { project_id: 'NOPE' }), /unknown project/);
});

test('US-15-R15: the compliance report of project A closes only A\'s own findings, never those of a project whose id starts with A- (A-B)', async () => {
  const db = setup(); await executing(db, 'A', 'agile', NOW); await executing(db, 'A-B', 'agile', NOW);
  const t = NOW + HOUR;
  await computeQuality(db, 'A', { now: t }); await computeQuality(db, 'A-B', { now: t });                          // no quality finding: the change request is the only one
  const cr = await amendArtifact(db, { project_id: 'A-B', kind: 'A-INI-2', new_ref: 'docs/A-B/charter-v2.md', summary: 'raise the cap', revert_path: 'restore the first charter', requested_by: 'project-manager', now: t });
  const id = `COMPLIANCE-A-B-change-request-${cr.change_request_id}`;
  assert.deepEqual((await complianceReport(db, { project_id: 'A-B', now: t })).filed, [id]);
  const ra = await complianceReport(db, { project_id: 'A', now: t });
  assert.deepEqual([ra.findings, ra.closed], [[], []], 'A has no finding of its own and closes nothing of A-B');
  assert.equal(one(db, `SELECT status FROM items WHERE id = ?`, id).status, 'ready', "A-B's finding is still open after A's report");
  await decideChangeRequest(db, cr.change_request_id, { decision: 'rejected', decided_by: 'portfolio-manager', now: t });
  assert.deepEqual((await complianceReport(db, { project_id: 'A-B', now: t + HOUR })).closed, [id], "A-B's own report closes it when the finding clears");
});

test('US-15-R10, US-15-R15, US-15-R18: the lifecycle step adopts outcomes, files gate items, closes and archives, and reports each in the tick notes without erroring', async () => {
  const db = setup();
  db.raw.exec(`INSERT INTO roles (id, role, project, tick_every, model) VALUES ('project-manager-1', 'project-manager', 'OUT-1', 1, 'm'), ('product-manager-1', 'product-manager', 'OUT-1', 3, 'm'), ('operations-1', 'operations', NULL, 1, 'm')`);
  const r = await runTick(db, { config: { ...config, lifecycle: { ...(config.lifecycle || {}), auto_start: true } }, now: NOW, extraSteps: [lifecycleStep()] });
  assert.deepEqual(r.errors, []); assert.match(r.report, /lifecycle: 0 status report\(s\), adopted OUT-1, \d+ gate item\(s\)/);
  assert.equal(one(db, `SELECT delivery_mode FROM kernel_projects WHERE id = 'OUT-1'`).delivery_mode, 'hybrid');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_projects`).n, 1);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_programs WHERE id = 'OUT-1'`).n, 1);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'GATE-OUT-1-A-INI-%'`).n, 6);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id = 'GATE-OUT-1-planning-charter-probe'`).n, 1);       // the registered G1 conditions are filed too
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id = 'GATE-OUT-1-planning-readiness'`).n, 0);           // an unwired readiness port is not a gap anything can close
  const again = await runTick(db, { config, now: NOW + HOUR, extraSteps: [lifecycleStep()] });
  assert.deepEqual(again.errors, []); assert.doesNotMatch(again.report, /adopted/);
  const off = setup(); off.raw.exec(`INSERT INTO roles (id, role, project, tick_every, model) VALUES ('pm-1', 'project-manager', 'OUT-9', 1, 'm')`);
  await runTick(off, { config: { ...config, lifecycle: { auto_start: false } }, now: NOW, extraSteps: [lifecycleStep()] });
  assert.equal(one(off, `SELECT COUNT(*) AS n FROM kernel_projects`).n, 0);
});

// ---- US-15-R19: variance beyond the predictions ----
test('US-15-R19, US-15-R10: the status report lists items past their SLA by priority band and labels capacity over, within, under or unmeasured', async () => {
  const db = setup(); await startProject(db, { id: 'CP', name: 'cp', capacity: 2, now: NOW - 20 * DAY });
  const mk = (id, priority, ageDays, status = 'ready') => db.raw.prepare(`INSERT INTO items (id, title, owner_role, done_check, priority, status, project, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(id, id, 'staff', 'x', priority, status, 'CP', ts(NOW - ageDays * DAY));
  mk('P0-late', 0, 3); mk('P0-ok', 0, 1); mk('P1-late', 5, 8); mk('P1-ok', 10, 6); mk('DEF-ok', 50, 13); mk('DEF-late', 50, 15); mk('DONE-old', 0, 30, 'done');
  const late = await itemsLate(db, { project_id: 'CP', now: NOW });
  assert.deepEqual(late.map(l => [l.id, l.age_days, l.sla_days]).sort(), [['DEF-late', 15, 14], ['P0-late', 3, 2], ['P1-late', 8, 7]]);
  const claim = (id) => db.raw.prepare(`INSERT INTO claims (item_id, agent) VALUES (?, 'staff-1')`).run(id);
  assert.deepEqual((await capacityVariance(db, { project_id: 'CP', since: ts(NOW - 20 * DAY) })).verdict, 'under');   // 0 of 2 in flight
  claim('P0-ok'); claim('P1-ok'); assert.deepEqual(await capacityVariance(db, { project_id: 'CP', since: ts(NOW - 20 * DAY) }), { planned: 2, in_flight: 2, verdict: 'within' });
  claim('DEF-ok'); assert.equal((await capacityVariance(db, { project_id: 'CP', since: ts(NOW - 20 * DAY) })).verdict, 'over');
  const rep = await produceStatusReport(db, { project_id: 'CP', now: NOW });
  assert.match(rep.text.split('\n')[3], /3 item\(s\) past their SLA, capacity over/);
  const v = one(db, `SELECT * FROM lifecycle_variance WHERE report_id = ?`, rep.id);
  assert.deepEqual([JSON.parse(v.items_late).length, v.capacity_planned, v.capacity_in_flight, v.capacity_verdict], [3, 2, 3, 'over']);
  // no capacity planned: unmeasured, never within
  await startProject(db, { id: 'NP', name: 'np', now: NOW });
  const np = await produceStatusReport(db, { project_id: 'NP', now: NOW });
  assert.deepEqual([np.capacity.verdict, np.capacity.planned, np.items_late], ['unmeasured', null, []]);
});

// ---- US-15-R21: one scope classifier, and the pack host decides enablement ----
test('US-15-T10, US-15-R21: the lifecycle classifier covers every phrase the console\'s own table covers', () => {
  const phrases = ['write the business plan', 'a financial model', 'a pitch deck', 'we are fundraising', 'find investors', 'a funding application', 'a funding round', 'file a patent', 'a trademark for the name',
    'copyright filing', 'copyright registration', 'legal advice', 'tax advice', 'investment advice', 'medical advice', 'a marketing campaign', 'social media posts', 'a social media account', 'cold email', 'cold outreach', 'an ad campaign'];
  for (const ph of phrases) {
    assert.ok(OUT_OF_SCOPE.some(([re]) => re.test(ph)), `the console table covers ${ph}`);                            // the premise: the phrase is one the console refuses
    assert.equal(classifyScope(ph).in_scope, false, `the lifecycle classifier covers ${ph}`);
  }
  // Superset, not a list: every plural and inflected form of a phrase the console refuses is refused here too (the console patterns carry no word boundary).
  const forms = [...phrases.flatMap(ph => [`${ph}s`, `${ph}ed`, `${ph}ing`, `write three ${ph}s`, `un${ph}`]),
    'write three business plans', 'draft pitch decks', 'prepare funding applications', 'file patents', 'register trademarks', 'build financial models', 'a patented design'];
  let premise = 0;
  for (const f of forms) {
    if (!OUT_OF_SCOPE.some(([re]) => re.test(f))) continue;                                                           // only a form the console refuses is a premise
    premise++;
    assert.equal(classifyScope(f).in_scope, false, `the lifecycle classifier covers the form "${f}" the console refuses`);
  }
  assert.ok(premise >= forms.length, 'every generated form is one the console refuses');
  assert.deepEqual(classifyScope('Add a booking form to the home page'), { in_scope: true });
  assert.deepEqual(classifyScope('Update the opening hours'), { in_scope: true });
});

test('US-15-R21, US-15-T10: a request for a pack the pack host has enabled is accepted; a refusal from the host keeps the request held with the reason; the host\'s decision id is recorded', async () => {
  const db = setup(); const enabled = new Set(); const calls = [];
  const packs = { isEnabled: async (id) => enabled.has(id), enable: async (id, a) => { calls.push([id, a]); return a.cardText === 'I understand' ? (enabled.add(id), { ok: true, decision_id: 'PD-9' }) : { ok: false, reason: 'card_text_mismatch' }; }, disable: async (id) => { enabled.delete(id); } };
  const held = await requestWork(db, { id: 'REQ-1', text: 'Write a business plan for the shop', now: NOW }, { packs });
  assert.equal(held.accepted, false);
  const refused = await decidePack(db, { pack: 'business-plan', enabled: true, reason: 'the person asked', revert_path: 'disable it', decided_by: 'portfolio-manager', card_text: 'ok', now: NOW }, { packs });
  assert.deepEqual([refused.refused, refused.released], ['card_text_mismatch', []]);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM lifecycle_scope_decisions`).n, 0);                               // no decision was recorded
  assert.equal(one(db, `SELECT status FROM lifecycle_scope_gate WHERE id = ?`, held.scope_gate_id).status, 'held');
  const ok = await decidePack(db, { pack: 'business-plan', enabled: true, reason: 'the person asked', revert_path: 'disable it', decided_by: 'portfolio-manager', card_text: 'I understand', now: NOW }, { packs });
  assert.deepEqual(ok.released, [`SCOPED-${held.scope_gate_id}`]); assert.deepEqual(calls.at(-1), ['business-plan', { by: 'portfolio-manager', cardText: 'I understand' }]);
  assert.match(one(db, `SELECT reason FROM lifecycle_scope_decisions WHERE pack = 'business-plan'`).reason, /the person asked \(pack host decision PD-9\)/);
  enabled.add('outreach');                                                                                          // enabled in the host, never decided here
  assert.deepEqual(await requestWork(db, { id: 'REQ-2', text: 'Run our marketing on three channels', now: NOW }, { packs }), { accepted: true, item_id: 'REQ-2', pack: 'outreach' });
  assert.equal((await requestWork(db, { id: 'REQ-3', text: 'Run our marketing on three channels', now: NOW })).accepted, false);   // without the host port the old rule holds
  await decidePack(db, { pack: 'business-plan', enabled: false, reason: 'trial over', revert_path: 'enable it', decided_by: 'portfolio-manager', now: NOW }, { packs });
  assert.equal(enabled.has('business-plan'), false);
});

// ---- US-15-R05, R22: drafted artifacts come from the person's answers and are never reviewed by their producer ----
test('US-15-R01, US-15-R05: outcomes are adopted once as hybrid projects, never above the portfolio cap, and the system-test refusal precedes them in the seed', async () => {
  const db = setup();
  db.raw.exec(`INSERT INTO roles (id, role, project, tick_every, model) VALUES ('pm-1', 'project-manager', 'OUT-1', 1, 'm'), ('pd-1', 'product-manager', 'OUT-1', 1, 'm'), ('pm-2', 'project-manager', 'OUT-2', 1, 'm'), ('op-1', 'operations', NULL, 1, 'm')`);
  const cap = { portfolio_cap: 1, default_capacity: 1 };
  const a = await adoptOutcomes(db, { now: NOW, config: cap });
  assert.deepEqual(a.adopted, ['OUT-1']); assert.deepEqual(a.held.map(h => [h.project, h.item_id]), [['OUT-2', 'CAPACITY-OUT-2']]);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_projects WHERE id = 'OUT-2'`).n, 0);
  const free = await adoptOutcomes(db, { now: NOW, config: {} });
  assert.deepEqual(free.adopted, ['OUT-2']); assert.deepEqual((await adoptOutcomes(db, { now: NOW, config: {} })).adopted, []);   // once
  const d = one(db, `SELECT mode, rule_mode, decided_by FROM lifecycle_mode_decisions WHERE project_id = 'OUT-1'`);
  assert.deepEqual({ ...d }, { mode: 'hybrid', rule_mode: 'hybrid', decided_by: 'selection rule' });
  assert.equal(one(db, `SELECT program_id FROM kernel_projects WHERE id = 'OUT-1'`).program_id, 'OUT-1');
  assert.deepEqual(await adoptOutcomes(db, { config: { auto_start: false } }), { adopted: [], skipped: 'config.lifecycle.auto_start is false' });
});

test('US-15-R05, US-15-R07: a drafted artifact is a record with a form check, lists every default taken for the person, and is never marked reviewed by its producer', async () => {
  const db = setup(); await startProject(db, { id: 'P', name: 'p', now: NOW });
  const readback = [{ need_id: 'audience', value: 'my clients' }, { need_id: 'first_outcome', value: 'a booking page' },
    { need_id: 'constraints', value: 'no card payments', assumption: true, default_consequence: 'we start without payments' }];
  const r = await draftArtifacts(db, { project_id: 'P', readback, fields: { want: 'I want people to book me online' }, now: NOW });
  assert.deepEqual(r.drafted.map(d => [d.kind, d.ok]), [['A-INI-1', true], ['A-INI-4', true], ['A-INI-6', true]]);
  assert.deepEqual({ ...JSON.parse(one(db, `SELECT content FROM lifecycle_artifact_content WHERE project_id = 'P' AND kind = 'A-INI-1'`).content) },
    { want_verbatim: 'I want people to book me online', for_whom: 'my clients', first_outcomes: ['a booking page'], constraints: 'no card payments' });
  assert.deepEqual(JSON.parse(one(db, `SELECT content FROM lifecycle_artifact_content WHERE project_id = 'P' AND kind = 'A-INI-4'`).content).assumptions,
    [{ need: 'constraints', assumed: 'no card payments', consequence: 'we start without payments', revert_path: 'ask again: change the answer for constraints' }]);
  for (const k of ['A-INI-1', 'A-INI-4', 'A-INI-6']) { const a = one(db, `SELECT status, reviewed_by, produced_by, done_check_passed FROM artifacts WHERE project_id = 'P' AND kind = ?`, k); assert.deepEqual([a.status, a.reviewed_by, a.produced_by, a.done_check_passed], ['submitted', null, 'system', 1], k); }
  // an answer nobody gave is left empty and the form check says so; nothing is invented
  await startProject(db, { id: 'Q', name: 'q', now: NOW });
  const q = await draftArtifacts(db, { project_id: 'Q', readback: [{ need_id: 'audience', value: 'members' }], fields: { want: 'a club site' }, now: NOW });
  assert.deepEqual(q.drafted[0], { kind: 'A-INI-1', ok: false, missing: ['first_outcomes', 'constraints'] });
  assert.equal(one(db, `SELECT done_check_passed FROM artifacts WHERE project_id = 'Q' AND kind = 'A-INI-1'`).done_check_passed, 0);
  await assert.rejects(draftArtifacts(db, { project_id: 'NOPE' }), /unknown project/);
});

test('US-15-R05: the lifecycle step drafts the initiation artifacts of an initiating project from the readback port, once', async () => {
  const db = setup(); await startProject(db, { id: 'P', name: 'p', now: NOW });
  let calls = 0;
  const readback = async () => { calls++; return { readback: [{ need_id: 'audience', value: 'clients' }, { need_id: 'first_outcome', value: 'bookings' }, { need_id: 'constraints', value: 'none', assumption: true }], fields: { want: 'book me' } }; };
  const r = await runTick(db, { config, now: NOW, extraSteps: [lifecycleStep({ readback })] });
  assert.deepEqual(r.errors, []); assert.equal(one(db, `SELECT status FROM artifacts WHERE project_id = 'P' AND kind = 'A-INI-1'`).status, 'submitted');
  await runTick(db, { config, now: NOW + HOUR, extraSteps: [lifecycleStep({ readback })] });
  assert.equal(calls, 1);                                                                                           // A-INI-1 exists now: not drafted again
  const failing = setup(); await startProject(failing, { id: 'F', name: 'f', now: NOW });
  const bad = await runTick(failing, { config, now: NOW, extraSteps: [lifecycleStep({ readback: async () => { throw new Error('elicit down'); } })] });
  assert.deepEqual(bad.errors, []);                                                                                 // a port that fails drafts nothing and never errors the tick
});

test('US-15-R10, US-15-R15: lifecycleProbe reports the lifecycle from its own tables, read-only, and answers on an empty store', async () => {
  const db = setup();
  assert.deepEqual(await lifecycleProbe(db, { now: NOW }), { projects: 0, by_phase: {}, status_report_age_h: null, open_gate_items: 0, archived: 0 });
  await executing(db, 'AG', 'agile', NOW); await produceStatusReport(db, { project_id: 'AG', now: NOW });
  const count = () => ['kernel_projects', 'lifecycle_status_reports', 'items', 'lifecycle_archive'].map(t => one(db, `SELECT COUNT(*) AS n FROM ${t}`).n);
  const before = count();
  const p = await lifecycleProbe(db, { now: NOW + 5 * HOUR });
  assert.deepEqual(count(), before);
  assert.deepEqual([p.projects, p.by_phase, p.status_report_age_h], [1, { executing: 1 }, 5]);
});

test('A-MON-4: the risk and issue review files one item per incomplete open risk and per issue without a probe, counts new risks, and is a record', async () => {
  const db = setup();
  await startProject(db, { id: 'RK', name: 'rk', override: { mode: 'agile', reason: 'test fixture', decided_by: 'portfolio-manager' }, now: NOW });
  const full = await addRisk(db, { project_id: 'RK', cause: 'vendor delay', effect: 'schedule slip', likelihood: 3, impact: 4, response: 'second vendor', owner_role: 'project-manager', trigger: 'no delivery by day 10' });
  const bare = await addRisk(db, { project_id: 'RK', cause: 'key person leaves', effect: 'review stalls' });
  db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, status, project) VALUES ('BUG-1', 'broken form', 'fix', 'staff', 'x', NULL, 'ready', 'RK')`).run();
  db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, status, project) VALUES ('BUG-2', 'slow page', 'fix', 'staff', 'x', 'SELECT 1 AS value', 'ready', 'RK')`).run();
  const r1 = await reviewRisks(db, { project_id: 'RK', now: NOW });
  assert.deepEqual([r1.risks, r1.open, r1.new_since_last, r1.previous_review], [2, 2, 2, null]);
  assert.deepEqual(r1.incomplete, [{ id: bare, lacks: ['response', 'owner_role', 'trigger'] }]);
  assert.deepEqual(r1.issues_without_probe, ['BUG-1']);
  assert.deepEqual(r1.filed, [`RISK-RK-${bare}`, 'ISSUE-PROBE-BUG-1']);
  const it = one(db, `SELECT owner_role, project, closing_probe FROM items WHERE id = ?`, `RISK-RK-${bare}`);
  assert.deepEqual([it.owner_role, it.project], ['project-manager', 'RK']);
  assert.equal(one(db, it.closing_probe).value, 0);                                          // the probe is runnable and fails while the risk is incomplete
  const a = one(db, `SELECT phase, kind, owner_role, path_or_ref, evidence, updated_at FROM artifacts WHERE id = 'RK:A-MON-4'`);
  assert.deepEqual([a.phase, a.owner_role, a.path_or_ref, a.updated_at], ['monitoring', 'project-manager', 'risks?project_id=RK', ts(NOW)]);
  assert.equal(JSON.parse(a.evidence).max_risk_id, bare);

  db.raw.prepare(`UPDATE risks SET response = 'cross-train', owner_role = 'project-manager', trigger = 'notice given' WHERE id = ?`).run(bare);
  await addRisk(db, { project_id: 'RK', cause: 'quota', effect: 'tick stops', response: 'cheaper tier', owner_role: 'operations', trigger: 'spend at 80%' });
  db.raw.prepare(`UPDATE items SET closing_probe = 'SELECT 1 AS value' WHERE id = 'BUG-1'`).run();
  const r2 = await reviewRisks(db, { project_id: 'RK', now: NOW + DAY });
  assert.deepEqual([r2.risks, r2.new_since_last, r2.incomplete, r2.issues_without_probe, r2.filed, r2.previous_review], [3, 1, [], [], [], ts(NOW)]);
  assert.equal(one(db, it.closing_probe).value, 1);                                          // the same probe passes once the risk is complete
  assert.equal(one(db, one(db, `SELECT closing_probe FROM items WHERE id = 'ISSUE-PROBE-BUG-1'`).closing_probe).value, 1);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM artifacts WHERE project_id = 'RK' AND kind = 'A-MON-4'`).n, 1);   // one record, refreshed
  assert.equal(full > 0, true);
  await assert.rejects(reviewRisks(db, { project_id: 'nope', now: NOW }), /unknown project/);
  // a closed risk is not chased, and the gates do not read monitoring artifacts
  db.raw.prepare(`INSERT INTO risks (project_id, cause, effect, status) VALUES ('RK', 'old', 'gone', 'closed')`).run();
  assert.deepEqual((await reviewRisks(db, { project_id: 'RK', now: NOW + 2 * DAY })).incomplete, []);
});

test('A-MON-6: rework rate, defects escaped and probe pass rate are read from the project records; nothing under a ratio is unmeasured, not zero', async () => {
  const db = setup();
  await startProject(db, { id: 'QM', name: 'qm', override: { mode: 'agile', reason: 'test fixture', decided_by: 'portfolio-manager' }, now: NOW });
  const empty = await qualityMetrics(db, { project_id: 'QM', now: NOW });
  assert.deepEqual([empty.rework_rate, empty.probe_pass_rate, empty.defects_escaped, empty.probes_run], [null, null, 0, 0]);
  for (const [id, kind] of [['W-1', 'work'], ['W-2', 'work'], ['W-3', 'work'], ['F-1', 'fix']]) item(db, id, { project: 'QM' }), db.raw.prepare(`UPDATE items SET kind = ? WHERE id = ?`).run(kind, id);
  item(db, 'OTHER', { project: 'ELSE' });
  db.raw.prepare(`INSERT INTO outcomes (item_id, agent, surface, action_class, result) VALUES ('W-1', 'a', 's', 'c', 'hidden_failure'), ('W-2', 'a', 's', 'c', 'verified'), ('OTHER', 'a', 's', 'c', 'hidden_failure')`).run();
  await recordDeliverable(db, { id: 'D-1', project_id: 'QM', path_or_ref: 'src/a.js', closing_probe: 'SELECT 1 AS value', produced_by: 'doer', now: NOW });
  await recordDeliverable(db, { id: 'D-2', project_id: 'QM', path_or_ref: 'src/b.js', closing_probe: 'SELECT 0 AS value', produced_by: 'doer', now: NOW });
  await recordDeliverable(db, { id: 'D-3', project_id: 'QM', path_or_ref: 'src/c.js', closing_probe: 'SELECT 1 AS value', produced_by: 'doer', now: NOW });
  await runDeliverableProbe(db, 'D-1', { runner: 'checker', now: NOW }); await runDeliverableProbe(db, 'D-2', { runner: 'checker', now: NOW });
  const q = await qualityMetrics(db, { project_id: 'QM', now: NOW + HOUR });
  assert.deepEqual([q.rework_rate, q.fix_items, q.work_items, q.defects_escaped, q.probe_pass_rate, q.probes_run, q.probes_passed, q.deliverables_unprobed], [0.25, 1, 3, 1, 0.5, 2, 1, 1]);
  const a = one(db, `SELECT phase, owner_role, evidence, updated_at FROM artifacts WHERE id = 'QM:A-MON-6'`);
  assert.deepEqual([a.phase, a.owner_role, a.updated_at, JSON.parse(a.evidence).rework_rate], ['monitoring', 'reviewer', ts(NOW + HOUR), 0.25]);
});

test('A-MON-4, A-MON-6 on the tick: each open project is reviewed once per period and a closed project is left alone', async () => {
  const db = setup();
  await startProject(db, { id: 'T1', name: 't1', override: { mode: 'agile', reason: 'test fixture', decided_by: 'portfolio-manager' }, now: NOW });
  await startProject(db, { id: 'T2', name: 't2', override: { mode: 'agile', reason: 'test fixture', decided_by: 'portfolio-manager' }, now: NOW });
  db.raw.prepare(`UPDATE kernel_projects SET current_phase = 'closed' WHERE id = 'T2'`).run();
  assert.deepEqual(await refreshMonitoring(db, { now: NOW }), { risk_reviews: ['T1'], quality: ['T1'] });
  assert.deepEqual(await refreshMonitoring(db, { now: NOW + DAY }), { risk_reviews: [], quality: [] });
  assert.deepEqual(await refreshMonitoring(db, { now: NOW + DAY, config: { risk_review_period_h: 12 } }), { risk_reviews: ['T1'], quality: [] });
  const tick = await runTick(db, { config, now: NOW + 9 * DAY, extraSteps: [lifecycleStep()] });
  assert.deepEqual(tick.errors, []); assert.match(tick.report, /1 risk review\(s\), 1 quality reading\(s\)/);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM artifacts WHERE project_id = 'T2'`).n, 0);
});
