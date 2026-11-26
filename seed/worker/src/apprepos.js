// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// LAUNCH-PATH-1 / APP-REPO-1: the host's hands on GitHub for apps started by people with no code agent.
// This Worker already holds two App credentials in its sealed store: the administration-only app ('github-admin', REPOS-1) and the code app
// ('github-app'). Together they can create a repository in the org and write to it, so no token is asked of anyone and none leaves this Worker
// except a one-hour token scoped to a single app repository, handed only to that app's own Worker.
//   POST /host/app-repo   (x-internal-key)  create the repository if missing, write files, invite its owner
//   POST /host/tenant-repo (x-internal-key)  a registered tenant's repository, and a push token while it is empty (TENANT-REPO-2)
//   POST /host/app-token  ({repo, key})     a one-hour token for that one repository; key is this host's HMAC over the repository name
//   POST /host/repo-settings (x-internal-key) REPO-STANDARD-1: the whole repository standard (merge rules, security, main ruleset, description, homepage, topics) on one org repository
//   POST /host/repo-deployment (x-internal-key) DEPLOY-VISIBLE-1: a GitHub Deployment with its live URL on the repository the code came from
import { getToken } from './auth/index.js';
import { appJwt } from './auth/github-app.js';
import * as store from './auth/store.js';
import { REPO_STANDARD, applyStandard } from './repostandard.js';
const API = 'https://api.github.com', UA = 'ultrastable-app-repos';
export const APP_REPO = /^[a-z0-9][a-z0-9-]{0,38}\/app-[a-z0-9-]{1,60}$/;  // the only repositories these routes will ever touch
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const enc = s => new TextEncoder().encode(s);
const b64 = s => { const b = enc(s); let o = ''; for (let i = 0; i < b.length; i += 0x8000) o += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(o); };
function same(a, b) { a = String(a || ''); b = String(b || ''); if (!a || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }
export async function hostKey(secret, repo) {
  const k = await crypto.subtle.importKey('raw', enc(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc('app-token:' + repo)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
const gh = (f, token) => async (method, path, body) => {
  const r = await f(API + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': UA, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
// Create (when missing), fill and hand over one app repository. Every step says what GitHub answered; nothing is retried here, the caller's next pass is the retry.
export async function ensureAppRepo(db, env, tenant, spec, { fetch: f = fetch, now = Date.now() } = {}) {
  const repo = String(spec.repo || ''), out = { repo, steps: [] };
  if (!APP_REPO.test(repo)) return { ...out, ok: false, error: 'not an app repository name' };
  const [org, name] = repo.split('/');
  const adm = await getToken(db, env, tenant, 'github-admin', { fetch: f, now }), code = await getToken(db, env, tenant, 'github-app', { fetch: f, now });
  if (!adm.ok) return { ...out, ok: false, waiting_on: 'admin-app', error: 'administration app: ' + adm.error };
  if (!code.ok) return { ...out, ok: false, waiting_on: 'code-app', error: 'code app: ' + code.error };
  if (spec.dry) return { ...out, ok: true, dry: true };  // both credentials are live; nothing is touched
  const A = gh(f, adm.token), C = gh(f, code.token);
  let seen = await A('GET', `/repos/${repo}`);
  // REPO-STANDARD-1: the seed template carries workflows, and a private repository with workflows is billed, so an app repository is public unless asked otherwise
  const priv = spec.visibility === 'private';
  if (seen.status === 404) {
    let made = null;
    if (spec.template) {  // a full copy of the seed when the template is reachable; GitHub's answer is recorded either way
      made = await A('POST', `/repos/${spec.template}/generate`, { owner: org, name, private: priv, description: String(spec.description || '').slice(0, 300) });
      out.steps.push(`from template ${spec.template}: HTTP ${made.status}`);
    }
    if (!made || made.status !== 201) {
      made = await A('POST', `/orgs/${org}/repos`, { name, private: priv, description: String(spec.description || '').slice(0, 300), auto_init: true, ...REPO_STANDARD.settings });
      out.steps.push(`created empty: HTTP ${made.status}`);
      if (made.status !== 201) { await store.event(db, tenant, 'github-admin', 'failed', `app repo ${repo} HTTP ${made.status} ${made.json.message || ''}`); return { ...out, ok: false, waiting_on: 'admin-app-scope', error: `create ${repo}: HTTP ${made.status} ${made.json.message || ''}`.slice(0, 200) }; }
      out.from_template = false;
    } else out.from_template = true;
    await store.event(db, tenant, 'github-admin', 'app-repo', `${repo} created${out.from_template ? ' from ' + spec.template : ''}`);
    out.created = true; seen = made;
    // the standard goes on in the same pass that creates the repository; a refused step is named in the answer and retried by the daily standard run
    const live = await A('GET', `/repos/${repo}`);
    const std = await applyStandard(A, repo, live.status === 200 ? live.json : { private: priv }, { description: spec.description, homepage: spec.homepage, topics: spec.topics });
    out.standard = { ok: std.ok, changed: std.changed, refused: std.refused, gated: std.gated };
    if (!std.ok) await store.event(db, tenant, 'github-admin', 'failed', `repo standard ${repo}: ${std.refused.join('; ')}`.slice(0, 300));
  } else if (seen.status !== 200) return { ...out, ok: false, waiting_on: 'admin-app-scope', error: `read ${repo}: HTTP ${seen.status}` };
  out.files = [];
  for (const file of (spec.files || []).slice(0, 20)) {
    if (!/^[A-Za-z0-9._\/-]{1,200}$/.test(file.path) || file.path.includes('..') || file.path.startsWith('.github/')) return { ...out, ok: false, error: 'path not allowed: ' + file.path };
    const cur = await C('GET', `/repos/${repo}/contents/${file.path}`);
    if (cur.status === 200 && cur.json.content && atob(cur.json.content.replace(/\n/g, '')) === atob(b64(file.content))) { out.files.push({ path: file.path, unchanged: true }); continue; }
    if (cur.status !== 200 && cur.status !== 404) { await store.event(db, tenant, 'github-app', 'failed', `app repo ${repo} read ${file.path} HTTP ${cur.status}`); return { ...out, ok: false, waiting_on: 'code-app-scope', error: `the code app cannot reach ${repo} (HTTP ${cur.status}); its installation does not cover new repositories` }; }
    const w = await C('PUT', `/repos/${repo}/contents/${file.path}`, { message: String(file.message || 'Update ' + file.path).slice(0, 120), content: b64(file.content), ...(cur.status === 200 ? { sha: cur.json.sha } : {}) });
    if (w.status !== 200 && w.status !== 201) return { ...out, ok: false, waiting_on: w.status === 404 || w.status === 403 ? 'code-app-scope' : null, error: `write ${file.path}: HTTP ${w.status} ${w.json.message || ''}`.slice(0, 200) };
    out.files.push({ path: file.path, written: true });
  }
  out.read = {};
  for (const p of (spec.read || []).slice(0, 5)) { const r = await C('GET', `/repos/${repo}/contents/${p}`); if (r.status === 200 && r.json.content) out.read[p] = new TextDecoder().decode(Uint8Array.from(atob(r.json.content.replace(/\n/g, '')), c => c.charCodeAt(0))); }
  if (spec.invite) {
    if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(spec.invite)) return { ...out, ok: false, error: 'not a GitHub name' };
    const i = await A('PUT', `/repos/${repo}/collaborators/${spec.invite}`, { permission: 'admin' });
    if (i.status !== 201 && i.status !== 204) return { ...out, ok: false, error: `invite: HTTP ${i.status} ${i.json.message || ''}`.slice(0, 200) };
    out.invited = spec.invite; await store.event(db, tenant, 'github-admin', 'app-repo', `${repo} owner invited`);
  }
  return { ...out, ok: true };
}
// A one-hour token for one repository, with only what an executor needs there.
export async function scopedToken(db, env, tenant, repo, { fetch: f = fetch, now = Date.now(), extra = {} } = {}) {
  const m = await store.material(db, env, tenant, 'github-app');
  if (!m || !m.secret || !m.meta || !m.meta.app_id || !m.meta.installation_id) return { ok: false, error: 'the code app is not connected' };
  const r = await f(`${API}/app/installations/${m.meta.installation_id}/access_tokens`, { method: 'POST', headers: { authorization: 'Bearer ' + await appJwt(m.meta.app_id, m.secret.pem, now), accept: 'application/vnd.github+json', 'user-agent': UA, 'content-type': 'application/json' }, body: JSON.stringify({ repositories: [repo.split('/')[1]], permissions: { contents: 'write', pull_requests: 'write', metadata: 'read', ...extra } }) });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 201) return { ok: false, error: `scoped token HTTP ${r.status} ${j.message || ''}`.slice(0, 200) };
  return { ok: true, token: j.token, expiresAt: Date.parse(j.expires_at) };
}
// TENANT-REPO-2: a registered tenant's own repository (TENANT-REPO-1), created with the administration app when missing. The code app's one-hour
// token for that repository is handed back only while the repository holds no commit, so the caller (tenant-repos.yml, through the site's OIDC
// route) can push the tenant folder's history once; a repository with history gets no token from here.
export const TENANT_REPO = /^ultrastable\/(?!app-)[a-z0-9][a-z0-9-]{1,60}$/;
export const CORE_REPO = /^ultrastable\/(ultrastable|workers|spec|seed|license|ops|\.github)$/;
export async function ensureTenantRepo(db, env, tenant, spec, { fetch: f = fetch, now = Date.now() } = {}) {
  const repo = String(spec.repo || ''), out = { repo };
  if (!TENANT_REPO.test(repo) || CORE_REPO.test(repo)) return { ...out, ok: false, error: 'not a tenant repository name' };
  const [org, name] = repo.split('/');
  const adm = await getToken(db, env, tenant, 'github-admin', { fetch: f, now });
  if (!adm.ok) return { ...out, ok: false, waiting_on: 'admin-app', error: 'administration app: ' + adm.error };
  const A = gh(f, adm.token);
  let seen = await A('GET', `/repos/${repo}`);
  if (seen.status === 404) {
    const made = await A('POST', `/orgs/${org}/repos`, { name, private: spec.visibility === 'private', description: String(spec.description || '').slice(0, 300), ...REPO_STANDARD.settings });
    if (made.status !== 201) { await store.event(db, tenant, 'github-admin', 'failed', `tenant repo ${repo} HTTP ${made.status} ${made.json.message || ''}`); return { ...out, ok: false, waiting_on: 'admin-app-scope', error: `create ${repo}: HTTP ${made.status} ${made.json.message || ''}`.slice(0, 200) }; }
    await store.event(db, tenant, 'github-admin', 'tenant-repo', `${repo} created`);
    out.created = true;
    // REPO-STANDARD-1: security, the main ruleset, homepage and topics in the same pass that creates it
    const live = await A('GET', `/repos/${repo}`);
    const std = await applyStandard(A, repo, live.status === 200 ? live.json : { private: spec.visibility === 'private' }, { description: spec.description, homepage: spec.homepage, topics: spec.topics });
    out.standard = { ok: std.ok, changed: std.changed, refused: std.refused, gated: std.gated };
    if (!std.ok) await store.event(db, tenant, 'github-admin', 'failed', `repo standard ${repo}: ${std.refused.join('; ')}`.slice(0, 300));
  } else if (seen.status !== 200) return { ...out, ok: false, waiting_on: 'admin-app-scope', error: `read ${repo}: HTTP ${seen.status}` };
  else if ((spec.visibility === 'public' || spec.visibility === 'private') && Boolean(seen.json.private) !== (spec.visibility === 'private')) {  // DECLARED-LIVE-1: an existing repository is set to its declared visibility (replication-ledger was made private and its CI could not read it)
    const p = await A('PATCH', `/repos/${repo}`, { private: spec.visibility === 'private' });
    out.visibility = p.status === 200 ? 'set ' + (spec.visibility === 'private' ? 'private' : 'public') : `refused HTTP ${p.status}`;
    await store.event(db, tenant, 'github-admin', p.status === 200 ? 'tenant-repo' : 'failed', `${repo} visibility ${out.visibility}`);
  }
  // the tenant's history carries its own workflows, which only a token with workflows: write may push; without that grant the push of the rest still goes
  let t = await scopedToken(db, env, tenant, repo, { fetch: f, now, extra: { workflows: 'write' } });
  if (!t.ok) t = await scopedToken(db, env, tenant, repo, { fetch: f, now });
  if (!t.ok) return { ...out, ok: false, waiting_on: 'code-app-scope', error: t.error };
  const c = await gh(f, t.token)('GET', `/repos/${repo}/commits?per_page=1`);
  if (c.status === 200 && Array.isArray(c.json) && c.json.length) return { ...out, ok: true, empty: false };
  if (c.status !== 409 && !(c.status === 200 && Array.isArray(c.json))) return { ...out, ok: false, waiting_on: 'code-app-scope', error: `read commits of ${repo}: HTTP ${c.status}` };
  await store.event(db, tenant, 'github-app', 'tenant-repo-token', repo);
  return { ...out, ok: true, empty: true, token: t.token, expires_at: new Date(t.expiresAt).toISOString() };
}
// TEMPLATE-PUBLISH-1 (FLEET-MAP-1, 2026-11-25): the template repository is a copy of the platform's seed/ folder and nothing in the platform's
// Actions could write it (no stored credential; the tenant route above refuses it by name), so it drifted for days. This hands the platform's
// template-publish workflow, through the site's OIDC route, a one-hour token for that one repository and no other.
export const TEMPLATE_REPO = 'ultrastable/seed';
export async function templateToken(db, env, tenant, spec, { fetch: f = fetch, now = Date.now() } = {}) {
  const repo = String(spec.repo || ''), out = { repo };
  if (repo !== TEMPLATE_REPO) return { ...out, ok: false, error: 'not the template repository' };
  let t = await scopedToken(db, env, tenant, repo, { fetch: f, now, extra: { workflows: 'write', pull_requests: 'write' } });
  if (!t.ok) t = await scopedToken(db, env, tenant, repo, { fetch: f, now, extra: { pull_requests: 'write' } });
  if (!t.ok) t = await scopedToken(db, env, tenant, repo, { fetch: f, now });
  if (!t.ok) { await store.event(db, tenant, 'github-app', 'failed', `template token ${repo}: ${t.error}`); return { ...out, ok: false, waiting_on: 'code-app-scope', error: t.error }; }
  await store.event(db, tenant, 'github-app', 'template-token', repo);
  return { ...out, ok: true, token: t.token, expires_at: new Date(t.expiresAt).toISOString() };
}
// REPO-SETTINGS-1 (2026-11-25): the core repositories had no ORG_ADMIN_TOKEN, so no setting could be set from Actions and branch cleanup and
// org-settings stayed red. REPO-STANDARD-1 (same day): two settings were not a standard; the administration app this Worker already holds now
// applies the whole of it (repostandard.js) to any repository of the org, with the description, homepage and topics the core computed.
export const REPO_SETTINGS = Object.freeze({ ...REPO_STANDARD.settings });
export const KEEP_PRIVATE = Object.freeze(['ultrastable/ops']);  // DISCOVER-1: the one repository that is never made public
export const NO_REWRITE = REPO_STANDARD.ruleset;  // REDTEAM-1: main refuses force pushes and deletion; one ruleset, defined in the standard
export const ORG_REPO = /^ultrastable\/[A-Za-z0-9._-]{1,100}$/;
export async function ensureRepoSettings(db, env, tenant, spec, { fetch: f = fetch, now = Date.now() } = {}) {
  const repo = String(spec.repo || ''), out = { repo };
  if (!ORG_REPO.test(repo) || repo.includes('..')) return { ...out, ok: false, error: 'not a repository of the org' };
  const adm = await getToken(db, env, tenant, 'github-admin', { fetch: f, now });
  if (!adm.ok) return { ...out, ok: false, waiting_on: 'admin-app', error: 'administration app: ' + adm.error };
  const A = gh(f, adm.token);
  const seen = await A('GET', `/repos/${repo}`);
  // ADMIT-1 (2026-11-25): org-settings.yml stayed red every run on the three archived repositories (a read-only repository refuses any PATCH),
  // and a tenant registered before tenant-repos.yml created its repository would do the same. Neither is a settings failure: both are skipped and named.
  if (seen.status === 200 && seen.json.archived === true) return { ...out, ok: true, changed: [], skipped: 'archived (read-only)' };
  if (seen.status === 404) return { ...out, ok: true, changed: [], skipped: 'not created yet (tenant-repos.yml creates it)' };
  if (seen.status !== 200) return { ...out, ok: false, waiting_on: 'admin-app-scope', error: `read ${repo}: HTTP ${seen.status}` };
  // One standard, one engine (REPO-STANDARD-1 with REDTEAM-1 and DISCOVER-1 from main): applyStandard sets the merge rules, metadata, security and the
  // main-no-rewrite ruleset. `public: true` makes a declared-public repository public, never one in KEEP_PRIVATE and never the other way.
  const std = { ...spec, visibility: (spec.public === true || spec.visibility === 'public') && !KEEP_PRIVATE.includes(repo) ? 'public' : undefined };
  if (spec.dry) {  // APP-CRED-WATCH-1: the credential watch reads, never writes
    const drift = Object.keys(REPO_SETTINGS).filter(k => seen.json[k] !== REPO_SETTINGS[k]);
    if (std.visibility === 'public' && seen.json.private === true) drift.push('private');
    return { ...out, ok: true, dry: true, drift };
  }
  const r = await applyStandard(A, repo, seen.json, std);
  const protect = r.gated.includes('ruleset') ? 'plan' : r.refused.some(x => /ruleset/.test(x)) ? 'failed' : 'protected';
  if (!r.ok) { await store.event(db, tenant, 'github-admin', 'failed', `repo standard ${repo}: ${r.refused.join('; ')}`.slice(0, 300)); return { ...out, ok: false, waiting_on: 'admin-app-scope', error: r.refused.join('; ').slice(0, 300), changed: r.changed, refused: r.refused, gated: r.gated, protect }; }
  if (r.changed.length) await store.event(db, tenant, 'github-admin', 'repo-settings', `${repo}: ${r.changed.join(', ')}`.slice(0, 300));
  return { ...out, ok: true, changed: r.changed, gated: r.gated, protect };
}
// DEPLOY-VISIBLE-1 (Rowan, 2026-11-25: "If somebody sees the code, then show them where it's running, show them the URL ... what I'm not seeing
// is where these repos are actually deployed."): a GitHub Deployment (environment production) with its live URL, on the repository and commit
// the code came from. The code app writes it with a one-hour token for that one repository; a grant the app lacks is named, never papered over.
export async function recordDeployment(db, env, tenant, spec, { fetch: f = fetch, now = Date.now() } = {}) {
  const repo = String(spec.repo || ''), sha = String(spec.sha || ''), url = String(spec.url || ''), out = { repo, sha, url };
  if (!ORG_REPO.test(repo) || repo.includes('..')) return { ...out, ok: false, error: 'not a repository of the org' };
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ...out, ok: false, error: 'sha must be a full commit id' };
  if (!/^https:\/\/[a-z0-9.-]+(\/[^\s]*)?$/i.test(url)) return { ...out, ok: false, error: 'url must be https' };
  const t = await scopedToken(db, env, tenant, repo, { fetch: f, now, extra: { deployments: 'write' } });
  if (!t.ok) return { ...out, ok: false, waiting_on: 'code-app-scope', error: `the code app has no Deployments: write grant on ${repo} (${t.error})`.slice(0, 300) };
  const C = gh(f, t.token), environment = String(spec.environment || 'production').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || 'production';
  const last = await C('GET', `/repos/${repo}/deployments?sha=${sha}&environment=${environment}&per_page=1`);
  let id = last.status === 200 && Array.isArray(last.json) && last.json[0] ? last.json[0].id : null;
  if (!id) {
    const d = await C('POST', `/repos/${repo}/deployments`, { ref: sha, environment, auto_merge: false, required_contexts: [], production_environment: environment === 'production', description: String(spec.description || 'Deployed by Ultrastable').slice(0, 140) });
    if (d.status !== 201) return { ...out, ok: false, waiting_on: d.status === 403 || d.status === 404 ? 'code-app-scope' : null, error: `create deployment on ${repo}: HTTP ${d.status} ${d.json.message || ''}`.slice(0, 200) };
    id = d.json.id; out.created = true;
  }
  const s = await C('POST', `/repos/${repo}/deployments/${id}/statuses`, { state: spec.state === 'failure' ? 'failure' : 'success', environment, environment_url: url, auto_inactive: true, description: String(spec.description || 'Live').slice(0, 140) });
  if (s.status !== 201) return { ...out, ok: false, error: `deployment status on ${repo}: HTTP ${s.status} ${s.json.message || ''}`.slice(0, 200) };
  await store.event(db, tenant, 'github-app', 'deployment', `${repo}@${sha.slice(0, 7)} ${url}`);
  return { ...out, ok: true, deployment: id };
}
export async function handleAppHost(request, env, { tenant = 'default', fetch: f = fetch, now = Date.now() } = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/host/app-repo' && url.pathname !== '/host/app-token' && url.pathname !== '/host/tenant-repo' && url.pathname !== '/host/repo-settings' && url.pathname !== '/host/template-token' && url.pathname !== '/host/repo-deployment') return null;
  if (request.method !== 'POST' || !env.INTERNAL_DEPLOY_KEY) return new Response('Not found', { status: 404 });
  // US-31-R36: on the key-gated routes the x-internal-key header is judged before the body is read, so a refused request never gets a 400
  // that shows the route exists. /host/app-token carries its key in the body; a body that is not a JSON object cannot carry one, so it is a 404.
  const keyGated = url.pathname !== '/host/app-token';
  if (keyGated && !same(request.headers.get('x-internal-key'), env.INTERNAL_DEPLOY_KEY)) return new Response('Not found', { status: 404 });
  let b; try { b = await request.json(); } catch { return keyGated ? J({ ok: false, error: 'bad json' }, 400) : new Response('Not found', { status: 404 }); }
  if (url.pathname === '/host/tenant-repo') {
    const r = await ensureTenantRepo(env.DB, env, tenant, b, { fetch: f, now });
    return J(r, r.ok ? 200 : r.waiting_on ? 409 : 400);
  }
  if (url.pathname === '/host/template-token') {
    const r = await templateToken(env.DB, env, tenant, b, { fetch: f, now });
    return J(r, r.ok ? 200 : r.waiting_on ? 409 : 400);
  }
  if (url.pathname === '/host/repo-settings') {
    const r = await ensureRepoSettings(env.DB, env, tenant, b, { fetch: f, now });
    return J(r, r.ok ? 200 : r.waiting_on ? 409 : 400);
  }
  if (url.pathname === '/host/repo-deployment') {
    const r = await recordDeployment(env.DB, env, tenant, b, { fetch: f, now });
    return J(r, r.ok ? 200 : r.waiting_on ? 409 : 400);
  }
  if (url.pathname === '/host/app-repo') {
    const r = await ensureAppRepo(env.DB, env, tenant, b, { fetch: f, now });
    return J(r, r.ok ? 200 : r.waiting_on ? 409 : 400);
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return new Response('Not found', { status: 404 });
  const repo = String(b.repo || '');
  // SEED-HOST-1: a standing seed's Worker asks for its own repository the same way; the key its host bound at deploy names that one repository.
  const seedOwn = TENANT_REPO.test(repo) && !CORE_REPO.test(repo);
  if (!(APP_REPO.test(repo) || seedOwn) || !same(b.key, await hostKey(env.INTERNAL_DEPLOY_KEY, repo))) return new Response('Not found', { status: 404 });
  const t = await scopedToken(env.DB, env, tenant, repo, { fetch: f, now });
  await store.event(env.DB, tenant, 'github-app', t.ok ? 'app-token' : 'failed', t.ok ? repo : `app token ${repo}: ${t.error}`);
  return J(t.ok ? { ok: true, token: t.token, expires_at: new Date(t.expiresAt).toISOString() } : { ok: false, error: t.error }, t.ok ? 200 : 503);
}
