import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { REGISTRY, handleAnalytics, selfcheck, prune, measure, report, record, cleanPath, BEACON_JS } from '../../analytics/analytics.js';

function mk() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../../analytics/schema.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x; return o; },
    async all() { return { results: st.all(...a).map(r => ({ ...r })) }; }, async first() { const r = st.get(...a); return r ? { ...r } : null; },
    async run() { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
  return { raw, DB };
}
const beacon = (b, h = {}) => new Request('https://x.test/a/e', { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari', ...h }, body: JSON.stringify(b) });
const opts = { hosts: ['site.test'] };

test('every metric has a trigger or a named exemption, and a kind', () => {
  for (const m of REGISTRY) {
    assert.ok(['target', 'guard'].includes(m.kind), m.name);
    assert.ok(m.min != null || m.max != null || (m.exemption && m.exemption.length > 10), m.name + ' needs a trigger or exemption');
  }
  assert.ok(REGISTRY.some(m => m.kind === 'guard'));
});
test('beacon records a real pageview, strips query, keeps only the referrer host', async () => {
  const e = mk();
  const r = await handleAnalytics(beacon({ h: 'www.site.test', p: '/pricing/?utm=1#x', r: 'https://news.example/post/1' }), e, opts);
  assert.equal(r.status, 204);
  const row = e.raw.prepare('SELECT * FROM hits').get();
  assert.equal(row.path, '/pricing'); assert.equal(row.ref, 'news.example'); assert.equal(row.device, 'mobile'); assert.equal(row.bot, 0);
  assert.equal(row.vid.length, 16);
});
test('unknown host, DNT and GPC are dropped; bots are stored but not counted', async () => {
  const e = mk();
  await handleAnalytics(beacon({ h: 'evil.test', p: '/' }), e, opts);
  await handleAnalytics(beacon({ h: 'site.test', p: '/' }, { dnt: '1' }), e, opts);
  await handleAnalytics(beacon({ h: 'site.test', p: '/' }, { 'sec-gpc': '1' }), e, opts);
  assert.equal(e.raw.prepare('SELECT COUNT(*) c FROM hits').get().c, 0);
  await handleAnalytics(beacon({ h: 'site.test', p: '/' }, { 'user-agent': 'Googlebot/2.1' }), e, opts);
  const m = await measure(e); assert.equal(m.values.pageviews_7d, 0); assert.equal(m.hits7, 1);
});
test('bad bodies are refused; no IP or cookie is stored', async () => {
  const e = mk();
  assert.equal((await handleAnalytics(new Request('https://x.test/a/e', { method: 'POST', body: 'nope' }), e, opts)).status, 400);
  assert.equal((await handleAnalytics(new Request('https://x.test/a/e', { method: 'POST', body: 'x'.repeat(1500) }), e, opts)).status, 413);
  await handleAnalytics(beacon({ h: 'site.test', p: '/' }, { 'cf-connecting-ip': '203.0.113.7' }), e, opts);
  assert.ok(!JSON.stringify(e.raw.prepare('SELECT * FROM hits').all()).includes('203.0.113.7'));
  assert.equal(await handleAnalytics(new Request('https://x.test/other'), e, opts), null);
  assert.match(BEACON_JS, /sendBeacon/); assert.ok(!/cookie|localStorage/.test(BEACON_JS));
});
test('selfcheck keeps the collector guard green, prunes old rows, never counts as a pageview', async () => {
  const e = mk(); const old = Date.now() - 40 * 864e5;
  e.raw.prepare('INSERT INTO hits(at,host,path,vid) VALUES(?,?,?,?)').run(old, 'site.test', '/', 'v');
  let m = await measure(e); assert.equal(m.values.collector_selfcheck, 0);
  await selfcheck(e, 'site.test');
  m = await measure(e); assert.equal(m.values.collector_selfcheck, 1);
  assert.equal(e.raw.prepare('SELECT COUNT(*) c FROM hits WHERE at<?').get(old + 1).c, 0);
  assert.equal(m.values.pageviews_7d, 0);
});
test('triggers: traffic floor breaches only after the grace period; guard breaches at once', async () => {
  const e = mk();
  await record(e, new Request('https://site.test/', { headers: { 'user-agent': 'Mozilla/5.0' } }), { host: 'site.test', path: '/' });
  const young = await report(e);
  assert.ok(!young.metrics.find(x => x.name === 'pageviews_7d').hit);
  assert.equal(young.metrics.find(x => x.name === 'collector_selfcheck').hit, 1);
  e.raw.prepare('UPDATE analytics_meta SET value=?').run(String(Date.now() - 20 * 864e5));
  e.raw.prepare('UPDATE hits SET at=?').run(Date.now() - 10 * 864e5);
  const aged = await report(e);
  assert.equal(aged.metrics.find(x => x.name === 'pageviews_7d').hit, 1);
  assert.ok(aged.breaches >= 2);
});
test('visitors count once per day per browser; referral share is computed', async () => {
  const e = mk();
  for (let i = 0; i < 3; i++) await handleAnalytics(beacon({ h: 'site.test', p: '/' + i, r: i ? 'https://a.test/' : '' }), e, opts);
  const m = await measure(e);
  assert.equal(m.values.pageviews_7d, 3); assert.equal(m.values.visitors_7d, 1); assert.equal(m.values.referral_share_7d, 0.667);
  assert.equal(cleanPath('a/b/?q=1'), '/a/b');
});
// READ-BUDGET-1: reads stay bounded on the free plan (5 million rows read a day).
test('report cache: a cached report is reused within its window and recomputed after it', async () => {
  const e = mk();
  await record(e, new Request('https://site.test/', { headers: { 'user-agent': 'Mozilla/5.0' } }), { host: 'site.test', path: '/' });
  const a = await report(e, undefined, { cacheMinutes: 60 });
  assert.equal(a.metrics.find(x => x.name === 'pageviews_7d').value, 1);
  await record(e, new Request('https://site.test/', { headers: { 'user-agent': 'Mozilla/5.0' } }), { host: 'site.test', path: '/b' });
  const b = await report(e, undefined, { cacheMinutes: 60 });
  assert.equal(b.metrics.find(x => x.name === 'pageviews_7d').value, 1, 'served from the cache');
  assert.ok(b.cached_at);
  assert.equal((await report(e)).metrics.find(x => x.name === 'pageviews_7d').value, 2, 'no cache option reads live');
  e.raw.prepare("UPDATE analytics_meta SET value=json_set(value,'$.at',?) WHERE key='report_cache'").run(Date.now() - 61 * 60e3);
  assert.equal((await report(e, undefined, { cacheMinutes: 60 })).metrics.find(x => x.name === 'pageviews_7d').value, 2, 'stale cache is recomputed');
});
test('prune runs once a day and drops old self-check rows but keeps real pageviews', async () => {
  const e = mk(); const now = Date.now();
  e.raw.prepare("INSERT INTO hits(at,host,path,vid,name) VALUES(?,?,?,?,?)").run(now - 3 * 864e5, 'site.test', '/', 'v', 'selfcheck');
  e.raw.prepare("INSERT INTO hits(at,host,path,vid,name) VALUES(?,?,?,?,?)").run(now - 3 * 864e5, 'site.test', '/', 'v', 'pageview');
  e.raw.prepare("INSERT INTO hits(at,host,path,vid,name) VALUES(?,?,?,?,?)").run(now - 3600e3, 'site.test', '/', 'v', 'selfcheck');
  assert.equal(await prune(e, now), true);
  assert.deepEqual(e.raw.prepare("SELECT name, COUNT(*) c FROM hits GROUP BY name ORDER BY name").all().map(r => [r.name, r.c]), [['pageview', 1], ['selfcheck', 1]]);
  e.raw.prepare("INSERT INTO hits(at,host,path,vid,name) VALUES(?,?,?,?,?)").run(now - 50 * 864e5, 'site.test', '/', 'v', 'pageview');
  assert.equal(await prune(e, now), false, 'second run the same day does nothing');
  assert.equal(e.raw.prepare("SELECT COUNT(*) c FROM hits").get().c, 3);
  assert.ok(e.raw.prepare("SELECT name FROM sqlite_master WHERE name='hits_name_at'").get(), 'self-check index exists');
});
test('the windowed counts come from one aggregate scan, with the same values as before', async () => {
  const src = readFileSync(new URL('../../analytics/analytics.js', import.meta.url), 'utf8');
  const m = src.slice(src.indexOf('export async function measure'), src.indexOf('export function evaluate'));
  assert.equal((m.match(/FROM hits/g) || []).length, 3, 'aggregate pass, distinct visitors, self-check lookup');
  const e = mk(); const now = Date.now();
  const add = (daysAgo, ref, bot, name = 'pageview') => e.raw.prepare("INSERT INTO hits(at,host,path,ref,bot,vid,name) VALUES(?,?,?,?,?,?,?)").run(now - daysAgo * 864e5, 'site.test', '/', ref, bot, 'v' + daysAgo, name);
  add(1, '', 0); add(2, 'a.test', 0); add(3, '', 1); add(10, 'b.test', 0); add(20, '', 0); add(40, '', 0);
  const v = (await measure(e, now)).values;
  assert.equal(v.pageviews_7d, 2); assert.equal(v.pageviews_30d, 4); assert.equal(v.referral_30d, 2); assert.equal(v.referral_share_7d, 0.5); assert.equal(v.bot_share_7d, 0.333);
});
