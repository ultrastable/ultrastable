// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// DECLARED-LIVE-1: declared repository visibility wins over drift; every tenant back end has the tick's pulse as a second route to run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileVisibility, pulseTenants } from '../src/declared.js';

function gh(state) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(url), m = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null; calls.push({ m, path: u.pathname, body });
    const repo = u.pathname.replace(/^\/repos\//, '');
    if (!(repo in state)) return new Response('{"message":"Not Found"}', { status: 404 });
    if (m === 'PATCH') { if (state[repo].refuse) return new Response('{"message":"Must have admin rights"}', { status: 403 }); state[repo].private = body.private; }
    return new Response(JSON.stringify(state[repo]), { status: 200 });
  };
  return { f, calls };
}

test('a repository made private against its public declaration is set public again', async () => {
  const s = { 'ultrastable/replication-ledger': { private: true }, 'ultrastable/unlearn': { private: false } }, w = gh(s);
  const r = await reconcileVisibility({ token: 't', repos: [{ repo: 'ultrastable/replication-ledger', private: false }, { repo: 'ultrastable/unlearn', private: false }], fetchImpl: w.f });
  assert.equal(r.status, 'ok'); assert.equal(r.checked, 2);
  assert.deepEqual(r.fixed, ['ultrastable/replication-ledger']); assert.equal(s['ultrastable/replication-ledger'].private, false);
  assert.equal(w.calls.filter(c => c.m === 'PATCH').length, 1);
});
test('a refused change stays drift, an unreadable repository is unmeasured, an archived one is left alone', async () => {
  const s = { 'ultrastable/seed': { private: true, refuse: true }, 'ultrastable/old': { private: true, archived: true } }, w = gh(s);
  const r = await reconcileVisibility({ token: 't', repos: [{ repo: 'ultrastable/seed', private: false }, { repo: 'ultrastable/gone', private: false }, { repo: 'ultrastable/old', private: false }], fetchImpl: w.f });
  assert.equal(r.status, 'drift'); assert.equal(r.fixed.length, 0);
  assert.match(r.unmeasured.join(' '), /seed: set public refused, HTTP 403/); assert.match(r.unmeasured.join(' '), /gone: not visible/);
  assert.equal(w.calls.filter(c => c.m === 'PATCH' && c.path.endsWith('/old')).length, 0);
});
test('without a token visibility is reported unmeasured, never in order', async () => {
  assert.equal((await reconcileVisibility({ token: '', repos: [{ repo: 'ultrastable/x', private: false }] })).status, 'no-token');
});
test('each tenant pulse is called once; a stale one runs, a fresh one is skipped, a dead one is a failure', async () => {
  const seen = [];
  const f = async (url, init) => {
    seen.push([url, init.method]);
    if (url.includes('ran')) return new Response('{"ok":true,"n":4}', { status: 200 });
    if (url.includes('fresh')) return new Response('{"ok":true,"skipped":"the last beat is recent"}', { status: 200 });
    return new Response('{"ok":false,"error":"no database bound"}', { status: 503 });
  };
  const r = await pulseTenants({ targets: [{ id: 'a', url: 'https://ran.example/pulse/watch' }, { id: 'b', url: 'https://fresh.example/pulse/watch' }, { id: 'c', url: 'https://dead.example/pulse/watch' }, { id: 'd', url: 'http://plain.example' }], fetchImpl: f });
  assert.deepEqual(r.ran, ['a']); assert.deepEqual(r.fresh, ['b']); assert.equal(r.failed.length, 2); assert.equal(r.status, 'failed');
  assert.ok(seen.every(([, m]) => m === 'POST')); assert.equal(seen.length, 3);
});
