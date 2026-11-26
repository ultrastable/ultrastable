// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-30 (owner actions and credentials), section 4.5: GitHub in one click for the reference implementation (the App is created from a manifest and
// installed, so nobody pastes a token) and the owner's sign-in through that App. Each test names the requirement it proves (US-00-R03). Keys are generated
// for the test; the clock is injected; GitHub is a fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createVault } from '../vault/index.js';
import { readSession, canWrite } from '../auth/index.js';
import { createGithubApp, createInstallationTokenProvider, manifest, hasAppCredentials, githubConnection } from './index.js';
import { createSignin, SESSION_COOKIE } from './signin.js';

const MIG = fileURLToPath(new URL('../vault/migrations/', import.meta.url));
const BASE = 'https://work.example.test', CONSOLE = 'console-access-key-123';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const req = (path, { authed = true, cookies = '' } = {}) => new Request(BASE + path, { headers: { cookie: [authed ? `us_console=${CONSOLE}` : '', cookies].filter(Boolean).join('; ') } });
const newVault = () => createVault({ db: makeDb([MIG]) });

test('US-30-R46: the GitHub App manifest asks for the least a runner needs, the owner creates and installs it with two clicks behind a signed single-use state, and no secret is echoed or kept where it can be read back', async () => {
  const m = manifest({ baseUrl: BASE + '/', appName: 'Runner' });
  assert.deepEqual(m.default_permissions, { contents: 'write', pull_requests: 'write', issues: 'write', checks: 'read', metadata: 'read' }); assert.deepEqual(m.default_events, []);
  assert.deepEqual([m.public, m.hook_attributes.active, m.redirect_url, m.setup_url, m.callback_urls[0]], [false, false, BASE + '/console/github/callback', BASE + '/console/github/installed', BASE + '/console/github/signin/callback']);
  assert.equal(manifest({ baseUrl: BASE, workflows: true }).default_permissions.workflows, 'write'); assert.equal(m.default_permissions.workflows, undefined); assert.equal(m.default_permissions.administration, undefined);
  assert.throws(() => manifest({}), /config\.baseUrl is required/);
  const vault = newVault(); let t = 1_800_000_000_000; const seen = [];
  const app = createGithubApp({ vault, config: { baseUrl: BASE, org: 'acme', appName: 'Runner' }, consoleToken: CONSOLE, now: () => t,
    fetch: async (u, i) => { seen.push([String(u), i.method]); return json({ id: 99, slug: 'my-app', pem: PEM, webhook_secret: 'webhook-secret-value-xyz', client_id: 'Iv1.abcdef123', client_secret: 'client-secret-value-1' }); } });
  assert.equal((await app(req('/console/github/connect', { authed: false }))).status, 401, 'the console sign-in comes first'); assert.equal(await app(req('/elsewhere')), null);
  assert.equal((await app(new Request(BASE + '/console/github/connect', { method: 'POST', headers: { cookie: `us_console=${CONSOLE}` } }))).status, 405);
  const page = await app(req('/console/github/connect')); const html = await page.text();
  assert.match(html, /action="https:\/\/github\.com\/organizations\/acme\/settings\/apps\/new\?state=/); assert.equal((html.match(/<button/g) || []).length, 1);
  assert.match(page.headers.get('content-security-policy'), /form-action https:\/\/github\.com/);
  const state = decodeURIComponent(/state=([^"]+)"/.exec(html)[1]), nonce = /us_gh_state=([0-9a-f]+);/.exec(page.headers.get('set-cookie'))[1]; assert.equal(state.split('.')[0], nonce);
  const path = `/console/github/callback?code=abcdef123456&state=${encodeURIComponent(state)}`;
  assert.equal((await app(req(path, { cookies: 'us_gh_state=deadbeef' }))).status, 400, 'a state not bound to this browser'); assert.equal((await app(req(path.replace('abcdef123456', 'x')))).status, 400, 'a code of the wrong shape');
  const done = await app(req(path, { cookies: `us_gh_state=${nonce}` })); const all = await done.text() + JSON.stringify([...done.headers]);
  assert.equal(done.status, 303); assert.equal(done.headers.get('location'), 'https://github.com/apps/my-app/installations/new'); assert.deepEqual(seen, [['https://api.github.com/app-manifests/abcdef123456/conversions', 'POST']]);
  for (const secret of ['BEGIN', 'webhook-secret-value-xyz', 'client-secret-value-1']) assert.ok(!all.includes(secret), 'not echoed');
  assert.deepEqual([(await vault.read('GITHUB_APP_ID')), (await vault.read('GITHUB_APP_CLIENT_ID')), await vault.has('GITHUB_APP_WEBHOOK_SECRET')], ['app-id:99', 'Iv1.abcdef123', true]);
  assert.equal((await app(req(path, { cookies: `us_gh_state=${nonce}` }))).status, 400, 'a state is single use');
  t += 16 * 60e3; assert.equal((await app(req(path, { cookies: `us_gh_state=${nonce}` }))).status, 400, 'and expires after fifteen minutes');
  assert.equal((await app(req('/console/github/installed?installation_id=abc'))).status, 400); assert.match(await (await app(req('/console/github/installed?installation_id=1234567'))).text(), /Connected/);
  assert.equal(await vault.read('GITHUB_APP_INSTALLATION_ID'), 'installation-id:1234567'); assert.equal(await hasAppCredentials(vault), true); assert.deepEqual(await githubConnection(vault), { name: 'github', label: 'Connect GitHub', href: '/console/github/connect', present: true });
});

test('US-30-R46: the installation token is minted from the stored App key, kept only in memory until five minutes before it expires, shared by concurrent callers, and an error never carries the JWT or the key', async () => {
  const vault = newVault(); await vault.put('GITHUB_APP_ID', 'app-id:77'); await vault.put('GITHUB_APP_PRIVATE_KEY', PEM); await vault.put('GITHUB_APP_INSTALLATION_ID', 'installation-id:555');
  let t = 1_800_000_000_000, n = 0; const calls = [];
  const fetch = async (u, i) => { calls.push({ u: String(u), auth: i.headers.authorization }); n++; await Promise.resolve(); return json({ token: `ghs_TOKEN_${n}`, expires_at: new Date(t + 3600e3).toISOString() }, 201); };
  const get = createInstallationTokenProvider({ vault, fetch, now: () => t });
  const [a, b] = await Promise.all([get(), get()]); assert.deepEqual([a, b, calls.length], ['ghs_TOKEN_1', 'ghs_TOKEN_1', 1], 'two callers at once make one request');
  t += 50 * 60e3; assert.equal(await get(), 'ghs_TOKEN_1'); t += 6 * 60e3; assert.equal(await get(), 'ghs_TOKEN_2'); assert.equal(calls[0].u, 'https://api.github.com/app/installations/555/access_tokens');
  const [h, p, s] = calls[0].auth.replace('Bearer ', '').split('.'); assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, '77');
  assert.equal(createVerify('RSA-SHA256').update(h + '.' + p).verify(publicKey, Buffer.from(s, 'base64url')), true);
  const failing = createInstallationTokenProvider({ vault, fetch: async () => json({ message: 'Bad credentials' }, 401) }); await assert.rejects(failing, e => /http 401/.test(e.message) && !/BEGIN|eyJ/.test(e.message));
  await assert.rejects(createInstallationTokenProvider({ vault: newVault(), fetch })(), /app credentials are not complete in the vault/);
  await assert.rejects(createInstallationTokenProvider({ vault, fetch: async () => { throw new Error('socket hang up'); } })(), /network error while requesting an installation token/);
});

async function signinSetup(admin) {
  const vault = newVault(); await vault.put('GITHUB_APP_CLIENT_ID', 'Iv1.client-id'); await vault.put('GITHUB_APP_CLIENT_SECRET', 'client-secret-value');
  const fetch = async u => { u = String(u);
    if (u.endsWith('/login/oauth/access_token')) return json({ access_token: 'user-token-123' }); if (u.endsWith('/user')) return json({ login: 'octocat' });
    if (u.endsWith('/repos/acme/app')) return json(admin === null ? { message: 'Not Found' } : { permissions: { admin } }, admin === null ? 404 : 200); return json({}, 404); };
  return { vault, handle: createSignin({ vault, fetch, repo: 'acme/app', now: 1000 }) };
}
const sget = (path, cookie = '') => new Request(BASE + path, { headers: cookie ? { cookie } : {} });

test('US-30-R45: signing in with GitHub makes the repository\'s administrator the owner, with no typed value: the state is bound to the browser, the key is made by the Worker, and every other visitor is a viewer', async () => {
  const { vault, handle } = await signinSetup(true);
  const start = await handle(sget('/console/github/signin')); const loc = new URL(start.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize'); assert.deepEqual([loc.searchParams.get('client_id'), loc.searchParams.get('redirect_uri')], ['Iv1.client-id', BASE + '/console/github/signin/callback']);
  const state = loc.searchParams.get('state'); assert.match(start.headers.get('set-cookie'), new RegExp(`^us_signin_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/console/github; Max-Age=600$`));
  assert.equal(await vault.read('SESSION_KEY'), null, 'no key until a session is issued');
  const back = await handle(sget(`/console/github/signin/callback?code=abcdef12&state=${state}`, `us_signin_state=${state}`));
  assert.equal(back.status, 303); assert.equal(back.headers.get('location'), '/console'); assert.match(back.headers.get('set-cookie'), new RegExp(`^${SESSION_COOKIE}=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800$`));
  const key = await vault.read('SESSION_KEY'); assert.match(key, /^[0-9a-f]{64}$/); const tok = back.headers.get('set-cookie').match(new RegExp(SESSION_COOKIE + '=([^;]+)'))[1];
  const s = await readSession(tok, { key, now: 2000 }); assert.deepEqual([s.login, s.role, canWrite(s)], ['octocat', 'owner', true]);
  await handle(sget(`/console/github/signin/callback?code=abcdef12&state=${state}`, `us_signin_state=${state}`)); assert.equal(await vault.read('SESSION_KEY'), key, 'the key is made once and never replaced');
  const back2 = await handle(sget(`/console/github/signin/callback?code=abcdef12&state=${state}`, `us_signin_state=${state}; us_return=/owner/go/x`));
  assert.equal(back2.headers.get('location'), '/owner/go/x', 'the owner page may ask to come back to itself'); const bad = await handle(sget(`/console/github/signin/callback?code=abcdef12&state=${state}`, `us_signin_state=${state}; us_return=//evil.example`)); assert.equal(bad.headers.get('location'), '/console');
  const out = await handle(sget(`/console/github/signin/callback?code=abcdef12&state=${state}`, `us_signin_state=${state}; us_return=${encodeURIComponent('/owner/../../x')}`)); assert.equal(out.headers.get('location'), '/console');
  for (const admin of [false, null]) { const x = await signinSetup(admin); const r = await x.handle(sget('/console/github/signin/callback?code=abcdef12&state=st1', 'us_signin_state=st1')); const t2 = r.headers.get('set-cookie').match(new RegExp(SESSION_COOKIE + '=([^;]+)'))[1];
    assert.equal(canWrite(await readSession(t2, { key: await x.vault.read('SESSION_KEY'), now: 2000 })), false, 'admin ' + admin); }
  assert.equal((await handle(sget('/console/github/signin/callback?code=abcdef12&state=evil', 'us_signin_state=st1'))).status, 400); assert.equal((await handle(sget('/console/github/signin/callback?code=abcdef12&state=st1'))).status, 400);
  assert.equal((await handle(sget('/console/github/signin/callback?code=<x>&state=st1', 'us_signin_state=st1'))).status, 400, 'a code of the wrong shape');
  assert.equal((await handle(new Request(BASE + '/console/github/signin', { method: 'POST' }))).status, 405);
  const bare = createSignin({ vault: newVault(), fetch: async () => json({}), repo: 'a/b' }); assert.equal((await bare(sget('/console/github/signin'))).status, 409, 'before GitHub is connected there is nothing to sign in with');
});
