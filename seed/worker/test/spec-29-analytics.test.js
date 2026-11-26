// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-29 (visible progress, content stickiness and substantive change): the first-party analytics the audience reading rests on (seed/analytics/analytics.js),
// proved through its exported functions over an in-memory SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { REGISTRY, VERSION, REPORT_CACHE_MINUTES, BEACON_JS, handleAnalytics, record, selfcheck, prune, measure, evaluate, report, summary, cleanPath, hostOf, deviceOf, isBot } from '../../analytics/analytics.js';

function mk() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../../analytics/schema.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x; return o; },
    async all() { return { results: st.all(...a).map(r => ({ ...r })) }; }, async first() { const r = st.get(...a); return r ? { ...r } : null; },
    async run() { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
  return { raw, DB };
}
const D = 864e5;
const beacon = (b, h = {}) => new Request('https://x.test/a/e', { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari', ...h }, body: JSON.stringify(b) });
const opts = { hosts: ['site.test'] };
const human = { headers: { 'user-agent': 'Mozilla/5.0' } };

test('US-29-R61: a hit is first-party and cookieless: the visitor id is a daily-rotating hash, no address or cookie is stored, a browser that asks not to be tracked is not counted, and only the declared hosts are accepted', async () => {
  assert.match(BEACON_JS, /doNotTrack/); assert.match(BEACON_JS, /globalPrivacyControl/); assert.match(BEACON_JS, /sendBeacon/); assert.doesNotMatch(BEACON_JS, /cookie|localStorage|sessionStorage/);
  const e = mk();
  const ip = { 'cf-connecting-ip': '203.0.113.7' };
  await handleAnalytics(beacon({ h: 'www.site.test', p: '/pricing/?utm=1#x', r: 'https://news.example/post/1' }, ip), e, opts);
  const row = e.raw.prepare('SELECT * FROM hits').get();
  assert.deepEqual([row.host, row.path, row.ref, row.device, row.bot, row.name, row.vid.length], ['site.test', '/pricing', 'news.example', 'mobile', 0, 'pageview', 16]);
  assert.ok(!JSON.stringify(row).includes('203.0.113.7') && !JSON.stringify(row).includes('Safari'), 'neither the address nor the browser string is kept');
  e.raw.exec('DELETE FROM hits');
  assert.equal(await record(e, new Request('https://site.test/', { headers: { 'user-agent': 'Mozilla/5.0', dnt: '1' } }), { host: 'site.test', path: '/' }), false);
  assert.equal(await record(e, new Request('https://site.test/', { headers: { 'user-agent': 'Mozilla/5.0', 'sec-gpc': '1' } }), { host: 'site.test', path: '/' }), false);
  assert.equal(e.raw.prepare('SELECT COUNT(*) c FROM hits').get().c, 0, 'Do Not Track and Global Privacy Control are honoured');
  await handleAnalytics(beacon({ h: 'evil.test', p: '/' }), e, opts);
  assert.equal(e.raw.prepare('SELECT COUNT(*) c FROM hits').get().c, 0, 'a host this deployment does not count is dropped');
  assert.equal((await handleAnalytics(beacon({ h: 'evil.test', p: '/' }), e, opts)).status, 204, 'and answered as if it were counted');
  assert.equal((await handleAnalytics(beacon({ h: 'other.test', p: '/' }), { ...e, ANALYTICS_HOSTS: 'other.test' }, opts)).status, 204);
  assert.equal(e.raw.prepare('SELECT COUNT(*) c FROM hits').get().c, 1, 'the environment\'s host list overrides the declared one');
  e.raw.exec('DELETE FROM hits');
  const vid = async (salt, ipx) => { const x = mk(); x.ANALYTICS_SALT = salt; await record(x, new Request('https://site.test/', { headers: { 'user-agent': 'Mozilla/5.0', 'cf-connecting-ip': ipx } }), { host: 'site.test', path: '/' }); return x.raw.prepare('SELECT vid FROM hits').get().vid; };
  assert.equal(await vid('s', '1.1.1.1'), await vid('s', '1.1.1.1'), 'the same browser on the same day is one visitor');
  assert.notEqual(await vid('s', '1.1.1.1'), await vid('s', '2.2.2.2'));
  assert.notEqual(await vid('s', '1.1.1.1'), await vid('t', '1.1.1.1'), 'the salt is the deployment\'s own');
  const real = Date.now; Date.now = () => real() + D;
  try { assert.notEqual(await vid('s', '1.1.1.1'), await (async () => { Date.now = real; return vid('s', '1.1.1.1'); })(), 'the id changes with the day, so a visitor cannot be followed across days'); } finally { Date.now = real; }
  assert.equal((await handleAnalytics(new Request('https://x.test/a/e', { method: 'POST', body: 'nope' }), e, opts)).status, 400);
  assert.equal((await handleAnalytics(new Request('https://x.test/a/e', { method: 'POST', body: 'x'.repeat(1500) }), e, opts)).status, 413);
  assert.equal((await handleAnalytics(new Request('https://x.test/a/e', { method: 'GET' }), e, opts)).status, 405);
  const pre = await handleAnalytics(new Request('https://x.test/a/e', { method: 'OPTIONS' }), e, opts);
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  const js = await handleAnalytics(new Request('https://x.test/a.js'), e, opts);
  assert.match(js.headers.get('content-type'), /javascript/); assert.equal(await js.text(), BEACON_JS);
  assert.equal(await handleAnalytics(new Request('https://x.test/other'), e, opts), null);
  assert.equal(cleanPath('a/b/?q=1'), '/a/b'); assert.equal(cleanPath('/'), '/'); assert.equal(cleanPath('/' + 'x'.repeat(300)).length, 120);
  assert.equal(hostOf('https://www.Example.com/p'), 'example.com'); assert.equal(hostOf('not a url'), '');
  assert.deepEqual(['Mozilla/5.0 (iPad)', 'Mozilla/5.0 (Linux; Android 14)', 'Mozilla/5.0 (X11)'].map(deviceOf), ['tablet', 'mobile', 'desktop']);
  const self = mk(); await handleAnalytics(beacon({ h: 'site.test', p: '/a', r: 'https://site.test/b' }), self, opts);
  assert.equal(self.raw.prepare('SELECT ref FROM hits').get().ref, '', 'a referrer that is the site itself is not a referral');
});

test('US-29-R62: only real visitors are counted, a visitor counts once a day, every metric carries a trigger or a reason for none, and a breach needs enough history and enough hits', async () => {
  const e = mk(), now = Date.now();
  const add = (daysAgo, o = {}) => e.raw.prepare('INSERT INTO hits(at,host,path,ref,bot,vid,name) VALUES(?,?,?,?,?,?,?)').run(now - daysAgo * D, 'site.test', o.path || '/', o.ref || '', o.bot || 0, o.vid || 'v' + daysAgo, o.name || 'pageview');
  add(1, { vid: 'a' }); add(1, { vid: 'a', path: '/b' }); add(2, { vid: 'a', ref: 'n.test' }); add(2, { vid: 'c', ref: 'n.test' }); add(3, { vid: 'bot', bot: 1 }); add(10, { vid: 'd', ref: 'z.test' }); add(40, { vid: 'old' }); add(1, { vid: 'f', name: 'feed' });
  const m = await measure(e, now);
  assert.deepEqual([m.values.pageviews_7d, m.values.pageviews_30d, m.values.visitors_7d, m.values.referral_30d, m.values.referral_share_7d, m.values.bot_share_7d, m.values.collector_selfcheck], [4, 5, 3, 3, 0.5, 0.2, 0],
    'four real views in 7 days; a visitor is counted once a day (a on two days, c): three visitor-days; the bot is counted only in the bot share; a feed read is not a page view');
  assert.equal(isBot(''), true); assert.equal(isBot('Googlebot/2.1'), true); assert.equal(isBot('Mozilla/5.0 (X11)'), false);
  for (const r of REGISTRY) { assert.ok(['target', 'guard'].includes(r.kind), r.name); assert.ok(r.min != null || r.max != null || (r.exemption && r.exemption.length > 10), r.name + ' needs a trigger or an exemption'); }
  assert.ok(REGISTRY.some(r => r.kind === 'guard' && r.name === 'collector_selfcheck' && r.grace_days === 0));
  const base = { age_days: 20, hits7: 100, values: { pageviews_7d: 5, visitors_7d: 3, referral_share_7d: 0, pageviews_30d: 5, referral_30d: 0, collector_selfcheck: 1, bot_share_7d: 0.1 } };
  const hit = m2 => Object.fromEntries(evaluate(m2).map(x => [x.name, x.hit]));
  assert.deepEqual(Object.values(hit(base)).reduce((a, b) => a + b, 0), 0, 'a healthy reading breaches nothing');
  assert.equal(hit({ ...base, values: { ...base.values, pageviews_7d: 0 } }).pageviews_7d, 1, 'traffic below its floor breaches once the grace period has passed');
  assert.equal(hit({ ...base, age_days: 13, values: { ...base.values, pageviews_7d: 0 } }).pageviews_7d, 0, 'inside 14 days of collecting it does not');
  assert.equal(hit({ ...base, age_days: 0, values: { ...base.values, collector_selfcheck: 0 } }).collector_selfcheck, 1, 'the collector guard has no grace');
  assert.equal(hit({ ...base, values: { ...base.values, bot_share_7d: 0.9 } }).bot_share_7d, 1);
  assert.equal(hit({ ...base, hits7: 49, values: { ...base.values, bot_share_7d: 0.9 } }).bot_share_7d, 0, 'a bot share of fewer than 50 hits is not a reading');
  assert.equal(hit({ ...base, age_days: 3, values: { ...base.values, bot_share_7d: 0.9 } }).bot_share_7d, 0);
  const ex = evaluate({ ...base, values: { ...base.values, referral_share_7d: -1 } }).find(x => x.name === 'referral_share_7d');
  assert.equal(ex.hit, 0); assert.match(ex.why, /^exempt: /);
  const s = summary({ metrics: evaluate({ ...base, values: { ...base.values, pageviews_7d: 0 } }) });
  assert.match(s, /BREACH pageviews_7d = 0 \(below 1\)/); assert.match(s, /ok     visitors_7d = 3 \(within bounds\)/);
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test('US-29-R63: reads are bounded: a report is reused inside its window with the collector guard re-read live, and once a day raw rows older than 35 days and self-check rows older than 2 are deleted', async () => {
  assert.equal(REPORT_CACHE_MINUTES, 1440);
  const e = mk(), now = Date.now();
  await record(e, new Request('https://site.test/', human), { host: 'site.test', path: '/' });
  const a = await report(e, undefined, { cacheMinutes: 60 });
  assert.equal(a.metrics.find(x => x.name === 'pageviews_7d').value, 1); assert.equal(a.metrics.find(x => x.name === 'collector_selfcheck').value, 0); assert.equal(a.metrics.find(x => x.name === 'collector_selfcheck').hit, 1);
  await record(e, new Request('https://site.test/', human), { host: 'site.test', path: '/b' });
  await record(e, new Request('https://site.test/', { headers: { 'user-agent': 'ultrastable-selfcheck/bot' } }), { host: 'site.test', path: '/', name: 'selfcheck' });
  const b = await report(e, undefined, { cacheMinutes: 60 });
  assert.equal(b.metrics.find(x => x.name === 'pageviews_7d').value, 1, 'served from the cache');
  assert.ok(b.cached_at);
  const g = b.metrics.find(x => x.name === 'collector_selfcheck');
  assert.deepEqual([g.value, g.hit, g.why], [1, 0, 'within bounds'], 'the guard is read live, not frozen at the time the cache was written');
  assert.equal(b.breaches, b.metrics.filter(x => x.hit).length);
  assert.equal((await report(e)).metrics.find(x => x.name === 'pageviews_7d').value, 2, 'with no cache option the report reads live');
  e.raw.prepare("UPDATE analytics_meta SET value=json_set(value,'$.at',?) WHERE key='report_cache'").run(Date.now() - 61 * 60e3);
  assert.equal((await report(e, undefined, { cacheMinutes: 60 })).metrics.find(x => x.name === 'pageviews_7d').value, 2, 'past its window the cache is recomputed');
  const f = mk(), t = Date.now();
  const ins = (ago, name) => f.raw.prepare('INSERT INTO hits(at,host,path,vid,name) VALUES(?,?,?,?,?)').run(t - ago * D, 'site.test', '/', 'v', name);
  ins(3, 'selfcheck'); ins(3, 'pageview'); ins(1 / 24, 'selfcheck'); ins(36, 'pageview'); ins(34, 'pageview');
  assert.equal(await prune(f, t), true);
  assert.deepEqual(f.raw.prepare('SELECT name, COUNT(*) c FROM hits GROUP BY name ORDER BY name').all().map(r => [r.name, r.c]), [['pageview', 2], ['selfcheck', 1]], 'a pageview of 34 days stays, one of 36 days and a self-check of 3 days go');
  ins(50, 'pageview');
  assert.equal(await prune(f, t), false, 'a second run the same day does nothing');
  assert.equal(f.raw.prepare('SELECT COUNT(*) c FROM hits').get().c, 4);
  assert.ok(f.raw.prepare("SELECT name FROM sqlite_master WHERE name='hits_name_at'").get());
  const views = (await measure(f)).values.pageviews_7d;
  await selfcheck(f, 'site.test');
  assert.equal((await measure(f)).values.collector_selfcheck, 1, 'a self-check is a hit through the real insert path');
  assert.equal((await measure(f)).values.pageviews_7d, views, 'and never a page view');
  const src = readFileSync(new URL('../../analytics/analytics.js', import.meta.url), 'utf8');
  assert.equal((src.slice(src.indexOf('export async function measure'), src.indexOf('export function evaluate')).match(/FROM hits/g) || []).length, 3, 'the windowed counts are one aggregate pass, the distinct visitors and the self-check lookup');
});
