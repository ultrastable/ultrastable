// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-04 (the plus share check in the platform seed): the seed's check_plus_share step is deferred, never dropped, while the free tier is degraded.
// Uses only files of the seed: it runs in a seed checkout too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepPlan, FREE_TIER_WIDE_STEPS, LEAN_EVERY_H } from '../src/tick.js';

const quiet = Date.parse('2026-11-10T01:30:00Z'), hourStart = Date.parse('2026-11-10T02:05:00Z'), thirdHour = Date.parse('2026-11-10T03:05:00Z');

test('US-04-R02: while the free tier is degraded the plus share check runs on the first tick of each hour and is deferred on the others, so it is never skipped for good', () => {
  assert.ok(FREE_TIER_WIDE_STEPS.includes('check_plus_share'));
  assert.equal(stepPlan('check_plus_share', { now: quiet }), 'run', 'no degradation: it runs every tick');
  assert.equal(stepPlan('check_plus_share', { degrade: true, now: quiet }), 'defer', 'degraded, second half of the hour: deferred');
  assert.equal(stepPlan('check_plus_share', { degrade: true, now: hourStart }), 'run', 'degraded, first tick of the hour: it runs');
  assert.equal(stepPlan('check_plus_share', { spend: { level: 'throttle', knobs: {} }, now: quiet }), 'defer');
  assert.equal(stepPlan('check_plus_share', { spend: { level: 'throttle', knobs: { wide_every_h: 3 } }, now: hourStart }), 'defer', 'a wider knob widens the interval');
  assert.equal(stepPlan('check_plus_share', { spend: { level: 'throttle', knobs: { wide_every_h: 3 } }, now: thirdHour }), 'run');
});

test('US-04-R02: under a cost breach the plus share check runs on the first tick of every third hour', () => {
  assert.equal(LEAN_EVERY_H, 3);
  assert.equal(stepPlan('check_plus_share', { lean: true, now: hourStart }), 'defer');
  assert.equal(stepPlan('check_plus_share', { lean: true, now: thirdHour }), 'run');
});
