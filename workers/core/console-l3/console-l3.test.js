// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-13 conformance (US-13-T01..T05 for the L3 parts) and the console wiring (issue #46).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createConsoleL3 } from './index.js';
import { handleConsole } from '../src/console.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const LIMITS = 'The system grades itself (self-measurement bias); rubrics are applied by analogy; evidence is point-in-time.';
const mk = () => { const db = makeDb([MIG]); const t = { v: T0 }; return { db, t, l3: createConsoleL3({ db, now: () => t.v, config: { version: '1.2.3' } }) }; };
const seed = db => db.raw.exec(`
  INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('A','a','staff','x','ready'),('B','b','staff','x','done'),('C','c','staff','x','claimed');
  INSERT INTO items (id,title,owner_role,done_check,status,blocker) VALUES ('D','d','staff','x','blocked','w');
  INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G1','Approve spend','money','stays zero','manual');
  INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES ('2026-11-12T11:00:00Z','2026-11-12T11:00:01Z',5,5);
  INSERT INTO predictions (id,item_id,metric,op,target,due_at,verdict) VALUES ('P1','A','m','>=',1,'2026-11-12','hit'),('P2','A','m','>=',1,'2026-11-12','miss');`);
const good = (dim, score, extra = {}) => ({ dimension: dim, score, evidence: `table:${dim}`, confidence: 'medium', status: 'measured', ...extra });

test('US-13-T01: /health and /api/state return JSON with version and counts; unknown paths and methods return null', async () => {
  const { db, l3 } = mk(); seed(db);
  const h = await (await l3.handle(new Request('https://x.example/health'))).json();
  assert.deepEqual(h.counts, { items: 4, open_gate_cards: 1, blocked: 1 }); assert.equal(h.version, '1.2.3'); assert.equal(h.ok, true);
  const s = await (await l3.handle(new Request('https://x.example/api/state'))).json();
  assert.deepEqual(s.items, { open: 1, claimed: 1, blocked: 1, done: 1, total: 4 });
  assert.deepEqual(s.predictions, { hit: 1, scored: 2 }); assert.equal(s.waiting_on_a_person, 2);
  assert.equal(await l3.handle(new Request('https://x.example/nope')), null);
  assert.equal(await l3.handle(new Request('https://x.example/health', { method: 'POST' })), null);
});

test('US-13-R02: the digest is computed from the same state the dashboard serves', async () => {
  const { db, l3 } = mk(); seed(db);
  const d = await l3.digest(); const s = await l3.state();
  assert.deepEqual(d.state, s);
  assert.match(d.text, /1 open, 1 in progress, 1 blocked, 1 done/); assert.match(d.text, /waiting on a person: 2/); assert.match(d.text, /1 of 2 called right/);
});

test('health is not ok before the first check and when a check did not finish', async () => {
  const { db, l3 } = mk();
  assert.equal((await l3.health()).ok, false);
  db.raw.exec(`INSERT INTO tick_runs (started_at,steps_completed,steps_total) VALUES ('2026-11-12T11:00:00Z',2,5)`);
  assert.equal((await l3.health()).ok, false);
});

test('US-13-T02 and R03: a score without evidence, confidence or status is rejected and nothing is stored', async () => {
  const { db, l3 } = mk();
  const r = await l3.recordCard({ name: 'autonomy', rubric: 'r1', limits: LIMITS, scores: [good('loops', 4), { dimension: 'cost', score: 3 }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /evidence pointer is required/.test(e)) && r.errors.some(e => /confidence/.test(e)) && r.errors.some(e => /status/.test(e)));
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM l3_scores').get().n, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM l3_cards').get().n, 0);
});

test('US-13-R04: a card must state self-measurement bias in its limits', async () => {
  const { l3 } = mk();
  const r = await l3.recordCard({ name: 'autonomy', rubric: 'r1', limits: 'point-in-time evidence only', scores: [good('loops', 4)] });
  assert.equal(r.ok, false); assert.match(r.errors[0], /self-measurement bias/);
  assert.equal((await l3.recordCard({ name: 'autonomy', rubric: 'r1', limits: LIMITS, scores: [good('loops', 4)] })).ok, true);
});

test('US-13-T05 and R05: a fall of 0.6 with no cause files a work item; with a cause, or a fall of 0.4, it does not', async () => {
  const { db, l3 } = mk();
  await l3.recordCard({ name: 'autonomy', rubric: 'r1', limits: LIMITS, scores: [good('loops', 4), good('cost', 3), good('speed', 3)] });
  const r = await l3.recordCard({ name: 'autonomy', rubric: 'r1', limits: LIMITS, scores: [good('loops', 3.4), good('cost', 1, { cause: 'budget cap hit after the model change' }), good('speed', 2.6)] });
  assert.deepEqual(r.items, ['L3-DROP-AUTONOMY-LOOPS']);
  const it = db.raw.prepare("SELECT status, project FROM items WHERE id='L3-DROP-AUTONOMY-LOOPS'").get();
  assert.deepEqual({ ...it }, { status: 'open', project: 'report-card' });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'L3-DROP%'").get().n, 1);
});

test('reportCard returns the latest scores, evidence, limits and the mean', async () => {
  const { l3 } = mk();
  await l3.recordCard({ name: 'autonomy', rubric: 'r1', limits: LIMITS, scores: [good('a', 2), good('b', 4)] });
  await l3.recordCard({ name: 'autonomy', rubric: 'r1', limits: LIMITS, scores: [good('a', 3), good('b', 4)] });
  const c = await l3.reportCard('autonomy');
  assert.equal(c.overall, 3.5); assert.equal(c.scores.length, 2); assert.equal(c.scores[0].evidence, 'table:a'); assert.match(c.limits, /self-measurement/);
  assert.equal(await l3.reportCard('none'), null);
  const res = await l3.handle(new Request('https://x.example/api/report-card?name=missing'));
  assert.equal(res.status, 404);
});

test('US-13-R06: a change to the objective function can be proposed and is never adopted', async () => {
  const { db, l3 } = mk();
  const p = await l3.proposeObjectiveChange('weight cost overrun higher');
  assert.equal(p.status, 'proposed');
  assert.equal((await l3.proposeObjectiveChange('  ')).ok, false);
  const a = await l3.adoptObjectiveChange(p.id);
  assert.equal(a.ok, false); assert.equal(a.refusal, 'objective_function_is_not_self_adoptable');
  assert.equal(db.raw.prepare('SELECT status FROM l3_proposals').get().status, 'proposed');
});

test('US-13-T04 and R11: a step at 5 h of a 4 h budget files an item; at 9 h exactly one question, never a second', async () => {
  const { db, t, l3 } = mk();
  const run = { process: 'review', step: 'check', started_at: T0 - 5 * 3600e3, budget_hours: 4 };
  assert.deepEqual(await l3.sweepStepBudgets([run]), [{ key: 'REVIEW-CHECK', kind: 'item' }]);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM gate_cards WHERE id LIKE 'stepq-%'").get().n, 0);
  t.v = T0 + 4 * 3600e3; // now 9 h elapsed
  const filed = await l3.sweepStepBudgets([run]);
  assert.deepEqual(filed.map(f => f.kind), ['item', 'question']);
  await l3.sweepStepBudgets([run]); // a later sweep adds no second question
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM gate_cards WHERE id LIKE 'stepq-%'").get().n, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'STEPBUDGET-%'").get().n, 1);
  assert.deepEqual(await l3.sweepStepBudgets([{ ...run, done: true }, { ...run, step: 'quick', started_at: t.v - 3600e3 }]), []);
});

test('console wiring: /api/console/fleet/* needs sign-in and serves the L3 routes', async () => {
  const { db, l3 } = mk(); seed(db);
  const env = { DB: db, CONSOLE_TOKEN: 'console-token-1234' };
  const o = { l3, now: () => T0 };
  const cookie = 'us_console=' + encodeURIComponent(env.CONSOLE_TOKEN);
  assert.equal((await handleConsole(new Request('https://x.example/api/console/fleet/state'), env, o)).status, 401);
  const ok = await handleConsole(new Request('https://x.example/api/console/fleet/state', { headers: { cookie } }), env, o);
  assert.equal(ok.status, 200); assert.equal((await ok.json()).version, '1.2.3');
  assert.equal((await handleConsole(new Request('https://x.example/api/console/fleet/zzz', { headers: { cookie } }), env, o)).status, 404);
  assert.equal((await (await handleConsole(new Request('https://x.example/api/console/fleet/digest', { headers: { cookie } }), env, o)).json()).state.items.total, 4);
});

test('US-13-R05: a fall of exactly 0.5 in one-decimal scores files an item (2.3 to 1.8, 0.7 to 0.2, 1.4 to 0.9, 4.1 to 3.6); 0.4 and a stated cause do not', async () => {
  for (const [from, to] of [[2.3, 1.8], [0.7, 0.2], [1.4, 0.9], [4.1, 3.6]]) {
    const { l3 } = mk();
    await l3.recordCard({ name: 'autonomy', rubric: 'r1', limits: LIMITS, scores: [good('loops', from)] });
    const r = await l3.recordCard({ name: 'autonomy', rubric: 'r1', limits: LIMITS, scores: [good('loops', to)] });
    assert.deepEqual(r.items, ['L3-DROP-AUTONOMY-LOOPS'], `${from} to ${to}`);
  }
  const { l3 } = mk();
  await l3.recordCard({ name: 'autonomy', rubric: 'r1', limits: LIMITS, scores: [good('a', 2.3), good('b', 2.3)] });
  const r = await l3.recordCard({ name: 'autonomy', rubric: 'r1', limits: LIMITS, scores: [good('a', 1.9), good('b', 1.8, { cause: 'the window was empty this month' })] });
  assert.deepEqual(r.items, []);
});

test('US-13-T06 and US-13-R16 and US-13-R11: a new over-budget run after the item and question were closed files an item and exactly one new question; the same run twice files one', async () => {
  const { db, t, l3 } = mk();
  const H = 3600e3;
  const run1 = { process: 'review', step: 'check', started_at: T0 - 9 * H, budget_hours: 4 };
  assert.deepEqual((await l3.sweepStepBudgets([run1])).changed.map(f => f.kind), ['item', 'question']);
  assert.deepEqual((await l3.sweepStepBudgets([run1])).changed, [], 'the same run swept again changes nothing');
  // the breach is handled: item done, question closed
  db.raw.exec(`UPDATE items SET status='done', disposition='budget justified' WHERE id='STEPBUDGET-REVIEW-CHECK'; UPDATE gate_cards SET status='closed' WHERE id LIKE 'stepq-review-check%'`);
  // a later run of the same step breaches again
  t.v = T0 + 30 * H;
  const run2 = { process: 'review', step: 'check', started_at: t.v - 9 * H, budget_hours: 4 };
  assert.deepEqual((await l3.sweepStepBudgets([run2])).changed.map(f => f.kind), ['item', 'question']);
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='STEPBUDGET-REVIEW-CHECK'`).get().status, 'open');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM gate_cards WHERE id LIKE 'stepq-review-check%'`).get().n, 2);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM gate_cards WHERE id LIKE 'stepq-review-check%' AND status='open'`).get().n, 1);
  await l3.sweepStepBudgets([run2]);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM gate_cards WHERE id LIKE 'stepq-review-check%'`).get().n, 2);
});

test('US-13-R21: a last tick older than the staleness bound is stalled, not healthy, even when it finished every step', async () => {
  const { db, t, l3 } = mk();
  db.raw.exec(`INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES ('2026-11-12 11:59:00','2026-11-12 11:59:01',8,8)`);
  const fresh = await l3.health();
  assert.equal(fresh.verdict, 'healthy'); assert.equal(fresh.healthy, true); assert.deepEqual(fresh.reasons, []); assert.equal(fresh.tick_age_s, 59);
  t.v = T0 + 20 * 60e3;                                     // 20 minutes later: inside the 25-minute bound
  assert.equal((await l3.health()).verdict, 'healthy');
  t.v = T0 + 40 * 60e3;                                     // 40 minutes after the check started; a week of silence would read the same: the clock has stopped
  const stale = await l3.health();
  assert.equal(stale.verdict, 'stalled'); assert.equal(stale.healthy, false); assert.match(stale.reasons[0], /newest check is 41 minutes old; the bound is 25/);
  assert.equal(stale.ok, true, 'ok keeps its first meaning: the last check finished all its steps');
  const res = await l3.handle(new Request('https://x.example/health'));
  assert.equal(res.status, 503); assert.equal((await res.json()).verdict, 'stalled');
});

test('US-13-R21: no check ever is stalled; an unfinished check, recorded errors, all-queued dispatches and a decision waiting on a person are degraded with their reasons', async () => {
  const { db, l3 } = mk();
  assert.deepEqual([(await l3.health()).verdict, (await l3.health()).reasons], ['stalled', ['no check has ever run']]);
  db.raw.exec(`INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total,errors) VALUES ('2026-11-12 11:59:00','2026-11-12 11:59:01',7,8,'["fleet: boom"]');
    INSERT INTO dispatches (tick_id, role_id, item_id, model, status) VALUES (1,'r','A','small','queued'),(1,'r','B','small','queued');
    INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G1','Approve','money','zero','manual')`);
  const h = await l3.health();
  assert.equal(h.verdict, 'degraded'); assert.equal(h.ok, false);
  assert.deepEqual(h.reasons, ['the last check did not finish all its steps', 'the last check recorded 1 error(s)', 'every dispatch of the last check is still queued', '1 item(s) wait on a person']);
});

test('US-13-R05 / R16: a claimed drop item survives a second fall in the same dimension; a closed one reopens; created_at follows the injected clock', async () => {
  const { db, t, l3 } = mk();
  const card = s => l3.recordCard({ name: 'autonomy', rubric: 'r1', limits: LIMITS, scores: [good('loops', s)] });
  await card(4); await card(3); // first fall files L3-DROP-AUTONOMY-LOOPS
  const row = () => ({ ...db.raw.prepare("SELECT status, created_at FROM items WHERE id='L3-DROP-AUTONOMY-LOOPS'").get() });
  assert.equal(row().status, 'open'); assert.equal(row().created_at, '2026-11-12 12:00:00');
  db.raw.exec("UPDATE items SET status='claimed' WHERE id='L3-DROP-AUTONOMY-LOOPS'");
  t.v += 3600e3; await card(2); // a third, falling card
  assert.equal(row().status, 'claimed', 'an active item is not reset to open');
  db.raw.exec("UPDATE items SET status='done' WHERE id='L3-DROP-AUTONOMY-LOOPS'");
  t.v += 3600e3; await card(1);
  assert.equal(row().status, 'open', 'a closed item reopens when the dimension falls again');
});

test('US-13-R21 / R01: the console serves /api/console/fleet/health behind sign-in with the graded verdict', async () => {
  const { db, l3 } = mk(); seed(db);
  const env = { DB: db, CONSOLE_TOKEN: 'console-token-1234' };
  const o = { l3, now: () => T0 };
  const cookie = 'us_console=' + encodeURIComponent(env.CONSOLE_TOKEN);
  assert.equal((await handleConsole(new Request('https://x.example/api/console/fleet/health'), env, o)).status, 401);
  const res = await handleConsole(new Request('https://x.example/api/console/fleet/health', { headers: { cookie } }), env, o);
  const h = await res.json();
  assert.ok(['healthy', 'degraded', 'stalled'].includes(h.verdict)); assert.ok(Array.isArray(h.reasons));
  assert.equal(res.status, h.verdict === 'stalled' ? 503 : 200, 'the status follows the verdict, so the route is served, not a 404');
});
