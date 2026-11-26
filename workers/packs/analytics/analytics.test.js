// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for packs/analytics (US-SPEC-21 class A). In-memory database; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../../core/_shared/testdb.js';
import { KERNEL_DIR } from '../../core/kernel/testkit.js';
import { createPacks, validateManifest, loadManifest, MIGRATIONS_DIR } from '../../core/packs/index.js';
import { recordPageview, report } from './index.js';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const D = 86400e3;
const T0 = Date.now() - 3600e3;  // relative: pack read probes use datetime('now', '-N days'), so a fixed date fails once it ages out
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a).map(r => ({ ...r }));
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const UA = 'Mozilla/5.0 (X11; Linux) Firefox/130';
const S = { salt: 'test-salt-value', own_hosts: ['example.org'] };
const req = (over = {}) => ({ url: 'https://example.org/about?utm_source=social&utm_medium=post&utm_campaign=claims&email=a@b.c', referrer: 'https://news.example.net/x', userAgent: UA, ip: '203.0.113.9', ...over });

async function setup(clock = { t: T0 }) {
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR, MIG]);
  const packs = createPacks({ db, now: () => clock.t, config: { packs: { analytics: S } }, channels: {} });
  const m = loadManifest(DIR);
  assert.deepEqual((await packs.register(m, { dir: DIR })).errors, undefined);
  assert.equal((await packs.enablePack('analytics', { by: 'owner', cardText: m.enable_gate })).ok, true);
  const loop = async name => {
    const step = (await packs.packSteps()).find(x => x.name === `pack:analytics:${name}`);
    const ctx = { tickId: 12, errors: [], notes: [], now: clock.t };
    await step.run(db, ctx);
    assert.deepEqual(ctx.errors, []);
    return ctx;
  };
  const rec = (r, t = clock.t) => recordPageview({ db, now: () => t, settings: S, request: r });
  return { db, loop, rec, clock };
}

test('manifest is valid, class A with no outbound, analytics_ prefixed tables, probes run', () => {
  const m = loadManifest(DIR);
  assert.deepEqual(validateManifest(m, { tenantNames: ['acme'] }), []);
  assert.equal(m.class, 'A');
  assert.equal(m.outbound, undefined);
  assert.ok(m.loops.every(l => l.outbound === false));
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR, MIG]);
  const sql = readFileSync(new URL('./migrations/0001_analytics.sql', import.meta.url), 'utf8');
  db.raw.exec(sql); db.raw.exec(sql);
  assert.deepEqual(rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'analytics_%'`).map(r => r.name).sort(), ['analytics_daily', 'analytics_events', 'analytics_metrics', 'analytics_search', 'analytics_sources']);
  for (const g of [...m.charter.guard_metrics, m.charter.primary_metric]) db.raw.prepare(g.read_probe).get();
});

test('a page view stores path, referrer host and tags only: no query, no IP, no raw UA', async () => {
  const { db, rec } = await setup();
  assert.deepEqual(await rec(req()), { recorded: true });
  const e = one(db, `SELECT * FROM analytics_events`);
  assert.equal(e.path, '/about');
  assert.equal(e.referrer, 'news.example.net');
  assert.equal(e.utm_source, 'social');
  assert.match(e.visitor_hash, /^[0-9a-f]{64}$/);
  const dump = JSON.stringify(rows(db, `SELECT * FROM analytics_events`));
  for (const leak of ['203.0.113.9', 'Firefox', 'a@b.c', 'email']) assert.ok(!dump.includes(leak), leak);
});

test('bots, Do Not Track, Global Privacy Control, foreign hosts are skipped; a missing salt is refused', async () => {
  const { db, rec } = await setup();
  assert.deepEqual(await rec(req({ userAgent: 'Googlebot/2.1' })), { skipped: 'bot' });
  assert.deepEqual(await rec(req({ userAgent: '' })), { skipped: 'bot' });
  assert.deepEqual(await rec(req({ dnt: '1' })), { skipped: 'do_not_track' });
  assert.deepEqual(await rec(req({ gpc: '1' })), { skipped: 'do_not_track' });
  assert.deepEqual(await rec(req({ url: 'https://other.example.net/' })), { skipped: 'foreign_host' });
  assert.deepEqual(await rec(req({ url: 'not a url' })), { skipped: 'bad_url' });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM analytics_events`).n, 0);
  await assert.rejects(recordPageview({ db, settings: { own_hosts: ['example.org'] }, request: req() }), /salt/);
});

test('the visitor hash is stable within a day and cannot link the same visitor across days', async () => {
  const { db, rec } = await setup();
  await rec(req()); await rec(req({ url: 'https://example.org/b' }));
  await rec(req(), T0 + D);
  const h = rows(db, `SELECT day, visitor_hash FROM analytics_events ORDER BY id`);
  assert.equal(h[0].visitor_hash, h[1].visitor_hash);
  assert.notEqual(h[0].visitor_hash, h[2].visitor_hash);
});

test('rollup counts views and unique visitors per page and source; rerunning changes nothing', async () => {
  const { db, rec, loop } = await setup();
  await rec(req()); await rec(req());
  await rec(req({ ip: '203.0.113.10' }));
  await rec(req({ url: 'https://example.org/', referrer: '' }));
  await loop('rollup'); await loop('rollup');
  assert.deepEqual(rows(db, `SELECT path, pageviews, visitors FROM analytics_daily ORDER BY path`), [{ path: '/', pageviews: 1, visitors: 1 }, { path: '/about', pageviews: 3, visitors: 2 }]);
  assert.deepEqual(rows(db, `SELECT source, pageviews FROM analytics_sources ORDER BY source`), [{ source: '(direct)', pageviews: 1 }, { source: 'social', pageviews: 3 }]);
  const r = await report({ db, now: () => T0 });
  assert.equal(r.pageviews, 4);
  assert.equal(r.top_pages[0].path, '/about');
});

test('retention deletes raw events past the window after rolling them up, keeping the totals', async () => {
  const { db, rec, loop } = await setup();
  await rec(req(), T0 - 10 * D); await rec(req(), T0 - 1 * D);
  const ctx = await loop('retention');
  assert.match(ctx.notes.join(' '), /purged 1 raw event/);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM analytics_events`).n, 1);
  assert.equal(one(db, `SELECT SUM(pageviews) AS n FROM analytics_daily`).n, 2);
  for (const g of loadManifest(DIR).charter.guard_metrics) assert.equal(one(db, g.read_probe).value, 0, g.id);
});

test('metrics loop records the counts; the primary probe reads the rollup', async () => {
  const { db, rec, loop } = await setup();
  await rec(req());
  await loop('rollup'); await loop('metrics');
  const m = one(db, `SELECT * FROM analytics_metrics`);
  assert.equal(m.pageviews_7d, 1); assert.equal(m.visitors_today, 1); assert.equal(m.raw_events, 1);
  assert.equal(typeof one(db, loadManifest(DIR).charter.primary_metric.read_probe).value, 'number');
});

// ---- US-SPEC-21 s7: search presence through a read-only port ----
const YESTERDAY = new Date(T0 - D).toISOString().slice(0, 10);          // relative to the clock the test runs on, so the report window never ages out from under it
const searchRows = [
  { date: YESTERDAY, page: '/about', clicks: 5, impressions: 120, position: 3.2 },
  { date: YESTERDAY, page: 'https://example.org/blog/', clicks: 2, impressions: 40, position: 8 },
  { date: YESTERDAY, page: '/search?q=secret+query', clicks: 9, impressions: 9, position: 1 },
  { date: YESTERDAY, page: 'https://other.example.net/x', clicks: 1, impressions: 1, position: 1 },
  { date: 'bad-date', page: '/x', clicks: 1, impressions: 1 },
];
async function searchSetup(port) {
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR, MIG]);
  const calls = [];
  const settings = { ...S, ports: port === undefined ? {} : { search_analytics: async a => { calls.push(a); return port(a); } } };
  const packs = createPacks({ db, now: () => T0, config: { packs: { analytics: settings } }, channels: {} });
  const m = loadManifest(DIR);
  assert.deepEqual((await packs.register(m, { dir: DIR })).errors, undefined);
  assert.equal((await packs.enablePack('analytics', { by: 'owner', cardText: m.enable_gate })).ok, true);
  const run = async () => { const step = (await packs.packSteps()).find(x => x.name === 'pack:analytics:search'); const ctx = { tickId: 24, errors: [], notes: [], now: T0 }; await step.run(db, ctx); return ctx; };
  return { db, run, calls };
}

test('US-SPEC-21 s7 analytics: the search loop stores clicks and impressions per page and day, idempotently', async () => {
  const { db, run, calls } = await searchSetup(async () => searchRows);
  const ctx = await run(); await run();
  assert.deepEqual(ctx.errors, []);
  assert.deepEqual(calls[0].hosts, ['example.org']);
  assert.deepEqual(rows(db, `SELECT day, page, clicks, impressions, position FROM analytics_search ORDER BY page`), [
    { day: YESTERDAY, page: '/about', clicks: 5, impressions: 120, position: 3.2 },
    { day: YESTERDAY, page: '/blog', clicks: 2, impressions: 40, position: 8 },
  ]);
  assert.match(ctx.notes.join('|'), /2 row\(s\) stored, 3 dropped/);
});

test('US-SPEC-21 s7 analytics: rows with query strings are dropped, so no search query text or identifier is ever stored', async () => {
  const { db, run } = await searchSetup(async () => searchRows);
  await run();
  const dump = JSON.stringify(rows(db, `SELECT * FROM analytics_search`));
  assert.ok(!dump.includes('secret'));
  assert.equal(one(db, `SELECT COUNT(*) n FROM analytics_search WHERE page LIKE '%?%' OR page LIKE '%#%'`).n, 0);
});

test('US-SPEC-21 s7 analytics: a failing search port files an item and the tick completes; no port configured stores nothing and says so', async () => {
  const bad = await searchSetup(async () => { throw new Error('search provider down'); });
  const ctx = await bad.run();
  assert.match(ctx.errors.join('|'), /search provider down/);
  assert.equal(one(bad.db, `SELECT COUNT(*) n FROM items WHERE id LIKE 'PACKFAIL-analytics-search-%'`).n, 1);
  const none = await searchSetup(undefined);
  const c2 = await none.run();
  assert.deepEqual(c2.errors, []); assert.match(c2.notes.join('|'), /port not configured/);
  assert.equal(one(none.db, `SELECT COUNT(*) n FROM analytics_search`).n, 0);
});

test('US-SPEC-21 s7 analytics: report includes the top search pages and a secret salt may come from the presence-only accessor', async () => {
  const { db, run } = await searchSetup(async () => searchRows);
  await run();
  const r = await report({ db, now: () => T0, days: 7 });
  assert.deepEqual(r.top_search.map(x => x.page), ['/about', '/blog']);
  const secrets = { get: n => (n === 'ANALYTICS_SALT' ? 'salt-from-env-value' : undefined) };
  assert.deepEqual(await recordPageview({ db, now: () => T0, settings: { own_hosts: ['example.org'] }, secrets, request: req() }), { recorded: true });
});

test('US-SPEC-21 s7 analytics: rows for one page and day are summed, not overwritten, and a foreign host is dropped', async () => {
  const dup = [
    { date: YESTERDAY, page: '/a', clicks: 10, impressions: 100, position: 3 },
    { date: YESTERDAY, page: '/a/', clicks: 5, impressions: 40, position: 4 },
    { date: YESTERDAY, page: 'https://example.org/a', clicks: 2, impressions: 10, position: 6 },
    { date: YESTERDAY, page: 'https://other.example.org.evil.example/a', clicks: 7, impressions: 9, position: 2 },
  ];
  const { db, run } = await searchSetup(async () => dup);
  const ctx = await run(); await run();
  const got = rows(db, `SELECT day, page, clicks, impressions, position FROM analytics_search ORDER BY page`);
  assert.equal(got.length, 1);
  assert.deepEqual([got[0].page, got[0].clicks, got[0].impressions], ['/a', 17, 150]);
  assert.ok(Math.abs(got[0].position - (3 * 100 + 4 * 40 + 6 * 10) / 150) < 1e-9, 'position is the impression-weighted mean');
  assert.match(ctx.notes.join('|'), /1 row\(s\) stored, 1 dropped/);
});

test('US-SPEC-21 s7 analytics: with no own_hosts an absolute URL is dropped rather than filed under a path of this site; a relative path is kept', async () => {
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR, MIG]);
  const settings = { salt: 'test-salt-value', own_hosts: [], ports: { search_analytics: async () => [
    { date: YESTERDAY, page: '/a', clicks: 1, impressions: 2, position: 1 },
    { date: YESTERDAY, page: 'https://other.example.org/a', clicks: 7, impressions: 9, position: 2 },
  ] } };
  const packs = createPacks({ db, now: () => T0, config: { packs: { analytics: settings } }, channels: {} });
  const m = loadManifest(DIR);
  assert.deepEqual((await packs.register(m, { dir: DIR })).errors, undefined);
  assert.equal((await packs.enablePack('analytics', { by: 'owner', cardText: m.enable_gate })).ok, true);
  const step = (await packs.packSteps()).find(x => x.name === 'pack:analytics:search');
  const ctx = { tickId: 24, errors: [], notes: [], now: T0 };
  await step.run(db, ctx);
  assert.deepEqual(ctx.errors, []);
  assert.deepEqual(rows(db, `SELECT page, clicks FROM analytics_search`), [{ page: '/a', clicks: 1 }], ctx.notes.join('|'));
});
