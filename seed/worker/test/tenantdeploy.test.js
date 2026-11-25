// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { watchTenantDeploys } from '../src/tenantdeploy.js';
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
const T = Date.UTC(2026, 10, 25, 16);
const reg = { tenants: { 'what-works': { repo: 'o/what-works', state: 'moved', worker: 'w-ww' }, old: { repo: 'o/old', state: 'moving', worker: 'w-old' } } };
const mk = ({ runs, commitAt }) => { const calls = []; return { calls, f: async (u, i = {}) => { calls.push((i.method || 'GET') + ' ' + u);
  if (u.includes('/contents/')) return J({ content: btoa(JSON.stringify(reg)) });
  if (u.includes('/runs')) return J({ workflow_runs: runs });
  if (u.includes('/commits/main')) return J({ commit: { committer: { date: new Date(commitAt).toISOString() } } });
  return new Response(null, { status: 204 }); } }; };
const run = (at, conclusion = 'success', status = 'completed') => ({ created_at: new Date(at).toISOString(), conclusion, status });

test('a tenant merged after the last deploy is dispatched with only its worker', async () => {
  const m = mk({ runs: [run(T - 7200e3)], commitAt: T - 600e3 });
  const r = await watchTenantDeploys({ token: 't', repo: 'o/core', fetchImpl: m.f, now: () => T });
  assert.equal(r.repair, 'dispatched'); assert.deepEqual(r.behind, ['w-ww']);
  const post = m.calls.find(c => c.startsWith('POST')); assert.match(post, /deploy-ultrastable\.yml\/dispatches$/);
  assert.ok(!m.calls.some(c => c.includes('o/old')), 'a tenant still moving is built from the core, not dispatched');
});
test('a deployed tenant is current; nothing is dispatched', async () => {
  const m = mk({ runs: [run(T - 600e3)], commitAt: T - 7200e3 });
  assert.equal((await watchTenantDeploys({ token: 't', repo: 'o/core', fetchImpl: m.f, now: () => T })).status, 'current');
  assert.ok(!m.calls.some(c => c.startsWith('POST')));
});
test('no dispatch while a deploy runs or inside the cooldown', async () => {
  let m = mk({ runs: [run(T - 60e3, null, 'in_progress'), run(T - 7200e3)], commitAt: T - 600e3 });
  assert.equal((await watchTenantDeploys({ token: 't', repo: 'o/core', fetchImpl: m.f, now: () => T })).status, 'deploy-running');
  m = mk({ runs: [run(T - 900e3, 'failure'), run(T - 7200e3)], commitAt: T - 600e3 });
  assert.equal((await watchTenantDeploys({ token: 't', repo: 'o/core', fetchImpl: m.f, now: () => T })).repair, 'cooldown');
});
test('no token is a stated status, an unreadable registry an error', async () => {
  assert.equal((await watchTenantDeploys({})).status, 'no-token');
  const r = await watchTenantDeploys({ token: 't', repo: 'o/core', fetchImpl: async () => J({}, 404) });
  assert.match(r.status, /^error HTTP 404/);
});
