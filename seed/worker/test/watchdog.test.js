// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { watchGithub, WATCHDOG_MAX_AGE_MS } from '../src/watchdog.js';
import { LANE_LOOPS, HEAVY_LOOPS, failed } from '../src/pulse.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const api = (lastIso, dispatchStatus = 204, calls = []) => async (url, opt = {}) => {
  calls.push([opt.method || 'GET', url]);
  if (url.includes('/dispatches')) return { status: dispatchStatus };
  return { status: 200, json: async () => ({ workflow_runs: lastIso ? [{ created_at: lastIso }] : [] }) };
};

test('a fresh GitHub watchdog is left alone', async () => {
  const calls = [];
  const r = await watchGithub({ token: 't', repo: 'o/r', fetchImpl: api('2026-11-17T09:00:00Z', 204, calls), now: () => NOW });
  assert.equal(r.status, 'fresh'); assert.equal(calls.length, 1);
});

test('US-24-R58 US-24-T11: a stalled GitHub watchdog is dispatched again (stall recovery)', async () => {
  const calls = [];
  const r = await watchGithub({ token: 't', repo: 'o/r', fetchImpl: api('2026-11-16T09:00:00Z', 204, calls), now: () => NOW });
  assert.equal(r.status, 'dispatched'); assert.deepEqual(calls[1][0], 'POST'); assert.match(calls[1][1], /watchdog\.yml\/dispatches$/);
  assert.equal(failed(r), null);
});

test('a watchdog that never ran is dispatched', async () => {
  const r = await watchGithub({ token: 't', repo: 'o/r', fetchImpl: api(null), now: () => NOW });
  assert.equal(r.status, 'dispatched'); assert.equal(r.why, 'never ran');
});

test('US-24-R58 US-24-T11: a refused dispatch and a missing token are failures, never healthy', async () => {
  const bad = await watchGithub({ token: 't', repo: 'o/r', fetchImpl: api('2026-11-10T00:00:00Z', 403), now: () => NOW });
  assert.ok(failed(bad)); assert.match(bad.status, /HTTP 403/);
  assert.ok(failed(await watchGithub({ repo: 'o/r' })));
});

test('the loop is declared, rotated and wired in the scheduled handler', () => {
  assert.ok(LANE_LOOPS.includes('watchdog-gh')); assert.ok(HEAVY_LOOPS.includes('watchdog-gh'));
  const idx = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(idx, /(b|step)\('watchdog-gh'/); assert.match(idx, /'watchdog-gh': 3/);
  assert.ok(WATCHDOG_MAX_AGE_MS >= 2 * 6 * 3600e3);
});
