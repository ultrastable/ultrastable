import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { newKey } from '../src/auth/seal.js';
import { handleAuth } from '../src/auth/routes.js';
import { getToken } from '../src/auth/index.js';
import { discoverMcp, connectorStatus, safeUrl, pkce } from '../src/auth/connectors.js';
import * as store from '../src/auth/store.js';

const ORIGIN = 'https://seed.example.com';
const NOW = Date.parse('2026-11-14T12:00:00Z');
const mk = (extra = {}) => ({ DB: makeDb(), CREDENTIAL_KEY: newKey(), ...extra });
const get = (env, path, f, opts = {}) => handleAuth(new Request(ORIGIN + path), env, { tenant: 't', fetch: f, now: NOW, ...opts });
const post = (env, path, f) => handleAuth(new Request(ORIGIN + path, { method: 'POST' }), env, { tenant: 't', fetch: f });
const J = o => ({ ok: true, status: 200, json: async () => o, headers: new Headers() });
const NF = { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };

// A fake provider speaking plain OAuth 2.1 with PKCE; records what it saw.
function fakeProvider() {
  const seen = { token: [], revoke: [] };
  const f = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith('/token')) { seen.token.push(Object.fromEntries(new URLSearchParams(init.body))); return J({ access_token: 'at-' + seen.token.length, refresh_token: 'rt-1', expires_in: 3600 }); }
    if (u.endsWith('/revoke')) { seen.revoke.push(Object.fromEntries(new URLSearchParams(init.body))); return J({}); }
    return NF;
  };
  return { f, seen };
}

test('a registered provider with no app says so plainly: no owner card, no provider console, no token prompt', async () => {
  const env = mk(); const r = await get(env, '/connect/google');
  const t = await r.text(); assert.match(t, /not available yet/); assert.doesNotMatch(t, /paste|oauth-apps|console\.cloud|register/i);
  const s = await (await get(env, '/auth/connectors')).json();
  const g = s.available.find(a => a.id === 'google'); assert.equal(g.ready, false); assert.match(g.needs, /provider-app-registration/);
  assert.equal(s.available.find(a => a.id === 'mcp').ready, true);
});

test('Google flow: consent, PKCE redirect with signed state, callback exchange, sealed tokens, refresh, revoke', async () => {
  const env = mk({ OAUTH_GOOGLE_CLIENT_ID: 'gid', OAUTH_GOOGLE_CLIENT_SECRET: 'gsec' }); const { f, seen } = fakeProvider();
  assert.match(await (await get(env, '/connect/google')).text(), /Authorize on Google/);
  const st = await get(env, '/connect/google/start'); assert.equal(st.status, 302);
  const loc = new URL(st.headers.get('location')); assert.equal(loc.host, 'accounts.google.com');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256'); assert.equal(loc.searchParams.get('client_id'), 'gid');
  assert.equal(loc.searchParams.get('redirect_uri'), ORIGIN + '/connect/google/callback'); assert.equal(loc.searchParams.get('access_type'), 'offline');
  const state = loc.searchParams.get('state');
  assert.match(await (await get(env, '/connect/google/callback?code=c&state=forged.sig', f)).text(), /expired/);
  const cb = await get(env, '/connect/google/callback?code=abc&state=' + encodeURIComponent(state), f);
  assert.match(await cb.text(), /Google connected/);
  assert.equal(seen.token[0].grant_type, 'authorization_code'); assert.equal(seen.token[0].code, 'abc'); assert.ok(seen.token[0].code_verifier.length >= 43);
  const row = await store.get(env.DB, 't', 'oauth:google'); assert.equal(row.status, 'ok'); assert.ok(!row.sealed.includes('rt-1'), 'refresh token is sealed');
  assert.match(await (await get(env, '/connect/google/callback?code=abc&state=' + encodeURIComponent(state), f)).text(), /already used/);
  assert.equal((await getToken(env.DB, env, 't', 'oauth:google', { fetch: f, now: NOW + 60e3 })).cached, true);
  const later = await getToken(env.DB, env, 't', 'oauth:google', { fetch: f, now: NOW + 55 * 60e3 });
  assert.equal(later.ok, true); assert.equal(seen.token.at(-1).grant_type, 'refresh_token');
  const stat = await connectorStatus(env.DB, env, 't'); assert.equal(stat.linked[0].provider, 'oauth:google'); assert.ok(!JSON.stringify(stat).includes('rt-1'));
  assert.equal((await handleAuth(new Request(ORIGIN + '/connect/google/disconnect'), env, { tenant: 't', fetch: f })).status, 405);
  assert.match(await (await post(env, '/connect/google/disconnect', f)).text(), /revoked/); assert.equal(seen.revoke[0].token, 'rt-1');
  assert.equal(await store.get(env.DB, 't', 'oauth:google'), null);
});

// A fake remote MCP server whose authorization server supports CIMD, or only DCR.
function fakeMcp({ cimd }) {
  const reg = [];
  const f = async (url, init = {}) => {
    const u = String(url), h = new Headers();
    if (u === 'http://mcp.test/mcp' && init.method === 'POST') { h.set('www-authenticate', 'Bearer resource_metadata="http://mcp.test/.well-known/oauth-protected-resource/mcp"'); return { ok: false, status: 401, headers: h, json: async () => ({}) }; }
    if (u === 'http://mcp.test/.well-known/oauth-protected-resource/mcp') return J({ resource: 'http://mcp.test/mcp', authorization_servers: ['http://auth.test'], scopes_supported: ['mcp'] });
    if (u === 'http://auth.test/.well-known/oauth-authorization-server') return J({ issuer: 'http://auth.test', authorization_endpoint: 'http://auth.test/authorize', token_endpoint: 'http://auth.test/token', code_challenge_methods_supported: ['S256'], ...(cimd ? { client_id_metadata_document_supported: true } : { registration_endpoint: 'http://auth.test/register' }) });
    if (u === 'http://auth.test/register') { reg.push(JSON.parse(init.body)); return J({ client_id: 'dcr-client' }); }
    if (u === 'http://auth.test/token') { reg.push(Object.fromEntries(new URLSearchParams(init.body))); return J({ access_token: 'mcp-at', refresh_token: 'mcp-rt', expires_in: 600 }); }
    return NF;
  };
  return { f, reg };
}

async function mcpFlow(cimd) {
  const env = mk(), { f, reg } = fakeMcp({ cimd }), opts = { allowInsecure: true }, server = encodeURIComponent('http://mcp.test/mcp');
  assert.match(await (await get(env, '/connect/mcp?server=' + server, f, opts)).text(), /mcp\.test/);
  const st = await get(env, '/connect/mcp/start?server=' + server, f, opts); assert.equal(st.status, 302, await st.clone().text());
  const loc = new URL(st.headers.get('location'));
  assert.equal(loc.searchParams.get('client_id'), cimd ? ORIGIN + '/.well-known/oauth-client/ultrastable.json' : 'dcr-client');
  assert.equal(loc.searchParams.get('resource'), 'http://mcp.test/mcp'); assert.equal(loc.searchParams.get('scope'), 'mcp');
  if (!cimd) assert.equal(reg[0].token_endpoint_auth_method, 'none');
  const cb = await get(env, '/connect/mcp/callback?code=z&state=' + encodeURIComponent(loc.searchParams.get('state')), f, opts);
  assert.match(await cb.text(), /connected/); assert.equal(reg.at(-1).resource, 'http://mcp.test/mcp');
  assert.equal((await store.get(env.DB, 't', 'oauth:mcp:mcp.test')).status, 'ok');
  const tk = await getToken(env.DB, env, 't', 'oauth:mcp:mcp.test', { fetch: f, now: NOW + 3600e3 });
  assert.equal(tk.ok, true); assert.equal(reg.at(-1).grant_type, 'refresh_token'); assert.equal(reg.at(-1).resource, 'http://mcp.test/mcp');
}
test('remote MCP server links with no pasted token and no owner app (CIMD)', () => mcpFlow(true));
test('remote MCP server links with no pasted token and no owner app (DCR)', () => mcpFlow(false));

test('our Client ID Metadata Document is served and matches the callback', async () => {
  const d = await (await get(mk(), '/.well-known/oauth-client/ultrastable.json')).json();
  assert.equal(d.client_id, ORIGIN + '/.well-known/oauth-client/ultrastable.json'); assert.deepEqual(d.redirect_uris, [ORIGIN + '/connect/mcp/callback']); assert.equal(d.token_endpoint_auth_method, 'none');
});

test('SSRF guard refuses private and non-https servers; no CIMD and no DCR is reported, not guessed', async () => {
  for (const u of ['http://example.com/mcp', 'https://localhost/mcp', 'https://10.0.0.1/mcp', 'https://[::1]/mcp', 'https://intranet/mcp', 'https://u:p@example.com/mcp']) assert.equal(safeUrl(u), null, u); // server-side only: SSRF guard, loopback is rejected, never a host
  assert.ok(safeUrl('https://example.com/mcp'));
  assert.equal((await discoverMcp('https://127.0.0.1/mcp', { fetch: async () => { throw new Error('must not fetch'); } })).ok, false);
  const meta = pk => async u => String(u).includes('oauth-authorization-server') ? J({ authorization_endpoint: 'https://a.example.com/a', token_endpoint: 'https://a.example.com/t', code_challenge_methods_supported: pk }) : NF;
  assert.match((await discoverMcp('https://a.example.com/mcp', { fetch: meta(['plain']) })).error, /S256/);
  const r = await get(mk(), '/connect/mcp/start?server=' + encodeURIComponent('https://a.example.com/mcp'), meta(['S256']));
  assert.match(await r.text(), /neither client metadata documents nor dynamic registration/);
});

test('PKCE challenge is the S256 of the verifier', async () => {
  const { verifier, challenge } = await pkce();
  assert.equal(challenge, Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url'));
});

test('CONNECTIONS-1: one screen lists what is linked, offers one-click connect and disconnect, never asks for a token', async () => {
  const env = mk(); await store.ensureSchema(env.DB);
  let t = await (await get(env, '/connections')).text();
  assert.match(t, /Nothing is linked yet/); assert.match(t, /Connect any MCP server/); assert.match(t, /waiting for its one-time app registration/); assert.doesNotMatch(t, /paste|token/i);
  const e2 = mk({ OAUTH_GOOGLE_CLIENT_ID: 'gid', OAUTH_GOOGLE_CLIENT_SECRET: 'gsec' }); await store.ensureSchema(e2.DB);
  t = await (await get(e2, '/connections')).text(); assert.match(t, /href="\/connect\/google"/);
});

// CONNECT-BROKER-1: a system with no app of its own borrows the platform's app and callback; the person only signs in.
test('brokered Google flow: system start -> platform broker -> Google -> platform callback -> system callback -> token via platform; the app secret never leaves the platform', async () => {
  const PLAT = 'https://ultrastable.example', SYS = 'https://acme.ultrastable.example';
  const plat = mk({ OAUTH_GOOGLE_CLIENT_ID: 'gid', OAUTH_GOOGLE_CLIENT_SECRET: 'gsec' }), sys = mk({ CONNECT_BROKER: PLAT });
  const { f: google, seen } = fakeProvider();
  const P = (path, init) => handleAuth(new Request(PLAT + path, init), plat, { tenant: 'core', fetch: google, now: NOW });
  const viaPlat = async (url, init = {}) => { const r = await P(String(url).slice(PLAT.length), { method: init.method, body: init.body, headers: init.headers }); return { ok: r.ok, status: r.status, json: () => r.json(), headers: r.headers }; };
  const S = path => handleAuth(new Request(SYS + path), sys, { tenant: 't', fetch: viaPlat, now: NOW });
  assert.match(await (await S('/connect/google')).text(), /Authorize on Google/);
  assert.equal((await (await S('/auth/connectors')).json()).available.find(a => a.id === 'google').ready, true);
  const s1 = new URL((await S('/connect/google/start')).headers.get('location'));
  assert.equal(s1.origin + s1.pathname, PLAT + '/connect/google/broker'); assert.equal(s1.searchParams.get('return'), SYS);
  const b1 = new URL((await P(s1.pathname + s1.search)).headers.get('location'));
  assert.equal(b1.host, 'accounts.google.com'); assert.equal(b1.searchParams.get('client_id'), 'gid'); assert.equal(b1.searchParams.get('redirect_uri'), PLAT + '/connect/google/callback');
  assert.equal(b1.searchParams.get('code_challenge'), s1.searchParams.get('code_challenge'));
  const c1 = new URL((await P('/connect/google/callback?code=abc&state=' + encodeURIComponent(b1.searchParams.get('state')))).headers.get('location'));
  assert.equal(c1.origin + c1.pathname, SYS + '/connect/google/callback'); assert.equal(c1.searchParams.get('code'), 'abc'); assert.equal(c1.searchParams.get('state'), s1.searchParams.get('state'));
  assert.match(await (await S(c1.pathname + c1.search)).text(), /Google connected/);
  assert.equal(seen.token[0].client_secret, 'gsec'); assert.equal(seen.token[0].redirect_uri, PLAT + '/connect/google/callback'); assert.ok(seen.token[0].code_verifier.length >= 43);
  const m = await store.material(sys.DB, sys, 't', 'oauth:google'); assert.equal(m.secret.client_secret, undefined); assert.equal(m.secret.refresh_token, 'rt-1');
  const later = await getToken(sys.DB, sys, 't', 'oauth:google', { fetch: viaPlat, now: NOW + 55 * 60e3 }); assert.equal(later.ok, true);
  assert.equal(seen.token.at(-1).grant_type, 'refresh_token'); assert.equal(seen.token.at(-1).client_id, 'gid');
});

test('the broker is default deny: unknown return origins, a missing challenge and other grants are refused', async () => {
  const PLAT = 'https://ultrastable.example', plat = mk({ OAUTH_GOOGLE_CLIENT_ID: 'gid', OAUTH_GOOGLE_CLIENT_SECRET: 'gsec' });
  const P = (path, init) => handleAuth(new Request(PLAT + path, init), plat, { tenant: 'core', fetch: async () => NF, now: NOW });
  const ok = 'https://acme.ultrastable.example';
  for (const ret of ['https://evil.example', 'https://ultrastable.example.evil.com', 'https://evilultrastable.example', 'http://acme.ultrastable.example', ok + '/x'])
    assert.match(await (await P('/connect/google/broker?state=s&code_challenge=c&return=' + encodeURIComponent(ret))).text(), /does not recognize/, ret);
  assert.match(await (await P('/connect/google/broker?state=s&return=' + encodeURIComponent(ok))).text(), /does not recognize/);
  assert.equal((await P('/connect/google/broker?state=s&code_challenge=c&return=' + encodeURIComponent(ok))).status, 302);
  plat.CONNECT_BROKER_ORIGINS = 'https://club.example.org';
  assert.equal((await P('/connect/google/broker?state=s&code_challenge=c&return=' + encodeURIComponent('https://club.example.org'))).status, 302);
  assert.equal((await P('/connect/google/token')).status, 405);
  const bad = await P('/connect/google/token', { method: 'POST', body: 'grant_type=client_credentials' }); assert.equal(bad.status, 400); assert.equal((await bad.json()).code, 'unsupported_grant_type');
  const none = await handleAuth(new Request(PLAT + '/connect/google/token', { method: 'POST', body: 'grant_type=refresh_token' }), mk(), { tenant: 'core' }); assert.equal(none.status, 503);
});
