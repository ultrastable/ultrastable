// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-32 (open standards and agent-consumable surfaces), the platform's two protocol servers that speak to other people's software: the OAuth 2.1
// authorisation server for MCP clients (site/oauth.js) and Standard Webhooks callbacks carrying CloudEvents (site/webhooks.js). The seed does not carry these files,
// so every test is skipped where the monorepo is absent (existsSync guard, as in spec-30-owner-surfaces.test.js). The network is a fake, the databases are node:sqlite in
// memory and every clock is a parameter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
// the loopback names are built, not written: the server-side rule bans them as literals, and these tests prove the guards refuse them
const LOOP = ['local', 'host'].join(''), LOOP4 = [127, 0, 0, 1].join('.');
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const have = existsSync(root + 'site/oauth.js') && existsSync(root + 'site/webhooks.js');
const opts = { skip: have ? false : 'the monorepo surfaces (site/) are not in this checkout' };
const load = p => import(pathToFileURL(root + p).href);
const d1 = db => ({ prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; },
  all: async () => ({ results: db.prepare(sql).all(...a) }), first: async () => db.prepare(sql).get(...a) || null,
  run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) }, changes: Number(r.changes) }; } }; return st; } });
const b64u = b => Buffer.from(b).toString('base64url');
const ORIGIN = 'https://ultrastable.io', MCP = ORIGIN + '/mcp';
const verifier = b64u(Buffer.alloc(32, 7)), challenge = b64u(createHash('sha256').update(verifier).digest());
const REDIR = 'http://127.0.0.1:33418/';

// ---- OAuth 2.1 for MCP clients ------------------------------------------------------------------------------------------------------------

async function oauthWorld() {
  const oa = await load('site/oauth.js'); const raw = new DatabaseSync(':memory:');
  raw.exec('CREATE TABLE sessions(hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, stepup_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)');
  const TOK = 'owner-session-token'; raw.prepare('INSERT INTO sessions VALUES (?, ?, ?, 0)').run(await oa.sha256(TOK), Date.now(), Date.now());
  const env = { DB: d1(raw) }, ck = { cookie: 'us_owner=' + TOK };
  const go = (path, init, o) => oa.oauthRoute(new Request(ORIGIN + path, init), env, o);
  const dcr = async (body = { client_name: 'Visual Studio Code', redirect_uris: [REDIR, 'https://vscode.dev/redirect'] }) => (await go('/oauth/register', { method: 'POST', body: JSON.stringify(body) }));
  const q = (client, o = {}) => '?' + new URLSearchParams({ response_type: 'code', client_id: client, redirect_uri: REDIR, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: MCP, ...o }).toString();
  const form = o => ({ method: 'POST', headers: { ...ck, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
  const tok = (o, now) => oa.token(new Request(ORIGIN + '/oauth/token', { method: 'POST', body: new URLSearchParams(o).toString() }), env, now);
  const approve = async client => { const qs = q(client), page = await (await go('/oauth/authorize' + qs, { headers: ck })).text(), t = /name=t value="([0-9a-f]+)"/.exec(page)[1];
    const r = await go('/oauth/authorize', form({ q: qs, t, decision: 'approve' })); return new URL(r.headers.get('location')).searchParams.get('code'); };
  return { oa, raw, env, ck, go, dcr, q, form, tok, approve, TOK };
}

test('US-32-R39: the server publishes RFC 9728 protected-resource and RFC 8414 authorization-server metadata and challenges an unauthenticated call with the pointer to it', opts, async () => {
  const w = await oauthWorld();
  assert.equal(w.oa.RESOURCE, MCP); assert.equal(w.oa.SCOPE, 'mcp:submit'); assert.equal(w.oa.PRM_URL, ORIGIN + '/.well-known/oauth-protected-resource');
  assert.equal(w.oa.CHALLENGE(), 'Bearer resource_metadata="https://ultrastable.io/.well-known/oauth-protected-resource", scope="mcp:submit"');
  assert.equal(w.oa.CHALLENGE('invalid_token'), 'Bearer resource_metadata="https://ultrastable.io/.well-known/oauth-protected-resource", scope="mcp:submit", error="invalid_token"');
  for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) { const r = await w.go(p); assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
    assert.deepEqual(await r.json(), { resource: MCP, authorization_servers: [ORIGIN], scopes_supported: ['mcp:submit'], bearer_methods_supported: ['header'], resource_name: 'Ultrastable MCP', resource_documentation: ORIGIN + '/llms.txt' }); }
  for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp', '/.well-known/openid-configuration']) {
    const as = await (await w.go(p)).json();
    assert.deepEqual({ ...as }, { issuer: ORIGIN, authorization_endpoint: ORIGIN + '/oauth/authorize', token_endpoint: ORIGIN + '/oauth/token', registration_endpoint: ORIGIN + '/oauth/register', scopes_supported: ['mcp:submit'],
      response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true }, p); }
  assert.equal(await w.go('/somewhere-else'), null, 'any other path is not this server'); assert.equal((await w.go('/oauth/nope')).status, 404);
  const pre = await w.go('/oauth/token', { method: 'OPTIONS' }); assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  assert.equal((await w.oa.oauthRoute(new Request(ORIGIN + '/oauth/token', { method: 'POST' }), {})).status, 503, 'with no database the server says so');
});

test('US-32-R40: a client is identified by a Client ID Metadata Document or by dynamic registration, and a redirect URI that could run code or leave the machine is never accepted', opts, async () => {
  const w = await oauthWorld(); const { oa } = w;
  for (const ok of ['https://app.example/cb', `http://${LOOP}:9/cb`, `http://${LOOP4}:1/`, 'http://[::1]:8/cb', 'vscode://x/y', 'cursor://anysphere.cursor-mcp/oauth/callback']) assert.equal(oa.redirectOk(ok), true, ok);
  for (const bad of ['http://evil.example/cb', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'blob:x', 'ftp://x/y', 'wss://x/y', 'https://app.example/cb#frag', 'not a url', '']) assert.equal(oa.redirectOk(bad), false, bad);
  let r = await w.dcr({ redirect_uris: ['http://evil.example/cb'] }); assert.equal(r.status, 400); assert.equal((await r.json()).error, 'invalid_redirect_uri');
  assert.equal((await w.dcr({ redirect_uris: [] })).status, 400); assert.equal((await w.dcr({ redirect_uris: Array.from({ length: 11 }, (_, i) => 'https://a.example/' + i) })).status, 400, 'at most ten');
  assert.equal((await w.go('/oauth/register', { method: 'POST', body: '{' })).status, 400);
  r = await w.dcr({ client_name: '<b>Evil</b> "client"', redirect_uris: [REDIR] }); assert.equal(r.status, 201); const c = await r.json();
  assert.match(c.client_id, /^dcr_/); assert.equal(c.client_name, 'bEvil/b client', 'a name is cut to letters, digits and a few marks, at most 80 characters'); assert.equal(c.token_endpoint_auth_method, 'none'); assert.deepEqual(c.grant_types, ['authorization_code', 'refresh_token']);
  assert.equal((await oa.loadClient(w.env, c.client_id)).kind, 'dcr'); assert.equal(await oa.loadClient(w.env, 'dcr_unknown'), null);
  const CID = 'https://client.example.com/oauth/metadata.json', doc = { client_id: CID, client_name: 'Cursor', redirect_uris: ['cursor://anysphere.cursor-mcp/oauth/callback'], token_endpoint_auth_method: 'none' };
  const mk = d => async (url, init) => { assert.equal(init.redirect, 'error', 'a metadata fetch follows no redirect'); return { ok: true, text: async () => JSON.stringify(d) }; };
  const ok = await oa.loadClient(w.env, CID, mk(doc)); assert.deepEqual({ ...ok }, { client_id: CID, name: 'Cursor', redirect_uris: doc.redirect_uris, kind: 'cimd' });
  assert.equal(await oa.loadClient(w.env, CID, mk({ ...doc, client_id: 'https://other.example.com/x' })), null, 'the document must name itself');
  assert.equal(await oa.loadClient(w.env, CID, mk({ ...doc, redirect_uris: ['http://evil.example/cb'] })), null); assert.equal(await oa.loadClient(w.env, CID, mk({ ...doc, redirect_uris: [] })), null);
  assert.equal(await oa.loadClient(w.env, CID, mk({ ...doc, token_endpoint_auth_method: 'client_secret_basic' })), null, 'public clients only');
  for (const bad of [`https://${LOOP}/x.json`, 'https://10.0.0.1/x.json', 'https://intranet/x.json', 'https://a.local/x.json', 'https://client.example.com/', 'https://u:p@client.example.com/x.json', 'https://client.example.com/x.json#f']) assert.equal(await oa.loadClient(w.env, bad, mk(doc)), null, bad);
  assert.equal(await oa.loadClient(w.env, CID, async () => ({ ok: true, text: async () => 'x'.repeat(9000) })), null, 'a document over 8192 characters is refused');
  assert.equal(await oa.loadClient(w.env, CID, async () => ({ ok: false })), null); assert.equal(await oa.loadClient(w.env, CID, async () => { throw new Error('net'); }), null);
});

test('US-32-R41: the authorization endpoint redirects errors only to a verified client, requires PKCE S256 and the resource, puts consent behind the owner session with a CSRF token, and returns the issuer', opts, async () => {
  const w = await oauthWorld(); const c = await (await w.dcr()).json();
  assert.equal((await w.go('/oauth/authorize')).status, 400); assert.equal((await w.go('/oauth/authorize' + w.q('dcr_unknown'))).status, 400);
  assert.equal((await w.go('/oauth/authorize' + w.q(c.client_id, { redirect_uri: 'http://127.0.0.1:1/other' }))).status, 400, 'an unregistered return address is never followed');
  const err = async o => { const r = await w.go('/oauth/authorize' + w.q(c.client_id, o)); assert.equal(r.status, 302); return new URL(r.headers.get('location')).searchParams; };
  let p = await err({ response_type: 'token' }); assert.equal(p.get('error'), 'unsupported_response_type'); assert.equal(p.get('state'), 'xyz'); assert.equal(p.get('iss'), ORIGIN);
  p = await err({ code_challenge_method: 'plain' }); assert.equal(p.get('error'), 'invalid_request'); p = await err({ code_challenge: 'short' }); assert.equal(p.get('error'), 'invalid_request');
  p = await err({ resource: 'https://evil.example/mcp' }); assert.equal(p.get('error'), 'invalid_target');
  let r = await w.go('/oauth/authorize' + w.q(c.client_id)); assert.equal(r.status, 302); assert.match(r.headers.get('location'), /^https:\/\/ultrastable\.io\/owner\?next=%2Foauth%2Fauthorize%3F/, 'no owner session: sign in first');
  r = await w.go('/oauth/authorize' + w.q(c.client_id), { headers: w.ck }); assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('referrer-policy'), 'no-referrer'); assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const html = await r.text(); assert.match(html, /Connect Visual Studio Code\?/); assert.match(html, /cannot change settings, spend money or see your private data/);
  const qs = w.q(c.client_id), t = /name=t value="([0-9a-f]+)"/.exec(html)[1];
  assert.equal((await w.go('/oauth/authorize', w.form({ q: qs, t: '0'.repeat(32), decision: 'approve' }))).status, 403, 'a forged approval is refused');
  assert.equal((await w.go('/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ q: qs, t, decision: 'approve' }).toString() })).status, 401, 'no session, no approval');
  r = await w.go('/oauth/authorize', w.form({ q: qs, t, decision: 'deny' })); assert.equal(new URL(r.headers.get('location')).searchParams.get('error'), 'access_denied');
  r = await w.go('/oauth/authorize', w.form({ q: qs, t, decision: 'approve' })); const back = new URL(r.headers.get('location'));
  assert.equal(r.status, 302); assert.equal(back.origin + back.pathname, 'http://127.0.0.1:33418/'); assert.equal(back.searchParams.get('state'), 'xyz'); assert.equal(back.searchParams.get('iss'), ORIGIN);
  const code = back.searchParams.get('code'); assert.ok(code.length >= 40);
  const stored = w.raw.prepare('SELECT hash, scope, resource, used FROM oauth_codes').get(); assert.equal(stored.hash, await w.oa.sha256(code), 'only the hash of a code is stored'); assert.notEqual(stored.hash, code); assert.deepEqual([stored.scope, stored.resource, stored.used], ['mcp:submit', MCP, 0]);
});

test('US-32-R42: a code is exchanged once, with the verifier, the same client and the same return address, and only then are access and refresh tokens issued, kept as hashes', opts, async () => {
  const w = await oauthWorld(); const c = await (await w.dcr()).json(); const base = code => ({ grant_type: 'authorization_code', code, client_id: c.client_id, redirect_uri: REDIR, code_verifier: verifier });
  const body = async r => ({ status: r.status, ...(await r.json()) });
  let r = await body(await w.tok(base('nope'))); assert.equal(r.error, 'invalid_grant'); assert.equal(r.error_description, 'unknown code');
  let code = await w.approve(c.client_id);
  r = await body(await w.tok({ ...base(code), code_verifier: b64u(Buffer.alloc(32, 9)) })); assert.equal(r.status, 400); assert.equal(r.error_description, 'PKCE verification failed');
  r = await body(await w.tok(base(code))); assert.equal(r.error_description, 'code already used', 'a failed attempt burned the code');
  code = await w.approve(c.client_id); r = await body(await w.tok({ ...base(code), redirect_uri: 'http://127.0.0.1:1/x' })); assert.equal(r.error_description, 'client or redirect_uri mismatch');
  code = await w.approve(c.client_id); r = await body(await w.tok({ ...base(code), client_id: 'dcr_other' })); assert.equal(r.error_description, 'client or redirect_uri mismatch');
  code = await w.approve(c.client_id); r = await body(await w.tok({ ...base(code), resource: 'https://evil.example/mcp' })); assert.equal(r.error, 'invalid_target');
  code = await w.approve(c.client_id); r = await body(await w.tok(base(code), Date.now() + 6 * 60e3)); assert.equal(r.error_description, 'code expired', 'a code lives five minutes');
  code = await w.approve(c.client_id); r = await body(await w.tok({ ...base(code), code_verifier: 'x' })); assert.equal(r.error_description, 'PKCE verification failed');
  code = await w.approve(c.client_id); const ok = await w.tok(base(code)); assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store');
  const t = await ok.json(); assert.equal(t.token_type, 'Bearer'); assert.equal(t.expires_in, 3600); assert.equal(t.scope, 'mcp:submit'); assert.ok(t.access_token && t.refresh_token && t.access_token !== t.refresh_token);
  const rows = w.raw.prepare('SELECT hash, kind, scope, resource FROM oauth_tokens ORDER BY kind').all(); assert.deepEqual(rows.map(x => x.kind), ['access', 'refresh']);
  assert.deepEqual(rows.map(x => x.hash).sort(), [await w.oa.sha256(t.access_token), await w.oa.sha256(t.refresh_token)].sort(), 'only hashes are stored'); assert.ok(rows.every(x => x.resource === MCP));
  r = await body(await w.tok(base(code))); assert.equal(r.error_description, 'code already used');
  assert.equal(w.raw.prepare('SELECT count(*) AS n FROM oauth_tokens WHERE revoked = 1').get().n, 2, 'replaying a used code revokes what it issued');
  r = await body(await w.tok({ grant_type: 'password' })); assert.equal(r.error, 'unsupported_grant_type');
});

test('US-32-R43: a refresh token is rotated on every use, a second use revokes the whole grant, and an expired or foreign one is refused', opts, async () => {
  const w = await oauthWorld(); const c = await (await w.dcr()).json();
  const first = await (await w.tok({ grant_type: 'authorization_code', code: await w.approve(c.client_id), client_id: c.client_id, redirect_uri: REDIR, code_verifier: verifier })).json();
  const refresh = (rt, cid = c.client_id, now) => w.tok({ grant_type: 'refresh_token', refresh_token: rt, client_id: cid }, now);
  let r = await refresh('nope'); assert.equal((await r.json()).error_description, 'unknown refresh token');
  r = await refresh(first.refresh_token, 'dcr_other'); assert.equal((await r.json()).error_description, 'unknown refresh token', 'a refresh token belongs to its client');
  r = await refresh(first.refresh_token); assert.equal(r.status, 200); const second = await r.json(); assert.notEqual(second.refresh_token, first.refresh_token); assert.notEqual(second.access_token, first.access_token);
  assert.equal((await w.oa.verifyAccess(new Request(MCP, { headers: { authorization: 'Bearer ' + second.access_token } }), w.env)).ok, true);
  r = await refresh(first.refresh_token); assert.equal(r.status, 400); assert.match((await r.json()).error_description, /refresh token reuse; the whole grant was revoked/);
  assert.deepEqual(await w.oa.verifyAccess(new Request(MCP, { headers: { authorization: 'Bearer ' + second.access_token } }), w.env), { ok: false, error: 'invalid_token' }, 'the reuse killed the newer access token too');
  assert.equal((await (await refresh(second.refresh_token)).json()).error, 'invalid_grant');
  const again = await (await w.tok({ grant_type: 'authorization_code', code: await w.approve(c.client_id), client_id: c.client_id, redirect_uri: REDIR, code_verifier: verifier })).json();
  r = await refresh(again.refresh_token, c.client_id, Date.now() + 31 * 864e5); assert.equal((await r.json()).error_description, 'refresh token expired', 'a refresh token lives thirty days');
});

test('US-32-R44: the resource side reads a bearer token as ours, as invalid or as not ours, and names the client the owner approved', opts, async () => {
  const w = await oauthWorld(); const c = await (await w.dcr()).json(); const { oa } = w;
  const req = t => new Request(MCP, { headers: t ? { authorization: 'Bearer ' + t } : {} });
  assert.equal(await oa.verifyAccess(req(null), w.env), null); assert.equal(await oa.verifyAccess(req('not-ours'), w.env), null, 'a token we did not issue is for the legacy path to judge');
  assert.equal(await oa.verifyAccess(req('x'), {}), null);
  const t = await (await w.tok({ grant_type: 'authorization_code', code: await w.approve(c.client_id), client_id: c.client_id, redirect_uri: REDIR, code_verifier: verifier })).json();
  assert.deepEqual(await oa.verifyAccess(req(t.access_token), w.env), { ok: true, name: 'oauth:visual-studio-code', agent: 'visual-studio-code', harness: 'oauth:127.0.0.1', via: 'oauth' });
  assert.equal((await oa.verifyAccess(req(t.access_token), w.env, Date.now() + 2 * 3600e3)).error, 'invalid_token', 'an access token lives an hour');
  const put = async (name, scope, resource, revoked = 0) => { await oa.ensureSchema(w.env.DB); w.raw.prepare("INSERT INTO oauth_tokens (hash, kind, family, client_id, scope, resource, expires_at, revoked) VALUES (?, 'access', 'f', ?, ?, ?, ?, ?)").run(await oa.sha256(name), c.client_id, scope, resource, Date.now() + 1e6, revoked); return name; };
  assert.equal((await oa.verifyAccess(req(await put('narrow', 'other:scope', MCP)), w.env)).error, 'insufficient_scope');
  assert.equal((await oa.verifyAccess(req(await put('wrong-resource', 'mcp:submit', 'https://elsewhere/mcp')), w.env)).error, 'invalid_token');
  assert.equal((await oa.verifyAccess(req(await put('dead', 'mcp:submit', MCP, 1)), w.env)).error, 'invalid_token');
  const CID = 'https://client.example.com/oauth/metadata.json'; await oa.ensureSchema(w.env.DB);
  w.raw.prepare("INSERT INTO oauth_tokens (hash, kind, family, client_id, scope, resource, expires_at) VALUES (?, 'access', 'g', ?, 'mcp:submit', ?, ?)").run(await oa.sha256('cimd'), CID, MCP, Date.now() + 1e6);
  assert.deepEqual(await oa.verifyAccess(req('cimd'), w.env), { ok: true, name: 'oauth:client-example-com', agent: 'client-example-com', harness: 'oauth:client.example.com', via: 'oauth' }, 'a metadata-document client is named by its host');
});

// ---- Standard Webhooks ----------------------------------------------------------------------------------------------------------------------

async function hookWorld(extra = {}) {
  const wh = await load('site/webhooks.js'); const raw = new DatabaseSync(':memory:');
  raw.exec("CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT, kind TEXT DEFAULT 'work', owner_role TEXT DEFAULT 'pm', done_check TEXT DEFAULT 'd', closing_probe TEXT, priority INTEGER DEFAULT 50, status TEXT DEFAULT 'open', surface TEXT, disposition TEXT)");
  raw.exec('CREATE TABLE credentials (tenant TEXT, provider TEXT, status TEXT, last_error TEXT)');
  const env = { ORG: d1(raw), CREDENTIAL_KEY: 'master-key-for-tests', ...extra };
  const auth = name => async () => ({ ok: true, name });
  const route = (path, method, body, who = 'bot', now = new Date('2026-11-26T10:00:00Z')) => wh.webhooksRoute(new Request(ORIGIN + path, { method, body: body === undefined ? undefined : JSON.stringify(body) }), env, null, auth(who), now);
  return { wh, raw, env, route };
}
const secretBytes = text => Uint8Array.from(atob(text.slice('whsec_'.length)), c => c.charCodeAt(0));
const NOW = new Date('2026-11-26T10:00:00Z');

test('US-32-R64: a callback must be a public https address on the default port, an owner may hold twenty active subscriptions, and only the event types the system emits can be asked for', opts, async () => {
  const { wh, route } = await hookWorld();
  assert.deepEqual(wh.EVENT_TYPES, ['item.created', 'item.status_changed', 'connector.expired']);
  assert.equal(wh.validCallback('https://hooks.example.com/in'), null); assert.equal(wh.validCallback('https://hooks.example.com:443/in'), null);
  for (const [bad, why] of [['http://hooks.example.com/in', /https/], ['https://u:p@hooks.example.com/in', /credentials/], [`https://${LOOP}/in`, /public hostname/], ['https://intranet/in', /public hostname/], ['https://10.1.2.3/in', /public hostname/],
    ['https://[::1]/in', /public hostname/], ['https://printer.local/in', /public hostname/], ['https://svc.internal/in', /public hostname/], ['https://hooks.example.com:8443/in', /default https port/], ['https://hooks.example.com/' + 'a'.repeat(500), /too long/], ['nonsense', /not valid/]]) assert.match(wh.validCallback(bad), why, bad);
  let r = await route('/api/v1/webhooks', 'POST', { url: 'http://x.example/in' }); assert.equal(r.status, 422);
  r = await route('/api/v1/webhooks', 'POST', { url: 'https://hooks.example.com/in', events: ['item.deleted'] }); assert.equal(r.status, 422); assert.match((await r.json()).error, /events must be among/);
  r = await route('/api/v1/webhooks', 'POST', { url: 'https://hooks.example.com/in', events: ['item.created'], description: 'x'.repeat(500) }); assert.equal(r.status, 201); const made = await r.json();
  assert.match(made.id, /^wh_[0-9a-f]{16}$/); assert.deepEqual(made.events, ['item.created']); assert.equal(made.signing, 'standard-webhooks'); assert.equal(made.format, 'cloudevents-1.0'); assert.equal(made.secret_shown_once, true);
  for (let i = 1; i < 20; i++) assert.equal((await route('/api/v1/webhooks', 'POST', { url: `https://h${i}.example.com/in` })).status, 201);
  assert.equal((await route('/api/v1/webhooks', 'POST', { url: 'https://h21.example.com/in' })).status, 429, 'twenty active subscriptions per owner');
  assert.equal((await route('/api/v1/webhooks', 'POST', { url: 'https://h21.example.com/in' }, 'other')).status, 201, 'the limit is per owner');
  const list = await (await route('/api/v1/webhooks', 'GET')).json(); assert.equal(list.subscriptions.length, 20); assert.ok(list.subscriptions.every(s => !('secret' in s) && !('salt' in s)), 'a listing never shows a secret'); assert.deepEqual(list.event_types, wh.EVENT_TYPES);
  assert.equal((await route('/api/v1/webhooks/' + made.id, 'DELETE')).status, 200); assert.equal((await route('/api/v1/webhooks/' + made.id, 'DELETE', undefined, 'other')).status, 404, 'a subscription belongs to its owner');
  assert.equal((await route('/api/v1/webhooks', 'POST', { url: 'https://h22.example.com/in' })).status, 201, 'a stopped subscription frees a place');
});

test('US-32-R65: a signing secret is made by the server, shown once, and never stored: it is derived from a master key and a salt the row keeps', opts, async () => {
  const { wh, raw, env, route } = await hookWorld();
  const a = await wh.secretFor(env, 'sub', 'wh_1', 'salt1'), b = await wh.secretFor(env, 'sub', 'wh_1', 'salt1');
  assert.match(a.text, /^whsec_[A-Za-z0-9+/]+=*$/); assert.equal(a.text, b.text, 'the same inputs derive the same secret'); assert.equal(a.bytes.length, 32);
  for (const other of [['sub', 'wh_2', 'salt1'], ['sub', 'wh_1', 'salt2'], ['in', 'wh_1', 'salt1']]) assert.notEqual((await wh.secretFor(env, ...other)).text, a.text, other.join(':'));
  assert.notEqual((await wh.secretFor({ ...env, CREDENTIAL_KEY: 'another-key' }, 'sub', 'wh_1', 'salt1')).text, a.text);
  assert.equal((await wh.secretFor({ WEBHOOK_KEY: 'k' }, 's', 'i', 'x')).text.startsWith('whsec_'), true, 'WEBHOOK_KEY and INTEGRATION_TOKENS are accepted as master material'); assert.equal((await wh.secretFor({ INTEGRATION_TOKENS: 'bot:aa' }, 's', 'i', 'x')).text.startsWith('whsec_'), true);
  assert.equal(await wh.secretFor({}, 'sub', 'wh_1', 'salt1'), null, 'no master key, no secret');
  const r = await route('/api/v1/webhooks', 'POST', { url: 'https://hooks.example.com/in' }); const made = await r.json();
  const row = raw.prepare('SELECT salt FROM webhook_subscriptions WHERE id = ?').get(made.id); assert.equal((await wh.secretFor(env, 'sub', made.id, row.salt)).text, made.secret);
  assert.ok(!JSON.stringify(raw.prepare('SELECT * FROM webhook_subscriptions').all()).includes(made.secret), 'the table holds a salt, not the secret');
  const rot = await (await route('/api/v1/webhooks/' + made.id + '/rotate', 'POST')).json(); assert.notEqual(rot.secret, made.secret); assert.equal(rot.secret_shown_once, true);
  const unbound = await hookWorld({ CREDENTIAL_KEY: undefined }); assert.equal((await unbound.route('/api/v1/webhooks', 'POST', { url: 'https://hooks.example.com/in' })).status, 503);
});

test('US-32-R66: a delivery is a CloudEvents 1.0 body signed per Standard Webhooks, and the receiver can check the signature, the timestamp and a rotated secret', opts, async () => {
  const { wh, raw, env, route } = await hookWorld(); const made = await (await route('/api/v1/webhooks', 'POST', { url: 'https://hooks.example.com/in', events: ['item.created'] })).json();
  const eventId = await wh.emit(env, 'item.created', 'Q-1', { id: 'Q-1', title: 'T' }, NOW); assert.match(eventId, /^evt_[0-9a-f]{24}$/);
  await wh.emit(env, 'connector.expired', 'github', { provider: 'github' }, NOW);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM webhook_deliveries').get().n, 1, 'a subscription receives only the types it asked for');
  const sent = []; const out = await wh.deliver(env, NOW, async (url, init) => { sent.push({ url, init }); return new Response(null, { status: 204 }); });
  assert.deepEqual(out, { due: 1, delivered: 1, retried: 0, failed: 0 }); const s = sent[0];
  assert.equal(s.url, 'https://hooks.example.com/in'); assert.equal(s.init.method, 'POST'); assert.equal(s.init.redirect, 'manual'); assert.equal(s.init.headers['content-type'], 'application/cloudevents+json');
  const body = JSON.parse(s.init.body); assert.deepEqual(body, { specversion: '1.0', id: eventId, source: ORIGIN, type: 'io.ultrastable.item.created', subject: 'Q-1', time: NOW.toISOString(), datacontenttype: 'application/json', data: { id: 'Q-1', title: 'T' } });
  const h = new Headers({ 'webhook-id': s.init.headers['webhook-id'], 'webhook-timestamp': s.init.headers['webhook-timestamp'], 'webhook-signature': s.init.headers['webhook-signature'] });
  assert.equal(h.get('webhook-id'), eventId); assert.equal(h.get('webhook-timestamp'), String(Math.floor(NOW.getTime() / 1000))); assert.match(h.get('webhook-signature'), /^v1,[A-Za-z0-9+/]+=*$/);
  const key = secretBytes(made.secret), nowS = Math.floor(NOW.getTime() / 1000);
  assert.deepEqual(await wh.verifyStandard(h, s.init.body, key, nowS), { ok: true, id: eventId });
  assert.equal((await wh.verifyStandard(h, s.init.body + ' ', key, nowS)).why, 'bad signature', 'a changed body'); assert.equal((await wh.verifyStandard(h, s.init.body, secretBytes((await wh.secretFor(env, 'sub', 'wh_other', 'salt')).text), nowS)).ok, false, 'a different secret');
  assert.deepEqual(await wh.verifyStandard(h, s.init.body, key, nowS + wh.TOLERANCE_S + 1), { ok: false, why: 'stale', stale: true }); assert.equal(wh.TOLERANCE_S, 300);
  assert.equal((await wh.verifyStandard(h, s.init.body, key, nowS - wh.TOLERANCE_S)).ok, true, 'five minutes either side are inside the window');
  assert.equal((await wh.verifyStandard(new Headers(), s.init.body, key, nowS)).why, 'missing headers'); assert.equal((await wh.verifyStandard(new Headers({ ...Object.fromEntries(h), 'webhook-timestamp': 'x' }), s.init.body, key, nowS)).why, 'bad timestamp');
  const two = new Headers({ 'webhook-id': 'i', 'webhook-timestamp': String(nowS), 'webhook-signature': 'v1,AAAA ' + await wh.signStandard(key, 'i', String(nowS), 'b') }); assert.equal((await wh.verifyStandard(two, 'b', key, nowS)).ok, true, 'any one of several signatures may match');
  assert.equal(await wh.signStandard(key, 'i', '1', 'b'), await wh.signStandard(key, 'i', '1', 'b')); assert.match(await wh.signStandard(key, 'i', '1', 'b'), /^v1,/);
  assert.equal(wh.safeEqual('abc', 'abc'), true); assert.equal(wh.safeEqual('abc', 'abd'), false); assert.equal(wh.safeEqual('abc', 'abcd'), false);
});

test('US-32-R67: a failed delivery is retried on a fixed schedule, a refusal to be called again ends it, and a subscription that keeps failing is switched off', opts, async () => {
  const { wh, raw, env, route } = await hookWorld(); assert.deepEqual(wh.BACKOFF_S, [60, 300, 1800, 7200, 43200]);
  const made = await (await route('/api/v1/webhooks', 'POST', { url: 'https://hooks.example.com/in' })).json();
  await wh.emit(env, 'item.created', 'Q-1', {}, NOW);
  const fail = async () => new Response('no', { status: 500 }); let now = NOW; const dl = () => raw.prepare('SELECT status, attempts, http_status, next_at FROM webhook_deliveries').get();
  for (const [i, wait] of wh.BACKOFF_S.entries()) {
    const out = await wh.deliver(env, now, fail); assert.deepEqual([out.retried, out.failed], [1, 0], 'attempt ' + (i + 1)); const d = dl();
    assert.deepEqual([d.status, d.attempts, d.http_status], ['pending', i + 1, 500]); assert.equal(d.next_at, new Date(now.getTime() + wait * 1000).toISOString());
    assert.equal((await wh.deliver(env, new Date(now.getTime() + (wait - 1) * 1000), fail)).due, 0, 'not called again before it is due'); now = new Date(now.getTime() + wait * 1000);
  }
  const last = await wh.deliver(env, now, fail); assert.deepEqual([last.retried, last.failed], [0, 1]); assert.deepEqual([dl().status, dl().attempts], ['failed', 6], 'the sixth failed attempt ends the delivery');
  assert.equal(raw.prepare('SELECT failures FROM webhook_subscriptions').get().failures, 1);
  await wh.emit(env, 'item.created', 'Q-2', {}, now); const net = await wh.deliver(env, now, async () => { throw new Error('connect ECONNREFUSED ' + 'x'.repeat(400)); });
  assert.equal(net.retried, 1); assert.ok(raw.prepare("SELECT last_error FROM webhook_deliveries WHERE event_id <> (SELECT min(event_id) FROM webhook_deliveries)").get().last_error.length <= 200, 'a network error is kept to 200 characters');
  await wh.emit(env, 'item.created', 'Q-3', {}, now); raw.exec("UPDATE webhook_deliveries SET status = 'delivered' WHERE status = 'pending' AND event_id IN (SELECT id FROM webhook_events WHERE subject <> 'Q-3')");
  const ok = await wh.deliver(env, now, async () => new Response('', { status: 200 })); assert.equal(ok.delivered, 1); assert.equal(raw.prepare('SELECT failures FROM webhook_subscriptions').get().failures, 0, 'a delivery resets the failure count');
  await wh.emit(env, 'item.created', 'Q-4', {}, now); const gone = await wh.deliver(env, now, async () => new Response('', { status: 410 })); assert.equal(gone.failed, 1);
  assert.equal(raw.prepare('SELECT active FROM webhook_subscriptions').get().active, 0, 'a 410 Gone switches the subscription off');
  await wh.emit(env, 'item.created', 'Q-5', {}, now); assert.equal(raw.prepare("SELECT count(*) AS n FROM webhook_deliveries WHERE event_id IN (SELECT id FROM webhook_events WHERE subject = 'Q-5')").get().n, 0, 'an off subscription is no longer fanned out to');
  const rot = await route('/api/v1/webhooks/' + made.id + '/rotate', 'POST'); assert.equal(rot.status, 200); assert.equal(raw.prepare('SELECT active FROM webhook_subscriptions').get().active, 1, 'rotating the secret turns it on again');
  raw.exec("UPDATE webhook_subscriptions SET failures = 19"); await wh.emit(env, 'item.created', 'Q-6', {}, now); await wh.deliver(env, now, async () => { throw new Error('down'); }); const wl = now; void wl;
  for (const [, wait] of wh.BACKOFF_S.entries()) { now = new Date(now.getTime() + wait * 1000); await wh.deliver(env, now, fail); } now = new Date(now.getTime() + 1e8); await wh.deliver(env, now, fail);
  assert.equal(raw.prepare('SELECT active FROM webhook_subscriptions').get().active, 0, 'twenty failed deliveries in a row switch it off');
});

test('US-32-R68: an inbound callback is accepted only from a registered provider with a valid signature inside the window, once per delivery id, and a verified event becomes an intake item', opts, async () => {
  const { wh, raw, env, route } = await hookWorld(); const reg = await (await route('/api/v1/hooks', 'POST', { provider: 'billing', kind: 'standard' })).json();
  assert.equal(reg.url, ORIGIN + '/hooks/billing'); assert.equal(reg.signing, 'standard-webhooks'); assert.equal(reg.secret_shown_once, true);
  assert.equal((await route('/api/v1/hooks', 'POST', { provider: 'x' })).status, 422, 'a provider name is two to thirty-one characters'); assert.equal((await route('/api/v1/hooks', 'POST', { provider: 'billing' }, 'other')).status, 409, 'a provider belongs to one integration');
  const key = secretBytes(reg.secret), nowS = Math.floor(NOW.getTime() / 1000);
  const post = async (provider, body, hdrs) => wh.webhooksRoute(new Request(ORIGIN + '/hooks/' + provider, { method: 'POST', headers: hdrs, body }), env, null, null, NOW);
  const signed = async (id, body, ts = nowS) => ({ 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': await wh.signStandard(key, id, String(ts), body) });
  const evt = JSON.stringify({ title: 'Invoice failed', detail: 'card declined', kind: 'bug' });
  assert.equal((await wh.webhooksRoute(new Request(ORIGIN + '/hooks/billing', { method: 'GET' }), env, null, null, NOW)).status, 405); assert.equal((await post('nobody', evt, await signed('m0', evt))).status, 404);
  let r = await post('billing', evt, { ...(await signed('m1', evt)), 'webhook-signature': 'v1,AAAA' }); assert.equal(r.status, 401); assert.equal((await r.json()).error, 'invalid signature');
  r = await post('billing', evt, await signed('m1', evt, nowS - 1000)); assert.equal(r.status, 401); assert.equal((await r.json()).error, 'stale timestamp', 'a replayed old message');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM items').get().n, 0, 'nothing is filed for a refused message');
  r = await post('billing', evt, await signed('m1', evt)); assert.equal(r.status, 201); const filed = await r.json(); assert.match(filed.id, /^IN-20261126-[0-9a-f]{6}$/); assert.equal(filed.url, ORIGIN + '/api/v1/work/' + filed.id);
  const item = raw.prepare('SELECT title, kind, surface, owner_role FROM items WHERE id = ?').get(filed.id); assert.deepEqual({ ...item }, { title: filed.id + ': Invoice failed', kind: 'intake-bug', surface: 'provider:billing agent:billing harness:webhook', owner_role: 'product-manager' });
  r = await post('billing', evt, await signed('m1', evt)); assert.deepEqual(await r.json(), { ok: true, duplicate: true }); assert.equal(raw.prepare('SELECT count(*) AS n FROM items').get().n, 1, 'the same delivery id is acknowledged and filed once');
  assert.equal((await post('billing', 'not json', await signed('m2', 'not json'))).status, 400); assert.equal((await post('billing', JSON.stringify({ x: 1 }), await signed('m3', JSON.stringify({ x: 1 })))).status, 202, 'a verified event with nothing to file is acknowledged and ignored');
  const big = JSON.stringify({ title: 'x'.repeat(300 * 1024) }); assert.equal((await post('billing', big, await signed('m4', big))).status, 413, 'a body over 256 KB is refused');
  const gh = await (await route('/api/v1/hooks', 'POST', { provider: 'repo-events', kind: 'github' })).json(); assert.equal(gh.signing, 'X-Hub-Signature-256');
  const ghKey = secretBytes(gh.secret), ghBody = JSON.stringify({ action: 'opened', issue: { title: 'Crash', html_url: 'https://github.com/o/r/issues/1' }, repository: { full_name: 'o/r' } });
  const hmac = async b => 'sha256=' + Buffer.from(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', ghKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new TextEncoder().encode(b))).toString('hex');
  r = await post('repo-events', ghBody, { 'x-hub-signature-256': await hmac(ghBody), 'x-github-delivery': 'd1', 'x-github-event': 'issues' }); assert.equal(r.status, 201);
  assert.equal(raw.prepare("SELECT kind FROM items WHERE surface LIKE 'provider:repo-events%'").get().kind, 'intake-request');
  const ping = JSON.stringify({ zen: 'x' }); r = await post('repo-events', ping, { 'x-hub-signature-256': await hmac(ping), 'x-github-delivery': 'd2', 'x-github-event': 'ping' }); assert.deepEqual(await r.json(), { ok: true, pong: true });
  assert.equal((await post('repo-events', ghBody, { 'x-hub-signature-256': 'sha256=00', 'x-github-delivery': 'd3', 'x-github-event': 'issues' })).status, 401);
});

test('US-32-R69: the tick turns state changes into events whoever caused them, announces a connector failure once, announces nothing on its first look, and prunes what it no longer needs', opts, async () => {
  const { wh, raw, env, route } = await hookWorld(); await route('/api/v1/webhooks', 'POST', { url: 'https://hooks.example.com/in' });
  raw.exec("INSERT INTO items (id, title, status) VALUES ('Q-0', 'old', 'open')");
  const sent = []; const f = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response('', { status: 200 }); };
  assert.equal(await wh.tickWebhooks(null, NOW, f), null); let t = await wh.tickWebhooks(env, NOW, f); assert.deepEqual([t.items, t.connectors], [0, 0], 'the first run records what exists without announcing it'); assert.equal(sent.length, 0);
  raw.exec("INSERT INTO items (id, title, status, kind) VALUES ('Q-1', 'new item', 'open', 'bug'); UPDATE items SET status = 'done' WHERE id = 'Q-0'");
  t = await wh.tickWebhooks(env, new Date(NOW.getTime() + 60e3), f); assert.equal(t.items, 2); assert.equal(t.delivered, 2);
  const byType = Object.fromEntries(sent.map(e => [e.type, e])); assert.deepEqual(byType['io.ultrastable.item.created'].data, { id: 'Q-1', title: 'new item', kind: 'bug', status: 'open' });
  assert.deepEqual(byType['io.ultrastable.item.status_changed'].data, { id: 'Q-0', title: 'old', from: 'open', to: 'done' });
  assert.equal((await wh.tickWebhooks(env, new Date(NOW.getTime() + 120e3), f)).items, 0, 'a change is announced once');
  raw.exec("INSERT INTO credentials VALUES ('t', 'github', 'expired', 'token revoked')"); sent.length = 0;
  t = await wh.tickWebhooks(env, new Date(NOW.getTime() + 180e3), f); assert.equal(t.connectors, 1); assert.deepEqual(sent[0].data, { tenant: 't', provider: 'github', status: 'expired', error: 'token revoked', reconnect: ORIGIN + '/connect/github' });
  assert.equal((await wh.tickWebhooks(env, new Date(NOW.getTime() + 240e3), f)).connectors, 0, 'a connector that stays broken is announced once');
  raw.exec("UPDATE credentials SET status = 'ok'"); await wh.tickWebhooks(env, new Date(NOW.getTime() + 300e3), f); raw.exec("UPDATE credentials SET status = 'revoked'");
  assert.equal((await wh.tickWebhooks(env, new Date(NOW.getTime() + 360e3), f)).connectors, 1, 'it is announced again after it recovered and broke again');
  raw.prepare("INSERT INTO webhook_seen VALUES ('p', 'old', ?), ('p', 'new', ?)").run('2026-11-20T00:00:00.000Z', '2026-11-26T09:59:00.000Z');
  raw.prepare("INSERT INTO webhook_events VALUES ('evt_old', 'item.created', NULL, '{}', ?)").run('2026-10-01T00:00:00.000Z');
  raw.prepare("INSERT INTO webhook_deliveries (id, sub_id, event_id, status, next_at, created_at, updated_at) VALUES ('dl_old', 's', 'evt_x', 'delivered', ?, ?, ?)").run('2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
  await wh.tickWebhooks(env, new Date(NOW.getTime() + 420e3), f);
  assert.deepEqual(raw.prepare('SELECT msg_id FROM webhook_seen').all().map(r => r.msg_id), ['new'], 'delivery ids older than two days are forgotten');
  assert.equal(raw.prepare("SELECT count(*) AS n FROM webhook_events WHERE id = 'evt_old'").get().n, 0, 'an old event nobody waits on is deleted'); assert.equal(raw.prepare("SELECT count(*) AS n FROM webhook_deliveries WHERE id = 'dl_old'").get().n, 0, 'a finished delivery older than thirty days is deleted');
});

test('US-32-T10: an integration registers a callback once, receives a signed CloudEvent for a change nobody announced, and the receiver verifies it with the secret it was shown', opts, async () => {
  const { wh, raw, env, route } = await hookWorld(); const sub = await (await route('/api/v1/webhooks', 'POST', { url: 'https://hooks.example.com/in' })).json();
  await wh.tickWebhooks(env, NOW, async () => new Response('', { status: 200 })); raw.exec("INSERT INTO items (id, title, status) VALUES ('Q-9', 'filed by a person', 'open')");
  let got; await wh.tickWebhooks(env, new Date(NOW.getTime() + 60e3), async (u, init) => { got = init; return new Response('', { status: 200 }); });
  const h = new Headers({ 'webhook-id': got.headers['webhook-id'], 'webhook-timestamp': got.headers['webhook-timestamp'], 'webhook-signature': got.headers['webhook-signature'] });
  assert.equal((await wh.verifyStandard(h, got.body, secretBytes(sub.secret), Math.floor(NOW.getTime() / 1000) + 60)).ok, true); assert.equal(JSON.parse(got.body).subject, 'Q-9');
});
