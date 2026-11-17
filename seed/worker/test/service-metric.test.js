// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Q-TENANT-TOPOLOGY-1: the service metric source reads a service binding's /health and is healthy only on ok + selftest pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readMetric } from '../src/tick.js';

const bind = (body, status = 200) => ({ fetch: async () => new Response(JSON.stringify(body), { status }) });
const m = { source: 'service', spec: 'TENANTS /health' };
test('pass is 1', async () => assert.equal(await readMetric(null, m, { env: { TENANTS: bind({ ok: true, selftest: { result: 'pass' } }) } }), 1));
test('failed self-test is 0', async () => assert.equal(await readMetric(null, m, { env: { TENANTS: bind({ ok: false, selftest: { result: 'fail:vector' } }) } }), 0));
test('missing binding is 0', async () => assert.equal(await readMetric(null, m, { env: {} }), 0));
test('error is 0', async () => assert.equal(await readMetric(null, m, { env: { TENANTS: { fetch: async () => { throw new Error('x'); } } } }), 0));

import { STEPS } from '../src/tick.js';
import { makeDb } from './d1shim.js';
test('measure seeds probe-backed instance metrics from config, skips declared ones', async () => {
  const db = makeDb();
  const ctx = { config: { org_slug: 'x', seed_metrics: [
    { id: 'M-svc', objective_id: 'OBJ-2', name: 'n', kind: 'guard', source: 'service', spec: 'TENANTS /health', op: '>=', threshold: 1, grace_hours: 2, owner_role: 'r', remedy: 'x' },
    { id: 'M-decl', name: 'n', kind: 'target', source: 'declared', spec: 's', op: '>=', threshold: 1, owner_role: 'r', remedy: 'x' }] },
    env: {}, now: Date.now(), nowIso: new Date().toISOString(), notes: [], errors: [] };
  await STEPS.measure(db, ctx).catch(() => {});
  const ids = (await db.prepare("SELECT id FROM metrics WHERE id IN ('M-svc','M-decl')").all()).results.map(r => r.id);
  assert.deepEqual(ids, ['M-svc']);
});
