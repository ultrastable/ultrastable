// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTuning } from '../src/pace.js';
import { tune } from '../src/roi.js';
const cfg = { pace: { idle_runs: 4, max_stride: 4, never_pace: ['executor'], gauges: [] } };
test('near the limit a loop stretches, capped at twice max_stride; never_pace loops are untouched', () => {
  assert.equal(applyTuning(1, tune({ a: 0.96 }), cfg, 'scout'), 2);
  assert.equal(applyTuning(1, tune({ a: 9 }), cfg, 'scout'), 8);
  assert.equal(applyTuning(1, tune({ a: 0.96 }), cfg, 'executor'), 1);
});
test('far under the limit an earned stride halves; a fitting pace changes nothing', () => {
  assert.equal(applyTuning(4, tune({ a: 0.2 }), cfg, 'scout'), 2);
  assert.equal(applyTuning(4, tune({ a: 0.75 }), cfg, 'scout'), 4);
  assert.equal(applyTuning(2, null, cfg, 'scout'), 2);
});
