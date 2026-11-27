// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The composition root reaches the modules it composes: the plus loop's reserved slots, the build-out ports an organization builds from itself, the
// claims reaper and retention steps, the health contract, the describe and fleet routes, the person's staff screen, the elicitation duties on the tick,
// and the caps kill switch on the routers. No network; every store is the generated migration set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from '../_shared/testdb.js';
import { OUT_DIR } from '../../tools/build_migrations.mjs';
import { createOrg } from './index.js';
import { registerProgram } from '../kernel/index.js';
import { registerPersona, createToolLayer } from '../staff/index.js';
import { registerProduct } from '../plus/index.js';
import { addClaims } from '../describe/index.js';
import { setSwitch } from '../router/caps/index.js';
import * as claims from '../claims/index.js';
import { githubPullReader } from '../../adapters/github/pulls.js';

const T0 = Date.UTC(2026, 10, 20, 9, 0, 0), MIN = 60e3, HOUR = 3600e3;
const TOKEN = 'console-token-for-tests';
const stamp = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a);
const noFetch = async () => { throw new Error('no network in this test'); };
const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const baseConfig = (over = {}) => ({ org_slug: 'wired-org', version: '1.2.3', runner: { enabled: false }, policy, ...over });
function boot({ config = baseConfig(), env = { CONSOLE_TOKEN: TOKEN }, extra = {} } = {}) {
  const db = makeDb([OUT_DIR]); const clock = { t: T0 };
  const org = createOrg({ db, env, config, fetch: noFetch, now: () => clock.t, ...extra });
  return { db, org, clock, tick: async (ms = MIN) => { clock.t += ms; return org.tick(); } };
}
const get = (org, path, headers = {}) => org.handle(new Request('https://org.test' + path, { headers }));
const bearer = { authorization: 'Bearer ' + TOKEN };

test('US-04-R01, R05: the plus loop reserves its share of the slots before the programs are allocated, and a plus switched off reserves none', async () => {
  const slots = async config => {
    const { db, tick } = boot({ config });
    await registerProgram(db, { id: 'REACH', name: 'reach' }); await registerProgram(db, { id: 'OPS', name: 'ops' });
    db.raw.exec(`INSERT INTO items (id, title, kind, owner_role, done_check, priority, status, project) VALUES ('R1','r','fix','staff','x',50,'ready','REACH'),('O1','o','fix','staff','x',50,'ready','OPS')`);
    const r = await tick();
    assert.equal(r.completed, r.total, JSON.stringify(r.errors));
    return one(db, `SELECT SUM(slots) AS n FROM kernel_allocations WHERE tick_id = (SELECT MAX(tick_id) FROM kernel_allocations)`).n;
  };
  assert.equal(await slots(baseConfig()), 20, '25 slots less the 5 the default share of 0.2 reserves');
  assert.equal(await slots(baseConfig({ plus: { plus_share: 0.4 } })), 15);
  assert.equal(await slots(baseConfig({ plus: { enabled: false } })), 25);
});

test('the build-out ports: the organization builds the ones it can from itself, a host port wins, and without a model nothing is built that would call one', async () => {
  const none = boot().org.buildoutPorts({});
  assert.deepEqual(['research', 'propose', 'ai'].filter(k => none[k]), [], 'no model is configured, so no port that calls one');
  assert.equal(typeof none.reader, 'function', 'the first-party usage reader needs only the database');
  assert.equal(typeof none.readiness, 'function'); assert.equal(typeof none.readback, 'function'); assert.ok(none.elicit && none.catalog && none.l3);
  assert.equal((await none.readiness('main')).g1, true, 'readiness is computed from the needs register: nothing is required yet');
  const modelConfig = baseConfig({ modelport: { aliases: { medium: { endpoint: 'fake', model: 'm', family: 'f' }, large: { endpoint: 'fake', model: 'm2', family: 'g' } } } });
  const calls = [];
  const withModel = boot({ config: modelConfig, extra: { endpoints: { fake: async ({ model, messages }) => { calls.push([model, messages.at(-1).content.slice(0, 20)]); return { text: 'ok', tokens_in: 1, tokens_out: 1 }; } } } }).org.buildoutPorts({});
  for (const k of ['research', 'propose', 'ai']) assert.equal(typeof withModel[k], 'function', k);
  assert.equal((await withModel.ai({ model: 'medium', prompt: 'say ok', max_tokens: 5 })).text, 'ok');
  await assert.rejects(() => withModel.ai({ model: 'nope', prompt: 'x' }), /unknown alias/);
  const mine = async () => 1;
  const hosted = boot({ config: modelConfig, extra: { ports: { propose: mine, mergedLadder: mine } } }).org.buildoutPorts({});
  assert.equal(hosted.propose, mine); assert.equal(hosted.mergedLadder, mine);
});

test('US-04-R09: a registered product is read through the first-party usage reader on the tick', async () => {
  const { db, tick } = boot();
  await registerProduct(db, { product: 'site', host: 'example.test', usage_metric: 'requests_per_day', quality_measure: 'error_page_rate', now: T0 });
  db.raw.exec(`CREATE TABLE hits (at INTEGER, host TEXT, bot INTEGER, name TEXT)`);
  for (let i = 0; i < 14; i++) db.raw.prepare(`INSERT INTO hits (at, host, bot, name) VALUES (?, 'example.test', 0, 'pageview')`).run(T0 - i * HOUR);
  const r = await tick();
  assert.equal(r.completed, r.total, JSON.stringify(r.errors));
  const p = one(db, `SELECT usage_value, usage_label FROM plus_product_registry WHERE product = 'site'`);
  assert.equal(p.usage_value, 2, '14 human page views over a 7 day window');
  assert.match(p.usage_label, /human requests/);
});

test('US-08-R19, R22: pull-request release and the daily retention are steps of the tick, and a merged pull request releases its claim', async () => {
  const none = boot();
  const r0 = await none.tick();
  assert.match(one(none.db, `SELECT report FROM tick_runs WHERE id = ?`, r0.tickId).report, /claims_pr_reap: skipped, no readPull port[\s\S]*claims pruned: /);
  const pulls = { 'org/app#7': { state: 'merged', merged_at: '2026-11-20T08:00:00Z' } };
  const { db, org, clock, tick } = boot({ extra: { ports: { readPull: async (repo, n) => pulls[`${repo}#${n}`] } } });
  db.raw.exec(`INSERT INTO items (id, title, owner_role, done_check, status) VALUES ('A', 'a', 'staff', 'x', 'claimed')`);
  await claims.acquire({ db, now: () => clock.t, config: {} }, { item_id: 'A', holder: 'agent', repo: 'org/app', pr: 7 });
  const r = await tick();
  assert.equal(r.completed, r.total, JSON.stringify(r.errors));
  assert.match(one(db, `SELECT report FROM tick_runs WHERE id = ?`, r.tickId).report, /claims released on pull requests: 1 released/);
  assert.equal(one(db, `SELECT outcome FROM claims_lock WHERE key = 'item:A'`).outcome, 'merged');
  // with only the factory, the reader is built from the token the organization holds
  const seen = [];
  const f = async (url, init) => { seen.push([String(url), init.headers.authorization]); return Response.json({ state: 'closed', merged_at: '2026-11-20T08:00:00Z', closed_at: '2026-11-20T08:00:00Z' }); };
  const viaFactory = boot({ config: baseConfig({ vcs: { repo: 'org/app' } }), env: { CONSOLE_TOKEN: TOKEN, VCS_TOKEN: 'tok-1234567890' }, extra: { fetch: f, ports: { pullReader: githubPullReader } } });
  viaFactory.db.raw.exec(`INSERT INTO items (id, title, owner_role, done_check, status) VALUES ('B', 'b', 'staff', 'x', 'claimed')`);
  await claims.acquire({ db: viaFactory.db, now: () => viaFactory.clock.t, config: {} }, { item_id: 'B', holder: 'agent', repo: 'org/app', pr: 9 });
  await viaFactory.tick();
  assert.deepEqual(seen.filter(([u]) => u.includes('/pulls/')), [['https://api.github.com/repos/org/app/pulls/9', 'Bearer tok-1234567890']]);
  assert.equal(one(viaFactory.db, `SELECT outcome FROM claims_lock WHERE key = 'item:B'`).outcome, 'merged');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM claims_events WHERE event = 'pruned'`).n, 1, 'retention ran once');
  await tick(); assert.equal(one(db, `SELECT COUNT(*) AS n FROM claims_events WHERE event = 'pruned'`).n, 1, 'and only once a day');
});

test('US-11-R01, US-03-R20, US-13-R21: /health carries the fleet contract, judges the newest finished tick, and reads a stopped clock as unhealthy', async () => {
  const { db, org, clock, tick } = boot();
  assert.equal((await get(org, '/health')).status, 503, 'no tick has finished yet');
  await tick();
  const ok = await get(org, '/health'); const body = await ok.json();
  assert.equal(ok.status, 200);
  assert.deepEqual([body.status, body.worker, body.version, body.enabled, body.bindings_ok, body.ok, body.org], ['ok', 'wired-org', '1.2.3', true, true, true, 'wired-org']);
  assert.equal(body.verdict, 'healthy'); assert.ok(body.last_tick.report);
  // a probe that lands while a tick is running reads the tick before it
  const before = body.last_tick.id;
  db.raw.prepare(`INSERT INTO tick_runs (started_at, steps_total) VALUES (?, 99)`).run(stamp(clock.t));
  const during = await get(org, '/health');
  assert.equal(during.status, 200); assert.equal((await during.json()).last_tick.id, before);
  // a tick that never finished is read as it is after five minutes
  clock.t += 6 * MIN;
  const stuck = await get(org, '/health');
  assert.equal(stuck.status, 503); assert.notEqual((await stuck.json()).last_tick.id, before);
  // a clock that stopped is not healthy because the last tick finished
  const later = boot(); await later.tick();
  later.clock.t += 40 * MIN;
  const stopped = await get(later.org, '/health');
  assert.equal(stopped.status, 503); const s = await stopped.json();
  assert.deepEqual([s.ok, s.status, s.verdict], [false, 'degraded', 'stalled']);
});

test('US-22-R11, R12: the claims feed, the statement and the re-probe are served; the re-probe has the host ports and answers 429 inside its interval', async () => {
  const { db, org, clock, tick } = boot();
  await addClaims(db, [{ id: 'operation.items', text: 'As of {date}, {value} work items exist.', probe: 'sql:SELECT COUNT(*) AS value FROM items', expect: '>=0', max_age_hours: 24 }]);
  await tick();
  const feed = await get(org, '/describe/claims.json');
  assert.equal(feed.status, 200); assert.deepEqual((await feed.json()).claim_ids, ['operation.items']);
  const page = await get(org, '/describe/claims');
  assert.equal(page.status, 200); assert.match(await page.text(), /Claims and how to check them[\s\S]*Check every claim again now/);
  assert.equal((await get(org, '/describe/statement')).status, 200);
  const probe = path => org.handle(new Request('https://org.test' + path, { method: 'POST' }));
  assert.equal((await get(org, '/describe/claims/probe')).status, 405, 'a GET is refused');
  clock.t += 10 * MIN; // the tick has just probed every claim; a re-probe is allowed again after the interval
  const first = await probe('/describe/claims/probe');
  assert.equal(first.status, 200, 'the host supplied probe ports (without them the route answers 503)');
  assert.equal((await first.json()).probes.checked, 1);
  assert.equal((await probe('/describe/claims/probe')).status, 429, 'a second re-probe inside the interval is refused');
});

test('US-11-R01, R06: the fleet routes take the console token; without it they answer 401', async () => {
  const { org, tick } = boot();
  await tick();
  for (const [p, m] of [['/fleet/status', 'GET'], ['/fleet/dispatch', 'POST'], ['/fleet/execute', 'POST']]) assert.equal((await org.handle(new Request('https://org.test' + p, { method: m }))).status, 401, p);
  const s = await get(org, '/fleet/status', bearer);
  assert.equal(s.status, 200); assert.equal((await s.json()).crons_enabled, 0);
  const d = await org.handle(new Request('https://org.test/fleet/dispatch', { method: 'POST', headers: bearer }));
  assert.equal(d.status, 200);
  const bad = await org.handle(new Request('https://org.test/fleet/execute', { method: 'POST', headers: bearer, body: 'not json' }));
  assert.equal(bad.status, 400);
  assert.equal((await get(org, '/health')).status, 200, 'the org keeps its own /health');
});

test('US-02-R18: the person screen is mounted behind the sign-in: the holder lists and acts, another principal is refused, and the console token names nobody', async () => {
  const { db, org, clock } = boot();
  await registerProgram(db, { id: 'REACH', name: 'reach' });
  await registerPersona(db, { id: 'pgm-reach', role: 'program-manager', program_id: 'REACH', scope: 's', instruction_source: 'f.md', authority: ['promote', 'score'], filled_by: 'person', holder: 'alex', now: clock.t });
  db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, priority, status, project) VALUES ('R1', 'r1', 'fix', 'staff', 'x', 50, 'ready', 'REACH')`).run();
  db.raw.prepare(`INSERT INTO kernel_focus (program_id, item_id, rank, tier, has_doer, tick_id) VALUES ('REACH', 'R1', 1, 0, 0, 1)`).run();
  const mount = async (principal, path, { method = 'GET', body } = {}) => {
    const rq = new Request('https://org.test' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    for (const m of org.surfaces.mounts) { const r = await m(rq.clone(), { actor: principal }); if (r) return r; }
    return null;
  };
  const list = await mount('alex', '/api/staff'); assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).personas.map(p => p.id), ['pgm-reach']);
  const act = await mount('alex', '/api/staff/pgm-reach/act', { method: 'POST', body: { op: 'promote', args: { item_id: 'R1' } } });
  assert.equal(act.status, 200); assert.equal(one(db, `SELECT priority FROM items WHERE id = 'R1'`).priority, 10);
  assert.equal((await mount('mallory', '/api/staff/pgm-reach/act', { method: 'POST', body: { op: 'promote', args: { item_id: 'R1' } } })).status, 403);
  assert.equal((await mount(null, '/api/staff')).status, 401, 'the console token and an Access identity are no named principal');
  assert.equal(await mount('alex', '/api/other'), null, 'other paths are not the screen\'s');
  // through the console: signed in with the token, the route is reached and refuses for want of a principal; a write from another origin is refused first
  const cookie = { cookie: `us_console=${encodeURIComponent(TOKEN)}` };
  assert.equal((await get(org, '/api/staff')).status, 401, 'signed out');
  assert.equal((await get(org, '/api/staff', cookie)).status, 401, 'signed in with the token: no principal');
  assert.equal((await org.handle(new Request('https://org.test/api/staff/pgm-reach/act', { method: 'POST', headers: { ...cookie, origin: 'https://evil.test' }, body: '{}' }))).status, 403);
});

test('US-16-R10, R24: an Ask nobody answers falls to its default and the ignorance audit runs, on the tick, with nobody opening the walkthrough', async () => {
  const { db, org, clock, tick } = boot({ config: baseConfig({ elicit: { defer_below: 0, max_open: 9, daily_cap: 99 } }) });
  const e = org.surfaces.elicit;
  await e.registerNeeds('demo', [{ id: 'a', label: 'Thing a', artifact: 'charter', question: 'Which a do you want?', why: 'This changes the a we build.', cue: 'Similar projects pick the first one.',
    options: ['first', 'second'], default: 'first', default_consequence: 'We rebuild one page; change it any time.', p_wrong: 0.5 }]);
  await e.nextAsks('demo');
  assert.equal(one(db, `SELECT state FROM elicit_needs WHERE id = 'a'`).state, 'asked');
  const r = await tick(80 * HOUR);
  assert.equal(r.completed, r.total, JSON.stringify(r.errors));
  assert.equal(one(db, `SELECT state FROM elicit_needs WHERE id = 'a'`).state, 'defaulted');
  assert.match(one(db, `SELECT report FROM tick_runs WHERE id = ?`, r.tickId).report, /1 overdue Ask fell to the default/);
  assert.ok(one(db, `SELECT COUNT(*) AS n FROM elicit_audit WHERE project = 'demo'`).n >= 1, 'the audit ran for the project');
  assert.ok(one(db, `SELECT COUNT(*) AS n FROM elicit_outcomes WHERE project = 'demo'`).n >= 1, 'the Ask was priced and its outcome is recorded (the tables are in the migration set)');
  const off = boot({ config: baseConfig({ elicit_duties: { enabled: false }, elicit_audit: { enabled: false } }) });
  const o = await off.tick(); assert.equal(o.completed, o.total);
});

test('US-09-R01: the caps kill switch reaches the routers the organization builds', async () => {
  const router = JSON.parse(readFileSync(new URL('../router/example-config.json', import.meta.url), 'utf8'));
  const { db, org } = boot({ config: baseConfig({ router, agents: { enabled: true } }), extra: { agentDefs: { helper: { system: 'You help.', tools: {} } }, fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }) } });
  await setSwitch(db, '*', true, { by: 'test', reason: 'drill' });
  const refused = await org.agents.turn('helper', 's1', 'hi');
  assert.match(JSON.stringify(refused), /kill_switch_all/);
  await setSwitch(db, '*', false, { by: 'test', reason: 'drill over' });
  assert.doesNotMatch(JSON.stringify(await org.agents.turn('helper', 's2', 'hi')), /kill_switch_all/);
});

test('US-20-R10 to R13: the stage step computes the self-hosting stage when the deployment names its evidence, and says why it did not otherwise', async () => {
  const none = boot(); const r = await none.tick();
  assert.match(one(none.db, `SELECT report FROM tick_runs WHERE id = ?`, r.tickId).report, /stage skipped: no config.stage and no stage probes/);
  const probes = { contract: async () => ({ record_check: { green: 3, merged: 3 }, false_built: 0 }) };
  const { db, tick } = boot({ extra: { ports: { stageProbes: probes, publishedStage: async () => 'The organization is at stage 4 of the ladder.' } } });
  const t = await tick();
  assert.equal(t.completed, t.total, JSON.stringify(t.errors));
  const stage = JSON.parse(one(db, `SELECT value FROM org WHERE key = 'self_hosting_stage'`).value);
  assert.equal(stage.stage, 1, 'the contract probe holds, the tracker is not configured so stage 2 is unknown');
  assert.match(one(db, `SELECT status FROM items WHERE id = 'STAGE-PUBLISHED'`).status, /^(open|ready)$/, 'the published stage exceeds the computed one');
});

test('US-14-R10, R17: a Vertex endpoint is offered when the configuration names it, and the slot overlap bound comes from the configuration', async () => {
  const cfg = baseConfig({ modelport: { aliases: { medium: { endpoint: 'vertex', model: 'gemini', family: 'google' }, large: { endpoint: 'vertex', model: 'gemini', family: 'google' } }, vertex: { project: 'p', location: 'us-central1', token_env: 'VERTEX_TOKEN' } } });
  const seen = [];
  const { org } = boot({ config: cfg, env: { CONSOLE_TOKEN: TOKEN, VERTEX_TOKEN: 'v-token-123' }, extra: { fetch: async (u, i) => { seen.push([String(u), i.headers.authorization]); return Response.json({ candidates: [{ content: { parts: [{ text: 'hi' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }); } } });
  const r = await org.models.complete('medium', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.match(seen[0][0], /us-central1-aiplatform\.googleapis\.com\/v1\/projects\/p\/locations\/us-central1\/publishers\/google\/models\/gemini:generateContent/);
  assert.equal(seen[0][1], 'Bearer v-token-123');
  // an overlapping slot: a tick claimed 5 minutes ago and never recorded is not overlapped when the bound is 3 minutes, and is when the default (two slots) applies
  const narrow = boot({ config: baseConfig({ slots: { overlap_minutes: 3 } }) });
  const stuck = db => db.raw.prepare(`INSERT INTO sched_slots (slot, claimed_at) VALUES (?, ?)`).run(Math.floor(T0 / 600000) - 1, stamp(T0 - 5 * MIN));
  stuck(narrow.db);
  assert.equal((await narrow.org.scheduledTick()).ran, true);
  const dflt = boot(); stuck(dflt.db);
  assert.equal((await dflt.org.scheduledTick()).overlap, true, 'with the default bound (two slots) the earlier tick is still running');
});
