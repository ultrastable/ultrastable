// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, ridgeFit, mean, median, rng } from './linalg.js';

test('solve and ridgeFit recover a line', () => {
  const [a, b] = solve([[2, 0], [0, 4]], [2, 8]);
  assert.deepEqual([a, b], [1, 2]);
  const beta = ridgeFit([[1, 0], [1, 1], [1, 2], [1, 3]], [1, 3, 5, 7], 1e-9);
  assert.ok(Math.abs(beta[0] - 1) < 1e-3 && Math.abs(beta[1] - 2) < 1e-3);
});

test('summary helpers and a seeded generator are deterministic', () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(rng(7)(), rng(7)());
});
