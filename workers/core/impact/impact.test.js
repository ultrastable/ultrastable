// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { record, assess, weights, plan, settle } from './index.js';
const D = 86400e3, now = 100 * D;
test('record keeps one point a day and skips unreadable values', () => {
  let h = record({}, { a: 1, b: NaN }, now); h = record(h, { a: 2 }, now + 1000);
  assert.deepEqual(h.a, [{ at: now, v: 2 }]); assert.deepEqual(h.b, []);
});
test('assess: unknown without history, plateau, rising, met', () => {
  const m = { id: 'r', value: 0.5, target: 0.6 };
  assert.equal(assess(m, [], { now }).status, 'unknown');
  assert.equal(assess(m, [{ at: now - 8 * D, v: 0.5 }], { now }).status, 'plateau');
  assert.equal(assess(m, [{ at: now - 8 * D, v: 0.4 }], { now }).status, 'rising');
  assert.equal(assess({ ...m, value: 0.7 }, [], { now }).status, 'met');
  assert.equal(assess({ id: 'x', value: 5, target: 3, op: '<=' }, [{ at: now - 8 * D, v: 3 }], { now }).status, 'falling');
});
const lever = { id: 'L', propose: ({ metric }) => [{ key: `k-${metric.id}-1`, title: 't', body: 'b' }, { key: `k-${metric.id}-2`, title: 't2', body: 'b' }] };
test('plan files bounded, deduplicated items with a prediction; met metrics get none', () => {
  const metrics = [{ id: 'ready', value: 0.5, target: 0.6 }, { id: 'done', value: 1, target: 1 }];
  const p = plan({ metrics, levers: { ready: [lever], done: [lever] }, open: ['k-ready-1'], now, cap: 3 });
  assert.deepEqual(p.items.map(i => i.key), ['k-ready-2']); assert.match(p.items[0].prediction, /^ready >= 0\.5\d* within 168 h$/);
});
test('settle grades due items and weights favour levers that worked', () => {
  const l = [{ key: 'a', lever: 'good', metric: 'm', op: '>=', base: 0.5, predicted: 0.55, due: now - 1 }, { key: 'b', lever: 'bad', metric: 'm', op: '>=', base: 0.5, predicted: 0.55, due: now - 1 }, { key: 'c', lever: 'bad', metric: 'm', op: '>=', base: 0.5, predicted: 0.55, due: now + D }];
  const s = settle(l, { m: 0.56 }, now); assert.equal(s[0].outcome, 'kept'); assert.equal(s[2].outcome, undefined);
  const s2 = settle([l[1]], { m: 0.5 }, now); assert.equal(s2[0].outcome, 'missed');
  const w = weights([...s, ...s2]); assert.ok(w.good > w.bad);
});
test('an item that failed twice is split by its lever into children, never offered whole again', () => {
  const metrics = [{ id: 'm', value: 1, target: 5 }];
  const lv = { id: 'L', propose: () => [{ key: 'big', title: 'big', body: 'b' }], split: it => [{ title: 'a', body: 'x' }, { key: 'custom', title: 'b', body: 'y' }] };
  assert.deepEqual(plan({ metrics, levers: { m: [lv] }, now }).items.map(i => i.key), ['big']);
  const p = plan({ metrics, levers: { m: [lv] }, failures: { big: 2 }, now });
  assert.deepEqual(p.items.map(i => i.key).sort(), ['big/1', 'custom']); assert.ok(p.items.every(i => i.parent === 'big'));
  assert.deepEqual(plan({ metrics, levers: { m: [{ id: 'N', propose: lv.propose }] }, failures: { big: 3 }, now }).items, []);
});
