import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { newKey } from '../src/auth/seal.js';
import { pkcs1ToPkcs8, appJwt } from '../src/auth/github-app.js';
import { getToken, refreshDue, probe, ownerActs, DEAD_RETRY_MS } from '../src/auth/index.js';
import * as store from '../src/auth/store.js';
import { handleAuth, makeState, checkState } from '../src/auth/routes.js';
import { oauth } from '../src/auth/oauth.js';

const toPem = (der, label) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----`;
async function appKey() {
  const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', k.privateKey));
  return { k, pkcs8, pkcs1: pkcs8.slice(26) };  // a 2048-bit PKCS#8 header is 26 bytes
}
const env = () => ({ CREDENTIAL_KEY: newKey() });

test('GitHub issues PKCS#1 keys; wrapping them as PKCS#8 round-trips byte for byte', async () => {
  const { pkcs8, pkcs1 } = await appKey();
  assert.deepEqual([...pkcs1ToPkcs8(pkcs1)], [...pkcs8]);
});

test('the app JWT is RS256 and verifies against the public key', async () => {
  const { k, pkcs1 } = await appKey();
  const jwt = await appJwt(42, toPem(pkcs1, 'RSA PRIVATE KEY'), 1_800_000_000_000);
  const [h, p, s] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, '42');
  assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${p}`)));
});

test('an installation token is minted from the stored key, cached, and re-minted inside the refresh margin', async () => {
  const db = makeDb(), e = env(), { pkcs1 } = await appKey();
  await store.put(db, e, 't', 'github-app', { secret: { pem: toPem(pkcs1, 'RSA PRIVATE KEY') }, meta: { app_id: 7, installation_id: 9 }, status: 'pending' });
  let calls = 0, exp = Date.parse('2026-11-13T13:00:00Z');
  const f = async (url) => { calls++; assert.match(url, /app\/installations\/9\/access_tokens$/); return { status: 201, json: async () => ({ token: 'tok' + calls, expires_at: new Date(exp).toISOString() }) }; };
  const now = Date.parse('2026-11-13T12:00:00Z');
  assert.equal((await getToken(db, e, 't', 'github-app', { fetch: f, now })).token, 'tok1');
  assert.equal((await getToken(db, e, 't', 'github-app', { fetch: f, now })).cached, true);
  assert.equal(calls, 1);
  const late = exp - 5 * 60e3;  // inside the 10 minute margin
  const r = await refreshDue(db, e, { fetch: f, now: late });
  assert.equal(r[0].action, 'renewed'); assert.equal(calls, 2);
  assert.equal((await probe(db, now)).ok, true);
  const raw = db.raw.prepare('SELECT sealed, access_sealed FROM credentials').get();
  assert.ok(!String(raw.sealed).includes('PRIVATE') && !String(raw.access_sealed).includes('tok'));  // sealed at rest
});

test('a missing installation is a recorded failure the probe sees', async () => {
  const db = makeDb(), e = env();
  await store.put(db, e, 't', 'github-app', { secret: { pem: 'x' }, meta: { app_id: 1 }, status: 'pending' });
  const r = await getToken(db, e, 't', 'github-app', {});
  assert.equal(r.ok, false);
  assert.deepEqual((await probe(db)).bad, ['t/github-app']);
  assert.equal(db.raw.prepare("SELECT event FROM credential_events").get().event, 'failed');
});

test('OAuth refresh grant mints access tokens for any host system and keeps a rotated refresh token', async () => {
  const db = makeDb(), e = env();
  await store.put(db, e, 't', 'oauth:acme', { secret: { refresh_token: 'r1', client_secret: 's' }, meta: { token_url: 'https://acme.test/token', client_id: 'cid' } });
  const f = async (url, o) => { assert.match(o.body, /grant_type=refresh_token/); assert.match(o.body, /refresh_token=r1/); return { ok: true, json: async () => ({ access_token: 'a1', expires_in: 3600, refresh_token: 'r2' }) }; };
  const r = await getToken(db, e, 't', 'oauth:acme', { fetch: f, now: Date.parse('2026-11-13T12:00:00Z') });
  assert.equal(r.token, 'a1');
  assert.equal((await store.material(db, e, 't', 'oauth:acme')).secret.refresh_token, 'r2');
  assert.equal((await oauth.deviceStart({ device_url: 'https://acme.test/device', client_id: 'c', scopes: ['a', 'b'] }, { fetch: async (u, o) => { assert.match(o.body, /scope=a\+b/); return { ok: true, json: async () => ({ user_code: 'X' }) }; } })).user_code, 'X');
});

test('the connect flow: consent screen, manifest conversion, install, then nothing left for a person', async () => {
  const db = makeDb(), e = { ...env(), DB: db };
  const consent = await handleAuth(new Request('https://x.test/connect/github'), e, { tenant: 't', name: 'org' });
  const page = await consent.text();
  assert.match(page, /Authorize on GitHub/); assert.match(page, /settings\/apps\/new/); assert.ok(!/<input[^>]*type="(text|password)"/.test(page), 'the consent screen asks for no typed secret');
  const state = await makeState(e, 't');
  assert.equal(await checkState(e, state), 't');
  assert.equal(await checkState(e, state + 'x'), null);
  const f = async () => ({ status: 201, json: async () => ({ id: 5, slug: 'org-app', pem: 'PEM', webhook_secret: 'w', client_id: 'c', client_secret: 'cs' }) });
  const cb = await handleAuth(new Request('https://x.test/auth/github/callback?code=abc&state=' + encodeURIComponent(state)), e, { tenant: 't', fetch: f });
  assert.equal(cb.status, 302); assert.match(cb.headers.get('location'), /apps\/org-app\/installations\/new/);
  const done = await handleAuth(new Request('https://x.test/auth/github/installed?installation_id=88&state=' + encodeURIComponent(state)), e, { tenant: 't' });
  assert.match(await done.text(), /GitHub connected/);
  const m = await store.material(db, e, 't', 'github-app');
  assert.equal(m.meta.installation_id, 88); assert.equal(m.meta.app_id, 5); assert.equal(m.secret.pem, 'PEM');
});

test('an auth route that throws answers with a retry screen, never a Worker exception', async () => {
  const { handleAuth } = await import('../src/auth/routes.js');
  const env = { DB: { prepare() { throw new Error('boom'); } }, CREDENTIAL_KEY: 'k' };
  const r = await handleAuth(new Request('https://x.test/auth/github/callback?code=c&state=s'), env, {});
  assert.ok(r.status !== 1101);
  assert.match(await r.text(), /try again|Try again/i);
});
test('the callback works on a database that never had the credential tables', async () => {
  const { handleAuth, makeState } = await import('../src/auth/routes.js');
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(':memory:');
  const db = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x; return o; }, async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) || null; }, async run() { st.run(...a); return {}; } }; return o; } };
  const env = { DB: db, CREDENTIAL_KEY: 'a'.repeat(32) };
  const state = await makeState(env, 'default');
  const f = async () => ({ status: 201, json: async () => ({ id: 1, slug: 'app', pem: 'pem', webhook_secret: 'w', client_id: 'c', client_secret: 's' }) });
  const r = await handleAuth(new Request('https://x.test/auth/github/callback?code=c&state=' + encodeURIComponent(state)), env, { fetch: f });
  assert.equal(r.status, 302); assert.match(r.headers.get('location'), /apps\/app\/installations\/new/);
});

test('every consent visit prefills a unique GitHub App name so a taken name is never a dead end', async () => {
  const { uniqueName } = await import('../src/auth/routes.js');
  const a = uniqueName('ultrastable'), b = uniqueName('ultrastable');
  assert.notEqual(a, b); assert.match(a, /^ultrastable-[0-9a-f]{6}$/); assert.ok(uniqueName('x'.repeat(60)).length <= 34);
});

// Q-LESSON-CRED-SCOPE: the GitHub App asks for exactly the allowlist, in the manifest the consent screen posts to GitHub.
test('the GitHub App requests exactly SCOPE_ALLOWLIST and nothing more', async () => {
  const { SCOPE_ALLOWLIST } = await import('../src/auth/index.js');
  const { manifest } = await import('../src/auth/routes.js');
  assert.deepEqual(manifest('https://x.test', 'n').default_permissions, { ...SCOPE_ALLOWLIST['github-app'] });
  const page = await (await handleAuth(new Request('https://x.test/connect/github'), { ...env(), DB: makeDb() }, { tenant: 't', name: 'org' })).text();
  const field = /name="manifest" value="([^"]*)"/.exec(page);
  assert.ok(field, 'the consent form carries the manifest');
  const posted = JSON.parse(field[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  assert.deepEqual(posted.default_permissions, { ...SCOPE_ALLOWLIST['github-app'] });
  assert.ok(Object.isFrozen(SCOPE_ALLOWLIST['github-app']), 'the allowlist cannot be widened at runtime');
  assert.ok(!Object.values(SCOPE_ALLOWLIST['github-app']).includes('admin'), 'no admin permission');
});

// Q-LESSON-CRED-SCOPE: a path variant of a protected route never reaches a handler as itself; it is redirected to the canonical path,
// where that route's own authentication runs. The worker calls pathGuard before any other route (index.js).
const PROTECTED = [['GET', '/api/analytics'], ['POST', '/api/criticality/sample'], ['POST', '/hook/github'], ['GET', '/auth/connectors'], ['POST', '/connect/google/disconnect']];
const variants = p => {
  const [, a, ...rest] = p.split('/'); const tail = rest.join('/');
  return ['/' + p, p + '/', p + '//', p.replace(/\//g, '//'), '/' + a + '%2F' + tail, '/' + a + '%2f' + tail, '/' + a + '%252F' + tail,
    '/' + a + '/./' + tail, '/' + a + '/%2e/' + tail, '/x/%2e%2e' + p, '/x/..%2F' + p.slice(1), '/' + a + '%5C' + tail];
};
test('canonicalPath folds every variant of a protected route back to the route', async () => {
  const { canonicalPath } = await import('../src/auth/index.js');
  for (const [, p] of PROTECTED) for (const v of variants(p)) assert.equal(canonicalPath(new URL('https://x.test' + v).pathname), p, v);
  assert.equal(canonicalPath('/'), '/'); assert.equal(canonicalPath('//'), '/'); assert.equal(canonicalPath('/../..'), '/');
});
test('pathGuard redirects every variant to the canonical path and lets the canonical path through', async () => {
  const { pathGuard } = await import('../src/auth/index.js');
  for (const [method, p] of PROTECTED) {
    assert.equal(pathGuard(new Request('https://x.test' + p + '?q=1', { method })), null, p);
    for (const v of variants(p)) {
      const req = new Request('https://x.test' + v + '?q=1', { method });
      if (new URL(req.url).pathname === p) continue;  // the URL parser already folded it (./ segments)
      const r = pathGuard(req);
      assert.ok(r, 'variant reached the router: ' + v);
      assert.equal(r.status, 308, v); assert.equal(r.headers.get('location'), p + '?q=1', v);
    }
  }
});
test('the worker runs pathGuard before any route, and the auth router never answers a variant as the route', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const fetchAt = src.indexOf('async fetch(request, env, ctx)');
  const body = src.slice(fetchAt);
  assert.ok(fetchAt > 0 && body.indexOf('pathGuard(request)') > 0, 'fetch calls pathGuard');
  assert.ok(body.indexOf('pathGuard(request)') < body.indexOf('hiddenByHealthOnly('), 'pathGuard runs first');
  assert.ok(body.indexOf('pathGuard(request)') < body.indexOf('handleAuth('), 'pathGuard runs before the auth routes');
  // Defense in depth: handed a variant directly, the auth router does not serve the protected connector status or a disconnect.
  const e = { ...env(), DB: makeDb() };
  for (const v of variants('/auth/connectors')) {
    const r = await handleAuth(new Request('https://x.test' + v), e, { tenant: 't' });
    if (new URL('https://x.test' + v).pathname === '/auth/connectors') continue;
    assert.ok(!r || r.headers.get('content-type') !== 'application/json', 'variant served connector status: ' + v);
  }
});

test('REPOS-1: /connect/github-admin registers an administration-only app and stores it under its own provider', async () => {
  const db = makeDb(), e = { ...env(), DB: db };
  const page = await (await handleAuth(new Request('https://x.test/connect/github-admin'), e, { tenant: 't', name: 'org', repos: ['acme/main'] })).text();
  assert.match(page, /organizations\/acme\/settings\/apps\/new/); assert.match(page, /administration/); assert.ok(!/contents/.test(page.replace(/&quot;/g, '"')), 'no code permission is requested');
  const state = await makeState(e, 't');
  const f = async () => ({ status: 201, json: async () => ({ id: 9, slug: 'org-admin', pem: 'PEM', webhook_secret: 'w', client_id: 'c', client_secret: 's' }) });
  const cb = await handleAuth(new Request('https://x.test/auth/github-admin/callback?code=abc&state=' + encodeURIComponent(state)), e, { tenant: 't', fetch: f });
  assert.match(cb.headers.get('location'), /apps\/org-admin\/installations\/new/);
  await handleAuth(new Request('https://x.test/auth/github-admin/installed?installation_id=7&state=' + encodeURIComponent(state)), e, { tenant: 't' });
  const m = await store.material(db, e, 't', 'github-admin');
  assert.equal(m.meta.installation_id, 7); assert.equal(m.meta.app_id, 9);
});

test('REPOS-1: the admin install archives every retired repository, and the list mirrors brand.json', async () => {
  const { RETIRED, archiveRetired } = await import('../src/auth/archive.js');
  const { readFileSync } = await import('node:fs');
  const brand = JSON.parse(readFileSync(new URL('../../../brand/brand.json', import.meta.url), 'utf8'));
  assert.deepEqual([...RETIRED].sort(), brand.repos.filter(r => r.status === 'retired').map(r => 'ultrastable/' + r.name).sort());
  const db = makeDb(), e = { ...env(), DB: db };
  await store.put(db, e, 't', 'github-admin', { secret: { pem: 'x' }, meta: { app_id: 1, installation_id: 2 }, status: 'pending' });
  const calls = [];
  const f = async (url, o) => { calls.push([url, o.method, o.body]); return { status: 200 }; };
  const r = await archiveRetired(db, e, 't', { fetch: f, token: 'tok' });
  assert.ok(r.ok); assert.equal(calls.length, RETIRED.length);
  assert.ok(calls.every(c => c[1] === 'PATCH' && c[2] === '{"archived":true}'));
});

test('REPOS-1: the tick resolver archives once and then stops', async () => {
  const { archiveDue } = await import('../src/auth/archive.js');
  const db = makeDb(), e = { ...env(), DB: db };
  await store.put(db, e, 't', 'github-admin', { secret: { pem: 'x' }, meta: { app_id: 1, installation_id: 2 }, status: 'ok' });
  let n = 0;
  const f = async () => { n++; return { status: 200 }; };
  const { archiveRetired } = await import('../src/auth/archive.js');
  assert.ok((await archiveRetired(db, e, 't', { fetch: f, token: 'tok' })).ok);
  const before = n;
  const r = await archiveDue(db, e, { fetch: f });
  assert.equal(r[0].action, 'done'); assert.equal(n, before, 'no second pass');
});

test('DIRECT-MERGE-GATE-1: the admin install upserts the main ruleset, and the list mirrors github/org-settings.json', async () => {
  const { RULESETS, applyRulesets, rulesetsDue } = await import('../src/auth/rulesets.js');
  const { readFileSync } = await import('node:fs');
  const cfg = JSON.parse(readFileSync(new URL('../../../github/org-settings.json', import.meta.url), 'utf8'));
  for (const [repo, list] of Object.entries(RULESETS)) assert.deepEqual(JSON.parse(JSON.stringify(list)), cfg.repos[repo].rulesets.map(({ _doc, ...r }) => r));
  const rs = RULESETS['ultrastable/ultrastable'][0];
  assert.ok(rs.rules.some(r => r.type === 'required_status_checks' && r.parameters.required_status_checks.some(c => c.context === 'checks')));
  const db = makeDb(), e = { ...env(), DB: db };
  await store.put(db, e, 't', 'github-admin', { secret: { pem: 'x' }, meta: { app_id: 1, installation_id: 2 }, status: 'pending' });
  let existing = [];
  const calls = [];
  const f = async (url, o = {}) => { calls.push([o.method || 'GET', url.replace('https://api.github.com', '')]); if (!o.method) return { status: 200, json: async () => existing }; return { status: o.method === 'POST' ? 201 : 200 }; };
  const a = await applyRulesets(db, e, 't', { fetch: f, token: 'tok' });
  assert.ok(a.ok); assert.deepEqual(calls[1], ['POST', '/repos/ultrastable/ultrastable/rulesets']);
  existing = [{ id: 7, name: 'main-requires-checks' }]; calls.length = 0;
  await applyRulesets(db, e, 't', { fetch: f, token: 'tok' });
  assert.deepEqual(calls[1], ['PUT', '/repos/ultrastable/ultrastable/rulesets/7']);
  assert.deepEqual((await rulesetsDue(db, e, { fetch: f })).map(x => x.action), ['done']);
  // APP-DRIFT-1: when the app that writes to main changes, the rule is applied again and its exemption names the new app
  await store.put(db, e, 't', 'github-app', { secret: { pem: 'x' }, meta: { app_id: 42, installation_id: 3 }, status: 'pending' });
  const bodies = [];
  const g = async (url, o = {}) => { if (o.body) bodies.push(JSON.parse(o.body)); return f(url, o); };
  assert.deepEqual((await rulesetsDue(db, e, { fetch: g, token: 'tok' })).map(x => x.action), ['rulesets-applied']);
  assert.deepEqual(bodies.pop().bypass_actors, [{ actor_id: 42, actor_type: 'Integration', bypass_mode: 'always' }]);
  assert.deepEqual((await rulesetsDue(db, e, { fetch: g, token: 'tok' })).map(x => x.action), ['done'], 'the same app is not applied twice');
  const denied = await applyRulesets(makeDb(), e, 't', { fetch: async () => ({ status: 403, json: async () => ({}) }), token: 'tok' });
  assert.equal(denied.ok, false);
});

test('DIRECT-MERGE-GATE-1: the Worker app is exempt too, a refusal records why, and a refused rule backs off', async () => {
  const { applyRulesets, rulesetsDue } = await import('../src/auth/rulesets.js');
  const db = makeDb(), e = { ...env(), DB: db };
  await store.put(db, e, 't', 'github-admin', { secret: { pem: 'x' }, meta: { app_id: 1, installation_id: 2 }, status: 'pending' });
  await store.put(db, e, 't', 'github-app', { secret: { pem: 'x' }, meta: { app_id: 77, installation_id: 3 }, status: 'ok' });
  let sent = null;
  const f = async (url, o = {}) => { if (!o.method) return { status: 200, json: async () => [] }; sent = JSON.parse(o.body); return { status: 422, json: async () => ({ message: 'Validation Failed', errors: ['Actor must be installed'] }) }; };
  const r = await applyRulesets(db, e, 't', { fetch: f, token: 'tok' });
  assert.equal(r.ok, false);
  assert.deepEqual(sent.bypass_actors.map(x => x.actor_id), [77]);  // the Actions app (15368) is refused by GitHub; MAIN-WRITER-1 commits through the org's own app
  const row = await db.prepare("SELECT detail FROM credential_events WHERE provider = 'github-admin' AND event = 'failed' ORDER BY id DESC LIMIT 1").first();
  assert.match(row.detail, /HTTP 422 Validation Failed; Actor must be installed/);
  assert.deepEqual((await rulesetsDue(db, e, { fetch: f })).map(x => x.action), ['await-main-writer']);  // MAIN-WRITER-1: no rule before a workflow commit has landed through the app
  await store.event(db, 't', 'github-app', 'main-writer', 'abc');
  assert.deepEqual((await rulesetsDue(db, e, { fetch: f })).map(x => x.action), ['backoff']);
});

test('READ-BUDGET-7: a warm isolate keeps serving its token when the credential store refuses reads', async () => {
  const db = makeDb(), e = env(), { pkcs1 } = await appKey();
  await store.put(db, e, 'm', 'github-app', { secret: { pem: toPem(pkcs1, 'RSA PRIVATE KEY') }, meta: { app_id: 7, installation_id: 9 }, status: 'pending' });
  const now = Date.parse('2026-11-13T12:00:00Z');
  const f = async () => ({ status: 201, json: async () => ({ token: 'memo-tok', expires_at: new Date(now + 3600e3).toISOString() }) });
  assert.equal((await getToken(db, e, 'm', 'github-app', { fetch: f, now })).token, 'memo-tok');
  const r = await getToken(db, e, 'm', 'github-app', { fetch: async () => { throw new Error('no network'); }, now: now + 60e3 });
  assert.equal(r.token, 'memo-tok'); assert.equal(r.memo, true);
});

test('a refused refresh is not retried every tick, and shows up as a live owner act (DEAD-CONSENT-1, OWNER-ACTS-1)', async () => {
  const db = makeDb(), e = env();
  await store.put(db, e, 't', 'oauth:google', { secret: { refresh_token: 'r' }, meta: { kind: 'oauth', provider: 'google', token_url: 'https://x.example/token', client_id: 'c' }, status: 'failed', error: 'refresh HTTP 401' });
  const at = Date.parse(db.raw.prepare('SELECT updated_at FROM credentials').get().updated_at);
  let calls = 0; const f = async () => { calls++; return { ok: false, status: 401, json: async () => ({}) }; };
  const soon = await refreshDue(db, e, { fetch: f, now: at + 10 * 60e3 });
  assert.equal(soon[0].action, 'backoff'); assert.equal(calls, 0);
  const later = await refreshDue(db, e, { fetch: f, now: at + DEAD_RETRY_MS + 1 });
  assert.notEqual(later[0].action, 'backoff');
  const acts = await ownerActs(db);
  assert.deepEqual(acts.map(a => [a.id, a.connect]), [['signin:oauth:google', '/connect/google']]);
  assert.ok(!JSON.stringify(acts).includes('"r"'));
});

test('APP-REUSE-1: a connect link never registers a second GitHub app', async () => {
  const db = makeDb(), e = { ...env(), DB: db };
  for (const [path, provider] of [['/connect/github', 'github-app'], ['/connect/github-admin', 'github-admin']]) {
    const first = await (await handleAuth(new Request('https://x.test' + path), e, { tenant: 't', name: 'org' })).text();
    assert.match(first, /settings\/apps\/new/, 'no stored app: the manifest form is offered once');
    await store.put(db, e, 't', provider, { secret: { pem: 'k' }, meta: { app_id: 7, slug: 'org-abc123' }, status: 'pending' });
    const half = await handleAuth(new Request('https://x.test' + path), e, { tenant: 't', name: 'org' });
    assert.equal(half.status, 302); assert.match(half.headers.get('location'), /^https:\/\/github\.com\/apps\/org-abc123\/installations\/new\?state=/, 'registered, not installed: the stored app is installed');
    await store.put(db, e, 't', provider, { meta: { installation_id: 9 }, status: 'ok' });
    const done = await (await handleAuth(new Request('https://x.test' + path), e, { tenant: 't', name: 'org' })).text();
    assert.match(done, /Already connected/); assert.ok(!/settings\/apps\/new/.test(done), 'connected: no manifest form');
    await store.put(db, e, 't', provider, { status: 'failed', error: 'mint HTTP 404' });
    const failed = await (await handleAuth(new Request('https://x.test' + path), e, { tenant: 't', name: 'org' })).text();  // NO-NEW-APP-1: an installed app that fails is repaired, never replaced
    assert.ok(!/settings\/apps\/new/.test(failed), 'a stored, installed app that fails to mint is never replaced by a new registration');
  }
});

test('OWNER-LINKS-4: a provider connect page without the site Worker\'s internal key is sent to sign in; with it, it is served', async () => {
  const db = makeDb(), e = { ...env(), DB: db, INTERNAL_DEPLOY_KEY: 'k-123' };
  for (const path of ['/connect/buffer', '/connect/mastodon/start?instance=mstdn.science', '/connect/bluesky']) {
    const r = await handleAuth(new Request('https://x.test' + path), e, { tenant: 't' });
    assert.equal(r.status, 302); assert.match(r.headers.get('location'), /\/auth\/signin\?next=/, path);
    const bad = await handleAuth(new Request('https://x.test' + path, { headers: { 'x-internal-key': 'guess' } }), e, { tenant: 't' });
    assert.match(bad.headers.get('location') || '', /\/auth\/signin/, 'a wrong key is no key');
  }
  const ok = await handleAuth(new Request('https://x.test/connect/buffer', { headers: { 'x-internal-key': 'k-123' } }), e, { tenant: 't' });
  assert.ok(!/\/auth\/signin/.test(ok.headers.get('location') || ''), 'with the key the connect page is served');
  const gh = await handleAuth(new Request('https://x.test/connect/github'), e, { tenant: 't', name: 'org' });
  assert.ok(!/\/auth\/signin/.test(gh.headers.get('location') || ''), 'the GitHub consent pages are unchanged');
});
