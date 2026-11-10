import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { REGISTRY, handleAnalytics, selfcheck, measure, report, record, cleanPath, BEACON_JS } from '../../analytics/analytics.js';

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
