// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-31: the Worker, site and deploy halves of the fleet: the repository standard as the tick Worker applies it, the credential-free repository
// routes, the deploy watch, declared visibility and tenant pulses, discovery (manifest, heartbeat, directory), the health-only gate, the visitor launch
// record and the launch run, the deployment record and the uptime probe. Each test names the requirement it proves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { newKey } from '../src/auth/seal.js';
import * as store from '../src/auth/store.js';
import { REPO_STANDARD, applyStandard, metadataOf } from '../src/repostandard.js';
import { ensureTenantRepo, ensureRepoSettings, recordDeployment, handleAppHost, hostKey, APP_REPO, TENANT_REPO, CORE_REPO, KEEP_PRIVATE, ORG_REPO } from '../src/apprepos.js';
import { watchTenantDeploys } from '../src/tenantdeploy.js';
import { manifest, optedOut, publicUrl, heartbeat, discoverRoute } from '../src/discover.js';
import { reconcileVisibility, pulseTenants } from '../src/declared.js';
import { hiddenByHealthOnly, PUBLIC_READS, publicPage } from '../src/visibility.js';
import * as directory from '../../../site/directory.js';
import * as grad from '../../../site/graduate.js';
import * as launch from '../../../deploy/launch-apps.mjs';
import * as deployRecord from '../../../deploy/record-deployments.mjs';
import { checkHost } from '../../../uptime/probe.js';
import uptime from '../../../uptime/worker.js';

const J = (o, status = 200) => new Response(JSON.stringify(o), { status });
const toPem = (der, label) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----`;
async function pem() { const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']); return toPem(new Uint8Array(await crypto.subtle.exportKey('pkcs8', k.privateKey)), 'PRIVATE KEY'); }

// A fake GitHub holding one repository, the way the administration app and the code app see it.
function github(state = {}) {
  const calls = [];
  const s = { repo: null, commits: 409, deployments: [], ...state };
  const f = async (url, init = {}) => {
    const u = new URL(url), m = init.method || 'GET', tok = (init.headers.authorization || '').slice(7), body = init.body ? JSON.parse(init.body) : null, p = u.pathname;
    calls.push({ m, p, tok, body });
    let x;
    if ((x = /^\/app\/installations\/11\/access_tokens$/.exec(p))) return J({ token: 'scoped:' + body.repositories.join(','), expires_at: new Date(Date.now() + 3600e3).toISOString() }, 201);
    if (/\/vulnerability-alerts$/.test(p)) return m === 'GET' ? J({}, 404) : new Response(null, { status: 204 });
    if (/\/rulesets$/.test(p)) return m === 'GET' ? J([]) : J({}, 201);
    if (/\/topics$/.test(p)) return J({});
    if ((x = /^\/orgs\/([^/]+)\/repos$/.exec(p))) { s.repo = { ...body, archived: false, security_and_analysis: {}, topics: [] }; return J({}, 201); }
    if ((x = /^\/repos\/[^/]+\/[^/]+\/commits$/.exec(p))) return s.commits === 409 ? J({ message: 'Git Repository is empty.' }, 409) : J(s.commits);
    if (/\/deployments$/.test(p)) { if (m === 'GET') return J(s.deployments); s.deployments.push({ id: 7 }); return J({ id: 7 }, 201); }
    if (/\/deployments\/7\/statuses$/.test(p)) return J({}, 201);
    if (/^\/repos\/[^/]+\/[^/]+$/.test(p)) { if (m === 'PATCH') { Object.assign(s.repo, body); return J(s.repo); } return s.repo ? J(s.repo) : J({}, 404); }
    return J({ message: 'unexpected ' + m + ' ' + p }, 500);
  };
  return { f, calls, s };
}
async function world(gh) {
  const env = { CREDENTIAL_KEY: newKey(), INTERNAL_DEPLOY_KEY: 'k'.repeat(40) }, db = makeDb();
  env.DB = db;
  await store.ensureSchema(db);
  const far = Date.now() + 3600e3;
  await store.put(db, env, 'ultrastable', 'github-app', { secret: { pem: await pem() }, meta: { app_id: 1, installation_id: 11 }, access: 'code-token', expiresAt: far });
  await store.put(db, env, 'ultrastable', 'github-admin', { secret: { pem: await pem() }, meta: { app_id: 2, installation_id: 22 }, access: 'admin-token', expiresAt: far });
  return { env, db, ...gh };
}
const publicLive = (o = {}) => ({ ...REPO_STANDARD.settings, private: false, archived: false, topics: [], security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } }, ...o });
function adminApi(rulesets = [], alerts = 404, refuse = {}) {
  const calls = [];
  const A = async (m, p, body) => {
    calls.push([m, p, body]);
    if (refuse[m + ' ' + p]) return { status: refuse[m + ' ' + p], json: { message: 'refused' } };
    if (m === 'GET' && p.endsWith('/vulnerability-alerts')) return { status: alerts, json: {} };
    if (m === 'GET' && p.endsWith('/rulesets')) return { status: 200, json: rulesets };
    return { status: p.endsWith('/vulnerability-alerts') ? 204 : m === 'POST' ? 201 : 200, json: {} };
  };
  return { A, calls };
}

// ---- 4.4 the repository standard ------------------------------------------------------------------------------------------------------------

test('US-31-R26: the standard the Worker applies is squash-only with auto-merge and branch deletion, and main refuses deletion and rewrites', () => {
  const s = REPO_STANDARD.settings;
  assert.deepEqual([s.allow_squash_merge, s.allow_merge_commit, s.allow_rebase_merge, s.allow_auto_merge, s.delete_branch_on_merge, s.has_wiki], [true, false, false, true, true, false]);
  assert.deepEqual(REPO_STANDARD.ruleset.rules.map(r => r.type).sort(), ['deletion', 'non_fast_forward']);
  assert.deepEqual(REPO_STANDARD.ruleset.bypass_actors, []);
  assert.equal(REPO_STANDARD.ruleset.enforcement, 'active');
  assert.deepEqual(REPO_STANDARD.security, { vulnerability_alerts: true, secret_scanning: 'enabled', secret_scanning_push_protection: 'enabled' });
  assert.deepEqual([...REPO_STANDARD.private_plan_gated].sort(), ['allow_auto_merge', 'ruleset', 'security']);
});

test('US-31-R27: applyStandard changes only what drifted, leaves a repository on the standard untouched and names a refused step', async () => {
  const a = adminApi();
  const r = await applyStandard(a.A, 'ultrastable/x', publicLive({ allow_merge_commit: true }), {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed.sort(), ['allow_merge_commit', 'ruleset', 'vulnerability_alerts']);
  assert.deepEqual(a.calls.find(c => c[0] === 'PATCH'), ['PATCH', '/repos/ultrastable/x', { allow_merge_commit: false }]);
  assert.equal(a.calls.find(c => c[0] === 'POST')[2].name, 'main-no-rewrite');
  const clean = adminApi([{ name: 'main-no-rewrite', enforcement: 'active' }], 204);
  const c = await applyStandard(clean.A, 'ultrastable/x', publicLive(), {});
  assert.deepEqual([c.ok, c.changed], [true, []]);
  assert.ok(clean.calls.every(x => x[0] === 'GET'), 'a repository on the standard is only read');
  const refused = adminApi([], 404, { 'PATCH /repos/ultrastable/x': 403 });
  const bad = await applyStandard(refused.A, 'ultrastable/x', publicLive({ allow_merge_commit: true }), {});
  assert.equal(bad.ok, false);
  assert.match(bad.refused[0], /^settings allow_merge_commit: HTTP 403/);
});

test('US-31-R27: a private repository is told what its plan withholds and an archived one is left alone', async () => {
  const a = adminApi();
  const r = await applyStandard(a.A, 'ultrastable/ops', publicLive({ private: true }), {});
  assert.equal(r.ok, true);
  assert.deepEqual([...r.gated].sort(), ['allow_auto_merge', 'ruleset', 'security']);
  assert.ok(!a.calls.some(c => /rulesets|vulnerability/.test(c[1])), 'no gated call is made on a private repository');
  const z = adminApi();
  const arch = await applyStandard(z.A, 'ultrastable/old', publicLive({ archived: true }), {});
  assert.deepEqual([arch.ok, arch.archived, z.calls.length], [true, true, 0]);
});

test('US-31-R28: a caller may ask only for a description, an https homepage, well-formed topics and, for a named repository, public', () => {
  const m = metadataOf({ description: 'x'.repeat(400) + '\u0001', homepage: 'http://insecure.example', topics: ['Good', 'bad topic', 'a'.repeat(60), 'good'], visibility: 'public' });
  assert.equal(m.fields.description.length, 300);
  assert.ok(!/[\u0000-\u001f]/.test(m.fields.description));
  assert.equal(m.fields.homepage, undefined);
  assert.deepEqual(m.topics, ['good']);
  assert.equal(m.makePublic, true);
  assert.equal(metadataOf({ homepage: 'https://ultrastable.io/x', topics: [] }).topics, null);
  assert.equal(metadataOf({ homepage: 'https://ultrastable.io/x' }).fields.homepage, 'https://ultrastable.io/x');
  assert.equal(metadataOf({ visibility: 'private' }).makePublic, false);
});

test('US-31-R29: only a tenant or app repository name is created, and a tenant repository is born on the standard with a push token only while it is empty', async () => {
  assert.ok(TENANT_REPO.test('ultrastable/what-works') && !TENANT_REPO.test('ultrastable/app-x'));
  assert.ok(CORE_REPO.test('ultrastable/seed') && !CORE_REPO.test('ultrastable/what-works'));
  assert.ok(APP_REPO.test('ultrastable/app-living-atlas-ab12') && !APP_REPO.test('ultrastable/what-works'));
  const none = await ensureTenantRepo(null, {}, 'ultrastable', { repo: 'ultrastable/seed' });
  assert.deepEqual([none.ok, none.error], [false, 'not a tenant repository name']);
  const gh = github(), w = await world(gh);
  const r = await ensureTenantRepo(w.db, w.env, 'ultrastable', { repo: 'ultrastable/new-tenant', visibility: 'public', description: 'A new tenant system running on Ultrastable.' }, { fetch: w.f });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  const born = gh.calls.find(c => c.m === 'POST' && c.p === '/orgs/ultrastable/repos').body;
  assert.deepEqual([born.allow_squash_merge, born.allow_merge_commit, born.allow_rebase_merge, born.delete_branch_on_merge, born.private], [true, false, false, true, false]);
  assert.equal(r.standard.ok, true);
  assert.ok(r.standard.changed.includes('ruleset'), 'the main ruleset goes on in the pass that creates the repository');
  assert.deepEqual([r.empty, r.token], [true, 'scoped:new-tenant']);
  gh.s.commits = [{ sha: 'a'.repeat(40) }];
  const again = await ensureTenantRepo(w.db, w.env, 'ultrastable', { repo: 'ultrastable/new-tenant', visibility: 'public' }, { fetch: w.f });
  assert.deepEqual([again.ok, again.empty, again.token], [true, false, undefined]);
});

test('US-31-R30: repository settings reach only organization repositories, name what they skip, and never make an ops repository public', async () => {
  assert.ok(ORG_REPO.test('ultrastable/seed') && !ORG_REPO.test('someone-else/seed'));
  assert.deepEqual(KEEP_PRIVATE, ['ultrastable/ops']);
  const w0 = await world(github());
  assert.equal((await ensureRepoSettings(w0.db, w0.env, 'ultrastable', { repo: 'other/x' }, { fetch: w0.f })).error, 'not a repository of the org');
  assert.match((await ensureRepoSettings(w0.db, w0.env, 'ultrastable', { repo: 'ultrastable/missing' }, { fetch: w0.f })).skipped, /not created yet/);
  const arch = await world(github({ repo: publicLive({ archived: true }) }));
  assert.equal((await ensureRepoSettings(arch.db, arch.env, 'ultrastable', { repo: 'ultrastable/old' }, { fetch: arch.f })).skipped, 'archived (read-only)');
  const ops = github({ repo: publicLive({ private: true }) }), wo = await world(ops);
  const r = await ensureRepoSettings(wo.db, wo.env, 'ultrastable', { repo: 'ultrastable/ops', public: true }, { fetch: wo.f });
  assert.equal(r.ok, true);
  assert.ok(!ops.calls.some(c => c.m === 'PATCH' && c.body && c.body.private === false), 'a repository kept private is never flipped');
  const seed = github({ repo: publicLive({ private: true }) }), ws = await world(seed);
  await ensureRepoSettings(ws.db, ws.env, 'ultrastable', { repo: 'ultrastable/seed', public: true }, { fetch: ws.f });
  assert.ok(seed.calls.some(c => c.m === 'PATCH' && c.body && c.body.private === false), 'a declared-public repository is made public');
  const dry = github({ repo: publicLive({ allow_merge_commit: true }) }), wd = await world(dry);
  const d = await ensureRepoSettings(wd.db, wd.env, 'ultrastable', { repo: 'ultrastable/x', dry: true }, { fetch: wd.f });
  assert.deepEqual([d.ok, d.dry, d.drift], [true, true, ['allow_merge_commit']]);
  assert.ok(dry.calls.every(c => c.m === 'GET' || c.p.includes('access_tokens')), 'a dry reading writes nothing');
});

test('US-31-R35: a deployment is recorded once per commit with its live URL, and a missing grant is named', async () => {
  const sha = 'c'.repeat(40);
  const bad = await recordDeployment(null, {}, 'ultrastable', { repo: 'ultrastable/x', sha: 'abc', url: 'https://x.example' });
  assert.equal(bad.error, 'sha must be a full commit id');
  assert.equal((await recordDeployment(null, {}, 'ultrastable', { repo: 'ultrastable/x', sha, url: 'http://x.example' })).error, 'url must be https');
  const gh = github(), w = await world(gh);
  const r = await recordDeployment(w.db, w.env, 'ultrastable', { repo: 'ultrastable/x', sha, url: 'https://x.example/', state: 'weird' }, { fetch: w.f });
  assert.deepEqual([r.ok, r.deployment, r.created], [true, 7, true]);
  const status = gh.calls.find(c => /statuses$/.test(c.p)).body;
  assert.deepEqual([status.state, status.environment_url, status.environment], ['success', 'https://x.example/', 'production']);
  const again = await recordDeployment(w.db, w.env, 'ultrastable', { repo: 'ultrastable/x', sha, url: 'https://x.example/' }, { fetch: w.f });
  assert.deepEqual([again.ok, again.deployment, again.created], [true, 7, undefined]);
  const noApp = await recordDeployment(makeDb(), { CREDENTIAL_KEY: newKey() }, 'ultrastable', { repo: 'ultrastable/x', sha, url: 'https://x.example/' }, { fetch: w.f });
  assert.equal(noApp.ok, false);
  assert.equal(noApp.waiting_on, 'code-app-scope');
});

test('US-31-R35: the run plans one deployment per repository, a tenant built from its own repository is recorded there at its own commit', () => {
  const topology = { workers: [{ id: 'w-core', routes: ['ultrastable.io/*'] }, { id: 'w-t', routes: ['t.ultrastable.org/*'], source: { repo: 'ultrastable/t' } }, { id: 'w-t2', routes: ['t2.ultrastable.org/*'], source: { repo: 'ultrastable/t' } }] };
  const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
  const plan = deployRecord.plan([{ ok: true, worker: 'w-core' }, { ok: true, worker: 'w-t', source_repo: 'ultrastable/t', source_sha: a }, { ok: true, worker: 'w-t2', source_repo: 'ultrastable/t', source_sha: b }, { ok: false, worker: 'w-x' }],
    { topology, tenantRepos: { tenants: {} }, coreRepo: 'ultrastable/ultrastable', coreSha: c });
  assert.deepEqual(plan.map(d => [d.repo, d.sha, d.url]), [['ultrastable/ultrastable', c, 'https://ultrastable.io/'], ['ultrastable/t', a, 'https://t.ultrastable.org/']]);
});

test('US-31-R36: every host route answers 404 without the internal key, and a scoped token needs the key the host derived for that one repository', async () => {
  const env = { INTERNAL_DEPLOY_KEY: 'k'.repeat(40), DB: makeDb(), CREDENTIAL_KEY: newKey() };
  const post = (path, body, headers = {}) => handleAppHost(new Request('https://tick.internal' + path, { method: 'POST', headers, body: JSON.stringify(body) }), env);
  assert.equal(await handleAppHost(new Request('https://tick.internal/other', { method: 'POST', body: '{}' }), env), null);
  for (const path of ['/host/app-repo', '/host/tenant-repo', '/host/repo-settings', '/host/template-token', '/host/repo-deployment']) {
    assert.equal((await post(path, {})).status, 404, path + ' without the key');
    assert.equal((await post(path, {}, { 'x-internal-key': 'wrong'.repeat(8) })).status, 404, path + ' with a wrong key');
  }
  assert.equal((await handleAppHost(new Request('https://tick.internal/host/app-repo'), env)).status, 404, 'a GET is never served');
  assert.equal((await handleAppHost(new Request('https://tick.internal/host/app-repo', { method: 'POST', body: '{}' }), { ...env, INTERNAL_DEPLOY_KEY: '' })).status, 404);
  const key = { 'x-internal-key': env.INTERNAL_DEPLOY_KEY };
  const t = await post('/host/template-token', { repo: 'ultrastable/ultrastable' }, key);
  assert.deepEqual([t.status, (await t.json()).error], [400, 'not the template repository']);
  const repo = 'ultrastable/app-living-atlas-ab12';
  assert.equal((await post('/host/app-token', { repo, key: 'f'.repeat(64) })).status, 404);
  assert.equal((await post('/host/app-token', { repo: 'ultrastable/seed', key: await hostKey(env.INTERNAL_DEPLOY_KEY, 'ultrastable/seed') })).status, 404, 'a core repository gets no token');
  const ok = await post('/host/app-token', { repo, key: await hostKey(env.INTERNAL_DEPLOY_KEY, repo) });
  assert.equal(ok.status, 503, 'the key is right and the code app is not connected: the answer says so and gives no token');
  assert.equal((await ok.json()).token, undefined);
});

// ---- 4.1 and 4.4 server-side loops ---------------------------------------------------------------------------------------------------------

function deployWorld({ commitAt, runs, registry }) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push([init.method || 'GET', url]);
    if (url.includes('/contents/')) return J({ content: btoa(JSON.stringify(registry)) });
    if (url.includes('/actions/workflows/') && url.endsWith('/dispatches')) return new Response(null, { status: 204 });
    if (url.includes('/actions/workflows/')) return J({ workflow_runs: runs });
    if (url.includes('/commits/main')) return J({ commit: { committer: { date: commitAt } } });
    return J({}, 500);
  };
  return { f, calls };
}
const REG = { tenants: { a: { state: 'moved', worker: 'w-a', repo: 'ultrastable/a' }, b: { state: 'planned', repo: 'ultrastable/b' } } };
const OK_RUN = { status: 'completed', conclusion: 'success', created_at: '2026-11-26T00:00:00Z' };

test('US-31-R11: a moved tenant whose main is newer than the last good deploy is deployed within the hour, once per cooldown, and never while a deploy runs', async () => {
  const at = h => () => Date.parse(`2026-11-26T${h}:00Z`);
  const run = (o, now) => watchTenantDeploys({ token: 't', repo: 'ultrastable/ultrastable', fetchImpl: o.f, now });
  assert.deepEqual(await watchTenantDeploys({ repo: 'x/y' }), { status: 'no-token' });
  const behind = deployWorld({ commitAt: '2026-11-26T01:00:00Z', runs: [OK_RUN], registry: REG });
  const r = await run(behind, at('05:00'));
  assert.deepEqual([r.status, r.behind, r.repair], ['behind', ['w-a'], 'dispatched']);
  const dispatch = behind.calls.find(c => c[0] === 'POST');
  assert.match(dispatch[1], /deploy-ultrastable\.yml\/dispatches$/);
  const cool = await run(deployWorld({ commitAt: '2026-11-26T01:00:00Z', runs: [OK_RUN], registry: REG }), at('00:30'));
  assert.deepEqual([cool.status, cool.repair], ['behind', 'cooldown']);
  assert.equal((await run(deployWorld({ commitAt: '2026-11-25T23:00:00Z', runs: [OK_RUN], registry: REG }), at('05:00'))).status, 'current');
  assert.equal((await run(deployWorld({ commitAt: '2026-11-26T01:00:00Z', runs: [{ status: 'in_progress', created_at: '2026-11-26T04:00:00Z' }, OK_RUN], registry: REG }), at('05:00'))).status, 'deploy-running');
  assert.equal((await run(deployWorld({ commitAt: '2026-11-26T01:00:00Z', runs: [OK_RUN], registry: { tenants: { b: { state: 'planned' } } } }), at('05:00'))).status, 'none');
  const broken = await watchTenantDeploys({ token: 't', repo: 'x/y', fetchImpl: async () => J({}, 500) });
  assert.match(broken.status, /^error /);
});

test('US-31-R37: a declared visibility is set back on drift, a repository that cannot be read is unmeasured, and a tenant back end gets a second route to run', async () => {
  assert.equal((await reconcileVisibility({ repos: [] })).status, 'no-token');
  const repos = { 'ultrastable/a': { private: true }, 'ultrastable/b': { private: false }, 'ultrastable/c': { private: true, archived: true } }, patched = [];
  const f = async (url, init = {}) => {
    const name = new URL(url).pathname.replace('/repos/', '');
    if (init.method === 'PATCH') { patched.push([name, JSON.parse(init.body)]); repos[name].private = JSON.parse(init.body).private; return J(repos[name]); }
    return repos[name] ? J(repos[name]) : J({}, 404);
  };
  const declared = [{ repo: 'ultrastable/a', private: false }, { repo: 'ultrastable/b', private: false }, { repo: 'ultrastable/c', private: false }, { repo: 'ultrastable/gone', private: false }, { repo: 'not a name', private: false }];
  const dry = await reconcileVisibility({ token: 't', repos: declared, apply: false, fetchImpl: f });
  assert.equal(dry.status, 'drift');
  assert.deepEqual([dry.drift.length, patched.length, dry.checked], [1, 0, 3]);
  assert.equal(dry.unmeasured.length, 2, 'a missing repository and a malformed name are unmeasured, never in order');
  const done = await reconcileVisibility({ token: 't', repos: declared, fetchImpl: f });
  assert.deepEqual([done.status, done.fixed, patched], ['ok', ['ultrastable/a'], [['ultrastable/a', { private: false }]]]);
  const answers = { 'https://a.example/pulse': J({ ok: true }), 'https://b.example/pulse': J({ skipped: true }), 'https://c.example/pulse': J({ error: 'boom' }, 500) };
  const p = await pulseTenants({ targets: [{ id: 'a', url: 'https://a.example/pulse' }, { id: 'b', url: 'https://b.example/pulse' }, { id: 'c', url: 'https://c.example/pulse' }, { id: 'd', url: 'http://d.example/pulse' }], fetchImpl: async u => answers[u] });
  assert.deepEqual([p.status, p.ran, p.fresh], ['failed', ['a'], ['b']]);
  assert.equal(p.failed.length, 2);
  assert.match(p.failed.join(' '), /no https pulse URL/);
});

// ---- 4.6 discovery ------------------------------------------------------------------------------------------------------------------------

test('US-31-R44: the manifest names the system, its https address and repository, carries nothing private, and an opt-out is stated in it', () => {
  const m = manifest({ PUBLIC_URL: 'https://example.org/x' }, { identity: { repo: 'acme/app', name: 'Acme' }, org_name: 'Other', API_TOKEN: 'secret' });
  assert.equal(m.ultrastable, 1);
  assert.deepEqual([m.name, m.url, m.repo, m.discoverable], ['Acme', 'https://example.org', 'https://github.com/acme/app', true]);
  assert.ok(!JSON.stringify(m).includes('secret'));
  assert.equal(manifest({ PUBLIC_URL: 'https://example.org' }, { discoverable: false }).discoverable, false);
  assert.equal(optedOut({ ULTRASTABLE_DIRECTORY: 'OFF' }, {}), true);
  assert.equal(publicUrl({ PUBLIC_URL: 'http://insecure.example' }, 'https://seed.example.workers.dev/x'), 'https://seed.example.workers.dev');
  assert.equal(publicUrl({}, 'http://seed.example/x'), null);
  assert.equal(discoverRoute(new URL('https://seed.example/other'), {}, {}), null);
});

test('US-31-R45: a newborn system registers hourly until the directory has listed it, then once a day, and keeps every answer', async () => {
  const db = makeDb(), env = { PUBLIC_URL: 'https://example.org', DB: db }, sent = [];
  let answer = { status: 422, why: 'no manifest' };
  const fetchFn = async (u, o) => { sent.push(JSON.parse(o.body).url); return { status: answer.status, json: async () => ({ why: answer.why }) }; };
  const at = iso => new Date(iso);
  const first = await heartbeat(env, {}, { fetchFn, now: at('2026-11-26T12:00:00Z'), db });
  assert.deepEqual([first.sent, first.listed, first.birth, first.why], [true, false, true, 'no manifest']);
  assert.equal((await heartbeat(env, {}, { fetchFn, now: at('2026-11-26T12:30:00Z'), db })).sent, false, 'a refusal is retried an hour later, not at once');
  answer = { status: 202 };
  const retry = await heartbeat(env, {}, { fetchFn, now: at('2026-11-26T13:05:00Z'), db });
  assert.deepEqual([retry.sent, retry.listed], [true, true]);
  assert.equal((await heartbeat(env, {}, { fetchFn, now: at('2026-11-26T14:30:00Z'), db })).sent, false, 'once listed, only the daily window sends');
  assert.equal((await heartbeat(env, {}, { fetchFn, now: at('2026-11-27T03:05:00Z'), db })).sent, true);
  assert.deepEqual(await db.prepare('SELECT status, listed FROM directory_registration WHERE id = 1').first(), { status: 202, listed: 1 });
  assert.equal(sent.length, 3);
  assert.equal((await heartbeat({ ...env, ULTRASTABLE_DIRECTORY: 'off' }, {}, { fetchFn, now: at('2026-11-27T03:05:00Z'), db })).why, 'opted out');
  assert.equal((await heartbeat({}, {}, { fetchFn, now: at('2026-11-27T03:05:00Z'), db })).why, 'no public URL');
});

function directoryDb() {
  const rows = new Map();
  const prep = sql => ({ bind: (...a) => ({
    first: async () => (sql.startsWith('SELECT checked') ? rows.get(a[0]) || null : null),
    all: async () => ({ results: [...rows.values()].filter(r => r.checked < a[0]).slice(0, a[1]) }),
    run: async () => {
      if (sql.startsWith('INSERT')) rows.set(a[0], { origin: a[0], name: a[1], repo: a[2], license: a[3], added: a[4], checked: a[4], fails: 0 });
      else if (sql.startsWith('DELETE')) rows.delete(a[0]);
      else if (sql.includes('fails = fails + 1')) { const r = rows.get(a[0]); r.fails++; r.checked = a[1]; }
      else if (sql.startsWith('UPDATE')) Object.assign(rows.get(a[0]), { name: a[1], checked: a[4], fails: 0 });
    } }) });
  return { rows, prepare: prep, batch: async () => [] };
}
const siteOf = (man, page = '<html>hi</html>', hdr = {}) => async u => u.endsWith('/.well-known/ultrastable.json')
  ? { status: man ? 200 : 404, json: async () => man }
  : { ok: true, status: 200, headers: new Map(Object.entries(hdr)), text: async () => page };
const GOOD = { ultrastable: 1, name: 'Acme', url: 'https://acme.example.org', repo: 'https://github.com/acme/app', discoverable: true };

test('US-31-R46: the directory lists a system only after reading its own manifest and page, rechecks it, and drops it on an opt-out or three failed days', async () => {
  const origin = 'https://acme.example.org';
  assert.equal(directory.originOf('https://acme.example.org:8443/x'), null);
  assert.equal(directory.originOf('http://acme.example.org'), null);
  assert.equal(directory.originOf('https://10.0.0.1'), null);
  assert.equal(directory.originOf('https://acme.example.org/x?y=1'), origin);
  assert.equal((await directory.inspect(origin, siteOf(null))).why, 'no manifest (404)');
  assert.equal((await directory.inspect(origin, siteOf({ ...GOOD, ultrastable: 2 }))).why, 'not an Ultrastable manifest');
  assert.equal((await directory.inspect(origin, siteOf({ ...GOOD, discoverable: false }))).optout, true);
  assert.equal((await directory.inspect(origin, siteOf({ ...GOOD, url: 'https://other.example.org' }))).why, 'manifest names a different URL');
  assert.equal((await directory.inspect(origin, siteOf(GOOD, '<html></html>', { 'x-robots-tag': 'noindex' }))).why, 'noindex');
  assert.deepEqual((await directory.inspect(origin, siteOf(GOOD))).entry, { origin, name: 'Acme', repo: 'https://github.com/acme/app', license: null });
  const env = { DB: directoryDb() };
  const req = url => new Request('https://ultrastable.io/api/directory/register', { method: 'POST', body: JSON.stringify({ url }) });
  const listed = await directory.register(req(origin), env, siteOf(GOOD));
  assert.deepEqual([listed.status, (await listed.json()).listed], [202, true]);
  const fresh = await directory.register(req(origin), env, siteOf(null));
  assert.equal((await fresh.json()).fresh, true, 'a site read in the last six hours is not read again');
  const refused = await directory.register(req('https://nomanifest.example.org'), env, siteOf(null));
  assert.deepEqual([refused.status, (await refused.json()).error], [422, 'not_listed']);
  assert.equal((await directory.register(req('http://bad.example.org'), env, siteOf(GOOD))).status, 400);
  assert.equal((await (await directory.register(req('https://ultrastable.io'), env, siteOf(null))).json()).listed, 'core');
  env.DB.rows.get(origin).checked = '2020-01-01T00:00:00.000Z';
  env.DB.rows.get(origin).fails = 2;
  const swept = await directory.recheck(env, siteOf(null), new Date('2026-11-26T12:00:00Z'));
  assert.deepEqual([swept.checked, swept.dropped, env.DB.rows.has(origin)], [1, 1, false]);
  const listing = await directory.listing({});
  assert.deepEqual([listing.core === directory.CORE, listing.external], [true, []]);
});

test('US-31-R48: a health-only system still answers the reads every system must have from birth and hides everything else', () => {
  const health = { PUBLIC_HEALTH_ONLY: '1' };
  for (const p of ['/', '/health', '/.well-known/ultrastable.json', '/claims.json', '/social-queue.json', '/api/graph', '/api/progress', '/api/stickiness', '/api/stickiness/queue/what-works.json'])
    assert.equal(hiddenByHealthOnly(health, 'GET', p), false, p);
  for (const p of ['/api/billing', '/dashboard', '/api/items']) assert.equal(hiddenByHealthOnly(health, 'GET', p), true, p);
  assert.equal(hiddenByHealthOnly(health, 'POST', '/hook/github'), false);
  assert.equal(hiddenByHealthOnly(health, 'POST', '/pulse/watch'), false);
  assert.equal(hiddenByHealthOnly(health, 'GET', '/pulse/watch'), true);
  assert.equal(hiddenByHealthOnly({}, 'GET', '/api/billing'), false, 'the gate is off unless asked for');
  assert.ok(Object.isFrozen(PUBLIC_READS) && PUBLIC_READS.includes('/.well-known/ultrastable.json') && PUBLIC_READS.includes('/api/graph'));
  const done = publicPage({ name: 'my-system', last: { steps_total: 19, steps_completed: 19, finished_at: '2026-11-26T01:00:00Z' }, ignition: { stage: 'looping' }, footer: '<footer>Built on Ultrastable</footer>' });
  assert.equal(done.headers.get('content-type'), 'text/html; charset=utf-8');
  return done.text().then(async t => {
    assert.match(t, /<h1>my system<\/h1>/);
    assert.match(t, /Last pass finished 2026-11-26T01:00:00Z/);
    assert.match(t, /looping/);
    assert.match(t, /Built on Ultrastable/);
    const fresh = await publicPage({ name: '<b>x</b>' }).text();
    assert.match(fresh, /No pass has run yet\./);
    assert.match(fresh, /&lt;b&gt;x&lt;\/b&gt;/);
  });
});

// ---- 4.8 the visitor launch path -----------------------------------------------------------------------------------------------------------

function assets() {
  const m = new Map();
  return { m, get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
}

test('US-31-R55: an idea becomes one launch record with its own repository name, and what anyone may see of it carries no idea text and no key', async () => {
  const env = { ASSETS: assets() }, now = new Date('2026-11-26T00:00:00Z');
  const rec = await grad.enqueue(env, 'ab12cd34ef', 'A living atlas of what works in public policy', now);
  assert.equal(rec.slug, 'app-living-atlas-works-ab12cd34ef');
  assert.ok(rec.slug.length <= 60);
  assert.equal(rec.repo, 'ultrastable/' + rec.slug);
  assert.deepEqual([rec.state, /^[0-9a-f]{32}$/.test(rec.key), rec.synthetic], ['queued', true, false]);
  assert.equal((await grad.enqueue(env, 'ab12cd34ef', 'a second try', now)).key, rec.key, 'a second call keeps the first record');
  assert.equal((await grad.enqueue(env, 'p1', grad.SYNTHETIC + ' probe', now)).synthetic, true);
  const view = grad.publicView(rec);
  assert.ok(!('brief' in view) && !('key' in view) && !JSON.stringify(view).includes('atlas'));
  assert.equal(view.repo, null, 'no repository is named until it exists');
  assert.equal(grad.publicView({ ...rec, state: 'repo' }).repo, rec.repo);
  assert.match(grad.plainWaiting('all 20 places for hosted apps are taken'), /you do not need to do anything/);
  assert.match(grad.plainWaiting('the repository step is waiting (gate visitor-app-repos)'), /project home/);
  assert.ok(!/gate|HTTP|token/i.test(grad.plainWaiting('HTTP 403 token refused')), 'backend words never reach the visitor');
  const steered = await grad.steer(env, 'ab12cd34ef', 'make it blue', now);
  assert.deepEqual([steered.steer.length, steered.steer[0].filed], [1, false]);
});

test('US-31-R56: ownership goes only to the browser that made the app, a failed build is queued again from the kept idea, and nobody types the idea twice', async () => {
  const env = { ASSETS: assets() }, rec = await grad.enqueue(env, 'zz9', 'A tracker whose sources keep changing', new Date());
  const ask = (cookie, login) => { const fd = new FormData(); fd.set('github', login); return new Request('https://ultrastable.io/s/zz9/own', { method: 'POST', headers: cookie ? { cookie } : {}, body: fd }); };
  const mine = grad.cookieName('zz9') + '=' + rec.key;
  assert.equal((await grad.requestOwnership(ask(null, 'ada-l'), env, 'zz9')).status, 403);
  assert.equal((await grad.requestOwnership(ask(mine, '-not valid'), env, 'zz9')).status, 400);
  assert.equal((await grad.requestOwnership(ask(mine, '@ada-l'), env, 'zz9')).ok, true);
  assert.equal((await grad.getLaunch(env, 'zz9')).want_owner.login, 'ada-l');
  assert.equal((await grad.requestOwnership(ask(mine, 'ada-l'), env, 'nope')).status, 404);
  env.ASSETS.m.set('state:zz9', 'failed'); env.ASSETS.m.set('since:zz9', '0'); env.ASSETS.m.set('brief:zz9', JSON.stringify({ brief: 'A tracker whose sources keep changing' }));
  assert.equal(await grad.requeueBuild(env, 'zz9', 600000, Date.now()), true);
  assert.deepEqual([env.ASSETS.m.get('state:zz9'), JSON.parse(env.ASSETS.m.get('job:zz9')).brief], ['building', 'A tracker whose sources keep changing']);
  assert.equal(await grad.requeueBuild(env, 'zz9', 600000, Date.now()), false, 'a build that is running is not queued again');
});

const CFG = { max_apps: 2, max_deploys_per_run: 2, usd_per_month: 5, template: 'ultrastable/seed', full_stack_hours: 48 };
const mkLaunch = (o = {}) => ({ id: 'a1', slug: 'app-x-a1', repo: 'ultrastable/app-x-a1', brief: 'A tracker of what works', built: true, system: null, state: 'queued', synthetic: false, at: new Date().toISOString(), steer: [], ...o });

test('US-31-R57: one pass gives each built idea its own system and repository, files what the visitor asked for and never gives a test idea a repository', async () => {
  const calls = [], deployed = [];
  const site = async b => { calls.push(b); if (b.op === 'list') return { launches: [mkLaunch({ steer: [{ n: 1, text: 'make it blue', filed: false, at: 'x' }], want_owner: { login: 'ada-l', done: false } }), mkLaunch({ id: 's1', synthetic: true, brief: grad.SYNTHETIC })] }; if (b.op === 'repo') return b.check ? { ok: true } : { ok: true, created: true, from_template: true, steps: [], page: 'same' }; return { ok: true }; };
  const deploySeed = async (l, dry) => { deployed.push([l[0].slug, dry, l[0].host_repo]); return [{ live_ok: true, url: 'https://ultrastable-seed-' + l[0].slug + '.x.workers.dev', modules: 4 }]; };
  const out = await launch.run({ site, deploySeed, cfg: CFG, base: {}, log: () => {} });
  assert.deepEqual(deployed, [['app-a1', false, 'ultrastable/app-x-a1'], ['app-s1', true, 'ultrastable/app-x-a1']], 'the test idea is only built, never deployed');
  const repoCall = calls.find(c => c.op === 'repo' && c.id === 'a1');
  assert.deepEqual([repoCall.template, repoCall.invite], ['ultrastable/seed', 'ada-l']);
  assert.deepEqual(repoCall.files.map(f => f.path), ['IDEA.md', 'docs/issues/STEER-1.json']);
  assert.match(repoCall.files[0].content, /hosted_by: ultrastable/);
  assert.match(repoCall.files[0].content, /owner_contact: set-in-secret-store/);
  assert.ok(calls.some(c => c.op === 'repo' && c.check) && !calls.some(c => c.op === 'repo' && c.id === 's1'));
  const mark = calls.find(c => c.op === 'mark' && c.id === 'a1');
  assert.deepEqual([mark.state, mark.filed, mark.owner_done, /^https:\/\/ultrastable-seed-/.test(mark.system)], ['handed-over', [1], true, true]);
  assert.ok(out.every(r => r.visitor_steps === 0));
});

test('US-31-R57: a full house waits with a reason, and an app still missing a part of its stack after the declared hours is overdue', async () => {
  const site = async b => (b.op === 'list' ? { launches: [mkLaunch({ id: 'x1', system: null }), mkLaunch({ id: 'r1', system: 'https://ultrastable-seed-r1.x.workers.dev' }), mkLaunch({ id: 'r2', system: 'https://ultrastable-seed-r2.x.workers.dev' })] } : b.op === 'repo' ? { ok: true, page: 'same' } : { ok: true });
  const calls = [];
  const out = await launch.run({ site: async b => { calls.push(b); return site(b); }, deploySeed: async () => { throw new Error('never called'); }, cfg: CFG, base: {}, log: () => {} });
  assert.match(calls.find(c => c.op === 'mark' && c.id === 'x1').waiting_on, /all 2 places for hosted apps are taken/);
  assert.equal(out.find(r => r.id === 'x1').steps[0], 'system: no place free');
  const old = new Date(Date.now() - 72 * 3600e3).toISOString();
  assert.deepEqual(launch.stackOf({ built: true, system: null, state: 'queued', at: old }, CFG), { stack: { frontend: true, backend: false, repo: false }, missing: ['backend', 'repo'], overdue: true });
  assert.equal(launch.stackOf({ built: true, system: 'https://x', state: 'repo', at: old }, CFG).overdue, false);
  assert.equal(launch.stackOf({ built: false, state: 'queued', at: new Date().toISOString() }, CFG).overdue, false);
  assert.equal(launch.stackOf({ built: false, state: 'queued', at: old, synthetic: true }, CFG).overdue, false);
});

// ---- the uptime probe ------------------------------------------------------------------------------------------------------------------------

function dns({ status = 0, ns = ['grace.ns.cloudflare.com.'], page = 200 } = {}) {
  return async (url) => {
    if (/dns-query|dns\.google/.test(url)) return J(/type=NS/.test(url) ? { Status: status, Answer: status ? [] : ns.map(data => ({ data })) } : { Status: status, Answer: status ? [] : [{ data: '2606::1' }] });
    return new Response('ok', { status: page });
  };
}

test('US-31-R60: a site is ok only when both resolvers answer, the page answers 200 and the name servers are the expected ones, and a dead one asks the repair path to act', async () => {
  const expectNs = ['grace.ns.cloudflare.com'];
  assert.equal((await checkHost('ultrastable.io', { fetchImpl: dns(), expectNs })).verdict, 'ok');
  assert.equal((await checkHost('ultrastable.io', { fetchImpl: dns({ page: 500 }), expectNs })).verdict, 'http');
  assert.equal((await checkHost('ultrastable.io', { fetchImpl: dns({ status: 3 }), expectNs })).verdict, 'dns');
  assert.equal((await checkHost('ultrastable.io', { fetchImpl: dns({ ns: ['other.ns.example.'] }), expectNs })).verdict, 'ns');
  const calls = [], kv = new Map();
  const env = { TICK: { fetch: async (u, o) => { calls.push([u, o.method]); return new Response('queued', { status: 202 }); } }, STATE: { put: async (k, v) => { kv.set(k, v); }, get: async k => kv.get(k) } };
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = dns({ page: 503 });
    await new Promise(res => uptime.scheduled({}, env, { waitUntil: p => p.then(res) }));
    const last = JSON.parse(kv.get('last'));
    assert.equal(last.ok, false);
    assert.ok(last.dead.includes('ultrastable.io'));
    assert.deepEqual(calls[0], ['https://tick/api/uptime/repair', 'POST']);
    assert.equal(last.repair.http, 202);
    calls.length = 0; kv.clear();
    globalThis.fetch = dns();
    await new Promise(res => uptime.scheduled({}, env, { waitUntil: p => p.then(res) }));
    assert.deepEqual([JSON.parse(kv.get('last')).ok, calls.length], [true, 0], 'a healthy pass asks for no repair');
  } finally { globalThis.fetch = realFetch; }
});
