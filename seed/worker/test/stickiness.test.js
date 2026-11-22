// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { stickinessStep, readStickiness, readQueue, STICKINESS_DDL, _reset } from '../src/stickiness.js';
import { ensureItem } from '../src/tick.js';
import { toJsonFeed } from '../src/vendor/core/stickiness.js';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const ent = (id, hAgo, o = {}) => ({ id, at: new Date(NOW - hAgo * 3600e3).toISOString(), title: 'Entry ' + id, url: 'https://t/' + id, summary: 'A point. More.', domain: 'health', depth: 5, ...o });
const feed = items => toJsonFeed({ title: 't', link: 'https://t', description: 'd', feedUrl: 'https://t/feed.json', items });
const fetchOf = items => async () => ({ ok: true, json: async () => feed(items) });
const config = { progress: { systems: [{ id: 'a', name: 'A', repo: 'o/a', stickiness: { content_feed: 'https://t/feed.json', domains: ['health', 'water'], expect_days: 2, reveal: 'Runs on Ultrastable.' } }, { id: 'b', name: 'B', repo: 'o/b' }] } };

test('the Worker DDL equals the migration', () => {
  const sql = readFileSync(new URL('../migrations/0030_stickiness.sql', import.meta.url), 'utf8');
  for (const d of STICKINESS_DDL) assert.ok(sql.includes(d), d.slice(0, 50));
});

test('a stale system files STICKY-<id> once, an undeclared one is named, and the same reading closes the item when it turns fresh', async () => {
  _reset(); const db = makeDb();
  let r = await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('old', 24 * 9)]), now: NOW });
  assert.equal(r.systems.a, 'stale'); assert.deepEqual(r.filed, ['STICKY-a']); assert.deepEqual(r.undeclared, ['b']);
  const it = await db.prepare(`SELECT status, title FROM items WHERE id = ?`).bind('STICKY-a').first();
  assert.ok(it && /stale/.test(it.title) && /within \d+ h/.test(it.title));
  r = await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('new', 3, { domain: 'water' }), ent('old', 24 * 9)]), now: NOW + 3600e3 });
  assert.equal(r.systems.a, 'fresh'); assert.deepEqual(r.closed, ['STICKY-a']);
  const s = await readStickiness(db, { now: NOW });
  assert.equal(s.systems.find(x => x.system === 'a').series.length, 1);
  assert.equal(s.systems.find(x => x.system === 'b').state, 'undeclared');
});

test('an unreadable feed is a failed reading, never fresh or stale, and the last good row stays', async () => {
  _reset(); const db = makeDb();
  await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('x', 2)]), now: NOW });
  const r = await stickinessStep({ db, config, ensureItem, fetchImpl: async () => ({ ok: false, status: 503 }), now: NOW + 1000 });
  assert.equal(r.systems.a, 'unreadable');
  const row = (await readStickiness(db)).systems.find(x => x.system === 'a');
  assert.equal(row.state, 'unreadable'); assert.ok(row.error);
});

test('unpromoted entries become the social queue, with the reveal line', async () => {
  _reset(); const db = makeDb();
  await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('p', 5), ent('q', 6)]), now: NOW });
  const q = await readQueue(db, 'a');
  assert.equal(q.posts.length, 2); assert.ok(q.posts.every(p => p.text.endsWith('Runs on Ultrastable.') && p.id.startsWith('sticky:')));
  assert.deepEqual((await readQueue(db, 'none')).posts, []);
});

test('admission: every system in the instance progress file declares its content feed, except the shrink-only baseline', () => {
  const f = new URL('../../../instances/ultrastable/progress.json', import.meta.url);
  if (!existsSync(f)) return;  // a standalone seed checkout carries no instance manifest
  const baseline = new Set(['unlearn']);  // shrink-only: ships through the platform feed until it has its own JSON Feed
  const missing = JSON.parse(readFileSync(f, 'utf8')).systems.filter(s => !(s.stickiness && s.stickiness.content_feed) && !baseline.has(s.id)).map(s => s.id);
  assert.deepEqual(missing, []);
});

test('the audience counts visitor-days and daily feed readers from first-party hits, and never invents a return rate', async () => {
  _reset(); const db = makeDb();
  const cfg = { progress: { systems: [{ id: 'a', name: 'A', repo: 'o/a', stickiness: { content_feed: 'https://t/feed.json', analytics_host: 'a.example' } }] } };
  for (const [v, n, bot] of [['v1', 'pageview', 0], ['v2', 'pageview', 0], ['v3', 'pageview', 1], ['f1', 'feed', 1], ['f2', 'feed', 1]]) await db.prepare(`INSERT INTO hits(at,host,path,vid,name,bot) VALUES(?,?,?,?,?,?)`).bind(NOW - 3600e3, 'a.example', '/', v, n, bot).run();
  await stickinessStep({ db, config: cfg, ensureItem, fetchImpl: fetchOf([ent('x', 2)]), now: NOW });
  const a = JSON.parse((await db.prepare(`SELECT measure FROM stickiness_state WHERE system='a'`).first()).measure).audience;
  assert.deepEqual(a, { return_rate: null, subscribers: null, feed_hits_7d: 2 });
});

test('the finding is filed even when other filers have spent the daily originate cap', async () => {
  _reset(); const db = makeDb();
  await db.prepare('CREATE TABLE IF NOT EXISTS budget_ledger (day TEXT NOT NULL, kind TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, refused INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))').run();
  await db.prepare(`INSERT INTO budget_ledger (day, kind, units, calls, refused) VALUES (?, 'originated', 0, 20, 0)`).bind(new Date(NOW).toISOString().slice(0, 10)).run();
  const r = await stickinessStep({ db, config, ensureItem, fetchImpl: fetchOf([ent('old', 24 * 9)]), now: NOW });
  assert.deepEqual(r.filed, ['STICKY-a']);
});
