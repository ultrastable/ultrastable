// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as gate from './gate.js';
import { pagedStore, fromGithubIssues } from './stores.js';

const mig = fileURLToPath(new URL('./migrations/', import.meta.url));
const mk = () => ({ ctx: { db: makeDb([mig]), now: () => Date.parse('2026-03-02T12:00:00Z'), config: {} } });
const pagesOf = (rows, size) => async page => ({ rows: rows.slice((page - 1) * size, page * size), next: page * size < rows.length ? page + 1 : null });
const open = (prefix, n) => Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, status: 'open' }));

test('US-08-R11: a paged store with 3 pages is read completely and counted once per key', async () => {
  const rows = [...open('a', 25), { key: 'a3', status: 'open' }];   // a3 repeated on the last page
  const store = pagedStore({ name: 'tracker', visible: true, listPage: pagesOf(rows, 10) });
  const r = await store.readAll();
  assert.deepEqual([r.pages, r.truncated, r.rows.length], [3, false, 25]);
  const { ctx } = mk();
  const v = await gate.visibilityRatio(ctx, { stores: [store] });
  assert.deepEqual([v.open_all, v.open_visible, v.fired], [25, 25, false]);
});

test('US-17-R11: 303 open in a hidden store against 12 visible fires through pagedStore stores (all 315 over visible 12 is 26.25)', async () => {
  const { ctx } = mk();
  const stores = [pagedStore({ name: 'ops-tracker', visible: true, listPage: pagesOf(open('v', 12), 5) }), pagedStore({ name: 'hidden-tracker', visible: false, listPage: pagesOf(open('h', 303), 100) })];
  const v = await gate.visibilityRatio(ctx, { stores });
  assert.deepEqual([v.open_all, v.open_visible, v.ratio, v.fired], [315, 12, 315 / 12, true]);
  assert.equal(v.ratio, 26.25);
});

test('US-08-R11: a store that hits maxPages is reported truncated and the reading is unmeasured, not a pass', async () => {
  const { ctx } = mk();
  const big = pagedStore({ name: 'big', visible: false, listPage: pagesOf(open('b', 1000), 10), maxPages: 5 });
  const r = await big.readAll();
  assert.deepEqual([r.truncated, r.pages, r.rows.length], [true, 5, 50]);
  const seen = pagedStore({ name: 'seen', visible: true, listPage: pagesOf(open('s', 2), 10) });
  const v = await gate.visibilityRatio(ctx, { stores: [seen, big] });
  assert.deepEqual([v.unread, v.fired], [['big'], false]);
  assert.match(v.stores.find(s => s.name === 'big').error, /truncated after 5 pages/);
});

test('US-08-R11: pull requests in a GitHub payload are not counted as issues', () => {
  const rows = fromGithubIssues([{ number: 1, state: 'open' }, { number: 2, state: 'closed' }, { number: 3, state: 'open', pull_request: { url: 'x' } }], { prefix: 'org/app#' });
  assert.deepEqual(rows, [{ key: 'org/app#1', status: 'open' }, { key: 'org/app#2', status: 'closed' }]);
  assert.deepEqual(fromGithubIssues(null), []);
  assert.throws(() => pagedStore({ name: 'x' }), /listPage/);
});
