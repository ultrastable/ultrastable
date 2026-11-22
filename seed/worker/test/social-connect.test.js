// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { newKey } from '../src/auth/seal.js';
import { handleAuth } from '../src/auth/routes.js';
import * as store from '../src/auth/store.js';
import { runSocial, verifyRelay } from '../src/social.js';
import { dpopProof, newDpopKey } from '../src/auth/atproto.js';

const ORIGIN = 'https://seed.example.com', NOW = Date.parse('2026-11-17T12:00:00Z');
const mk = () => ({ DB: makeDb(), CREDENTIAL_KEY: newKey() });
const get = (env, path, f) => handleAuth(new Request(ORIGIN + path), env, { tenant: 't', fetch: f, now: NOW });
const post = (env, path, f) => handleAuth(new Request(ORIGIN + path, { method: 'POST' }), env, { tenant: 't', fetch: f, now: NOW });
const J = (o, status = 200, h = {}) => ({ ok: status < 300, status, json: async () => o, headers: new Headers(h) });
const NF = J({}, 404);

test('Mastodon: one click, app registered programmatically, PKCE redirect, token sealed, no token prompt', async () => {
  const env = mk(), seen = { app: null, token: null };
  const f = async (u, init = {}) => {
    u = String(u);
    if (u === 'https://mastodon.social/api/v1/apps') { seen.app = JSON.parse(init.body); return J({ client_id: 'cid', client_secret: 'csec' }); }
    if (u === 'https://mastodon.social/oauth/token') { seen.token = Object.fromEntries(new URLSearchParams(init.body)); return J({ access_token: 'mast-at', token_type: 'Bearer' }); }
    return NF;
  };
  const page = await (await get(env, '/connect/mastodon', f)).text();
  assert.match(page, /Continue with mastodon\.social/); assert.doesNotMatch(page, /token|password|secret/i);
  const r = await get(env, '/connect/mastodon/start', f);
  assert.equal(r.status, 302); const loc = new URL(r.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://mastodon.social/oauth/authorize');
  assert.equal(seen.app.redirect_uris, ORIGIN + '/connect/mastodon/callback');
  const cb = await get(env, '/connect/mastodon/callback?code=abc&state=' + encodeURIComponent(loc.searchParams.get('state')), f);
  assert.equal(cb.status, 200); assert.equal(seen.token.client_secret, 'csec'); assert.ok(seen.token.code_verifier);
  const m = await store.material(env.DB, env, 't', 'oauth:mastodon');
  assert.equal(m.access, 'mast-at'); assert.equal(m.status, 'ok');
  const again = await get(env, '/connect/mastodon/callback?code=abc&state=' + encodeURIComponent(loc.searchParams.get('state')), f);
  assert.equal(again.status, 502, 'the one-time approval cannot be replayed');
});

test('Mastodon refuses a private address', async () => {
  const r = await get(mk(), '/connect/mastodon/start?instance=nodots', async (u) => String(u).endsWith('/api/v1/apps') ? J({ client_id: 'c', client_secret: 's' }) : NF);
  assert.equal(r.status, 302); assert.equal(new URL(r.headers.get('location')).hostname, 'mastodon.social'); // an invalid host falls back to the default, never reaching a private one
});

test('Bluesky: atproto OAuth with PAR, PKCE and DPoP; account bound to its issuer; sealed', async () => {
  const env = mk(), did = 'did:plc:abc123', seen = {};
  const f = async (u, init = {}) => {
    u = String(u); const h = new Headers(init.headers || {});
    if (u === 'https://bsky.social/.well-known/oauth-authorization-server') return J({ issuer: 'https://bsky.social', authorization_endpoint: 'https://bsky.social/oauth/authorize', token_endpoint: 'https://bsky.social/oauth/token', pushed_authorization_request_endpoint: 'https://bsky.social/oauth/par' });
    if (u === 'https://bsky.social/oauth/par') {
      if (!h.get('dpop')) return NF;
      if (!seen.par) { seen.par = 1; return J({ error: 'use_dpop_nonce' }, 400, { 'dpop-nonce': 'n1' }); }  // nonce dance
      seen.parBody = Object.fromEntries(new URLSearchParams(init.body)); return J({ request_uri: 'urn:par:1', expires_in: 60 }, 201, { 'dpop-nonce': 'n2' });
    }
    if (u === 'https://bsky.social/oauth/token') { seen.tok = Object.fromEntries(new URLSearchParams(init.body)); return J({ access_token: 'at1', refresh_token: 'rt1', sub: did, expires_in: 1800, token_type: 'DPoP' }); }
    if (u === 'https://plc.directory/' + did) return J({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example.net' }] });
    if (u === 'https://pds.example.net/.well-known/oauth-protected-resource') return J({ authorization_servers: ['https://bsky.social'] });
    return NF;
  };
  const legacy = await (await handleAuth(new Request(ORIGIN + '/.well-known/oauth-client/bluesky.json'), env, { tenant: 't', fetch: f })).json();
  assert.equal(legacy.token_endpoint_auth_method, 'none', 'LEGACY-CLIENT-1: sessions issued to the public client keep refreshing'); assert.equal(legacy.client_id, ORIGIN + '/.well-known/oauth-client/bluesky.json');
  const meta = await handleAuth(new Request(ORIGIN + '/.well-known/oauth-client/bluesky-c.json'), env, { tenant: 't', fetch: f });
  const md = await meta.json(); assert.equal(md.dpop_bound_access_tokens, true); assert.equal(md.redirect_uris[0], ORIGIN + '/connect/bluesky/callback'); assert.equal(md.client_id, ORIGIN + '/.well-known/oauth-client/bluesky-c.json'); assert.equal(md.token_endpoint_auth_method, 'private_key_jwt', 'a confidential client: its refresh tokens last 180 days, a public one 2 weeks'); assert.equal(md.jwks_uri, ORIGIN + '/.well-known/oauth-client/bluesky-jwks.json');
  const ks = await (await handleAuth(new Request(md.jwks_uri), env, { tenant: 't', fetch: f })).json(); assert.equal(ks.keys.length, 1); assert.equal(ks.keys[0].d, undefined, 'only the public half is served');
  const r = await get(env, '/connect/bluesky/start', f); assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location')); assert.equal(loc.searchParams.get('request_uri'), 'urn:par:1');
  assert.ok(seen.parBody.code_challenge && seen.parBody.state && seen.parBody.scope.includes('atproto'));
  const cb = await get(env, '/connect/bluesky/callback?code=c&iss=https%3A%2F%2Fbsky.social&state=' + encodeURIComponent(seen.parBody.state), f);
  assert.equal(cb.status, 200); assert.equal(seen.tok.grant_type, 'authorization_code'); assert.ok(seen.tok.code_verifier);
  const m = await store.material(env.DB, env, 't', 'oauth:bluesky');
  assert.equal(m.meta.did, did); assert.equal(m.meta.pds, 'https://pds.example.net'); assert.equal(m.secret.refresh_token, 'rt1'); assert.ok(m.secret.dpop_jwk.d);
});

test('Bluesky rejects a callback from another issuer and an account not bound to the issuer', async () => {
  const env = mk();
  const f = async (u) => { u = String(u);
    if (u.endsWith('/.well-known/oauth-authorization-server')) return J({ issuer: 'https://bsky.social', authorization_endpoint: 'https://bsky.social/oauth/authorize', token_endpoint: 'https://bsky.social/oauth/token', pushed_authorization_request_endpoint: 'https://bsky.social/oauth/par' });
    if (u.endsWith('/oauth/par')) return J({ request_uri: 'urn:p' }, 201);
    if (u.endsWith('/oauth/token')) return J({ access_token: 'a', sub: 'did:plc:x' });
    if (u.startsWith('https://plc.directory/')) return J({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.evil.net' }] });
    if (u.endsWith('/oauth-protected-resource')) return J({ authorization_servers: ['https://evil.net'] });
    return NF; };
  let st; { const r = await get(env, '/connect/bluesky/start', f); assert.equal(r.status, 302); const rows = await env.DB.prepare('SELECT 1').all(); st = null; }
  // recover the state by re-running start and reading it from the PAR body is not possible here; use a fresh state through the module path
  const { makeConnectorState } = await import('../src/auth/state.js');
  const cur = await store.material(env.DB, env, 't', 'oauth:bluesky');
  const state = await makeConnectorState(env, 't', 'oauth:bluesky', cur.secret.pending.nonce, NOW);
  assert.equal((await get(env, '/connect/bluesky/callback?code=c&iss=https%3A%2F%2Fevil.net&state=' + encodeURIComponent(state), f)).status, 502);
  assert.equal((await get(env, '/connect/bluesky/callback?code=c&iss=https%3A%2F%2Fbsky.social&state=' + encodeURIComponent(state), f)).status, 502);
});

test('DPoP proof carries the method, url without query, the access token hash and the nonce', async () => {
  const jwk = await newDpopKey(), p = await dpopProof(jwk, { htm: 'POST', htu: 'https://x.test/a?b=1', nonce: 'nn', access: 'tok' });
  const body = JSON.parse(atob(p.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  assert.equal(body.htm, 'POST'); assert.equal(body.htu, 'https://x.test/a'); assert.equal(body.nonce, 'nn'); assert.ok(body.ath && body.jti);
});

test('/connect index lists every channel with one button, no token prompt', async () => {
  const env = mk(); await store.ensureSchema(env.DB);
  await store.put(env.DB, env, 't', 'github-app', { secret: { pem: 'x' }, meta: {}, status: 'ok' });
  const page = await (await get(env, '/connect', async () => NF)).text();
  assert.match(page, /Connect Bluesky/); assert.match(page, /Connect Mastodon/); assert.doesNotMatch(page, /paste|password/i);
});

test('publisher: nothing linked means no network call; linked Mastodon posts the due event once within caps', async () => {
  const env = mk(); let calls = 0; const seen = [];
  const gate = { kill: false, mode: 'live', max_posts_per_day: 2, max_posts_per_week: 7, paused_channels: [] };
  const cal = { posts: [{ id: 'old', date: '2026-11-10', text: 'evergreen', kind: 'x' }, { id: 'ev:1', date: '2026-11-17', text: 'Shipped by the system itself: a thing.', kind: 'event', arm: 'shipped' }] };
  const f = async (u, init = {}) => { calls++; u = String(u);
    if (u.endsWith('/gate.json')) return J(gate); if (u.endsWith('/calendar.json')) return J(cal);
    if (u === 'https://mastodon.social/api/v1/statuses') { seen.push(JSON.parse(init.body).status); return J({ url: 'https://mastodon.social/@u/1' }); }
    if (u === 'https://mastodon.social/api/v1/statuses/1') return J({ id: '1' });
    return NF; };
  assert.deepEqual(await runSocial({ db: env.DB, env, fetch: f, now: NOW, tenant: 't' }), { skipped: 'no channel connected' }); assert.equal(calls, 0);
  await store.put(env.DB, env, 't', 'oauth:mastodon', { secret: {}, meta: { instance: 'mastodon.social' }, access: 'tok', status: 'ok' });
  const r = await runSocial({ db: env.DB, env, fetch: f, now: NOW, tenant: 't' });
  assert.equal(r.id, 'ev:1'); assert.equal(r.results.mastodon, 'verified', 'posted only once the public URL reads back');
  const r2 = await runSocial({ db: env.DB, env, fetch: f, now: NOW + 3600e3, tenant: 't' });
  assert.equal(seen[0], 'Shipped by the system itself: a thing.', 'events go first'); assert.equal(r2.id, 'old', 'the next due item goes out, the posted one never repeats');
  const r3 = await runSocial({ db: env.DB, env, fetch: f, now: NOW + 7200e3, tenant: 't' }); assert.equal(r3.skipped, 'rate limit', JSON.stringify(r3));
});

// CONNECT-ONCE-1, DPOP-REFRESH-1, NO-EXPIRY-1 (2026-11-20): one sign-in lasts. Each test is a failure read from the live credential rows.
test('a Bluesky refresh carries a DPoP proof from the stored key, follows the nonce, and keeps the rotated refresh token', async () => {
  const { refreshDue } = await import('../src/auth/index.js');
  const env = mk(), jwk = await newDpopKey(), calls = [], { newClientKey } = await import('../src/auth/atproto.js'), ck = await newClientKey();
  await store.put(env.DB, env, 't', 'oauth:atproto-test', { secret: { dpop_jwk: jwk, client_jwk: ck, nonce: 'old', refresh_token: 'r1' }, meta: { kind: 'oauth', provider: 'atproto-test', issuer: 'https://bsky.social', token_url: 'https://bsky.social/oauth/token', client_id: 'cid' }, access: 'a1', expiresAt: NOW - 1000, status: 'ok' });
  const f = async (u, init = {}) => {
    calls.push(init.headers.DPoP ? JSON.parse(Buffer.from(init.headers.DPoP.split('.')[1], 'base64url').toString()) : null);
    if (calls.length === 1) return J({ error: 'use_dpop_nonce' }, 401, { 'dpop-nonce': 'fresh' });
    assert.equal(new URLSearchParams(init.body).get('refresh_token'), 'r1');
    assert.ok(new URLSearchParams(init.body).get('client_assertion'), 'a confidential client signs its refresh');
    return J({ access_token: 'a2', refresh_token: 'r2', expires_in: 1800 }, 200, { 'dpop-nonce': 'fresh' });
  };
  const out = await refreshDue(env.DB, env, { fetch: f, now: NOW });
  assert.equal(out[0].action, 'renewed');
  assert.ok(calls[0] && calls[0].htm === 'POST', 'the refresh is signed'); assert.equal(calls[1].nonce, 'fresh');
  const m = await store.material(env.DB, env, 't', 'oauth:atproto-test');
  assert.equal(m.access, 'a2'); assert.equal(m.secret.refresh_token, 'r2'); assert.equal(m.secret.nonce, 'fresh'); assert.ok(m.secret.dpop_jwk);
});

test('a connected token with no expiry stays connected across ticks, and a sign-in under way is left alone', async () => {
  const { refreshDue } = await import('../src/auth/index.js');
  const env = mk(), f = async () => { throw new Error('no network call is expected'); };
  await store.put(env.DB, env, 't', 'oauth:noexp-test', { secret: { client_secret: 's' }, meta: { kind: 'oauth', provider: 'noexp-test', instance: 'mastodon.social', token_url: 'https://mastodon.social/oauth/token', client_id: 'cid' }, access: 'mast-at', status: 'ok' });
  await store.put(env.DB, env, 't', 'oauth:atproto-test', { secret: { pending: { nonce: 'n', verifier: 'v', at: NOW } }, meta: { kind: 'oauth', provider: 'atproto-test' }, status: 'pending' });
  const out = await refreshDue(env.DB, env, { fetch: f, now: NOW + 3600e3 });
  assert.deepEqual(out.map(o => o.action).sort(), ['awaiting-consent', 'fresh']);
  assert.equal((await store.material(env.DB, env, 't', 'oauth:noexp-test')).status, 'ok');
  assert.equal((await store.material(env.DB, env, 't', 'oauth:atproto-test')).status, 'pending');
});

test('a start that arrives twice continues the same sign-in, and a working connection is never started again', async () => {
  const env = mk(); let apps = 0;
  const f = async (u, init = {}) => {
    u = String(u);
    if (u === 'https://mastodon.social/api/v1/apps') { apps++; return J({ client_id: 'cid' + apps, client_secret: 'csec' + apps }); }
    if (u === 'https://mastodon.social/oauth/token') return J({ access_token: 'mast-at' });
    return NF;
  };
  const a = new URL((await get(env, '/connect/mastodon/start', f)).headers.get('location'));
  const b = new URL((await get(env, '/connect/mastodon/start', f)).headers.get('location'));
  assert.equal(apps, 1, 'the second start registers nothing'); assert.equal(b.searchParams.get('client_id'), 'cid1');
  assert.equal(b.searchParams.get('code_challenge'), a.searchParams.get('code_challenge'));
  const cb = await get(env, '/connect/mastodon/callback?code=abc&state=' + encodeURIComponent(a.searchParams.get('state')), f);
  assert.equal(cb.status, 200, 'the approval from the first start still completes');
  const again = await get(env, '/connect/mastodon/start', f);
  assert.equal(again.status, 200); assert.match(await again.text(), /is connected/); assert.equal(apps, 1);
  const bad = await get(env, '/connect/bluesky/callback?code=x&state=nope', f);
  assert.equal(bad.status, 502);
  const ev = (await env.DB.prepare("SELECT detail FROM credential_events WHERE provider='oauth:bluesky' AND event='failed'").all()).results;
  assert.match(ev[0].detail, /^callback: /, 'a refused callback leaves a record');
});

import { priority } from '../src/social.js';
test('SOCIAL-TENANTS-1: meta-story first, tenant changes, tenant backlog, then platform events', () => {
  const o = [{ arm: 'shipped', kind: 'event' }, { arm: 'ps-solution', kind: 'backlog' }, { arm: 'ps-problem', kind: 'event' }, { arm: 'meta-story' }, { arm: 'proof' }].sort((a, b) => priority(a) - priority(b)).map(p => p.arm);
  assert.deepEqual(o, ['meta-story', 'ps-problem', 'ps-solution', 'shipped', 'proof']);
});

// THOUGHT-1: white papers go to LinkedIn as well; other posts never do. Bluesky links are clickable. A failed send waits a day.
test('THOUGHT-1: a paper post reaches LinkedIn with its own long text; an event never goes to LinkedIn; failures back off a day', async () => {
  const { liEscape, liVersions, linkFacets } = await import('../src/social.js');
  assert.equal(liEscape('a (b) @c #d_e'), 'a \\(b\\) \\@c \\#d\\_e');
  assert.deepEqual(liVersions(NOW, null), ['202610', '202609', '202608', '202607']);
  assert.deepEqual(linkFacets('é https://u.io/x y')[0].index, { byteStart: 3, byteEnd: 17 });
  const env = mk(); const sent = [];
  const gate = { kill: false, mode: 'live', max_posts_per_day: 5, max_posts_per_week: 20, paused_channels: [] };
  const cal = { posts: [
    { id: 'ev:1', date: '2026-11-17', text: 'Shipped by the system itself: a thing.', kind: 'event', arm: 'shipped' },
    { id: 'paper:x:1of2:2026-11-17', date: '2026-11-17', kind: 'paper', arm: 'paper', text: 'A short paper summary. https://ultrastable.io/research/x', url: 'https://ultrastable.io/research/x',
      texts: { mastodon: 'Medium text.', linkedin: 'Long (text) for LinkedIn.' }, channels: ['bluesky', 'mastodon', 'linkedin'] }] };
  let liFail = false, versions = [];
  const f = async (u, init = {}) => { u = String(u);
    if (u.endsWith('/gate.json')) return J(gate); if (u.endsWith('/calendar.json')) return J(cal);
    if (u === 'https://mastodon.social/api/v1/statuses') { sent.push(['mastodon', JSON.parse(init.body).status]); return J({ url: 'm' }); }
    if (u === 'https://api.linkedin.com/v2/userinfo') return J({ sub: 'abc' });
    if (u === 'https://api.linkedin.com/rest/posts') { versions.push(init.headers['linkedin-version']); if (liFail) return J({}, 500); if (versions.length === 1) return J({}, 426); const b = JSON.parse(init.body); sent.push(['linkedin', b.commentary, b.author, b.content.article.source]); return J({}, 201, { 'x-restli-id': 'urn:li:share:1' }); }
    return NF; };
  await store.put(env.DB, env, 't', 'oauth:mastodon', { secret: {}, meta: { instance: 'mastodon.social' }, access: 'tok', status: 'ok' });
  await store.put(env.DB, env, 't', 'oauth:linkedin', { secret: {}, meta: {}, access: 'li', expiresAt: NOW + 864e5 * 30, status: 'ok' });
  const r1 = await runSocial({ db: env.DB, env, fetch: f, now: NOW, tenant: 't' });
  assert.equal(r1.id, 'paper:x:1of2:2026-11-17', 'a paper goes before events');
  assert.deepEqual(r1.results, { mastodon: 'unverified', linkedin: 'unverified' }, 'POST-READBACK-1: sent but not read back');
  assert.deepEqual(sent[0], ['mastodon', 'Medium text.']);
  assert.deepEqual(sent[1], ['linkedin', 'Long \\(text\\) for LinkedIn.', 'urn:li:person:abc', 'https://ultrastable.io/research/x']);
  assert.deepEqual(versions, ['202610', '202609'], 'a month LinkedIn does not serve falls back to the previous one');
  const r2 = await runSocial({ db: env.DB, env, fetch: f, now: NOW + 3600e3, tenant: 't' });
  assert.equal(r2.id, 'ev:1'); assert.deepEqual(Object.keys(r2.results), ['mastodon'], 'an event is never sent to LinkedIn');
  // a paper not yet on LinkedIn is retried at most once a day
  const env2 = mk(); liFail = true; versions = [];
  await store.put(env2.DB, env2, 't', 'oauth:linkedin', { secret: {}, meta: { sub: 'abc' }, access: 'li', expiresAt: NOW + 864e5 * 30, status: 'ok' });
  const a = await runSocial({ db: env2.DB, env: env2, fetch: f, now: NOW, tenant: 't' });
  assert.match(a.results.linkedin, /failed: linkedin HTTP 500/);
  assert.equal((await runSocial({ db: env2.DB, env: env2, fetch: f, now: NOW + 3600e3, tenant: 't' })).skipped, 'nothing due');
  liFail = false;
  const c = await runSocial({ db: env2.DB, env: env2, fetch: f, now: NOW + 25 * 3600e3, tenant: 't' }); assert.equal(c.results && c.results.linkedin, 'unverified', JSON.stringify(c));
  // an expired LinkedIn token is not a channel
  const env3 = mk(); await store.put(env3.DB, env3, 't', 'oauth:linkedin', { secret: {}, meta: {}, access: 'li', expiresAt: NOW - 1, status: 'ok' });
  assert.deepEqual(await runSocial({ db: env3.DB, env: env3, fetch: f, now: NOW, tenant: 't' }), { skipped: 'no channel connected' });
});

test('SOCIAL-BUFFER-1: every connected Buffer channel gets the post; X is cut to 280, LinkedIn queued', async () => {
  const { postBuffer } = await import('../src/social.js'); const sent = [];
  const f = async (u, init) => { const q = JSON.parse(init.body).query;
    if (q.includes('organizations')) return J({ data: { account: { organizations: [{ id: 'o1' }] } } });
    if (q.includes('channels(')) return J({ data: { channels: [{ id: 'l', service: 'linkedin' }, { id: 'x', service: 'twitter' }, { id: 'd', service: 'facebook', isDisconnected: true }] } });
    sent.push(q); return J({ data: { createPost: { post: { id: 'p' + sent.length, status: 'x' } } } }); };
  const r = await postBuffer('tok', 'L'.repeat(900), f, 'S'.repeat(400));
  assert.deepEqual(Object.keys(r), ['linkedin', 'twitter']); assert.match(sent[0], /addToQueue/); assert.match(sent[1], /shareNow/); assert.ok(!sent[1].includes('S'.repeat(281)));
});

// POST-READBACK-1 (2026-11-21): the relay said scheduled/sent/no-channel and the old code stored "posted" for all of it; the owner saw X only.
test('relay results are recorded as read back, queued, unverified or failed, never as posted', async () => {
  const { classifyRelay } = await import('../src/social.js');
  const f = async u => String(u).endsWith('/api/v1/statuses/9') ? J({ id: '9' }) : NF;
  const r = await classifyRelay({ mastodon: { status: 'ok', url: 'https://mstdn.science/@Q/9' }, linkedin: { status: 'scheduled', id: 'a' }, substack: { status: 'scheduled', id: 'b' }, twitter: { status: 'sent', id: 'c' }, facebook: { status: 'no-channel' }, instagram: { status: 'error', error: 'x' } }, f);
  assert.deepEqual(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.status])), { mastodon: 'verified', linkedin: 'queued', substack: 'queued', twitter: 'unverified', facebook: 'failed', instagram: 'failed' });
  const g = async () => NF; assert.equal((await classifyRelay({ mastodon: { status: 'ok', url: 'https://mstdn.science/@Q/9' } }, g)).mastodon.status, 'unverified');
});

test('per-service relay rows override a legacy relay row, so a failed service is retried', async () => {
  const env = mk(); const gate = { kill: false, mode: 'live', max_posts_per_day: 3, max_posts_per_week: 14, paused_channels: [] };
  const cal = { posts: [{ id: 'p1', date: '2026-11-17', text: 'Hello there.', kind: 'event', arm: 'x' }] }; const sent = [];
  const f = async (u, init = {}) => { u = String(u); if (u.endsWith('/gate.json')) return J(gate); if (u.endsWith('/calendar.json')) return J(cal);
    if (u === 'https://relay.test/relay/post') { sent.push(JSON.parse(init.body).channels); return J({ results: { linkedin: { status: 'sent', id: 'z' } } }); } return NF; };
  env.SOCIAL_RELAY_URL = 'https://relay.test'; env.SOCIAL_RELAY_TOKEN = 't';
  await store.ensureSchema(env.DB); await runSocial({ db: env.DB, env, fetch: async () => NF, now: NOW, tenant: 't' }).catch(() => 0);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS social_posted (id TEXT NOT NULL, channel TEXT NOT NULL, at TEXT NOT NULL, ref TEXT, arm TEXT, status TEXT, attempts INTEGER DEFAULT 1, PRIMARY KEY (id, channel))").run();
  await env.DB.prepare("INSERT OR REPLACE INTO social_posted (id, channel, at, ref) VALUES ('p1','relay','2026-11-17T00:00:00Z','{}')").run();
  await env.DB.prepare("INSERT OR REPLACE INTO social_posted (id, channel, at, ref, status, attempts) VALUES ('p1','relay:linkedin','2026-11-17T00:00:00Z','queued','failed',1)").run();
  const r = await runSocial({ db: env.DB, env, fetch: f, now: NOW + 864e5 * 5, tenant: 't' });
  assert.deepEqual(sent, [['linkedin']], JSON.stringify(r));
});

test('verifyRelay reads Buffer back: sent with a link is verified, still-queued stays queued, an error is failed', async () => {
  const env = mk(); env.SOCIAL_RELAY_URL = 'https://relay.test'; env.SOCIAL_RELAY_TOKEN = 't';
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS social_posted (id TEXT NOT NULL, channel TEXT NOT NULL, at TEXT NOT NULL, ref TEXT, arm TEXT, status TEXT, attempts INTEGER DEFAULT 1, PRIMARY KEY (id, channel))").run();
  const ins = (c, ref, st) => env.DB.prepare("INSERT INTO social_posted (id, channel, at, ref, status, attempts) VALUES ('p1',?,'2026-11-17T00:00:00Z',?,?,1)").bind(c, ref, st).run();
  const A = 'a'.repeat(24), B = 'b'.repeat(24), C = 'c'.repeat(24);
  await ins('relay:linkedin', A, 'unverified'); await ins('relay:substack', B, 'unverified'); await ins('relay:twitter', C, 'unverified');
  const f = async (u, init) => { assert.equal(String(u), 'https://relay.test/relay/status'); assert.deepEqual(JSON.parse(init.body).ids, [A, B, C]);
    return J({ posts: { [A]: { status: 'sent', externalLink: 'https://linkedin.com/x' }, [B]: { status: 'scheduled' }, [C]: { status: 'error' } } }); };
  await verifyRelay(env.DB, env, f, NOW);
  const rows = (await env.DB.prepare("SELECT channel, status, ref FROM social_posted ORDER BY channel").all()).results;
  assert.deepEqual(rows.map(r => r.status), ['verified', 'unverified', 'failed']);
  assert.match(rows[0].ref, /linkedin\.com\/x/);
});
