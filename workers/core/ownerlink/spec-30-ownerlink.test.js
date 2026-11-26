// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-30 (owner actions and credentials), sections 4.2 and 4.5: the owner action page and its one-click flows. Each test names the requirement it
// proves (US-00-R03). The clock is injected and the network is a fake; sessions are signed here with a throwaway key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createVault } from '../vault/index.js';
import { issueSession } from '../auth/index.js';
import { askOwner } from '../access/index.js';
import { createOwnerlink, createBlueskyClient, actionForAsk, putAction, flowFor, goLink } from './index.js';
import { complete, openActions, newState, takeState } from './actions.js';
import { syncStatic } from './static.js';
import { syncPullRequests } from './prs.js';

const dirs = ['../vault/migrations/', '../access/migrations/', './migrations/'].map(d => fileURLToPath(new URL(d, import.meta.url)));
const T0 = Date.parse('2026-11-26T12:00:00Z');
const ORIGIN = 'https://org.example';
const resp = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body });
const KEY = 'k'.repeat(32);

async function mk(fetchFn, config = {}, { clientId = true, role = 'owner', now = T0, env = { GITHUB_TOKEN: 'x' } } = {}) {
  const db = makeDb(dirs), vault = createVault({ db });
  await vault.put('SESSION_KEY', KEY); if (clientId) await vault.put('GITHUB_APP_CLIENT_ID', 'Iv1.testclient');
  const cookie = 'us_session=' + encodeURIComponent(await issueSession({ login: 'owner', role, key: KEY, now: T0 }));
  const ctx = { db, vault, now: () => now, fetch: fetchFn || (async () => resp(404, {})), env, config: { ownerlink: { origin: ORIGIN + '/', mastodon: { instance: 'social.example' }, signup: { mastodon: 'https://social.example/auth/sign_up' }, ...config } } };
  const ol = createOwnerlink(ctx);
  const get = (path, c = cookie, extra = {}) => ol.handle(new Request(ORIGIN + path, { headers: { ...(c ? { cookie: c } : {}), ...extra }, ...(extra.method ? { method: extra.method } : {}) }));
  return { ctx, ol, get, cookie, db, vault };
}
const ask = (ctx, name, id, cap = 'secret.available') => askOwner({ ...ctx, registry: { [cap]: { routes: [{ id: 'env', run: () => ({ outcome: 'absent', detail: 'not set' }) }] } } },
  { id, what: `connect ${name}`, why_gated: 'needed', default_in_effect: 'skipped', closing_probe: 'manual', capability: cap, subject: name });

test('US-30-R13: an ask reaches the owner only with one link: the flow is chosen by the capability, no flow means no card and a staff item, and the database closes a permitted card that has no link', async () => {
  assert.equal(flowFor('github.app_installed', 'o/a').id, 'github_app'); assert.equal(flowFor('github.repo_permission', 'o/r:push').id, 'github_app');
  assert.equal(flowFor('secret.available', 'VCS_TOKEN').id, 'github_app'); assert.equal(flowFor('secret.available', 'GITHUB_APP_ID').id, 'github_app');
  assert.equal(flowFor('secret.available', 'MASTODON_TOKEN').id, 'mastodon'); assert.equal(flowFor('secret.available', 'BLUESKY_OAUTH').id, 'bluesky');
  assert.equal(flowFor('secret.available', 'SOME_OTHER_KEY'), null); assert.equal(flowFor('cloudflare.account_access', 'x'), null);
  const extra = [{ id: 'mine', title: 'Mine', matches: (c, s) => s === 'SOME_OTHER_KEY' }, { id: 'first', title: 'First', matches: () => true }];
  assert.equal(flowFor('secret.available', 'SOME_OTHER_KEY', extra).id, 'mine'); assert.equal(flowFor('secret.available', 'MASTODON_TOKEN', extra).id, 'first', 'a deployment\'s own flows are tried before the built-in ones');
  const { ctx } = await mk();
  const r = await ask(ctx, 'MASTODON_TOKEN', 'need-masto');
  assert.deepEqual([r.asked, r.link], [true, ORIGIN + '/owner/go/need-masto']);
  const row = ctx.db.raw.prepare('SELECT * FROM ownerlink_actions').get();
  assert.deepEqual([row.id, row.card_id, row.flow, row.status, row.extra_link, row.extra_label], ['need-masto', 'need-masto', 'mastodon', 'open', 'https://social.example/auth/sign_up', 'No account yet? Sign up first']);
  assert.equal(goLink(ctx, 'a b/c'), ORIGIN + '/owner/go/a%20b%2Fc');
  const none = await ask(ctx, 'SOME_OTHER_KEY', 'need-other');
  assert.deepEqual([none.asked, none.reason], [false, 'no_owner_link']); assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) n FROM gate_cards WHERE id = 'need-other'").get().n, 0);
  assert.equal(ctx.db.raw.prepare("SELECT reason FROM access_blocked_asks WHERE card_id = 'need-other'").get().reason, 'no_owner_link: no one-click flow can obtain secret.available SOME_OTHER_KEY');
  const it = ctx.db.raw.prepare("SELECT status, owner_role, title FROM items WHERE id = 'OWNERLINK-need-other'").get(); assert.deepEqual([it.status, it.owner_role], ['blocked', 'staff']); assert.match(it.title, /^Build the one-click flow for: connect SOME_OTHER_KEY/);
  assert.equal(await actionForAsk(ctx, { capability: 'secret.available', subject: 'SOME_OTHER_KEY', id: 'z', what: 'w' }), null);
  const raw = ctx.db.raw;
  raw.prepare("INSERT INTO access_state (capability, subject, status, probe_id, checked_at, expires_at, evidence) VALUES ('secret.available','Z','missing','p','2026-11-26T12:00:00.000Z','2099-01-01T00:00:00.000Z','[]')").run();
  raw.prepare("INSERT INTO access_routes (capability, subject, route, outcome, detail, at, probe_id) VALUES ('secret.available','Z','env','absent','x','2026-11-26T12:00:00.000Z','p')").run();
  raw.prepare("INSERT INTO access_permits (card_id, capability, subject, at) VALUES ('c1','secret.available','Z','2026-11-26T12:00:00.000Z')").run();
  raw.prepare("INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES ('c1','w','y','d','manual')").run();
  assert.equal(raw.prepare("SELECT status FROM gate_cards WHERE id = 'c1'").get().status, 'closed'); assert.match(raw.prepare("SELECT reason FROM access_blocked_asks WHERE card_id = 'c1'").get().reason, /^no_owner_link: an owner ask must carry one point-and-click link/);
  await assert.rejects(putAction(ctx, { id: 'x', flow: 'f' }), /action needs title/);
  await complete(ctx, 'need-masto'); assert.equal(raw.prepare("SELECT status FROM gate_cards WHERE id = 'need-masto'").get().status, 'closed'); assert.equal((await openActions(ctx)).length, 0);
  await putAction(ctx, { id: 'need-masto', flow: 'mastodon', title: 'Connect Mastodon' }); assert.equal((await openActions(ctx)).length, 1, 'asking again reopens the action');
  raw.prepare("UPDATE ownerlink_actions SET status = 'dismissed'").run(); await putAction(ctx, { id: 'need-masto', flow: 'mastodon', title: 'Connect Mastodon' }); assert.equal((await openActions(ctx)).length, 0, 'a dismissed action stays dismissed');
});

test('US-30-R47: the owner page asks an unsigned visitor for one thing, reads its role from the session, refuses everything but GET, and lists each open action as one button', async () => {
  const { ctx, get, ol, cookie } = await mk();
  const anon = await get('/owner', null); const text = await anon.text();
  assert.equal(anon.status, 401); assert.match(text, /Sign in with GitHub/); assert.match(text, /href="\/owner\/signin"/);
  assert.deepEqual(await (await get('/api/owner/actions', null)).json(), { error: 'sign_in_required', sign_in: ORIGIN + '/owner/signin' });
  const redirect = await get('/owner/signin', null); assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/console/github/signin'); assert.match(redirect.headers.get('set-cookie'), /^us_return=\/owner; HttpOnly; Secure; SameSite=Lax; Path=\/console\/github; Max-Age=600$/);
  const noApp = await mk(null, {}, { clientId: false }); const t2 = await (await noApp.get('/owner', null)).text(); assert.match(t2, /GitHub is not connected to this installation yet/); assert.match(t2, /href="\/console\/github\/connect"/); assert.ok(!/Sign in with GitHub/.test(t2), 'no sign-in button when there is nothing to sign in with');
  assert.equal((await get('/owner', 'us_session=forged.value')).status, 401);
  const viewer = await mk(null, {}, { role: 'viewer' }); assert.equal((await viewer.get('/owner')).status, 401, 'a viewer session is not the owner');
  const late = await mk(null, {}, { now: T0 + 9 * 3600e3 }); assert.equal((await late.get('/owner')).status, 401, 'an expired session is not a session');
  assert.equal(await ol.handle(new Request(ORIGIN + '/elsewhere')), null); assert.equal(await ol.handle(new Request(ORIGIN + '/ownership')), null);
  const post = await get('/owner', cookie, { method: 'POST' }); assert.equal(post.status, 405);
  const empty = await get('/owner'); assert.equal(empty.status, 200); assert.match(await empty.text(), /Nothing is waiting on you/);
  await ask(ctx, 'MASTODON_TOKEN', 'need-masto'); await putAction(ctx, { id: 's:x', flow: 'static', title: 'Open <b>settings</b>', why: 'because', link: 'https://example.org/settings' });
  const page = await get('/owner'); const html = await page.text();
  assert.match(html, /2 waiting\. Each is one button\./); assert.match(html, /Connect Mastodon/); assert.match(html, /Do it in one click/); assert.match(html, /Open &lt;b&gt;settings&lt;\/b&gt;/); assert.ok(!/<b>settings/.test(html));
  assert.deepEqual([page.headers.get('cache-control'), page.headers.get('x-content-type-options'), page.headers.get('referrer-policy')], ['no-store', 'nosniff', 'no-referrer']); assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const api = await (await get('/api/owner/actions')).json(); assert.deepEqual(api.actions.map(a => [a.id, a.flow]), [['need-masto', 'mastodon'], ['s:x', 'static']]);
  assert.equal((await get('/owner/go/nothing-here')).status, 404); assert.match(await (await get('/owner/go/nothing-here')).text(), /Already done/);
  assert.equal((await get('/owner/go/s%3Ax')).status, 404, 'a flow the page has no handler for is not started');
  const out = await ol.step(); assert.equal(out.closed, 0);
  ctx.db.raw.prepare("UPDATE gate_cards SET status = 'closed' WHERE id = 'need-masto'").run(); assert.equal((await ol.step()).closed, 1, 'an action whose card closed is done');
  assert.deepEqual((await (await get('/api/owner/actions')).json()).actions.map(a => a.id), ['s:x']);
});

test('US-30-R48: Mastodon and Bluesky are linked with a state bound to the browser and used once, the app registered by the system, the issuer checked, and the result kept in the vault and never shown', async () => {
  const seen = [];
  const f = async (url, init = {}) => {
    const u = String(url); seen.push(u); const hd = init.headers || {};
    if (u === 'https://social.example/api/v1/apps') return resp(200, { client_id: 'cid12345', client_secret: 'csecret12345' });
    if (u === 'https://social.example/oauth/token') return resp(200, { access_token: 'tok-abcdefgh' });
    if (u.endsWith('/.well-known/oauth-authorization-server')) return resp(200, { issuer: 'https://bsky.example', pushed_authorization_request_endpoint: 'https://bsky.example/par', authorization_endpoint: 'https://bsky.example/authorize', token_endpoint: 'https://bsky.example/token' });
    if (u === 'https://bsky.example/par') { assert.ok(hd.dpop, 'the request carries a DPoP proof'); assert.match(String(init.body), /code_challenge_method=S256/); return resp(201, { request_uri: 'urn:par:1' }); }
    if (u === 'https://bsky.example/token') { if (String(init.body).includes('grant_type=authorization_code')) { assert.match(String(init.body), /code_verifier=/); return resp(200, { access_token: 'at-1', refresh_token: 'rt-1-long', sub: 'did:plc:abc123' }); } return resp(200, { access_token: 'at-2', refresh_token: 'rt-2-long', sub: 'did:plc:abc123' }); }
    if (u === 'https://plc.directory/did:plc:abc123') return resp(200, { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example' }] });
    if (u === 'https://pds.example/xrpc/com.atproto.repo.createRecord') { assert.equal(hd.authorization, 'DPoP at-2'); return resp(200, {}); }
    return resp(404, {});
  };
  const { ctx, get, vault, cookie } = await mk(f, { bluesky: { service: 'https://bsky.example' } });
  await ask(ctx, 'MASTODON_TOKEN', 'need-masto'); await ask(ctx, 'BLUESKY_OAUTH', 'need-bsky');
  const go = await get('/owner/go/need-masto'); const loc = new URL(go.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://social.example/oauth/authorize'); assert.equal(loc.searchParams.get('scope'), 'write:statuses'); assert.equal(loc.searchParams.get('redirect_uri'), ORIGIN + '/owner/callback/mastodon');
  assert.match(go.headers.get('set-cookie'), /^us_owner_state=[0-9a-f]{24}; HttpOnly; Secure; SameSite=Lax; Path=\/owner; Max-Age=900$/);
  const state = loc.searchParams.get('state'), sc = go.headers.get('set-cookie').split(';')[0];
  assert.equal((await get(`/owner/callback/mastodon?code=c&state=${state}`)).status, 400, 'no cookie from this browser: refused'); assert.equal((await get(`/owner/callback/mastodon?code=c&state=${state}`, `${cookie}; us_owner_state=other`)).status, 400);
  assert.equal(ctx.db.raw.prepare('SELECT COUNT(*) n FROM ownerlink_state').get().n, 1, 'a refused callback consumes nothing');
  const cb = await get(`/owner/callback/mastodon?code=c&state=${state}`, `${cookie}; ${sc}`); const body = await cb.text();
  assert.equal(cb.status, 200); assert.match(body, /Mastodon is connected/); assert.ok(!/tok-abcdefgh|csecret/.test(body), 'a value is never shown'); assert.match(cb.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(await vault.read('MASTODON_TOKEN'), 'tok-abcdefgh'); assert.equal(ctx.db.raw.prepare("SELECT status FROM ownerlink_actions WHERE id = 'need-masto'").get().status, 'done');
  assert.equal((await get(`/owner/callback/mastodon?code=c&state=${state}`, `${cookie}; ${sc}`)).status, 400, 'a state is single use');
  assert.equal((await get('/owner/go/need-masto')).status, 404, 'a done action is not started again');
  const regs = seen.filter(u => u.endsWith('/api/v1/apps')).length; assert.equal(regs, 1); await ask(ctx, 'MASTODON_TOKEN', 'need-masto2');
  const stale = await get('/owner/go/need-masto2'); assert.equal(seen.filter(u => u.endsWith('/api/v1/apps')).length, regs, 'an app already registered on that instance is reused'); const st = new URL(stale.headers.get('location')).searchParams.get('state'); ctx.db.raw.prepare('UPDATE ownerlink_state SET expires_at = ?').run('2026-11-26T11:44:59.000Z');
  assert.equal((await get(`/owner/callback/mastodon?code=c&state=${st}`, `${cookie}; ${stale.headers.get('set-cookie').split(';')[0]}`)).status, 400, 'a state older than fifteen minutes is refused');
  const bad = await mk(f, { mastodon: { instance: 'localhost' } }); await ask(bad.ctx, 'MASTODON_TOKEN', 'm'); const br = await bad.get('/owner/go/m'); assert.equal(br.status, 502); assert.match(await br.text(), /instance host not valid/);
  const g = await get('/owner/go/need-bsky'); const gl = new URL(g.headers.get('location'));
  assert.equal(gl.origin + gl.pathname, 'https://bsky.example/authorize'); assert.deepEqual([gl.searchParams.get('request_uri'), gl.searchParams.get('client_id')], ['urn:par:1', ORIGIN + '/owner/atproto/client-metadata.json']);
  const bs = ctx.db.raw.prepare('SELECT state FROM ownerlink_state').get().state, bsc = g.headers.get('set-cookie').split(';')[0];
  assert.equal((await get(`/owner/callback/bluesky?code=c&state=${bs}&iss=https://evil.example`, `${cookie}; ${bsc}`)).status, 400, 'an answer from another issuer is refused');
  const g2 = await get('/owner/go/need-bsky'), st2 = ctx.db.raw.prepare('SELECT state FROM ownerlink_state').get().state;
  const ok = await get(`/owner/callback/bluesky?code=c&state=${st2}&iss=https://bsky.example`, `${cookie}; ${g2.headers.get('set-cookie').split(';')[0]}`); assert.equal(ok.status, 200, await ok.clone().text());
  const saved = JSON.parse(await vault.read('BLUESKY_OAUTH')); assert.deepEqual([saved.sub, saved.pds, saved.refresh_token], ['did:plc:abc123', 'https://pds.example', 'rt-1-long']); assert.ok(!(await ok.clone().text()).includes('rt-1-long'));
  await createBlueskyClient({ vault, fetch: f, now: () => T0 }).post('hello'); assert.equal(JSON.parse(await vault.read('BLUESKY_OAUTH')).refresh_token, 'rt-2-long', 'the rotated refresh token is written back');
  await assert.rejects(createBlueskyClient({ vault: { read: async () => null }, fetch: f }).post('x'), e => e.skip === true && /credentials missing/.test(e.message));
  const meta = await (await get('/owner/atproto/client-metadata.json', null)).json(); assert.deepEqual([meta.dpop_bound_access_tokens, meta.token_endpoint_auth_method, meta.scope], [true, 'none', 'atproto transition:generic']);
  const s1 = await newState(ctx, 'a', 'mastodon', { x: 1 }); assert.equal(await takeState(ctx, s1, 'bluesky'), null, 'a state is for one flow');
  assert.deepEqual((await takeState(ctx, s1, 'mastodon')).data, { x: 1 }); assert.equal(await takeState(ctx, s1, 'mastodon'), null, 'and it is taken once');
});

test('US-30-R49: an owner action may also be a settings page declared as data, open until its probe passes, or (off by default) a pull request waiting on a human reviewer; a probe or a list that cannot be read changes nothing', async () => {
  let status = 403, calls = 0;
  const f = async url => { calls++; assert.equal(String(url), 'https://models.example/catalog'); return resp(status, {}); };
  const { ctx, ol } = await mk(f, { static_actions: [{ id: 'models', title: 'Turn on Models', why: 'The org setting is off.', link: 'https://github.com/o/settings/models', probe: { url: 'https://models.example/catalog' } },
    { id: 'manual', title: 'No probe', link: 'https://example.org/x' }, { id: 'bad', title: 'Not https', link: 'http://example.org/x' }, { title: 'No id', link: 'https://example.org/y' }] });
  assert.deepEqual((await ol.step()).fixed, { open: 2, done: 0, unknown: 0 }, 'a declaration with no id or no https link is skipped');
  status = 502; assert.deepEqual((await ol.step()).fixed, { open: 2, done: 0, unknown: 1 }, 'a 5xx is unknown: the action stays as it was');
  status = 200; assert.deepEqual((await ol.step()).fixed, { open: 1, done: 1, unknown: 0 }); assert.deepEqual((await openActions(ctx)).map(a => a.id), ['s:manual'], 'no probe: it stays open until its card is closed');
  assert.deepEqual(await syncPullRequests({ db: ctx.db, now: ctx.now, env: {}, fetch: f, config: {} }), { open: 0, done: 0, skipped: 'no repositories configured' }, 'off by default');
  const prs = [{ number: 1, title: 'a', html_url: 'https://github.com/o/r/pull/1', draft: false, user: { login: 'bot' }, labels: [{ name: 'Protected-Change' }] }, { number: 2, title: 'draft', html_url: 'u', draft: true, user: { login: 'bot' }, labels: [{ name: 'protected-change' }] },
    { number: 3, title: 'plain', html_url: 'u', draft: false, user: { login: 'bot' }, labels: [] }, { number: 4, title: 'asked', html_url: 'https://github.com/o/r/pull/4', draft: false, user: { login: 'bot' }, labels: [], requested_reviewers: [{ login: 'boss' }] }];
  let reviews = [], listOk = true;
  const g = async url => { const p = String(url).replace('https://api.github.com', ''); if (p.startsWith('/repos/o/r/pulls?')) return listOk ? resp(200, prs) : resp(500, {}); if (/\/pulls\/\d+\/reviews/.test(p)) return resp(200, reviews); return resp(404, {}); };
  const c2 = { db: ctx.db, now: ctx.now, env: { GITHUB_TOKEN: 'x' }, fetch: g, config: { ownerlink: { prs: { repos: ['o/r'], owner_login: 'boss' } } } };
  assert.deepEqual(await syncPullRequests(c2), { open: 2, done: 0, unreadable: 0 }, 'labelled or requested, not drafts, not plain');
  assert.deepEqual((await openActions(c2)).filter(a => a.flow === 'pr_review').map(a => a.id), ['pr:o/r#1', 'pr:o/r#4']);
  reviews = [{ user: { login: 'bot' }, state: 'APPROVED' }]; assert.equal((await syncPullRequests(c2)).open, 2, 'the author\'s own approval is not a review');
  reviews = [{ user: { login: 'human' }, state: 'APPROVED' }, { user: { login: 'other' }, state: 'CHANGES_REQUESTED' }]; assert.equal((await syncPullRequests(c2)).open, 2, 'a request for changes keeps it open');
  listOk = false; assert.deepEqual(await syncPullRequests(c2), { open: 0, done: 0, unreadable: 1 }); assert.equal((await openActions(c2)).filter(a => a.flow === 'pr_review').length, 2, 'an unreadable list completes nothing');
  listOk = true; reviews = [{ user: { login: 'human' }, state: 'APPROVED' }]; assert.deepEqual(await syncPullRequests(c2), { open: 0, done: 2, unreadable: 0 });
  assert.equal(await syncStatic({ db: ctx.db, now: ctx.now, env: {}, fetch: f, config: {} }).then(r => r.open), 0);
});
