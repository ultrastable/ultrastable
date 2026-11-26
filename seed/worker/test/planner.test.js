// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { seedGoals } from '../src/goals.js';
import { planStep, decompose, gap, readPlans } from '../src/planner.js';
import { ensureItem } from '../src/tick.js';

const H = 3600e3, t0 = Date.parse('2026-11-26T00:00:00Z');
let val = 0.2; const builtins = { x: async () => val, y: async () => 0.95 };
const cfg = { goals: [
  { id: 'core.far', level: 'target', statement: 'x high', source: 'builtin', spec: 'x', op: '>=', target: 0.8 },
  { id: 'core.near', level: 'target', statement: 'y high', source: 'builtin', spec: 'y', op: '>=', target: 1 }],
  knobs: [{ id: 'core.k', goal_id: 'core.far', what: 'stride', value: 2, min: 1, max: 6, step: 1, effect: 1 }] };
const ctx = now => ({ now, nowIso: new Date(now).toISOString(), config: {} });
const step = (db, now) => planStep(db, ctx(now), { review_h: 24 }, { builtins, ensureItem: (d, i) => ensureItem(d, i, { now, cap: 1000 }) });
const finish = (db, id, disp = 'done: ok') => db.prepare(`UPDATE items SET status='done', disposition=? WHERE id=?`).bind(disp, id).run();

test('gap is relative and counts only the wrong side', () => {
  assert.equal(gap({ op: '>=', target: 1 }, 0.5), 0.5);
  assert.equal(gap({ op: '>=', target: 1 }, 2), 0);
  assert.equal(gap({ op: '<=', target: 10 }, 15), 0.5);
});

test('decompose builds audit > implement > verify > integrate > gate with roles', () => {
  const t = decompose({ id: 'g', op: '>=', target: 1, statement: 's' }, { id: 'P', attempt: 1, approach: 'levers', knobs: [{ id: 'k1' }], value: 0 });
  assert.deepEqual(t.map(x => x.phase), ['audit', 'implement', 'implement', 'verify', 'integrate', 'gate']);
  assert.equal(t.find(x => x.phase === 'verify').role, 'reviewer');
  assert.notEqual(t.find(x => x.phase === 'verify').role, t.find(x => x.phase === 'implement').role);
  assert.ok(t.find(x => x.id === 'P-implement-code').done.includes('under 60 files'));
});

test('a goal is planned, worked in order, knob turned by the planner itself, and gated on a fresh reading', async () => {
  const db = makeDb(); await seedGoals(db, cfg, { now: t0 }); val = 0.2;
  const r = await step(db, t0);
  assert.equal(r.started, 'PLAN-core-far-1');  // furthest out of bounds wins
  const st = async id => (await db.prepare('SELECT status FROM items WHERE id=?').bind(id).first()).status;
  assert.equal(await st('PLAN-core-far-1-audit'), 'ready');
  assert.equal(await st('PLAN-core-far-1-verify'), 'blocked');
  await finish(db, 'PLAN-core-far-1-audit');
  const r2 = await step(db, t0 + H);
  assert.ok(r2.promoted.includes('PLAN-core-far-1-implement-core-k'));
  assert.deepEqual(r2.turned, ['core.k']);  // promoted and turned in the same tick: no agent waits on a knob
  assert.equal((await db.prepare("SELECT value FROM goal_knobs WHERE id='core.k'").first()).value, 3);
  await finish(db, 'PLAN-core-far-1-implement-code');
  await step(db, t0 + 3 * H); await finish(db, 'PLAN-core-far-1-verify', 'confirmed');
  await step(db, t0 + 4 * H); await finish(db, 'PLAN-core-far-1-integrate');
  await step(db, t0 + 5 * H);
  val = 0.5; const g = await step(db, t0 + 30 * H);
  assert.deepEqual(g.closed, [{ plan: 'PLAN-core-far-1', verdict: 'kept' }]);
  const v = await readPlans(db); assert.equal(v.plans.find(p => p.id === 'PLAN-core-far-1').verdict, 'kept');
});

test('a refuted verify files a fix the integrate waits on; a miss mutates the approach', async () => {
  const db = makeDb(); await seedGoals(db, cfg, { now: t0 }); val = 0.2;
  await step(db, t0);
  for (const id of ['audit', 'implement-core-k', 'implement-code']) await finish(db, 'PLAN-core-far-1-' + id);
  await step(db, t0 + H); await finish(db, 'PLAN-core-far-1-verify', 'refuted: test does not exercise the path');
  const r = await step(db, t0 + 2 * H); assert.deepEqual(r.fixes, ['PLAN-core-far-1-fix']);
  await step(db, t0 + 3 * H);
  assert.equal((await db.prepare("SELECT status FROM items WHERE id='PLAN-core-far-1-integrate'").first()).status, 'blocked');
  await finish(db, 'PLAN-core-far-1-fix'); await step(db, t0 + 4 * H);
  await finish(db, 'PLAN-core-far-1-integrate'); await step(db, t0 + 5 * H);
  const g = await step(db, t0 + 30 * H);  // value did not move
  assert.deepEqual(g.closed, [{ plan: 'PLAN-core-far-1', verdict: 'missed' }]);
  assert.equal(g.started, 'PLAN-core-far-2');
  assert.equal((await readPlans(db)).plans.find(p => p.id === 'PLAN-core-far-2').approach, 'code');
});
