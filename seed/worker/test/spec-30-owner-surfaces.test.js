// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-30 (owner actions and credentials): the requirements that live on the platform's owner-facing surfaces: the sign-in of the owner (the dashboard
// Worker's emailed code and link, dashboard/ownerid.js, site/passkeys.js), the connections screen (site/connections.js) and the owner page's way of asking
// (dashboard/askbar.js, the connectors panel). The seed does not carry these files, so every test is skipped where the monorepo is absent (existsSync guard,
// as in spec-28-year-unattended.test.js). The clock is injected where the code allows it, the network is a fake, and the database is node:sqlite in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const have = existsSync(root + 'dashboard/worker.js') && existsSync(root + 'site/passkeys.js');
const opts = { skip: have ? false : 'the monorepo surfaces (dashboard/, site/) are not in this checkout' };
const load = p => import(pathToFileURL(root + p).href);

const d1 = db => ({ prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; },
  all: async () => ({ results: db.prepare(sql).all(...a) }), first: async () => db.prepare(sql).get(...a) || null,
  run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) }, changes: Number(r.changes) }; } }; return st; } });
const dashDb = () => { const db = new DatabaseSync(':memory:'); db.exec(readFileSync(root + 'dashboard/schema.sql', 'utf8')); db.exec(readFileSync(root + 'dashboard/seed.sql', 'utf8')); return { db, DB: d1(db) }; };
const sent = [];
const denv = extra => ({ ...dashDb(), OWNER_EMAIL: 'o@example.com', NO_NET: 1, MAILER: async m => { sent.push(m); }, ...(extra || {}) });
const dcall = (route, e, path, body, cookie) => route(new Request('https://ultrastable.io' + path, { method: body ? 'POST' : 'GET', headers: { 'x-us-ui': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }), e);

// ---- 4.5 The owner's identity ---------------------------------------------------------------------------------------------------------------

test('US-30-R50: GitHub sign-in proves the login is an owner, links only verified non-noreply emails as hashes, audits every event, and tells a stranger nothing about why', opts, async () => {
  const O = await load('dashboard/ownerid.js');
  const mkEnv = (login, role = 'member', extra = {}) => {
    const e = { DB: d1(new DatabaseSync(':memory:')), GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'csec', GITHUB_REPO: 'ultrastable/ultrastable', OWNER_GITHUB_LOGINS: 'boss', ...extra };
    e.FETCH = async u => { u = String(u); return u.includes('access_token') ? Response.json({ access_token: 't' }) : u.endsWith('/user') ? Response.json({ login })
      : u.includes('/memberships/') ? Response.json({ role, state: 'active' }) : Response.json([{ email: 'a@mail-one.example', verified: true }, { email: 'b@users.noreply.github.com', verified: true }, { email: 'c@mail-two.example', verified: false }]); };
    return e;
  };
  const run = async (e, state) => { const st = state ?? new URL((await O.start(e, 'https://x.test')).location).searchParams.get('state'); return O.callback(e, new URL('https://x.test/cb?code=c&state=' + st), async () => 'us_owner=minted'); };
  const unconfigured = { DB: d1(new DatabaseSync(':memory:')) };
  assert.deepEqual(await O.start(unconfigured, 'https://x.test'), { status: 302, location: 'https://x.test/owner' }, 'no OAuth app is bound: the person goes to the sign-in page, and no GitHub App is ever registered');
  assert.equal((await O.auditTail(unconfigured))[0].event, 'github_signin_unconfigured');
  const e = mkEnv('boss'), s = await O.start(e, 'https://x.test'), q = new URL(s.location);
  assert.equal(q.origin + q.pathname, 'https://github.com/login/oauth/authorize'); assert.equal(q.searchParams.get('scope'), 'read:org user:email'); assert.equal(q.searchParams.get('redirect_uri'), 'https://x.test/api/owner/github/callback');
  const ok = await O.callback(e, new URL('https://x.test/cb?code=c&state=' + q.searchParams.get('state')), async () => 'us_owner=minted');
  assert.deepEqual([ok.status, ok.location, ok.cookie], [302, '/owner', 'us_owner=minted']);
  assert.equal(await O.linkCount(e), 1, 'one verified, non-noreply address is linked, and only as a hash');
  const row = await e.DB.prepare('SELECT * FROM owner_links').first(); assert.equal(row.label, 'a…@mail-one.example'); assert.match(row.hash, /^[0-9a-f]{64}$/); assert.ok(!JSON.stringify(row).includes('a@mail-one.example'));
  assert.deepEqual((await O.auditTail(e)).map(x => x.event).sort(), ['github_signin', 'identifier_linked']);
  assert.equal((await run(e, q.searchParams.get('state'))).status, 401, 'a state is single use');
  const stranger = await run(mkEnv('stranger')); assert.equal(stranger.status, 401); assert.ok(!/stranger|owner/i.test(JSON.stringify(stranger.body)), 'the denial names neither the login nor the role');
  assert.equal((await run(mkEnv('stranger', 'admin'))).status, 302, 'an active organization admin is an owner');
  assert.equal((await run(mkEnv('stranger', 'member'))).status, 401);
  const old = mkEnv('boss'), st = new URL((await O.start(old, 'https://x.test')).location).searchParams.get('state');
  await old.DB.prepare('UPDATE oauth_state SET created_at = ?1').bind(Date.now() - 601e3).run();
  assert.equal((await run(old, st)).status, 401, 'a state older than ten minutes is refused');
  assert.equal(O.mask('alice@example.com'), 'al…@example.com'); assert.deepEqual(O.ownerLogins({ OWNER_GITHUB_LOGINS: ' A, b ,' }), ['a', 'b']);
  for (const f of ['dashboard/ownerid.js', 'dashboard/worker.js', 'site/passkeys.js', 'site/connections.js']) assert.doesNotMatch(readFileSync(root + f, 'utf8'), /settings\/apps\/new|app-manifests/, f + ' can register no GitHub App');
});

test('US-30-R51: the owner signs in with an emailed code or link: six digits, ten minutes, one use, a limit on requests and on wrong guesses; a mail scanner opening the link signs nobody in; a change needs a code from the last fifteen minutes', opts, async () => {
  const { route, safeOwnerNext } = await load('dashboard/worker.js');
  const e = denv(), call = (p, b, c) => dcall(route, e, p, b, c);
  sent.length = 0; assert.equal((await call('/api/owner/code', {})).status, 200);
  const code = /code is (\d{6})/.exec(sent[0].text)[1]; assert.match(sent[0].text, /api\/owner\/magic\?id=[0-9a-f]+&c=\d{6}/); assert.match(sent[0].text, /works for 10 minutes/);
  assert.equal((await call('/api/owner/verify', { code: '12ab' })).status, 400);
  assert.equal((await call('/api/owner/verify', { code: code === '000000' ? '000001' : '000000' })).status, 401, 'a wrong guess is refused and counted');
  const ok = await call('/api/owner/verify', { code }); assert.equal(ok.status, 200); const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /^us_owner=[0-9a-f]{64}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict$/);
  assert.equal((await call('/api/owner/verify', { code })).status, 401, 'a code is used once');
  const ck = cookie.split(';')[0];
  e.db.exec('UPDATE sessions SET stepup_at = stepup_at - 1000000');  // lapse the fifteen-minute step-up
  const needs = await (await call('/api/owner/run', { cmd: 'done gh-24' }, ck)).json(); assert.equal(needs.needs_code, true); assert.match(needs.out, /needs a code emailed in the last 15 minutes/);
  assert.equal((await (await call('/api/owner/run', { cmd: 'tasks owner' }, ck)).json()).ok, true, 'a read needs no fresh code');
  const e2 = denv(); let last; for (let i = 0; i < 6; i++) last = await dcall(route, e2, '/api/owner/code', {}); assert.equal(last.status, 429, 'five codes in ten minutes, then a pause');
  const e4 = denv(); for (let i = 0; i < 4; i++) { await dcall(route, e4, '/api/owner/code', {}); assert.equal((await dcall(route, e4, '/api/owner/verify', { code: '000000' })).status, 401); }
  await dcall(route, e4, '/api/owner/code', {}); const locked = await dcall(route, e4, '/api/owner/verify', { code: '000000' }); assert.equal(locked.status, 429); assert.match((await locked.json()).error, /too many wrong codes/, 'repeated wrong guesses lock the sign-in for a while');
  const e3 = denv(); sent.length = 0; const nx = '/connect/mastodon/start?instance=mstdn.science';
  assert.equal((await dcall(route, e3, '/api/owner/code', { next: nx })).status, 200);
  const link = /(https:\/\/ultrastable\.io\/api\/owner\/magic\?[^\s]+)/.exec(sent[0].text)[1], u = new URL(link); assert.equal(u.searchParams.get('next'), nx);
  const peek = await route(new Request(link), e3); assert.equal(peek.status, 200); assert.match(await peek.text(), /<form method=post/);
  assert.equal(e3.db.prepare('SELECT used FROM otp ORDER BY created_at DESC LIMIT 1').get().used, 0, 'opening the link signs nobody in');
  const post = await route(new Request(link, { method: 'POST' }), e3); assert.equal(post.status, 303); assert.equal(post.headers.get('location'), nx); assert.match(post.headers.get('set-cookie'), /us_owner=/);
  assert.equal((await route(new Request(link, { method: 'POST' }), e3)).status, 401);
  for (const n of ['//evil.example', 'https://evil.example', '/\\evil', '/api/owner/state', '', null, 'connect/x']) assert.equal(safeOwnerNext(n), null, String(n));
  assert.equal(safeOwnerNext('/connections'), '/connections');
  assert.equal((await route(new Request('https://ultrastable.io/api/owner/code', { method: 'POST' }), denv())).status, 400, 'a POST without the UI header is refused');
  const bad = denv({ MAILER: async () => { throw new Error('mail relay: suppressed bounce at smtp.internal'); } });
  const fail = await dcall(route, bad, '/api/owner/code', {}); const fb = await fail.json();
  assert.equal(fail.status, 502); assert.ok(!/smtp|relay|bounce/i.test(fb.error), 'the person gets plain words; the detail goes to the provenance ledger');
  assert.equal(bad.db.prepare("SELECT COUNT(*) c FROM provenance WHERE kind = 'incident'").get().c, 1);
});

// A software WebAuthn authenticator: just enough CBOR and COSE to drive the real ceremonies against site/passkeys.js.
const enc = new TextEncoder();
const b64u = u8 => Buffer.from(u8).toString('base64url'), unb64u = s => new Uint8Array(Buffer.from(s, 'base64url'));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const sha = async d => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof d === 'string' ? enc.encode(d) : d));
const head = (mt, n) => n < 24 ? [mt << 5 | n] : n < 256 ? [mt << 5 | 24, n] : [mt << 5 | 25, n >> 8, n & 255];
const C = v => v instanceof Uint8Array ? cat(Uint8Array.from(head(2, v.length)), v) : typeof v === 'string' ? cat(Uint8Array.from(head(3, enc.encode(v).length)), enc.encode(v)) : typeof v === 'number' ? Uint8Array.from(v >= 0 ? head(0, v) : head(1, -1 - v)) : cat(Uint8Array.from(head(5, v.size)), ...[...v].flatMap(([k, x]) => [C(k), C(x)]));
const der = raw => { const t = x => { let i = 0; while (i < x.length - 1 && x[i] === 0) i++; let v = x.slice(i); if (v[0] & 0x80) v = cat(Uint8Array.of(0), v); return cat(Uint8Array.of(2, v.length), v); }; const r = t(raw.slice(0, 32)), s = t(raw.slice(32)); return cat(Uint8Array.of(0x30, r.length + s.length), r, s); };
const ORIGIN = 'https://ultrastable.io';
class Authenticator {
  async init() { this.kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']); this.id = crypto.getRandomValues(new Uint8Array(16)); this.counter = 0; return this; }
  async create(opts, origin = ORIGIN, flags = 0x45) {
    const jwk = await crypto.subtle.exportKey('jwk', this.kp.publicKey);
    const authData = cat(await sha(opts.rp.id), Uint8Array.of(flags), new Uint8Array(4), new Uint8Array(16), Uint8Array.of(0, this.id.length), this.id, C(new Map([[1, 2], [3, -7], [-1, 1], [-2, unb64u(jwk.x)], [-3, unb64u(jwk.y)]])));
    const cdj = enc.encode(JSON.stringify({ type: 'webauthn.create', challenge: opts.challenge, origin }));
    return { id: b64u(this.id), response: { clientDataJSON: b64u(cdj), attestationObject: b64u(C(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))) } };
  }
  async get(opts, { origin = ORIGIN, counter = ++this.counter, flags = 0x05 } = {}) {
    const authData = cat(await sha(opts.rpId), Uint8Array.of(flags), Uint8Array.of(counter >>> 24, counter >>> 16 & 255, counter >>> 8 & 255, counter & 255));
    const cdj = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: opts.challenge, origin }));
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.kp.privateKey, cat(authData, await sha(cdj))));
    return { id: b64u(this.id), response: { clientDataJSON: b64u(cdj), authenticatorData: b64u(authData), signature: b64u(der(sig)) } };
  }
}

test('US-30-R52: a passkey is enrolled only from an owner session and signs the owner in with one tap: user verification, origin, relying party, a single-use challenge and an advancing counter are all enforced, credentials are sealed, and removal needs a fresh sign-in', opts, async () => {
  const pk = await load('site/passkeys.js');
  const db = new DatabaseSync(':memory:'), env = { DB: d1(db), CREDENTIAL_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') };
  const call = async (path, body, cookie) => { const r = await pk.passkeys(new Request(ORIGIN + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env); return { s: r.status, j: await r.json().catch(() => ({})), h: r.headers, r }; };
  assert.equal((await call('/auth/passkey/list')).s, 401); assert.equal((await call('/auth/passkey/register/options', {})).s, 401, 'the first passkey is enrolled through an owner session');
  const session = async (stepupAgeMs = 0) => { const tok = 't' + Math.random().toString(16).slice(2).padEnd(30, '0'); const h = Buffer.from(await sha(tok)).toString('hex'); db.prepare('INSERT INTO sessions VALUES (?,?,?,0)').run(h, Date.now(), Date.now() - stepupAgeMs); return 'us_owner=' + tok; };
  const auth = await new Authenticator().init(), ck = await session();
  const o = await call('/auth/passkey/register/options', {}, ck); assert.equal(o.s, 200);
  assert.deepEqual([o.j.publicKey.rp.id, o.j.publicKey.authenticatorSelection.userVerification, o.j.publicKey.authenticatorSelection.residentKey, o.j.publicKey.attestation, o.j.publicKey.pubKeyCredParams[0].alg], ['ultrastable.io', 'required', 'required', 'none', -7]);
  const reg = await auth.create(o.j.publicKey); assert.equal((await call('/auth/passkey/register/verify', reg, ck)).s, 200);
  assert.match(db.prepare('SELECT sealed FROM passkeys').get().sealed, /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/, 'the credential key is sealed at rest');
  assert.equal((await call('/auth/passkey/register/verify', reg, ck)).s, 400, 'a challenge is single use');
  for (const [mut, why] of [[{ origin: 'https://evil.example' }, 'origin'], [{ flags: 0x41 }, 'no user verification']]) { const a2 = await new Authenticator().init(); const o2 = await call('/auth/passkey/register/options', {}, ck); assert.equal((await call('/auth/passkey/register/verify', await a2.create(o2.j.publicKey, mut.origin || ORIGIN, mut.flags || 0x45), ck)).s, 400, why); }
  const lo = await call('/auth/passkey/login/options', {}); assert.deepEqual([lo.j.publicKey.rpId, lo.j.publicKey.allowCredentials, lo.j.registered], ['ultrastable.io', [], 1]);
  const assertion = await auth.get(lo.j.publicKey);
  const lv = await call('/auth/passkey/login/verify', { ...assertion, next: '/oauth/authorize?x=1' });
  assert.equal(lv.s, 200); assert.equal(lv.j.next, '/oauth/authorize?x=1'); assert.match(lv.h.get('set-cookie'), /^us_owner=[0-9a-f]{64}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict$/);
  const subj = await pk.currentSubject(new Request(ORIGIN + '/x', { headers: { cookie: lv.h.get('set-cookie').split(';')[0] } }), env); assert.deepEqual([subj.sub, subj.fresh], ['owner', true]);
  assert.equal((await call('/auth/passkey/login/verify', assertion)).s, 400, 'a replayed assertion is refused: its challenge was consumed');
  const bad = async (mut, o2) => { const x = await call('/auth/passkey/login/options', {}); const a = await auth.get(x.j.publicKey, o2); return (await call('/auth/passkey/login/verify', mut ? mut(a) : a)).s; };
  assert.equal(await bad(null, { origin: 'https://evil.example' }), 400); assert.equal(await bad(null, { flags: 0x01 }), 400, 'no user verification'); assert.equal(await bad(null, { counter: 1 }), 400, 'the counter went backwards: a cloned authenticator');
  assert.equal(await bad(a => ({ ...a, id: b64u(crypto.getRandomValues(new Uint8Array(16))) })), 400, 'an unknown credential');
  assert.equal(await bad(a => { const s = unb64u(a.response.signature).slice(); s[s.length - 1] ^= 1; return { ...a, response: { ...a.response, signature: b64u(s) } }; }), 400, 'a tampered signature');
  const ev = await call('/auth/passkey/login/verify', { ...(await auth.get((await call('/auth/passkey/login/options', {})).j.publicKey, { counter: 60 })), next: '//evil.example/x' }); assert.equal(ev.j.next, '/owner', 'no open redirect');
  const stale = await session(3600e3);
  assert.equal((await call('/auth/passkey/list', undefined, stale)).j.passkeys.length, 1);
  assert.equal((await call('/auth/passkey/remove', { id: reg.id }, stale)).s, 403, 'removal needs a fresh sign-in');
  assert.equal((await call('/auth/passkey/remove', { id: reg.id }, ck)).s, 200); assert.equal(db.prepare('SELECT COUNT(*) c FROM passkeys').get().c, 0);
  const none = await call('/auth/passkey/login/options', {}); assert.equal(none.j.registered, 0, 'the page says so when no passkey was ever added');
  for (let i = 0; i < 10; i++) db.prepare('INSERT INTO passkeys(id,sealed,sign_count,label,created_at) VALUES (?,?,?,?,?)').run('p' + i, 's', 0, 'x', Date.now());
  const full = await call('/auth/passkey/register/options', {}, ck); assert.equal(full.s, 409); assert.match(full.j.error, /ten passkeys is the limit/); db.exec('DELETE FROM passkeys');
  const t = Date.now() + 3e5; for (let i = 0; i < 50; i++) db.prepare("INSERT INTO passkey_challenges(id,kind,expires_at) VALUES (?, 'login', ?)").run('c' + i, t);
  assert.equal((await call('/auth/passkey/login/options', {})).s, 429, 'fifty open challenges at most: a flood is refused'); db.exec('DELETE FROM passkey_challenges');
  const a3 = await new Authenticator().init(), o3 = await call('/auth/passkey/register/options', {}, ck);
  const noKey = await pk.passkeys(new Request(ORIGIN + '/auth/passkey/register/verify', { method: 'POST', headers: { cookie: ck, 'content-type': 'application/json' }, body: JSON.stringify(await a3.create(o3.j.publicKey)) }), { ...env, CREDENTIAL_KEY: undefined });
  assert.equal(noKey.status, 400); const nk = await noKey.json(); assert.ok(!/CREDENTIAL_KEY/.test(JSON.stringify(nk)), 'a missing key is answered in plain words');
  assert.equal((await pk.passkeys(new Request('https://example.com/auth/signin'), env)), null, 'only the platform hosts answer');
});

// ---- 4.4 The connections screen -------------------------------------------------------------------------------------------------------------

test('US-30-R43: the connections screen is the owner\'s: anonymous visitors are sent to sign in with the page they wanted, services and agents are listed with a one-click disconnect or revoke that takes only that client\'s access and refuses another site, and the consent flow is forwarded with the canonical origin', opts, async () => {
  const { connectionsRoute, listAgents, revokeAgent, renderConnections, gatedForward } = await load('site/connections.js');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE oauth_clients (client_id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE oauth_tokens (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, family TEXT NOT NULL, client_id TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0);
    INSERT INTO oauth_clients VALUES ('c1','VS Code <b>Copilot</b>','[]','dcr',1);
    INSERT INTO oauth_tokens VALUES ('h1','access','f','c1','s','r',9999999999999,0,0),('h2','refresh','f','c1','s','r',9999999999999,0,0),('h3','access','g','c2','s','r',9999999999999,0,0),('h4','access','x','old','s','r',1,0,0);`);
  const calls = [];
  const TICK = { fetch: async req => { const u = new URL(req.url); calls.push([req.method, u.pathname + u.search, req.headers.get('x-internal-key')]);
    return u.pathname === '/auth/connectors' ? Response.json({ linked: [{ provider: 'oauth:google', kind: 'oauth', status: 'ok' }, { provider: 'oauth:mcp:ex.com', kind: 'mcp', server: 'https://ex.com/mcp', status: 'ok' }, { provider: 'github-app', kind: 'github-app', status: 'ok' }],
      available: [{ id: 'microsoft', title: 'Microsoft', connect: '/connect/microsoft', ready: false, linked: false }, { id: 'mcp', title: 'MCP', ready: true, linked: false }] }) : new Response('tick:' + u.pathname); } };
  const env = { DB: d1(db), TICK, INTERNAL_DEPLOY_KEY: 'real' }, R = (p, init) => new Request('https://ultrastable.io' + p, init);
  const signedIn = async () => ({ sub: 'owner', fresh: true }), anon = async () => null;
  const form = o => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
  assert.equal(await connectionsRoute(R('/pricing'), env, { subject: signedIn }), null); assert.equal(await connectionsRoute(new Request('https://evil.example/connections'), env, { subject: signedIn }), null);
  const bounce = await connectionsRoute(R('/connect/bluesky'), env, { subject: anon }); assert.equal(bounce.status, 302); assert.equal(new URL(bounce.headers.get('location')).searchParams.get('next'), '/connect/bluesky'); assert.equal(calls.length, 0, 'nothing is proxied without a session');
  assert.equal((await connectionsRoute(R('/connections/agent/revoke', form({ client_id: 'c1' })), env, { subject: anon })).status, 302); assert.equal(db.prepare('SELECT COUNT(*) n FROM oauth_tokens WHERE revoked = 1').get().n, 0);
  const page = await (await connectionsRoute(R('/connections'), env, { subject: signedIn, now: 1000 })).text();
  assert.match(page, /oauth:google/); assert.match(page, /https:\/\/ex\.com\/mcp/); assert.match(page, /VS Code &lt;b&gt;Copilot&lt;\/b&gt;/); assert.ok(!/<b>Copilot/.test(page)); assert.match(page, /2 active sign-ins/); assert.match(page, /waiting for its one-time app registration/);
  assert.ok(!/name="provider" value="github-app"/.test(page), 'the GitHub App has no disconnect here'); assert.ok(!/\bpaste\b/i.test(page)); assert.equal((await listAgents(env, 1000)).find(a => a.client_id === 'old'), undefined, 'an expired token is not access');
  assert.equal((await connectionsRoute(R('/connections/agent/revoke', { ...form({ client_id: 'c1' }), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' } }), env, { subject: signedIn })).status, 403);
  assert.equal((await connectionsRoute(R('/connections/agent/revoke', form({ client_id: 'c1' })), env, { subject: signedIn })).status, 303);
  assert.deepEqual([db.prepare("SELECT COUNT(*) n FROM oauth_tokens WHERE client_id = 'c1' AND revoked = 1").get().n, db.prepare("SELECT COUNT(*) n FROM oauth_tokens WHERE client_id <> 'c1' AND revoked = 1").get().n, await revokeAgent(env, 'c1')], [2, 0, 0], 'only that client, and idempotent');
  calls.length = 0;
  assert.equal((await connectionsRoute(R('/connections/service/disconnect', form({ provider: 'oauth:mcp:ex.com', kind: 'mcp' })), env, { subject: signedIn })).status, 303); assert.equal(calls[0][1], '/connect/mcp/disconnect?provider=oauth%3Amcp%3Aex.com');
  assert.equal((await connectionsRoute(R('/connections/service/disconnect', form({ provider: 'github-app', kind: 'github-app' })), env, { subject: signedIn })).status, 400);
  calls.length = 0; await connectionsRoute(R('/connect/google/start'), env, { subject: signedIn }); await connectionsRoute(R('/connect/google/callback?code=x&state=y'), env, { subject: anon });
  assert.deepEqual(calls.map(c => c[1]), ['/connect/google/start', '/connect/google/callback?code=x&state=y']); assert.deepEqual(calls.map(c => c[2]), ['real', 'real'], 'the owner gate\'s key rides along');
  let seen; const e2 = { ...env, TICK: { fetch: async r => { seen = r.url; return new Response('ok'); } } };
  await connectionsRoute(new Request('https://ultrastable-site.ultrastable.workers.dev/connect/bluesky/callback?code=a&state=b'), e2, { subject: anon }); assert.equal(seen, 'https://ultrastable.io/connect/bluesky/callback?code=a&state=b');
  const forged = gatedForward(new Request('https://ultrastable.io/connect/buffer', { headers: { 'x-internal-key': 'forged' } }), new URL('https://ultrastable.io/connect/buffer'), { INTERNAL_DEPLOY_KEY: 'real' }); assert.equal(forged.headers.get('x-internal-key'), 'real');
  assert.equal(gatedForward(new Request('https://ultrastable.io/connect/buffer', { headers: { 'x-internal-key': 'forged' } }), new URL('https://ultrastable.io/connect/buffer'), {}).headers.get('x-internal-key'), null, 'a client-sent key never survives');
  assert.ok(renderConnections({ linked: [], available: [] }, []).includes('No services linked yet'));
});

// ---- 4.7 Plain words, 4.8 Direction ----------------------------------------------------------------------------------------------------------

test('US-30-R62: the owner page shows each connection with a link per service, marks one that failed or carries an error as needing a reconnect, keeps raw backend text and metadata on the server, and says in plain words when the status is unreachable', opts, async () => {
  const { connectorsPanel, route } = await load('dashboard/worker.js');
  // The statuses are the ones the seed's credential store writes ('ok', 'pending', 'failed'; seed/worker/src/auth/store.js), never an invented one.
  const TICK = { fetch: async () => Response.json({ linked: [{ provider: 'github-app', status: 'ok', expires_at: 1, last_error: null, meta: 'secret-ish' }, { provider: 'oauth:google', status: 'ok', last_error: 'invalid_grant: token revoked at https://oauth2.internal' }, { provider: 'oauth:x', status: 'failed' }],
    available: [{ id: 'mastodon', title: 'Mastodon', type: 'oauth', ready: true, linked: false }, { id: 'github', title: 'GitHub', connect: '/connect/github', ready: true, linked: true }] }) };
  const p = await connectorsPanel({ TICK }, 'https://ultrastable.io');
  assert.deepEqual(p.linked.map(l => [l.provider, l.status, l.expires_at]), [['github-app', 'ok', 1], ['oauth:google', 'ok', null], ['oauth:x', 'failed', null]]);
  assert.equal(p.linked.find(l => l.provider === 'oauth:google').reconnect, true, 'an error means a reconnect'); assert.equal(p.linked.find(l => l.provider === 'oauth:x').reconnect, true, 'a failed status means a reconnect');
  assert.ok(!/invalid_grant|secret-ish|internal/.test(JSON.stringify(p)), 'raw backend text and metadata stay on the server');
  assert.equal(p.available.find(a => a.id === 'mastodon').connect, 'https://ultrastable.io/connect/mastodon'); assert.equal(p.error, null);
  const down = await connectorsPanel({ TICK: { fetch: async () => new Response('x', { status: 503 }) } }, 'https://ultrastable.io');
  assert.match(down.error, /not reachable right now\. The system retries by itself/); assert.deepEqual(down.linked, []);
  assert.match((await connectorsPanel({}, 'https://ultrastable.io')).error, /not reachable/, 'no binding is the same plain answer');
  assert.equal((await dcall(route, denv({ TICK }), '/api/owner/connectors')).status, 401, 'the panel needs a session');
});

// connectorsPanel compares the status with the seed's own values ('ok', 'pending', 'failed'; seed/worker/src/auth/store.js): only 'ok' with no error is connected.
test('US-30-R62: a healthy connection (status ok, no error) is not marked as needing a reconnect, a pending one is', opts, async () => {
  const { connectorsPanel } = await load('dashboard/worker.js');
  const TICK = { fetch: async () => Response.json({ linked: [{ provider: 'github-app', status: 'ok', last_error: null }, { provider: 'oauth:slack', status: 'pending', last_error: null }], available: [] }) };
  const p = await connectorsPanel({ TICK }, 'https://ultrastable.io');
  assert.deepEqual(p.linked.map(l => [l.provider, l.reconnect]), [['github-app', false], ['oauth:slack', true]]);
});

test('US-30-R63 and US-30-R64: the owner page asks before it acts only where the answer changes the plan, at most three either/or questions, takes what the record already settles, prunes a question whose answer never changed the plan, and logs each answer', opts, async () => {
  const A = await load('dashboard/askbar.js');
  const ctx = { commands: ['status', 'help'], tenants: ['ps', 'Practical Solutions'], stats: {} };
  assert.deepEqual(A.clarify('stop the outreach lane', ctx).questions.map(q => q.id), ['pause-or-remove', 'one-or-all']);
  assert.deepEqual(A.clarify('Which pages got the most views?', ctx).questions, [], 'a question gets no questions'); assert.deepEqual(A.clarify('status', ctx).questions, [], 'a registered command gets none');
  assert.deepEqual(A.clarify('pause the outreach lane for now on Practical Solutions', ctx).questions, [], 'a direction that already answers both asks nothing');
  assert.equal(A.MAX_QUESTIONS, 3); for (const q of A.QUESTIONS) { assert.equal(q.options.length, 2, q.id); assert.ok(q.options.includes(q.default), q.id); }
  const many = A.clarify('build a thing and remove the old one', ctx); assert.ok(many.questions.length <= 3);
  assert.equal(many.questions.length + many.assumed.length, A.QUESTIONS.filter(q => q.when('build a thing and remove the old one', ctx)).length, 'nothing is dropped silently: a question not asked is assumed at its default and said so');
  const pending = A.resolve('stop the outreach lane', { 'pause-or-remove': 'Pause' }, ctx); assert.deepEqual(pending.pending.map(q => q.id), ['one-or-all']);
  assert.equal(A.resolve('stop the outreach lane', { 'pause-or-remove': 'Maybe', 'one-or-all': 'Every system' }, ctx).pending.length, 1, 'an answer that is not an option is not an answer');
  const r = A.resolve('stop the outreach lane', { 'pause-or-remove': 'Remove', 'one-or-all': 'Only Ultrastable' }, ctx);
  assert.equal(r.line, 'stop the outreach lane. Remove it for good. Apply it to Ultrastable itself only.'); assert.match(r.understood, /^You said: stop the outreach lane\./);
  assert.deepEqual(r.log.map(l => [l.qid, l.answer, l.changed, l.source]), [['pause-or-remove', 'Remove', 1, 'asked'], ['one-or-all', 'Only Ultrastable', 0, 'asked']]);
  const q = A.QUESTIONS.find(x => x.id === 'pause-or-remove'), settled = { 'pause-or-remove': { asked: A.SETTLED, changed: A.SETTLED, recent: Array(A.SETTLED).fill('Remove') } };
  assert.deepEqual(A.standing(q, settled), { answer: 'Remove', source: 'record' }); assert.equal(A.standing(q, { 'pause-or-remove': { asked: 2, changed: 1, recent: ['Pause', 'Remove'] } }), null, 'answers that disagree keep the question');
  assert.deepEqual(A.clarify('stop the outreach lane', { ...ctx, stats: settled }).questions.map(x => x.id), ['one-or-all']);
  assert.match(A.resolve('stop the outreach lane', { 'one-or-all': 'Only Ultrastable' }, { ...ctx, stats: settled }).understood, /Assumed Remove .* because your last answers to this agreed\./);
  const never = { 'one-or-all': { asked: A.PRUNE_AFTER, changed: 0, recent: ['Only Ultrastable', 'Every system'] } };
  assert.deepEqual(A.standing(A.QUESTIONS.find(x => x.id === 'one-or-all'), never), { answer: 'Only Ultrastable', source: 'pruned' });
  assert.deepEqual(A.score(never).find(x => x.id === 'one-or-all'), { id: 'one-or-all', question: A.QUESTIONS.find(x => x.id === 'one-or-all').q, asked: 5, changed: 0, changed_share: 0, state: 'pruned' });
  const { route } = await load('dashboard/worker.js'), e = denv(); sent.length = 0;
  await dcall(route, e, '/api/owner/code', {}); const ck = (await dcall(route, e, '/api/owner/verify', { code: /code is (\d{6})/.exec(sent[0].text)[1] })).headers.get('set-cookie').split(';')[0];
  const first = await (await dcall(route, e, '/api/owner/ask', { direction: 'stop the outreach lane' }, ck)).json(); assert.equal(first.ask, true);
  assert.deepEqual([e.db.prepare('SELECT COUNT(*) n FROM ask_log').get().n, e.db.prepare('SELECT COUNT(*) n FROM audit').get().n], [0, 0], 'asking records nothing and runs nothing');
  const done = await (await dcall(route, e, '/api/owner/ask', { direction: 'stop the outreach lane', answers: { 'pause-or-remove': 'Remove', 'one-or-all': 'Only Ultrastable' } }, ck)).json();
  assert.match(done.line, /Remove it for good/); assert.deepEqual(e.db.prepare('SELECT qid, answer, changed FROM ask_log ORDER BY id').all().map(x => [x.qid, x.answer, x.changed]), [['pause-or-remove', 'Remove', 1], ['one-or-all', 'Only Ultrastable', 0]]);
  assert.equal((await dcall(route, e, '/api/owner/ask', { direction: 'stop the outreach lane' })).status, 401, 'asking needs a session');
});
