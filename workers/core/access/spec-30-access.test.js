// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-30 (owner actions and credentials), section 4.2: the access preflight. Each test names the requirement it proves (US-00-R03). The clock is
// injected and the network is a fake world of path -> answer; no real token, account or host is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { probe, askOwner, step, report, stateOf, probeAll, CAPABILITIES } from './index.js';

const dirs = ['./migrations/', '../ownerlink/migrations/'].map(d => fileURLToPath(new URL(d, import.meta.url)));
const T0 = Date.parse('2026-11-26T12:00:00Z');
const world = routes => async (url, init) => { const p = String(url).replace(/^https:\/\/api\.(github\.com|cloudflare\.com\/client\/v4)/, ''); const r = routes[p] || { status: 403, body: {} }; return { status: r.status, json: async () => r.body }; };
const mk = (routes = {}, env = { GITHUB_TOKEN: 'x', CLOUDFLARE_API_TOKEN: 'y' }, config = {}) => ({ db: makeDb(dirs), now: () => T0, fetch: world(routes), env, config });
const out = (outcome, detail = 'd') => ({ outcome, detail });
const reg = (...routes) => ({ cap: { routes: routes.map((r, i) => ({ id: 'r' + i, run: typeof r === 'function' ? r : () => r })) } });
const card = (id, what, why = 'needed to continue') => ({ id, what, why_gated: why, default_in_effect: 'skipped', closing_probe: 'manual' });
const cards = ctx => ctx.db.raw.prepare('SELECT id, status FROM gate_cards ORDER BY id').all();

test('US-30-R09: a capability is present when any route says so, missing only when no route is present or unknown and one is authoritatively absent, and an unreadable answer is never missing', async () => {
  const ctx = mk();
  const status = async (...routes) => (await probe(ctx, 'cap', 's', { registry: reg(...routes) })).status;
  assert.equal(await status(out('present'), out('unknown')), 'present'); assert.equal(await status(out('absent'), out('present')), 'present');
  assert.equal(await status(out('absent'), out('absent')), 'missing');
  assert.equal(await status(out('absent'), out('unknown')), 'unknown', 'one unreadable route keeps the question open');
  assert.equal(await status(out('unknown')), 'unknown');
  assert.equal(await status(() => { throw new Error('boom'); }, out('absent')), 'unknown', 'a route that throws is unknown');
  assert.equal(await status(), 'unknown', 'no route proves nothing');
  await assert.rejects(probe(ctx, 'no-such-capability', 's'), /unknown capability no-such-capability/);
  assert.deepEqual(Object.keys(CAPABILITIES).sort(), ['cloudflare.account_access', 'cloudflare.git_connection', 'cloudflare.workers_deploy', 'config.setting', 'github.app_installed', 'github.repo_permission', 'github.workflow_ran_ok', 'secret.available']);
  const env = mk({}, { SOME_NAME: 'v' }); const st = async (cap, subj, c = env) => (await probe(c, cap, subj)).status;
  assert.equal(await st('secret.available', 'SOME_NAME'), 'present'); assert.equal(await st('secret.available', 'OTHER_NAME'), 'unknown', 'with no vault reader the absence in the environment alone is not proof');
  assert.equal(await st('config.setting', 'a.b', { ...env, settings: { a: { b: 1 } } }), 'present'); assert.equal(await st('config.setting', 'a.c', { ...env, settings: { a: {} } }), 'missing'); assert.equal(await st('config.setting', 'a.b'), 'unknown', 'no configuration object given');
  const ghNone = mk({}, {}); assert.equal(await st('github.repo_permission', 'o/r:push', ghNone), 'unknown', 'no token in the environment is unknown');
  assert.equal(await st('github.repo_permission', 'o/r:read', mk({ '/repos/o/r': { status: 200, body: {} } })), 'present');
  assert.equal(await st('github.repo_permission', 'o/r:push', mk({ '/repos/o/r': { status: 200, body: {} } })), 'unknown', 'a token that reports no push flag is unknown, never missing');
});

test('US-30-R10: every route of every probe is recorded with the probe id, the newest result is the state with an expiry, a detail is cut at 400 characters, and a present capability closes the cards that were permitted for it', async () => {
  const ctx = mk({}, {}, { ttl_minutes: 60 });
  const r = await probe(ctx, 'cap', 'subj', { registry: reg(out('absent', 'x'.repeat(600)), out('absent', 'second')) });
  assert.equal(r.status, 'missing'); assert.equal(r.routes.length, 2);
  const rows = ctx.db.raw.prepare('SELECT route, outcome, detail, probe_id FROM access_routes ORDER BY id').all();
  assert.deepEqual(rows.map(x => [x.route, x.outcome]), [['r0', 'absent'], ['r1', 'absent']]); assert.equal(rows[0].detail.length, 400); assert.equal(new Set(rows.map(x => x.probe_id)).size, 1);
  const s = await stateOf(ctx, 'cap', 'subj');
  assert.deepEqual([s.status, s.probe_id === rows[0].probe_id, s.checked_at, s.expires_at], ['missing', true, '2026-11-26T12:00:00.000Z', '2026-11-26T13:00:00.000Z'], 'ttl_minutes sets the expiry');
  assert.equal(JSON.parse(s.evidence).length, 2);
  const d = mk(); assert.equal((await probe(d, 'cap', 'subj', { registry: reg(out('absent')) })).status, 'missing'); assert.equal((await stateOf(d, 'cap', 'subj')).expires_at, '2026-11-26T18:00:00.000Z', 'the default expiry is six hours');
  await probe(ctx, 'cap', 'subj', { registry: reg(out('present')) });
  assert.equal((await stateOf(ctx, 'cap', 'subj')).status, 'present'); assert.equal(ctx.db.raw.prepare('SELECT COUNT(*) n FROM access_state').get().n, 1, 'one state row per capability and subject');
  const ctx2 = { ...mk(), registry: reg(out('absent')) }; ctx2.registry = { 'secret.available': { routes: [{ id: 'env', run: () => out('absent') }] } };
  const asked = await askOwner(ctx2, { ...card('c1', 'connect Mastodon'), capability: 'secret.available', subject: 'MASTODON_TOKEN' }); assert.equal(asked.asked, true);
  ctx2.registry = { 'secret.available': { routes: [{ id: 'env', run: () => out('present') }] } };
  await probe(ctx2, 'secret.available', 'MASTODON_TOKEN', { registry: ctx2.registry }); assert.deepEqual(cards(ctx2).map(x => ({ ...x })), [{ id: 'c1', status: 'closed' }], 'the permitted card closes when the capability turns up');
});

test('US-30-R11: the only door to the owner probes fresh, files nothing when the capability is present or not proven missing, and files one card with its permit and every route\'s result when it is missing on every route', async () => {
  const ctx = mk({ '/accounts?per_page=50': { status: 200, body: { result: [{ id: 'a1', name: 'ultrastable' }] } } });
  await assert.rejects(askOwner(ctx, { id: 'x', what: 'w' }), /askOwner needs capability/);
  for (const k of ['capability', 'subject', 'id', 'what', 'why_gated', 'default_in_effect', 'closing_probe']) await assert.rejects(askOwner(ctx, { ...card('x', 'w'), capability: 'c', subject: 's', [k]: '' }), new RegExp(`needs ${k}`));
  const granted = await askOwner(ctx, { ...card('ask-cf', 'grant the credentials access to the ultrastable account'), capability: 'cloudflare.account_access', subject: 'ultrastable' });
  assert.deepEqual([granted.asked, granted.reason], [false, 'already_granted']); assert.deepEqual(cards(ctx), []);
  assert.match(ctx.db.raw.prepare('SELECT reason FROM access_blocked_asks').get().reason, /^already_granted: accounts_list=present/);
  const unread = await askOwner(mk({}), { ...card('ask-gh', 'install the app on the organization'), capability: 'github.app_installed', subject: 'Org/app' });
  assert.deepEqual([unread.asked, unread.reason], [false, 'not_proven_missing']);
  const m = { ...mk(), registry: { 'secret.available': { routes: [{ id: 'environment', run: () => out('absent', 'not set in the environment') }, { id: 'vault', run: () => out('absent', 'not in the vault') }] } } };
  const a = await askOwner(m, { ...card('need-masto', 'connect Mastodon'), capability: 'secret.available', subject: 'MASTODON_TOKEN', prepared_by_fleet: 'the fleet' });
  assert.deepEqual([a.asked, a.card, a.link], [true, 'need-masto', '/owner/go/need-masto'], 'the ask carries its one link (the origin is empty here: no config.ownerlink.origin)');
  const row = m.db.raw.prepare('SELECT * FROM gate_cards').get();
  assert.equal(row.status, 'open'); assert.match(row.why_gated, /Routes tried: environment: absent \(not set in the environment\); vault: absent \(not in the vault\)\. One click: /); assert.equal(row.prepared_by_fleet, 'the fleet');
  assert.equal(m.db.raw.prepare('SELECT COUNT(*) n FROM access_permits').get().n, 1);
  await askOwner(m, { ...card('need-masto', 'connect Mastodon'), capability: 'secret.available', subject: 'MASTODON_TOKEN' }); assert.equal(m.db.raw.prepare('SELECT COUNT(*) n FROM gate_cards').get().n, 1, 'asking again files no second card');
  const rep = await report(m); assert.deepEqual([rep.state.length, rep.blocked_asks.length, rep.open_cards_without_permit.length], [1, 0, 0]);
});

test('US-30-R12: the database itself refuses a permit without a fresh missing probe and closes an access request that has no permit, handing the step to the staff, while money, signing and destructive requests are left to the interrupt gate', async () => {
  const ctx = mk(); const raw = ctx.db.raw;
  assert.throws(() => raw.prepare("INSERT INTO access_permits (card_id, capability, subject, at) VALUES ('c','secret.available','Z','2026-11-26T12:00:00.000Z')").run(), /access_permit_refused/);
  const put = (status, expires, routes) => { raw.exec("DELETE FROM access_state; DELETE FROM access_routes;"); raw.prepare("INSERT INTO access_state (capability, subject, status, probe_id, checked_at, expires_at, evidence) VALUES ('secret.available','Z',?,'p','2026-11-26T12:00:00.000Z',?,'[]')").run(status, expires);
    for (const o of routes) raw.prepare("INSERT INTO access_routes (capability, subject, route, outcome, detail, at, probe_id) VALUES ('secret.available','Z','r',?,'d','2026-11-26T12:00:00.000Z','p')").run(o); };
  const permit = () => raw.prepare("INSERT INTO access_permits (card_id, capability, subject, at) VALUES ('c','secret.available','Z','2026-11-26T12:00:00.000Z')").run();
  put('present', '2099-01-01T00:00:00.000Z', ['present']); assert.throws(permit, /access_permit_refused/);
  put('missing', '2026-01-01T00:00:00.000Z', ['absent']); assert.throws(permit, /access_permit_refused/, 'an expired probe licenses nothing');
  put('missing', '2099-01-01T00:00:00.000Z', ['absent', 'unknown']); assert.throws(permit, /access_permit_refused/, 'a route that could not tell blocks the permit');
  put('missing', '2099-01-01T00:00:00.000Z', ['absent', 'absent']); assert.doesNotThrow(permit);
  const file = (id, what, why = 'y', probe = 'manual') => raw.prepare("INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES (?,?,?,'d',?)").run(id, what, why, probe);
  const status = id => raw.prepare('SELECT status FROM gate_cards WHERE id = ?').get(id).status;
  for (const [id, what] of [['a1', 'We need access to the Cloudflare account'], ['a2', 'Provide an API key'], ['a3', 'Please sign in to GitHub'], ['a4', 'Grant the app write permission']]) { file(id, what); assert.equal(status(id), 'closed', what); }
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM access_blocked_asks WHERE card_id IN (\'a1\',\'a2\',\'a3\',\'a4\')').get().n, 4);
  assert.match(raw.prepare("SELECT reason FROM access_blocked_asks WHERE card_id='a1'").get().reason, /^no permit: the request was not preceded by a probe proving the capability missing/);
  for (const [id, what, why] of [['m1', 'Approve the payment of the invoice', 'needs your permission'], ['m2', 'Sign a legal agreement', 'needs your permission'], ['m3', 'Delete the backup', 'destroys data; irreversible'], ['m4', 'Review the weekly summary', 'no keyword at all']]) { file(id, what, why); assert.equal(status(id), 'open', id + ' is not an access request'); }
  raw.prepare("INSERT INTO ownerlink_actions (id, card_id, flow, title, link, created_at) VALUES ('c','c','github_app','Connect','/owner/go/c','2026-11-26T12:00:00.000Z')").run();
  file('c', 'We need access to the thing');  // c has a permit from above and a link: it stays open
  assert.equal(status('c'), 'open', 'a permitted card that carries its link is left open');
  file('e1', 'Add the API key', 'for the model', 'env:FOO_KEY');
  const item = raw.prepare("SELECT * FROM items WHERE id = 'ACCESS-e1'").get();
  assert.deepEqual([item.status, item.owner_role, item.blocker, item.closing_probe], ['blocked', 'staff', 'waiting on probe: env:FOO_KEY', 'env:FOO_KEY']);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM items WHERE id = 'ACCESS-a1'").get().n, 0, 'only an env: probe becomes an item the tick re-reads');
});

test('US-30-R12: each tick probes the configured needs and closes the staff item of an ask whose capability has turned up', async () => {
  const ctx = mk({}, { SOME_NAME: 'v' }, { needs: [{ capability: 'secret.available', subject: 'SOME_NAME' }, { capability: 'secret.available', subject: 'GONE' }], closers: { e1: { capability: 'secret.available', subject: 'SOME_NAME' } } });
  const raw = ctx.db.raw;
  raw.prepare("INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES ('e1','Add the API key','y','d','env:SOME_NAME')").run();
  assert.equal(raw.prepare("SELECT status FROM items WHERE id = 'ACCESS-e1'").get().status, 'blocked');
  const o = await step(ctx);
  assert.deepEqual([o.probed, o.present, o.unknown, o.items_closed], [2, 1, 1, 1]);
  const it = raw.prepare("SELECT status, disposition FROM items WHERE id = 'ACCESS-e1'").get(); assert.deepEqual([it.status, it.disposition], ['done', 'capability present per access probe']);
  assert.equal((await step(ctx)).items_closed, 0, 'a closed item is not closed again');
  assert.equal((await probeAll(ctx)).length, 2);
});
