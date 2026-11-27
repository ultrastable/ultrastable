// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { pullFeeds, goalsStep, seedGoals, registerTenant, reportReadings, knobValues, withKnobs, readGoals, validate, trend, knobSnapshot, restoreSnapshot } from '../src/goals.js';
import { METRICS } from '../src/tick.js';

const H = 3600e3, t0 = Date.parse('2026-11-18T00:00:00Z');
let val = 0.2; const builtins = { x: async () => val };
const cfg = { control: { achieve_after: 3, stale_days: 14 }, goals: [
  { id: 'core.t', level: 'target', statement: 'x high', source: 'builtin', spec: 'x', op: '>=', target: 0.5 }],
  knobs: [{ id: 'core.k', goal_id: 'core.t', what: 'k', config_path: 'pace.idle_runs', value: 4, min: 1, max: 6, step: 1, effect: -1, cooldown_h: 24, review_h: 24 }] };
const step = (db, now) => goalsStep(db, { now, nowIso: new Date(now).toISOString(), config: {} }, cfg, { builtins });

test('an off-target goal moves its knob one step in the right direction and logs it to the audit chain', async () => {
  const db = makeDb(); val = 0.2;
  const r = await step(db, t0);
  assert.deepEqual(r.adjusted, [{ knob: 'core.k', old: 4, new: 3, goal: 'core.t' }]);  // effect -1, need + : lower the knob
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_log WHERE kind='goal.knob'").first()).n, 1);
  assert.equal((await knobValues(db, 'core'))['core.k'].value, 3);
  assert.equal((await withKnobs(db, { pace: { idle_runs: 4, max_stride: 4 } })).pace.idle_runs, 3);  // a real config value is overridden
  const r2 = await step(db, t0 + H); assert.equal(r2.adjusted.length, 0);  // pending review and cooldown: no second move
});
test('a change that did not help is reverted at review and that direction rests', async () => {
  const db = makeDb(); val = 0.2; await step(db, t0);
  const r = await step(db, t0 + 25 * H);
  assert.deepEqual(r.reviewed, [{ knob: 'core.k', kept: false }]);
  assert.equal((await knobValues(db, 'core'))['core.k'].value, 4);
  assert.equal(r.adjusted.length, 0);  // resting: no ping-pong
  const v = await readGoals(db, { now: t0 + 26 * H, loops: false });
  assert.equal(v.adjustments[0].verdict, 'reverted'); assert.ok(v.knobs[0].resting_until);
});
test('a change that helped is kept, and a goal held met proposes one stretch goal', async () => {
  const db = makeDb(); val = 0.2; await step(db, t0);
  val = 0.6; const r = await step(db, t0 + 25 * H);
  assert.deepEqual(r.reviewed, [{ knob: 'core.k', kept: true }]);
  assert.equal((await knobValues(db, 'core'))['core.k'].value, 3);
  await step(db, t0 + 26 * H); const r3 = await step(db, t0 + 27 * H);
  assert.deepEqual(r3.stretch, ['core.t+']);
  const g = await db.prepare("SELECT * FROM goals WHERE id='core.t+'").first();
  assert.equal(g.target, 0.625); assert.equal(g.origin, 'system');
  assert.equal((await db.prepare("SELECT goal_id FROM goal_knobs WHERE id='core.k'").first()).goal_id, 'core.t+');
});
test('a goal no knob can move files one backlog item that closes itself when the goal is met', async () => {
  const db = makeDb(); val = 0.2; const filed = [];
  const c2 = { goals: cfg.goals, knobs: [] };
  await goalsStep(db, { now: t0 }, c2, { builtins, ensureItem: async (_d, it) => { filed.push(it); return true; } });
  assert.equal(filed.length, 1); assert.equal(filed[0].id, 'GOAL-core.t'); assert.match(filed[0].closing_probe, /^SELECT COUNT/);
});
test('tenant interface: register, report, knob values; ids are namespaced and bounded', async () => {
  const db = makeDb();
  const body = { goals: [{ id: 'ps.solutions', level: 'target', statement: 'New solutions a week', op: '>=', target: 5, source: 'tenant' }],
    knobs: [{ id: 'ps.breadth', goal_id: 'ps.solutions', value: 3, min: 1, max: 9, step: 1, effect: 1 }] };
  assert.equal((await registerTenant(db, 'ps', body, { now: t0 })).ok, true);
  assert.equal((await registerTenant(db, 'core', body)).ok, false);
  assert.ok(validate({ goals: [{ id: 'x.y', level: 'target', statement: 's', op: '>=', target: 1 }] }, 'ps').length);
  assert.deepEqual(await reportReadings(db, 'ps', { 'ps.solutions': 2, 'core.t': 1 }, { now: t0 }), { 'ps.solutions': 'recorded', 'core.t': 'ignored' });
  const r = await goalsStep(db, { now: t0 + H }, null, { builtins });
  assert.equal(r.adjusted[0].knob, 'ps.breadth'); assert.equal(r.adjusted[0].new, 4);  // raise the knob (effect +) to raise the metric
  assert.equal((await knobValues(db, 'ps'))['ps.breadth'].value, 4);
  assert.equal((await knobValues(db, 'core'))['ps.breadth'], undefined);  // never commingled
  assert.equal((await METRICS.goal_tenants(db)), 1);
});
test('a tenant goal with no reading for stale_days is retired; a seed goal is not', async () => {
  const db = makeDb();
  await registerTenant(db, 'ps', { goals: [{ id: 'ps.a', level: 'target', statement: 's', op: '>=', target: 1, source: 'tenant' }] }, { now: t0 });
  const r = await goalsStep(db, { now: t0 + 15 * 86400e3 }, { goals: cfg.goals }, { builtins: {} });
  assert.deepEqual(r.retired, ['ps.a']);
});
test('trend needs readings and reports slope per day', () => {
  assert.equal(trend([{ at: 0, value: 1 }]).slope_per_day, null);
  assert.equal(trend([0, 1, 2, 3].map(i => ({ at: i * 86400e3, value: i * 0.1 }))).slope_per_day, 0.1);
});
test('seedGoals is idempotent and never resets a knob the loop moved', async () => {
  const db = makeDb(); await seedGoals(db, cfg, { now: t0 }); await step(db, t0); await seedGoals(db, cfg, { now: t0 + H });
  assert.equal((await knobValues(db, 'core'))['core.k'].value, 3);
});
test('a tenant feed is pulled, registered under its namespace and its readings recorded; a feed naming another tenant is refused; a tenant goal never files a core item', async () => {
  const db = makeDb(), feed = { tenant: 'ps', goals: [{ id: 'ps.a', level: 'target', statement: 's', op: '>=', target: 2 }], knobs: [{ id: 'ps.k', goal_id: 'ps.a', value: 1, min: 1, max: 3, step: 1 }], readings: { 'ps.a': 1 } };
  const ok = async () => ({ ok: true, text: async () => JSON.stringify(feed) });
  assert.deepEqual(await pullFeeds(db, [{ tenant: 'ps', url: 'https://x/goals.json' }], { fetchFn: ok, now: t0 }), { ps: { registered: 2, readings: 1 } });
  assert.deepEqual(await pullFeeds(db, [{ tenant: 'ps', url: 'https://x/goals.json' }], { fetchFn: ok, now: t0 + H }), { ps: { registered: 0, readings: 1 } });
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_log WHERE kind='goals.register'").first()).n, 1);  // re-reading the same feed is not audited again
  assert.match((await pullFeeds(db, [{ tenant: 'zz', url: 'u' }], { fetchFn: ok }))['zz'], /another tenant/);
  const filed = []; await goalsStep(db, { now: t0 + 2 * H, fetch: ok }, { goals: [], knobs: [], tenant_feeds: [{ tenant: 'ps', url: 'u' }] }, { builtins, ensureItem: async (_d, it) => { filed.push(it); return true; } });
  assert.equal(filed.length, 0);
});

import { runTick } from '../src/tick.js';
test('a degraded free tier never leaves the goal tree unseeded (the step is skipped, the seed is not)', async () => {
  const db = makeDb();
  const noon = Date.parse('2026-11-18T12:30:00Z');  // minute 30: the hourly control pass does not run
  await db.prepare("INSERT INTO free_tier_samples (at, resource, used_today) VALUES (?,?,?)").bind(new Date(noon - 600e3).toISOString().replace('T', ' ').slice(0, 19), 'd1_rows_read', 2_600_000).run();
  await runTick(db, { config: { org_slug: 't', policy: {}, goals: cfg }, now: noon });
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM goals').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM goal_knobs').first()).n, 1);
});
test('the hourly control pass still runs when the tick is lean (a cost breach must not freeze the knobs)', async () => {
  const db = makeDb(); const hour = Date.parse('2026-11-18T12:05:00Z');
  const r = await runTick(db, { config: { org_slug: 't', policy: {}, goals: cfg, cost_budgets: [{ target: 'x', max_rows_read_per_hour: 0 }] }, now: hour });
  assert.ok(r);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM goals').first()).n, 1);
});

test('PEREZ-LOPEZ-1: while an essential goal is off target, no other goal moves a knob', async () => {
  const db = makeDb(); let ev = 0;
  const c = { control: { essential: ['core.ev'] }, goals: [
    { id: 'core.t', level: 'target', statement: 'x high', source: 'builtin', spec: 'x', op: '>=', target: 0.5 },
    { id: 'core.ev', level: 'target', statement: 'ev zero', source: 'builtin', spec: 'ev', op: '<=', target: 0 }],
    knobs: [{ id: 'core.k', goal_id: 'core.t', what: 'k', value: 4, min: 1, max: 6, step: 1, effect: -1, cooldown_h: 24, review_h: 24 }] };
  const b = { x: async () => 0.2, ev: async () => ev };
  ev = 3; const r = await goalsStep(db, { now: t0 }, c, { builtins: b });
  assert.equal(r.adjusted.length, 0); assert.deepEqual(r.held, [{ goal: 'core.t', essential_off: ['core.ev'] }]);
  ev = 0; const r2 = await goalsStep(db, { now: t0 + H }, c, { builtins: b });
  assert.deepEqual(r2.adjusted.map(a => a.knob), ['core.k']);
});
test('ASHBY step 3: every knob move records a snapshot of all knobs, and restoring it undoes the step', async () => {
  const db = makeDb(); val = 0.2;
  await step(db, t0);
  const row = await db.prepare("SELECT data FROM audit_log WHERE kind='goal.knob'").first();
  const snap = JSON.parse(row.data).snapshot;
  assert.deepEqual(snap, { 'core.k': 4 });
  assert.deepEqual(await knobSnapshot(db), { 'core.k': 3 });
  assert.deepEqual(await restoreSnapshot(db, snap, { now: t0 + H }), ['core.k']);
  assert.equal((await knobValues(db, 'core'))['core.k'].value, 4);
  assert.deepEqual(await restoreSnapshot(db, snap, { now: t0 + 2 * H }), []);  // idempotent
});
