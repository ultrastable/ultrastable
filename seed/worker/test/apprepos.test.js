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
  assert.equal(w.calls.filter(c => c.m !== 'GET' && c.path.includes('/contents/')).length, 0, 'no file is written');
  assert.equal(w.calls.filter(c => c.m !== 'GET' && !c.path.startsWith('/repos/' + REPO) && !c.path.endsWith('/generate')).length, 0, 'nothing outside the app repository is touched');
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
test('DECLARED-LIVE-1: an existing tenant repository is set to its declared visibility; with none declared it is left alone', async () => {
  const w = await tenantWorld({ commits: 200, existing: true });
  const base = w.f, patches = [];
  w.f = async (url, init = {}) => {
    const u = new URL(url);
    if (/^\/repos\/ultrastable\/replication-ledger$/.test(u.pathname)) {
      if ((init.method || 'GET') === 'PATCH') { patches.push(JSON.parse(init.body)); return new Response(JSON.stringify({ private: false }), { status: 200 }); }
      return new Response(JSON.stringify({ private: true }), { status: 200 });
    }
    return base(url, init);
  };
  const r = await ensureTenantRepo(w.db, w.env, T, { repo: 'ultrastable/replication-ledger', visibility: 'public' }, { fetch: w.f });
  assert.equal(r.ok, true); assert.equal(r.visibility, 'set public'); assert.deepEqual(patches, [{ private: false }]);
  await ensureTenantRepo(w.db, w.env, T, { repo: 'ultrastable/replication-ledger' }, { fetch: w.f });
  assert.equal(patches.length, 1);
});

// REPO-STANDARD-1: one standard for every repository, applied by the administration app; a refused step is named and makes the answer not ok.
function ghFake(live, { refuse = {}, rulesets = [] } = {}) {
  const calls = [];
  const A = async (m, path, body) => {
    calls.push({ m, path, body });
    for (const [k, st] of Object.entries(refuse)) if (path.endsWith(k) && m !== 'GET') return { status: st, json: { message: 'Resource not accessible by integration' } };
    if (m === 'GET' && path.endsWith('/vulnerability-alerts')) return { status: 404, json: {} };
    if (m === 'PUT' && path.endsWith('/vulnerability-alerts')) return { status: 204, json: {} };
    if (m === 'GET' && path.endsWith('/rulesets')) return { status: 200, json: rulesets };
    if (m === 'POST' && path.endsWith('/rulesets')) return { status: 201, json: { id: 1 } };
    return { status: 200, json: {} };
  };
  return { A, calls, live };
}
test('the standard is one object: squash only, auto-merge, branches deleted on merge, main protected by a ruleset', async () => {
  const { REPO_STANDARD } = await import('../src/repostandard.js');
  const { REPO_SETTINGS } = await import('../src/apprepos.js');
  assert.deepEqual(REPO_SETTINGS, REPO_STANDARD.settings);
  assert.equal(REPO_STANDARD.settings.allow_squash_merge, true); assert.equal(REPO_STANDARD.settings.allow_merge_commit, false); assert.equal(REPO_STANDARD.settings.allow_rebase_merge, false);
  assert.equal(REPO_STANDARD.settings.allow_auto_merge, true); assert.equal(REPO_STANDARD.settings.delete_branch_on_merge, true);
  assert.deepEqual(REPO_STANDARD.ruleset.rules.map(r => r.type).sort(), ['deletion', 'non_fast_forward']);
});
test('a drifted public repository gets every part: settings, description, homepage, topics, alerts, secret scanning and the main ruleset', async () => {
  const { applyStandard, REPO_STANDARD } = await import('../src/repostandard.js');
  const w = ghFake({ private: false, allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, allow_auto_merge: false, allow_update_branch: false, delete_branch_on_merge: false, has_wiki: true, description: null, homepage: null, topics: [], security_and_analysis: { secret_scanning: { status: 'disabled' }, secret_scanning_push_protection: { status: 'disabled' } } });
  const r = await applyStandard(w.A, 'ultrastable/replication-ledger', w.live, { description: 'Replication Ledger', homepage: 'https://replication-ledger.ultrastable.org/', topics: ['ultrastable', 'Bad Topic!', 'built-on-ultrastable'] });
  assert.equal(r.ok, true); assert.deepEqual(r.refused, []);
  const patch = w.calls.find(c => c.m === 'PATCH' && !c.body.security_and_analysis).body;
  for (const [k, v] of Object.entries(REPO_STANDARD.settings)) assert.equal(patch[k], k === 'allow_squash_merge' ? undefined : v, k);
  assert.equal(patch.description, 'Replication Ledger'); assert.equal(patch.homepage, 'https://replication-ledger.ultrastable.org/'); assert.equal('private' in patch, false);
  assert.deepEqual(w.calls.find(c => c.path.endsWith('/topics')).body, { names: ['ultrastable', 'built-on-ultrastable'] });
  assert.ok(w.calls.some(c => c.m === 'PUT' && c.path.endsWith('/vulnerability-alerts')));
  assert.deepEqual(w.calls.find(c => c.m === 'PATCH' && c.body.security_and_analysis).body.security_and_analysis.secret_scanning, { status: 'enabled' });
  assert.equal(w.calls.find(c => c.m === 'POST' && c.path.endsWith('/rulesets')).body.name, 'main-no-rewrite');
  for (const k of ['description', 'homepage', 'topics', 'ruleset', 'delete_branch_on_merge', 'allow_auto_merge']) assert.ok(r.changed.includes(k), k);
});
test('a repository already at the standard is not written to; an archived one is left alone', async () => {
  const { applyStandard, REPO_STANDARD } = await import('../src/repostandard.js');
  const live = { private: false, ...REPO_STANDARD.settings, description: 'd', homepage: 'https://ultrastable.io', topics: ['ultrastable'], security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } } };
  const w = ghFake(live, { rulesets: [{ id: 7, name: 'main-no-rewrite', enforcement: 'active' }] });
  w.A = (inner => async (m, p, b) => (m === 'GET' && p.endsWith('/vulnerability-alerts') ? (w.calls.push({ m, path: p }), { status: 204, json: {} }) : inner(m, p, b)))(w.A);
  const r = await applyStandard(w.A, 'ultrastable/unlearn', live, { description: 'd', homepage: 'https://ultrastable.io', topics: ['ultrastable'] });
  assert.equal(r.ok, true); assert.deepEqual(r.changed, []); assert.equal(w.calls.filter(c => c.m !== 'GET').length, 0);
  const arch = ghFake({ archived: true });
  assert.deepEqual(await applyStandard(arch.A, 'ultrastable/workers', arch.live, {}), { repo: 'ultrastable/workers', changed: [], steps: [], refused: [], gated: [], ok: true, archived: true });
  assert.equal(arch.calls.length, 0);
});
test('a refused step is named and the answer is not ok; nothing is skipped quietly', async () => {
  const { applyStandard } = await import('../src/repostandard.js');
  const w = ghFake({ private: false, delete_branch_on_merge: false }, { refuse: { '/rulesets': 403, '/topics': 403 } });
  const r = await applyStandard(w.A, 'ultrastable/what-works', w.live, { topics: ['ultrastable'] });
  assert.equal(r.ok, false); assert.equal(r.refused.length, 2);
  assert.match(r.refused.join(' | '), /topics: HTTP 403 Resource not accessible.*ruleset main-no-rewrite: HTTP 403/);
  assert.ok(r.changed.includes('delete_branch_on_merge'), 'the steps that were allowed still happened');
});
test('a private repository: what the Free plan withholds is reported as gated, and only a named repository is made public', async () => {
  const { applyStandard } = await import('../src/repostandard.js');
  let w = ghFake({ private: true, allow_auto_merge: false, delete_branch_on_merge: false });
  let r = await applyStandard(w.A, 'ultrastable/ops', w.live, {});
  assert.equal(r.ok, true); assert.deepEqual([...new Set(r.gated)].sort(), ['allow_auto_merge', 'ruleset', 'security']);
  assert.equal('allow_auto_merge' in w.calls.find(c => c.m === 'PATCH').body, false); assert.equal('private' in w.calls.find(c => c.m === 'PATCH').body, false);
  assert.equal(w.calls.some(c => c.path.endsWith('/rulesets')), false);
  w = ghFake({ private: true, allow_auto_merge: false });
  r = await applyStandard(w.A, 'ultrastable/seed', w.live, { visibility: 'public' });
  assert.equal(w.calls.find(c => c.m === 'PATCH').body.private, false); assert.equal(w.calls.find(c => c.m === 'PATCH').body.allow_auto_merge, true);
  assert.ok(w.calls.some(c => c.m === 'POST' && c.path.endsWith('/rulesets')), 'once public, the ruleset goes on in the same pass');
});
test('the settings route applies the standard with the admin app, for org repositories only, behind the internal key', async () => {
  const { ensureRepoSettings } = await import('../src/apprepos.js');
  const w = await world();
  const writes = [];
  const f = async (url, init = {}) => {
    const u = new URL(url), tok = (init.headers.authorization || '').slice(7), m = init.method || 'GET';
    if (u.pathname.startsWith('/repos/ultrastable/ultrastable')) {
      if (m !== 'GET') writes.push({ tok, m, path: u.pathname, body: init.body ? JSON.parse(init.body) : null });
      if (m === 'GET' && u.pathname.endsWith('/rulesets')) return new Response('[]', { status: 200 });
      if (m === 'GET' && u.pathname.endsWith('/vulnerability-alerts')) return new Response(null, { status: 204 });
      if (m === 'GET') return new Response(JSON.stringify({ private: false, delete_branch_on_merge: false }), { status: 200 });
      return new Response('{}', { status: u.pathname.endsWith('/rulesets') ? 201 : 200 });
    }
    return w.f(url, init);
  };
  const r = await ensureRepoSettings(w.db, w.env, T, { repo: 'ultrastable/ultrastable', homepage: 'https://ultrastable.io' }, { fetch: f });
  assert.equal(r.ok, true); assert.ok(r.changed.includes('delete_branch_on_merge')); assert.ok(r.changed.includes('ruleset')); assert.ok(r.changed.includes('homepage'));
  assert.equal(r.protect, 'protected');
  assert.ok(writes.every(x => x.tok === 'admin-token'));
  const n = writes.length;
  const dry = await ensureRepoSettings(w.db, w.env, T, { repo: 'ultrastable/ultrastable', dry: true }, { fetch: f });  // APP-CRED-WATCH-1
  assert.equal(dry.ok, true); assert.ok(dry.drift.includes('delete_branch_on_merge')); assert.equal(writes.length, n, 'a dry read never writes');
  const arch = await ensureRepoSettings(w.db, w.env, T, { repo: 'ultrastable/workers' }, { fetch: async (url, init = {}) => new URL(url).pathname === '/repos/ultrastable/workers' ? new Response(JSON.stringify({ archived: true }), { status: 200 }) : f(url, init) });
  assert.equal(arch.ok, true); assert.match(arch.skipped, /archived/);  // ARCHIVED-READONLY-1: run 45696915881 failed on the archived workers repository
  for (const n of ['other/x', 'ultrastable/../x', '']) assert.equal((await ensureRepoSettings(w.db, w.env, T, { repo: n }, { fetch: f })).ok, false, n);
  const bad = await handleAppHost(new Request('https://t/host/repo-settings', { method: 'POST', headers: { 'x-internal-key': 'nope' }, body: '{"repo":"ultrastable/ultrastable"}' }), { ...w.env, DB: w.db }, { tenant: T, fetch: f });
  assert.equal(bad.status, 404);
  const none = await world({ admin: false });
  assert.equal((await ensureRepoSettings(none.db, none.env, T, { repo: 'ultrastable/ultrastable' }, { fetch: none.f })).waiting_on, 'admin-app');
});
test('a new tenant repository is created with the standard merge rules, and a new app repository is public (its workflows would be billed in private)', async () => {
  const { REPO_STANDARD } = await import('../src/repostandard.js');
  const w = await tenantWorld();
  const r = await ensureTenantRepo(w.db, w.env, T, { repo: 'ultrastable/replication-ledger', visibility: 'public', description: 'd' }, { fetch: w.f });
  for (const [k, v] of Object.entries(REPO_STANDARD.settings)) assert.equal(w.made[0].body[k], v, k);
  assert.equal(typeof r.standard.ok, 'boolean'); assert.ok(Array.isArray(r.standard.refused), 'what GitHub refused at creation is in the answer');
  const a = await world(); const seen = [];
  const f = async (url, init = {}) => { const u = new URL(url); if (/\/generate$|\/orgs\/[^/]+\/repos$/.test(u.pathname)) seen.push(JSON.parse(init.body)); return a.f(url, init); };
  assert.equal((await ensureAppRepo(a.db, a.env, T, spec(), { fetch: f })).ok, true);
  assert.equal(seen[0].private, false);
});
// DEPLOY-VISIBLE-1: where the code runs is on the repository itself, as a GitHub Deployment with the live URL.
test('a deploy is recorded as a production Deployment with its live URL on the repository and commit it came from; a missing grant is named', async () => {
  const { recordDeployment } = await import('../src/apprepos.js');
  const w = await world(); const posts = []; let grant = true;
  const f = async (url, init = {}) => {
    const u = new URL(url), m = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    if (/access_tokens$/.test(u.pathname)) return grant && body.permissions.deployments === 'write' ? new Response(JSON.stringify({ token: 'dep-token', expires_at: new Date(Date.now() + 3600e3).toISOString() }), { status: 201 }) : new Response(JSON.stringify({ message: 'The permissions requested are not granted to this installation.' }), { status: 422 });
    if (u.pathname === '/repos/ultrastable/unlearn/deployments' && m === 'GET') return new Response('[]', { status: 200 });
    if (u.pathname === '/repos/ultrastable/unlearn/deployments' && m === 'POST') { posts.push(body); return new Response(JSON.stringify({ id: 5 }), { status: 201 }); }
    if (u.pathname === '/repos/ultrastable/unlearn/deployments/5/statuses') { posts.push(body); return new Response('{}', { status: 201 }); }
    return w.f(url, init);
  };
  const sha = 'a'.repeat(40);
  const r = await recordDeployment(w.db, w.env, T, { repo: 'ultrastable/unlearn', sha, url: 'https://unlearn.ultrastable.org/' }, { fetch: f });
  assert.equal(r.ok, true); assert.equal(r.deployment, 5);
  assert.equal(posts[0].ref, sha); assert.equal(posts[0].environment, 'production'); assert.deepEqual(posts[0].required_contexts, []);
  assert.equal(posts[1].state, 'success'); assert.equal(posts[1].environment_url, 'https://unlearn.ultrastable.org/');
  for (const bad of [{ repo: 'other/x', sha, url: 'https://x.y' }, { repo: 'ultrastable/unlearn', sha: 'abc', url: 'https://x.y' }, { repo: 'ultrastable/unlearn', sha, url: 'http://x.y' }]) assert.equal((await recordDeployment(w.db, w.env, T, bad, { fetch: f })).ok, false);
  grant = false;
  const no = await recordDeployment(w.db, w.env, T, { repo: 'ultrastable/unlearn', sha, url: 'https://unlearn.ultrastable.org/' }, { fetch: f });
  assert.equal(no.ok, false); assert.equal(no.waiting_on, 'code-app-scope'); assert.match(no.error, /Deployments: write/);
});

test('the template route hands a token for the template repository only, behind the internal key', async () => {
  const { templateToken, TEMPLATE_REPO } = await import('../src/apprepos.js');
  const w = await tenantWorld();
  const r = await templateToken(w.db, w.env, T, { repo: TEMPLATE_REPO }, { fetch: w.f });
  assert.equal(r.ok, true); assert.equal(r.token, 'scoped:seed');
  for (const n of ['ultrastable/ultrastable', 'ultrastable/ops', 'ultrastable/unlearn', 'ultrastable/seed/', '']) assert.equal((await templateToken(w.db, w.env, T, { repo: n }, { fetch: w.f })).ok, false, n);
  const u = await tenantWorld({ covers: false });
  assert.equal((await templateToken(u.db, u.env, T, { repo: TEMPLATE_REPO }, { fetch: u.f })).waiting_on, 'code-app-scope');
  const bad = await handleAppHost(new Request('https://t/host/template-token', { method: 'POST', headers: { 'x-internal-key': 'nope' }, body: '{"repo":"ultrastable/seed"}' }), { ...w.env, DB: w.db }, { tenant: T, fetch: w.f });
  assert.equal(bad.status, 404);
  const ok = await handleAppHost(new Request('https://t/host/template-token', { method: 'POST', headers: { 'x-internal-key': w.env.INTERNAL_DEPLOY_KEY }, body: '{"repo":"ultrastable/seed"}' }), { ...w.env, DB: w.db }, { tenant: T, fetch: w.f });
  assert.equal(ok.status, 200); assert.equal((await ok.json()).token, 'scoped:seed');
});
