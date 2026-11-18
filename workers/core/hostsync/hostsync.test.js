// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, diff, reconcile } from './index.js';
import { gatewayHost } from './gateway.js';

const obs = (o = {}) => ({ script: 'app', found: true, sha256: 'aa', bindings: [{ type: 'd1', name: 'DB' }, { type: 'secret_text', name: 'TOKEN' }], crons: ['*/10 * * * *'], workers_dev: true, compat_date: '2026-10-01', compat_flags: [], deployment: { id: 'd1', created_on: 't' }, read_errors: [], ...o });

test('sanitize keeps names and hashes only: a value or text field never passes', () => {
  const s = sanitize(obs({ bindings: [{ type: 'secret_text', name: 'TOKEN', text: 'hunter2', value: 'x' }] }));
  assert.deepEqual(s.bindings, [{ type: 'secret_text', name: 'TOKEN' }]);
  assert.ok(!JSON.stringify(s).includes('hunter2'));
});
test('diff: a matching host has no drift; every mismatch names its field and direction', () => {
  assert.deepEqual(diff({ script: 'app', sha256: 'aa', crons: ['*/10 * * * *'], bindings: ['DB', 'TOKEN'], workers_dev: true }, obs()), []);
  const d = diff({ script: 'app', sha256: 'bb', crons: [], bindings: ['DB', 'TOKEN', 'KV'], workers_dev: false }, obs());
  assert.deepEqual(d.map(i => i.field + ':' + i.direction).sort(), ['bindings:repo-to-host', 'crons:repo-to-host', 'sha256:repo-to-host', 'workers_dev:repo-to-host']);
  const extra = diff({ script: 'app', bindings: ['DB'] }, obs());
  assert.equal(extra[0].direction, 'host-to-repo'); assert.deepEqual(extra[0].extra, ['TOKEN']);
});
test('diff: a script missing on the host is repo-to-host drift', () => {
  assert.equal(diff({ script: 'app', sha256: 'aa' }, { script: 'app', found: false })[0].field, 'found');
});

function harness(host, declared, redeploy) {
  const files = {}, events = [];
  const run = () => reconcile({ host, declared, write: async (p, t) => { files[p] = t; }, read: async p => files[p] || null, record: async e => events.push(e), redeploy });
  return { files, events, run };
}
test('reconcile writes the host state into the repo, and an unchanged second pass writes nothing', async () => {
  const h = harness({ id: 'h', observe: async () => obs() }, { scripts: { app: { sha256: 'aa' } } });
  const a = await h.run(); assert.equal(a.wrote, true); assert.equal(a.drift.length, 0);
  assert.equal(JSON.parse(h.files['ops/hosting/state.json']).scripts.app.bindings.length, 2);
  const b = await h.run(); assert.equal(b.wrote, false);
});
test('reconcile redeploys a repo-to-host drift, audits it, and does not redeploy host-to-repo drift', async () => {
  const calls = [];
  const h = harness({ id: 'h', observe: async () => obs({ sha256: 'zz' }) }, { scripts: { app: { sha256: 'aa', bindings: ['DB'] } } }, async (s, it) => calls.push([s, it.map(i => i.field)]));
  const r = await h.run();
  assert.deepEqual(calls, [['app', ['sha256']]]); assert.deepEqual(r.redeployed, ['app']);
  assert.ok(h.events.some(e => e.kind === 'host-drift') && h.events.some(e => e.kind === 'host-redeploy') && h.events.some(e => e.kind === 'host-state'));
});
test('an unreadable host is drift with the reason, never a missing row', async () => {
  const h = harness({ id: 'h', observe: async () => { throw new Error('gateway /state 502'); } }, { scripts: { app: { sha256: 'aa' } } });
  const r = await h.run();
  assert.ok(r.drift.some(i => i.field === 'found')); assert.ok(r.drift.some(i => i.field === 'read'));
  assert.equal(JSON.parse(h.files['ops/hosting/state.json']).scripts.app.found, false);
});
test('a failed redeploy is recorded, not thrown', async () => {
  const h = harness({ id: 'h', observe: async () => obs({ sha256: 'zz' }) }, { scripts: { app: { sha256: 'aa' } } }, async () => { throw new Error('dispatch 403'); });
  const r = await h.run(); assert.deepEqual(r.redeployed, []); assert.ok(h.events.some(e => e.kind === 'host-redeploy-failed'));
});
test('gatewayHost asks /state with the run token for the named script', async () => {
  const seen = [];
  const host = gatewayHost({ gateway: 'https://g.example/', oidc: async a => 'tok-for-' + a, fetch: async (u, i) => { seen.push([u, i.headers.authorization]); return new Response(JSON.stringify(obs())); } });
  assert.equal((await host.observe('app')).script, 'app');
  assert.deepEqual(seen, [['https://g.example/state?script=app', 'Bearer tok-for-https://g.example/']]);
});

test('diff: domains, routes and D1 migrations are compared; a pending migration is repo-to-host drift', () => {
  const o = obs({ domains: ['a.example'], routes: ['a.example/*'], migrations: { db1: ['0001', '0002'] } });
  assert.deepEqual(diff({ script: 'app', domains: ['a.example'], routes: ['a.example/*'], migrations: { db1: ['0001', '0002'] } }, o), []);
  const d = diff({ script: 'app', domains: ['b.example'], routes: [], migrations: { db1: ['0001', '0002', '0003'], db2: ['0001'] } }, o);
  assert.deepEqual(d.map(i => i.field).sort(), ['domains', 'migrations', 'migrations', 'routes']);
  assert.deepEqual(d.find(i => i.database === 'db1').missing, ['0003']);
  assert.equal(d.find(i => i.database === 'db2').observed, null);
});
