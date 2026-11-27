// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-29 (visible progress, content stickiness and substantive change): the content loop `stickiness` (stickiness.js) and its public reads, proved through
// their exported functions over an in-memory D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { stickinessStep, readStickiness, readQueue, STICKINESS_DDL, STICKY_RESERVE, _reset } from '../src/stickiness.js';
import { ensureItem, ORIGINATE_MAX_PER_DAY } from '../src/tick.js';
import { toJsonFeed } from '../src/vendor/core/stickiness.js';
import { hiddenByHealthOnly, PUBLIC_READS } from '../src/visibility.js';

const NOW = Date.parse('2026-11-22T12:00:00Z'), H = 3600e3;
const ent = (id, hAgo, o = {}) => ({ id, at: new Date(NOW - hAgo * H).toISOString(), title: 'Entry ' + id, url: 'https://t/' + id, summary: 'A point. More.', domain: 'health', depth: 5, ...o });
const feed = items => toJsonFeed({ title: 't', link: 'https://t', description: 'd', feedUrl: 'https://t/feed.json', items });
const fetchOf = items => async () => ({ ok: true, json: async () => feed(items) });
const sysA = o => ({ id: 'a', name: 'A', repo: 'o/a', stickiness: { content_feed: 'https://t/feed.json', domains: ['health', 'water'], expect_days: 2, reveal: 'Runs on Ultrastable.', ...o } });
const config = { progress: { systems: [sysA(), { id: 'b', name: 'B', repo: 'o/b' }] } };
const item = (db, id) => db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
const state = (db, id = 'a') => db.prepare('SELECT * FROM stickiness_state WHERE system = ?').bind(id).first();

test('US-29-R48: a system with no declared feed is undeclared, a feed that cannot be read is a failed reading with the last good measurement kept, and no system listed is no-config', async () => {
  _reset(); const db = makeDb();
  assert.deepEqual(await stickinessStep({ db, config: {}, now: NOW }), { status: 'no-config' });
  assert.deepEqual(await stickinessStep({ db, config: { progress: { systems: [] } }, now: NOW }), { status: 'no-config' });
  const seen = [];
  const r = await stickinessStep({ db, config, ensureItem, fetchImpl: async (u, o) => { seen.push([u, o.headers.accept]); return ok1([ent('x', 2)]); }, now: NOW });
  assert.deepEqual(seen, [['https://t/feed.json', 'application/feed+json, application/json']], 'an undeclared system is never fetched');
  assert.deepEqual(r.undeclared, ['b']); assert.deepEqual(r.systems, { a: 'fresh', b: 'undeclared' });
  assert.equal((await state(db, 'b')).state, 'undeclared'); assert.equal((await state(db, 'b')).score, null);
  const good = await state(db);
  const bad = await stickinessStep({ db, config, ensureItem, fetchImpl: async () => ({ ok: false, status: 503 }), now: NOW + 1000 });
  assert.equal(bad.systems.a, 'unreadable');
  const after = await state(db);
  assert.deepEqual([after.state, after.error, after.checked_at], ['unreadable', 'HTTP 503', new Date(NOW + 1000).toISOString()]);
  assert.deepEqual([after.score, after.measure, after.last_at], [good.score, good.measure, good.last_at], 'the last good reading stays');
  assert.equal(await item(db, 'STICKY-a'), null, 'an unreadable feed files nothing and closes nothing');
  await stickinessStep({ db, config, ensureItem, fetchImpl: async () => { throw new Error('x'.repeat(300)); }, now: NOW + 2000 });
  assert.equal((await state(db)).error.length, 120, 'the error is cut to 120 characters');
  await stickinessStep({ db, config, ensureItem, fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }), now: NOW + 3000 });
  assert.equal((await state(db)).error, 'bad json');
  await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('y', 1)]), now: NOW + 4000 });
  assert.equal((await state(db)).error, null, 'a good reading clears the error');
});
const ok1 = items => ({ ok: true, json: async () => feed(items) });

test('US-29-R49: each pass stores the judged state, the measure, the plan and the queue of a system and one row of its daily series, and keeps 400 days of it', async () => {
  _reset(); const db = makeDb();
  await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('new', 3, { domain: 'water' }), ent('old', 24 * 9)]), now: NOW });
  const s = await state(db);
  assert.deepEqual([s.state, s.last_at, s.hours_since, s.n_7d, s.n_30d, s.checked_at], ['fresh', ent('new', 3).at, 3, 1, 2, new Date(NOW).toISOString()]);
  assert.equal(JSON.parse(s.measure).breadth.coverage, 1); assert.deepEqual(JSON.parse(s.plan), []);
  assert.equal(JSON.parse(s.queue).posts.length, 2, 'both entries are inside the 14-day window');
  await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('new', 3, { domain: 'water' })]), now: NOW + 3600e3 });
  const rows = (await db.prepare("SELECT day, row FROM stickiness_series WHERE system = 'a'").all()).results;
  assert.equal(rows.length, 1, 'a second pass the same day replaces the day\'s row');
  assert.equal(rows[0].day, '2026-11-22'); assert.deepEqual(Object.keys(JSON.parse(rows[0].row)), ['day', 'state', 'score', 'n_7d', 'n_30d', 'coverage', 'thin_share', 'even', 'return_rate']);
  await db.prepare("INSERT INTO stickiness_series (system, day, row) VALUES ('a', '2024-01-01', '{}')").run();
  await db.prepare("INSERT INTO stickiness_series (system, day, row) VALUES ('b', '2024-01-01', '{}')").run();
  await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('new', 3)]), now: NOW + 7200e3 });
  assert.deepEqual((await db.prepare('SELECT system, day FROM stickiness_series ORDER BY system, day').all()).results.map(r => r.system + r.day), ['a2026-11-22', 'b2024-01-01'], 'rows older than 400 days go, for the system just measured');
  const sql = readFileSync(new URL('../migrations/0030_stickiness.sql', import.meta.url), 'utf8');
  for (const d of STICKINESS_DDL) assert.ok(sql.includes(d) && /IF NOT EXISTS/.test(d), d.slice(0, 50));
});

test('US-29-R50: the audience is counted from the system\'s own first-party hits and an optional count it serves, and a return rate is computed only from a returning count', async () => {
  _reset(); let db = makeDb();
  const cfg = o => ({ progress: { systems: [sysA({ analytics_host: 'a.example', ...o })] } });
  for (const [v, n, bot, day] of [['v1', 'pageview', 0, 0], ['v1', 'pageview', 0, 0], ['v1', 'pageview', 0, 1], ['v2', 'pageview', 0, 0], ['v3', 'pageview', 1, 0], ['f1', 'feed', 1, 0], ['f1', 'feed', 1, 0], ['f2', 'feed', 1, 2], ['v9', 'pageview', 0, 20]]) {
    await db.prepare('INSERT INTO hits(at,host,path,vid,name,bot) VALUES(?,?,?,?,?,?)').bind(NOW - day * 864e5 - 3600e3, 'a.example', '/', v, n, bot).run();
  }
  await db.prepare('INSERT INTO hits(at,host,path,vid,name,bot) VALUES(?,?,?,?,?,?)').bind(NOW - 3600e3, 'other.example', '/', 'zz', 'pageview', 0).run();
  const audience = async () => JSON.parse((await state(db)).measure).audience;
  await stickinessStep({ db, config: cfg({}), ensureItem, fetchImpl: fetchOf([ent('x', 2)]), now: NOW });
  assert.deepEqual(await audience(), { return_rate: null, subscribers: null, feed_hits_7d: 2 }, 'distinct feed readers per day, bots included, inside 7 days and for this host only');
  _reset(); db = makeDb();
  const urls = [];
  const f = async u => { urls.push(u); return u.endsWith('/audience.json') ? { ok: true, json: async () => ({ visits_7d: 200, returning_7d: 50, subscribers: 9 }) } : ok1([ent('x', 2)]); };
  await stickinessStep({ db, config: cfg({ audience_url: 'https://t/audience.json' }), ensureItem, fetchImpl: f, now: NOW });
  assert.deepEqual(await audience(), { return_rate: 0.25, subscribers: 9, feed_hits_7d: 0 }, 'a served count joins the first-party one');
  _reset(); db = makeDb();
  await stickinessStep({ db, config: cfg({ audience_url: 'https://t/audience.json' }), ensureItem, fetchImpl: async u => { if (u.endsWith('/audience.json')) throw new Error('down'); return ok1([ent('x', 2)]); }, now: NOW });
  assert.deepEqual(await audience(), { return_rate: null, subscribers: null, feed_hits_7d: 0 }, 'an unreadable count stays unmeasured and does not fail the reading');
  _reset(); const bare = makeDb(); await bare.prepare('DROP TABLE hits').run();
  await stickinessStep({ db: bare, config: cfg({}), ensureItem, fetchImpl: fetchOf([ent('x', 2)]), now: NOW });
  assert.equal(JSON.parse((await state(bare)).measure).audience.return_rate, null, 'a database with no hits table has an unmeasured audience');
});

test('US-29-R51: a system that is stale, aging, thin, narrow or unmeasured has one STICKY item carrying its plan and prediction, filed above the daily cap by a reserve, and the same reading closes it', async () => {
  _reset(); const db = makeDb();
  assert.equal(STICKY_RESERVE, 5);
  let r = await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('old', 24 * 9)]), now: NOW });
  assert.deepEqual(r.filed, ['STICKY-a']);
  let it = await item(db, 'STICKY-a');
  assert.deepEqual([it.kind, it.owner_role, it.priority, it.status, it.done_check, it.closing_probe], ['growth', 'product-manager', -1, 'ready', 'stickiness_state.state of a is fresh', 'stickiness:a']);
  assert.match(it.title, /^A is stale as a reason to come back: generate in water, nothing new for \d+ h against 2 d declared\. Prediction: n_7d >= 4 within 168 h\.$/);
  r = await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('old', 24 * 9)]), now: NOW + 3600e3 });
  assert.deepEqual(r.filed, [], 'filed once');
  r = await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('new', 3, { domain: 'water' }), ent('n2', 4)]), now: NOW + 7200e3 });
  assert.deepEqual(r.closed, ['STICKY-a']);
  it = await item(db, 'STICKY-a'); assert.equal(it.status, 'done'); assert.equal(it.disposition, `probe green: stickiness:a fresh, last entry ${new Date(NOW - 3 * H).toISOString()}`);
  r = await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('new', 3, { domain: 'water' })]), now: NOW + 8000e3 });
  assert.deepEqual(r.closed, [], 'a closed item is not closed twice');
  r = await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('old', 24 * 9)]), now: NOW + 24 * 20 * H });
  assert.deepEqual(r.filed, ['STICKY-a'], 'stale again: the same item is reopened');
  assert.equal((await item(db, 'STICKY-a')).status, 'ready');
  for (const [name, entries, prio] of [['aging', [ent('a1', 60)], 0], ['thin', [ent('a1', 1, { depth: 0 }), ent('a2', 2, { depth: 0 })], 0], ['unmeasured', [], -1]]) {
    _reset(); const d2 = makeDb();
    const out = await stickinessStep({ db: d2, config, ensureItem, fetchImpl: fetchOf(entries), now: NOW });
    assert.equal(out.systems.a, name); assert.deepEqual(out.filed, ['STICKY-a'], name);
    assert.equal((await item(d2, 'STICKY-a')).priority, prio, name);
  }
  _reset(); const d3 = makeDb();
  await d3.prepare('CREATE TABLE IF NOT EXISTS budget_ledger (day TEXT NOT NULL, kind TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, refused INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))').run();
  await d3.prepare("INSERT INTO budget_ledger (day, kind, units, calls, refused) VALUES (?, 'originated', 0, ?, 0)").bind('2026-11-22', ORIGINATE_MAX_PER_DAY).run();
  assert.deepEqual((await stickinessStep({ db: d3, config, ensureItem, fetchImpl: fetchOf([ent('old', 24 * 9)]), now: NOW })).filed, ['STICKY-a'], 'other filers have spent the daily cap; the reserve still files this one');
  _reset(); const d4 = makeDb(); await d4.prepare('CREATE TABLE IF NOT EXISTS budget_ledger (day TEXT NOT NULL, kind TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, refused INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))').run();
  await d4.prepare("INSERT INTO budget_ledger (day, kind, units, calls, refused) VALUES (?, 'originated', 0, ?, 0)").bind('2026-11-22', ORIGINATE_MAX_PER_DAY + STICKY_RESERVE).run();
  assert.deepEqual((await stickinessStep({ db: d4, config, ensureItem, fetchImpl: fetchOf([ent('old', 24 * 9)]), now: NOW })).filed, [], 'past the reserve nothing is filed');
});

test('US-29-R52: the social queue and the judged readings are public reads, an entry already promoted is not queued again, and the queue is empty until the system has been measured', async () => {
  _reset(); const db = makeDb();
  assert.deepEqual(await readQueue(db, 'a'), { posts: [] }, 'before any pass');
  await db.prepare('CREATE TABLE IF NOT EXISTS social_posted (id TEXT NOT NULL, channel TEXT NOT NULL, at TEXT NOT NULL, ref TEXT, arm TEXT, PRIMARY KEY (id, channel))').run();
  await db.prepare("INSERT INTO social_posted (id, channel, at) VALUES ('sticky:p', 'bluesky', 'x')").run();
  await db.prepare("INSERT INTO social_posted (id, channel, at) VALUES ('sticky:p', 'mastodon', 'x')").run();
  await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('p', 5), ent('q', 6)]), now: NOW });
  const q = await readQueue(db, 'a');
  assert.deepEqual(q.posts.map(p => p.id), ['sticky:q'], 'p was promoted on two channels and is not offered again');
  assert.ok(q.posts[0].text.endsWith('Runs on Ultrastable.'));
  assert.deepEqual(await readQueue(db, 'none'), { posts: [] });
  const s = await readStickiness(db, { now: NOW });
  const a = s.systems.find(x => x.system === 'a');
  assert.deepEqual([a.state, a.name, a.series.length], ['fresh', 'A', 1]);
  assert.equal(a.measure.state, 'fresh'); assert.deepEqual(a.plan.map(x => [x.kind, x.domain]), [['diversify', 'water']], 'a fresh system with a declared domain it has not covered is told to diversify');
  assert.deepEqual(Object.keys(a.trend), ['score', 'n_7d']); assert.equal(a.trend.score.direction, 'unmeasured', 'one day of series is not a trend');
  assert.equal(s.systems.find(x => x.system === 'b').state, 'undeclared');
  assert.ok(PUBLIC_READS.includes('/api/stickiness') && PUBLIC_READS.includes('/api/progress'));
  const hidden = { PUBLIC_HEALTH_ONLY: '1' };
  assert.equal(hiddenByHealthOnly(hidden, 'GET', '/api/stickiness'), false);
  assert.equal(hiddenByHealthOnly(hidden, 'GET', '/api/stickiness/queue/practical-solutions.json'), false);
  assert.equal(hiddenByHealthOnly(hidden, 'GET', '/api/progress'), false);
  assert.equal(hiddenByHealthOnly(hidden, 'POST', '/api/stickiness'), true, 'a write stays hidden');
  assert.equal(hiddenByHealthOnly(hidden, 'GET', '/api/stickiness/queue/UPPER.json'), true);
});

test('US-29-T03: a system whose content has gone stale is read as stale, files its repair item and queues nothing it has already promoted; fresh content closes the item', async () => {
  _reset(); const db = makeDb();
  const stale = await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('old', 24 * 9, { domain: 'water' })]), now: NOW });
  assert.equal(stale.systems.a, 'stale'); assert.deepEqual(stale.filed, ['STICKY-a']);
  const fresh = await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('new', 2, { domain: 'water' }), ent('n2', 3)]), now: NOW + H });
  assert.equal(fresh.systems.a, 'fresh'); assert.deepEqual(fresh.closed, ['STICKY-a']);
  assert.equal((await readStickiness(db, { now: NOW })).systems.find(x => x.system === 'a').series.length, 1, 'both readings were of one day');
});

// The closing probe of a known defect, PLANNED in section 7 (a todo test is recorded as planned, never as proof): the declared minimum depth and rhythm are
// read with `||`, so a declared 0 is read as the default.
test('US-29-R75: a declared min_depth of 0 is honoured', { todo: 'seed/worker/src/stickiness.js reads st.min_depth || 3, so 0 becomes 3' }, async () => {
  _reset(); const db = makeDb();
  const cfg = { progress: { systems: [sysA({ min_depth: 0, domains: [] })] } };
  const r = await stickinessStep({ db, config: cfg, ensureItem, fetchImpl: fetchOf([ent('a1', 1, { depth: 1 }), ent('a2', 2, { depth: 1 })]), now: NOW });
  assert.equal(r.systems.a, 'fresh');
});
