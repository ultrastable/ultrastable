// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../_shared/testdb.js';
import { MIGRATIONS_DIR, registerProduct, measureUsage, firstPartyReader, cloudflareAnalyticsReader, composeReaders } from './index.js';

const NOW = Date.parse('2026-11-09T12:00:00Z'), HOUR = 3600e3, DAY = 24 * HOUR;
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const HITS = `CREATE TABLE hits(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, host TEXT NOT NULL, path TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT '', bot INTEGER NOT NULL DEFAULT 0, vid TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'pageview')`;
const hit = (db, at, o = {}) => db.raw.prepare(`INSERT INTO hits (at, host, path, bot, vid, name) VALUES (?,?,?,?,?,?)`).run(at, o.host ?? 'desk.example', '/', o.bot ?? 0, 'v', o.name ?? 'pageview');
async function setup(usage_metric = 'requests_per_day') {
  const db = makeDb([MIGRATIONS_DIR]);
  await registerProduct(db, { product: 'desk', host: 'desk.example', program: 'REACH', usage_metric, quality_measure: 'error_page_rate', now: NOW - 30 * DAY });
  return db;
}

test('US-04-R14, US-04-R09: the first-party reader counts human pageviews in the window, labels them, and stores null when the table is missing', async () => {
  const db = await setup(); const reader = firstPartyReader({ db, now: () => NOW });
  assert.equal((await measureUsage(db, { reader, now: NOW }))[0].value, null);
  assert.equal(one(db, `SELECT value, evidence FROM plus_readings`).value, null);                       // no hits table: a failed read, never 0
  assert.match(one(db, `SELECT evidence FROM plus_readings`).evidence, /usage reader failed: .*no such table/);
  db.raw.exec(HITS);
  for (let i = 0; i < 14; i++) hit(db, NOW - i * HOUR);                                                      // 14 human views in the window
  hit(db, NOW - HOUR, { bot: 1 }); hit(db, NOW - HOUR, { name: 'selfcheck' }); hit(db, NOW - HOUR, { host: 'other.example' }); hit(db, NOW - 9 * DAY);   // not counted
  const r = await reader({ host: 'desk.example', usage_metric: 'requests_per_day' });
  assert.deepEqual(r, { value: 2, window_h: 168, includes_machine: false });                                 // 14 views over 7 days
  const m = await measureUsage(db, { reader, now: NOW });
  assert.equal(m[0].value, 2); assert.equal(m[0].label, 'requests_per_day (human requests)');
  assert.equal((await firstPartyReader({ db, now: () => NOW })({ host: 'desk.example', usage_metric: 'pageviews' })).value, 14);   // a metric that is not per day is the count
  await assert.rejects(reader({ host: '' }), /no host/); assert.throws(() => firstPartyReader({ db, table: 'hits; drop' }), /table name/); assert.throws(() => firstPartyReader({}), /db/);
});

test('US-04-R14: a reader that cannot separate machine requests is labelled machine and human together', async () => {
  const db = await setup();
  db.raw.exec(`CREATE TABLE hits(at INTEGER NOT NULL, host TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'pageview')`);
  for (let i = 0; i < 7; i++) db.raw.prepare(`INSERT INTO hits (at, host) VALUES (?, 'desk.example')`).run(NOW - i * HOUR);
  const r = await firstPartyReader({ db, now: () => NOW })({ host: 'desk.example', usage_metric: 'requests_per_day' });
  assert.equal(r.includes_machine, true);
  assert.match((await measureUsage(db, { reader: firstPartyReader({ db, now: () => NOW }), now: NOW }))[0].label, /machine and human requests counted together/);
});

test('US-04-R09: a platform reader failure (403, GraphQL error, malformed body, no token) stores null, never 0, and the token never appears in a record', async () => {
  const TOKEN = 'tok-secret-12345';
  const body = (v, status = 200) => async () => new Response(typeof v === 'string' ? v : JSON.stringify(v), { status });
  const ok = { data: { viewer: { zones: [{ httpRequests1dGroups: [{ sum: { requests: 700 } }, { sum: { requests: 700 } }] }] } } };
  const mk = (fetch, env = { CF_TOKEN: TOKEN }) => cloudflareAnalyticsReader({ fetch, env, token_env: 'CF_TOKEN', zones: { 'desk.example': 'zone-1' }, now: () => NOW });
  for (const [what, f, env] of [['403', body({}, 403), undefined], ['graphql error', body({ errors: [{ message: 'bad token ' + TOKEN }] }), undefined], ['malformed', body('<html>'), undefined],
    ['no groups', body({ data: {} }), undefined], ['no count', body({ data: { viewer: { zones: [{ httpRequests1dGroups: [{ sum: {} }] }] } } }), undefined], ['no token', body(ok), {}]]) {
    const db = await setup();
    await measureUsage(db, { reader: mk(f, env), now: NOW });
    const row = one(db, `SELECT value, evidence FROM plus_readings`);
    assert.equal(row.value, null, what); assert.match(row.evidence, /usage reader failed/, what); assert.equal(JSON.stringify(row).includes(TOKEN), false, what);
  }
  const db = await setup(); let seen;
  const reader = mk(async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(ok), { status: 200 }); });
  const m = await measureUsage(db, { reader, now: NOW });
  assert.equal(m[0].value, 200); assert.match(m[0].label, /machine and human requests counted together/);                         // 1400 requests over 7 days
  assert.equal(seen.init.headers.authorization, `Bearer ${TOKEN}`); assert.equal(seen.init.body.includes(TOKEN), false);
  assert.match(seen.init.body, /zone-1/);
  await assert.rejects(mk(body(ok))({ product: 'desk', host: 'unknown.example' }), /no zone is known/);
  assert.throws(() => cloudflareAnalyticsReader({}), /fetch port/);
});

test('US-04-R09, US-04-R14: composed readers use the first-party one when it answers and the platform one only when it does not', async () => {
  const db = await setup(); db.raw.exec(HITS); hit(db, NOW - HOUR);
  let platformCalls = 0;
  const platform = async () => { platformCalls++; return { value: 99, window_h: 168, includes_machine: true }; };
  const both = composeReaders([firstPartyReader({ db, now: () => NOW }), platform]);
  assert.equal((await both({ host: 'desk.example', usage_metric: 'pageviews' })).value, 1); assert.equal(platformCalls, 0);
  const noHost = await both({ host: 'nowhere.example', usage_metric: 'pageviews' });                           // zero hits is a count of 0 from a working reader
  assert.equal(noHost.value, 0); assert.equal(platformCalls, 0);
  const failing = composeReaders([async () => { throw new Error('no table'); }, platform]);
  assert.equal((await failing({})).value, 99); assert.equal(platformCalls, 1);
  await assert.rejects(composeReaders([async () => { throw new Error('a'); }, async () => ({ value: null })])({}), /reader 1: a; reader 2: returned no number/);
  await assert.rejects(composeReaders([])({}), /no usage reader/);
});
