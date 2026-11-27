// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SECOND-LOOP-KERNEL-1: every concept in autonomy/secondloop.json is an export that behaves as the register says, and the tick step acts on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import * as A from '../src/secondloop.js';
import { runTick, STEP_ORDER, ensureItem } from '../src/tick.js';

const reg = JSON.parse(readFileSync(new URL('../../autonomy/secondloop.json', import.meta.url), 'utf8'));
const mean = (o, seeds) => seeds.reduce((s, seed) => s + A.homeostat({ ...o, seed }).redraws, 0) / seeds.length;
const seeds = Array.from({ length: 60 }, (_, i) => i + 1);

test('the register and the code are one list: every concept names an export, every export is named', () => {
  const named = new Set(reg.concepts.filter(c => c.code === 'worker/src/secondloop.js').flatMap(c => c.exports));
  for (const c of reg.concepts) {
    if (c.code === 'worker/src/secondloop.js') for (const e of c.exports) assert.equal(typeof A[e] !== 'undefined', true, `${c.id}: secondloop.js has no export ${e}`);
    assert.ok(c.sources.length, `${c.id}: no source`);
    for (const s of c.sources) {
      assert.ok(s.journal_pages || s.work, `${c.id}: a source is a journal page or a published work`);
      for (const p of s.journal_pages || []) assert.match(String(p), /^\d{4}$/, `${c.id}: journal page ${p}`);
      if (s.url) assert.match(s.url, /^https:\/\//);
    }
    assert.ok(c.failure_mode && c.statement, `${c.id}: statement and failure mode`);
  }
  const helpers = new Set(reg.helpers);
  assert.deepEqual(Object.keys(A).filter(k => !named.has(k) && !helpers.has(k)), [], 'an export no concept names');
  assert.equal(reg.archive.store, 'references-only');
});

test('essential variables: unmeasured is outside limits, a hard limit breaches at once, a soft one only when it persists', () => {
  const soft = { id: 'e', lower: 0, upper: 1, severity: 'soft' }, hard = { ...soft, severity: 'hard' };
  assert.deepEqual([A.inLimits(soft, 0.5), A.inLimits(soft, 2), A.inLimits(soft, null), A.inLimits(soft, NaN), A.inLimits(soft, undefined)], [true, false, false, false, false]);
  assert.equal(A.bounded({ id: 'x' }), false);
  assert.equal(A.breached(soft, []), true, 'no reading at all is a breach');
  assert.equal(A.breached(soft, [0.5, 2]), false, 'one bad reading is noise for a soft limit');
  assert.equal(A.breached(soft, [2, 2, 2]), true);
  assert.equal(A.breached(soft, [2, 2, 0.5]), false);
  assert.equal(A.breached(hard, [0.5, 2]), true);
});

test('the step mechanism never draws a spent or an uncleared irreversible step, follows the model, and keeps blind draws', () => {
  const rep = [{ id: 'a' }, { id: 'b' }, { id: 'burn', reversible: false, action_classes: ['delete'] }];
  const p = c => ({ a: 0.2, b: 0.9, burn: 1 })[c.id];
  assert.equal(A.selectStep({ repertoire: rep, predict: p, random: () => 0.99 }).candidate.id, 'b');
  assert.equal(A.selectStep({ repertoire: rep, predict: p, cleared: ['delete'], random: () => 0.99 }).candidate.id, 'burn');
  assert.equal(A.selectStep({ repertoire: rep, tried: ['a', 'b'], predict: p }).candidate, null);
  assert.equal(A.selectStep({ repertoire: rep, tried: ['a', 'b', 'burn'] }).why, 'repertoire spent');
  const r = A.rng(7), drawn = new Set();
  for (let i = 0; i < 200; i++) drawn.add(A.selectStep({ repertoire: rep, predict: p, random: r }).candidate.id);
  assert.deepEqual([...drawn].sort(), ['a', 'b'], 'epsilon reaches the step the model ranks last, never the irreversible one');
  assert.match(A.selectStep({ repertoire: rep, random: A.rng(1) }).why, /no model/);
});

test('the second loop acts only on a breach, inside its budget and cooldown, and keeps a step only when the variables held', () => {
  assert.equal(A.stepDecision({}, 10, false).act, 'none');
  assert.equal(A.stepDecision({}, 10, true).act, 'step');
  assert.equal(A.stepDecision({ trial: { id: 'a', start_tick: 9 } }, 10, true).act, 'hold');
  assert.equal(A.stepDecision({ last_step_tick: 9 }, 10, true).act, 'hold');
  assert.equal(A.stepDecision({ last_step_tick: 5, steps_today: 5 }, 10, true).act, 'escalate');
  const t = { id: 'a', start_tick: 10 };
  assert.equal(A.settle(t, 12, [true, true]), 'wait');
  assert.equal(A.settle(t, 13, [true, true, true]), 'commit');
  assert.equal(A.settle(t, 13, [true, false, true]), 'wait');
  assert.equal(A.settle(t, 16, [true, false, true, true, false, true]), 'rollback');
});

test('gating: only the part in breach steps; a coupled part that is in limits is spared', () => {
  assert.deepEqual(A.gate({ a: true, b: false, c: false }, [{ src: 'a', dst: 'b' }]), { step: ['a'], spared: ['b'] });
  const i = A.interference([{ partition: 'a', tick: 1 }, { partition: 'a', tick: 20 }], [{ partition: 'b', tick: 3 }, { partition: 'a', tick: 21 }]);
  assert.deepEqual([i.rate, i.n], [0.5, 2]);
  assert.equal(A.interference([], []).rate, null, 'no commits is unmeasured, not zero');
});

test('coupling guard: growth rate of the linear whole, and a refusal for a dense or unstable graph', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-4,   // a defective matrix converges as log(t)/t
     `${a} vs ${b}`);
  near(A.spectralAbscissa([[-1, 0], [0, -2]]), -1); near(A.spectralAbscissa([[0, 1], [-1, 0]]), 0);
  near(A.spectralAbscissa([[0.1, 5], [-5, 0.1]]), 0.1); near(A.spectralAbscissa([[-1, 3], [0, -1]]), -1);
  const parts = Array.from({ length: 12 }, (_, i) => `p${i}`);
  const sparse = A.couplingGuard({ parts, couplings: [{ src: 'p0', dst: 'p1', strength: 0.5 }, { src: 'p1', dst: 'p2', strength: 0.5 }] });
  assert.equal(sparse.ok, true); near(sparse.connectance, 2 / 132);
  const loop = A.couplingGuard({ parts, couplings: [{ src: 'p0', dst: 'p1', strength: 2 }, { src: 'p1', dst: 'p0', strength: 2 }] });
  assert.equal(loop.ok, false); assert.match(loop.reasons.join(), /does not settle/);
  const dense = A.couplingGuard({ parts: ['a', 'b', 'c'], couplings: [{ src: 'a', dst: 'b', strength: 0.1 }, { src: 'b', dst: 'c', strength: 0.1 }] });
  assert.match(dense.reasons.join(), /connectance/);
  assert.match(A.couplingGuard({ parts: ['a'], couplings: [{ src: 'a', dst: 'zz', strength: 1 }] }).reasons.join(), /unknown part/);
});

test('requisite variety counts disturbances covered, not tools owned', () => {
  const v = A.varietyLedger([{ id: 'd1', frequency: 8 }, { id: 'd2', frequency: 2 }], [{ disturbance: 'd1', action: 'x', success_rate: 0.9 }, { disturbance: 'd1', action: 'y', success_rate: 0.95 }, { disturbance: 'd2', action: 'z', success_rate: 0.3 }]);
  assert.deepEqual([v.coverage, v.residual, v.uncovered], [0.5, 0.2, ['d2']]);
  assert.deepEqual(v.redundant, [{ disturbance: 'd1', actions: 2 }]);
  assert.equal(A.varietyBound(8, 2), 2); assert.equal(A.varietyBound(2, 8), 0);
  assert.equal(A.varietyLedger([], []).coverage, null);
});

test('the model is scored before it is trusted', () => {
  assert.equal(A.calibration([{ p: 0.9, outcome: 1 }]).usable, false, 'too few to judge');
  const good = Array.from({ length: 10 }, (_, i) => ({ p: i % 2 ? 0.9 : 0.1, outcome: i % 2 }));
  assert.equal(A.calibration(good).usable, true);
  assert.equal(A.calibration(good.map(x => ({ p: 0.5, outcome: x.outcome }))).usable, false, 'a coin is not a model');
});

test('habituation fades a harmless repeat and never a hard limit', () => {
  assert.equal(A.sensitivity({ harmless_days: 7 }), 0.5);
  assert.equal(A.sensitivity({ harmless_days: 70, severity: 'hard' }), 1);
});

test('Perez Lopez: falling efficiency retires an action; a rising score on falling efficiency is negative learning; the guard outranks the goal', () => {
  const fall = [5, 4.5, 4, 3, 2, 1].map(efficiency => ({ effectiveness: 1, efficiency }));
  assert.deepEqual([A.actionEval(fall).retire, A.actionEval(fall).falling_for], [true, 5]);
  assert.equal(A.actionEval([...fall.slice(0, 5), { efficiency: 3 }]).retire, false);
  assert.equal(A.negativeLearning([1, 2, 3], [5, 4, 2]), true);
  assert.equal(A.negativeLearning([1, 2, 3], [5, 5, 6]), false);
  assert.equal(A.negativeLearning([1], [5]), null);
  const evs = [{ id: 'cost', upper: 1 }];
  const l = A.lexicographic([{ id: 'bold', objective: 9, ev: { cost: 1.4 } }, { id: 'safe', objective: 3, ev: { cost: 0.6 } }, { id: 'blind', objective: 5, ev: { cost: null } }], evs);
  assert.deepEqual([l.choice.id, l.refused], ['safe', ['blind', 'bold']], 'an unpredicted essential variable is not eligible either');
  assert.deepEqual(A.failureRecall([{ id: 1 }, { id: 2 }], [{ id: 2 }]), { rate: 0.5, n: 2, missing: [1] });
});

test('homeostat: replayable, re-stabilises after an inversion, and the fully joined search grows far faster than the gated one', () => {
  assert.deepEqual(A.homeostat({ seed: 3 }).W, A.homeostat({ seed: 3 }).W);
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const r = A.homeostat({ n: 4, seed }); assert.equal(r.stable, true);
    const W = r.W.map(x => x.slice()); W[0][1] = 3; W[1][0] = 3;     // a coupling the first loop cannot hold
    assert.ok(A.spectralAbscissa(W.map((row, i) => row.map((v, j) => v - (i === j ? 1 : 0)))) > 0, 'the injected fault is real');
    const again = A.homeostat({ n: 4, seed: seed + 100, W, x: [0.4, 0.4, 0.4, 0.4] });
    assert.equal(again.stable, true); assert.ok(again.redraws > 0, 'the second loop did the work');
  }
  const j8 = mean({ n: 8, mode: 'joint', max_steps: 60000 }, seeds), l8 = mean({ n: 8, mode: 'local', max_steps: 60000 }, seeds);
  const j4 = mean({ n: 4, mode: 'joint', max_steps: 60000 }, seeds);
  assert.ok(j8 > 3 * l8, `joint ${j8} vs local ${l8} at n = 8`);
  assert.ok(j8 > 10 * Math.max(j4, 0.05), `joint search grows faster than the size: ${j4} at 4, ${j8} at 8`);
  const blocks = mean({ n: 8, mode: 'joint', blocks: [4, 4], max_steps: 60000 }, seeds);
  assert.ok(blocks < j8 / 3, `two independent halves ${blocks} vs one whole ${j8}`);
});

const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy: JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8')) };
const T0 = Date.parse('2026-11-27T00:00:00Z');
const metric = (db, id, obj, kind, breached = 0) => db.raw.prepare(`INSERT INTO metrics (id, objective_id, name, kind, source, spec, op, threshold, owner_role, remedy, breached) VALUES (?, ?, ?, ?, 'sql', 'SELECT 1', '>=', 0, 'product-manager', 'r', ?)`).run(id, obj, id, kind, breached);
const ctx = () => ({ config, now: T0, nowIso: '2026-11-27 00:00:00', notes: [] });

test('tick step: an objective measured only by its own target files one item, closed by the same reading', async () => {
  assert.ok(STEP_ORDER.indexOf('second_goal') > STEP_ORDER.indexOf('measure'), 'the step reads the breach flags measure just wrote');
  const db = makeDb();
  metric(db, 'M-t1', 'OBJ-1', 'target'); metric(db, 'M-t2', 'OBJ-2', 'target'); metric(db, 'M-g2', 'OBJ-2', 'guard');
  const s = await A.secondGoalStep(db, ctx(), ensureItem);
  assert.deepEqual([s.objectives, s.ev_coverage, s.uncovered], [2, 0.5, ['OBJ-1']]);
  const item = db.raw.prepare('SELECT status, owner_role, title FROM items WHERE id = ?').get(A.COVERAGE_ITEM);
  assert.equal(item.status, 'ready'); assert.match(item.title, /OBJ-1/);
  assert.equal(JSON.parse(db.raw.prepare("SELECT value FROM org WHERE key = 'second_goal'").get().value).ev_coverage, 0.5);
  metric(db, 'M-g1', 'OBJ-1', 'guard');
  await A.secondGoalStep(db, ctx(), ensureItem);
  const done = db.raw.prepare('SELECT status, disposition FROM items WHERE id = ?').get(A.COVERAGE_ITEM);
  assert.equal(done.status, 'done'); assert.match(done.disposition, /^fixed/);
  db.raw.prepare("DELETE FROM metrics WHERE id = 'M-g1'").run();
  await A.secondGoalStep(db, ctx(), ensureItem);
  assert.equal(db.raw.prepare('SELECT status FROM items WHERE id = ?').get(A.COVERAGE_ITEM).status, 'ready', 'the same item reopens; nothing new is filed');
});

test('tick step: a healthy goal over a breached guard puts the guard repair at the head of the queue', async () => {
  const db = makeDb();
  metric(db, 'M-t', 'OBJ-1', 'target', 0); metric(db, 'M-g', 'OBJ-1', 'guard', 1);
  db.raw.prepare("INSERT INTO items (id, title, owner_role, done_check, priority, status) VALUES ('BREACH-M-g', 'b', 'staff', 'x', 10, 'ready'), ('OTHER', 'o', 'staff', 'x', 5, 'ready')").run();
  const s = await A.secondGoalStep(db, ctx(), ensureItem);
  assert.deepEqual(s.inverted, [{ objective: 'OBJ-1', guards: ['M-g'] }]); assert.equal(s.raised, 1);
  assert.equal(db.raw.prepare("SELECT priority FROM items WHERE id = 'BREACH-M-g'").get().priority, 0);
  assert.equal((await A.secondGoalStep(db, ctx(), ensureItem)).raised, 0, 'idempotent');
  db.raw.prepare("UPDATE metrics SET breached = 1 WHERE id = 'M-t'").run();
  assert.deepEqual((await A.secondGoalStep(db, ctx(), ensureItem)).inverted, [], 'a goal that is itself failing is not reporting success');
});

test('the whole tick still runs every step with the second_goal step in it', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m')");
  const r = await runTick(db, { config, now: T0 });
  assert.equal(r.completed, STEP_ORDER.length, JSON.stringify(r.errors));
  assert.match(r.report, /second_goal: 0 objective\(s\), guard coverage unmeasured/);
});
