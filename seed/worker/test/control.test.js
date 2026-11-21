// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { reversals, dampedCooldown, burnRate, errorBudget } from '../src/control.js';

const H = 3600e3, now = 1_000 * 24 * H;
test('reversals counts direction changes', () => {
  assert.equal(reversals([{ at: 1, old: 1, new: 2 }, { at: 2, old: 2, new: 1 }, { at: 3, old: 1, new: 2 }, { at: 4, old: 2, new: 1 }]), 3);
  assert.equal(reversals([{ at: 1, old: 1, new: 2 }, { at: 2, old: 2, new: 3 }]), 0);
});
test('a chattering knob gets an exponentially longer, capped cooldown', () => {
  const chatter = Array.from({ length: 6 }, (_, i) => ({ at: i, old: i % 2, new: (i + 1) % 2 }));
  const d = dampedCooldown(24, chatter);
  assert.equal(d.reversals, 5); assert.equal(d.cooldown_h, 24 * 16); assert.ok(d.damped);
  assert.equal(dampedCooldown(24, [{ at: 1, old: 0, new: 1 }]).cooldown_h, 24);
});
test('burn rate is miss fraction over budget', () => {
  const s = Array.from({ length: 10 }, (_, i) => ({ at: now - i * 60e3, ok: i >= 2 }));
  const b = burnRate(s, 0.9, { now, window_h: 1 });
  assert.equal(b.n, 10); assert.ok(Math.abs(b.burn - 2) < 1e-9);
});
test('multiwindow rules: fast burn pages, healthy stays within budget', () => {
  const bad = Array.from({ length: 120 }, (_, i) => ({ at: now - i * 60e3, ok: false }));
  const e = errorBudget(bad, 0.99, { now });
  assert.equal(e.state, 'burning fast'); assert.equal(e.budget_remaining, 0);
  const good = Array.from({ length: 120 }, (_, i) => ({ at: now - i * H, ok: true }));
  assert.equal(errorBudget(good, 0.9, { now }).state, 'within budget');
  assert.equal(errorBudget([], 0.9, { now }).state, 'no readings');
});
