// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { watchFreshness } from '../src/freshness.js';
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
const mk = (fresh, runs) => { const calls = []; return { calls, f: async (u, i = {}) => { calls.push((i.method || 'GET') + ' ' + u); if (u.endsWith('/api/freshness')) return J(fresh, fresh.ok ? 200 : 503); if (u.includes('/runs')) return J({ workflow_runs: runs }); return new Response(null, { status: 204 }); } }; };
test('fresh does nothing', async () => { const m = mk({ ok: true }, []); assert.equal((await watchFreshness({ token: 't', repo: 'o/r', fetchImpl: m.f })).status, 'fresh'); assert.equal(m.calls.length, 1); });
test('stale snapshot dispatches the workflow', async () => { const m = mk({ ok: false, snapshot: { stale: true, age_s: 9e5 } }, []); const r = await watchFreshness({ token: 't', repo: 'o/r', fetchImpl: m.f }); assert.equal(r.repair, 'dispatched'); assert.ok(m.calls.some(c => c.startsWith('POST') && c.endsWith('/dispatches'))); });
test('cooldown prevents a dispatch storm', async () => { const m = mk({ ok: false, snapshot: { stale: true } }, [{ created_at: new Date().toISOString() }]); assert.equal((await watchFreshness({ token: 't', repo: 'o/r', fetchImpl: m.f })).repair, 'cooldown'); });
test('stale changes alone is reported, not dispatched', async () => { const m = mk({ ok: false, snapshot: { stale: false }, changes: { stale: true } }, []); const r = await watchFreshness({ token: 't', repo: 'o/r', fetchImpl: m.f }); assert.equal(r.status, 'stale'); assert.equal(r.repair, undefined); });
