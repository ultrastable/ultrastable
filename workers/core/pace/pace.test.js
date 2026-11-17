// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usage, metrics, plan, rank, breaches } from './index.js';

const L = [
  { id: 'tick', cadence_s: 600, cost: { requests: 1 }, runs: 100, outputs: 40 },
  { id: 'idle', cadence_s: 3600, cost: { requests: 1 }, runs: 24, outputs: 0 },
  { id: 'hook', cadence_s: 3600, cost: { requests: 1 }, runs: 5, outputs: 3, event: true },
];
test('usage projects daily cost per resource', () => { assert.equal(usage(L).requests, 144 + 24 + 24); });
test('metrics: progress per run and free share', () => {
  const m = metrics(L, { requests: 1000 });
  assert.equal(m.progress_per_run, +(43 / 129).toFixed(4)); assert.equal(m.free_share.requests, 0.192); assert.deepEqual(m.over_limit, []);
});
test('plan: idle backs off, productive speeds up within headroom, event loops poll only as fallback', () => {
  const p = Object.fromEntries(plan(L, { requests: 1000 }).map(d => [d.id, d]));
  assert.equal(p.idle.action, 'back_off'); assert.equal(p.idle.to_s, 7200);
  assert.equal(p.tick.action, 'speed_up'); assert.equal(p.tick.to_s, 300);
  assert.equal(p.hook.action, 'event'); assert.equal(p.hook.to_s, 86400);
});
test('plan: no speed-up past the safety share of a free limit', () => {
  const p = plan([{ id: 'tick', cadence_s: 600, cost: { requests: 1 }, runs: 10, outputs: 5 }], { requests: 150 });
  assert.equal(p[0].action, 'hold'); assert.equal(p[0].to_s, 600);
});
test('rank: cheapest high-reach work first', () => {
  const r = rank([{ id: 'a', reach: 100, impact: 1, probability: 0.5, cost: 10 }, { id: 'b', reach: 30, impact: 2, probability: 0.9, cost: 1 }]);
  assert.equal(r[0].id, 'b');
});
test('breaches: over limit and no progress', () => {
  assert.equal(breaches([{ id: 'x', cadence_s: 60, cost: { requests: 1 }, runs: 10, outputs: 0 }], { requests: 100 }).length, 2);
});
