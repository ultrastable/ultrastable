// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-13 section 3: the product dashboard routes, one state for page, JSON and digest (R01, R02, T01), probe routing (R13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createConsoleL3 } from './index.js';
import { createDashboard, classifyProbes } from './dashboard.js';
import { createSla } from '../sla/index.js';

const dir = p => fileURLToPath(new URL(p, import.meta.url));
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
const mk = ({ graph = true } = {}) => {
  const db = makeDb([dir('./migrations/'), dir('../sla/migrations/'), ...(graph ? [dir('../graph/migrations/')] : [])]);
  const now = () => T0;
  const l3 = createConsoleL3({ db, now, config: { version: '2.0.0' } }); const sla = createSla({ db, now });
  db.raw.exec(`
    INSERT INTO items (id,title,owner_role,done_check,status,created_at) VALUES ('A','a','staff','x','ready','2026-11-01 00:00:00'),('B','b','staff','x','done','2026-11-01 00:00:00'),('C','<script>alert(1)</script>','staff','x','claimed','2026-11-14 00:00:00');
    INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G1','Approve <b>spend</b>','money','stays "zero"','manual');
    INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES ('2026-11-15 11:50:00','2026-11-15 11:50:01',8,8);
    INSERT INTO dispatches (tick_id, role_id, item_id, model, status) VALUES (1,'r','C','small','queued'),(1,'r','B','small','failed');`);
  return { db, l3, sla, dash: createDashboard({ db, l3, sla, now }) };
};
const get = (dash, path, init) => dash.handle(new Request(`https://status.example${path}`, init));

test('US-13-T01 and R01: /health and /api/state return JSON with version and counts; /health fails when the last check did not finish', async () => {
  const { db, dash } = mk();
  const h = await get(dash, '/health'); assert.equal(h.status, 200);
  assert.deepEqual((await h.json()).counts, { items: 3, open_gate_cards: 1, blocked: 0 });
  const s = await (await get(dash, '/api/state')).json();
  assert.equal(s.version, '2.0.0'); assert.equal(s.items.total, 3); assert.equal(s.gate_cards.open, 1);
  db.raw.exec(`INSERT INTO tick_runs (started_at,steps_completed,steps_total) VALUES ('2026-11-15 11:55:00',3,8)`);
  assert.equal((await get(dash, '/health')).status, 503);
  assert.equal(await get(dash, '/nope'), null);
  assert.equal(await get(dash, '/api/state', { method: 'DELETE' }), null);
});

test('/api/loop reports the last execute time and scanned, executed, failed, needs_human, no_action', async () => {
  const { dash } = mk();
  assert.deepEqual(await (await get(dash, '/api/loop')).json(), { last_execute_at: '2026-11-15 11:50:01', tick_id: 1, finished: true, scanned: 2, executed: 1, failed: 1, needs_human: 1, no_action: 0 });
  const empty = createDashboard({ db: makeDb([dir('./migrations/')]), l3: null });
  assert.equal((await empty.loop()).last_execute_at, null);
});

test('/api/integration reports registered, live, edges, islands, sinks, density and drift; without a graph it says so', async () => {
  const { db, dash } = mk();
  db.raw.exec(`INSERT INTO graph_nodes (id, updated_at) VALUES ('a','t'),('b','t'),('c','t'),('lonely','t');
    INSERT INTO graph_edges (src,dst,source) VALUES ('a','b','scan'),('b','c','scan'),('a','ghost','scan')`);
  assert.deepEqual(await (await get(dash, '/api/integration')).json(), { available: true, registered: 4, live: 3, edges: 3, islands: ['lonely'], sinks: ['c'], density: 0.25, drift: ['ghost'] });
  assert.equal((await mk({ graph: false }).dash.integration()).available, false);
});

test('US-13-R02: the status page, /api/state and the digest are computed from the same state', async () => {
  const { l3, sla, dash } = mk();
  await sla.recompute();
  const s = await dash.state(); const d = await l3.digest();
  for (const k of ['items', 'gate_cards', 'last_tick', 'predictions', 'waiting_on_a_person']) assert.deepEqual(s[k], d.state[k]);
  const html = await (await get(dash, '/')).text();
  assert.match(html, new RegExp(`${s.items.open} open`)); assert.match(html, new RegExp(`${s.items.done} done`));
  assert.match(html, /1 waiting on a person/); assert.match(html, /<td>SEV3<\/td><td>2<\/td><td>1<\/td>/);
  assert.deepEqual(dash.render(s), html.replace(/x^/, ''));
});

test('US-13-R26 and US-18-R10: the page escapes every stored value and loads nothing from another host', async () => {
  const { dash } = mk();
  const res = await get(dash, '/'); const html = await res.text();
  assert.ok(!html.includes('<b>spend</b>')); assert.match(html, /Approve &lt;b&gt;spend&lt;\/b&gt;/); assert.match(html, /stays &quot;zero&quot;/);
  assert.ok(!/<script|src=|href=|url\(|@import/i.test(html));
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
});

test('POST /api/refresh recomputes the service levels and returns the fresh state; a prefix mounts the routes elsewhere', async () => {
  const { db, dash } = mk();
  const r = await (await get(dash, '/api/refresh', { method: 'POST' })).json();
  assert.equal(r.refreshed.rows, 2); assert.equal(r.refreshed.raised, 1);
  assert.equal(r.state.service_levels.past_due, 1);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM sla_rows`).get().n, 2);
  assert.equal(await dash.handle(new Request('https://x.example/api/state'), { prefix: '/dashboard' }), null);
  assert.equal((await dash.handle(new Request('https://x.example/dashboard/api/state'), { prefix: '/dashboard' })).status, 200);
  assert.equal((await dash.handle(new Request('https://x.example/dashboard'), { prefix: '/dashboard' })).headers.get('content-type'), 'text/html; charset=utf-8');
});

test('US-13-R13: a probe whose target is not routed is reported unrouted, not down', () => {
  const probes = [{ id: 'api', url: 'https://api.example/health' }, { id: 'old', url: 'https://old.example/health' }, { id: 'sub', url: 'https://api.example/v2/ping' }, { id: 'bad', url: 'not a url' }, { id: 'quiet', url: 'https://api.example/x' }];
  const r = classifyProbes(probes, ['api.example', 'https://other.example/v2'], { api: { ok: true, status: 200 }, old: { ok: false, status: 404 }, sub: { ok: false, status: 500 }, bad: { ok: false } });
  assert.deepEqual(r.map(x => [x.id, x.state]), [['api', 'up'], ['old', 'unrouted'], ['sub', 'down'], ['bad', 'unrouted'], ['quiet', 'unknown']]);
});

test('US-13-R21 and US-13-T08: /health returns 503 with a stalled verdict and its reason when the newest check is older than the bound', async () => {
  const { db, dash } = mk();
  db.raw.exec(`DELETE FROM tick_runs; INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES ('2026-11-14 11:00:00','2026-11-14 11:00:01',8,8)`);
  const r = await get(dash, '/health');
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.verdict, 'stalled'); assert.match(body.reasons[0], /newest check is \d+ minutes old/); assert.equal(body.ok, true);
});

test('US-13-R13: the dashboard never probes or reports down a target that is not routed', async () => {
  const called = [];
  const probe = async url => { called.push(url); return url.includes('bad.example') ? { ok: false, status: 500 } : url.includes('gone.example') ? { ok: false, status: null, dns: true } : { ok: true, status: 200 }; };
  const db = makeDb([dir('./migrations/'), dir('../sla/migrations/')]);
  const l3 = createConsoleL3({ db, now: () => T0 });
  const config = { routes: ['api.example', 'bad.example', 'gone.example'], probes: [
    { id: 'api', url: 'https://api.example/health' }, { id: 'old', url: 'https://old.example/health' }, { id: 'bad', url: 'https://bad.example/health' }, { id: 'gone', url: 'https://gone.example/health' }] };
  const dash = createDashboard({ db, l3, probe, now: () => T0, config });
  const r = await (await get(dash, '/api/probes')).json();
  assert.deepEqual(r.results.map(x => [x.id, x.state]), [['api', 'up'], ['old', 'unrouted'], ['bad', 'down'], ['gone', 'dns']]);
  assert.ok(!called.some(u => u.includes('old.example')), 'an unrouted target is never called');
  assert.equal(r.results.find(x => x.id === 'bad').status, 500);
  const html = await (await get(dash, '/')).text();
  assert.match(html, /<td>old<\/td><td>unrouted<\/td>/); assert.ok(!/<td>old<\/td><td>down/.test(html));
});

test('/api/probes lists up, down, unrouted, dns and unknown; with no routing known no target is called or called unrouted', async () => {
  const called = [];
  const db = makeDb([dir('./migrations/'), dir('../graph/migrations/')]);
  const l3 = createConsoleL3({ db, now: () => T0 });
  const config = { probes: [{ id: 'api', url: 'https://api.example/health' }] };
  const dash = createDashboard({ db, l3, probe: async u => { called.push(u); return { ok: true, status: 200 }; }, now: () => T0, config });
  assert.deepEqual((await (await get(dash, '/api/probes')).json()).results, [{ id: 'api', url: 'https://api.example/health', state: 'unknown', status: null }]);
  assert.equal(called.length, 0);
  // routes now come from the latest wiring sweep
  db.raw.exec(`INSERT INTO graph_wiring_sweeps (generated, worker_count, errors, workers) VALUES ('t', 1, '[]', '[{"name":"api","routes":["api.example/*"]}]')`);
  assert.equal((await (await get(dash, '/api/probes')).json()).results[0].state, 'up');
  // a probe that throws with a name-resolution error is dns, and a silent probe port leaves the target unknown
  const dns = createDashboard({ db, l3, probe: async () => { const e = new Error('getaddrinfo ENOTFOUND api.example'); e.code = 'ENOTFOUND'; throw e; }, now: () => T0, config });
  assert.equal((await (await get(dns, '/api/probes')).json()).results[0].state, 'dns');
  const none = createDashboard({ db, l3, now: () => T0, config });
  assert.equal((await (await get(none, '/api/probes')).json()).results[0].state, 'unknown');
});

const mkPanels = ({ analytics = null, tracker = null } = {}) => {
  const db = makeDb([dir('./migrations/'), dir('../sla/migrations/'), dir('../fleet/migrations/'), dir('../audit/migrations/'), dir('../graph/migrations/')]);
  const l3 = createConsoleL3({ db, now: () => T0, config: { version: '2.0.0' }, tracker });
  db.raw.exec(`
    INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES ('2026-11-15 11:50:00','2026-11-15 11:50:01',8,8);
    INSERT INTO items (id,title,owner_role,kind,done_check,status) VALUES ('A','a','staff','work','x','ready'),('B','b','staff','fix','x','open'),('C','c','ops','work','x','done');
    INSERT INTO fleet_runs (worker, trigger, status, queued_at, ts_start) VALUES ('w-ok','cron','ok','2026-11-15 10:00:00','2026-11-15 10:00:01'),('w-ok','cron','failed','2026-11-15 11:00:00','2026-11-15 11:00:01'),('w-old','cron','ok','2026-11-10 10:00:00','2026-11-10 10:00:01');
    INSERT INTO fleet_crons (name, expr, task_id, enabled, next_fire) VALUES ('w-ok','*/10 * * * *','t1',1,'2026-11-15 12:10:00'),('w-quiet','0 * * * *','t2',1,'2026-11-15 13:00:00'),('w-off','0 * * * *','t3',0,'2026-11-15 13:00:00');
    INSERT INTO graph_wiring_sweeps (generated, worker_count, errors, workers) VALUES ('t',1,'[]','[]');
    INSERT INTO graph_wiring_analyses (sweep_id, at, nodes, edges, density, islands, sinks, sources, unresolved, ghosts, unregistered, unversioned, data_flow_edges, islands_with_data_flow, orphan_tables, integration_score, detail) VALUES (1,'2026-11-15 11:00:00',10,12,0.1,1,2,3,0,2,3,1,4,0,2,0.82,'{}');
    INSERT INTO audit_events (seq, day, at, actor, kind, summary, prev, hash) VALUES (1,'2026-11-15','2026-11-15T11:00:00Z','x','deploy','s','0','abcdef1234567890');`);
  return { db, l3, dash: createDashboard({ db, l3, analytics, now: () => T0 }) };
};

test('the dashboard shows per-worker runs, failures and next runs from fleet_runs and fleet_crons; a run outside 24 hours is not counted', async () => {
  const { dash } = mkPanels();
  const r = (await (await get(dash, '/api/runs')).json()).runs;
  assert.deepEqual(r.workers, [{ worker: 'w-ok', runs: 2, failed: 1, last_status: 'failed' }]);
  assert.deepEqual(r.next.map(c => [c.name, c.next_fire]), [['w-ok', '2026-11-15 12:10:00'], ['w-quiet', '2026-11-15 13:00:00']], 'next runs come from fleet_crons for every enabled cron');
  const html = await (await get(dash, '/')).text();
  assert.match(html, /<td>w-ok<\/td><td>2<\/td><td>1<\/td><td>failed<\/td>/);
});

test('drift divergence comes from the latest wiring analysis and says not measured when none exists; the audit panel reads the chain head', async () => {
  const { dash } = mkPanels();
  const s = await dash.state();
  assert.deepEqual([s.panels.drift.ghosts, s.panels.drift.unregistered, s.panels.drift.orphan_tables, s.panels.drift.integration_score], [2, 3, 2, 0.82]);
  assert.deepEqual([s.panels.audit.events, s.panels.audit.head_seq, s.panels.audit.head_hash, s.panels.audit.chain_verified], [1, 1, 'abcdef123456', false]);
  assert.deepEqual((await (await get(dash, '/api/audit')).json()).head_hash, 'abcdef123456');
  const bare = mk({ graph: false });                            // no graph, audit or fleet tables at all
  const b = await bare.dash.state();
  assert.deepEqual([b.panels.drift.available, b.panels.audit.available, b.panels.runs.available], [false, false, false]);
  assert.match(await (await get(bare.dash, '/')).text(), /<h2>Drift<\/h2><p><small>not measured<\/small><\/p>/);
});

test('open work by role is counted, and the tracker port adds its open issues; a failing tracker is unavailable, not zero', async () => {
  const tracker = { openIssues: async () => ({ issues: [{ number: '1' }, { number: '2' }, { number: '3' }], complete: true }) };
  const a = (await mkPanels({ tracker }).dash.state()).panels.agent_issues;
  assert.equal(a.open, 2); assert.deepEqual(a.by_role, [{ role: 'staff', kind: 'fix', n: 1 }, { role: 'staff', kind: 'work', n: 1 }]);
  assert.deepEqual(a.tracker, { available: true, count: 3, complete: true });
  const bad = (await mkPanels({ tracker: { openIssues: async () => { throw new Error('403 from the tracker'); } } }).dash.state()).panels.agent_issues.tracker;
  assert.equal(bad.available, false); assert.match(bad.reason, /403/);
  assert.equal((await mkPanels().dash.state()).panels.agent_issues.tracker.available, false);
});

test('US-13-R02: the digest words the same panels the page shows', async () => {
  const tracker = { openIssues: async () => ({ issues: [{ number: '1' }], complete: false }) };
  const { l3, dash } = mkPanels({ tracker });
  const d = await l3.digest(); const s = await dash.state();
  assert.deepEqual(d.panels, s.panels);
  assert.match(d.text, /Open issues on the tracker: 1 \(the read was cut off\)/); assert.match(d.text, /2 named but not registered, 3 registered but unnamed, integration score 0.82/);
  assert.match(d.text, /Runs in 24 hours: 2, 1 failed/);
  assert.ok(!/Not measured here/.test(d.text));
  assert.match((await mk({ graph: false }).l3.digest()).text, /Not measured here: audit, drift, runs\./);
});

test('US-13-R24 and US-13-T09: the analytics panel shows requests and errors per script from the port and not measured when the port fails; next runs join by name', async () => {
  const asked = [];
  const analytics = async w => { asked.push(w); return { measured: true, by_script: { 'w-ok': { requests: 900, errors: 12, cpu_ms: 40 }, 'other': { requests: 5000, errors: 0 } } }; };
  const { dash } = mkPanels({ analytics });
  const s = await dash.state();
  assert.deepEqual([s.analytics.measured, s.analytics.requests, s.analytics.errors], [true, 5900, 12]);
  assert.deepEqual(s.analytics.by_script.map(r => r.name), ['other', 'w-ok']);
  assert.deepEqual(s.analytics.scheduled, [{ name: 'w-ok', next_fire: '2026-11-15 12:10:00', requests: 900, errors: 12 }, { name: 'w-quiet', next_fire: '2026-11-15 13:00:00', requests: null, errors: null }]);
  assert.equal(asked[0].to, new Date(T0).toISOString()); assert.equal(asked[0].from, new Date(T0 - 864e5).toISOString());
  const html = await (await get(dash, '/')).text();
  assert.match(html, /5900 requests, 12 errors/); assert.match(html, /<td>w-quiet<\/td><td>2026-11-15 13:00:00<\/td><td><small>not measured<\/small><\/td>/);
  for (const bad of [async () => { throw new Error('GraphQL 403'); }, async () => ({ measured: true }), async () => ({ measured: true, by_script: { x: { requests: 'many', errors: 1 } } }), null]) {
    const r = (await mkPanels({ analytics: bad }).dash.state()).analytics;
    assert.equal(r.measured, false); assert.ok(r.reason); assert.ok(!('requests' in r), 'no number is invented for a missing reading');
  }
  assert.match(await (await get(mkPanels({ analytics: async () => { throw new Error('GraphQL 403'); } }).dash, '/')).text(), /not measured<\/small> \(GraphQL 403\)/);
});

test('US-13-R25: the dashboard is served only to the signed-in owner and a state-changing request from another origin is refused', async () => {
  const { OUT_DIR } = await import('../../tools/build_migrations.mjs');
  const { createOrg } = await import('../org/index.js');
  const TOKEN = 'console-token-for-tests'; const ORIGIN = 'https://org.example.test';
  const db = makeDb([OUT_DIR]);
  const org = createOrg({ db, env: { CONSOLE_TOKEN: TOKEN }, config: { org_slug: 'r14', runner: { enabled: false } }, fetch: async () => new Response('{}'), now: () => T0 });
  const req = (path, { method = 'GET', authed = false, origin } = {}) => new Request(ORIGIN + path, { method, headers: { ...(authed ? { cookie: `us_console=${encodeURIComponent(TOKEN)}` } : {}), ...(origin ? { origin } : {}) } });
  const anon = await org.handle(req('/console/dashboard/api/state'));
  assert.equal(anon.status, 401, 'an anonymous caller gets 401');
  assert.equal((await org.handle(req('/console/dashboard/api/state', { authed: true }))).status, 200);
  assert.equal((await org.handle(req('/console/dashboard/api/refresh', { method: 'POST', authed: true, origin: 'https://evil.example.test' }))).status, 403);
  assert.equal((await org.handle(req('/console/dashboard/api/refresh', { method: 'POST', authed: true }))).status, 403, 'no origin header is refused too');
  assert.equal((await org.handle(req('/console/dashboard/api/refresh', { method: 'POST', authed: true, origin: ORIGIN }))).status, 200);
});
