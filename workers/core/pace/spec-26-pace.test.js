// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-26 (the tenant-agnostic pace planner of the reference implementation): pure functions, so the tests need no clock and no store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, usage, metrics, plan, rank, breaches } from './index.js';

const loop = (o = {}) => ({ id: 'l', cadence_s: 3600, cost: { requests: 1 }, runs: 24, outputs: 5, ...o });
const by = (decisions, id) => decisions.find(d => d.id === id);

test('US-26-R74: a loop whose last runs produced nothing backs off, doubling its cadence up to its maximum, and an event loop polls only as a fallback', () => {
  assert.deepEqual(DEFAULTS, { min_s: 300, max_s: 86400, idle_runs: 6, safety: 0.6, factor: 2 });
  const L = [loop({ id: 'idle', outputs: 0 }), loop({ id: 'young', runs: 5, outputs: 0 }), loop({ id: 'cap', cadence_s: 60000, outputs: 0 }), loop({ id: 'hook', event: true, cadence_s: 600 }), loop({ id: 'own', cadence_s: 7200, outputs: 0, max_s: 9000 }), loop({ id: 'top', cadence_s: 86400, outputs: 0 })];
  const p = plan(L, { requests: 1e6 });
  assert.deepEqual(by(p, 'idle'), { id: 'idle', from_s: 3600, to_s: 7200, action: 'back_off', why: '24 runs, 0 outputs' });
  assert.equal(by(p, 'young').action, 'hold', 'fewer than idle_runs runs is not yet idle');
  assert.equal(by(p, 'cap').to_s, 86400, 'never past max_s'); assert.equal(by(p, 'hook').action, 'event'); assert.equal(by(p, 'hook').to_s, 86400);
  assert.equal(by(p, 'own').to_s, 9000, "a loop's own max_s overrides the default");
  assert.deepEqual([by(p, 'top').action, by(p, 'top').to_s], ['hold', 86400], 'an idle loop already at its maximum holds');
  assert.deepEqual(p.map(d => d.id), L.map(l => l.id), 'one decision per loop, in the order given');
});

test('US-26-R74: a productive loop speeds up, halving its cadence down to its minimum, only while every resource stays under 60 percent of its free limit', () => {
  const L = [loop({ id: 'a', cadence_s: 3600, runs: 10, outputs: 8 }), loop({ id: 'floor', cadence_s: 400, runs: 10, outputs: 8 })];
  const fast = plan(L, { requests: 1e6 });
  assert.equal(by(fast, 'a').to_s, 1800); assert.equal(by(fast, 'a').action, 'speed_up'); assert.equal(by(fast, 'floor').to_s, 300, 'never under min_s');
  assert.equal(by(plan([loop({ id: 'x', cadence_s: 300, runs: 10, outputs: 8 })], { requests: 1e6 }), 'x').action, 'hold', 'already at the minimum');
  // headroom: 86400/600 = 144 requests a day now; halving to 300 s would need 288, which must stay at or under 60 percent of the limit
  const one = loop({ id: 'a', cadence_s: 600, runs: 10, outputs: 5 });
  assert.equal(plan([one], { requests: 480 })[0].action, 'speed_up'); assert.equal(plan([one], { requests: 479 })[0].action, 'hold');
  assert.equal(plan([one], { requests: 479 })[0].why, 'no free headroom');
  // the most productive claims headroom first, the least productive gives way first
  const two = [loop({ id: 'low', cadence_s: 600, runs: 10, outputs: 1 }), loop({ id: 'high', cadence_s: 600, runs: 10, outputs: 9 })];
  const p = plan(two, { requests: 800 });  // 432 a day fits under 480, 576 does not
  assert.equal(by(p, 'high').action, 'speed_up'); assert.equal(by(p, 'low').action, 'hold');
});

test('US-26-R74: usage, metrics and breaches are computed from the loops and the free limits; a resource over its limit or a system with no output is a breach', () => {
  const L = [loop({ id: 'a', cadence_s: 600, runs: 100, outputs: 40 }), loop({ id: 'b', cadence_s: 3600, runs: 24, outputs: 0, cost: { requests: 2, ai: 1 } })];
  assert.deepEqual(usage(L), { requests: 144 + 48, ai: 24 });
  const m = metrics(L, { requests: 1000, ai: 20 });
  assert.equal(m.progress_per_run, +(40 / 124).toFixed(4)); assert.deepEqual(m.over_limit, ['ai']); assert.equal(m.free_share.requests, 0.192); assert.equal(m.free_share.ai, 1.2);
  assert.deepEqual(breaches(L, { requests: 1000, ai: 20 }), [{ metric: 'free_share:ai', value: 1.2, limit: 1 }]);
  assert.deepEqual(breaches([loop({ runs: 10, outputs: 0 })], { requests: 1e6 }), [{ metric: 'progress_per_run', value: 0, limit: '>0' }]);
  assert.deepEqual(breaches([loop({ runs: 5, outputs: 0 })], {}), [], 'too few runs to judge');
  assert.deepEqual(metrics([], {}).progress_per_run, 0);
});

test('US-26-R74: work is ranked by reach times impact times probability per unit cost, the cheapest high-reach first, ties by id', () => {
  const r = rank([{ id: 'a', reach: 100, impact: 1, probability: 0.5, cost: 10 }, { id: 'b', reach: 30, impact: 2, probability: 0.9, cost: 1 }, { id: 'c', reach: 30, impact: 2, probability: 0.9, cost: 1 }]);
  assert.deepEqual(r.map(x => x.id), ['b', 'c', 'a']); assert.equal(r[0].score, 54); assert.equal(r[2].score, 5);
  assert.equal(rank([{ id: 'z', reach: 1, cost: 0 }])[0].score, 100, 'a zero cost is floored at 0.01');
});
