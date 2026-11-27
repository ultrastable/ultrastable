// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Issue #201 (routes and ports): every mounted route is owner-only, every port is supplied by the composition root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../_shared/testdb.js';
import { OUT_DIR } from '../../tools/build_migrations.mjs';
import { createOrg } from './index.js';
import { SURFACE_ROUTES, SURFACE_STEPS } from './surfaces.js';

const TOKEN = 'console-token-for-tests';
const T0 = Date.parse('2026-11-19T10:00:00Z');
const ORIGIN = 'https://org.example.test';
const config = (over = {}) => ({ org_slug: 'surfaces-org', runner: { enabled: false }, ...over });

function boot({ cfg = config(), env = { CONSOLE_TOKEN: TOKEN }, extra = {} } = {}) {
  const db = makeDb([OUT_DIR]);
  const clock = { t: T0 };
  const org = createOrg({ db, env, config: cfg, fetch: async () => new Response('{}'), now: () => clock.t, ...extra });
  return { db, org, clock };
}
const req = (path, { method = 'GET', authed = false, origin, body } = {}) => new Request(ORIGIN + path, {
  method,
  headers: { ...(authed ? { cookie: `us_console=${encodeURIComponent(TOKEN)}` } : {}), ...(origin ? { origin } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const step = (org, name) => org.extraSteps().find(s => s.name === name);
const runStep = async (org, name) => { const notes = []; await step(org, name).run(null, { notes }); return notes; };

test('the routes are owner-only: anonymous callers get a sign-in refusal, never the data', async () => {
  const { org } = boot();
  for (const path of ['/api/console/walkthrough', '/api/console/profile', '/api/console/readback', '/api/console/proxy', '/console/dashboard', '/console/dashboard/api/state', '/console/dashboard/health']) {
    const r = await org.handle(req(path));
    assert.ok(r.status === 401, `${path} refused anonymous callers, got ${r.status}`);
  }
});

test('walkthrough: the signed-in owner gets step 1 (the one question) and the profile', async () => {
  const { org } = boot();
  const w = await org.handle(req('/api/console/walkthrough', { authed: true }));
  assert.equal(w.status, 200);
  const j = await w.json();
  assert.ok(j.step === 1 || j.step?.n === 1 || JSON.stringify(j).includes('What do you want to exist'), 'step 1 asks the one question: ' + JSON.stringify(j).slice(0, 200));
  assert.equal((await org.handle(req('/api/console/profile', { authed: true }))).status, 200);
  // GET /api/console keeps its own data and gains `screens` (profile applied, Ask cards folded in)
  const c = await (await org.handle(req('/api/console', { authed: true }))).json();
  assert.ok(c.now && c.needs_you && c.screens?.now?.numbers && c.screens.profile, 'console data intact plus screens');
  // a write must come from the same origin (the walkthrough's own check still applies behind the console's)
  const bad = await org.handle(req('/api/console/walkthrough/idea', { method: 'POST', authed: true, origin: 'https://evil.example.test', body: { text: 'x' } }));
  assert.equal(bad.status, 403);
});

test('dashboard: page, state, loop and health under /console/dashboard; a cross-origin refresh is refused', async () => {
  const { org } = boot();
  const page = await org.handle(req('/console/dashboard', { authed: true }));
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const state = await org.handle(req('/console/dashboard/api/state', { authed: true }));
  assert.equal(state.status, 200);
  assert.ok('loop' in (await state.json()));
  assert.equal((await org.handle(req('/console/dashboard/api/loop', { authed: true }))).status, 200);
  assert.equal((await org.handle(req('/console/dashboard/api/refresh', { method: 'POST', authed: true, origin: 'https://evil.example.test' }))).status, 403);
  assert.equal((await org.handle(req('/console/dashboard/api/refresh', { method: 'POST', authed: true, origin: ORIGIN }))).status, 200);
});

test('proxy guide: status route is owner-only and the step files one card per step a person must do, once', async () => {
  const { org, db } = boot({ cfg: config({ doors: { proxy: { intended: 'cloudflare-access' } } }) });
  const status = await org.handle(req('/api/console/proxy', { authed: true }));
  assert.equal(status.status, 200);
  const st = await status.json();
  assert.equal(st.kind, 'cloudflare-access');
  assert.equal(st.ready, false);
  const n0 = db.raw.prepare(`SELECT COUNT(*) n FROM gate_cards WHERE id LIKE 'proxy-%'`).get().n;
  await runStep(org, 'proxy_guide');
  const n1 = db.raw.prepare(`SELECT COUNT(*) n FROM gate_cards WHERE id LIKE 'proxy-%'`).get().n;
  await runStep(org, 'proxy_guide');
  assert.ok(n1 > n0, 'cards filed for the steps a person must do');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM gate_cards WHERE id LIKE 'proxy-%'`).get().n, n1, 'idempotent');
  // no proxy named: a note, not a failure
  const none = boot().org;
  assert.match((await runStep(none, 'proxy_guide'))[0], /no identity-aware proxy named/);
});

test('model port: aliases resolve to environment or injected endpoints; a failing deploy check is thrown so the tick files it', async () => {
  const endpoint = async () => ({ text: 'ok', tokens_in: 1, tokens_out: 1 });
  const aliases = { medium: { endpoint: 'a', model: 'm1', family: 'fam-a' }, large: { endpoint: 'b', model: 'm2', family: 'fam-b' } };
  const good = boot({ cfg: config({ modelport: { aliases } }), extra: { endpoints: { a: endpoint, b: endpoint } } });
  assert.match((await runStep(good.org, 'modelport'))[0], /modelport: ok, doer fam-a, reviewer fam-b/);
  assert.equal((await good.org.models.complete('medium', { messages: [] })).ok, true);
  // reviewer and doer on one family while two are available: the check fails and the step throws
  const bad = boot({ cfg: config({ modelport: { aliases: { ...aliases, large: { endpoint: 'b', model: 'm2', family: 'fam-a' }, small: { endpoint: 'a', model: 'm3', family: 'fam-c' } } } }), extra: { endpoints: { a: endpoint, b: endpoint } } });
  await assert.rejects(() => runStep(bad.org, 'modelport'), /deploy check failed/);
  // no aliases configured: the step is not added, nothing idles silently
  assert.equal(step(boot().org, 'modelport'), undefined);
});

test('role runtime: queued dispatches go to the injected handler through the model port', async () => {
  const endpoint = async () => ({ text: 'done', tokens_in: 2, tokens_out: 3 });
  const aliases = { medium: { endpoint: 'a', model: 'm1', family: 'fam-a' }, large: { endpoint: 'a', model: 'm2', family: 'fam-a' } };
  const seen = [];
  const { org, db } = boot({ cfg: config({ modelport: { aliases } }), extra: { endpoints: { a: endpoint }, roleHandlers: { default: async ({ item, complete }) => { seen.push(item.id); const r = await complete({ messages: [] }); return { ok: r.ok, detail: r.text }; } } } });
  const ts = '2026-11-19 10:00:00';
  db.raw.prepare(`INSERT INTO roles (id, role, tick_every, model) VALUES ('r1','doer',1,'medium')`).run();
  db.raw.prepare(`INSERT INTO items (id, title, owner_role, done_check, created_at, updated_at) VALUES ('I-1','t','doer','d',?,?)`).run(ts, ts);
  db.raw.prepare(`INSERT INTO dispatches (tick_id, item_id, role_id, model, status) VALUES (1,'I-1','r1','medium','queued')`).run();
  assert.match((await runStep(org, 'role_runtime'))[0], /"done":1/);
  assert.deepEqual(seen, ['I-1']);
  assert.equal(db.raw.prepare(`SELECT tokens_in, tokens_out FROM modelport_runs`).get().tokens_out, 3);
});

test('stage 2: the tracker is the GitHub one when a repo and token exist, else a note; an injected tracker is probed', async () => {
  const none = boot();
  assert.match((await runStep(none.org, 'stage2'))[0], /stage2 skipped/);
  const tracker = { name: 'github', openIssues: async () => ({ issues: [{ number: '7', title: 'Only on the tracker', body: '' }], complete: true }), comment: async () => ({ ref: '1' }), upsertIssue: async () => ({ ref: '9' }) };
  const { org, db } = boot({ extra: { tracker } });
  const notes = await runStep(org, 'stage2');
  assert.match(notes[0], /stage2: (pass|fail)/);
  assert.ok(db.raw.prepare(`SELECT COUNT(*) n FROM items WHERE id='GH-7'`).get().n === 1, 'an issue only on the tracker is adopted into the store');
  const real = boot({ cfg: config({ vcs: { repo: 'owner/name' } }), env: { CONSOLE_TOKEN: TOKEN, VCS_TOKEN: 'x' } });
  assert.ok(real.org.surfaces.tracker({ VCS_TOKEN: 'x' }), 'a GitHub tracker is built from vcs.repo and the token name');
});

test('slots: a scheduler firing twice in one slot runs one tick; the next slot runs; slots can be switched off', async () => {
  const { org, db, clock } = boot();
  const a = await org.scheduledTick();
  const b = await org.scheduledTick();
  assert.equal(a.ran, true);
  assert.deepEqual({ ran: b.ran, duplicate: b.duplicate }, { ran: false, duplicate: true });
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM tick_runs`).get().n, 1);
  clock.t += 10 * 60e3;
  assert.equal((await org.scheduledTick()).ran, true);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM tick_runs`).get().n, 2);
  const off = boot({ cfg: config({ slots: { enabled: false } }) });
  await off.org.scheduledTick(); await off.org.scheduledTick();
  assert.equal(off.db.raw.prepare(`SELECT COUNT(*) n FROM tick_runs`).get().n, 2);
});

test('the declared routes and steps match what is mounted', () => {
  assert.deepEqual(Object.keys(SURFACE_ROUTES), ['walkthrough', 'dashboard', 'proxy', 'staff']);
  const { org } = boot({ cfg: config({ modelport: { aliases: { medium: { endpoint: 'a', model: 'm', family: 'f' }, large: { endpoint: 'a', model: 'm', family: 'f' } } } }), extra: { endpoints: { a: async () => ({}) }, roleHandlers: { default: async () => ({ ok: true }) } } });
  const names = org.extraSteps().map(s => s.name);
  for (const n of SURFACE_STEPS) assert.ok(names.includes(n), `${n} is in org.extraSteps()`);
});

test('T18-9 and US-18-R09: Google IAP: a request through the configured proxy with a valid signed header signs in; no header, wrong audience or a bad signature do not', async () => {
  const { IAP_KEYS_URL, IAP_ISSUER, _clearIapKeys } = await import('../doors/proxy.js');
  _clearIapKeys();
  const AUD = '/projects/1/global/backendServices/9';
  const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const keyPair = async () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const kp = await keyPair(), other = await keyPair();
  const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
  const sign = async (claims, key = kp.privateKey) => {
    const head = `${b64u({ alg: 'ES256', kid: 'k1' })}.${b64u(claims)}`;
    return `${head}.${Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(head))).toString('base64url')}`;
  };
  const sec = Math.floor(T0 / 1000);
  const claims = (o = {}) => ({ iss: IAP_ISSUER, aud: AUD, iat: sec - 10, exp: sec + 600, email: 'ana@org.example', sub: 'accounts:1', ...o });
  const db = makeDb([OUT_DIR]);
  const org = createOrg({ db, env: {}, config: config({ doors: { iap: { audience: AUD } } }), fetch: async u => { assert.equal(String(u), IAP_KEYS_URL); return Response.json({ keys: [jwk] }); }, now: () => T0 });
  const get = async token => org.handle(new Request(ORIGIN + '/api/console', { headers: token ? { 'x-goog-iap-jwt-assertion': token } : {} }));
  assert.equal((await get(null)).status, 401);
  assert.equal((await get(await sign(claims({ aud: '/projects/1/global/backendServices/2' })))).status, 401);
  assert.equal((await get(await sign(claims(), other.privateKey))).status, 401);
  assert.equal((await get(await sign(claims({ exp: sec - 600 })))).status, 401);
  const ok = await get(await sign(claims()));
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).now, 'the console data is served to the proxied owner');
});

test('US-13-R13: in the composed organization the dashboard calls the host probe port for a routed target only and reports the unrouted one as unrouted', async () => {
  const called = [];
  const probe = async url => { called.push(url); return { ok: true, status: 200 }; };
  const cfg = config({ dashboard: { routes: ['api.example.test'], probes: [{ id: 'api', url: 'https://api.example.test/health' }, { id: 'old', url: 'https://old.example.test/health' }] } });
  const { org } = boot({ cfg, extra: { ports: { probe } } });
  const anon = await org.handle(req('/console/dashboard/api/probes'));
  assert.equal(anon.status, 401, 'the probe reading is owner-only like the rest of the dashboard');
  assert.deepEqual(called, [], 'an anonymous caller makes no probe call');
  const r = await org.handle(req('/console/dashboard/api/probes', { authed: true }));
  assert.equal(r.status, 200);
  const j = await r.json();
  const byId = Object.fromEntries(j.results.map(x => [x.id, x.state]));
  assert.deepEqual(byId, { api: 'up', old: 'unrouted' });
  assert.deepEqual(called, ['https://api.example.test/health'], 'only the routed target reached the host probe port');
});
