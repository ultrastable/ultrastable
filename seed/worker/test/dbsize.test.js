// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ADMIT-1 red team: D1 growth is a liveness metric (M-storage). The size is read, and an unreadable size is NaN (a breach), never 0 (a pass).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { METRICS, LIVENESS, dbSizeBytes, DB_LIMIT_BYTES } from '../src/tick.js';

test('the database size is read and turned into a share of the per-database limit', async () => {
  const db = makeDb();
  const b = await dbSizeBytes(db);
  assert.ok(Number.isFinite(b) && b > 0, String(b));
  const share = await METRICS.db_size_share(db);
  assert.ok(share >= 0 && share < 0.01, String(share));
  assert.equal(DB_LIMIT_BYTES, 500e6);
  assert.ok(LIVENESS.some(m => m[0] === 'M-storage' && m[2] === 'db_size_share' && m[3] === '<='));
});

test('D1 size_after wins, and no reading at all is NaN', async () => {
  const d1 = { prepare: () => ({ all: async () => ({ results: [{ n: 1 }], meta: { size_after: 300e6 } }) }) };
  assert.equal(await METRICS.db_size_share(d1), 0.6);
  const dead = { prepare: () => ({ all: async () => { throw new Error('down'); }, first: async () => { throw new Error('down'); } }) };
  assert.ok(Number.isNaN(await METRICS.db_size_share(dead)));
});
