// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-30 (owner actions and credentials: one link, no pasted secrets), the requirements that live in the seed's credential layer and consent
// flows (seed/worker/src/auth/*.js, seed/worker/src/appaudit.js, seed/worker/src/errors.js and the connector_health step of the tick). Each test
// names the requirement it proves, so the conformance manifest can attach it (US-00-R03). The clock is injected, the network is a fake, and no real
// account, token or key is used: keys are generated for the test and thrown away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeDb } from './d1shim.js';
import { newKey, seal, open } from '../src/auth/seal.js';
import * as store from '../src/auth/store.js';
import { getToken, refreshDue, probe, ownerActs, canonicalPath, pathGuard, SCOPE_ALLOWLIST, MARGIN_MS, DEAD_RETRY_MS, isDead } from '../src/auth/index.js';
import { githubApp, appJwt, pkcs1ToPkcs8 } from '../src/auth/github-app.js';
import { oauth } from '../src/auth/oauth.js';
import { cloudflare } from '../src/auth/cloudflare.js';
import { handleAuth, manifest, uniqueName, makeState, checkState } from '../src/auth/routes.js';
import { consentScreen, failScreen, doneScreen } from '../src/auth/consent.js';
import { safeUrl, discoverMcp, pkce, cimdDocument } from '../src/auth/connectors.js';
import { newDpopKey } from '../src/auth/atproto.js';
import { checkRepoAccess } from '../src/auth/access.js';
import { archiveRetired, archiveDue, RETIRED } from '../src/auth/archive.js';
import { auditApps } from '../src/appaudit.js';
import { STEPS, reconnectLink } from '../src/tick.js';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const ORIGIN = 'https://seed.example.com';
const mk = (extra = {}) => ({ DB: makeDb(), CREDENTIAL_KEY: newKey(), ...extra });
const J = (o, status = 200, h = {}) => ({ ok: status < 300, status, json: async () => o, headers: new Headers(h) });
const NF = J({}, 404);
const toPem = (der, label) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----`;
async function appKey() {
  const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', k.privateKey));
  return { k, pkcs8, pkcs1: pkcs8.slice(26) };  // a 2048-bit PKCS#8 header is 26 bytes
}
const get = (env, path, f, opts = {}) => handleAuth(new Request(ORIGIN + path, opts.init), env, { tenant: 't', fetch: f, now: NOW, ...opts });
const events = (db, provider) => db.raw.prepare('SELECT event, detail FROM credential_events WHERE provider = ? ORDER BY id').all(provider);
const ctxOf = (env = {}) => ({ nowIso: new Date(NOW).toISOString(), env, config: { org_slug: 't' }, notes: [] });
const cards = db => db.raw.prepare("SELECT * FROM gate_cards WHERE id LIKE 'GATE-RECONNECT-%' ORDER BY id").all();

// ---- 4.1 The owner act ----------------------------------------------------------------------------------------------------------------------

test('US-30-R01 and US-30-R04: two failed refreshes in a row raise one reconnect gate with a default in effect, one link and a closing probe; one failure raises none', async () => {
  const db = makeDb(); await store.ensureSchema(db);
  const env = { PUBLIC_ORIGIN: 'https://example.test/' };
  db.raw.exec(`INSERT INTO credentials (tenant, provider, status, expires_at, last_error) VALUES ('t','oauth:google','ok','2026-11-26T18:00:00Z',NULL), ('t','github-admin','failed',NULL,'installation token HTTP 404');
    INSERT INTO credential_events (at, tenant, provider, event) VALUES ('2026-11-26T11:00:00Z','t','oauth:google','refreshed'), ('2026-11-26T09:00:00Z','t','github-admin','minted'), ('2026-11-26T11:00:00Z','t','github-admin','failed');`);
  let c = ctxOf(env); await STEPS.connector_health(db, c);
  assert.deepEqual(c.connectors.find(x => x.provider === 'oauth:google'), { provider: 'oauth:google', status: 'ok', last_ok: '2026-11-26T11:00:00Z', expires_at: '2026-11-26T18:00:00Z', expires_in_h: 6, failures: 0 });
  const adm = c.connectors.find(x => x.provider === 'github-admin');
  assert.equal(adm.failures, 1); assert.equal(adm.last_ok, '2026-11-26T09:00:00Z'); assert.equal(adm.expires_at, null); assert.equal(adm.expires_in_h, null);
  assert.equal(cards(db).length, 0, 'one failed refresh is not an owner act');
  db.raw.exec("INSERT INTO credential_events (at, tenant, provider, event) VALUES ('2026-11-26T11:30:00Z','t','github-admin','failed')");
  await STEPS.connector_health(db, ctxOf(env)); await STEPS.connector_health(db, ctxOf(env));
  const [g] = cards(db);
  assert.equal(cards(db).length, 1, 'one card however many ticks see the failure');
  assert.equal(g.id, 'GATE-RECONNECT-github-admin'); assert.equal(g.status, 'open'); assert.equal(g.closing_probe, 'connector:github-admin');
  assert.equal(g.prepared_by_fleet, 'https://example.test/connect/github');
  assert.match(g.what, /Reconnect github-admin: one click on the consent link/);
  assert.match(g.why_gated, /^Identity-bound: the last 2 silent refresh attempts failed \(installation token HTTP 404\)/);
  assert.match(g.default_in_effect, /every other loop keeps running/);
});

test('US-30-R04: a closed reconnect card is reopened with the new link when the connector fails twice again, and a connector that recovered reads zero failures', async () => {
  const db = makeDb(); await store.ensureSchema(db);
  db.raw.exec(`INSERT INTO credentials (tenant, provider, status) VALUES ('t','github-app','failed');
    INSERT INTO credential_events (tenant, provider, event) VALUES ('t','github-app','failed'), ('t','github-app','failed');`);
  await STEPS.connector_health(db, ctxOf({ PUBLIC_ORIGIN: 'https://a.test' }));
  assert.equal(cards(db)[0].prepared_by_fleet, 'https://a.test/connect/github');
  db.raw.exec("UPDATE gate_cards SET status = 'closed', closed_at = '2026-11-26 10:00:00'; INSERT INTO credential_events (tenant, provider, event) VALUES ('t','github-app','refreshed');");
  const ok = ctxOf({ PUBLIC_ORIGIN: 'https://a.test' }); await STEPS.connector_health(db, ok);
  assert.equal(ok.connectors[0].failures, 0, 'a newer good event ends the count'); assert.equal(cards(db)[0].status, 'closed');
  db.raw.exec("INSERT INTO credential_events (tenant, provider, event) VALUES ('t','github-app','failed'), ('t','github-app','failed')");
  await STEPS.connector_health(db, ctxOf({ PUBLIC_ORIGIN: 'https://b.test' }));
  const g = cards(db); assert.equal(g.length, 1); assert.equal(g[0].status, 'open'); assert.equal(g[0].closed_at, null); assert.equal(g[0].prepared_by_fleet, 'https://b.test/connect/github');
});

// The reconnect link of an oauth: provider is the requirement of section 4.1 that nothing meets yet (section 7 of the specification): this test is its closing
// probe and stays a todo until seed/worker/src/tick.js `reconnectLink` strips the `oauth:` prefix the credential rows carry. It deliberately names no requirement id.
test('a reconnect card for an oauth: provider links to that provider\'s own consent page (closing probe of the PLANNED part of the spec)', () => {
  assert.equal(reconnectLink({ env: { PUBLIC_ORIGIN: 'https://x.test' } }, 'oauth:google'), 'https://x.test/connect/google');
  assert.equal(reconnectLink({ env: { PUBLIC_ORIGIN: 'https://x.test' } }, 'oauth:bluesky'), 'https://x.test/connect/bluesky');
});

test('an owner act for a remote MCP server links to its consent page with the server address (closing probe of the PLANNED part of the specification)', async () => {
  const db = mk().DB; await store.ensureSchema(db);
  db.raw.prepare("INSERT INTO credentials (tenant, provider, status, last_error, meta) VALUES ('t', 'oauth:mcp:ex.com', 'failed', 'refresh HTTP 401', ?)").run(JSON.stringify({ kind: 'mcp', server: 'https://ex.com/mcp' }));
  assert.equal((await ownerActs(db))[0].connect, '/connect/mcp?server=' + encodeURIComponent('https://ex.com/mcp'));
});

// The generic connector callback records an event for a provider's refusal and a failed token exchange but not for a bad or expired state or a replayed
// approval (seed/worker/src/auth/connectors.js, the callback section); only the Mastodon and Bluesky callbacks (social.js `refused`) record those. This is the
// closing probe of the PLANNED part of the specification and stays a todo until the generic callback records both. It deliberately names no requirement id.
test('the generic connector callback records a failed event for a bad state and for a replayed approval (closing probe of the PLANNED part of the specification)', { todo: 'connectors.js returns failScreen for a bad state and a replay with no store.event' }, async () => {
  const env = mk({ OAUTH_GOOGLE_CLIENT_ID: 'gid', OAUTH_GOOGLE_CLIENT_SECRET: 'gsec' });
  const f = async u => String(u) === 'https://oauth2.googleapis.com/token' ? J({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) : NF;
  const loc = new URL((await get(env, '/connect/google/start', f)).headers.get('location')), state = loc.searchParams.get('state');
  const before = events(env.DB, 'oauth:google').length;
  await get(env, '/connect/google/callback?code=c&state=' + encodeURIComponent(state.slice(0, -3) + 'aaa'), f);
  assert.equal(events(env.DB, 'oauth:google').length, before + 1, 'a bad state is recorded');
  await get(env, '/connect/google/callback?code=c&state=' + encodeURIComponent(state), f);
  const n = events(env.DB, 'oauth:google').length;
  await get(env, '/connect/google/callback?code=c&state=' + encodeURIComponent(state), f);
  assert.equal(events(env.DB, 'oauth:google').length, n + 1, 'a replayed approval is recorded');
});

test('US-30-R05: the reconnect link of the two GitHub providers is the one GitHub consent page, under the public origin without a trailing slash', () => {
  for (const p of ['github-app', 'github-admin']) assert.equal(reconnectLink({ env: { PUBLIC_ORIGIN: 'https://x.test/' } }, p), 'https://x.test/connect/github');
});

test('US-30-R07: a gate with a connector probe closes when the provider is ok everywhere and stays open while any of its rows is not; an env probe closes when the name is bound', async () => {
  const db = makeDb(); await store.ensureSchema(db);
  db.raw.exec(`INSERT INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe) VALUES
      ('GATE-RECONNECT-github-app','w','y','d','l','connector:github-app'), ('GATE-ENV','w','y','d','l','env:SOME_BINDING'), ('GATE-MANUAL','w','y','d','l','manual');
    INSERT INTO credentials (tenant, provider, status) VALUES ('t','github-app','ok'), ('u','github-app','failed');`);
  const status = id => db.raw.prepare('SELECT status FROM gate_cards WHERE id = ?').get(id).status;
  await STEPS.probe_gates(db, ctxOf({}));
  assert.deepEqual(['GATE-RECONNECT-github-app', 'GATE-ENV', 'GATE-MANUAL'].map(status), ['open', 'open', 'open']);
  db.raw.exec("UPDATE credentials SET status = 'ok' WHERE tenant = 'u'");
  const c = ctxOf({ SOME_BINDING: 'x' }); await STEPS.probe_gates(db, c);
  assert.deepEqual(['GATE-RECONNECT-github-app', 'GATE-ENV', 'GATE-MANUAL'].map(status), ['closed', 'closed', 'open'], 'a manual probe is never closed by the tick');
  assert.equal(c.openGates, 1);
});

test('US-30-R08: the live owner acts are the sign-ins a provider refused or never completed, each with one link and no secret', async () => {
  const db = mk().DB; await store.ensureSchema(db);
  const rows = [['oauth:google', 'failed', 'refresh HTTP 401 invalid_grant'], ['oauth:mastodon', 'failed', 'no refresh token (consent has not completed)'], ['github-admin', 'failed', 'refresh HTTP 400'],
    ['oauth:buffer', 'failed', 'refresh HTTP 500'], ['github-app', 'failed', 'installation token HTTP 404'], ['oauth:linkedin', 'ok', null]];
  for (const [p, s, e] of rows) db.raw.prepare("INSERT INTO credentials (tenant, provider, status, last_error, sealed) VALUES ('t', ?, ?, ?, 'SEALED-SECRET')").run(p, s, e);
  const acts = await ownerActs(db);
  assert.deepEqual(acts.map(a => [a.id, a.connect]), [['signin:oauth:google', '/connect/google'], ['signin:oauth:mastodon', '/connect/mastodon/start?instance=mstdn.science'], ['signin:github-admin', '/connect/github']]);
  assert.equal(JSON.stringify(acts).includes('SEALED-SECRET'), false);
  for (const a of acts) assert.deepEqual(Object.keys(a).sort(), ['connect', 'id', 'provider', 'reason', 'since', 'tenant']);
  assert.equal(isDead({ status: 'failed', last_error: 'refresh HTTP 500' }), false, 'a provider outage heals by retrying and is not an act');
  assert.equal(isDead({ status: 'ok', last_error: 'refresh HTTP 401' }), false);
});

// ---- 4.3 The credential layer ---------------------------------------------------------------------------------------------------------------

test('US-30-R19: material is sealed with AES-GCM under a key the deploy generated; a fresh IV per seal, a tamper or a wrong key never opens, and an unbound key is a plain error', async () => {
  const env = { CREDENTIAL_KEY: newKey() }, obj = { refresh_token: 'rt-secret-value' };
  const a = await seal(env, obj), b = await seal(env, obj);
  assert.notEqual(a, b, 'a fresh random IV per seal');
  assert.ok(!a.includes('rt-secret-value')); assert.match(a, /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.deepEqual(await open(env, a), obj); assert.equal(await open(env, null), null);
  const [iv, ct] = a.split('.'); const flipped = ct.slice(0, -4) + (ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  await assert.rejects(open(env, iv + '.' + flipped));
  await assert.rejects(open({ CREDENTIAL_KEY: newKey() }, a));
  await assert.rejects(seal({}, obj), /CREDENTIAL_KEY is not bound/);
  assert.equal(Buffer.from(newKey(), 'base64').length, 32);
});

test('US-30-R20: the store brings its own tables up on a database that has none, merges metadata, keeps what a write does not name, and cuts an event detail to 300 characters', async () => {
  const db = makeDb(), env = { CREDENTIAL_KEY: newKey() };
  db.raw.exec('DROP TABLE credentials; DROP TABLE credential_events;');
  await store.ensureSchema(db); await store.ensureSchema(db);  // idempotent
  await store.put(db, env, 't', 'p', { secret: { a: 1 }, meta: { x: 1 }, access: 'tok', expiresAt: NOW + 3600e3 });
  await store.put(db, env, 't', 'p', { meta: { y: 2 }, status: 'pending' });
  const m = await store.material(db, env, 't', 'p');
  assert.deepEqual(m.secret, { a: 1 }); assert.deepEqual(m.meta, { x: 1, y: 2 }); assert.equal(m.access, 'tok'); assert.equal(m.expiresAt, '2026-11-26T13:00:00Z'); assert.equal(m.status, 'pending');
  const row = await store.get(db, 't', 'p'); assert.ok(!row.sealed.includes('"a"') && !row.access_sealed.includes('tok'), 'sealed at rest');
  await store.put(db, env, 't', 'p', { access: null });
  assert.equal((await store.material(db, env, 't', 'p')).access, null);
  await store.event(db, 't', 'p', 'note', 'x'.repeat(500));
  assert.equal(db.raw.prepare("SELECT detail FROM credential_events WHERE event = 'note'").get().detail.length, 300);
  assert.equal(await store.material(db, env, 't', 'none'), null);
});

test('US-30-R21: a token is minted from the stored key, served from the row until ten minutes before expiry, then minted again; a refusal is recorded and returned, never hidden', async () => {
  const db = makeDb(), env = { CREDENTIAL_KEY: newKey() }, { pkcs1 } = await appKey();
  await store.put(db, env, 't', 'github-app', { secret: { pem: toPem(pkcs1, 'RSA PRIVATE KEY') }, meta: { app_id: 7, installation_id: 9 }, status: 'pending' });
  let n = 0, status = 201; const f = async () => { n++; return { status, json: async () => ({ token: 'tok-' + n, expires_at: new Date(NOW + 3600e3).toISOString() }) }; };
  assert.equal((await getToken(db, env, 't', 'github-app', { fetch: f, now: NOW })).token, 'tok-1');
  assert.deepEqual(await getToken(db, env, 't', 'github-app', { fetch: f, now: NOW + 60e3 }), { ok: true, token: 'tok-1', cached: true, memo: true });
  assert.equal(n, 1);
  assert.equal(MARGIN_MS, 600e3);
  const again = await getToken(db, env, 't', 'github-app', { fetch: f, now: NOW + 3600e3 - MARGIN_MS + 1 });
  assert.equal(again.token, 'tok-2'); assert.equal(again.cached, false);
  assert.deepEqual(events(db, 'github-app').map(e => e.event), ['minted', 'refreshed']);
  status = 500;
  const bad = await getToken(db, env, 't', 'github-app', { fetch: f, now: NOW + 7200e3 });
  assert.deepEqual([bad.ok, bad.error], [false, 'installation token HTTP 500']);
  const row = await store.get(db, 't', 'github-app'); assert.equal(row.status, 'failed'); assert.equal(row.last_error, 'installation token HTTP 500');
  assert.equal(events(db, 'github-app').pop().event, 'failed');
  assert.deepEqual(await getToken(db, env, 't', 'no-such-provider'), { ok: false, error: 'unknown provider no-such-provider' });
});

test('US-30-R21: a service binding is its own credential: present it mints no token, absent it is a recorded failure', async () => {
  const db = makeDb(), env = { CREDENTIAL_KEY: newKey(), SVC: { fetch: async () => new Response('ok') } };
  await store.put(db, env, 't', 'cloudflare', { meta: { binding: 'SVC' }, status: 'pending' });
  assert.deepEqual(await getToken(db, env, 't', 'cloudflare', {}), { ok: true, token: null, cached: false });
  await store.put(db, env, 't', 'cloudflare:other', { meta: { binding: 'GONE' }, status: 'pending' });
  const r = await getToken(db, env, 't', 'cloudflare:other', {}); assert.equal(r.ok, false); assert.match(r.error, /service binding GONE is not present/);
  assert.equal((await cloudflare.mint({ meta: {} }, { env })).error, 'service binding (unnamed) is not present');
});

test('US-30-R22: a warm isolate keeps serving its token when the credential store cannot be read, and only until the token expires', async () => {
  const db = makeDb(), env = { CREDENTIAL_KEY: newKey() }, { pkcs1 } = await appKey();
  await store.put(db, env, 't', 'github-app', { secret: { pem: toPem(pkcs1, 'RSA PRIVATE KEY') }, meta: { app_id: 7, installation_id: 9 }, status: 'pending' });
  const f = async () => ({ status: 201, json: async () => ({ token: 'memo-tok', expires_at: new Date(NOW + 3600e3).toISOString() }) });
  await getToken(db, env, 't', 'github-app', { fetch: f, now: NOW });
  db.raw.exec('DROP TABLE credentials');
  const inside = await getToken(db, env, 't', 'github-app', { fetch: f, now: NOW + 3600e3 - 5 * 60e3 });  // inside the margin, before expiry
  assert.equal(inside.ok, true); assert.equal(inside.token, 'memo-tok'); assert.equal(inside.memo, true); assert.match(inside.degraded, /^credential store unreadable/);
  await assert.rejects(getToken(db, env, 't', 'github-app', { fetch: f, now: NOW + 3600e3 + 1 }));
});

test('US-30-R23: a hosted app holds no App key: its host mints a short token for its one repository, a refusal is returned as it is, and the stored credential is never consulted', async () => {
  const db = makeDb(), env = { CREDENTIAL_KEY: newKey(), HOST_TOKEN_URL: 'https://host.example/host/token', HOST_APP_KEY: 'hosted-key', HOST_REPO: 'acme/app' };
  const seen = []; let code = 200;
  const f = async (url, init) => { seen.push([url, init.method, JSON.parse(init.body), init.headers['user-agent']]); return code === 200 ? J({ token: 'host-tok', expires_at: new Date(NOW + 3600e3).toISOString() }) : J({ error: 'not allowed' }, code); };
  const r = await getToken(db, env, 't', 'github-app', { fetch: f, now: NOW });
  assert.deepEqual([r.ok, r.token, r.host], [true, 'host-tok', true]);
  assert.deepEqual(seen[0], ['https://host.example/host/token', 'POST', { repo: 'acme/app', key: 'hosted-key' }, 'ultrastable-hosted-app']);
  assert.equal((await getToken(db, env, 't', 'github-app', { fetch: f, now: NOW + 1000 })).memo, true); assert.equal(seen.length, 1);
  code = 403;
  const refused = await getToken(db, env, 't', 'github-app', { fetch: f, now: NOW + 3600e3 });
  assert.deepEqual([refused.ok, refused.error], [false, 'host token HTTP 403 not allowed']);
  assert.equal(await store.get(db, 't', 'github-app'), null, 'nothing was stored for a hosted app');
});

test('US-30-R24: the GitHub App credential is a short RS256 JWT signed with the stored key, PKCS#1 keys are accepted, and a missing app or installation is a plain failure', async () => {
  const { k, pkcs8, pkcs1 } = await appKey();
  assert.deepEqual([...pkcs1ToPkcs8(pkcs1)], [...pkcs8], 'PKCS#1 is wrapped into the PKCS#8 WebCrypto imports');
  for (const pem of [toPem(pkcs8, 'PRIVATE KEY'), toPem(pkcs1, 'RSA PRIVATE KEY')]) {
    const jwt = await appJwt(7, pem, NOW), [h, p, s] = jwt.split('.');
    const dec = x => JSON.parse(Buffer.from(x, 'base64url').toString());
    assert.deepEqual(dec(h), { alg: 'RS256', typ: 'JWT' });
    assert.deepEqual(dec(p), { iat: Math.floor(NOW / 1000) - 60, exp: Math.floor(NOW / 1000) + 540, iss: '7' });
    assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(h + '.' + p)), true);
  }
  assert.match((await githubApp.mint(null)).error, /not registered/);
  assert.match((await githubApp.mint({ secret: { pem: 'x' }, meta: { app_id: 7 } })).error, /not installed/);
  const calls = [];
  const r = await githubApp.mint({ secret: { pem: toPem(pkcs8, 'PRIVATE KEY') }, meta: { app_id: 7, installation_id: 9 } }, { now: NOW, fetch: async (u, i) => { calls.push([u, i.method]); return { status: 404 }; } });
  assert.deepEqual([r.ok, r.error], [false, 'installation token HTTP 404']);
  assert.deepEqual(calls, [['https://api.github.com/app/installations/9/access_tokens', 'POST']]);
});

test('US-30-R25: the GitHub App manifests request exactly the allowlist and nothing else, the admin app has no webhook, and every visit gets its own name within GitHub\'s limit', () => {
  for (const kind of ['github-app', 'github-admin']) {
    const m = manifest(ORIGIN, 'org', kind);
    assert.deepEqual(m.default_permissions, SCOPE_ALLOWLIST[kind]); assert.ok(Object.isFrozen(SCOPE_ALLOWLIST[kind]));
    assert.equal(m.public, false); assert.equal(m.redirect_url, `${ORIGIN}/auth/${kind === 'github-admin' ? 'github-admin' : 'github'}/callback`);
    assert.equal(m.setup_url, `${ORIGIN}/auth/${kind === 'github-admin' ? 'github-admin' : 'github'}/installed`);
  }
  assert.deepEqual(SCOPE_ALLOWLIST['github-admin'], { administration: 'write', metadata: 'read' });
  assert.equal(manifest(ORIGIN, 'o', 'github-admin').hook_attributes, undefined); assert.equal(manifest(ORIGIN, 'o', 'github-admin').default_events, undefined);
  assert.equal(manifest(ORIGIN, 'o').hook_attributes.url, ORIGIN + '/hook/github');
  assert.ok(!Object.values(SCOPE_ALLOWLIST['github-app']).includes('admin'));
  assert.equal(uniqueName('org', () => 'abc123'), 'org-abc123');
  assert.ok(uniqueName('x'.repeat(60)).length <= 34); assert.notEqual(uniqueName('org'), uniqueName('org'));
});

test('US-30-R26: the OAuth refresh grant carries the client identity, keeps a rotated refresh token, follows a DPoP nonce, and reports a refusal as a short code', async () => {
  const seen = [];
  const f = async (u, init) => { seen.push({ u, body: Object.fromEntries(new URLSearchParams(init.body)), dpop: init.headers.DPoP }); return J({ access_token: 'at', refresh_token: 'rt-2', expires_in: 120 }); };
  const r = await oauth.mint({ secret: { refresh_token: 'rt-1', client_secret: 'cs' }, meta: { client_id: 'cid', token_url: 'https://p.example/token', resource: 'https://mcp.example/' } }, { fetch: f, now: NOW });
  assert.deepEqual([r.ok, r.token, r.rotatedRefresh, r.expiresAt], [true, 'at', 'rt-2', NOW + 120e3]);
  assert.deepEqual(seen[0].body, { grant_type: 'refresh_token', refresh_token: 'rt-1', client_id: 'cid', client_secret: 'cs', resource: 'https://mcp.example/' });
  assert.equal(seen[0].dpop, undefined);
  assert.equal((await oauth.mint({ secret: {}, meta: {} })).error, 'no refresh token (consent has not completed)');
  assert.equal((await oauth.mint({ secret: { refresh_token: 'r' }, meta: { client_id: 'c', token_url: 'https://p.example/t' } }, { fetch: async () => J({ error: 'invalid_grant<script>' }, 401) })).error, 'refresh HTTP 401 invalid_grantscript');
  const jwk = await newDpopKey(); let n = 0; const proofs = [];
  const fd = async (u, init) => { n++; proofs.push(JSON.parse(Buffer.from(init.headers.DPoP.split('.')[1], 'base64url').toString())); return n === 1 ? J({ error: 'use_dpop_nonce' }, 400, { 'dpop-nonce': 'N1' }) : J({ access_token: 'at', expires_in: 60 }, 200, { 'dpop-nonce': 'N2' }); };
  const d = await oauth.mint({ secret: { refresh_token: 'r', dpop_jwk: jwk }, meta: { client_id: 'c', token_url: 'https://p.example/t' } }, { fetch: fd, now: NOW });
  assert.equal(d.ok, true); assert.equal(n, 2); assert.equal(proofs[0].nonce, undefined); assert.equal(proofs[1].nonce, 'N1'); assert.deepEqual(d.secretPatch, { nonce: 'N2' });
});

test('US-30-R27: each tick refreshes only what is due: sign-ins that renew at use, tokens with no expiry and sign-ins under way are left alone, a dead consent backs off for six hours, a due token is renewed', async () => {
  const db = makeDb(), env = { CREDENTIAL_KEY: newKey() };
  const iso = ms => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  const row = (p, s, exp, err, upd) => db.raw.prepare("INSERT INTO credentials (tenant, provider, status, expires_at, last_error, updated_at, meta, sealed) VALUES ('t',?,?,?,?,?,?,NULL)").run(p, s, exp, err, upd, JSON.stringify({ client_id: 'c', token_url: 'https://p.example/token' }));
  row('oauth:bluesky', 'ok', iso(NOW - 1000), null, iso(NOW)); row('oauth:mastodon', 'ok', null, null, iso(NOW));
  row('oauth:notion', 'ok', null, null, iso(NOW)); row('oauth:slack', 'pending', null, null, iso(NOW));
  row('github-app', 'ok', iso(NOW + 3600e3), null, iso(NOW));
  await store.put(db, env, 't', 'oauth:google', { secret: { refresh_token: 'rt' }, meta: { client_id: 'c', token_url: 'https://p.example/token' }, status: 'failed', error: 'refresh HTTP 401' });
  db.raw.prepare("UPDATE credentials SET updated_at = ? WHERE provider = 'oauth:google'").run(iso(NOW - 3600e3));
  let calls = 0; const f = async () => { calls++; return J({ access_token: 'x' }, 401); };
  const out = Object.fromEntries((await refreshDue(db, env, { fetch: f, now: NOW })).map(r => [r.provider, r.action]));
  assert.deepEqual(out, { 'oauth:bluesky': 'at-use', 'oauth:mastodon': 'at-use', 'oauth:notion': 'fresh', 'oauth:slack': 'awaiting-consent', 'github-app': 'fresh', 'oauth:google': 'backoff' });
  assert.equal(calls, 0, 'nothing was fetched');
  assert.equal(DEAD_RETRY_MS, 6 * 3600e3);
  const later = Object.fromEntries((await refreshDue(db, env, { fetch: f, now: NOW + DEAD_RETRY_MS })).map(r => [r.provider, r.action]));
  assert.notEqual(later['oauth:google'], 'backoff'); assert.equal(calls, 1);
});

test('US-30-R28: the credential probe is green only with a GitHub App connected and no failed or expired row, and otherwise points at the consent page', async () => {
  const db = makeDb(), env = { CREDENTIAL_KEY: newKey() };
  assert.deepEqual(await probe(db, NOW), { ok: false, credentials: 0, bad: [], github_connected: false, connect: '/connect/github' });
  await store.put(db, env, 't', 'github-app', { secret: { pem: 'x' }, meta: {}, status: 'ok' });
  assert.deepEqual(await probe(db, NOW), { ok: true, credentials: 1, bad: [], github_connected: true });
  await store.put(db, env, 't', 'oauth:google', { status: 'failed', error: 'refresh HTTP 401' });
  const r = await probe(db, NOW); assert.equal(r.ok, false); assert.deepEqual(r.bad, ['t/oauth:google']);
  await store.put(db, env, 't', 'oauth:google', { status: 'ok', expiresAt: NOW - 1000 });
  assert.deepEqual((await probe(db, NOW)).bad, ['t/oauth:google'], 'an expired row is bad even when its status says ok');
});

test('US-30-R29: a path variant of a route never reaches it as itself: it is folded to the canonical path and redirected with the method kept', () => {
  assert.equal(canonicalPath('/a//b/../c/'), '/a/c'); assert.equal(canonicalPath('/auth%2fconnectors'), '/auth/connectors'); assert.equal(canonicalPath('/auth%252Fconnectors'), '/auth/connectors');
  assert.equal(canonicalPath('/a%5Cb'), '/a/b'); assert.equal(canonicalPath('/x/%2e%2e/auth/connectors'), '/auth/connectors'); assert.equal(canonicalPath(''), '/');
  assert.equal(pathGuard(new Request('https://x.test/auth/connectors?a=1')), null);
  const r = pathGuard(new Request('https://x.test/auth//connectors/?a=1', { method: 'POST' }));
  assert.equal(r.status, 308); assert.equal(r.headers.get('location'), '/auth/connectors?a=1'); assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('US-30-R30: a failure inside an auth route is recorded as a credential event and answered with a retry screen in plain words, never the exception', async () => {
  const env = mk(), state = await makeState(env, 't', NOW);
  const boom = async () => { throw new Error('ECONNRESET at 10.0.0.7:443 secret=abc'); };
  const r = await get(env, '/auth/github/callback?code=c&state=' + encodeURIComponent(state), boom);
  const text = await r.text();
  assert.equal(r.status, 502); assert.match(text, /Something went wrong finishing the connection/); assert.match(text, /href="\/connect\/github"/);
  assert.ok(!/ECONNRESET|10\.0\.0\.7|secret=abc/.test(text));
  const ev = events(env.DB, 'github-app').pop(); assert.equal(ev.event, 'failed'); assert.match(ev.detail, /ECONNRESET/, 'the detail is kept for the owner-only record');
  const dead = await handleAuth(new Request(ORIGIN + '/connect/github'), { DB: undefined, CREDENTIAL_KEY: newKey() }, { tenant: 't' });
  assert.equal(dead.status, 502, 'even a missing database ends in a screen');
  await assert.rejects(store.ensureSchema(undefined), /no database bound/, 'a missing binding is refused up front, so nothing is left running behind the screen');
});

// ---- 4.4 Consent flows ----------------------------------------------------------------------------------------------------------------------

test('US-30-R31: the consent screen says what will happen and goes to the provider\'s own page; it has no field for a token, escapes what it shows, and a failure screen offers a retry', async () => {
  const r = consentScreen({ provider: 'Prov<b>', title: 'Connect <script>x</script>', will: ['Do <i>this</i>'], why: 'Because "why"', action: { method: 'POST', url: '/go?a=1&b=2', fields: { manifest: '{"a":"<x>"}' } }, button: 'Go' });
  const t = await r.text();
  assert.equal(r.status, 200); assert.match(t, /What happens next/); assert.match(t, /<form method="POST" action="\/go\?a=1&amp;b=2">/);
  assert.match(t, /<input type="hidden" name="manifest" value="\{&quot;a&quot;:&quot;&lt;x&gt;&quot;\}">/);
  assert.ok(!/<script>x|<i>this|Prov<b>/.test(t));
  assert.equal((t.match(/<input/g) || []).length, 1, 'the only input is hidden'); assert.ok(!/type="(text|password|email)"/i.test(t));
  assert.match(t, /Nothing to copy, paste or configure/);
  const f = failScreen('Connect X', 'It broke.', '/connect/x'); assert.equal(f.status, 502); assert.match(await f.text(), /href="\/connect\/x">Try again/);
  assert.equal(doneScreen('Done', 'ok').status, 200);
});

test('US-30-R32: the GitHub App is registered through GitHub\'s own manifest flow: one consent click, a signed state that expires in an hour, a sealed app key, then the install page', async () => {
  const env = mk();
  const page = await (await get(env, '/connect/github', null, { repos: ['acme/main'] })).text();
  assert.match(page, /action="https:\/\/github\.com\/organizations\/acme\/settings\/apps\/new\?state=/); assert.match(page, /Authorize on GitHub/);
  const state = await makeState(env, 't', NOW);
  assert.equal(await checkState(env, state, NOW), 't'); assert.equal(await checkState(env, state, NOW + 3600e3 + 1), null);
  assert.equal(await checkState(env, state.slice(0, -2) + 'zz', NOW), null); assert.equal(await checkState(env, 'x.1.y', NOW), null);
  const seen = [];
  const f = async (u, i) => { seen.push([u, i.method]); return { status: 201, json: async () => ({ id: 9, slug: 'org-abc', pem: 'PEM-SECRET', webhook_secret: 'wh', client_id: 'cid', client_secret: 'cs' }) }; };
  const cb = await get(env, '/auth/github/callback?code=the-code&state=' + encodeURIComponent(state), f);
  assert.equal(cb.status, 302); assert.match(cb.headers.get('location'), /^https:\/\/github\.com\/apps\/org-abc\/installations\/new\?state=/);
  assert.deepEqual(seen, [['https://api.github.com/app-manifests/the-code/conversions', 'POST']]);
  const row = await store.get(env.DB, 't', 'github-app'); assert.equal(row.status, 'pending'); assert.ok(!row.sealed.includes('PEM-SECRET'));
  assert.deepEqual((await store.material(env.DB, env, 't', 'github-app')).meta, { app_id: 9, slug: 'org-abc', client_id: 'cid' });
  const expired = await get(env, '/auth/github/callback?code=c&state=' + encodeURIComponent(state), f, { now: NOW + 3600e3 + 5 });
  assert.match(await expired.text(), /That approval link expired/);
  const refused = await get(env, '/auth/github/callback?code=c&state=' + encodeURIComponent(state), async () => ({ status: 422, json: async () => ({}) }));
  assert.equal(refused.status, 502); assert.equal(events(env.DB, 'github-app').pop().detail, 'manifest conversion HTTP 422');
  const noInst = await get(env, '/auth/github/installed?state=' + encodeURIComponent(state), f); assert.equal(noInst.status, 502);
  const inst = await get(env, '/auth/github/installed?installation_id=44&state=' + encodeURIComponent(state), f);
  assert.equal(inst.status, 200); assert.equal((await store.material(env.DB, env, 't', 'github-app')).meta.installation_id, 44);
});

test('US-30-R33: a connect link never registers a second GitHub App: an installed app is kept, even failing, and a registered one is installed, so the manifest form appears only when none is stored', async () => {
  const env = mk(), page = async () => (await get(env, '/connect/github', null)).clone();
  assert.match(await (await page()).text(), /settings\/apps\/new/);
  await store.put(env.DB, env, 't', 'github-app', { secret: { pem: 'k' }, meta: { app_id: 7, slug: 'org-1' }, status: 'pending' });
  const half = await page(); assert.equal(half.status, 302); assert.match(half.headers.get('location'), /^https:\/\/github\.com\/apps\/org-1\/installations\/new\?state=/);
  await store.put(env.DB, env, 't', 'github-app', { meta: { installation_id: 3 }, status: 'ok' });
  assert.match(await (await page()).text(), /Already connected/);
  await store.put(env.DB, env, 't', 'github-app', { status: 'failed', error: 'installation token HTTP 404' });
  const failing = await (await page()).text(); assert.ok(!/settings\/apps\/new/.test(failing)); assert.match(failing, /re-checking the connection by itself/);
  assert.equal(events(env.DB, 'github-app').filter(e => e.event === 'reused').length, 3, 'every reuse is recorded');
  await store.put(env.DB, env, 't', 'github-admin', { secret: { pem: 'k' }, meta: { app_id: 8, slug: 'org-adm', installation_id: 5 }, status: 'pending' });
  assert.match(await (await get(env, '/connect/github-admin', null)).text(), /Already connected/, 'the admin app rests at pending and is still connected');
});

test('US-30-R34: the administration-only app archives the retired repositories once, never touches code, and applies the main ruleset by name with the org\'s own app exempt', async () => {
  const env = mk(), db = env.DB;
  await store.put(db, env, 't', 'github-admin', { secret: { pem: 'x' }, meta: { app_id: 1, installation_id: 2 }, status: 'pending' });
  const calls = []; let st = 200;
  const f = async (u, o = {}) => { calls.push([o.method, u.replace('https://api.github.com', ''), o.body]); return { status: st }; };
  assert.deepEqual([...RETIRED], ['ultrastable/license', 'ultrastable/spec', 'ultrastable/workers']);
  st = 403; const part = await archiveRetired(db, env, 't', { fetch: f, token: 'tok' });
  assert.equal(part.ok, false); assert.equal(calls.length, 3, 'every repository is attempted even when one is refused');
  assert.ok(!events(db, 'github-admin').some(e => e.event === 'archived'));
  assert.equal((await archiveDue(db, env, { fetch: async () => ({ status: 200 }), token: 'tok' }))[0].action, 'archived');
  assert.equal((await archiveDue(db, env, { fetch: f }))[0].action, 'done');
  const { applyRulesets, RULESETS } = await import('../src/auth/rulesets.js');
  await store.put(db, env, 't', 'github-app', { secret: { pem: 'x' }, meta: { app_id: 77, installation_id: 3 }, status: 'ok' });
  const sent = []; const g = async (u, o = {}) => { if (!o.method) return { status: 200, json: async () => [{ id: 5, name: 'main-requires-checks' }] }; sent.push([o.method, u, JSON.parse(o.body)]); return { status: 200 }; };
  assert.equal((await applyRulesets(db, env, 't', { fetch: g, token: 'tok' })).ok, true);
  assert.deepEqual(sent[0].slice(0, 2), ['PUT', 'https://api.github.com/repos/ultrastable/ultrastable/rulesets/5']);
  assert.deepEqual(sent[0][2].bypass_actors, [{ actor_id: 77, actor_type: 'Integration', bypass_mode: 'always' }]);
  assert.equal(sent[0][2].name, RULESETS['ultrastable/ultrastable'][0].name);
  assert.ok(Object.keys(SCOPE_ALLOWLIST['github-admin']).every(k => ['administration', 'metadata'].includes(k)));
  const { rulesetsDue } = await import('../src/auth/rulesets.js'); const fresh = mk(); const fdb = fresh.DB;
  await store.put(fdb, fresh, 't', 'github-admin', { secret: { pem: 'x' }, meta: { app_id: 1, installation_id: 2 }, status: 'pending' }); await store.put(fdb, fresh, 't', 'github-app', { secret: { pem: 'x' }, meta: { app_id: 77, installation_id: 3 }, status: 'ok' });
  const refuse = async (u, o = {}) => (!o.method ? { status: 200, json: async () => [] } : { status: 422, json: async () => ({ message: 'Validation Failed', errors: ['Actor must be installed'] }) });
  assert.deepEqual((await rulesetsDue(fdb, fresh, { fetch: refuse })).map(x => x.action), ['await-main-writer'], 'no rule before a workflow commit has landed through the org\'s own app');
  await store.event(fdb, 't', 'github-app', 'main-writer', 'abc');
  assert.deepEqual((await rulesetsDue(fdb, fresh, { fetch: refuse, token: 'tok', now: Date.now() })).map(x => x.action), ['retry']);
  assert.match(events(fdb, 'github-admin').pop().detail, /HTTP 422 Validation Failed; Actor must be installed/, 'GitHub\'s own reason is recorded');
  assert.deepEqual((await rulesetsDue(fdb, fresh, { fetch: refuse, token: 'tok', now: Date.now() })).map(x => x.action), ['backoff'], 'a refused rule is retried hourly, not every tick');
});

test('US-30-R35: the installation is checked against every repository the system works on; a gap becomes one open gate with its one-click page and closes itself when the repositories are covered', async () => {
  const env = mk(), db = env.DB, { pkcs8 } = await appKey();
  await store.put(db, env, 't', 'github-app', { secret: { pem: toPem(pkcs8, 'PRIVATE KEY') }, meta: { app_id: 7, installation_id: 9, slug: 'org-app' }, status: 'ok' });
  const world = covered => async (u, i = {}) => {
    u = String(u);
    if (u.endsWith('/app/installations?per_page=100')) return J([{ id: 9, account: { login: 'acme' }, repository_selection: 'selected', html_url: 'https://github.com/settings/installations/9', permissions: { contents: 'write', pull_requests: 'write', issues: 'write', actions: 'write', checks: 'read', statuses: 'write', workflows: 'write', metadata: 'read' } }]);
    if (u.endsWith('/app')) return J({ owner: { login: 'acme' } });
    if (u.endsWith('/installation/repositories?per_page=100')) return J({ repositories: covered.map(full_name => ({ full_name })) });
    return NF;
  };
  const repos = ['acme/main', 'acme/other'];
  const a = await checkRepoAccess(db, env, 't', repos, { token: 'tok', fetch: world(['acme/main']), now: NOW, origin: ORIGIN });
  assert.deepEqual([a.ok, a.covered, a.missing, a.selection, a.settings_url], [false, ['acme/main'], ['acme/other'], 'selected', 'https://github.com/settings/installations/9']);
  assert.equal(a.connect, ORIGIN + '/connect/repos');
  const open = db.raw.prepare("SELECT * FROM gate_cards WHERE id = 'GATE-REPO-ACCESS'").get();
  assert.equal(open.status, 'open'); assert.match(open.what, /acme\/other/); assert.equal(open.closing_probe, 'repo_access_ok'); assert.ok(open.default_in_effect);
  await checkRepoAccess(db, env, 't', repos, { token: 'tok', fetch: world(['acme/main']), now: NOW, origin: ORIGIN });
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM gate_cards WHERE id = 'GATE-REPO-ACCESS'").get().n, 1, 'one gate however often it is probed');
  const b = await checkRepoAccess(db, env, 't', repos, { token: 'tok', fetch: world(['ACME/Main', 'acme/other']), now: NOW, origin: ORIGIN });
  assert.equal(b.ok, true); assert.equal(db.raw.prepare("SELECT status FROM gate_cards WHERE id = 'GATE-REPO-ACCESS'").get().status, 'closed');
  const row = JSON.parse(db.raw.prepare("SELECT value FROM org WHERE key = 'repo_access'").get().value); assert.equal(row.ok, true);
  const none = await checkRepoAccess(makeDb(), env, 't', repos, { fetch: world([]), now: NOW }); assert.equal(none.reason, 'app not installed');
  const thin = async (u, i = {}) => { const r = await world(['acme/main', 'acme/other'])(u, i); if (String(u).endsWith('/app/installations?per_page=100')) { const l = await r.json(); l[0].permissions = { ...l[0].permissions, workflows: 'read' }; return J(l); } return r; };
  const c = await checkRepoAccess(db, env, 't', repos, { token: 'tok', fetch: thin, now: NOW, origin: ORIGIN });
  assert.deepEqual([c.permissions_missing, c.ok], [['workflows:write'], true]); assert.equal(c.reason, `the installation lacks workflows:write (accept the updated permissions at ${ORIGIN}/connect/github)`, 'a permission the App asks for and the installation never got is named');
  const other = async (u, i = {}) => { u = String(u); if (u.endsWith('/app/installations?per_page=100')) return J([{ id: 20, account: { login: 'acme' }, repository_selection: 'all' }]); if (u.endsWith('/app')) return J({ owner: { login: 'someone' } }); return world([])(u, i); };
  const d = await checkRepoAccess(db, env, 't', repos, { token: 'tok', fetch: other, now: NOW, origin: ORIGIN });
  assert.equal(d.adopted_installation, 20); assert.equal((await store.material(db, env, 't', 'github-app')).meta.installation_id, 20, 'the installation that holds the repositories is adopted by code');
});

test('US-30-R36: the live inventory of the organization\'s GitHub Apps removes every installation other than the stored one, reports an app whose key is gone, and runs at most once in twenty hours', async () => {
  const env = mk(), db = env.DB, { pkcs8 } = await appKey();
  await store.put(db, env, 't', 'github-app', { secret: { pem: toPem(pkcs8, 'PRIVATE KEY') }, meta: { app_id: 7, installation_id: 9 }, status: 'ok' });
  const calls = [];
  const f = async (u, o = {}) => { u = String(u); calls.push([o.method || 'GET', u.replace('https://api.github.com', '')]);
    if (u.endsWith('/app')) return J({ id: 7, slug: 'org-app' }); if (u.includes('/app/installations?')) return J([{ id: 9, account: { login: 'acme' } }, { id: 11, account: { login: 'old' } }]);
    return J({}, 204); };
  const r = await auditApps(db, env, 't', { fetch: f, now: NOW });
  assert.deepEqual(r.apps.find(a => a.role === 'github-app').removed, [{ id: 11, account: 'old', status: 204 }]);
  assert.deepEqual(r.apps.find(a => a.role === 'github-admin'), { role: 'github-admin', reachable: false, reason: 'no stored key' });
  assert.deepEqual([r.active, r.expected], [1, 2]);
  assert.ok(calls.some(c => c[0] === 'DELETE' && c[1] === '/app/installations/11') && !calls.some(c => c[1] === '/app/installations/9'));
  const ev = events(db, 'github-app').pop();
  assert.equal(ev.event, 'app-audit'); assert.ok(ev.detail.startsWith('{"at":"2026-11-26T12:00:00.000Z","apps":['), 'the report is recorded as JSON text');
  db.raw.prepare("UPDATE credential_events SET at = '2026-11-26T12:00:00Z' WHERE event = 'app-audit'").run();  // the store stamps real time; the test pins it to the injected clock
  const again = await auditApps(db, env, 't', { fetch: f, now: NOW + 19 * 3600e3 }); assert.equal(again.skipped, 'ran within a day');
  assert.equal((await auditApps(db, env, 't', { fetch: f, now: NOW + 21 * 3600e3 })).skipped, undefined);
});

// The app inventory report is recorded as one credential event, and the store cuts every event detail to 300 characters (R20), so a report of two apps is
// recorded cut and cannot be parsed back. This is the closing probe of the PLANNED part of the specification (the last sentence of R36, which is a SHOULD)
// and stays a todo until the whole report is kept where it can be read back. It deliberately names no requirement id.
test('the app inventory report is recorded whole and parses back (closing probe of the PLANNED part of the specification)', { todo: 'store.event cuts the app-audit report to 300 characters' }, async () => {
  const env = mk(), db = env.DB, { pkcs8 } = await appKey();
  for (const role of ['github-app', 'github-admin']) await store.put(db, env, 't', role, { secret: { pem: toPem(pkcs8, 'PRIVATE KEY') }, meta: { app_id: role === 'github-app' ? 7 : 8, installation_id: 9 }, status: 'ok' });
  const f = async (u, o = {}) => { u = String(u);
    if (u.endsWith('/app')) return J({ id: 7, slug: 'org-app' }); if (u.includes('/app/installations?')) return J([{ id: 9, account: { login: 'acme' } }, { id: 11, account: { login: 'old' } }, { id: 12, account: { login: 'older' } }]);
    return J({}, o.method === 'DELETE' ? 204 : 404); };
  const report = await auditApps(db, env, 't', { fetch: f, now: NOW });
  assert.ok(JSON.stringify(report).length > 300, 'the report of two apps is longer than one event detail');
  const ev = events(db, 'github-app').filter(e => e.event === 'app-audit').pop();
  assert.deepEqual(JSON.parse(ev.detail), report, 'the recorded report reads back whole');
});

test('US-30-R37: any other service is linked by one consent click, a PKCE redirect with a signed one-time state, a sealed result and a revoking disconnect; a provider with no registered app points at the single owner card, never at a token', async () => {
  const env = mk({ OAUTH_GOOGLE_CLIENT_ID: 'gid', OAUTH_GOOGLE_CLIENT_SECRET: 'gsec' }), seen = { tok: [], revoke: [] };
  let exchangeStatus = 200;
  const f = async (u, init = {}) => { u = String(u);
    if (u === 'https://oauth2.googleapis.com/token' && exchangeStatus !== 200) return J({ error: 'invalid_grant' }, exchangeStatus);
    if (u === 'https://oauth2.googleapis.com/token') { seen.tok.push(Object.fromEntries(new URLSearchParams(init.body))); return J({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }); }
    if (u === 'https://oauth2.googleapis.com/revoke') { seen.revoke.push(Object.fromEntries(new URLSearchParams(init.body))); return J({}); }
    return NF; };
  const consent = await (await get(env, '/connect/google', f)).text();
  assert.match(consent, /action="\/connect\/google\/start"/); assert.ok(!/type="(text|password)"/.test(consent));
  const start = await get(env, '/connect/google/start', f); assert.equal(start.status, 302);
  const loc = new URL(start.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/authorize');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256'); assert.equal(loc.searchParams.get('client_id'), 'gid'); assert.equal(loc.searchParams.get('access_type'), 'offline');
  assert.equal(loc.searchParams.get('redirect_uri'), ORIGIN + '/connect/google/callback'); assert.match(loc.searchParams.get('scope'), /drive\.file/);
  const state = loc.searchParams.get('state');
  const bad = await get(env, '/connect/google/callback?code=c&state=' + encodeURIComponent(state.slice(0, -3) + 'aaa'), f);
  assert.match(await bad.text(), /That approval link expired/);
  const denied = await get(env, '/connect/google/callback?error=access_denied&state=' + encodeURIComponent(state), f);
  assert.match(await denied.text(), /The approval was not completed/); assert.equal(events(env.DB, 'oauth:google').pop().detail, 'provider said access_denied');
  for (const status of [400, 503]) {
    exchangeStatus = status;
    const failed = await get(env, '/connect/google/callback?code=abc&state=' + encodeURIComponent(state), f); const ft = await failed.text();
    assert.match(ft, /The service did not finish the connection/); assert.ok(!/invalid_grant/.test(ft), 'the provider\'s answer stays on the server');
    const ev = events(env.DB, 'oauth:google').pop(); assert.deepEqual([ev.event, ev.detail], ['failed', 'token exchange HTTP ' + status], 'a failed token exchange is a recorded failed event');
  }
  exchangeStatus = 200;
  const ok = await get(env, '/connect/google/callback?code=abc&state=' + encodeURIComponent(state), f);
  assert.equal(ok.status, 200); assert.equal(seen.tok[0].code, 'abc'); assert.equal(seen.tok[0].client_secret, 'gsec');
  const pk = await pkce(); assert.equal(pk.challenge, createHash('sha256').update(pk.verifier).digest('base64url'));
  assert.equal(createHash('sha256').update(seen.tok[0].code_verifier).digest('base64url'), loc.searchParams.get('code_challenge'), 'the challenge is the S256 of the verifier sent at the exchange');
  const m = await store.material(env.DB, env, 't', 'oauth:google'); assert.deepEqual([m.access, m.secret.refresh_token, m.secret.pending, m.status], ['at-1', 'rt-1', undefined, 'ok']);
  assert.match(await (await get(env, '/connect/google/callback?code=abc&state=' + encodeURIComponent(state), f)).text(), /already used/, 'a one-time approval cannot be replayed');
  assert.equal((await get(env, '/connect/google/disconnect', f)).status, 405);
  const dis = await get(env, '/connect/google/disconnect', f, { init: { method: 'POST' } });
  assert.match(await dis.text(), /disconnected and its access was revoked/); assert.equal(seen.revoke[0].token, 'rt-1');
  assert.equal(await store.get(env.DB, 't', 'oauth:google'), null);
  const none = await (await get(mk(), '/connect/google', f)).text();
  assert.match(none, /waiting for its one-time app registration/); assert.match(none, /oauth-apps/); assert.ok(!/paste|token/i.test(none.replace(/oauth-apps/g, '')));
});

test('US-30-R38: a remote MCP server is linked with no owner step: only public https hosts are fetched, authorization is discovered from the server itself, PKCE S256 is required and the client registers itself', async () => {
  for (const bad of ['http://x.example/mcp', 'https://localhost/mcp', 'https://a.localhost/', 'https://box.local/', 'https://svc.internal/', 'https://10.0.0.1/', 'https://[::1]/', 'https://nodots/', 'https://u:p@x.example/', 'not a url']) assert.equal(safeUrl(bad), null, bad);  // server-side only: the SSRF guard refuses these hosts
  assert.ok(safeUrl('https://mcp.example.com/mcp')); assert.ok(safeUrl('http://127.0.0.1:9/x', true), 'only a test may allow insecure');
  assert.deepEqual(await discoverMcp('http://x.example/mcp'), { ok: false, error: 'server must be a public https URL' });
  const as = { issuer: 'https://auth.example', authorization_endpoint: 'https://auth.example/a', token_endpoint: 'https://auth.example/t', code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true };
  const world = (meta, prm) => async (u, i = {}) => { u = String(u);
    if (u === 'https://mcp.example.com/mcp' && i.method === 'POST') return { ok: false, status: 401, headers: new Headers({ 'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"' }), json: async () => ({}) };
    if (u.endsWith('/.well-known/oauth-protected-resource/mcp')) return J(prm);
    if (u === 'https://auth.example/.well-known/oauth-authorization-server') return J(meta);
    return NF; };
  const d = await discoverMcp('https://mcp.example.com/mcp', { fetch: world(as, { resource: 'https://mcp.example.com/mcp', authorization_servers: ['https://auth.example'], scopes_supported: ['mcp:use'] }) });
  assert.deepEqual([d.ok, d.resource, d.scopes], [true, 'https://mcp.example.com/mcp', ['mcp:use']]);
  assert.deepEqual(await discoverMcp('https://mcp.example.com/mcp', { fetch: world({ ...as, code_challenge_methods_supported: ['plain'] }, { authorization_servers: ['https://auth.example'] }) }), { ok: false, error: 'server does not support PKCE S256' });
  assert.equal((await discoverMcp('https://mcp.example.com/mcp', { fetch: world(null, { authorization_servers: ['https://auth.example'] }) })).error, 'no authorization server metadata found');
  assert.equal((await discoverMcp('https://mcp.example.com/mcp', { fetch: world(as, { authorization_servers: ['http://auth.example'] }) })).error, 'authorization server is not a public https URL');
  const doc = cimdDocument(ORIGIN); assert.equal(doc.client_id, ORIGIN + '/.well-known/oauth-client/ultrastable.json'); assert.deepEqual(doc.redirect_uris, [ORIGIN + '/connect/mcp/callback']); assert.equal(doc.token_endpoint_auth_method, 'none');
  const served = await get(mk(), '/.well-known/oauth-client/ultrastable.json', null); assert.deepEqual(await served.json(), doc);
});

test('US-30-R39: Mastodon is registered as an app on the owner\'s own server by the system, with PKCE, on a public host only, and its token is kept with no expiry', async () => {
  const env = mk(), seen = {};
  const f = async (u, init = {}) => { u = String(u);
    if (u === 'https://mstdn.example/api/v1/apps') { seen.app = JSON.parse(init.body); return J({ client_id: 'cid', client_secret: 'csec' }); }
    if (u === 'https://mstdn.example/oauth/token') { seen.tok = Object.fromEntries(new URLSearchParams(init.body)); return J({ access_token: 'mast-at' }); }
    return NF; };
  const r = await get(env, '/connect/mastodon/start?instance=https://MSTDN.example/', f); assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://mstdn.example/oauth/authorize');
  assert.deepEqual([seen.app.scopes, seen.app.redirect_uris], ['write:statuses profile', ORIGIN + '/connect/mastodon/callback']);
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256'); assert.equal(loc.searchParams.get('scope'), 'write:statuses profile');
  const cb = await get(env, '/connect/mastodon/callback?code=abc&state=' + encodeURIComponent(loc.searchParams.get('state')), f);
  assert.equal(cb.status, 200); assert.equal(seen.tok.client_secret, 'csec'); assert.ok(seen.tok.code_verifier);
  const m = await store.material(env.DB, env, 't', 'oauth:mastodon'); assert.deepEqual([m.access, m.status, m.expiresAt], ['mast-at', 'ok', null]);
  assert.equal((await probe(env.DB, NOW)).bad.length, 0, 'no expiry is not a lapse');
  const priv = await get(mk(), '/connect/mastodon/start?instance=evil.internal', f);
  assert.equal(priv.status, 502); assert.match(await priv.text(), /does not look like a public server address/);
  const fallback = async (u, init) => (String(u) === 'https://mastodon.social/api/v1/apps' ? J({ client_id: 'c', client_secret: 's' }) : f(u, init));
  const missing = await get(mk(), '/connect/mastodon/start?instance=localhost', fallback); assert.equal(new URL(missing.headers.get('location')).hostname, 'mastodon.social', 'an invalid host falls back to the default, never to a private one');  // server-side only: the SSRF guard keeps a private name out
});

test('US-30-R40: Bluesky is linked with atproto OAuth: PAR with PKCE and a DPoP key, a confidential client key kept sealed, the answer from the issuer that was asked, and an account bound to that issuer', async () => {
  const env = mk(), did = 'did:plc:abc123', seen = {};
  const f = async (u, init = {}) => { u = String(u); const h = new Headers(init.headers || {});
    if (u === 'https://bsky.social/.well-known/oauth-authorization-server') return J({ issuer: 'https://bsky.social', authorization_endpoint: 'https://bsky.social/oauth/authorize', token_endpoint: 'https://bsky.social/oauth/token', pushed_authorization_request_endpoint: 'https://bsky.social/oauth/par' });
    if (u === 'https://bsky.social/oauth/par') { if (!h.get('dpop')) return NF; seen.par = Object.fromEntries(new URLSearchParams(init.body)); return J({ request_uri: 'urn:par:1' }, 201); }
    if (u === 'https://bsky.social/oauth/token') { seen.tok = Object.fromEntries(new URLSearchParams(init.body)); return J({ access_token: 'at1', refresh_token: 'rt1', sub: did, expires_in: 1800 }); }
    if (u === 'https://plc.directory/' + did) return J({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example.net' }] });
    if (u === 'https://pds.example.net/.well-known/oauth-protected-resource') return J({ authorization_servers: ['https://bsky.social'] });
    return NF; };
  const md = await (await get(env, '/.well-known/oauth-client/bluesky-c.json', f)).json();
  assert.deepEqual([md.token_endpoint_auth_method, md.dpop_bound_access_tokens, md.scope], ['private_key_jwt', true, 'atproto transition:generic']);
  assert.equal((await (await get(env, '/.well-known/oauth-client/bluesky.json', f)).json()).token_endpoint_auth_method, 'none');
  const ks = await (await get(env, '/.well-known/oauth-client/bluesky-jwks.json', f)).json();
  assert.equal(ks.keys.length, 1); assert.equal(ks.keys[0].d, undefined, 'only the public half is served');
  const ck = (await store.material(env.DB, env, 't', 'oauth:bluesky-client')).secret.jwk; assert.ok(ck.d);
  assert.equal((await (await get(env, '/.well-known/oauth-client/bluesky-jwks.json', f)).json()).keys[0].kid, ck.kid, 'the client key is made once and never replaced');
  const r = await get(env, '/connect/bluesky/start', f); assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get('location')).searchParams.get('request_uri'), 'urn:par:1');
  assert.deepEqual([seen.par.code_challenge_method, seen.par.response_type, !!seen.par.client_assertion, seen.par.client_id], ['S256', 'code', true, ORIGIN + '/.well-known/oauth-client/bluesky-c.json']);
  const wrongIss = await get(env, '/connect/bluesky/callback?code=c&iss=https%3A%2F%2Fevil.net&state=' + encodeURIComponent(seen.par.state), f);
  assert.equal(wrongIss.status, 502); assert.match(await wrongIss.text(), /unexpected server/);
  const ok = await get(env, '/connect/bluesky/callback?code=c&iss=https%3A%2F%2Fbsky.social&state=' + encodeURIComponent(seen.par.state), f);
  assert.equal(ok.status, 200); assert.equal(seen.tok.grant_type, 'authorization_code'); assert.ok(seen.tok.code_verifier);
  const m = await store.material(env.DB, env, 't', 'oauth:bluesky'); assert.deepEqual([m.meta.did, m.meta.pds, m.secret.refresh_token, m.status], [did, 'https://pds.example.net', 'rt1', 'ok']);
  const tamper = async fn => { const env2 = mk(); const rr = await get(env2, '/connect/bluesky/start', fn); assert.equal(rr.status, 302); return env2; };
  const evil = async (u, init) => (String(u).startsWith('https://pds.example.net/.well-known/oauth-protected-resource') ? J({ authorization_servers: ['https://evil.net'] }) : f(u, init));
  const env2 = await tamper(evil);
  const { makeConnectorState } = await import('../src/auth/state.js');
  const cur = await store.material(env2.DB, env2, 't', 'oauth:bluesky');
  const st2 = await makeConnectorState(env2, 't', 'oauth:bluesky', cur.secret.pending.nonce, NOW);
  const unbound = await get(env2, '/connect/bluesky/callback?code=c&iss=https%3A%2F%2Fbsky.social&state=' + encodeURIComponent(st2), evil);
  assert.equal(unbound.status, 502); assert.match(await unbound.text(), /does not belong to the server that approved it/);
  assert.equal(events(env2.DB, 'oauth:bluesky').pop().detail, 'sub not bound to issuer');
});

test('US-30-R41: a working sign-in is never started again, a start that arrives twice continues the sign-in under way, and a callback that matches nothing is recorded with its reason', async () => {
  const env = mk(); let apps = 0;
  const f = async (u, init = {}) => { u = String(u);
    if (u === 'https://mastodon.social/api/v1/apps') { apps++; return J({ client_id: 'cid' + apps, client_secret: 'cs' }); }
    if (u === 'https://mastodon.social/oauth/token') return J({ access_token: 'at' });
    return NF; };
  const a = await get(env, '/connect/mastodon/start', f), b = await get(env, '/connect/mastodon/start', f, { now: NOW + 5 * 60e3 });
  assert.equal(apps, 1, 'the double tap did not register a second app');
  const la = new URL(a.headers.get('location')), lb = new URL(b.headers.get('location'));
  assert.equal(la.searchParams.get('client_id'), lb.searchParams.get('client_id')); assert.equal(la.searchParams.get('code_challenge'), lb.searchParams.get('code_challenge'));
  await get(env, '/connect/mastodon/start', f, { now: NOW + 11 * 60e3 }); assert.equal(apps, 2, 'ten minutes later a new sign-in starts');
  const wrong = await get(env, '/connect/mastodon/callback?code=c&state=not-a-state', f);
  assert.match(await wrong.text(), /That approval link expired/); assert.match(events(env.DB, 'oauth:mastodon').pop().detail, /^callback: state expired or for another tenant/);
  const fresh = new URL((await get(env, '/connect/mastodon/start', f, { now: NOW + 30 * 60e3 })).headers.get('location')).searchParams.get('state');
  assert.equal((await get(env, '/connect/mastodon/callback?code=c&state=' + encodeURIComponent(fresh), f, { now: NOW + 30 * 60e3 })).status, 200);
  const again = await get(env, '/connect/mastodon/start', f); assert.match(await again.text(), /Nothing to do. The connection is working/);
  assert.equal(apps, 3);
});

test('US-30-R42: with the internal key bound a provider connect page is the owner\'s alone: without the site Worker\'s key it sends to sign in with the destination, and the key is compared as a whole', async () => {
  const e = mk({ INTERNAL_DEPLOY_KEY: 'k-123' });
  for (const path of ['/connect/buffer', '/connect/mastodon/start?instance=mstdn.science', '/connect/bluesky', '/connect/mcp/disconnect']) {
    const r = await get(e, path, null); assert.equal(r.status, 302, path);
    assert.equal(new URL(r.headers.get('location'), ORIGIN).pathname, '/auth/signin'); assert.equal(new URL(r.headers.get('location'), ORIGIN).searchParams.get('next'), path);
  }
  for (const key of ['k-12', 'k-1234', 'K-123', '']) assert.match((await get(e, '/connect/buffer', null, { init: { headers: { 'x-internal-key': key } } })).headers.get('location') || '', /\/auth\/signin/, key);
  const ok = await get(e, '/connect/buffer', null, { init: { headers: { 'x-internal-key': 'k-123' } } }); assert.ok(!/\/auth\/signin/.test(ok.headers.get('location') || ''));
  for (const open of ['/connect/github', '/connect/github-admin', '/connect/google/callback?code=c&state=s']) assert.ok(!/\/auth\/signin/.test((await get(e, open, null)).headers.get('location') || ''), open + ' is not gated by the key');
  assert.ok(!/\/auth\/signin/.test((await get(mk(), '/connect/buffer', null)).headers.get('location') || ''), 'with no key bound the gate is off');
});

// ---- 4.7 Plain words --------------------------------------------------------------------------------------------------------------------------

test('US-30-R60: only a deliberate message reaches a person; backend detail goes to the console and the owner-only audit hook; the answer is an RFC 9457 problem with a stable type and title and a unique instance', async () => {
  const { say, plain, userError, userJson, classify, PROBLEM_TYPE, PROBLEM_CONTENT_TYPE, problem } = await import('../src/errors.js');
  const raw = new Error('D1_ERROR: Error: 7500 row read limit at INSERT INTO credentials (sealed) VALUES (secret-x)');
  assert.equal(classify(raw), 'limit'); assert.equal(classify(new Error('fetch failed ECONNRESET')), 'network'); assert.equal(classify(new Error('request timed out')), 'timeout');
  assert.equal(classify(new Error('Bad credentials 401')), 'auth'); assert.equal(classify(new Error('weird')), 'internal'); assert.equal(classify(say('x', 404, 'not_found')), 'not_found');
  const p = plain(raw); assert.deepEqual([p.code, p.status], ['limit', 503]); assert.ok(!/D1_ERROR|INSERT|secret-x/.test(p.message));
  assert.equal(plain(say('x'.repeat(500), 422, 'bad_request')).message.length, 240);
  const rec = []; const origErr = console.error; console.error = () => {};
  try {
    const body = userError(raw, 'owner-signin', { audit: r => rec.push(r) });
    await new Promise(r => setTimeout(r, 0));
    assert.ok(!JSON.stringify(body).includes('secret-x')); assert.equal(rec.length, 1); assert.match(rec[0].detail, /secret-x/); assert.equal(rec[0].where, 'owner-signin'); assert.equal(rec[0].instance, body.instance);
    assert.deepEqual([body.ok, body.code, body.type, body.title, body.status], [false, 'limit', PROBLEM_TYPE + 'limit', 'Daily allowance reached', 503]);
    assert.equal(body.detail, body.error); assert.match(body.instance, /^urn:ultrastable:occurrence:[0-9a-f]{16}$/);
    assert.notEqual(userError(raw, 'x').instance, userError(raw, 'x').instance);
    userError(raw, 'x', { audit: () => { throw new Error('audit down'); } });  // a failing audit hook never fails the request
    const res = userJson(say('Please check the address.', 400, 'bad_request'), 'x');
    assert.equal(res.headers.get('content-type'), PROBLEM_CONTENT_TYPE); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.equal(res.status, 400);
    assert.equal((await res.json()).detail, 'Please check the address.');
    const fb = plain(new Error('some internal thing'), { fallback: { code: 'not_verified', status: 400, message: 'That sign-in could not be verified.' } });
    assert.deepEqual([fb.code, fb.status], ['not_verified', 400]);
    assert.equal(problem({ code: 'odd code!', status: 418, message: 'm' }).type, PROBLEM_TYPE + 'odd-code-'); assert.equal(problem({ code: 'zzz', status: 409, message: 'm' }).title, 'Conflict');
  } finally { console.error = origErr; }
});
