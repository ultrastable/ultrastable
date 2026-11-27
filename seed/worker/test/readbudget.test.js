// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// READ-BUDGET-9, LEAN-FLOOR-1, WAKE-BUDGET-1: the tick's reads stay inside the D1 rows-read budget, and a breach that lasts cannot starve the queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { beatStats24h } from '../src/beatstats.js';
import { METRICS, runTick, stepPlan, wakeAllowed, LEAN_WORK_MAX_SKIPS, LEAN_WORK_STEPS, WAKE_MIN_GAP_MS, STEP_ORDER } from '../src/tick.js';
import { strideFor } from '../src/pace.js';
import { ingestDeploys } from '../src/selfaudit.js';
import { recordSweep } from '../src/sweeper.js';
import { seal, record } from '../src/auditchain.js';

const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const NOW = Date.parse('2026-11-20T12:34:00Z');
// Every SQL text the code under test prepares, with what it was bound to.
function spy(db) {
  const seen = [], prepare = db.prepare.bind(db);
  db.prepare = sql => { const st = prepare(sql), bind = st.bind.bind(st); const e = { sql, args: [] }; seen.push(e); st.bind = (...a) => { e.args = a; return bind(...a); }; return st; };
  return seen;
}
const plan = (db, sql, ...a) => db.raw.prepare('EXPLAIN QUERY PLAN ' + sql).all(...a).map(r => r.detail).join(' | ');
function beatsDb() {
  const db = makeDb();
  const ins = db.raw.prepare(`INSERT INTO loop_beats (loop, slot, source, started_at, finished_at, ok, detail) VALUES (?,?,?,?,?,?,?)`);
  for (let m = 26 * 60; m >= 0; m -= 10) {  // 26 h of beats, three loops, every 10 minutes
    const at = NOW - m * 60e3, slot = Math.floor(at / 600e3);
    ins.run('lane', slot, 'cron', iso(at), iso(at + 1000), 1, m % 30 === 0 ? '{"merged":[1]}' : '{}');
    ins.run('gate', slot, 'cron', iso(at), iso(at + 1000), m % 20 === 0 ? 0 : 1, '{"paced":true}');
    if (m % 60 === 0) ins.run('hourly', slot, 'cron', iso(at), iso(at + 1000), 1, '{"x":1}');
  }
  return db;
}
// The three scans the cached reading replaces, exactly as tick.js ran them before.
function fullScan(db, now) {
  const cut = iso(now - 86400e3);
  const a = db.raw.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN ok = 1 AND detail IS NOT NULL AND detail NOT IN ('null','{}','[]') AND detail NOT LIKE '{"paced"%' THEN 1 ELSE 0 END) AS p FROM loop_beats WHERE started_at >= ?`).get(cut);
  const c = db.raw.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN good >= 0.9 THEN 1 ELSE 0 END) AS c FROM (SELECT loop, 1.0 * SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) / COUNT(*) AS good FROM loop_beats WHERE started_at >= ? AND finished_at IS NOT NULL GROUP BY loop)`).get(cut);
  return { n: a.n, share: Math.round(1000 * (a.p || 0) / a.n) / 1000, closing: Math.round(1000 * (c.c || 0) / c.n) / 1000 };
}

test('READ-BUDGET-9: the cached 24 h beat reading equals the full scans, and a second reading reads only the last two hours', async () => {
  const db = beatsDb(), want = fullScan(db, NOW);
  assert.equal(await METRICS.beats_24h(db, NOW), want.n);
  assert.equal(await METRICS.beats_productive_share_24h(db, NOW), want.share);
  assert.equal(await METRICS.loops_closing_share_24h(db, NOW), want.closing);
  assert.ok(want.n > 250 && want.closing > 0 && want.closing < 1, 'the fixture exercises every figure');

  const later = NOW + 600e3;  // the next tick: one more beat, and one that was open is now closed
  db.raw.prepare(`INSERT INTO loop_beats (loop, slot, source, started_at, finished_at, ok, detail) VALUES ('lane', ?, 'cron', ?, ?, 1, '{"merged":[2]}')`).run(Math.floor(later / 600e3), iso(later - 1000), iso(later));
  const seen = spy(db);
  const s = await beatStats24h(db, later), again = fullScan(db, later);
  assert.equal(s.n, again.n); assert.equal(Math.round(1000 * s.productive / s.n) / 1000, again.share);
  const reads = seen.filter(e => /FROM loop_beats/.test(e.sql));
  assert.equal(reads.length, 2, 'the fresh tail and the far edge of the window, nothing else');
  const tail = reads.find(e => /GROUP BY \+loop, h/.test(e.sql));
  assert.equal(tail.args[0], '2026-11-20 11:00:00', 'the tail starts at the previous hour, not 24 h back');
  const edge = reads.find(e => e !== tail);
  assert.deepEqual(edge.args, ['2026-11-19 12:44:00', '2026-11-19 13:00:00'], 'the edge is the partial hour only');
  // one measure step asks three times at the same instant: one reading
  const seen2 = spy(db);
  await Promise.all([METRICS.beats_24h(db, later + 1), METRICS.beats_productive_share_24h(db, later + 1), METRICS.loops_closing_share_24h(db, later + 1)]);
  assert.equal(seen2.filter(e => /FROM loop_beats/.test(e.sql)).length, 2);
});

test('READ-BUDGET-9: a beat that was open when its hour was cached is counted as closed once it finishes', async () => {
  const db = makeDb(), at = NOW - 20 * 60e3;
  db.raw.prepare(`INSERT INTO loop_beats (loop, slot, source, started_at) VALUES ('lane', 1, 'cron', ?)`).run(iso(at));
  assert.equal(await METRICS.loops_closing_share_24h(db, NOW), 0, 'an open beat is not a closed loop');
  db.raw.prepare(`UPDATE loop_beats SET finished_at = ?, ok = 1, detail = '{"merged":[1]}'`).run(iso(at + 5000));
  assert.equal(await METRICS.loops_closing_share_24h(db, NOW + 600e3), 1);
  assert.equal(await METRICS.beats_productive_share_24h(db, NOW + 600e3), 1);
  db.raw.exec('DROP TABLE loop_beats');
  assert.equal(await METRICS.beats_24h(db, NOW + 1200e3), 0, 'no ledger yet reads 0, never throws');
});

test('READ-BUDGET-9: the changed queries are answered by an index, with no sort and no full scan', async () => {
  const db = makeDb();
  const pace = plan(db, `SELECT ok, detail FROM loop_beats WHERE loop = ? AND finished_at IS NOT NULL AND (detail IS NULL OR (detail NOT LIKE '{"paced"%' AND detail NOT LIKE '{"status":"deferred"%')) ORDER BY slot DESC, id DESC LIMIT ?`, 'lane', 12);
  assert.match(pace, /USING INDEX loop_beats_loop/); assert.doesNotMatch(pace, /TEMP B-TREE/);
  const live = plan(db, `SELECT n, title, by_origin, merged_at, url, substance FROM live_changes WHERE repo = ? ORDER BY merged_at DESC LIMIT 200`, 'o/r');
  assert.match(live, /USING INDEX live_changes_repo_merged/); assert.doesNotMatch(live, /TEMP B-TREE/);
  const pending = plan(db, `SELECT n, repo FROM live_changes WHERE substance IS NULL ORDER BY merged_at DESC LIMIT ?`, 2);
  assert.match(pending, /USING INDEX live_changes_pending/);
  const cap = plan(db, `DELETE FROM live_changes WHERE repo = ? AND merged_at < (SELECT merged_at FROM live_changes WHERE repo = ? ORDER BY merged_at DESC LIMIT 1 OFFSET 399)`, 'o/r', 'o/r');
  assert.match(cap, /live_changes_repo_merged/); assert.doesNotMatch(cap, /SCAN live_changes(?! USING)/);
  const { ensureSchema } = await import('../src/auth/store.js'); await ensureSchema(db);
  const conn = plan(db, `SELECT event, at FROM credential_events WHERE tenant = ? AND provider = ? ORDER BY id DESC LIMIT 5`, 't', 'p');
  assert.match(conn, /USING (COVERING )?INDEX credential_events_tenant_provider/); assert.doesNotMatch(conn, /TEMP B-TREE/);
  const refusal = plan(db, `SELECT 1 AS x FROM (SELECT at, event, detail FROM credential_events WHERE tenant = ? AND provider = ? ORDER BY id DESC LIMIT 20) WHERE event = 'failed' AND substr(detail, 1, ?) = ? LIMIT 1`, 't', 'p', 3, 'cal');
  assert.match(refusal, /INDEX credential_events_tenant_provider/); assert.doesNotMatch(refusal, /TEMP B-TREE/);  // store.refusal (US-30-R41)
  for (const sql of [`SELECT 1 AS x FROM credential_events WHERE tenant = ? AND provider = 'github-admin' AND event = 'archived' LIMIT 1`,
    `SELECT detail FROM credential_events WHERE tenant = ? AND provider = 'github-admin' AND event = 'rulesets' ORDER BY at DESC, rowid DESC LIMIT 1`,
    `SELECT at FROM credential_events WHERE tenant = ? AND event = 'app-audit' ORDER BY id DESC LIMIT 1`]) {
    const p = plan(db, sql, 't');
    assert.match(p, /INDEX credential_events_tenant_event/, sql); assert.doesNotMatch(p, /SCAN credential_events/, sql);
  }
  const open = plan(db, `SELECT id FROM items WHERE id >= ? AND id < ? AND status NOT IN ('done','superseded','cancelled') LIMIT 1`, 'IDLE-', 'IDLE-￿');
  assert.match(open, /SEARCH items USING INDEX sqlite_autoindex_items_1 \(id>\? AND id<\?\)/);
  const sweep = plan(db, `DELETE FROM sweeper_runs WHERE id <= (SELECT MAX(id) FROM sweeper_runs) - 500`);
  assert.match(sweep, /SEARCH sweeper_runs USING INTEGER PRIMARY KEY \(rowid<\?\)/);
});

test('READ-BUDGET-9: pace reads a loop newest first by slot, the same rows the id order gave', async () => {
  const db = makeDb(), ins = db.raw.prepare(`INSERT INTO loop_beats (loop, slot, source, started_at, finished_at, ok, detail) VALUES ('sweeper', ?, 'cron', ?, ?, 1, ?)`);
  for (let i = 0; i < 40; i++) ins.run(1000 + i, iso(NOW + i * 600e3), iso(NOW + i * 600e3 + 1), i < 30 ? '{"merged":[1]}' : '{}');  // the newest ten runs are idle
  const cfg = { pace: { idle_runs: 5, max_stride: 8, never_pace: [] } };
  assert.equal(await strideFor(db, 'sweeper', cfg), 4, 'ten idle runs in a row at idle_runs 5 double the stride twice');
});

test('READ-BUDGET-9: the sweeper ledger keeps its newest 500 rows', async () => {
  const db = makeDb(), out = { status: 'ok', merged: [], filed: [], released: [], errors: [], open_loop_age_hours: 0 };
  db.raw.exec(`WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 520) INSERT INTO sweeper_runs (at, status) SELECT '2026-11-20 00:00:00', 'ok' FROM c`);
  await recordSweep(db, out);
  const r = db.raw.prepare('SELECT COUNT(*) n, MIN(id) lo, MAX(id) hi FROM sweeper_runs').get();
  assert.equal(r.n, 500); assert.equal(r.hi, 521); assert.equal(r.lo, 22);
});

test('READ-BUDGET-9: deploy evidence checks only the lines added since its last pass', async () => {
  const db = makeDb(), row = i => JSON.stringify({ at: '2026-11-13T18:33:33Z', worker: 'w' + i, uploaded: true, live_matches_commit: true, sha: String(i).padStart(40, 'a') });
  let body = Array.from({ length: 100 }, (_, i) => row(i)).join('\n') + '\n';
  const f = async () => ({ ok: true, status: 200, text: async () => body });
  assert.equal((await ingestDeploys(db, { token: 't', repo: 'o/r', fetch: f })).ingested, 100);
  const seen = spy(db), again = await ingestDeploys(db, { token: 't', repo: 'o/r', fetch: f });
  assert.equal(again.ingested, 0);
  assert.equal(seen.filter(e => /FROM outcomes WHERE item_id/.test(e.sql)).length, 20, 'the overlap only, not all 100 lines');
  body += row(100) + '\n' + row(101) + '\n';
  assert.equal((await ingestDeploys(db, { token: 't', repo: 'o/r', fetch: f })).ingested, 2);
  body = row(200) + '\n';  // the ledger was rewritten shorter: a full pass, nothing lost
  assert.equal((await ingestDeploys(db, { token: 't', repo: 'o/r', fetch: f })).ingested, 1);
  assert.equal((await ingestDeploys(db, { token: 't', repo: 'other/r', fetch: f })).ingested, 0, 'another repository starts from its own first line and finds the row already recorded');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM outcomes WHERE surface = 'deploy'`).get().n, 103);
});

test('READ-BUDGET-9: sealing with nothing old enough reads one row, not the hot chain', async () => {
  const db = makeDb();
  for (let i = 0; i < 5; i++) await record(db, { kind: 'decision', actor: 'test', ref: 'r' + i, summary: 's' });
  const sink = { name: 'mem', async get() { return null; }, async put() {} };
  const seen = spy(db), r = await seal(db, [sink]);
  assert.equal(r.sealed, 0); assert.match(r.skipped, /nothing older than/);
  assert.equal(seen.filter(e => /SELECT \* FROM audit_log/.test(e.sql)).length, 0);
  assert.ok(seen.some(e => /SELECT rec FROM audit_log WHERE seq > \?1 ORDER BY seq LIMIT 1/.test(e.sql)));
});

// ---- LEAN-FLOOR-1, WAKE-BUDGET-1 ----
const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, cost_budgets: [{ id: 'org', max_rows_read_per_hour: 120000 }] };
const T0 = Date.parse('2026-11-10T01:15:00Z');  // off the three-hour boundary: lean defers everything it may
function leanDb() {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('A','a','staff','x',10,'open');`);
  return db;
}
const breach = (db, now) => db.raw.prepare('INSERT INTO cost_samples (at, target, rows_read_1h) VALUES (?,?,?)').run(iso(now - 60e3), 'org', 500000);

test('LEAN-FLOOR-1: stepPlan runs the work steps, and only those, when the floor is reached', () => {
  for (const s of LEAN_WORK_STEPS) { assert.equal(stepPlan(s, { lean: true, now: T0 }), 'defer', s); assert.equal(stepPlan(s, { lean: true, now: T0, leanFloor: true }), 'run', s); }
  assert.equal(stepPlan('pulse', { lean: true, now: T0, leanFloor: true }), 'defer', 'a wide reader still waits');
  assert.equal(stepPlan('selfaudit', { lean: true, now: T0, leanFloor: true }), 'defer');
  assert.equal(stepPlan('dispatch', { now: T0, leanFloor: true }), 'run', 'not lean: nothing changes');
});

test('LEAN-FLOOR-1: a breach that lasts cannot starve dispatch; after the bounded run of lean ticks the work steps run and the report says so', async () => {
  const db = leanDb();
  let t = T0;
  for (let i = 0; i < LEAN_WORK_MAX_SKIPS; i++, t += 600e3) {
    breach(db, t);
    const r = await runTick(db, { config, now: t });
    assert.match(r.report, /cost breach/); assert.match(r.report, /dispatched 0 item/); assert.doesNotMatch(r.report, /lean floor/);
    assert.equal(db.raw.prepare(`SELECT value FROM org WHERE key = 'lean_work_skips'`).get().value, String(i + 1));
  }
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM dispatches').get().n, 0, 'nothing was dispatched while the count ran');
  breach(db, t);
  const r = await runTick(db, { config, now: t });
  assert.equal(r.completed, STEP_ORDER.length); assert.deepEqual(r.errors, []);
  assert.match(r.report, new RegExp(`lean floor: reap_claims, dispatch, execute run this tick after ${LEAN_WORK_MAX_SKIPS} lean tick\\(s\\) without them`));
  assert.match(r.report, /cost breach/, 'the breach is still reported');
  assert.match(r.report, /dispatched 1 item/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM dispatches').get().n, 1);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM loop_clock`).get().n, 0, 'the wide readers (pulse) stayed deferred');
  assert.equal(db.raw.prepare(`SELECT value FROM org WHERE key = 'lean_work_skips'`).get().value, '0', 'the count starts again');
  t += 600e3; breach(db, t);
  assert.doesNotMatch((await runTick(db, { config, now: t })).report, /lean floor/, 'the next lean tick is lean again');
  // the breach clears: a full tick, and the count is at rest
  t += 3700e3;
  const full = await runTick(db, { config, now: t });
  assert.doesNotMatch(full.report, /cost breach|lean floor/);
  assert.equal(db.raw.prepare(`SELECT value FROM org WHERE key = 'lean_work_skips'`).get().value, '0');
});

test('WAKE-BUDGET-1: an event wakes no tick during a rows-read breach, and at most one between two cron ticks', async () => {
  const db = leanDb();
  assert.deepEqual(await wakeAllowed(db, { config, now: T0 }), { ok: true, why: null }, 'no tick yet, no breach');
  db.raw.prepare('INSERT INTO tick_runs (started_at, steps_total) VALUES (?, 19)').run(iso(T0));
  assert.deepEqual(await wakeAllowed(db, { config, now: T0 + 90e3 }), { ok: false, why: 'tick-90s-ago' });
  assert.equal((await wakeAllowed(db, { config, now: T0 + WAKE_MIN_GAP_MS })).ok, true);
  breach(db, T0 + WAKE_MIN_GAP_MS);
  assert.deepEqual(await wakeAllowed(db, { config, now: T0 + WAKE_MIN_GAP_MS }), { ok: false, why: 'cost-breach' });
  const broken = { prepare() { throw new Error('D1 down'); } };
  assert.equal((await wakeAllowed(broken, { config: {}, now: T0 })).ok, false, 'an unreadable database is not woken harder');
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const hook = src.slice(src.indexOf("url.pathname === '/hook/github' && request.method"), src.indexOf("url.pathname === '/hook/host' && request.method"));
  assert.ok(hook.indexOf('wakeAllowed(env.DB') > 0 && hook.indexOf('wakeAllowed(env.DB') < hook.indexOf('runTick(env.DB'), 'the webhook asks before it runs a tick');
});

test('READ-BUDGET-9: /api/live/changes reads the rows again only after a refresh or a new verdict', async () => {
  const { readLiveChanges, refreshLiveChanges } = await import('../src/livechanges.js');
  const db = makeDb();
  let prs = [{ number: 1, title: 'one', merged_at: '2026-11-20T10:00:00Z', html_url: 'u1', user: { login: 'a' }, head: { ref: 'b' }, labels: [] }];
  const f = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(prs) });
  await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: f, now: NOW });
  const rowReads = seen => seen.filter(e => /SELECT n, title, by_origin/.test(e.sql)).length;
  let seen = spy(db);
  const a = await readLiveChanges(db, 'o/r'); assert.equal(a.changes.length, 1); assert.equal(rowReads(seen), 1);
  seen = spy(db);
  assert.deepEqual(await readLiveChanges(db, 'o/r'), a); assert.equal(rowReads(seen), 0, 'unchanged: served from the isolate');
  db.raw.prepare(`UPDATE live_changes SET substance = 'trivial' WHERE n = 1`).run();
  seen = spy(db);
  assert.equal((await readLiveChanges(db, 'o/r')).changes[0].substance, 'trivial', 'a new verdict is read at once'); assert.equal(rowReads(seen), 1);
  prs = [...prs, { number: 2, title: 'two', merged_at: '2026-11-20T11:00:00Z', html_url: 'u2', user: { login: 'a' }, head: { ref: 'b' }, labels: [] }];
  await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: f, now: NOW + 600e3 });
  assert.equal((await readLiveChanges(db, 'o/r')).changes.length, 2, 'a refresh is read at once');
  assert.match(plan(db, 'SELECT COUNT(*) AS n FROM live_changes WHERE substance IS NULL'), /live_changes_pending/);
});

test('READ-BUDGET-11: a refresh that finds the same pull requests costs no reading of the rows, in a new isolate too', async () => {
  const { readLiveChanges, refreshLiveChanges } = await import('../src/livechanges.js');
  const db = makeDb();
  let prs = [{ number: 1, title: 'one', merged_at: '2026-11-20T10:00:00Z', html_url: 'u1', user: { login: 'a' }, head: { ref: 'b' }, labels: [] }];
  const f = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(prs) });
  const rowReads = seen => seen.filter(e => /SELECT n, title, by_origin/.test(e.sql)).length;
  await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: f, now: NOW });
  db.raw.prepare(`UPDATE live_changes SET substance = 'substantive'`).run();
  const a = await readLiveChanges(db, 'o/r');
  await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: f, now: NOW + 600e3 });           // the next tick: same pull requests, a newer refresh time
  let seen = spy(db);
  const b = await readLiveChanges(db, 'o/r');
  assert.equal(rowReads(seen), 0, 'same signature: the rows are not read again');
  assert.deepEqual(b.changes, a.changes); assert.equal(b.refreshed_at, new Date(NOW + 600e3).toISOString(), 'the refresh time it reports is the newest one');
  const other = { raw: db.raw, prepare: (...x) => db.prepare(...x), batch: (...x) => db.batch(...x) };  // another isolate: a new binding object, nothing in memory
  seen = spy(other);
  assert.deepEqual(await readLiveChanges(other, 'o/r'), b); assert.equal(rowReads(seen), 0, 'another isolate is served from the kept answer');
  prs = [...prs, { number: 2, title: 'two', merged_at: '2026-11-20T11:00:00Z', html_url: 'u2', user: { login: 'a' }, head: { ref: 'b' }, labels: [] }];
  await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: f, now: NOW + 1200e3 });
  assert.equal((await readLiveChanges(other, 'o/r')).changes.length, 2, 'a new pull request is read at once');
  db.raw.prepare(`DELETE FROM org WHERE key = 'live_sig:o/r'`).run();
  db.raw.prepare(`UPDATE live_changes SET title = 'renamed' WHERE n = 2`).run(); db.raw.prepare(`UPDATE live_changes_meta SET refreshed_at = 'later'`).run();
  assert.equal((await readLiveChanges(other, 'o/r')).changes[0].title, 'renamed', 'no signature: the refresh time decides, as before');
});

test('READ-BUDGET-9: the cap on live changes keeps the newest 400 of a repository', async () => {
  const { refreshLiveChanges } = await import('../src/livechanges.js');
  const db = makeDb();
  db.raw.exec(`WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 450) INSERT INTO live_changes (n, repo, title, by_origin, merged_at, url) SELECT i, 'o/r', 't', 'x', printf('2026-10-01T00:%02d:%02dZ', i / 60, i % 60), 'u' FROM c;
    INSERT INTO live_changes (n, repo, title, by_origin, merged_at, url) VALUES (1, 'o/other', 't', 'x', '2020-01-01T00:00:00Z', 'u');`);
  await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: async () => ({ ok: true, status: 200, text: async () => '[]' }), now: NOW });
  const r = db.raw.prepare(`SELECT COUNT(*) n, MIN(n) lo FROM live_changes WHERE repo = 'o/r'`).get();
  assert.equal(r.n, 400); assert.equal(r.lo, 51);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM live_changes WHERE repo = 'o/other'`).get().n, 1, 'another repository keeps its history');
});

test('READ-BUDGET-10: the previous criticality window is read once an hour, the current one once per half hour', async () => {
  const { measureCriticality } = await import('../src/criticality.js');
  const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
  const db = makeDb(), outcomeReads = seen => seen.filter(e => /FROM outcomes WHERE result=/.test(e.sql)).length;
  const H = Math.floor(NOW / 3600e3) * 3600e3;  // an hour boundary, so the half-hour and hour buckets are known
  let seen = spy(db); const a = await measureCriticality(db, crit, H + 10e3); const first = outcomeReads(seen);
  assert.ok(first > 0 && first % 2 === 0, 'the first read counts the current and the previous window');
  seen = spy(db); const b = await measureCriticality(db, crit, H + 600e3);
  assert.equal(outcomeReads(seen), 0, 'the next tick of the half hour reads no outcome rows');
  assert.equal(b.k_eff, a.k_eff);
  seen = spy(db); await measureCriticality(db, crit, H + 1800e3 + 10e3);
  assert.equal(outcomeReads(seen) * 2, first, 'a new half hour reads the current window only');
  seen = spy(db); await measureCriticality(db, crit, H + 3600e3 + 10e3);
  assert.equal(outcomeReads(seen), first, 'a new hour reads both windows again');
  seen = spy(db); await measureCriticality(db, { ...crit, window_days: crit.window_days + 1 }, H + 3600e3 + 20e3);
  assert.equal(outcomeReads(seen), first, 'changed thresholds are never answered from the old reading');
});

test('READ-BUDGET-10: the ROI verdict reads seven days of samples once per quarter hour, and a caller with its own clock always reads', async () => {
  const { readRoi } = await import('../src/roi.js');
  const db = makeDb(), sampleReads = seen => seen.filter(e => /FROM free_tier_samples/.test(e.sql)).length;
  let seen = spy(db); const a = await readRoi(db, {}); const first = sampleReads(seen);
  assert.ok(first > 0, 'the first read aggregates the samples');
  seen = spy(db); const b = await readRoi(db, {});
  assert.equal(sampleReads(seen), 0, 'the next read in the quarter hour is one org row');
  assert.deepEqual(b, a);
  seen = spy(db); await readRoi(db, { now: new Date(NOW) });
  assert.equal(sampleReads(seen), first, 'an explicit clock is never answered from the cache');
  seen = spy(db); await readRoi(db, { cache: false });
  assert.equal(sampleReads(seen), first, 'cache: false always reads');
});

test('READ-BUDGET-9: the goals prune is a range on its own index', async () => {
  const { DDL } = await import('../src/goals.js');
  const db = makeDb(); for (const s of DDL) db.raw.exec(s);
  assert.match(plan(db, 'DELETE FROM goal_samples WHERE at < ?', 1), /SEARCH goal_samples USING (COVERING )?INDEX goal_samples_at \(at<\?\)/);
});
