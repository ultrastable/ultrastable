// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// HOSTS-1
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { assertHost, createHosts, reportStatus, reporting, workersTouched, onPush, onHostEvent, watchHosts, githubActionsHost, HOOK_EVENTS } from '../src/hosts.js';

const R = (status, j = {}) => ({ ok: status < 300, status, text: async () => JSON.stringify(j), json: async () => j });
const TOPO = { workers: [{ id: 'ultrastable-tick', main: 'seed/worker/src/index.js', state: 'live' }, { id: 'ultrastable-site', main: 'site/worker.js', state: 'live' }] };
const host = (id, ok) => ({ id, kind: 'x', health: async () => ({ ok, detail: 'd' }), deploy: async () => ok ? { ok: true, detail: 'up' } : { ok: false, detail: 'down' } });

test('a host must implement the interface', () => { assert.throws(() => assertHost({ id: 'a', kind: 'k' })); assert.ok(assertHost(host('a', true))); });
test('deploy fails over to the next host and records both', async () => {
  const db = makeDb(), reg = createHosts([host('a', false), host('b', true)], { db });
  const r = await reg.deploy({ worker: 'w', sha: 's1', repo: 'o/r' });
  assert.equal(r.host, 'b'); assert.equal((await db.prepare('SELECT COUNT(*) n FROM host_events').first()).n, 2);
});
test('commit status falls back when check runs are refused', async () => {
  const calls = []; const f = async (u, o) => { calls.push(u); return u.endsWith('/check-runs') ? R(403) : R(201); };
  const r = await reportStatus({ fetch: f, token: 't', repo: 'o/r', sha: 'abc', context: 'c', state: 'success', description: 'x' });
  assert.equal(r.via, 'status'); assert.equal(calls.length, 2);
});
test('reporting wraps a deployer with pending then final status', async () => {
  const seen = []; const f = async (u, o) => { seen.push(JSON.parse(o.body).status || JSON.parse(o.body).state); return R(201); };
  const r = await reporting(async () => ({ ok: true, version: 'v1' }), { fetch: f, token: 't' })('w', 'abc', 'o/r');
  assert.ok(r.ok); assert.deepEqual(seen, ['in_progress', 'completed']);
});
test('changed files map to the workers they belong to', () => {
  assert.deepEqual(workersTouched(TOPO, ['site/a.js']), ['ultrastable-site']);
  assert.deepEqual(workersTouched(TOPO, ['README.md']), []);
  assert.equal(workersTouched(TOPO, ['doctrine/topology.json']).length, 2);
});
test('a push to main deploys touched workers once and reports on the commit', async () => {
  const db = makeDb(), posts = []; const f = async (u, o = {}) => { if (u.includes('/contents/')) return R(200, TOPO); posts.push(u); return R(201); };
  const reg = createHosts([host('a', true)], { db });
  const payload = { ref: 'refs/heads/main', after: 'abc1234', repository: { full_name: 'o/r', default_branch: 'main' }, commits: [{ modified: ['site/worker.js'] }] };
  const r = await onPush({ db, registry: reg, token: 't', fetch: f, payload });
  assert.deepEqual(r.targets, ['ultrastable-site']); assert.ok(r.results[0].ok);
  const again = await onPush({ db, registry: reg, token: 't', fetch: f, payload });
  assert.match(again.results[0].skipped, /already/);
  assert.equal((await onPush({ db, registry: reg, token: 't', fetch: f, payload: { ...payload, ref: 'refs/heads/x' } })).status, 'ignored');
});
test('an inbound host event is recorded and reported', async () => {
  const db = makeDb(), posts = []; const f = async (u) => { posts.push(u); return R(201); };
  const r = await onHostEvent({ db, token: 't', fetch: f, event: { host: 'gcp', worker: 'w', sha: 'abc', repo: 'o/r', state: 'success' } });
  assert.equal(r.status, 'recorded'); assert.equal((await db.prepare("SELECT COUNT(*) n FROM host_events WHERE kind='deploy'").first()).n, 1);
  assert.equal((await onHostEvent({ db, event: {} })).status, 'bad-event');
});
test('a push with no deploy after the stall window is redispatched through github-actions', async () => {
  const db = makeDb(); const gha = githubActionsHost({ token: 't', repo: 'o/r', fetch: async () => R(204) });
  db.raw.exec("INSERT INTO host_events (at,host,kind,repo,sha,ok,detail) VALUES (1000,'github','inbound','o/r','abc',1,'push')");
  const reg = createHosts([host('cloudflare', true), gha], { db });
  const r = await watchHosts({ db, registry: reg, now: () => 1000 + 40 * 60e3, fetch: async () => R(201) });
  assert.equal(r.stalled.length, 1); assert.equal((await db.prepare("SELECT COUNT(*) n FROM host_events WHERE kind='stall'").first()).n, 1);
});
test('a handoff stuck in deploy_failed is returned to the lane once a host reports a successful deploy', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO handoffs (id, repo, pr, state, deploy, updated_at) VALUES ('o/r#1','o/r',1,'deploy_failed','w','2026-01-01 00:00:00'); INSERT INTO host_events (at,host,kind,worker,ok) VALUES (" + Date.now() + ",'github-actions','deploy','w',1)");
  const r = await watchHosts({ db, registry: createHosts([host('a', true)], { db }), now: () => Date.now() });
  assert.deepEqual(r.reconciled, ['o/r#1']); assert.equal((await db.prepare("SELECT state FROM handoffs WHERE id='o/r#1'").first()).state, 'merged');
});
import { hookSecret, reconcileHooks } from '../src/hosts.js';
const HJ = (hooks, s = 200) => async (u, o = {}) => { calls.push((o.method || 'GET')); return u.endsWith('/hooks') && o.method === 'GET' ? R(s, hooks) : R(o.method === 'POST' ? 201 : 200, {}); };
let calls = [];
test('webhook secrets are derived inside the Worker, stable and distinct', async () => {
  const a = await hookSecret({ CREDENTIAL_KEY: 'k' }, 'github'), b = await hookSecret({ CREDENTIAL_KEY: 'k' }, 'host');
  assert.equal(a, await hookSecret({ CREDENTIAL_KEY: 'k' }, 'github')); assert.notEqual(a, b); assert.equal(await hookSecret({}, 'github'), '');
});
test('the reconciler creates a missing hook, repairs a failing one, and leaves a healthy one', async () => {
  calls = []; let r = await reconcileHooks({ token: 't', repos: ['o/r'], secret: 's', fetch: HJ([]) }); assert.equal(r.repos['o/r'], 'created');
  const hook = { id: 1, active: true, events: ['push', 'pull_request', 'issues', 'issue_comment', 'release', 'check_suite'], config: { url: 'https://ultrastable.io/hook/github' } };
  calls = []; r = await reconcileHooks({ token: 't', repos: ['o/r'], secret: 's', fetch: HJ([{ ...hook, last_response: { code: 401 } }]) }); assert.match(r.repos['o/r'], /repaired.*401/); assert.ok(calls.includes('PATCH'));
  calls = []; r = await reconcileHooks({ token: 't', repos: ['o/r'], secret: 's', fetch: HJ([hook]) }); assert.equal(r.repos['o/r'], 'present'); assert.ok(!calls.includes('PATCH'));
  // FREE-TIER-1: a hook still subscribed to workflow_run is narrowed, so the delivery storm stops without a person editing the hook
  calls = []; r = await reconcileHooks({ token: 't', repos: ['o/r'], secret: 's', fetch: HJ([{ ...hook, events: [...hook.events, 'workflow_run'] }]) }); assert.ok(calls.includes('PATCH'), 'extra events are drift'); assert.ok(!HOOK_EVENTS.includes('workflow_run'));
});
test('a token without hook rights is recorded plainly and the db gates reruns hourly', async () => {
  const db = makeDb(); let r = await reconcileHooks({ db, token: 't', repos: ['o/r'], secret: 's', fetch: HJ([], 403), now: () => 1e6 });
  assert.equal(r.status, 'no-rights'); assert.match(r.repos['o/r'], /polling path stays/);
  assert.equal((await reconcileHooks({ db, token: 't', repos: ['o/r'], secret: 's', fetch: HJ([], 403), now: () => 1e6 + 60e3 })).status, 'fresh');
});
import { githubHookSecrets, verifyAny } from '../src/hosts.js';
import { verifySignature } from '../src/events.js';
test('deliveries signed with the GitHub App webhook secret are accepted', async () => {
  const body = '{"a":1}', key = await crypto.subtle.importKey('raw', new TextEncoder().encode('app-sec'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = 'sha256=' + Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))), b => b.toString(16).padStart(2, '0')).join('');
  const secrets = await githubHookSecrets({ CREDENTIAL_KEY: 'k' }, async () => ({ secret: { webhook_secret: 'app-sec' } }));
  assert.equal(secrets.length, 2); assert.ok(await verifyAny(verifySignature, secrets, body, sig));
  assert.ok(!(await verifyAny(verifySignature, await githubHookSecrets({ CREDENTIAL_KEY: 'k' }), body, sig)));
});
test('HOSTS-SUBREQ-1: a probe refused by the invocation subrequest limit is unmeasured, never a host down', async () => {
  const db = makeDb(), starved = { id: 'a', kind: 'x', health: async () => { throw new Error('Too many subrequests by single Worker invocation.'); }, deploy: async () => ({ ok: true }) };
  const r = await watchHosts({ db, registry: createHosts([starved, host('b', true)], { db }), now: () => Date.now() });
  assert.equal(r.status, 'ok'); assert.deepEqual(r.unmeasured, ['a']); assert.equal(r.down, undefined);
});
