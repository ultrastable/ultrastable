// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-27: the dependency-free numeric helpers in core/_shared/linalg.js. No module of the graph, vector or connection code imports them today (the vector code carries its own unit and dot).
import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, gram, ridgeFit, inverse, dot, mean, sd, median, mad, standardize, rng, normal, nearest } from './linalg.js';

const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('US-27-R65: dense solves are exact for a regular system and refuse a singular one, and the inverse multiplies back to the identity', () => {
  const x = solve([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]); [2, 3, -1].forEach((v, i) => close(x[i], v));
  assert.throws(() => solve([[1, 2], [2, 4]], [1, 2]), /singular matrix/); assert.throws(() => solve([[0, 0], [0, 0]], [0, 0]), /singular matrix/);
  const A = [[4, 7], [2, 6]], inv = inverse(A); for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) close(A[i].reduce((s, v, k) => s + v * inv[k][j], 0), i === j ? 1 : 0);
  const beta = ridgeFit([[1, 0], [1, 1], [1, 2], [1, 3]], [1, 3, 5, 7], 1e-9); close(beta[0], 1, 1e-3); close(beta[1], 2, 1e-3);
  assert.deepEqual(gram([[1, 2], [1, 4]], 10), [[2, 6], [6, 20 + 10]], 'the intercept column is not penalised');
});

test('US-27-R65: summaries are mean, sample standard deviation, median and the robust spread, and standardising centres each column', () => {
  close(mean([1, 2, 3, 4]), 2.5); assert.equal(mean([]), 0); close(sd([2, 4, 4, 4, 5, 5, 7, 9]), Math.sqrt(32 / 7)); assert.equal(sd([5]), 0);
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 2, 3]), 2.5); close(mad([1, 2, 3, 4, 100]), 1.4826);
  assert.equal(dot([1, 2, 3], [4, 5, 6]), 32);
  const { Z, means, sds } = standardize([[1, 10], [2, 10], [3, 10]]); assert.deepEqual(means, [2, 10]); assert.deepEqual(sds, [1, 1], 'a constant column has a spread of one, never zero'); close(mean(Z.map(r => r[0])), 0); assert.deepEqual(Z.map(r => r[1]), [0, 0, 0]);
  assert.deepEqual(nearest([[0, 0], [1, 0], [5, 5], [0.5, 0]], 0, 2, [0, 1, 2, 3]), [3, 1], 'the k nearest rows to row i among the allowed ones, never row i itself');
});

test('US-27-R65: a seeded generator reproduces every number from its seed, and normal draws centre on zero', () => {
  const a = rng(7), b = rng(7), c = rng(8); const xs = Array.from({ length: 5 }, () => a()), ys = Array.from({ length: 5 }, () => b());
  assert.deepEqual(xs, ys); assert.notEqual(c(), xs[0]); assert.ok(xs.every(v => v >= 0 && v < 1));
  const r = rng(42), draws = Array.from({ length: 4000 }, () => normal(r)); assert.ok(Math.abs(mean(draws)) < 0.1 && Math.abs(sd(draws) - 1) < 0.1);
});
