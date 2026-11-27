// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ASHBY-KERNEL-1: the mechanisms of ashby.js at work in the goal loop and the tick's metrics, on an in-memory database with a frozen clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { goalsStep, readGoals, knobValues, structureOf, largestJoint } from '../src/goals.js';
import { varietyReading } from '../src/regulation.js';
import { METRICS } from '../src/tick.js';

const H = 3600e3, DAY = 24 * H, t0 = Date.parse('2026-11-18T00:00:00Z');
const vals = { a: 0.2, b: 0.9 }, builtins = { a: async () => vals.a, b: async () => vals.b };
const cfg = { goals: [
  { id: 'core.a', level: 'target', statement: 'a high', source: 'builtin', spec: 'a', op: '>=', target: 0.5 },
  { id: 'core.b', level: 'target', statement: 'b high', source: 'builtin', spec: 'b', op: '>=', target: 0.5 }],
  knobs: [{ id: 'core.k', goal_id: 'core.a', what: 'k', value: 4, min: 1, max: 6, step: 1, effect: -1, cooldown_h: 24, review_h: 24 }] };
const step = (db, now) => goalsStep(db, { now, nowIso: new Date(now).toISOString(), config: {} }, cfg, { builtins });
const kinds = db => db.raw.prepare('SELECT kind FROM audit_log ORDER BY seq').all().map(r => r.kind);
// b holds inside its limits for three readings, then the step for a is taken at t0
async function stepped(db) { vals.a = 0.6; vals.b = 0.9; for (const h of [3, 2, 1]) await step(db, t0 - h * H); vals.a = 0.2; return step(db, t0); }

test('veto: a step that moved its own goal and knocked a holding variable out of its limits is undone, and the undo is read as a trial', async () => {
  const db = makeDb(); const r0 = await stepped(db);
  assert.deepEqual(r0.adjusted, [{ knob: 'core.k', old: 4, new: 3, goal: 'core.a' }]);
  vals.a = 0.6; vals.b = 0.1;  // a is met, b has left its limits
  await step(db, t0 + 23 * H); await step(db, t0 + 24 * H - 1);  // two readings of b outside its limits
  const r = await step(db, t0 + 25 * H);
  assert.deepEqual(r.vetoed, [{ knob: 'core.k', goal: 'core.a', upset: ['core.b'] }]);
  assert.deepEqual(r.reviewed, [{ knob: 'core.k', kept: false }]);
  assert.equal((await knobValues(db, 'core'))['core.k'].value, 4, 'undone');
  assert.ok(kinds(db).includes('goal.veto'));
  const row = db.raw.prepare('SELECT * FROM goal_interference').get();
  assert.equal(row.upset_goal, 'core.b'); assert.equal(row.exonerated, null); assert.equal(row.check_after, t0 + 49 * H);
  // b returns once the step is undone: confirmed, the direction rests a week and the link joins the two goals into one whole
  vals.b = 0.9; assert.deepEqual((await step(db, t0 + 50 * H)).settled, [], 'b is read after the undo first');
  const s = await step(db, t0 + 51 * H);
  assert.deepEqual(s.settled, [{ knob: 'core.k', upset: 'core.b', confirmed: true }]);
  assert.equal(db.raw.prepare('SELECT exonerated FROM goal_interference').get().exonerated, 0);
  assert.equal(db.raw.prepare("SELECT hold_until FROM goal_knobs WHERE id='core.k'").get().hold_until, t0 + 51 * H + 7 * DAY);
  const st = await structureOf(db, { now: t0 + 51 * H });
  assert.deepEqual(st.parts[0].goals, ['core.a', 'core.b']); assert.equal(st.interference[0].verdict, 'confirmed');
  assert.ok(kinds(db).includes('goal.veto.settled'));
});

test('veto: when the upset variable stays out after the undo the step is exonerated and may be tried again', async () => {
  const db = makeDb(); await stepped(db);
  vals.a = 0.6; vals.b = 0.1; await step(db, t0 + 23 * H); await step(db, t0 + 24 * H - 1);
  assert.equal((await step(db, t0 + 25 * H)).vetoed.length, 1);
  vals.a = 0.2;  // b stays out although the step was undone
  const wait = await step(db, t0 + 50 * H);
  assert.deepEqual(wait.settled, []); assert.deepEqual(wait.adjusted, [], 'the step-function does not move while its undo is being read');
  const s = await step(db, t0 + 51 * H);
  assert.deepEqual(s.settled, [{ knob: 'core.k', upset: 'core.b', confirmed: false }]);
  assert.deepEqual(s.adjusted, [{ knob: 'core.k', old: 4, new: 3, goal: 'core.a' }], 'the exonerated value is not held against the step-function');
});

test('a step is not vetoed by a variable that was not holding, and a kept step is remembered as the direction that worked', async () => {
  const db = makeDb(); vals.a = 0.2; vals.b = 0.1;  // b was never inside its limits
  await step(db, t0 - H); await step(db, t0); vals.a = 0.3;
  const r = await step(db, t0 + 25 * H);
  assert.deepEqual(r.vetoed, []); assert.deepEqual(r.reviewed, [{ knob: 'core.k', kept: true }]);
  assert.deepEqual(r.adjusted, [{ knob: 'core.k', old: 3, new: 2, goal: 'core.a' }]);
});

test('the search goes on past the declared direction until a value holds, and the lever is filed while it searches', async () => {
  const db = makeDb(), filed = []; vals.a = 0.2; vals.b = 0.9;
  const run = now => goalsStep(db, { now, nowIso: new Date(now).toISOString(), config: {} }, cfg, { builtins, ensureItem: async (_d, it) => { filed.push(it.id); return true; } });
  await run(t0); assert.deepEqual(filed, []);
  await run(t0 + 25 * H);  // 3 tried and reverted: the designed lever failed, so the lever is filed
  assert.deepEqual(filed, ['GOAL-core.a']);
  const r = await run(t0 + 50 * H);
  assert.deepEqual(r.adjusted, [{ knob: 'core.k', old: 4, new: 5, goal: 'core.a', search: true }]);
  vals.a = 0.7; const k = await run(t0 + 75 * H);  // the other side held: the declared sign was wrong and the search found it
  assert.deepEqual(k.reviewed, [{ knob: 'core.k', kept: true }]); assert.equal((await knobValues(db, 'core'))['core.k'].value, 5);
  const v = await readGoals(db, { now: t0 + 76 * H, loops: false });
  assert.equal(v.structure.black_box.determinate_share, null, 'no move was repeated yet');
  assert.equal(v.structure.largest_joint, 1); assert.equal(v.structure.parts[0].search.feasible, true);
});

test('structure: joint rest against the product of the parts, the order of the constraint, and the largest joint component as a metric', async () => {
  const db = makeDb(); vals.a = 0.6;
  for (let i = 0; i < 16; i++) { vals.a = i % 2 ? 0.6 : 0.2; vals.b = i % 2 ? 0.2 : 0.9; await goalsStep(db, { now: t0 + i * H }, { goals: cfg.goals, knobs: [] }, { builtins }); }
  const st = await structureOf(db, { now: t0 + 17 * H });
  assert.equal(st.rest.n, 16); assert.equal(st.rest.product, 0.25); assert.equal(st.rest.observed, 0); assert.equal(st.rest.gap, -0.25);  // each rests half the time, never both
  assert.deepEqual(st.joint_order, { goals: ['core.a', 'core.b'], k: 2, readings: 16 });  // the two must be looked at together
  assert.equal(await largestJoint(db), 0);
  const many = { goals: cfg.goals, knobs: Array.from({ length: 9 }, (_, i) => ({ id: 'core.k' + i, goal_id: 'core.a', value: 2, min: 1, max: 3, step: 1, effect: 1 })) };
  vals.a = 0.9; vals.b = 0.9; await goalsStep(db, { now: t0 + 20 * H }, many, { builtins });
  assert.equal(await METRICS.largest_joint_component(db), 9);
  const big = await structureOf(db, { now: t0 + 21 * H });
  assert.equal(big.irreducible.length, 1); assert.equal(big.parts[0].search.feasible, false, '3^9 settings cannot be searched in a year of two-day trials');
});

test('requisite variety from the work queue: a fix item open past the grace period is a disturbance no response held', async () => {
  const db = makeDb(), now = t0 + 10 * DAY, iso = ms => new Date(ms).toISOString();
  const put = (id, status, created, updated, kind = 'fix') => db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(id, id, kind, 'operations', 'x', status, created, updated);
  put('BREACH-m1', 'done', iso(now - 5 * DAY), iso(now - 4 * DAY)); put('FM-x', 'done', iso(now - 3 * DAY), iso(now - 2 * DAY));
  put('MISSED-loop', 'ready', iso(now - 4 * DAY).replace('T', ' ').slice(0, 19), iso(now - 4 * DAY));  // the database default format
  put('IGNITE-closing', 'blocked', iso(now - 6 * DAY), iso(now - 6 * DAY)); put('FM-new', 'ready', iso(now - 2 * H), iso(now - 2 * H));
  put('PLUS-1', 'ready', iso(now - 9 * DAY), iso(now - 9 * DAY), 'plus'); put('BREACH-old', 'done', iso(now - 30 * DAY), iso(now - 20 * DAY));
  const v = await varietyReading(db, now);
  assert.equal(v.disturbances, 4); assert.equal(v.covered, 2); assert.deepEqual(v.uncovered, ['IGNITE-closing', 'MISSED-loop']);
  assert.equal(v.pending, 1, 'an item inside the grace period is not judged yet'); assert.equal(v.deficit_bits, 1);
  assert.equal(await METRICS.unregulated_disturbances_14d(db, now), 2);
  db.raw.prepare(`UPDATE items SET status='done', updated_at=? WHERE id='MISSED-loop'`).run(iso(now));
  assert.equal(await METRICS.unregulated_disturbances_14d(db, now + 10 * 60e3), 2, 'the reading is kept for an hour');
  assert.equal(await METRICS.unregulated_disturbances_14d(db, now + 61 * 60e3), 1);
  assert.equal((await varietyReading(makeDb(), now)).regulated_share, null, 'an empty queue is unmeasured');
});
