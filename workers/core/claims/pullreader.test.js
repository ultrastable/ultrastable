// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the readPull port over a REST fetch (US-SPEC-08 US-08-R19). No network: fetch is a fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as C from './index.js';
import { restPullReader } from './pullreader.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const T0 = Date.parse('2026-11-11T10:00:00Z');
const MIN = 60000;
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fakeFetch = (table, calls = []) => async (url, init) => { calls.push({ url, init }); const v = table[url]; return v instanceof Error ? Promise.reject(v) : (v || res(404, {})); };
const BASE = 'https://code.example/api';

test('US-08-R19: restPullReader maps a merged, an open and a closed-unmerged pull request, and sends the injected headers to the REST path', async () => {
  const calls = [];
  const read = restPullReader({ fetch: fakeFetch({
    [`${BASE}/repos/org/app/pulls/1`]: res(200, { state: 'closed', merged_at: '2026-11-11T09:00:00Z', closed_at: '2026-11-11T09:00:00Z' }),
    [`${BASE}/repos/org/app/pulls/2`]: res(200, { state: 'open', merged_at: null, closed_at: null }),
    [`${BASE}/repos/org/app/pulls/3`]: res(200, { state: 'closed', merged_at: null, closed_at: '2026-11-11T08:00:00Z' }),
  }, calls), apiBase: BASE + '/', headers: async () => ({ authorization: 'Bearer from-the-host' }) });
  assert.deepEqual(await read('org/app', 1), { state: 'merged', merged_at: '2026-11-11T09:00:00Z', closed_at: '2026-11-11T09:00:00Z' });
  assert.deepEqual(await read('org/app', 2), { state: 'open' });
  assert.deepEqual(await read('org/app', 3), { state: 'closed', closed_at: '2026-11-11T08:00:00Z' });
  assert.equal(calls[0].url, `${BASE}/repos/org/app/pulls/1`);
  assert.equal(calls[0].init.headers.authorization, 'Bearer from-the-host');
});

test('US-08-R19: a pull request that cannot be read (http error, network error, body with no state) throws, and reapClosedPulls reports it unmeasured and releases nothing', async () => {
  const db = makeDb([MIG]);
  const ctx = { db, now: () => T0 + 120 * MIN, config: { claim_ttl_minutes: 600 } };
  for (const id of ['A', 'B', 'C']) db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('${id}','t','staff','x','ready')`);
  const read = restPullReader({ fetch: fakeFetch({
    [`${BASE}/repos/org/app/pulls/10`]: res(500, {}),
    [`${BASE}/repos/org/app/pulls/11`]: new Error('network down'),
    [`${BASE}/repos/org/app/pulls/12`]: res(200, { message: 'no state here' }),
  }), apiBase: BASE });
  await assert.rejects(() => read('org/app', 10), /http 500/);
  await C.acquire({ ...ctx, now: () => T0 }, { item_id: 'A', holder: 'x', repo: 'org/app', pr: 10 });
  await C.acquire({ ...ctx, now: () => T0 }, { item_id: 'B', holder: 'x', repo: 'org/app', pr: 11 });
  await C.acquire({ ...ctx, now: () => T0 }, { item_id: 'C', holder: 'x', repo: 'org/app', pr: 12 });
  const r = await C.reapClosedPulls(ctx, { readPull: read });
  assert.deepEqual([r.released, r.kept, r.unmeasured.sort()], [[], [], ['item:A', 'item:B', 'item:C']]);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_lock WHERE released_at IS NULL`).get().n, 3);
});

test('US-08-R19: reapClosedPulls over restPullReader releases the claim of a merged pull request read through the fake REST host', async () => {
  const db = makeDb([MIG]);
  const ctx = { db, now: () => T0 + 5 * MIN, config: { claim_ttl_minutes: 600 } };
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('A','t','staff','x','ready')`);
  await C.acquire({ ...ctx, now: () => T0 }, { item_id: 'A', holder: 'agent', repo: 'org/app', pr: 20 });
  const read = restPullReader({ fetch: fakeFetch({ [`${BASE}/repos/org/app/pulls/20`]: res(200, { state: 'closed', merged_at: '2026-11-11T10:01:00Z' }) }), apiBase: BASE });
  const r = await C.reapClosedPulls(ctx, { readPull: read });
  assert.deepEqual(r.released, ['item:A']);
  assert.equal(db.raw.prepare(`SELECT outcome FROM claims_lock`).get().outcome, 'merged');
});

test('US-08-R19: restPullReader refuses missing ports and a malformed repo or pull request number before any call', async () => {
  assert.throws(() => restPullReader({ apiBase: BASE }), /fetch port/);
  assert.throws(() => restPullReader({ fetch: fakeFetch({}) }), /apiBase/);
  const calls = [];
  const read = restPullReader({ fetch: fakeFetch({}, calls), apiBase: BASE });
  await assert.rejects(() => read('not a repo', 1), /owner\/name/);
  await assert.rejects(() => read('org/app', 0), /positive integer/);
  assert.equal(calls.length, 0);
});
