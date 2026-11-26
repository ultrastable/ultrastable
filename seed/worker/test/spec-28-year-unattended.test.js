// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-28 (a year unattended): the requirements that live in JavaScript. The Cloudflare alert loop (CF-ALERTS-1) is kit code and runs in every
// seed; the pages that publish the year (/year, /year/failures, /trends) belong to the platform's site and are proved only where the monorepo
// holds them (existsSync guard, so a standalone seed checkout skips them, SEED-SELFCONTAINED-1). The clock is injected; nothing reaches a network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onCloudflareAlert, settleCloudflareAlerts, POLICIES, QUIET_HOURS } from '../src/cfalerts.js';
import { hiddenByHealthOnly } from '../src/visibility.js';

const d1 = () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT, kind TEXT, owner_role TEXT, done_check TEXT, closing_probe TEXT, priority INTEGER, status TEXT, disposition TEXT, updated_at TEXT)");
  const w = s => ({ bind: (...a) => ({ run: async () => { db.prepare(s).run(...a); return {}; }, first: async () => db.prepare(s).get(...a) || null, all: async () => ({ results: db.prepare(s).all(...a) }) }), run: async () => { db.exec(s); return {}; }, first: async () => db.prepare(s).get() || null, all: async () => ({ results: db.prepare(s).all() }) });
  return { raw: db, prepare: w };
};
const store = db => async it => { db.raw.prepare("INSERT OR IGNORE INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status) VALUES (?,?,?,?,?,?,?, 'ready')").run(it.id, it.title, it.kind, it.owner_role, it.done_check, it.closing_probe, it.priority); return true; };
const post = (body, auth) => new Request('https://t.example/hook/cloudflare', { method: 'POST', headers: auth ? { 'cf-webhook-auth': auth } : {}, body: typeof body === 'string' ? body : JSON.stringify(body) });
const T0 = Date.parse('2026-11-26T03:00:00Z');

test('US-28-R76: a verified alert is stored and filed as one item per alert type per day with the type\'s closing probe', async () => {
  const db = d1(), filed = [];
  const fileItem = async it => { filed.push(it); return true; };
  const r = await onCloudflareAlert(post({ alert_type: 'incident_alert', name: 'Major incident', text: 'Workers degraded' }, 's'), { db, secret: 's', fileItem, now: T0 });
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { ok: true, item: 'CF-ALERT-incident-alert-2026-11-26', filed: true });
  const it = filed[0];
  assert.deepEqual([it.kind, it.owner_role, it.priority, it.closing_probe], ['fix', 'operations', 2, 'cfalert:incident_alert']);
  assert.equal(it.title, 'Cloudflare alert incident_alert: Major incident');
  assert.match(it.done_check, /no incident_alert alert from Cloudflare for 24 hours \(cf_alerts\)/);
  await onCloudflareAlert(post({ alert_type: 'workers_observability_alert', name: 'Error rate' }, 's'), { db, secret: 's', fileItem, now: T0 });
  assert.equal(filed[1].priority, 5);
  await onCloudflareAlert(post({ alert_type: 'Bad Type!', name: 'Weird' }, 's'), { db, secret: 's', fileItem, now: T0 });  // an id that is not a plain type is filed as unknown
  assert.equal(filed[2].id, 'CF-ALERT-unknown-2026-11-26');
  await onCloudflareAlert(post({ alert_type: 'incident_alert', name: 'again' }, 's'), { db, secret: 's', fileItem: store(db), now: T0 + 3600e3 });
  await onCloudflareAlert(post({ alert_type: 'incident_alert', name: 'again' }, 's'), { db, secret: 's', fileItem: store(db), now: T0 + 7200e3 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id = 'CF-ALERT-incident-alert-2026-11-26'").get().n, 1);  // the same type on the same day is one item
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM cf_alerts WHERE alert_type = 'incident_alert'").get().n, 2 + 1);  // every alert is a row
  await onCloudflareAlert(post({ alert_type: 'incident_alert', name: 'n'.repeat(300), text: 't'.repeat(1500) }, 's'), { db, secret: 's', fileItem: store(db), now: T0 });
  const row = db.raw.prepare('SELECT name, text, item FROM cf_alerts ORDER BY id DESC LIMIT 1').get();
  assert.deepEqual([row.name.length, row.text.length, row.item], [200, 1000, 'CF-ALERT-incident-alert-2026-11-26']);
  const bare = await onCloudflareAlert(post({ alert_type: 'incident_alert', name: 'no queue' }, 's'), { db, secret: 's', now: T0 });
  assert.deepEqual(await bare.json(), { ok: true, item: 'CF-ALERT-incident-alert-2026-11-26', filed: false });
});

test('US-28-R77: an alert is accepted only with the destination\'s secret, and the destination\'s delivery check files nothing', async () => {
  const db = d1(), filed = [];
  const fileItem = async it => { filed.push(it); return true; };
  assert.equal((await onCloudflareAlert(post({ alert_type: 'incident_alert' }, 'x'), { db, secret: '', fileItem })).status, 503);
  assert.equal((await onCloudflareAlert(post({ alert_type: 'incident_alert' }, 'wrong'), { db, secret: 's', fileItem })).status, 401);
  assert.equal((await onCloudflareAlert(post({ alert_type: 'incident_alert' }), { db, secret: 's', fileItem })).status, 401);
  assert.equal((await onCloudflareAlert(post('{not json', 's'), { db, secret: 's', fileItem })).status, 400);
  assert.equal(filed.length, 0);
  const t = await onCloudflareAlert(post({ text: 'Hello World! This is a test message sent from https://cloudflare.com' }, 's'), { db, secret: 's', fileItem, now: T0 });
  assert.deepEqual([t.status, await t.json()], [200, { ok: true, test: true }]);
  assert.equal(filed.length, 0);
  assert.equal(db.raw.prepare('SELECT alert_type FROM cf_alerts').get().alert_type, 'destination_test');
  const named = await onCloudflareAlert(post({ alert_type: 'incident_alert', name: 'test of the failover' }, 's'), { db, secret: 's', fileItem, now: T0 });
  assert.equal(named.status, 202);  // a real alert type is never mistaken for the delivery check
  assert.equal(filed.length, 1);
});

test('US-28-R78: an alert item closes itself once its type has been quiet for a day, with that evidence, and not before', async () => {
  const db = d1();
  for (const [type, at] of [['incident_alert', T0], ['workers_observability_alert', T0]]) await onCloudflareAlert(post({ alert_type: type, name: type }, 's'), { db, secret: 's', fileItem: store(db), now: at });
  await onCloudflareAlert(post({ alert_type: 'workers_observability_alert', name: 'again' }, 's'), { db, secret: 's', fileItem: store(db), now: T0 + 20 * 3600e3 });
  db.raw.prepare("INSERT INTO items (id, title, status, closing_probe) VALUES ('CF-ALERT-never-2026-11-26', 't', 'ready', 'cfalert:never_seen'), ('OTHER-1', 't', 'ready', 'cfalert:incident_alert')").run();
  assert.deepEqual(await settleCloudflareAlerts(db, { now: T0 + 3600e3 }), { open: 3, closed: [] });
  const r = await settleCloudflareAlerts(db, { now: T0 + 25 * 3600e3 });
  assert.deepEqual(r, { open: 3, closed: ['CF-ALERT-incident-alert-2026-11-26'] });  // the other type alerted again 5 hours ago; one with no alert on record stays open
  const done = db.raw.prepare("SELECT status, disposition FROM items WHERE id = 'CF-ALERT-incident-alert-2026-11-26'").get();
  assert.equal(done.status, 'done');
  assert.equal(done.disposition, 'probe green: cfalert:incident_alert quiet since 2026-11-26T03:00:00.000Z');
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id = 'OTHER-1'").get().status, 'ready');
  assert.deepEqual(await settleCloudflareAlerts(db, { now: T0 + 26 * 3600e3 }), { open: 2, closed: [] });  // a closed item is not read again
  assert.equal(QUIET_HOURS, 24);
});

test('US-28-R79: the destination declares four alert policies and its hook stays reachable on a worker that shows only /health', () => {
  assert.deepEqual(POLICIES.map(p => p.alert_type), ['incident_alert', 'workers_observability_alert', 'billing_budget_alert', 'universal_ssl_event_type']);
  assert.ok(POLICIES.every(p => /CF-ALERTS-1/.test(p.name) && typeof p.filters === 'object'));
  const env = { PUBLIC_HEALTH_ONLY: '1' };
  assert.equal(hiddenByHealthOnly(env, 'POST', '/hook/cloudflare'), false);
  assert.equal(hiddenByHealthOnly(env, 'GET', '/hook/cloudflare'), true);
  assert.equal(hiddenByHealthOnly(env, 'GET', '/api/private'), true);
  assert.equal(hiddenByHealthOnly({}, 'GET', '/api/private'), false);
});

// ---- the pages that publish the year: platform only ------------------------------------------------------------------------------------------
const site = f => new URL('../../../site/' + f, import.meta.url);
const hasSite = ['year.js', 'yearfail.js', 'temporal.js'].every(f => existsSync(site(f)));
const shell = (meta, body) => '<!doctype html><title>' + meta.title + '</title>' + meta.path + body;
const HTML = { 'Content-Type': 'text/html; charset=utf-8' };
const Y = {
  measured: true, at: '2026-11-26T07:08:38Z', target_days: 365, runs: 200, days: 730, horizon: { p10: 730, p50: 700, p90: 730, survive_year: 0.9 }, strict: { p10: 50, p50: 233 },
  self_rate_per_day: 0.714, release_horizon_p10: 730, meets_target: true,
  classes: [{ id: 'a', what: 'the scheduler skips runs', rate: 52, basis: 'observed: five in 1011', mode: 'recovers', capacity: 0.6, recover: true, exercised: true, evidence: 'takes over <b>now</b>' },
            { id: 'b', what: 'GitHub is down', rate: null, basis: 'scheduled', mode: 'degrades', capacity: 0.3, recover: true, exercised: false, evidence: 'declared' }],
  sensitivity: [{ id: 'a', what: 'the scheduler skips runs', swing: 0.125 }], findings: [{ id: 'b', why: 'its recovery is declared but no drill exercises code' }],
};

test('US-28-R80: /year states the measured horizon, the strict horizon and every class with what the drill showed, escaped, and says so before a first reading', { skip: !hasSite }, async () => {
  const { yearBody } = await import(site('year.js').href);
  const h = yearBody(Y, { measured: false });
  assert.match(h, /Meets the target of 365 days\. In 1 of 10 simulated years the system stops shipping by day 730; half reach day 700\. Measured 2026-11-26T07:08:38Z from 200 simulated years\./);
  assert.match(h, /10th percentile 730 days, median 700 days\. Share of years that reach the target: 90%/);
  assert.match(h, /If every sign-in and card fails<\/h3><p class="meta">10th percentile 50 days/);
  assert.match(h, /0\.714 substantive changes a day/);
  assert.match(h, /<td class="us-pass">Recovers by itself \(60% capacity\)<\/td>/);
  assert.match(h, /<td class="us-fail">Keeps running, slower \(30% capacity\), declared<\/td>/);
  assert.match(h, /<td>52x<br>/);
  assert.match(h, /<td>dated<br>/);
  assert.match(h, /takes over &lt;b&gt;now&lt;\/b&gt;/);
  assert.doesNotMatch(h, /<b>now<\/b>/);
  assert.match(h, /the scheduler skips runs: swing 12\.5 points/);
  assert.match(h, /<li>b: its recovery is declared but no drill exercises code<\/li>/);
  assert.match(yearBody({ ...Y, meets_target: false }, { measured: false }), /Below the target of 365 days\. In 1 of 10 simulated years/);
  assert.match(yearBody({ ...Y, self_rate_per_day: null }, { measured: false }), /unmeasured originated by the server itself/);
  assert.match(yearBody({ measured: false }, { measured: false }), /The year simulation has not run yet/);
});

test('US-28-R81: /year and /year.json are served from the generated data; the JSON carries all three readings and is public and cached for 5 minutes', { skip: !hasSite }, async () => {
  const { yearRoutes } = await import(site('year.js').href);
  const page = yearRoutes(new URL('https://x.example/year/'), shell, HTML);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /A year unattended, measured/);
  assert.equal(page.headers.get('Cache-Control'), 'public, max-age=300');
  const j = yearRoutes(new URL('https://x.example/year.json'), shell, HTML);
  const body = await j.json();
  assert.deepEqual(Object.keys(body).sort(), ['saydo', 'trajectory', 'year']);
  assert.equal(typeof body.year.measured, 'boolean');
  assert.equal(j.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(j.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal(yearRoutes(new URL('https://x.example/elsewhere'), shell, HTML), null);
});

test('US-28-R82: /year/failures lists each simulated month with its result, never rounds an uncovered month up, and its JSON is public', { skip: !hasSite }, async () => {
  const { yearFailPage, yearFailRoutes } = await import(site('yearfail.js').href);
  const F = { pass: 1, fail: 1, uncovered: 1, honesty: 'repairs were applied <by the harness>', months: [
    { month: 1, area: 'bootstrap', failure: 'a fresh copy must boot', result: 'PASS', evidence: 'selfhost ok' },
    { month: 2, area: 'ci', failure: '', result: 'FAIL', evidence: 'x'.repeat(300) }, { month: 3, area: 'apps', result: 'UNCOVERED', why: 'no api to delete an app' }] };
  const h = yearFailPage(shell, F);
  assert.match(h, /1 of 3 simulated months passed, 1 failed and 1 are not simulated yet\./);
  assert.match(h, /<strong>PASS<\/strong><\/td><td>selfhost ok/);
  assert.match(h, /<strong>UNCOVERED<\/strong><\/td><td>no api to delete an app/);
  assert.match(h, new RegExp('<td>' + 'x'.repeat(200) + '</td>'));
  assert.doesNotMatch(h, /x{201}/);
  assert.match(h, /repairs were applied &lt;by the harness&gt;/);
  const u = p => new URL('https://x.example' + p);
  const json = await yearFailRoutes(u('/year/failures.json'), {}, shell, HTML);
  assert.equal(json.headers.get('Access-Control-Allow-Origin'), '*');
  assert.ok(Array.isArray((await json.json()).months));
  assert.equal((await yearFailRoutes(u('/year/failures'), {}, shell, HTML)).status, 200);
  assert.equal(await yearFailRoutes(u('/elsewhere'), {}, shell, HTML), null);
});

const TR = {
  at: '2026-11-26T07:00:00Z', history_from: '2026-11-18', window: { recent_days: 3, baseline_days: 14, spark_days: 28 },
  findings: [{ kind: 'stopped_loop', subject: 'ledger:deploys:tick', evidence: 'last event 198 h ago', advocate: 'infrastructure-manager', runs: 2, item: 'Q-TEMPORAL-abc' }],
  areas: [{ id: 'site', spark: [1, 2, 3], recent_rate: 2.5, baseline_rate: 1, last_active: '2026-11-25' }],
  ledgers: [{ id: 'ledger:deploys:tick', spark: [1, 0, 1], events: 2, fails: 1, last: '2026-11-20' }],
  history: [{ open: 1 }, { open: 2 }], settled: [{}], tenants: [], simulation: { pass: 10, months: 13, fail: 2, uncovered: 1 },
};

test('US-28-R83: /trends shows each area and loop as a daily series with the findings and their queue items, and says when nothing is open', { skip: !hasSite }, async () => {
  const { trendsPage, trendsRoutes, spark } = await import(site('temporal.js').href);
  const h = trendsPage(shell, TR);
  assert.match(h, /stopped loop<\/td><td><code>ledger:deploys:tick<\/code><\/td><td>last event 198 h ago<\/td><td>infrastructure-manager<\/td><td>2<\/td><td><code>Q-TEMPORAL-abc<\/code>/);
  assert.match(h, /back to 2026-11-18, compares the last 3 days with the days before/);
  assert.match(h, /<th scope="row">site<\/th>.*2\.5 \/ day.*1 \/ day.*2026-11-25/s);
  assert.match(h, /<code>deploys:tick<\/code>/);
  assert.match(h, /2 runs recorded; 1 findings settled\./);
  assert.match(h, /10 of 13 simulated months passed, 2 failed, 1 are not simulated yet\./);
  assert.match(trendsPage(shell, { ...TR, findings: [], simulation: null }), /No open findings: every series is inside its own baseline\./);
  const withTenant = trendsPage(shell, { ...TR, tenants: [{ tenant: 'px', history_from: '2026-11-10', findings: [{ kind: 'neglect', subject: 'area:docs', evidence: 'untouched', advocate: 'project-manager' }] }] });
  assert.match(withTenant, /Systems built on it.*<h3>px<\/h3><p>History from 2026-11-10; 1 open findings\./s);
  assert.match(spark([0, 5, 10]), /points="0\.0,30\.0 70\.0,16\.0 140\.0,2\.0"/);
  assert.match(spark([1], { label: 'a "q" <b>' }), /aria-label="a &quot;q&quot; &lt;b&gt;"/);
  const u = p => new URL('https://x.example' + p);
  const json = await trendsRoutes(u('/trends.json'), {}, shell, HTML);
  assert.equal(json.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(typeof (await json.json()), 'object');
  assert.equal((await trendsRoutes(u('/trends/'), {}, shell, HTML)).status, 200);
  assert.equal(await trendsRoutes(u('/elsewhere'), {}, shell, HTML), null);
});

test('US-28-R84: the over-time section of /year draws one mark per day for each area, loop and the backlog, names what the shape shows and what was observed, and is empty before a reading', { skip: !hasSite }, async () => {
  const { trajectoryBody } = await import(site('year.js').href);
  assert.equal(trajectoryBody({ measured: false }), '');
  const t = { measured: true, days: 30, history_days: 9,
    areas: [{ area: 'site', series: [0, 1, 2, 0], share_recent: 0.5, quiet_days: 0 }, { area: 'old', series: [3, 0, 0, 0], share_recent: 0.1, quiet_days: 12 }],
    loops: [{ loop: 'beat', series: [1, 1, 0, 0], rows: 2, quiet_days: 2 }], issues: { backlog_series: [0, 1, 2, -1], opened: 3, closed: 1 },
    findings: [{ kind: 'hotspot', why: 'site drew 50% of the last week' }], observed: { ci_unavailable: { rate_year: 12.5, trend: 0.4, events: 3 }, reverts: { rate_year: null, events: 0 } } };
  const h = trajectoryBody(t);
  assert.match(h, /last 30 days \(9 with history\)/);
  assert.match(h, /<td>site<\/td><td><span class="mono" aria-label="per-day series">·▄█·<\/span><\/td><td><small>50% of last week<\/small>/);
  assert.match(h, /<td>old<\/td>.*10% of last week, quiet 12 days/s);
  assert.match(h, /<td>loop: beat<\/td>.*2 rows, quiet 2 days/s);
  assert.match(h, /<td>issue backlog<\/td><td><span class="mono" aria-label="per-day series">·▄█·<\/span>.*3 opened, 1 closed/s);  // a negative backlog is drawn as zero
  assert.match(h, /<li>hotspot: site drew 50% of the last week<\/li>/);
  assert.match(h, /ci_unavailable 12\.5 a year \(trend 0\.4\)/);
  assert.doesNotMatch(h, /reverts/);
});
