// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { recency, recencyText, recencyHeaders, stamp } from '../src/recency.js';

const NOW = Date.parse('2026-11-27T10:00:00Z');
const S = 'Rebuilt after every merge and live within 26 hours';

test('a recent update is fresh and reads plainly', () => {
  const r = recency({ updatedAt: '2026-11-27T08:59:30+00:00', maxAgeS: 26 * 3600, schedule: S, now: NOW });
  assert.equal(r.stale, false); assert.equal(r.age_s, 3630); assert.equal(r.updated_at, '2026-11-27T08:59:30Z');
  assert.equal(recencyText(r), 'Last updated 08:59 UTC on 2026-11-27. ' + S + '.');
  assert.equal(recencyHeaders(r)['X-Stale'], 'false');
});
test('past its schedule, or with no time at all, is stale', () => {
  assert.equal(recency({ updatedAt: '2026-11-25T08:00:00Z', maxAgeS: 26 * 3600, schedule: S, now: NOW }).stale, true);
  const u = recency({ updatedAt: null, maxAgeS: 60, schedule: S, now: NOW });
  assert.equal(u.stale, true); assert.match(recencyText(u), /unknown/);
});
test('stamp adds headers only where a handler set none', async () => {
  const r = recency({ updatedAt: '2026-11-27T08:59:30Z', maxAgeS: 3600, schedule: S, now: NOW });
  const a = stamp(new Response('x'), r);
  assert.equal(a.headers.get('x-updated-at'), '2026-11-27T08:59:30Z'); assert.equal(await a.text(), 'x');
  const own = stamp(new Response('y', { headers: { 'X-Updated-At': '2026-11-27T09:59:00Z' } }), r);
  assert.equal(own.headers.get('x-updated-at'), '2026-11-27T09:59:00Z'); assert.equal(own.headers.get('x-stale'), null);
});
import { tickRecency } from '../src/recency.js';
test('a tenant stamps its newest finished tick and goes stale after 2 hours', () => {
  assert.equal(tickRecency({ finished_at: '2026-11-27T09:50:00Z' }, NOW).stale, false);
  assert.equal(tickRecency({ finished_at: '2026-11-27T07:00:00Z' }, NOW).stale, true);
  assert.equal(tickRecency(null, NOW).stale, true);
});
import { probeStamps } from '../src/recency.js';
test('the probe passes stamped pages and names unstamped or stale ones', async () => {
  const h = { '/': { 'X-Updated-At': '2026-11-27T11:16:37Z', 'X-Stale': 'false' }, '/a': {}, '/b': { 'X-Updated-At': '2026-11-20T00:00:00Z', 'X-Stale': 'true' } };
  const f = async (u) => new Response('x', { headers: h[new URL(u).pathname] });
  assert.equal((await probeStamps({ siteUrl: 'https://s', paths: ['/'], fetchImpl: f })).status, 'fresh');
  const r = await probeStamps({ siteUrl: 'https://s', paths: ['/', '/a', '/b'], fetchImpl: f });
  assert.equal(r.status, 'stale'); assert.deepEqual(r.bad, ['/a: no X-Updated-At', '/b: stale since 2026-11-20T00:00:00Z']);
});
