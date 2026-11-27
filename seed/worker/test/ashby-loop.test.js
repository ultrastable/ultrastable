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

test('veto: an upset variable that stays out keeps the value rejected, and the step is cleared only after stale_days', async () => {
  const db = makeDb(); await stepped(db);
  vals.a = 0.6; vals.b = 0.1; await step(db, t0 + 23 * H); await step(db, t0 + 24 * H - 1);
  assert.equal((await step(db, t0 + 25 * H)).vetoed.length, 1);
  vals.a = 0.2;  // b stays out although the step was undone
  const wait = await step(db, t0 + 50 * H);
  assert.deepEqual(wait.settled, []); assert.deepEqual(wait.adjusted, [], 'the step-function does not move while its undo is read alone');
  const s = await step(db, t0 + 51 * H);
  assert.deepEqual(s.settled, [], 'one day is not long enough to clear a step: b may be slow to return');
  assert.deepEqual(s.adjusted, [{ knob: 'core.k', old: 4, new: 5, goal: 'core.a', search: true }], 'the vetoed value stays rejected; the search takes the other side');
  assert.equal(db.raw.prepare('SELECT exonerated FROM goal_interference').get().exonerated, null);
  const late = await step(db, t0 + 25 * H + 15 * DAY);
  assert.deepEqual(late.settled, [{ knob: 'core.k', upset: 'core.b', confirmed: false }], 'b never returned in 14 days: the step is cleared');
  assert.equal((await structureOf(db, { now: t0 + 41 * DAY })).interference[0].verdict, 'cleared');
});

test('veto: an upset variable that is slow to return still confirms the step, and one whose own knob moved shows nothing', async () => {
  const db = makeDb(); await stepped(db);
  vals.a = 0.6; vals.b = 0.1; await step(db, t0 + 23 * H); await step(db, t0 + 24 * H - 1);
  await step(db, t0 + 25 * H); await step(db, t0 + 50 * H); await step(db, t0 + 51 * H);  // still out after the first review period
  vals.b = 0.9; await step(db, t0 + 5 * DAY);  // b is read inside its limits on day 5
  assert.deepEqual((await step(db, t0 + 5 * DAY + H)).settled, [{ knob: 'core.k', upset: 'core.b', confirmed: true }]);
  // the same history, but b has a knob of its own that moved while the undo was being read
  const db2 = makeDb(), both = { goals: cfg.goals, knobs: [...cfg.knobs, { id: 'core.kb', goal_id: 'core.b', value: 2, min: 1, max: 3, step: 1, effect: 1, cooldown_h: 1, review_h: 1 }] };
  const st2 = now => goalsStep(db2, { now, config: {} }, both, { builtins });
  vals.a = 0.6; vals.b = 0.9; for (const h of [3, 2, 1]) await st2(t0 - h * H); vals.a = 0.2; await st2(t0);
  vals.a = 0.6; vals.b = 0.1; await st2(t0 + 23 * H); await st2(t0 + 24 * H - 1);
  const v = await st2(t0 + 25 * H); assert.equal(v.vetoed.length, 1);
  assert.ok(db2.raw.prepare("SELECT COUNT(*) AS n FROM goal_adjustments WHERE goal_id='core.b'").get().n >= 1, "b's own knob moved");
  vals.b = 0.9; await st2(t0 + 50 * H);
  assert.deepEqual((await st2(t0 + 51 * H)).settled, [{ knob: 'core.k', upset: 'core.b', confirmed: false, confounded: true }]);
});

test('veto: a veto whose upset variable is retired is cleared, so the step-function is never left unable to move', async () => {
  const db = makeDb(); await stepped(db);
  vals.a = 0.6; vals.b = 0.1; await step(db, t0 + 23 * H); await step(db, t0 + 24 * H - 1);
  assert.equal((await step(db, t0 + 25 * H)).vetoed.length, 1);
  db.raw.prepare("UPDATE goals SET status='retired' WHERE id='core.b'").run(); vals.a = 0.2;
  const only = { goals: [cfg.goals[0]], knobs: cfg.knobs };
  const s = await goalsStep(db, { now: t0 + 50 * H, config: {} }, only, { builtins });
  assert.deepEqual(s.settled, [{ knob: 'core.k', upset: 'core.b', confirmed: false }]);
  assert.deepEqual(s.adjusted, [{ knob: 'core.k', old: 4, new: 3, goal: 'core.a' }]);
});

test('a step is not vetoed by a variable that was not holding, and a kept step is remembered as the direction that worked', async () => {
  const db = makeDb(); vals.a = 0.2; vals.b = 0.1;  // b was never inside its limits
  await step(db, t0 - H); await step(db, t0); vals.a = 0.3;
  const r = await step(db, t0 + 25 * H);
  assert.deepEqual(r.vetoed, []); assert.deepEqual(r.reviewed, [{ knob: 'core.k', kept: true }]);
  assert.deepEqual(r.adjusted, [{ knob: 'core.k', old: 3, new: 2, goal: 'core.a' }]);
});

test('the search goes on past the declared direction until a value holds, and the direction that held is remembered', async () => {
  const db = makeDb(), filed = []; vals.a = 0.2; vals.b = 0.9;
  const fast = { goals: cfg.goals, knobs: [{ id: 'core.k', goal_id: 'core.a', value: 4, min: 1, max: 8, step: 1, effect: -1, cooldown_h: 1, review_h: 1 }] };
  const run = now => goalsStep(db, { now, nowIso: new Date(now).toISOString(), config: {} }, fast, { builtins, ensureItem: async (_d, it) => { filed.push(it.id); return true; } });
  assert.deepEqual((await run(t0)).adjusted, [{ knob: 'core.k', old: 4, new: 3, goal: 'core.a' }]);
  await run(t0 + 2 * H);  // 3 failed: the declared direction rests a week
  assert.deepEqual((await run(t0 + 4 * H)).adjusted, [{ knob: 'core.k', old: 4, new: 5, goal: 'core.a', search: true }]);
  await run(t0 + 6 * H);  // 5 failed too; a failure on the searched side does not end the rest of the declared side
  assert.equal(db.raw.prepare("SELECT hold_dir FROM goal_knobs WHERE id='core.k'").get().hold_dir, -1);
  assert.deepEqual((await run(t0 + 8 * H)).adjusted, [{ knob: 'core.k', old: 4, new: 6, goal: 'core.a', search: true }], 'not 2: the declared side is resting, and trials that failed are not chatter that slows the search');
  vals.a = 0.3; const k = await run(t0 + 10 * H);  // 6 moved the goal: kept, although it is against the declared sign
  assert.deepEqual(k.reviewed, [{ knob: 'core.k', kept: true }]);
  assert.deepEqual(k.adjusted, [{ knob: 'core.k', old: 6, new: 7, goal: 'core.a' }], 'the direction that held is tried next, not the declared one');
  const v = await readGoals(db, { now: t0 + 11 * H, loops: false });
  assert.equal(v.structure.black_box.determinate_share, null, 'no move was repeated yet');
  assert.equal(v.structure.largest_joint, 1); assert.equal(v.structure.parts[0].search.feasible, true);
});

test('the lever is filed while the search is on, and a declared step of one knob goes before a searched step of another', async () => {
  const db = makeDb(), filed = []; vals.a = 0.2; vals.b = 0.9;
  const atBound = { goals: cfg.goals, knobs: [{ id: 'core.k', goal_id: 'core.a', value: 1, min: 1, max: 6, step: 1, effect: -1, cooldown_h: 24, review_h: 24 }] };
  const r = await goalsStep(db, { now: t0, config: {} }, atBound, { builtins, ensureItem: async (_d, it) => { filed.push(it); return true; } });
  assert.deepEqual(r.adjusted, [{ knob: 'core.k', old: 1, new: 2, goal: 'core.a', search: true }]);
  assert.deepEqual(filed.map(i => i.id), ['GOAL-core.a'], 'the step moved, so only the searching path can have filed this'); assert.match(filed[0].title, /declared direction of its knobs is spent/);
  const db2 = makeDb(), two = { goals: cfg.goals, knobs: [
    { id: 'core.far', goal_id: 'core.a', value: 1, min: 1, max: 3, step: 1, effect: -1 }, { id: 'core.near', goal_id: 'core.a', value: 50, min: 1, max: 100, step: 1, effect: -1 }] };
  assert.deepEqual((await goalsStep(db2, { now: t0, config: {} }, two, { builtins })).adjusted, [{ knob: 'core.near', old: 50, new: 49, goal: 'core.a' }]);
});

test('a step upset two variables and only one came back: the step stays the cause', async () => {
  const db = makeDb(); const vals3 = { a: 0.6, b: 0.9, c: 0.9 }, b3 = { a: async () => vals3.a, b: async () => vals3.b, c: async () => vals3.c };
  const cfg3 = { goals: [...cfg.goals, { id: 'core.c', level: 'target', statement: 'c high', source: 'builtin', spec: 'c', op: '>=', target: 0.5 }], knobs: cfg.knobs };
  const run = now => goalsStep(db, { now, config: {} }, cfg3, { builtins: b3 });
  for (const h of [3, 2, 1]) await run(t0 - h * H); vals3.a = 0.2; await run(t0);
  vals3.a = 0.6; vals3.b = 0.1; vals3.c = 0.1; await run(t0 + 23 * H); await run(t0 + 24 * H - 1);
  assert.deepEqual((await run(t0 + 25 * H)).vetoed, [{ knob: 'core.k', goal: 'core.a', upset: ['core.b', 'core.c'] }]);
  vals3.a = 0.2; vals3.b = 0.9; await run(t0 + 50 * H);  // b returns, c stays out
  assert.deepEqual((await run(t0 + 51 * H)).settled, [{ knob: 'core.k', upset: 'core.b', confirmed: true }]);
  const late = await run(t0 + 25 * H + 15 * DAY);
  assert.deepEqual(late.settled, [{ knob: 'core.k', upset: 'core.c', confirmed: false }]);
  const tried = db.raw.prepare("SELECT new FROM goal_adjustments WHERE knob_id='core.k' AND at > ?").all(t0 + 25 * H).map(r => r.new);
  assert.ok(!tried.includes(3), 'one cleared verdict does not un-reject a value another variable confirmed against');
});

test('structure: joint rest against the product of the parts, the order of the constraint, and the largest joint component as a metric', async () => {
  const db = makeDb(); vals.a = 0.6;
  for (let i = 0; i < 16; i++) { vals.a = i % 2 ? 0.6 : 0.2; vals.b = i % 2 ? 0.2 : 0.9; await goalsStep(db, { now: t0 + i * H }, { goals: cfg.goals, knobs: [] }, { builtins }); }
  const st = await structureOf(db, { now: t0 + 17 * H });
  assert.equal(st.rest.n, 16); assert.equal(st.rest.product, 0.25); assert.equal(st.rest.observed, 0); assert.equal(st.rest.gap, -0.25);  // each rests half the time, never both
  assert.deepEqual(st.joint_order, { goals: ['core.a', 'core.b'], k: 2, readings: 16 });  // the two must be looked at together
  assert.deepEqual(st.states_seen, { n: 2, bits: 1, readings: 16 }); assert.equal(st.dependence, null, 'fewer than 24 joint readings: dependence is not judged');
  for (let i = 16; i < 26; i++) { vals.a = i % 2 ? 0.6 : 0.2; vals.b = i % 2 ? 0.2 : 0.9; await goalsStep(db, { now: t0 + i * H }, { goals: cfg.goals, knobs: [] }, { builtins }); }
  assert.deepEqual((await structureOf(db, { now: t0 + 27 * H })).dependence, [{ a: 'core.a', b: 'core.b', bits: 1 }], 'one goal fixes the other: a whole bit passes between them');
  assert.equal(await largestJoint(db), 0);
  const many = { goals: cfg.goals, knobs: Array.from({ length: 9 }, (_, i) => ({ id: 'core.k' + i, goal_id: 'core.a', value: 2, min: 1, max: 3, step: 1, effect: 1 })) };
  vals.a = 0.9; vals.b = 0.9; await goalsStep(db, { now: t0 + 30 * H }, many, { builtins });
  assert.equal(await METRICS.largest_joint_component(db), 9);
  const big = await structureOf(db, { now: t0 + 31 * H });
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
  const db3 = makeDb(); db3.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, status, created_at, updated_at) VALUES ('VARIETY-DEFICIT','x','fix','portfolio-manager','x','ready',?,?)`).run(iso(now - 9 * DAY), iso(now - 9 * DAY));
  assert.equal((await varietyReading(db3, now)).uncovered_n, 0, 'the item filed for this reading is its remedy, not a disturbance: counted, nothing could ever close it');
});

test('the two readings of the regulator have no knob, so the goal loop files the lever as work and closes it by the same reading', async () => {
  const db = makeDb(), iso = ms => new Date(ms).toISOString(), filed = []; vals.a = 0.9; vals.b = 0.9;
  const ensure = async (d, it) => { if (await d.prepare('SELECT id FROM items WHERE id=?').bind(it.id).first()) return false; filed.push(it.id); await d.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, status) VALUES (?,?,?,?,?,?,'ready')`).bind(it.id, it.title, it.kind, it.owner_role, it.done_check, it.closing_probe).run(); return true; };
  const run = (now, c = cfg) => goalsStep(db, { now, nowIso: iso(now), config: {} }, c, { builtins, ensureItem: ensure });
  assert.deepEqual((await run(t0)).regulator, {}, 'nothing to file while both readings are clean');
  db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, status, created_at, updated_at) VALUES ('FM-stuck','x','fix','operations','x','ready',?,?)`).run(iso(t0 - 5 * DAY), iso(t0 - 5 * DAY));
  const r = await run(t0 + 2 * H);  // past the hour the reading is kept for
  assert.deepEqual(r.regulator, { 'VARIETY-DEFICIT': 'filed' });
  const it = db.raw.prepare("SELECT * FROM items WHERE id='VARIETY-DEFICIT'").get();
  assert.match(it.title, /1 disturbance classes met no response that held within 72 h: FM-stuck/); assert.equal(it.owner_role, 'portfolio-manager');
  assert.equal(db.raw.prepare(it.closing_probe).get()[Object.keys(db.raw.prepare(it.closing_probe).get())[0]], 0, 'its closing probe is red while the class stands open');
  db.raw.prepare("UPDATE items SET status='done', updated_at=? WHERE id='FM-stuck'").run(iso(t0 + 3 * H));
  assert.deepEqual((await run(t0 + 4 * H)).regulator, { 'VARIETY-DEFICIT': 'closed' });
  assert.match(db.raw.prepare("SELECT disposition FROM items WHERE id='VARIETY-DEFICIT'").get().disposition, /^fixed: /);
  db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, status, created_at, updated_at) VALUES ('BREACH-again','x','fix','operations','x','blocked',?,?)`).run(iso(t0 - 5 * DAY), iso(t0 - 5 * DAY));
  await run(t0 + 6 * H);
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='VARIETY-DEFICIT'").get().status, 'ready', 'the same item is reopened when the reading rises again');
  const many = { goals: cfg.goals, knobs: Array.from({ length: 9 }, (_, i) => ({ id: 'core.j' + i, goal_id: 'core.a', value: 2, min: 1, max: 3, step: 1, effect: 1 })) };
  assert.equal((await run(t0 + 7 * H, many)).regulator['JOINT-TOO-LARGE'], 'filed');
  assert.match(db.raw.prepare("SELECT title FROM items WHERE id='JOINT-TOO-LARGE'").get().title, /^10 step-functions can only be judged together/);
  db.raw.prepare("DELETE FROM goal_knobs WHERE id IN ('core.j7','core.j8')").run();
  assert.equal((await run(t0 + 8 * H, { goals: cfg.goals, knobs: many.knobs.slice(0, 7) })).regulator['JOINT-TOO-LARGE'], 'closed');
});
