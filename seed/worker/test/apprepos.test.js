// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// APP-REPO-1: the host creates, fills and hands over app repositories with the two App credentials it already holds, and gives a hosted app a token for its one repository only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { newKey } from '../src/auth/seal.js';
import * as store from '../src/auth/store.js';
import { getToken } from '../src/auth/index.js';
import { ensureAppRepo, handleAppHost, hostKey, APP_REPO } from '../src/apprepos.js';

const toPem = (der, label) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----`;
async function pem() { const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']); return toPem(new Uint8Array(await crypto.subtle.exportKey('pkcs8', k.privateKey)), 'PRIVATE KEY'); }
const REPO = 'ultrastable/app-living-atlas-works-ab12cd34ef', T = 'ultrastable';
async function world({ admin = true, template = 201, covers = true } = {}) {
  const env = { CREDENTIAL_KEY: newKey(), INTERNAL_DEPLOY_KEY: 'k'.repeat(40) }, db = makeDb();
  await store.ensureSchema(db);
  const far = Date.now() + 3600e3;
  await store.put(db, env, T, 'github-app', { secret: { pem: await pem() }, meta: { app_id: 1, installation_id: 11 }, access: 'code-token', expiresAt: far });
  if (admin) await store.put(db, env, T, 'github-admin', { secret: { pem: await pem() }, meta: { app_id: 2, installation_id: 22 }, access: 'admin-token', expiresAt: far });
  const repos = new Map(), calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(url), tok = (init.headers.authorization || '').slice(7), body = init.body ? JSON.parse(init.body) : null, m = init.method || 'GET';
    calls.push({ m, path: u.pathname, tok, body });
    const R = (status, json) => new Response(JSON.stringify(json || {}), { status });
    let x;
    if ((x = /^\/app\/installations\/11\/access_tokens$/.exec(u.pathname))) return R(201, { token: 'scoped:' + body.repositories.join(','), expires_at: new Date(far).toISOString() });
    if ((x = /^\/repos\/([^/]+\/[^/]+)\/generate$/.exec(u.pathname))) { if (tok !== 'admin-token' || template !== 201) return R(template === 201 ? 403 : template, { message: 'no' }); repos.set(body.owner + '/' + body.name, new Map([['README.md', 'seed']])); return R(201, {}); }
    if ((x = /^\/orgs\/([^/]+)\/repos$/.exec(u.pathname))) { if (tok !== 'admin-token') return R(403, { message: 'Resource not accessible by integration' }); repos.set(x[1] + '/' + body.name, new Map([['README.md', '']])); return R(201, {}); }
    if ((x = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(u.pathname))) {
      const r = repos.get(x[1]); if (!r || tok !== 'code-token' || !covers) return R(404, { message: 'Not Found' });
      if (m === 'GET') return r.has(x[2]) ? R(200, { sha: 's', content: Buffer.from(r.get(x[2])).toString('base64') }) : R(404);
      r.set(x[2], Buffer.from(body.content, 'base64').toString()); return R(201);
    }
    if ((x = /^\/repos\/([^/]+\/[^/]+)\/collaborators\/(.+)$/.exec(u.pathname))) return tok === 'admin-token' ? R(201) : R(403);
    if ((x = /^\/repos\/([^/]+\/[^/]+)$/.exec(u.pathname))) return repos.has(x[1]) ? R(200, {}) : R(404);
    return R(500, { message: 'unexpected ' + u.pathname });
  };
  return { env, db, f, repos, calls };
}
const spec = (o = {}) => ({ repo: REPO, template: 'ultrastable/seed', description: 'atlas', files: [{ path: 'IDEA.md', content: 'A living atlas — graded', message: 'idea' }], ...o });

test('the host creates the repository from the seed, writes the idea and invites the owner, with the credentials it already holds', async () => {
  const w = await world();
  const r = await ensureAppRepo(w.db, w.env, T, spec({ invite: 'ada-l', read: ['IDEA.md'] }), { fetch: w.f });
  assert.equal(r.ok, true); assert.equal(r.created, true); assert.equal(r.from_template, true); assert.equal(r.invited, 'ada-l');
  assert.equal(w.repos.get(REPO).get('IDEA.md'), 'A living atlas — graded'); assert.equal(r.read['IDEA.md'], 'A living atlas — graded');
  const again = await ensureAppRepo(w.db, w.env, T, spec(), { fetch: w.f });
  assert.equal(again.created, undefined); assert.deepEqual(again.files, [{ path: 'IDEA.md', unchanged: true }], 'a second pass writes nothing');
});
test('when the template cannot be copied the repository is still created, and the answer says which happened', async () => {
  const w = await world({ template: 403 });
  const r = await ensureAppRepo(w.db, w.env, T, spec(), { fetch: w.f });
  assert.equal(r.ok, true); assert.equal(r.from_template, false); assert.match(r.steps.join(' '), /template ultrastable\/seed: HTTP 403.*created empty: HTTP 201/);
});
test('each missing piece is named, never hidden: no admin app, or a code app that does not cover new repositories', async () => {
  let w = await world({ admin: false });
  let r = await ensureAppRepo(w.db, w.env, T, spec(), { fetch: w.f }); assert.equal(r.ok, false); assert.equal(r.waiting_on, 'admin-app');
  w = await world({ covers: false });
  r = await ensureAppRepo(w.db, w.env, T, spec(), { fetch: w.f }); assert.equal(r.ok, false); assert.equal(r.waiting_on, 'code-app-scope'); assert.equal(r.created, true);
});
test('only app repositories, only safe paths', async () => {
  const w = await world();
  assert.equal((await ensureAppRepo(w.db, w.env, T, spec({ repo: 'ultrastable/ultrastable' }), { fetch: w.f })).ok, false);
  assert.equal((await ensureAppRepo(w.db, w.env, T, spec({ files: [{ path: '.github/workflows/x.yml', content: 'x' }] }), { fetch: w.f })).ok, false);
  assert.equal(w.calls.filter(c => c.m !== 'GET' && !c.path.endsWith('/generate')).length, 0);
  assert.ok(!APP_REPO.test('ultrastable/seed') && APP_REPO.test(REPO));
});
test('routes: the repository route needs the internal key; a hosted app gets a token for its own repository and no other', async () => {
  const w = await world(), post = (path, body, h = {}) => handleAppHost(new Request('https://tick.internal' + path, { method: 'POST', headers: h, body: JSON.stringify(body) }), { ...w.env, DB: w.db }, { tenant: T, fetch: w.f });
  assert.equal((await post('/host/app-repo', spec())).status, 404);
  assert.equal((await (await post('/host/app-repo', spec(), { 'x-internal-key': w.env.INTERNAL_DEPLOY_KEY })).json()).ok, true);
  const key = await hostKey(w.env.INTERNAL_DEPLOY_KEY, REPO);
  const t = await (await post('/host/app-token', { repo: REPO, key })).json();
  assert.equal(t.token, 'scoped:app-living-atlas-works-ab12cd34ef');
  const mint = w.calls.find(c => c.path.endsWith('/access_tokens')); assert.deepEqual(mint.body.permissions, { contents: 'write', pull_requests: 'write', metadata: 'read' });
  assert.equal((await post('/host/app-token', { repo: 'ultrastable/app-someone-else-0000000000', key })).status, 404, 'a key opens one repository');
  assert.equal((await post('/host/app-token', { repo: 'ultrastable/ultrastable', key: await hostKey(w.env.INTERNAL_DEPLOY_KEY, 'ultrastable/ultrastable') })).status, 404, 'never a platform repository');
  assert.equal(await handleAppHost(new Request('https://tick.internal/health'), w.env), null);
});
test('a hosted app asks its host for its token and holds no App key of its own', async () => {
  const w = await world(), key = await hostKey(w.env.INTERNAL_DEPLOY_KEY, REPO), appDb = makeDb();
  const hostFetch = async (url, init) => handleAppHost(new Request(url, init), { ...w.env, DB: w.db }, { tenant: T, fetch: w.f });
  const appEnv = { HOST_TOKEN_URL: 'https://tick.internal/host/app-token', HOST_APP_KEY: key, HOST_REPO: REPO };
  const t = await getToken(appDb, appEnv, 'app', 'github-app', { fetch: hostFetch });
  assert.equal(t.ok, true); assert.equal(t.token, 'scoped:app-living-atlas-works-ab12cd34ef'); assert.equal(t.host, true);
  assert.equal((await getToken(appDb, appEnv, 'app', 'github-app', { fetch: async () => { throw new Error('must not be called'); } })).memo, true, 'the token is reused until it nears expiry');
  const bad = await getToken(makeDb(), { ...appEnv, HOST_APP_KEY: 'x' }, 'app', 'github-app', { fetch: hostFetch });
  assert.equal(bad.ok, false); assert.match(bad.error, /host token HTTP 404/);
});

// TENANT-REPO-2: a registered tenant's repository is created by the administration app; a push token is handed back only while it is empty.
import { ensureTenantRepo, TENANT_REPO } from '../src/apprepos.js';
function tenantWorld({ commits = 409, covers = true, existing = false, workflows = true } = {}) {
  return world().then(w => {
    const base = w.f, made = [];
    if (existing) w.repos.set('ultrastable/replication-ledger', new Map());
    w.f = async (url, init = {}) => {
      const u = new URL(url), body = init.body ? JSON.parse(init.body) : null, tok = ((init.headers || {}).authorization || '').slice(7);
      if (/\/commits$/.test(u.pathname)) return new Response(JSON.stringify(commits === 200 ? [{ sha: 'abc' }] : { message: 'Git Repository is empty.' }), { status: commits });
      if (/^\/app\/installations\/11\/access_tokens$/.test(u.pathname)) {
        if (!covers) return new Response(JSON.stringify({ message: 'There is at least one repository that does not exist or is not accessible to the parent installation.' }), { status: 422 });
        if (body.permissions.workflows && !workflows) return new Response(JSON.stringify({ message: 'The permissions requested are not granted to this installation.' }), { status: 422 });
      }
      if (/^\/orgs\/[^/]+\/repos$/.test(u.pathname)) made.push({ tok, body });
      return base(url, init);
    };
    return { ...w, made };
  });
}
test('a missing tenant repository is created public by the administration app and gets a push token while empty', async () => {
  const w = await tenantWorld();
  const r = await ensureTenantRepo(w.db, w.env, T, { repo: 'ultrastable/replication-ledger', visibility: 'public', description: 'd' }, { fetch: w.f });
  assert.equal(r.ok, true); assert.equal(r.created, true); assert.equal(r.empty, true);
  assert.equal(r.token, 'scoped:replication-ledger');
  assert.equal(w.made[0].tok, 'admin-token'); assert.equal(w.made[0].body.private, false);
  assert.ok(w.calls.some(c => c.body && c.body.permissions && c.body.permissions.workflows === 'write'));
});
test('a tenant repository with history gets no token', async () => {
  const w = await tenantWorld({ commits: 200, existing: true });
  const r = await ensureTenantRepo(w.db, w.env, T, { repo: 'ultrastable/replication-ledger' }, { fetch: w.f });
  assert.equal(r.ok, true); assert.equal(r.empty, false); assert.equal(r.token, undefined); assert.equal(r.created, undefined);
});
test('without the workflows grant the token falls back to contents only; an uncovered repository says so', async () => {
  const w = await tenantWorld({ workflows: false });
  assert.equal((await ensureTenantRepo(w.db, w.env, T, { repo: 'ultrastable/replication-ledger' }, { fetch: w.f })).token, 'scoped:replication-ledger');
  const u = await tenantWorld({ covers: false });
  const r = await ensureTenantRepo(u.db, u.env, T, { repo: 'ultrastable/replication-ledger' }, { fetch: u.f });
  assert.equal(r.ok, false); assert.equal(r.waiting_on, 'code-app-scope');
});
test('core and app repositories are never tenant repositories', async () => {
  for (const n of ['ultrastable/ultrastable', 'ultrastable/ops', 'ultrastable/.github', 'ultrastable/app-x1', 'other/what-works', 'ultrastable/a']) {
    const w = await tenantWorld();
    const r = await ensureTenantRepo(w.db, w.env, T, { repo: n }, { fetch: w.f });
    assert.equal(r.ok, false, n); assert.equal(w.made.length, 0, n);
  }
  assert.ok(TENANT_REPO.test('ultrastable/what-works'));
});
test('the tenant route needs the internal key', async () => {
  const w = await tenantWorld();
  const bad = await handleAppHost(new Request('https://t/host/tenant-repo', { method: 'POST', headers: { 'x-internal-key': 'nope' }, body: '{"repo":"ultrastable/replication-ledger"}' }), { ...w.env, DB: w.db }, { tenant: T, fetch: w.f });
  assert.equal(bad.status, 404);
  const ok = await handleAppHost(new Request('https://t/host/tenant-repo', { method: 'POST', headers: { 'x-internal-key': w.env.INTERNAL_DEPLOY_KEY }, body: '{"repo":"ultrastable/replication-ledger"}' }), { ...w.env, DB: w.db }, { tenant: T, fetch: w.f });
  assert.equal(ok.status, 200); assert.equal((await ok.json()).empty, true);
});

// REPO-SETTINGS-1: branch cleanup reached delete_branch_on_merge only through an ORG_ADMIN_TOKEN nobody had; the admin app sets the two settings.
test('the admin app turns on exactly the two drifted settings, for org repositories only, behind the internal key', async () => {
  const { ensureRepoSettings, REPO_SETTINGS } = await import('../src/apprepos.js');
  const w = await world();
  const patched = [];
  const f = async (url, init = {}) => {
    const u = new URL(url), tok = (init.headers.authorization || '').slice(7);
    if (u.pathname === '/repos/ultrastable/ultrastable' && (init.method || 'GET') === 'GET') return new Response(JSON.stringify({ delete_branch_on_merge: false, allow_auto_merge: true }), { status: 200 });
    if (u.pathname === '/repos/ultrastable/ultrastable' && init.method === 'PATCH') { patched.push({ tok, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }
    return w.f(url, init);
  };
  const r = await ensureRepoSettings(w.db, w.env, T, { repo: 'ultrastable/ultrastable' }, { fetch: f });
  assert.equal(r.ok, true); assert.deepEqual(r.changed, ['delete_branch_on_merge']);
  assert.deepEqual(patched, [{ tok: 'admin-token', body: { delete_branch_on_merge: true } }]);
  assert.deepEqual(Object.keys(REPO_SETTINGS).sort(), ['allow_auto_merge', 'delete_branch_on_merge']);
  for (const n of ['other/x', 'ultrastable/../x', '']) assert.equal((await ensureRepoSettings(w.db, w.env, T, { repo: n }, { fetch: f })).ok, false, n);
  const bad = await handleAppHost(new Request('https://t/host/repo-settings', { method: 'POST', headers: { 'x-internal-key': 'nope' }, body: '{"repo":"ultrastable/ultrastable"}' }), { ...w.env, DB: w.db }, { tenant: T, fetch: f });
  assert.equal(bad.status, 404);
  const none = await world({ admin: false });
  assert.equal((await ensureRepoSettings(none.db, none.env, T, { repo: 'ultrastable/ultrastable' }, { fetch: none.f })).waiting_on, 'admin-app');
});
