// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-29 (visible progress, content stickiness and substantive change): the change cache (livechanges.js), the cadence monitor (progress.js) and the freshness
// repair (freshness.js), proved through their exported functions over an in-memory D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { refreshLiveChanges, refreshFleetChanges, classifyPending, readLiveChanges, ensureSubstance } from '../src/livechanges.js';
import { progressStep, readProgress, stalledSystems, PROGRESS_DDL, _reset } from '../src/progress.js';
import { watchFreshness } from '../src/freshness.js';
import { ensureItem, METRICS } from '../src/tick.js';
import { failed } from '../src/pulse.js';

const NOW = Date.parse('2026-11-20T12:00:00Z'), H = 3600e3;
const ago = h => new Date(NOW - h * H).toISOString();
const pr = (n, o = {}) => ({ number: n, title: 'Change ' + n, merged_at: ago(n), html_url: 'https://gh/' + n, head: { ref: 'other/x' }, body: '', ...o });
const ok = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const add = async (db, repo, n, title, at, substance = null) => { await ensureSubstance(db); return addRow(db, repo, n, title, at, substance); };
const addRow = (db, repo, n, title, at, substance = null) => db.prepare('INSERT OR REPLACE INTO live_changes (n, repo, title, by_origin, merged_at, url) VALUES (?,?,?,?,?,?)').bind(n, repo, title, 'agent session', at, 'https://gh/' + repo + '/' + n).run()
  .then(() => substance && db.prepare('UPDATE live_changes SET substance = ? WHERE repo = ? AND n = ?').bind(substance, repo, n).run());
const rows = async (db, repo) => { await ensureSubstance(db); return (await db.prepare('SELECT n, title, by_origin, merged_at, url, substance FROM live_changes WHERE repo = ? ORDER BY n').bind(repo).all()).results; };
const cfg = { progress: { expect_hours: 24, stall: 2, cooldown_hours: 6, systems: [
  { id: 'core', name: 'Core', repo: 'o/core', url: 'https://core', expect_hours: 24, heal: ['executor.yml'] },
  { id: 'tenant', name: 'Tenant', repo: 'o/tenant', expect_hours: 24, heal: ['agent.yml', 'discover.yml'] }] } };
const item = (db, id) => db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();

test('US-29-R21: a refresh caches the merged pull requests of one repository from one GitHub call, keeps a verdict already written, trims each repository to 400 rows and records the time', async () => {
  const db = makeDb(), calls = [];
  const f = async (u, o) => { calls.push([u, o.headers.authorization]); return ok([pr(1, { title: 'x'.repeat(400) }), pr(2, { merged_at: null }), pr(3)]); };
  assert.deepEqual(await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: f, now: NOW }), { status: 'ok', merged_seen: 2 });
  assert.deepEqual(calls, [['https://api.github.com/repos/o/r/pulls?state=closed&sort=updated&direction=desc&per_page=100', 'Bearer t']]);
  const got = await rows(db, 'o/r');
  assert.deepEqual(got.map(r => r.n), [1, 3], 'a closed pull request that was not merged is not cached');
  assert.equal(got[0].title.length, 300); assert.equal(got[0].url, 'https://gh/1'); assert.equal(got[0].merged_at, ago(1));
  assert.equal((await db.prepare('SELECT refreshed_at FROM live_changes_meta WHERE repo = ?').bind('o/r').first()).refreshed_at, new Date(NOW).toISOString());
  await ensureSubstance(db);
  await db.prepare("UPDATE live_changes SET substance = 'trivial' WHERE repo = 'o/r' AND n = 3").run();
  await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: async () => ok([pr(3, { title: 'Renamed' })]), now: NOW });
  const again = await rows(db, 'o/r');
  assert.equal(again.find(r => r.n === 3).title, 'Renamed', 'a seen pull request is updated');
  assert.equal(again.find(r => r.n === 3).substance, 'trivial', 'and keeps the verdict a later pass wrote');
  for (let n = 1000; n < 1405; n++) await db.prepare('INSERT INTO live_changes (n, repo, title, by_origin, merged_at, url) VALUES (?,?,?,?,?,?)').bind(n, 'o/r', 't', 'other', new Date(NOW - (3000 - n) * 60e3).toISOString(), 'u').run();
  await add(db, 'o/other', 1, 'kept', ago(900));
  await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: async () => ok([pr(2000, { merged_at: ago(0) })]), now: NOW });
  assert.equal((await rows(db, 'o/r')).length, 400, 'the newest 400 of this repository');
  assert.equal((await rows(db, 'o/other')).length, 1, 'one busy repository never evicts another\'s history');
});

test('US-29-R21: a refresh with no token or repository, or one GitHub refuses, writes nothing and says so', async () => {
  const db = makeDb();
  assert.deepEqual(await refreshLiveChanges({ db, repo: 'o/r', now: NOW }), { status: 'no-token' });
  assert.deepEqual(await refreshLiveChanges({ db, token: 't', now: NOW }), { status: 'no-token' });
  assert.deepEqual(await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: async () => ({ ok: false, status: 403 }), now: NOW }), { status: 'error', http: 403 });
  assert.equal((await rows(db, 'o/r')).length, 0);
  assert.equal(await db.prepare('SELECT 1 FROM live_changes_meta').first(), null, 'a failed read leaves the older refresh time alone');
});

test('US-29-R22: the origin of a merged change is the executor when its body says so, else a bot, an agent session or other', async () => {
  const db = makeDb();
  const list = [pr(1, { body: 'Executor run 2026-11-21T01:00:00Z', head: { ref: 'agent/x' } }), pr(2, { body: 'notes\nExecutor run 2026-11-21T01:00:00Z\nmore' }), pr(3, { body: 'Executor run 2026-11-21 no time' }),
    pr(4, { head: { ref: 'dependabot/npm/x' } }), pr(5, { head: { ref: 'ultrastable-1/fix' } }), pr(6, { head: { ref: 'agent/y' } }), pr(7, { head: { ref: 'claude/z' } }), pr(8, { head: { ref: 'feature/q' } }), pr(9, { head: undefined, body: undefined })];
  await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: async () => ok(list), now: NOW });
  assert.deepEqual(Object.fromEntries((await rows(db, 'o/r')).map(r => [r.n, r.by_origin])),
    { 1: 'unattended executor', 2: 'unattended executor', 3: 'other', 4: 'bot', 5: 'bot', 6: 'agent session', 7: 'agent session', 8: 'other', 9: 'other' });
});

test('US-29-R23: the other repositories of the fleet are read at most once an interval, and a failed read keeps their older rows and their older time', async () => {
  const db = makeDb(); let n = 0;
  const good = async () => { n++; return ok([pr(3)]); };
  assert.deepEqual(await refreshFleetChanges({ db, token: 't', repos: ['o/a'], fetch: good, now: NOW }), { 'o/a': 1 });
  assert.deepEqual(await refreshFleetChanges({ db, token: 't', repos: ['o/a'], fetch: good, now: NOW + 54 * 60e3 }), { 'o/a': 'fresh' });
  assert.equal(n, 1, 'inside 55 minutes nothing is fetched');
  assert.deepEqual(await refreshFleetChanges({ db, token: 't', repos: ['o/a'], fetch: good, now: NOW + 56 * 60e3 }), { 'o/a': 1 });
  assert.deepEqual(await refreshFleetChanges({ db, token: 't', repos: ['o/a'], everyMs: 1, fetch: async () => ({ ok: false, status: 502 }), now: NOW + 3 * H }), { 'o/a': 'error 502' });
  assert.deepEqual(await refreshFleetChanges({ db, token: 't', repos: ['o/a'], everyMs: 1, fetch: async () => { throw new Error('connection reset'); }, now: NOW + 4 * H }), { 'o/a': 'error connection reset' });
  assert.deepEqual(await refreshFleetChanges({ db, token: 't', repos: ['o/a', 'o/b'], everyMs: 1, fetch: async () => ({ ok: false, status: 502 }), now: NOW + 5 * H }), { 'o/a': 'error 502', 'o/b': 'error 502' }, 'one repository failing never stops the next');
  assert.equal((await rows(db, 'o/a')).length, 1, 'the older rows stay');
  assert.equal((await db.prepare('SELECT refreshed_at FROM live_changes_meta WHERE repo = ?').bind('o/a').first()).refreshed_at, new Date(NOW + 56 * 60e3).toISOString(), 'and so does the time of the last good read');
  assert.deepEqual(await refreshFleetChanges({ db, token: 't', repos: [], now: NOW }), {});
});

test('US-29-R24: a merged pull request is classified from its files, two a pass and newest first, and an unreadable or truncated file list is never called trivial', async () => {
  const db = makeDb();
  for (let n = 1; n <= 5; n++) await add(db, 'o/r', n, 'Change ' + n, ago(n));
  await add(db, 'o/r', 6, 'Change 6', ago(0.5), 'trivial');
  const files = { 1: [{ filename: 'scripts/a.py', status: 'modified', patch: '@@ -1 +1 @@\n-import json, os\n+import os' }],
    2: [{ filename: 'seed/worker/src/lane.js', status: 'modified', patch: '@@ -1 +1 @@\n-if (a) go();\n+if (a && !b) go();' }],
    3: Array.from({ length: 100 }, (_, i) => ({ filename: `docs/f${i}.md`, status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' })),
    4: Array.from({ length: 100 }, (_, i) => ({ filename: i ? `docs/f${i}.md` : 'foundation/x.py', status: 'modified', patch: '@@ -1 +1 @@\n-a = 1\n+a = 2' })),
    7: Array.from({ length: 100 }, (_, i) => ({ filename: i ? `docs/f${i}.md` : 'foundation/x.py', status: 'modified', patch: i ? '@@ -1 +1 @@\n-a\n+b' : '@@ -1 +1 @@\n-a = f()\n+a = g()' })) };
  await add(db, 'o/r', 7, 'Change 7', ago(10));
  const calls = [];
  const f = async u => { const m = /pulls\/(\d+)\/files\?per_page=100$/.exec(u); calls.push(m && +m[1]); const s = m && +m[1]; if (s === 5) return { ok: false, status: 500 }; return ok(files[s] || []); };
  assert.deepEqual(await classifyPending({ db, max: 2, fetch: f }), { status: 'no-token' });
  assert.deepEqual((await classifyPending({ db, token: 't', fetch: f })).classified, { 'o/r#1': 'trivial', 'o/r#2': 'substantive' }, 'two a pass, the newest first, an already classified row left alone');
  assert.deepEqual(calls, [1, 2]);
  const r2 = (await classifyPending({ db, token: 't', max: 5, fetch: f })).classified;
  assert.equal(r2['o/r#3'], 'unknown', 'a hundred files is the most GitHub lists: a list that may be cut is not called record');
  assert.equal(r2['o/r#4'], 'unknown', 'nor trivial');
  assert.equal(r2['o/r#7'], 'substantive', 'but a behaviour change in the files that were listed stands');
  assert.equal(r2['o/r#5'], 'HTTP 500');
});

test('US-29-R24: a pull request that is not found is stored unknown, a server error leaves it to the next pass, and the file count is kept', async () => {
  const db = makeDb();
  await add(db, 'o/r', 99, 'gone', ago(1)); await add(db, 'o/r', 5, 'flaky', ago(2)); await add(db, 'o/r', 7, 'real', ago(3));
  const f = async u => { const s = +/pulls\/(\d+)\//.exec(u)[1]; return s === 99 ? { ok: false, status: 404 } : s === 5 ? { ok: false, status: 500 } : ok([{ filename: 'foundation/a.py', status: 'modified', patch: '@@ -1 +1 @@\n-a = f()\n+a = g()' }]); };
  const out = (await classifyPending({ db, token: 't', max: 3, fetch: f })).classified;
  assert.deepEqual(out, { 'o/r#99': 'HTTP 404', 'o/r#5': 'HTTP 500', 'o/r#7': 'substantive' });
  const got = Object.fromEntries((await readLiveChanges(db, 'o/r')).changes.map(c => [c.n, c.substance]));
  assert.deepEqual(got, { 99: 'unknown', 5: null, 7: 'substantive' }, '404 is final, 500 is retried');
  assert.equal((await db.prepare('SELECT substance_files AS n FROM live_changes WHERE n = 7').first()).n, 1);
  assert.deepEqual((await classifyPending({ db, token: 't', max: 3, fetch: f })).classified, { 'o/r#5': 'HTTP 500' });
});

test('US-29-R25: the cache is read newest first, at most 400 rows, with the verdict or null, and its columns are added once and never fail a database that has no table yet', async () => {
  const db = makeDb();
  assert.deepEqual(await readLiveChanges(db, 'o/none'), { refreshed_at: null, changes: [] });
  await add(db, 'o/a', 1, 'older', ago(5)); await add(db, 'o/a', 2, 'newer', ago(1), 'substantive'); await add(db, 'o/b', 3, 'other repo', ago(2));
  await db.prepare('INSERT INTO live_changes_meta (repo, refreshed_at) VALUES (?,?)').bind('o/a', '2026-11-20T10:00:00.000Z').run();
  await db.prepare('INSERT INTO live_changes_meta (repo, refreshed_at) VALUES (?,?)').bind('o/b', '2026-11-20T11:00:00.000Z').run();
  const one = await readLiveChanges(db, 'o/a');
  assert.deepEqual(one.changes.map(c => [c.n, c.title, c.by, c.substance]), [[2, 'newer', 'agent session', 'substantive'], [1, 'older', 'agent session', null]]);
  assert.equal(one.refreshed_at, '2026-11-20T10:00:00.000Z');
  const all = await readLiveChanges(db);
  assert.deepEqual(all.changes.map(c => c.n), [2, 3, 1]); assert.equal(all.refreshed_at, '2026-11-20T11:00:00.000Z', 'with no repository, the newest refresh of any');
  await ensureSubstance(db); await ensureSubstance(db);
  const bare = e => ({ prepare: () => ({ run: async () => { throw new Error(e); } }) });
  await assert.doesNotReject(ensureSubstance(bare('no such table: live_changes')));
  await assert.doesNotReject(ensureSubstance(bare('duplicate column name: substance')));
  await assert.rejects(ensureSubstance(bare('disk I/O error')), /disk I\/O error/);
  const sql = readFileSync(new URL('../migrations/0022_live_changes.sql', import.meta.url), 'utf8');
  assert.ok(/CREATE TABLE IF NOT EXISTS live_changes\b/.test(sql) && /PRIMARY KEY \(repo, n\)/.test(sql) && /live_changes_meta/.test(sql), 'the migration only creates');
});

test('US-29-R26: every pass judges every listed system from its cached changes, writes one row each, and reports no-config when no system is listed', async () => {
  _reset(); const db = makeDb();
  await add(db, 'o/core', 1, 'Add the progress page', ago(3));
  await add(db, 'o/tenant', 5, 'New solution entries', ago(31));
  const c2 = { progress: { stall: 3, systems: [{ id: 'core', name: 'Core', repo: 'o/core', url: 'https://core', heal: ['executor.yml'] }, { id: 'tenant', name: 'Tenant', repo: 'o/tenant', expect_hours: 10, heal: [] }] } };
  const r = await progressStep({ db, config: c2, fetchImpl: async () => ({ status: 204 }), now: NOW });
  assert.deepEqual(r.systems, { core: 'moving', tenant: 'stalled' }, 'the interval is the system\'s own, else the file\'s, else 24 h; the stall factor is the file\'s');
  const core = await db.prepare('SELECT * FROM progress_cadence WHERE system = ?').bind('core').first();
  assert.deepEqual([core.name, core.repo, core.url, core.state, core.last_at, core.hours_since, core.expect_hours, core.shipped_24h, core.shipped_7d, core.checked_at],
    ['Core', 'o/core', 'https://core', 'moving', ago(3), 3, 24, 1, 1, new Date(NOW).toISOString()]);
  const ten = await db.prepare('SELECT * FROM progress_cadence WHERE system = ?').bind('tenant').first();
  assert.equal(ten.expect_hours, 10); assert.equal(ten.state, 'stalled'); assert.equal(ten.hours_since, 31);
  await progressStep({ db, config: c2, fetchImpl: async () => ({ status: 204 }), now: NOW + 3600e3 });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM progress_cadence').first()).n, 2, 'a system has one row, rewritten each pass');
  assert.deepEqual(await progressStep({ db, config: {}, now: NOW }), { status: 'no-config' });
  assert.deepEqual(await progressStep({ db, config: { progress: { systems: [] } }, now: NOW }), { status: 'no-config' });
  for (let n = 0; n < 250; n++) await add(db, 'o/core', 100 + n, 'old ' + n, ago(500 + n));
  await add(db, 'o/core', 9000, 'new', ago(1));
  const big = await progressStep({ db, config: c2, fetchImpl: async () => ({ status: 204 }), now: NOW + 7200e3 });
  assert.equal(big.systems.core, 'moving', 'only the newest 200 cached changes are read');
});

test('US-29-R27: a slow or stalled system has each of its producer workflows dispatched on main, at most once per cooldown, and the outcome is recorded', async () => {
  _reset(); const db = makeDb(), calls = [];
  await add(db, 'o/core', 1, 'Add page', ago(30));    // 30 h against 24 h: slow
  await add(db, 'o/tenant', 2, 'Add page', ago(100)); // stalled
  const f = async (u, o) => { calls.push([u, o.method, o.body, o.headers.authorization]); return { status: 204 }; };
  const r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW });
  assert.deepEqual(r.systems, { core: 'slow', tenant: 'stalled' });
  assert.deepEqual(calls.map(c => c[0]), ['https://api.github.com/repos/o/core/actions/workflows/executor.yml/dispatches', 'https://api.github.com/repos/o/tenant/actions/workflows/agent.yml/dispatches', 'https://api.github.com/repos/o/tenant/actions/workflows/discover.yml/dispatches']);
  assert.deepEqual(calls[0].slice(1), ['POST', JSON.stringify({ ref: 'main' }), 'Bearer t']);
  assert.deepEqual(r.healed, ['core', 'tenant']);
  const h = await db.prepare('SELECT heal, healed_at FROM progress_cadence WHERE system = ?').bind('tenant').first();
  assert.equal(h.heal, 'agent.yml: dispatched; discover.yml: dispatched'); assert.equal(h.healed_at, new Date(NOW).toISOString());
  await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW + 5.9 * H });
  assert.equal(calls.length, 3, 'inside six hours nothing is dispatched again');
  assert.equal((await db.prepare('SELECT heal FROM progress_cadence WHERE system = ?').bind('tenant').first()).heal, 'cooldown');
  assert.equal((await db.prepare('SELECT healed_at FROM progress_cadence WHERE system = ?').bind('tenant').first()).healed_at, new Date(NOW).toISOString(), 'the cooldown runs from the last dispatch');
  await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW + 6.1 * H });
  assert.equal(calls.length, 6, 'after the cooldown they are dispatched again');
});

test('US-29-R27: with no token nothing is dispatched, a refusal is recorded by its status, a thrown error by its message, and a system with no workflow says so', async () => {
  _reset(); let db = makeDb();
  await add(db, 'o/core', 1, 'x', ago(100)); await add(db, 'o/tenant', 2, 'x', ago(100));
  const heal = async () => Object.fromEntries((await db.prepare('SELECT system, heal, healed_at FROM progress_cadence').all()).results.map(r => [r.system, [r.heal, r.healed_at]]));
  let r = await progressStep({ db, config: cfg, ensureItem, fetchImpl: async () => { throw new Error('must not be called'); }, now: NOW });
  assert.deepEqual(await heal(), { core: ['no-token', null], tenant: ['no-token', null] }); assert.deepEqual(r.healed, []);
  _reset(); db = makeDb(); await add(db, 'o/core', 1, 'x', ago(100)); await add(db, 'o/tenant', 2, 'x', ago(100));
  await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: async u => { if (u.includes('/core/')) throw new Error('socket hang up'); return { status: u.includes('agent') ? 422 : 204 }; }, now: NOW });
  assert.deepEqual(await heal(), { core: ['executor.yml: error socket hang up', new Date(NOW).toISOString()], tenant: ['agent.yml: HTTP 422; discover.yml: dispatched', new Date(NOW).toISOString()] });
  _reset(); db = makeDb(); await add(db, 'o/core', 1, 'x', ago(100));
  const none = { progress: { systems: [{ id: 'core', name: 'Core', repo: 'o/core', heal: [] }] } };
  await progressStep({ db, config: none, token: 't', ensureItem, fetchImpl: async () => { throw new Error('no call'); }, now: NOW });
  assert.equal((await heal()).core[0], 'no workflow declared');
});

test('US-29-R28: a stalled system has one repair item that only the same reading closes, and it is reopened when the system stalls again', async () => {
  _reset(); const db = makeDb(), f = async () => ({ status: 204 });
  await add(db, 'o/tenant', 5, 'New solution entries', ago(60));
  let r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW });
  assert.deepEqual(r.filed, ['STALL-tenant']);
  let it = await item(db, 'STALL-tenant');
  assert.deepEqual([it.kind, it.owner_role, it.priority, it.status, it.done_check, it.closing_probe], ['growth', 'product-manager', -1, 'ready', 'progress_cadence.state of tenant is moving', 'progress:tenant']);
  assert.match(it.title, /^Tenant has shipped nothing a returning reader can see for 60 h \(it declares one substantive change every 24 h\)/);
  r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW + 3600e3 });
  assert.deepEqual(r.filed, [], 'a second pass files nothing; the item exists');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM items WHERE id = 'STALL-tenant'").first()).n, 1);
  await add(db, 'o/tenant', 6, 'Release', new Date(NOW + 2 * H).toISOString());
  r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW + 3 * H });
  assert.deepEqual(r.closed, ['STALL-tenant']);
  it = await item(db, 'STALL-tenant');
  assert.equal(it.status, 'done'); assert.equal(it.disposition, `probe green: progress:tenant moving, last change ${new Date(NOW + 2 * H).toISOString()}`);
  r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW + 3 * H + 1000 });
  assert.deepEqual(r.closed, [], 'a closed item is not closed twice');
  r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW + 200 * H });
  assert.deepEqual(r.filed, ['STALL-tenant'], 'stalled again: the same item is reopened, not a new one');
  it = await item(db, 'STALL-tenant');
  assert.equal(it.status, 'ready'); assert.equal(it.disposition, null);
  const slow = { progress: { systems: [{ id: 'slowpoke', name: 'S', repo: 'o/s', expect_hours: 24, heal: [] }] } };
  await add(db, 'o/s', 1, 'x', ago(30));
  r = await progressStep({ db, config: slow, token: 't', ensureItem, fetchImpl: f, now: NOW });
  assert.equal(r.systems.slowpoke, 'slow'); assert.deepEqual(r.filed, []); assert.equal(await item(db, 'STALL-slowpoke'), null, 'slow is repaired but not filed');
  const long = { progress: { systems: [{ id: 'x'.repeat(100), name: 'L', repo: 'o/l', expect_hours: 1, heal: [] }] } };
  await add(db, 'o/l', 1, 'x', ago(30));
  assert.equal((await progressStep({ db, config: long, ensureItem, now: NOW })).filed[0].length, 80, 'an item id is at most 80 characters');
});

test('US-29-R28: an open repair item is closed only by a moving reading, not by slow or unmeasured', async () => {
  _reset(); const db = makeDb(), f = async () => ({ status: 204 });
  await add(db, 'o/tenant', 5, 'New solution entries', ago(60));
  let r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW });
  assert.deepEqual(r.filed, ['STALL-tenant']); assert.equal(r.systems.tenant, 'stalled');
  await add(db, 'o/tenant', 6, 'Another solution entry', ago(30));  // newest substantive change is now 30 h old against a 24 h interval: slow
  r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW + 1000 });
  assert.equal(r.systems.tenant, 'slow'); assert.deepEqual(r.closed, [], 'slow does not close the item');
  assert.equal((await item(db, 'STALL-tenant')).status, 'ready'); assert.equal((await item(db, 'STALL-tenant')).disposition, null);
  await db.prepare("UPDATE live_changes SET substance = 'trivial' WHERE repo = 'o/tenant'").run();  // every cached change is now a literal: nothing is measurable
  r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW + 2000 });
  assert.equal(r.systems.tenant, 'unmeasured'); assert.deepEqual(r.closed, [], 'unmeasured does not close the item');
  assert.equal((await item(db, 'STALL-tenant')).status, 'ready');
  await add(db, 'o/tenant', 7, 'Release', new Date(NOW + 3000).toISOString());
  r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW + 4000 });
  assert.equal(r.systems.tenant, 'moving'); assert.deepEqual(r.closed, ['STALL-tenant'], 'only the moving reading closes it');
});

test('US-29-R29: a system with no cached substantive change is unmeasured, never moving, is not repaired blindly and files nothing', async () => {
  _reset(); const db = makeDb(), calls = [];
  await add(db, 'o/core', 1, 'regen generated files', ago(1));
  await add(db, 'o/tenant', 2, 'Add a page', ago(1), 'trivial');
  const r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: async u => { calls.push(u); return { status: 204 }; }, now: NOW });
  assert.deepEqual(r.systems, { core: 'unmeasured', tenant: 'unmeasured' }, 'a bookkeeping title and a trivial diff are both nothing to see');
  assert.deepEqual(calls, []); assert.deepEqual(r.filed, []); assert.deepEqual(r.healed, []);
  assert.equal(await item(db, 'STALL-core'), null);
  assert.equal(await stalledSystems(db), 0, 'unmeasured is not stalled');
});

test('US-29-R30: the public reading is each listed system\'s judged cadence, the merged changes of the listed systems newest first, and the pulse of the first one', async () => {
  _reset(); const db = makeDb();
  const real = h => new Date(Date.now() - h * H).toISOString();
  await add(db, 'o/core', 1, 'Older', real(5), 'substantive'); await add(db, 'o/core', 2, 'Newer', real(1), 'substantive'); await add(db, 'o/core', 3, 'Too old', real(24 * 36));
  await add(db, 'o/other', 9, 'Not a listed system', real(0.1));
  await progressStep({ db, config: cfg, ensureItem });
  const p = await readProgress(db, cfg);
  assert.equal(p.marker, 'PROGRESS-1'); assert.equal(p.window_days, 35);
  assert.deepEqual(p.events.map(e => e.title), ['Newer', 'Older'], 'inside the window, listed systems only, newest first');
  assert.deepEqual(p.events[0], { id: 'core#2', at: p.events[0].at, system: 'core', system_name: 'Core', title: 'Newer', url: 'https://gh/o/core/2', kind: 'change', by: 'agent session', substance: 'substantive' });
  const core = p.systems.find(s => s.id === 'core'), tenant = p.systems.find(s => s.id === 'tenant');
  assert.equal(core.state, 'moving'); assert.equal(core.expect_hours, 24); assert.equal(core.url, 'https://core'); assert.equal(core.shipped_24h, 2); assert.equal(core.shipped_7d, 2);
  assert.equal(tenant.state, 'unmeasured'); assert.equal(tenant.last_at, null); assert.equal(tenant.shipped_7d, 0);
  assert.equal(p.pulse.state, 'sessions-only', 'the first system\'s changes, made by a session, are real but not the system\'s own');
  assert.equal(p.pulse.max_hours, 48);
  assert.equal((await readProgress(db, { progress: { pulse_hours: 6, systems: cfg.progress.systems } })).pulse.max_hours, 6);
  assert.ok(p.checked_at);
  _reset();
  const empty = await readProgress(makeDb(), { progress: { systems: [] } });
  assert.deepEqual([empty.systems, empty.events, empty.pulse], [[], [], null]);
  _reset();
  assert.equal((await readProgress(makeDb(), cfg)).systems.every(s => s.state === 'unmeasured'), true, 'before any pass, every system is unmeasured');
});

test('US-29-R31: the Worker carries its own DDL equal to the migration, counts stalled systems with a read that never fails the tick, and the tick reads that count', async () => {
  const sql = readFileSync(new URL('../migrations/0028_progress.sql', import.meta.url), 'utf8');
  for (const d of PROGRESS_DDL) assert.ok(sql.includes(d), d.slice(0, 60));
  assert.ok(PROGRESS_DDL.every(d => /IF NOT EXISTS/.test(d)));
  assert.equal(await stalledSystems({ prepare: () => { throw new Error('no such table: progress_cadence'); } }), 0);
  _reset(); const db = makeDb();
  await add(db, 'o/tenant', 5, 'x', ago(100));
  await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: async () => ({ status: 204 }), now: NOW });
  assert.equal(await stalledSystems(db), 1);
  assert.equal(await METRICS.stalled_systems(db, NOW), 1);
});

test('US-29-R40: a stale published snapshot has its publisher dispatched once per cooldown; a stale change cache or page bundle is reported and left to the loops that refresh them', async () => {
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
  const mk = (fresh, runs, dispatch = 204) => { const calls = []; return { calls, f: async (u, i = {}) => { calls.push((i.method || 'GET') + ' ' + u + (i.body ? ' ' + i.body : '')); if (u.endsWith('/api/freshness')) return J(fresh, fresh.ok ? 200 : 503); if (u.includes('/runs')) return J({ workflow_runs: runs }); return new Response(null, { status: dispatch }); } }; };
  const T = Date.parse('2026-11-20T12:00:00Z');
  let m = mk({ ok: true }, []);
  assert.deepEqual(await watchFreshness({ token: 't', repo: 'o/r', fetchImpl: m.f }), { status: 'fresh' }); assert.equal(m.calls.length, 1);
  assert.equal((await watchFreshness({ fetchImpl: async () => { throw new Error('dns'); } })).status, 'error');
  m = mk({ ok: false, snapshot: { stale: true, age_s: 9e5 } }, []);
  let r = await watchFreshness({ token: 't', repo: 'o/r', siteUrl: 'https://s.example', fetchImpl: m.f, now: () => T });
  assert.deepEqual(r, { status: 'stale', stale: ['snapshot'], snapshot_age_s: 9e5, repair: 'dispatched' });
  assert.equal(m.calls[0], 'GET https://s.example/api/freshness');
  assert.equal(m.calls.at(-1), 'POST https://api.github.com/repos/o/r/actions/workflows/transparency.yml/dispatches {"ref":"main"}');
  m = mk({ ok: false, snapshot: { stale: true } }, [{ created_at: new Date(T - 2 * H).toISOString() }]);
  assert.equal((await watchFreshness({ token: 't', repo: 'o/r', fetchImpl: m.f, now: () => T })).repair, 'cooldown', 'a run inside three hours is the repair in progress');
  assert.ok(!m.calls.some(c => c.startsWith('POST')));
  m = mk({ ok: false, snapshot: { stale: true } }, [{ created_at: new Date(T - 4 * H).toISOString() }]);
  assert.equal((await watchFreshness({ token: 't', repo: 'o/r', fetchImpl: m.f, now: () => T, workflow: 'x.yml', cooldownMs: 3 * H })).repair, 'dispatched');
  assert.ok(m.calls.at(-1).includes('/workflows/x.yml/dispatches'));
  assert.equal((await watchFreshness({ repo: 'o/r', fetchImpl: mk({ ok: false, snapshot: { stale: true } }, []).f })).repair, 'no-token');
  assert.equal((await watchFreshness({ token: 't', repo: 'o/r', fetchImpl: mk({ ok: false, snapshot: { stale: true } }, [], 422).f, now: () => T })).repair, 'error HTTP 422');
  m = mk({ ok: false, snapshot: { stale: false, age_s: 100 }, changes: { stale: true }, pages: { stale: true } }, []);
  r = await watchFreshness({ token: 't', repo: 'o/r', fetchImpl: m.f });
  assert.deepEqual(r, { status: 'stale', stale: ['changes', 'pages'], snapshot_age_s: 100 }); assert.equal(m.calls.length, 1, 'nothing dispatched');
});

test('US-29-T01: a merged pull request that only bumps a hash is not progress, so a system that ships only such changes stays unmeasured; one real change makes it moving', async () => {
  _reset(); const db = makeDb(), f = async () => ({ status: 204 }), one = { progress: { systems: [{ id: 'core', name: 'Core', repo: 'o/core', heal: [] }] } };
  const prs = [pr(1, { title: 'Update the data', merged_at: ago(2) })];
  const files = { 1: [{ filename: 'seed/worker/src/a.js', status: 'modified', patch: '@@ -1 +1 @@\n-const ASOF = "5e4a1aab";\n+const ASOF = "d02d20a";' }], 2: [{ filename: 'seed/worker/src/lane.js', status: 'modified', patch: '@@ -1 +1 @@\n-if (a) go();\n+if (a && !b) go();' }] };
  const net = async u => { const m = /pulls\/(\d+)\/files/.exec(u); return m ? ok(files[m[1]]) : ok(prs); };
  await refreshLiveChanges({ db, token: 't', repo: 'o/core', fetch: net, now: NOW });
  assert.equal((await progressStep({ db, config: one, ensureItem, fetchImpl: f, now: NOW })).systems.core, 'moving', 'before it is classified, the title says it is a change');
  await classifyPending({ db, token: 't', fetch: net });
  assert.equal((await progressStep({ db, config: one, ensureItem, fetchImpl: f, now: NOW })).systems.core, 'unmeasured', 'classified from its diff, it is a literal change and counts for nothing');
  prs.unshift(pr(2, { title: 'Fix the lane', merged_at: ago(1) }));
  await refreshLiveChanges({ db, token: 't', repo: 'o/core', fetch: net, now: NOW });
  await classifyPending({ db, token: 't', fetch: net });
  const r = await progressStep({ db, config: one, ensureItem, fetchImpl: f, now: NOW });
  assert.equal(r.systems.core, 'moving');
  assert.equal((await readProgress(db, one)).systems[0].shipped_24h, 1, 'one change counted, not two');
});

test('US-29-T02: a system that stops shipping has its producers started, files its repair item, and the item closes by itself when the system ships again', async () => {
  _reset(); const db = makeDb(), calls = [], f = async u => { calls.push(u); return { status: 204 }; };
  await add(db, 'o/tenant', 1, 'Add', ago(70), 'substantive');
  let r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW });
  assert.equal(r.systems.tenant, 'stalled'); assert.deepEqual(r.filed, ['STALL-tenant']); assert.equal(calls.length, 2);
  assert.equal(await METRICS.stalled_systems(db, NOW), 1);
  await add(db, 'o/tenant', 2, 'Ship', new Date(NOW + H).toISOString(), 'substantive');
  r = await progressStep({ db, config: cfg, token: 't', ensureItem, fetchImpl: f, now: NOW + 2 * H });
  assert.deepEqual(r.closed, ['STALL-tenant']); assert.equal(await METRICS.stalled_systems(db, NOW), 0);
});

test('US-29-T09: a published snapshot gone stale is repaired once, and the system says it is stale until the next reading is fresh', async () => {
  const T = Date.parse('2026-11-20T12:00:00Z'); let fresh = false; const posts = [];
  const f = async (u, i = {}) => { if (u.endsWith('/api/freshness')) return new Response(JSON.stringify(fresh ? { ok: true } : { ok: false, snapshot: { stale: true, age_s: 100000 } }), { status: fresh ? 200 : 503 }); if (u.includes('/runs')) return new Response(JSON.stringify({ workflow_runs: posts.length ? [{ created_at: new Date(T).toISOString() }] : [] })); posts.push(u); return new Response(null, { status: 204 }); };
  assert.equal((await watchFreshness({ token: 't', repo: 'o/r', fetchImpl: f, now: () => T })).repair, 'dispatched');
  assert.equal((await watchFreshness({ token: 't', repo: 'o/r', fetchImpl: f, now: () => T + 3600e3 })).repair, 'cooldown');
  assert.equal(posts.length, 1);
  fresh = true;
  assert.deepEqual(await watchFreshness({ token: 't', repo: 'o/r', fetchImpl: f, now: () => T + 7200e3 }), { status: 'fresh' });
});

// The closing probe of a known defect, PLANNED in section 7 (a todo test is recorded as planned, never as proof): freshness.js says a stale reading "goes red
// in the beat", but pulse.js failed() reads only an error status, an ok of false, an error field or no-token, so a stale snapshot that nothing could repair leaves
// the beat green.
test('US-29-R74: a stale snapshot that could not be repaired makes its beat fail', { todo: 'seed/worker/src/freshness.js returns status stale with no error field, which failed() in pulse.js reads as a good beat' }, async () => {
  const f = async u => (u.endsWith('/api/freshness') ? new Response(JSON.stringify({ ok: false, snapshot: { stale: true, age_s: 9e5 } }), { status: 503 }) : new Response(null, { status: 204 }));
  const out = await watchFreshness({ fetchImpl: f });
  assert.equal(out.repair, 'no-token');
  assert.ok(failed(out), 'a stale snapshot with no way to repair it is a failed beat');
});
