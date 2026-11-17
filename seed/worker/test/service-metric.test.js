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
