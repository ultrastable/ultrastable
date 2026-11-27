// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// READ-BUDGET-11: the cached reading of goal_samples returns the same rows as the full scan, and reads only the recent hours once warm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { goalSamples14d, bucket, unbucket, WINDOW_MS } from '../src/goalsamples.js';

const HOUR = 3600e3;
function mk() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE org (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE goal_samples (goal_id TEXT NOT NULL, at INTEGER NOT NULL, value REAL NOT NULL); CREATE INDEX goal_samples_at ON goal_samples (at);`);
  const log = [];
  const db = { raw, log, prepare(sql) { let args = []; const st = raw.prepare(sql);
    const api = { bind(...a) { args = a; return api; }, async all() { const results = st.all(...args); log.push({ sql, rows: results.length }); return { results }; },
      async first() { return st.get(...args) ?? null; }, async run() { st.run(...args); return { meta: {} }; } }; return api; } };
  return db;
}
const full = (db, now) => db.raw.prepare(`SELECT goal_id, at, value FROM goal_samples WHERE at >= ? ORDER BY at`).all(now - WINDOW_MS);
const key = r => `${r.at}|${r.goal_id}|${r.value}`;
const same = (a, b) => assert.deepEqual(a.map(key).sort(), b.map(key).sort());
const ordered = rows => rows.every((r, i) => i === 0 || rows[i - 1].at <= r.at);

test('bucket and unbucket are inverse and ordered by at', () => {
  const rows = [{ goal_id: 'a', at: 10, value: 1 }, { goal_id: 'b', at: 10, value: 2 }, { goal_id: 'a', at: HOUR + 5, value: 3 }];
  assert.deepEqual(unbucket(bucket(rows)), rows);
});

test('the cached reading equals the full scan as samples arrive tick by tick, and reads few rows once warm', async () => {
  const db = mk(), t0 = Date.UTC(2026, 10, 1, 0, 7), ins = db.raw.prepare('INSERT INTO goal_samples VALUES (?,?,?)');
  for (let i = 0; i < 6 * 24 * 16; i++) for (const g of ['core.a', 'core.b', 'core.c']) ins.run(g, t0 + i * 600e3, i % 7);   // 16 days, a sample every 10 minutes
  let now = t0 + 16 * 86400e3;
  const cold = await goalSamples14d(db, now); same(cold, full(db, now)); assert.ok(ordered(cold));
  db.log.length = 0;
  for (let k = 1; k <= 30; k++) {                                   // five more hours of ticks, read after each
    now += 600e3; for (const g of ['core.a', 'core.b', 'core.c']) ins.run(g, now, k);
    const got = await goalSamples14d(db, now); same(got, full(db, now)); assert.ok(ordered(got));
  }
  const worst = Math.max(...db.log.map(l => l.rows));
  assert.ok(worst <= 3 * 6 * 3, `a warm reading returns at most the recent hours and the edge hour, got ${worst} rows`);
});

test('a gap in the cache, a clock that went back and a missing cache all fall back to a correct reading', async () => {
  const db = mk(), t0 = Date.UTC(2026, 10, 1), ins = db.raw.prepare('INSERT INTO goal_samples VALUES (?,?,?)');
  for (let i = 0; i < 100; i++) ins.run('g', t0 + i * HOUR / 2, i);
  let now = t0 + 50 * HOUR;
  same(await goalSamples14d(db, now), full(db, now));
  now += 9 * HOUR; ins.run('g', now - 4 * HOUR, 99);                 // nine hours unread: hours never cached are read again
  same(await goalSamples14d(db, now), full(db, now));
  same(await goalSamples14d(db, now - 20 * HOUR), full(db, now - 20 * HOUR));  // an earlier instant ignores the later cache
  db.raw.exec(`UPDATE org SET value = 'not json'`);
  same(await goalSamples14d(db, now), full(db, now));
  const empty = mk(); assert.deepEqual(await goalSamples14d(empty, now), []);
});
