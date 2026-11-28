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

test('watchGhOnly dispatches a stale loop and one whose Pages just turned on, and leaves a running one alone', async () => {
  const { watchGhOnly } = await import('../src/declared.js');
  const now = Date.parse('2026-11-26T20:00:00Z'), calls = [];
  const runs = { 'a/stale': '2026-11-26T10:00:00Z', 'a/pages': '2026-11-26T19:00:00Z', 'a/busy': null, 'a/fresh': '2026-11-26T19:30:00Z' };
  const f = async (url, o = {}) => {
    calls.push((o.method || 'GET') + ' ' + url);
    const m = url.match(/repos\/(a\/\w+)\/(.*)$/);
    if (url === 'https://x.github.io/pages/') return new Response('nope', { status: 404 });
    if (m && m[2].startsWith('actions/workflows/loop.yml/runs')) return Response.json({ workflow_runs: [runs[m[1]] ? { status: 'completed', created_at: runs[m[1]] } : { status: 'in_progress', created_at: '2026-11-26T19:59:00Z' }] });
    if (m && m[2] === 'pages') return m[1] === 'a/pages' ? Response.json({ html_url: 'https://x.github.io/pages/' }) : new Response('{}', { status: 404 });
    if (m && m[2].endsWith('/dispatches')) return new Response(null, { status: 204 });
    return new Response('{}', { status: 500 });
  };
  const r = await watchGhOnly({ token: 't', loops: ['stale', 'pages', 'busy', 'fresh'].map(n => ({ repo: 'a/' + n })), fetchImpl: f, now });
  assert.deepEqual(r.dispatched.map(x => x.split(':')[0]), ['a/stale', 'a/pages']);
  assert.equal(r.checked, 4);
  assert.ok(!calls.some(c => c.includes('a/busy') && c.startsWith('POST')));
  assert.equal((await watchGhOnly({ token: '' })).status, 'no-token');
});

test('a GitHub-only loop the tick could not read or dispatch is a failure line, not a pass', async () => {
  const { ghOnlyFailures } = await import('../src/declared.js');
  const loops = [{ repo: 'a/x' }, { repo: 'a/y' }];
  assert.deepEqual(ghOnlyFailures({ status: 'ok', unmeasured: ['a/x: dispatch HTTP 403'] }, loops), ['a/x: dispatch HTTP 403']);
  assert.deepEqual(ghOnlyFailures({ status: 'no-token', why: 'no token' }, loops), ['a/x: no token', 'a/y: no token']);
  assert.deepEqual(ghOnlyFailures({ status: 'ok', dispatched: ['a/y: no run for 9.0 h'], unmeasured: [] }, loops), []);
});
