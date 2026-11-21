// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// FLOW-BALANCE-1: inflow against closures, SLA, honest consolidation and the filing throttle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, consolidate, admit } from '../src/flowbalance.js';

const T = Date.UTC(2026, 10, 21, 12); const H = 3600e3; const D = 24 * H;
const row = (id, o = {}) => ({ id, title: `${id}: thing ${id}`, trigger: 't', probe: 'p', status: 'open', disposition: '', labels: [], created: T - 2 * H, ...o });

test('inflow above closures tips the balance and turns on the throttle and boost', () => {
  const m = measure([row('A-1'), row('A-2'), row('A-3'), row('B-1', { status: 'closed', created: T - 3 * D, closed: T - H })], T);
  assert.deepEqual([m.windows.day.net_inflow, m.windows.day.closed], [3, 1]);
  assert.equal(m.tipped, true); assert.equal(m.throttle.on, true); assert.equal(m.closure_boost, 3);
  assert.equal(admit({ throttle: { on: true, quota_left: 0 } }), false); assert.equal(admit(m), false); assert.equal(admit({ throttle: { on: false } }), true);
});

test('a superseded item lowers net inflow and is never a closure', () => {
  const m = measure([row('A-1', { status: 'closed', disposition: 'superseded', closed: T }), row('A-2', { status: 'closed', created: T - 9 * D, closed: T })], T);
  assert.deepEqual([m.windows.day.filed, m.windows.day.net_inflow, m.windows.day.closed], [1, 0, 1]);
  assert.equal(m.tipped, false);
});

test('SLA follows the priority label', () => {
  const m = measure([row('A-1', { labels: ['p0'], created: T - 3 * D }), row('A-2', { created: T - 3 * D })], T);
  assert.deepEqual(m.sla.worst.map(r => r.id), ['A-1']);
});

test('duplicates need the same title, trigger and probe; per-object families are never batched', () => {
  const rows = [row('Q-X-1', { title: 'Q-X-1: fix renderer', created: T - 5 * D }), row('Q-X-2', { title: 'Q-X-2: fix renderer', created: T - 4 * D }),
    row('Q-X-3', { title: 'Q-X-3: fix renderer', trigger: 'other', created: T - 3 * D })];
  for (let i = 0; i < 8; i++) rows.push(row(`OL-PR-${i}`, { title: `OL-PR-${i}: land PR #${i}` }));
  const a = consolidate(rows, T);
  assert.deepEqual(a, [{ act: 'supersede', id: 'Q-X-2', by: 'Q-X-1' }]);
});

test('a flood from one family becomes one batch', () => {
  const rows = Array.from({ length: 7 }, (_, i) => row(`Q-RES-${i}`));
  const a = consolidate(rows, T);
  assert.equal(a.length, 1); assert.equal(a[0].id, 'BATCH-Q-RES-20261121'); assert.equal(a[0].members.length, 7);
});
