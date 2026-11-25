// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepPlan, SPEND_KEEP_STEPS, COST_ESSENTIAL_STEPS } from '../src/stepplan.js';

test('SPEND-SOFT-1: essential steps run at every spend level; the rest are deferred, never dropped for good', () => {
  const off = Date.parse('2026-11-21T01:30:00Z'), due = Date.parse('2026-11-21T03:05:00Z');
  for (const level of ['full', 'ease', 'throttle', 'crawl']) for (const s of SPEND_KEEP_STEPS) assert.equal(stepPlan(s, { spend: { level, knobs: {} }, now: off }), 'run');
  assert.equal(stepPlan('pulse', { spend: { level: 'crawl', knobs: { extra_every_h: 3 } }, now: off }), 'defer');
  assert.equal(stepPlan('pulse', { spend: { level: 'crawl', knobs: { extra_every_h: 3 } }, now: due }), 'run');
  for (const s of COST_ESSENTIAL_STEPS) assert.equal(stepPlan(s, { lean: true, now: off }), 'run');
  assert.equal(stepPlan('dispatch', { lean: true, now: due }), 'run');  // lean was a hard skip before the port
});
