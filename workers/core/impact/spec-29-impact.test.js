// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-29 (visible progress, content stickiness and substantive change): the requirements of the impact loop, proved through the public API of core/impact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { record, assess, weights, plan, settle } from './index.js';

const D = 86400e3, now = 200 * D;

test('US-29-R58: record keeps one point a metric a day for 120 days and leaves out a reading that is not a number; assess names the trend toward the target', () => {
  let h = record({}, { a: 1, b: NaN, c: undefined, d: null, f: '5' }, now);
  assert.deepEqual(h, { a: [{ at: now, v: 1 }], b: [], c: [], d: [], f: [] }, 'an unreadable value is never stored as zero');
  h = record(h, { a: 2 }, now + 0.5 * D);
  assert.deepEqual(h.a, [{ at: now, v: 2 }], 'a second reading inside the day replaces the value and keeps the first time');
  h = record(h, { a: 3 }, now + 1 * D);
  assert.deepEqual(h.a.map(p => p.v), [2, 3]);
  const old = { m: [{ at: now - 121 * D, v: 9 }, { at: now - 119 * D, v: 8 }] };
  assert.deepEqual(record(old, {}, now).m.map(p => p.v), [8], 'older than 120 days is dropped, and a metric with no reading today keeps its history');
  const m = { id: 'r', value: 0.5, target: 0.6 };
  assert.deepEqual(assess({ id: 'x', value: NaN, target: 1 }, [], { now }), { id: 'x', status: 'unknown', gap: null });
  assert.equal(assess(m, [], { now }).status, 'unknown');
  assert.match(assess(m, [{ at: now - 3 * D, v: 0.4 }], { now }).note, /history shorter than the plateau window/);
  assert.equal(assess(m, [{ at: now - 8 * D, v: 0.5 }], { now }).status, 'plateau');
  assert.equal(assess(m, [{ at: now - 8 * D, v: 0.4 }], { now }).status, 'rising');
  assert.equal(assess(m, [{ at: now - 8 * D, v: 0.6 }], { now }).status, 'falling');
  assert.deepEqual(assess({ ...m, value: 0.7 }, [], { now }), { id: 'r', status: 'met', gap: 0, value: 0.7 });
  assert.equal(assess({ id: 'e', op: '<=', value: 0.05, target: 0.1 }, [], { now }).status, 'met', 'an upper bound is met below it');
  assert.equal(assess({ id: 'e', op: '<=', value: 5, target: 3 }, [{ at: now - 8 * D, v: 9 }], { now }).status, 'rising', 'toward the target is rising whichever way it points');
  assert.equal(assess({ id: 'e', op: '<=', value: 5, target: 3 }, [{ at: now - 8 * D, v: 3 }], { now }).status, 'falling');
  assert.equal(assess(m, [{ at: now - 8 * D, v: 0.5 }], { now: now + 0 }).change, 0);
  assert.equal(assess(m, [{ at: now - 8 * D, v: 0.4 }], { now }).change, 0.1667);
});

test('US-29-R59: weights rank levers by kept rate with a prior of one half, and plan files bounded, deduplicated items each carrying a prediction', () => {
  const led = [{ lever: 'good', outcome: 'kept' }, { lever: 'bad', outcome: 'missed' }, { lever: 'bad', outcome: 'missed' }, { lever: 'bad', outcome: undefined }, { outcome: 'kept' }];
  assert.deepEqual(weights(led), { good: 0.75, bad: 0.5 / 3 }, 'a pending or lever-less entry counts for nothing; a lever that keeps missing sinks but stays listed');
  const lever = id => ({ id, propose: ({ metric }) => [{ key: `${id}-${metric.id}-1`, title: 't', body: 'b' }, { key: `${id}-${metric.id}-2`, title: 't2', body: 'b' }] });
  const metrics = [{ id: 'ready', value: 0.5, target: 0.6 }, { id: 'done', value: 1, target: 1 }, { id: 'up', value: 0.5, target: 0.6 }];
  const p = plan({ metrics, series: { up: [{ at: now - 8 * D, v: 0.3 }] }, levers: { ready: [lever('L')], done: [lever('L')], up: [lever('L')] }, open: ['L-ready-1'], now });
  assert.deepEqual(p.items.map(i => i.key), ['L-ready-2'], 'a met metric, a rising one and an open key get nothing');
  assert.deepEqual(p.assessments.map(a => a.status), ['unknown', 'met', 'rising']);
  const it = p.items[0];
  assert.equal(it.prediction, 'ready >= 0.525 within 168 h'); assert.equal(it.predicted, 0.525); assert.equal(it.base, 0.5); assert.equal(it.due, now + 168 * 3600e3);
  assert.equal(it.lever, 'L'); assert.equal(it.metric, 'ready'); assert.equal(it.op, '>=');
  const upper = plan({ metrics: [{ id: 'err', op: '<=', value: 0.2, target: 0.1 }], levers: { err: [lever('L')] }, now, cap: 1, horizon_h: 24 }).items[0];
  assert.equal(upper.prediction, 'err <= 0.175 within 24 h');
  const stepped = plan({ metrics: [{ id: 'm', value: 1, target: 5 }], levers: { m: [{ id: 'S', propose: () => [{ key: 's', expected_step: 10 }] }] }, now }).items[0];
  assert.equal(stepped.predicted, 5, 'the step is never more than the gap');
  const cap = plan({ metrics, levers: { ready: [lever('L')] }, now, cap: 1 });
  assert.equal(cap.items.length, 1);
  const cool = plan({ metrics, levers: { ready: [lever('L')] }, ledger: [{ key: 'L-ready-1', lever: 'L', at: now - 1 * D }, { key: 'L-ready-2', lever: 'L', at: now - 20 * D }], now });
  assert.deepEqual(cool.items.map(i => i.key), ['L-ready-2'], 'a key filed inside the cooldown is not filed again; after 14 days it is');
  const ranked = plan({ metrics: [{ id: 'm', value: 1, target: 5 }], levers: { m: [lever('bad'), lever('good')] }, ledger: [{ lever: 'good', outcome: 'kept', at: now - 30 * D, key: 'x' }, { lever: 'bad', outcome: 'missed', at: now - 30 * D, key: 'y' }], now, cap: 4 });
  assert.deepEqual(ranked.items.map(i => i.lever), ['good', 'good', 'bad', 'bad'], 'levers that worked go first');
  const dup = plan({ metrics: [{ id: 'm', value: 1, target: 5 }], levers: { m: [{ id: 'A', propose: () => [{ key: 'same' }] }, { id: 'B', propose: () => [{ key: 'same' }] }] }, now });
  assert.equal(dup.items.length, 1, 'one key is filed once');
  const split = { id: 'L', propose: () => [{ key: 'big', title: 'big' }], split: () => [{ title: 'a' }, { key: 'custom', title: 'b' }] };
  assert.deepEqual(plan({ metrics: [{ id: 'm', value: 1, target: 5 }], levers: { m: [split] }, failures: { big: 2 }, now }).items.map(i => [i.key, i.parent]).sort(), [['big/1', 'big'], ['custom', 'big']]);
  assert.deepEqual(plan({ metrics: [{ id: 'm', value: 1, target: 5 }], levers: { m: [{ id: 'N', propose: split.propose }] }, failures: { big: 3 }, now }).items, [], 'a lever with no split stops offering an item that failed twice');
});

test('US-29-R60: settle grades a due prediction kept when the metric moved toward the target by at least half the predicted move, and leaves unreadable or not-yet-due ones pending', () => {
  const up = { key: 'u', lever: 'L', metric: 'm', op: '>=', base: 0.5, predicted: 0.55, due: now - 1 };
  const out = settle([up, { ...up, key: 'v' }, { ...up, key: 'w' }, { ...up, key: 'x' }], { m: 0.56 }, now);
  assert.equal(out[0].outcome, 'kept'); assert.equal(out[0].settled_at, now); assert.equal(out[0].reading, 0.56);
  assert.equal(settle([up], { m: 0.525 }, now)[0].outcome, 'kept', 'exactly half the predicted move');
  assert.equal(settle([up], { m: 0.51 }, now)[0].outcome, 'missed');
  assert.equal(settle([up], { m: 0.5 }, now)[0].outcome, 'missed', 'no move is a miss');
  assert.equal(settle([up], { m: 0.4 }, now)[0].outcome, 'missed', 'the wrong way is a miss');
  const down = { ...up, op: '<=', base: 0.3, predicted: 0.2 };
  assert.equal(settle([down], { m: 0.25 }, now)[0].outcome, 'kept');
  assert.equal(settle([down], { m: 0.35 }, now)[0].outcome, 'missed');
  const pending = settle([{ ...up, due: now + D }, up, { ...up, outcome: 'kept', reading: 1 }], { m: NaN }, now);
  assert.deepEqual(pending.map(e => e.outcome), [undefined, undefined, 'kept'], 'not yet due, unreadable and already settled entries are not changed');
  assert.equal(settle([{ ...up, outcome: 'missed' }], { m: 0.9 }, now)[0].outcome, 'missed', 'a settled entry is never graded twice');
  assert.equal(settle([{ ...up, due: undefined }], { m: 0.9 }, now)[0].outcome, undefined, 'an entry with no due time is never graded');
});
