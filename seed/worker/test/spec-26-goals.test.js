// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-26 (goals, knobs, damping, error budgets, pacing): each test is named by the requirement it proves. Frozen clocks, in-memory databases, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick, ensureItem } from '../src/tick.js';
import { goalsStep, seedGoals, readGoal, registerTenant, reportReadings, knobValues, withKnobs, readGoals, validate, pullFeeds, DEFAULTS, LEVELS } from '../src/goals.js';
import { reversals, dampedCooldown, burnRate, errorBudget, BURN_RULES } from '../src/control.js';
import { beat } from '../src/pulse.js';
import { isIdle, strideFor, paced, applyTuning, rankRows, PACE_DEFAULTS } from '../src/pace.js';
import { tune } from '../src/roi.js';
import { GENESIS } from '../src/auditchain.js';

const H = 3600e3, DAY = 24 * H, t0 = Date.parse('2026-11-18T00:00:00Z');
const goalsJson = JSON.parse(readFileSync(new URL('../../autonomy/goals.json', import.meta.url), 'utf8'));
const paceJson = JSON.parse(readFileSync(new URL('../../autonomy/pace.json', import.meta.url), 'utf8'));
const vals = { x: 0.2, y: 0.2, z: 0.2, w: 0.2 }; const builtins = Object.fromEntries(Object.keys(vals).map(k => [k, async () => vals[k]]));
const goal = (id, o = {}) => ({ id, level: 'target', statement: `${id} high`, source: 'builtin', spec: o.spec || 'x', op: '>=', target: 0.5, ...o });
const knob = (id, goal_id, o = {}) => ({ id, goal_id, what: id, value: 4, min: 1, max: 6, step: 1, effect: -1, cooldown_h: 24, review_h: 24, ...o });
const run = (db, cfg, now, extra = {}, opt = {}) => goalsStep(db, { now, nowIso: new Date(now).toISOString(), config: {}, ...extra }, cfg, { builtins, ...opt });
const one = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const kinds = db => db.raw.prepare('SELECT kind FROM audit_log ORDER BY seq').all().map(r => r.kind);

test('US-26-R37: goals form a mission, objective, target hierarchy seeded from config; a re-seed never resets a knob the loop moved and clamps it into new bounds', async () => {
  assert.deepEqual(LEVELS, ['mission', 'objective', 'target']);
  const ids = new Set(goalsJson.goals.map(g => g.id));
  assert.equal(goalsJson.goals.filter(g => g.level === 'mission').length, 1);
  for (const g of goalsJson.goals) {
    assert.ok(LEVELS.includes(g.level) && /^core\./.test(g.id), g.id);
    if (g.level !== 'mission') assert.ok(ids.has(g.parent_id), `${g.id} has a parent`);
    if (g.level === 'target') assert.ok(['builtin', 'metric'].includes(g.source) && g.spec && g.op && typeof g.target === 'number', `${g.id} is measurable`);
  }
  for (const k of goalsJson.knobs) assert.ok(ids.has(k.goal_id) && k.min <= k.value && k.value <= k.max && k.step > 0 && [1, -1].includes(k.effect), k.id);
  const cfg = { goals: [goal('core.t')], knobs: [knob('core.k', 'core.t')] };
  const db = makeDb();
  assert.equal(await seedGoals(db, cfg, { now: t0 }), 2); await seedGoals(db, cfg, { now: t0 });
  assert.equal((await one(db, 'SELECT COUNT(*) n FROM goals')).n, 1); assert.equal((await one(db, 'SELECT COUNT(*) n FROM goal_knobs')).n, 1);
  assert.equal((await one(db, "SELECT origin FROM goals WHERE id='core.t'")).origin, 'seed');
  await run(db, cfg, t0);  // the loop lowers the knob to 3
  await seedGoals(db, cfg, { now: t0 + H });
  assert.equal((await knobValues(db, 'core'))['core.k'].value, 3);
  await seedGoals(db, { goals: cfg.goals, knobs: [knob('core.k', 'core.t', { min: 4, max: 6 })] }, { now: t0 + 2 * H });
  assert.equal((await knobValues(db, 'core'))['core.k'].value, 4, 'a value outside the new bounds is clamped into them');
  // the shipped goals have parents (checked above); a registered tenant goal MAY omit one
  const t = await registerTenant(makeDb(), 'acme', { goals: [{ id: 'acme.t', level: 'target', statement: 's', op: '>=', target: 1, source: 'tenant' }] });
  assert.equal(t.ok, true); assert.equal(t.created, 1);
  // a named parent needs only the right prefix (or to be named in the same registration); validate() does not check that it exists
  const parent = p => registerTenant(makeDb(), 'acme', { goals: [{ id: 'acme.t', parent_id: p, level: 'target', statement: 's', op: '>=', target: 1, source: 'tenant' }] });
  for (const p of ['core.nonexistent', 'acme.nowhere']) assert.equal((await parent(p)).ok, true, `${p}: the prefix is enough`);
  const sib = await registerTenant(makeDb(), 'acme', { goals: [{ id: 'acme.o', level: 'objective', statement: 'o' }, { id: 'acme.t', parent_id: 'acme.o', level: 'target', statement: 's', op: '>=', target: 1, source: 'tenant' }] });
  assert.equal(sib.ok, true, 'a parent named in the same registration');
  const other = await parent('other.x');
  assert.equal(other.ok, false); assert.match(JSON.stringify(other), /parent must be a acme\. or core\. goal/);
});

test('US-26-R38: each tick reads every active target from its source, samples it, tracks met and streak, and retires or files an item for a goal nobody can read for 14 days', async () => {
  const db = makeDb(); const cfg = { goals: [goal('core.t')], knobs: [] };
  vals.x = 0.7; await run(db, cfg, t0); vals.x = 0.8; await run(db, cfg, t0 + H); vals.x = 0.1; await run(db, cfg, t0 + 2 * H);
  const g = await one(db, "SELECT * FROM goals WHERE id='core.t'");
  assert.equal(g.met, 0); assert.equal(g.streak, 0); assert.equal(g.last_value, 0.1);
  assert.deepEqual(db.raw.prepare("SELECT value FROM goal_samples WHERE goal_id='core.t' ORDER BY at").all().map(r => r.value), [0.7, 0.8, 0.1]);
  vals.x = 0.7; await run(db, cfg, t0 + 3 * H); await run(db, cfg, t0 + 4 * H);
  assert.equal((await one(db, "SELECT streak FROM goals WHERE id='core.t'")).streak, 2);
  // the four sources
  await db.prepare("INSERT INTO metrics (id, name, kind, source, spec, op, threshold, owner_role, remedy, last_value) VALUES ('m-1','m','target','builtin','x','>=',0,'operations','r', 0.33)").run();
  const row = src => ({ source: src, spec: src === 'metric' ? 'm-1' : 'x' });
  assert.equal(await readGoal(db, { ...row('metric') }, { builtins, now: t0 }), 0.33);
  assert.equal(await readGoal(db, { ...row('builtin') }, { builtins, now: t0 }), 0.7);
  assert.equal(await readGoal(db, { source: 'builtin', spec: 'nope' }, { builtins, now: t0 }), null, 'a builtin that does not exist is unread, not zero');
  const rep = { source: 'tenant', last_value: 5, last_at: t0 - 13 * DAY };
  assert.equal(await readGoal(db, rep, { now: t0 }), 5); assert.equal(await readGoal(db, { ...rep, last_at: t0 - 15 * DAY }, { now: t0 }), null, 'a stale report is no reading');
  // no reading for stale_days: a seed goal files an item, a tenant goal is retired with its reason and an audit row
  const db2 = makeDb(); const filed = [];
  await seedGoals(db2, { goals: [goal('core.u', { spec: 'missing' })] }, { now: t0 });
  await registerTenant(db2, 'ps', { goals: [{ id: 'ps.a', level: 'target', statement: 's', op: '>=', target: 1, source: 'tenant' }] }, { now: t0 });
  const r = await goalsStep(db2, { now: t0 + 15 * DAY, nowIso: '2026-12-03 00:00:00' }, { goals: [goal('core.u', { spec: 'missing' })] }, { builtins, ensureItem: async (_d, it) => { filed.push(it); return true; } });
  assert.deepEqual(r.retired, ['ps.a']); assert.equal((await one(db2, "SELECT retired_reason FROM goals WHERE id='ps.a'")).retired_reason, 'no reading for 14 days');
  assert.equal(filed.length, 1); assert.equal(filed[0].id, 'GOAL-NOREAD-core.u'); assert.equal(filed[0].priority, 5); assert.equal(filed[0].owner_role, 'operations');
  assert.equal((await one(db2, "SELECT status FROM goals WHERE id='core.u'")).status, 'active', 'a seed goal is never retired');
  assert.deepEqual([DEFAULTS.stale_days, DEFAULTS.achieve_after, DEFAULTS.max_adjust_per_run, DEFAULTS.max_stretch_per_day, DEFAULTS.keep_samples_days], [14, 12, 3, 2, 30]);
  vals.x = 0.2;
});

test('US-26-R39: an off-target goal moves one knob one step toward its target, never past a bound, with a prediction and at most three goals per tick', async () => {
  vals.x = vals.y = vals.z = vals.w = 0.2;
  const db = makeDb();
  const cfg = { goals: [goal('core.t')], knobs: [knob('core.wide', 'core.t', { min: 1, max: 10, value: 5 }), knob('core.narrow', 'core.t', { min: 1, max: 3, value: 2 })] };
  const r = await run(db, cfg, t0);
  assert.equal(r.adjusted.length, 1, 'one knob per goal: the one with the most room, here the narrow range');
  assert.deepEqual(r.adjusted[0], { knob: 'core.narrow', old: 2, new: 1, goal: 'core.t' }, 'effect -1 and a metric that must rise: the knob goes down one step');
  const a = db.raw.prepare('SELECT * FROM goal_adjustments').get();
  assert.equal(a.prediction, 'core.t moves toward >= 0.5 (from 0.2) within 24 h'); assert.equal(a.baseline, 0.2); assert.equal(a.review_after, t0 + 24 * H);
  const r2 = await run(db, cfg, t0 + H); assert.equal(r2.adjusted.length, 0, 'an unreviewed move holds the goal');
  // a lower-is-better goal and an effect +1 knob go the other way; a knob at its bound cannot move
  vals.y = 0.9;
  const db2 = makeDb(); const c2 = { goals: [goal('core.y', { spec: 'y', op: '<=', target: 0.5 })], knobs: [knob('core.up', 'core.y', { effect: 1, value: 3 })] };
  assert.equal((await run(db2, c2, t0)).adjusted[0].new, 2);
  const db3 = makeDb(); const c3 = { goals: [goal('core.t')], knobs: [knob('core.floor', 'core.t', { value: 1 })] };
  assert.equal((await run(db3, c3, t0)).adjusted.length, 0);
  // three goals a tick at most, however many are off target
  const db4 = makeDb(); const names = ['x', 'y', 'z', 'w'];
  const c4 = { goals: names.map(n => goal('core.' + n, { spec: n })), knobs: names.map(n => knob('core.k' + n, 'core.' + n)) };
  vals.y = vals.x = 0.2;
  assert.equal((await run(db4, c4, t0)).adjusted.length, 3);
  assert.equal((await run(db4, c4, t0 + H)).adjusted.length, 1, 'the goal left over by the cap is moved on the next tick; the three with an unreviewed move are held');
});

test('US-26-R40: after its review time a move is kept when the goal is met or improved by more than one percent of the target, else reverted and that direction rests seven days', async () => {
  vals.x = 0.2;
  const db = makeDb(); const cfg = { goals: [goal('core.t')], knobs: [knob('core.k', 'core.t')] };
  await run(db, cfg, t0);
  const early = await run(db, cfg, t0 + 23 * H); assert.deepEqual(early.reviewed, [], 'not before review_h');
  const r = await run(db, cfg, t0 + 25 * H);
  assert.deepEqual(r.reviewed, [{ knob: 'core.k', kept: false }]);
  const k = await one(db, "SELECT * FROM goal_knobs WHERE id='core.k'");
  assert.equal(k.value, 4, 'reverted to the old value'); assert.equal(k.hold_dir, -1); assert.equal(k.hold_until, t0 + 25 * H + 7 * DAY);
  assert.equal(r.adjusted.length, 0, 'the same direction rests');
  assert.equal((await run(db, cfg, t0 + 6 * DAY)).adjusted.length, 0);
  assert.equal((await run(db, cfg, t0 + 33 * H + 7 * DAY)).adjusted.length, 1, 'after the rest it may try again');
  const v = await readGoals(db, { now: t0 + 9 * DAY, loops: false });
  assert.deepEqual(v.adjustments.map(x => x.verdict).sort(), ['pending', 'reverted']);
  // improved by more than 1 percent of the target (0.005): kept, the knob stays
  const db2 = makeDb(); vals.x = 0.2; await run(db2, cfg, t0); vals.x = 0.21;
  const kept = await run(db2, cfg, t0 + 25 * H);
  assert.deepEqual(kept.reviewed, [{ knob: 'core.k', kept: true }]);
  assert.equal((await one(db2, 'SELECT kept FROM goal_adjustments ORDER BY id LIMIT 1')).kept, 1);
  assert.deepEqual(kept.adjusted, [{ knob: 'core.k', old: 3, new: 2, goal: 'core.t' }], 'the goal is still off target, so the loop takes the next step the same tick');
  const db3 = makeDb(); vals.x = 0.2; await run(db3, cfg, t0); vals.x = 0.203;
  assert.deepEqual((await run(db3, cfg, t0 + 25 * H)).reviewed, [{ knob: 'core.k', kept: false }], 'a move inside one percent of the target is noise');
  vals.x = 0.2;
});

test('US-26-R41: a knob that names a config_path overrides that value in the tick config; paths of other tenants and malformed paths are ignored', async () => {
  const idle = goalsJson.knobs.find(k => k.id === 'core.pace.idle_runs'), stride = goalsJson.knobs.find(k => k.id === 'core.pace.max_stride');
  assert.deepEqual([idle.config_path, stride.config_path], ['pace.idle_runs', 'pace.max_stride']);
  const db = makeDb(); await seedGoals(db, goalsJson, { now: t0 });
  await db.prepare("UPDATE goal_knobs SET value = 2 WHERE id = 'core.pace.idle_runs'").run();
  const base = { pace: { idle_runs: 4, max_stride: 4, never_pace: ['executor'], gauges: [] }, other: 1 };
  const cfg = await withKnobs(db, base);
  assert.equal(cfg.pace.idle_runs, 2); assert.equal(cfg.pace.max_stride, 4); assert.equal(cfg.other, 1); assert.equal(base.pace.idle_runs, 4, 'a copy: the original is untouched');
  for (let i = 0; i < 2; i++) await beat(db, 'scout', async () => ({}), { now: () => t0 + (i + 1) * 60e3 });
  assert.equal(await strideFor(db, 'scout', cfg), 2, 'the changed knob is the parameter the pacer reads');
  assert.equal(await strideFor(db, 'scout', base), 1, 'with the configured four it would still run every cycle');
  await db.prepare("INSERT INTO goal_knobs (id, goal_id, tenant, config_path, value, default_value, min, max, step) VALUES ('ps.k','ps.g','ps','pace.idle_runs',7,7,1,9,1)").run();
  await db.prepare("INSERT INTO goal_knobs (id, goal_id, tenant, config_path, value, default_value, min, max, step) VALUES ('core.bad','core.x','core','nodot',9,9,1,9,1)").run();
  const c2 = await withKnobs(db, base); assert.equal(c2.pace.idle_runs, 2, "a tenant's knob never overrides core's config"); assert.equal(c2.nodot, undefined);
  await db.prepare("INSERT INTO goal_knobs (id, goal_id, tenant, config_path, value, default_value, min, max, step) VALUES ('core.deep','core.x','core','pace.idle_runs.extra',9,9,1,9,1)").run();
  await db.prepare("UPDATE goal_knobs SET value = 5 WHERE id = 'core.pace.idle_runs'").run();
  const c3 = await withKnobs(db, base); assert.equal(c3.pace.idle_runs, 9, 'a path of three segments applies its first two and drops the rest, as the section states');
  assert.equal(c3.pace.extra, undefined); assert.equal(base.pace.idle_runs, 4);
});

test('US-26-R42: a core goal no knob can move files one item that closes itself when the goal is met; a tenant goal never files into core', async () => {
  vals.x = 0.2;
  const db = makeDb(); const cfg = { goals: [goal('core.t')], knobs: [] };
  await run(db, cfg, t0, {}, { ensureItem }); await run(db, cfg, t0 + H, {}, { ensureItem });
  const it = db.raw.prepare("SELECT * FROM items WHERE id = 'GOAL-core.t'").get();
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'GOAL-%'").get().n, 1, 'filed once');
  assert.equal(it.kind, 'fix'); assert.equal(it.priority, 6); assert.equal(it.owner_role, 'product-manager'); assert.equal(it.surface, 'goals');
  assert.equal(it.closing_probe, "SELECT COUNT(*) FROM goals WHERE id='core.t' AND met=1"); assert.match(it.title, /No knob can move it now \(none attached\)/);
  vals.x = 0.9; await run(db, cfg, t0 + 2 * H, { nowIso: '2026-11-18 02:00:00' }, { ensureItem });
  const done = db.raw.prepare("SELECT status, disposition FROM items WHERE id = 'GOAL-core.t'").get();
  assert.equal(done.status, 'done'); assert.equal(done.disposition, 'fixed: goal core.t met (0.9 >= 0.5)');
  // a pending review is a lever in use: no item. a tenant goal off target: no item
  vals.x = 0.2; const filed = [];
  const db2 = makeDb(); const c2 = { goals: [goal('core.t')], knobs: [knob('core.k', 'core.t')] };
  await run(db2, c2, t0, {}, { ensureItem: async (_d, i) => { filed.push(i); return true; } });
  await run(db2, c2, t0 + H, {}, { ensureItem: async (_d, i) => { filed.push(i); return true; } });
  assert.equal(filed.length, 0);
  await registerTenant(db2, 'ps', { goals: [{ id: 'ps.a', level: 'target', statement: 's', op: '>=', target: 5, source: 'tenant' }] }, { now: t0 });
  await reportReadings(db2, 'ps', { 'ps.a': 1 }, { now: t0 });
  await goalsStep(db2, { now: t0 + 2 * H }, null, { builtins, ensureItem: async (_d, i) => { filed.push(i); return true; } });
  assert.equal(filed.length, 0);
});

test('US-26-R43: a goal held met for achieve_after readings proposes one stretch goal 25 percent harder, at most two a day, with its knobs moved onto it', async () => {
  vals.x = vals.y = vals.z = 0.9;
  const cfg = { control: { achieve_after: 2 }, goals: [goal('core.a'), goal('core.b', { spec: 'y', op: '<=', target: 0.95 }), goal('core.c', { spec: 'z' })],
    knobs: [knob('core.k', 'core.a')] };
  const db = makeDb();
  await run(db, cfg, t0); assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM goals WHERE origin = 'system'").get().n, 0, 'one reading is not a streak');
  const r = await run(db, cfg, t0 + H);
  assert.equal(r.stretch.length, 2, 'two a day across the system');
  const a = await one(db, "SELECT * FROM goals WHERE id = 'core.a+'");
  assert.equal(a.target, 0.625); assert.equal(a.origin, 'system'); assert.equal(a.op, '>='); assert.equal(a.parent_id, null); assert.match(a.statement, /^Stretch: core\.a high \(set by the system after 2 readings/);
  assert.equal((await one(db, "SELECT stretch_id FROM goals WHERE id = 'core.a'")).stretch_id, 'core.a+');
  assert.equal((await one(db, "SELECT goal_id FROM goal_knobs WHERE id = 'core.k'")).goal_id, 'core.a+');
  assert.equal((await one(db, "SELECT target FROM goals WHERE id = 'core.b+'")).target, 0.76, 'a lower-is-better goal is tightened to 80 percent');
  assert.equal((await run(db, cfg, t0 + 2 * H)).stretch.length, 0, 'the day cap holds');
  assert.equal((await run(db, cfg, t0 + 2 * H + DAY)).stretch.length, 1, 'the third goal is stretched on the next day');
  const ap = await one(db, "SELECT met, streak, stretch_id FROM goals WHERE id = 'core.a+'");
  assert.ok(ap.met === 1 && ap.streak >= 2, 'the stretch goal is itself held met');
  assert.equal(ap.stretch_id, null, 'a stretch goal proposes none of its own: its stretch id would be its own id');
  assert.equal((await one(db, "SELECT COUNT(*) n FROM goals WHERE id LIKE '%++'")).n, 0);
  vals.x = vals.y = vals.z = 0.2;
  // no stretch for a target of 0 (a goal held at '<= 0' stays there) or for '=' (there is no harder direction)
  vals.w = 0;
  const zero = { control: { achieve_after: 2 }, goals: [goal('core.drops', { spec: 'w', op: '<=', target: 0 }), goal('core.eq', { spec: 'w', op: '=', target: 0 })], knobs: [] };
  const zdb = makeDb(); let proposed = 0;
  for (let i = 0; i < 6; i++) proposed += (await run(zdb, zero, t0 + i * H)).stretch.length;
  for (const id of ['core.drops', 'core.eq']) {
    const g = await one(zdb, 'SELECT met, streak, stretch_id FROM goals WHERE id = ?', id);
    assert.equal(g.met, 1, `${id} is met`); assert.ok(g.streak >= 2, `${id} held met`); assert.equal(g.stretch_id, null, `${id} proposes no stretch`);
  }
  assert.equal(proposed, 0); assert.equal(zdb.raw.prepare("SELECT COUNT(*) n FROM goals WHERE origin = 'system'").get().n, 0);
  vals.w = 0.2;
});

test('US-26-R44: a goal still unmet after its deadline is marked missed once, with one audit row', async () => {
  vals.x = 0.2;
  const db = makeDb(); const cfg = { goals: [goal('core.t', { deadline: '2026-11-17' })], knobs: [] };
  await run(db, cfg, t0); await run(db, cfg, t0 + H);
  assert.equal((await one(db, "SELECT missed_at FROM goals WHERE id='core.t'")).missed_at, t0);
  assert.equal(kinds(db).filter(k => k === 'goal.missed').length, 1);
  const ok = makeDb(); vals.x = 0.9; await run(ok, cfg, t0);
  assert.equal((await one(ok, "SELECT missed_at FROM goals WHERE id='core.t'")).missed_at, null, 'a met goal is never missed');
  vals.x = 0.2;
});

test('US-26-R45: tenants register namespaced goals and knobs, report readings and read knob values, with no credential for core; feeds are bounded and rows never mix', async () => {
  const ok = { goals: [{ id: 'ps.a', level: 'target', statement: 's', op: '>=', target: 2, source: 'tenant' }], knobs: [{ id: 'ps.k', goal_id: 'ps.a', value: 1, min: 1, max: 3, step: 1 }] };
  assert.deepEqual(validate(ok, 'ps'), []);
  assert.ok(validate({ goals: [{ id: 'x.a', level: 'target', statement: 's', op: '>=', target: 1 }] }, 'ps')[0].includes('goal id must be "ps.<name>"'));
  assert.ok(validate({ goals: [{ id: 'ps.a', level: 'target', statement: 's', op: '>=', target: 1, source: 'builtin' }] }, 'ps')[0].includes('source tenant'));
  assert.ok(validate({ goals: [{ id: 'ps.a', level: 'galaxy', statement: 's' }] }, 'ps')[0].includes('level must be one of'));
  assert.ok(validate({ goals: ok.goals, knobs: [{ id: 'ps.k', goal_id: 'ps.a', value: 9, min: 1, max: 3, step: 1 }] }, 'ps')[0].includes('min <= value <= max'));
  assert.ok(validate({ goals: Array.from({ length: 41 }, (_, i) => ({ id: `ps.g${i}`, level: 'objective', statement: 's' })) }, 'ps').includes('at most 40 goals'));
  assert.ok(validate({ knobs: Array.from({ length: 81 }, (_, i) => ({ id: `ps.k${i}` })) }, 'ps').includes('at most 80 knobs'));
  const db = makeDb();
  assert.equal((await registerTenant(db, 'core', ok)).ok, false); assert.equal((await registerTenant(db, 'P', ok)).ok, false);
  assert.deepEqual([(await registerTenant(db, 'ps', ok, { now: t0 })).created, (await registerTenant(db, 'ps', ok, { now: t0 })).created], [2, 0], 'registering again changes nothing');
  assert.equal((await registerTenant(db, 'qq', ok)).ok, false, "another tenant's ids are not available");
  assert.deepEqual(await reportReadings(db, 'ps', { 'ps.a': 1, 'core.t': 3, 'ps.zz': 1, 'ps.a2': 'x' }, { now: t0 }), { 'ps.a': 'recorded', 'core.t': 'ignored', 'ps.zz': 'ignored', 'ps.a2': 'ignored' });
  assert.deepEqual(Object.keys(await knobValues(db, 'ps')), ['ps.k']); assert.deepEqual(await knobValues(db, 'core'), {});
  const r = await goalsStep(db, { now: t0 + H }, null, { builtins });
  assert.deepEqual(r.adjusted[0], { knob: 'ps.k', old: 1, new: 2, goal: 'ps.a' }, 'the tenant goal is steered from the tenant reading');
  // feeds
  const feed = (over = {}) => async () => ({ ok: true, text: async () => JSON.stringify({ tenant: 'ps', ...ok, readings: { 'ps.a': 1 }, ...over }) });
  assert.deepEqual(await pullFeeds(makeDb(), [{ tenant: 'ps', url: 'u' }], { fetchFn: feed(), now: t0 }), { ps: { registered: 2, readings: 1 } });
  assert.match((await pullFeeds(makeDb(), [{ tenant: 'zz', url: 'u' }], { fetchFn: feed() })).zz, /another tenant/);
  assert.equal((await pullFeeds(makeDb(), [{ tenant: 'ps', url: 'u' }], { fetchFn: async () => ({ ok: false, status: 503 }) })).ps, 'http 503');
  assert.equal((await pullFeeds(makeDb(), [{ tenant: 'ps', url: 'u' }], { fetchFn: async () => ({ ok: true, text: async () => 'x'.repeat(65537) }) })).ps, 'feed over 64 KB');
  assert.match((await pullFeeds(makeDb(), [{ tenant: 'ps', url: 'u' }], { fetchFn: async () => { throw new Error('down'); } })).ps, /^unreadable: down/);
  assert.match((await pullFeeds(makeDb(), [{ tenant: 'ps', url: 'u' }], { fetchFn: feed({ goals: [{ id: 'bad' }] }) })).ps, /^rejected: /);
  let calls = 0; const many = Array.from({ length: 12 }, (_, i) => ({ tenant: 't' + i, url: 'u' }));
  await pullFeeds(makeDb(), many, { fetchFn: async () => { calls++; return { ok: false, status: 404 }; } });
  assert.equal(calls, 8, 'at most eight feeds a pass');
  assert.deepEqual(goalsJson.tenant_feeds.map(f => f.tenant), ['ps']);
});

test('US-26-R46: every knob move, review, proposal, retirement, missed deadline and registration is a row in the hash-chained audit log', async () => {
  vals.x = 0.2; const db = makeDb();
  await registerTenant(db, 'ps', { goals: [{ id: 'ps.a', level: 'target', statement: 's', op: '>=', target: 1, source: 'tenant' }] }, { now: t0 });
  const cfg = { control: { achieve_after: 1 }, goals: [goal('core.t', { deadline: '2026-11-17' }), goal('core.m', { spec: 'y' })], knobs: [knob('core.k', 'core.t')] };
  vals.y = 0.9;
  await run(db, cfg, t0); await run(db, cfg, t0 + 25 * H); await run(db, cfg, t0 + 15 * DAY);
  const seen = new Set(kinds(db));
  for (const k of ['goals.register', 'goal.knob', 'goal.review', 'goal.missed', 'goal.propose', 'goal.retire']) assert.ok(seen.has(k), `${k} in ${[...seen]}`);
  const rows = db.raw.prepare('SELECT * FROM audit_log ORDER BY seq').all();
  let prev = GENESIS;
  for (const r of rows) { assert.equal(r.prev, prev); prev = r.hash; }
  assert.ok(rows.every((r, i) => r.seq === i + 1), 'gapless');
  assert.match(rows.find(r => r.kind === 'goal.knob').summary, /^core\.k: 4 -> 3 to move core\.t \(0\.2 vs >= 0\.5\); core\.t moves toward >= 0\.5 \(from 0\.2\) within 24 h/);
  vals.x = vals.y = 0.2;
});

test('US-26-R47: a knob that keeps reversing direction waits twice as long for each reversal beyond one, up to sixteen times its cooldown', async () => {
  assert.equal(reversals([{ at: 1, old: 1, new: 2 }, { at: 2, old: 2, new: 1 }, { at: 3, old: 1, new: 2 }]), 2);
  assert.equal(reversals([{ at: 1, old: 1, new: 2 }, { at: 2, old: 2, new: 3 }]), 0);
  assert.equal(reversals(Array.from({ length: 10 }, (_, i) => ({ at: i, old: i % 2, new: (i + 1) % 2 }))), 5, 'only the last six moves are read');
  assert.deepEqual(dampedCooldown(24, [{ at: 1, old: 1, new: 2 }, { at: 2, old: 2, new: 1 }]), { reversals: 1, cooldown_h: 24, damped: false });
  assert.deepEqual(dampedCooldown(24, [{ at: 1, old: 1, new: 2 }, { at: 2, old: 2, new: 1 }, { at: 3, old: 1, new: 2 }]), { reversals: 2, cooldown_h: 48, damped: true });
  const chatter = Array.from({ length: 6 }, (_, i) => ({ at: i, old: i % 2, new: (i + 1) % 2 }));
  assert.deepEqual(dampedCooldown(24, chatter), { reversals: 5, cooldown_h: 24 * 16, damped: true });
  // inside the step: the cooldown of a chattering knob outlasts the plain one
  vals.x = 0.2; const db = makeDb(); const cfg = { goals: [goal('core.t')], knobs: [knob('core.k', 'core.t')] };
  await seedGoals(db, cfg, { now: t0 });
  chatter.forEach((m, i) => db.raw.prepare("INSERT INTO goal_adjustments (at, knob_id, goal_id, old, new, review_after, reviewed_at, kept) VALUES (?, 'core.k', 'core.t', ?, ?, ?, ?, 1)").run(t0 - (7 - i) * DAY, m.old, m.new, t0 - (7 - i) * DAY, t0 - (7 - i) * DAY));
  db.raw.prepare("UPDATE goal_knobs SET last_changed_at = ? WHERE id = 'core.k'").run(t0 - 30 * H);  // 30 h ago: past the plain 24 h cooldown
  const r = await run(db, cfg, t0);
  assert.equal(r.adjusted.length, 0); assert.deepEqual(r.damped, [{ knob: 'core.k', reversals: 5, cooldown_h: 384 }]);
  const calm = makeDb(); await seedGoals(calm, cfg, { now: t0 }); calm.raw.prepare("UPDATE goal_knobs SET last_changed_at = ? WHERE id = 'core.k'").run(t0 - 30 * H);
  assert.equal((await run(calm, cfg, t0)).adjusted.length, 1);
});

test('US-26-R48: a goal carries an error budget: burn rate against a 90 percent objective, the workbook multiwindow alerts, and a state word', async () => {
  const now = 1_000 * DAY;
  const s = Array.from({ length: 10 }, (_, i) => ({ at: now - i * 60e3, ok: i >= 2 }));
  const b = burnRate(s, 0.9, { now, window_h: 1 });
  assert.equal(b.n, 10); assert.ok(Math.abs(b.miss - 0.2) < 1e-9 && Math.abs(b.burn - 2) < 1e-9);
  assert.deepEqual(burnRate([], 0.9, { now, window_h: 1 }), { n: 0, miss: null, burn: null });
  assert.deepEqual(BURN_RULES.map(r => [r.severity, r.long_h, r.burn]), [['page', 1, 14.4], ['page', 6, 6], ['ticket', 72, 1]]);
  const bad = Array.from({ length: 120 }, (_, i) => ({ at: now - i * 60e3, ok: false }));
  const fast = errorBudget(bad, 0.99, { now });
  assert.equal(fast.state, 'burning fast'); assert.equal(fast.budget_remaining, 0); assert.ok(fast.alerts.some(a => a.severity === 'page' && a.threshold === 14.4));
  const slow = errorBudget(Array.from({ length: 72 }, (_, i) => ({ at: now - i * H, ok: i % 5 !== 0 })), 0.9, { now });
  assert.equal(slow.state, 'burning'); assert.deepEqual(slow.alerts.map(a => a.severity), ['ticket']);
  assert.equal(errorBudget(Array.from({ length: 120 }, (_, i) => ({ at: now - i * H, ok: true })), 0.9, { now }).state, 'within budget');
  assert.equal(errorBudget([], 0.9, { now }).state, 'no readings');
  // on the public view every comparable goal carries one over 14 days against the 0.9 objective
  const db = makeDb(); vals.x = 0.7; const cfg = { goals: [goal('core.t'), { id: 'core.obj', level: 'objective', statement: 'o' }], knobs: [] };
  for (let i = 0; i < 4; i++) await run(db, cfg, t0 + i * H);
  const v = await readGoals(db, { now: t0 + 5 * H, loops: false });
  assert.deepEqual([v.slo.objective, v.slo.period_d], [0.9, 14]);
  const g = v.goals.find(x => x.id === 'core.t');
  assert.equal(g.error_budget.objective, 0.9); assert.equal(g.error_budget.period_d, 14); assert.equal(g.error_budget.readings, 4); assert.equal(g.error_budget.state, 'within budget');
  assert.equal(v.goals.find(x => x.id === 'core.obj').error_budget, null, 'a goal with no comparison has none');
  vals.x = 0.2;
});

test('US-26-R49: a degraded or lean tick never leaves the goal tree unseeded and still runs the control step on the first tick of each hour', async () => {
  vals.x = 0.2;
  const cfg = { goals: [goal('core.t')], knobs: [knob('core.k', 'core.t')] };
  const db = makeDb(); const noon30 = Date.parse('2026-11-18T12:30:00Z');
  db.raw.prepare("INSERT INTO free_tier_samples (at, resource, used_today) VALUES (?, 'd1_rows_read', 2600000)").run('2026-11-18 12:20:00');
  await runTick(db, { config: { org_slug: 't', policy: {}, goals: cfg }, now: noon30 });
  assert.equal((await one(db, 'SELECT COUNT(*) n FROM goals')).n, 1); assert.equal((await one(db, 'SELECT COUNT(*) n FROM goal_knobs')).n, 1);
  assert.equal((await one(db, 'SELECT COUNT(*) n FROM goal_samples')).n, 0, 'minute 30: the control pass waits for the hour');
  const lean = makeDb(); const hour = Date.parse('2026-11-18T12:05:00Z');
  await runTick(lean, { config: { org_slug: 't', policy: {}, goals: { goals: [goal('core.t', { source: 'builtin', spec: 'items_done', op: '>=', target: 5 })], knobs: [] }, cost_budgets: [{ target: 'x', max_rows_read_per_hour: 0 }] }, now: hour });
  assert.equal((await one(lean, 'SELECT COUNT(*) n FROM goal_samples')).n, 1, 'lean, but the control step ran in the first ten minutes of the hour');
});

// ---- pacing (pace.js) ----
const cfgP = { pace: paceJson };
const T0 = Date.parse('2026-11-10T00:00:00Z');
let CLOCK = T0;  // one clock for the whole test: the pace read orders by slot (READ-BUDGET-9), so later beats must carry later slots
const beats = (db, loop, out, n = 1) => (async () => { for (let i = 0; i < n; i++) await beat(db, loop, async () => out, { now: () => (CLOCK += 60e3) }); })();

test('US-26-R50: a heavy loop whose last four real runs returned nothing runs every second cycle, then every fourth; work, a failure or a never-paced name puts it back every cycle', async () => {
  assert.deepEqual([PACE_DEFAULTS.idle_runs, PACE_DEFAULTS.max_stride, PACE_DEFAULTS.never_pace], [4, 4, ['executor', 'lane', 'handoffs']]);
  const db = makeDb();
  assert.equal(await strideFor(db, 'sweeper', cfgP), 1, 'no ledger rows: run');
  await beats(db, 'sweeper', {}, 3); assert.equal(await strideFor(db, 'sweeper', cfgP), 1);
  await beats(db, 'sweeper', {}, 1); assert.equal(await strideFor(db, 'sweeper', cfgP), 2);
  assert.deepEqual(await paced(db, 'sweeper', 3, cfgP), { paced: true, stride: 2 }); assert.equal(await paced(db, 'sweeper', 4, cfgP), null, 'its own slot runs');
  await beats(db, 'sweeper', { paced: true, stride: 2 }, 3); assert.equal(await strideFor(db, 'sweeper', cfgP), 2, 'a paced beat counts neither way');
  await beats(db, 'sweeper', { status: 'deferred', reason: 'cap' }, 3); assert.equal(await strideFor(db, 'sweeper', cfgP), 2, 'a deferred run counts neither way');
  await beats(db, 'sweeper', {}, 12); assert.equal(await strideFor(db, 'sweeper', cfgP), 4, 'capped at max_stride');
  await beats(db, 'sweeper', { closed: ['Q-1'] }); assert.equal(await strideFor(db, 'sweeper', cfgP), 1, 'work resets it');
  await beats(db, 'lane', {}, 9); assert.equal(await strideFor(db, 'lane', cfgP), 1, 'never_pace');
  await beats(db, 'gate', {}, 5); await beat(db, 'gate', async () => { throw new Error('x'); }, { now: () => T0 + 99e6 }).catch(() => null);
  assert.equal(await strideFor(db, 'gate', cfgP), 1, 'a failing loop is not idle: its failure stays visible');
  const bare = makeDb(); bare.raw.exec('DROP TABLE loop_beats');
  assert.equal(await strideFor(bare, 'x', cfgP), 1, 'no ledger yet: run');
});

test('US-26-R51: a run is idle when its result holds nothing but empty values, readings and a status word; a result that cannot be parsed counts as work', () => {
  for (const d of [null, 'null', '{}', '[]', '{"status":"ok","merged":[],"n":0}', '{"closed":[],"filed":[]}', '{"open_loop_age_hours":3.2,"merged":[]}', '{"status":"no-op"}']) assert.equal(isIdle(d), true, String(d));
  for (const d of ['{"merged":[12]}', '{"status":"ok","n":2}', '{"status":"error x"}', '{"merged":[1,2', '[{"ok":true}]', '"text"']) assert.equal(isIdle(d), false, d);
  assert.equal(isIdle('{"open_loop_age_hours":3.2}', []), false, 'a gauge not named in gauges is work');
  assert.deepEqual(PACE_DEFAULTS.gauges, ['open_loop_age_hours', 'used', 'limit', 'refused']);
});

test('US-26-R52: near a limit a loop is stretched up to twice max_stride, far under one an earned stride is halved, and never-paced loops are untouched', () => {
  const c = { pace: { idle_runs: 4, max_stride: 4, never_pace: ['executor'], gauges: [] } };
  assert.equal(applyTuning(1, tune({ a: 0.96 }), c, 'scout'), 2);
  assert.equal(applyTuning(1, tune({ a: 9 }), c, 'scout'), 8, 'capped at twice max_stride');
  assert.equal(applyTuning(4, tune({ a: 0.2 }), c, 'scout'), 2); assert.equal(applyTuning(1, tune({ a: 0.2 }), c, 'scout'), 1);
  assert.equal(applyTuning(4, tune({ a: 0.75 }), c, 'scout'), 4, 'a pace that fits changes nothing'); assert.equal(applyTuning(2, null, c, 'scout'), 2);
  assert.equal(applyTuning(1, tune({ a: 0.96 }), c, 'executor'), 1);
});

test('US-26-R53: ready items of one priority are ordered by reach per cost of the first matching prefix; priority always wins and ties keep their order', () => {
  const rank = paceJson.rank;
  const rows = [{ id: 'Q-UNK-1', priority: 30 }, { id: 'Q-PROMO-1', priority: 30 }, { id: 'X-1', priority: 30 }, { id: 'Q-GROW-2', priority: 30 }, { id: 'Q-UNK-0', priority: 10 }];
  assert.deepEqual(rankRows(rows, rank).map(r => r.id), ['Q-UNK-0', 'Q-PROMO-1', 'Q-GROW-2', 'X-1', 'Q-UNK-1'], 'reach 5 per cost 1, then 4 per 2, an unmatched id 1, then 1 per 2');
  assert.deepEqual(rankRows(rows).map(r => r.id), ['Q-UNK-0', 'Q-UNK-1', 'Q-PROMO-1', 'X-1', 'Q-GROW-2'], 'no rank table: the incoming order');
  assert.deepEqual(rankRows([{ id: 'A', priority: 1 }, { id: 'B', priority: 1 }], [{ prefix: 'A', reach: 1, cost: 0 }]).map(r => r.id), ['A', 'B'], 'a zero cost is floored, not divided by');
});
