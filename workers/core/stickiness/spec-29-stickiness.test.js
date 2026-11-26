// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-29 (visible progress, content stickiness and substantive change): the requirements of the content measure, plan, series, feeds and social queue, proved through the public API of core/stickiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalize, measure, plan, record, trend, toRss, toJsonFeed, fromJsonFeed, whatsNew, queue } from './index.js';

const NOW = Date.parse('2026-11-22T12:00:00Z'), H = 3600e3, D = 24 * H;
const e = (id, hAgo, o = {}) => ({ id, at: new Date(NOW - hAgo * H).toISOString(), title: 'Entry ' + id, url: 'https://x/' + id, summary: 'First point. Second point.', domain: 'health', kind: 'solution', depth: 5, ...o });

test('US-29-R41: a system is unmeasured with no entry, else fresh, aging or stale by the age of its newest entry against its declared rhythm, then thin, then narrow', () => {
  assert.deepEqual(DEFAULTS, { expect_days: 2, stall: 2, min_depth: 3, narrow_share: 0.6, thin_share: 0.5, window_days: 30, domains: [] });
  const none = measure([], { now: NOW });
  assert.equal(none.state, 'unmeasured'); assert.equal(none.score, null); assert.equal(none.fresh.last_at, null); assert.equal(none.breadth, null);
  assert.equal(measure([{ id: 'x', at: 'never' }, null], { now: NOW }).state, 'unmeasured', 'an entry with no readable time is not an entry');
  assert.equal(measure([e('a', 48)], { now: NOW }).state, 'fresh', 'exactly the declared rhythm is still fresh');
  assert.equal(measure([e('a', 49)], { now: NOW }).state, 'aging');
  assert.equal(measure([e('a', 96)], { now: NOW }).state, 'aging', 'exactly stall times the rhythm is still aging');
  assert.equal(measure([e('a', 97)], { now: NOW }).state, 'stale');
  assert.equal(measure([e('a', 97)], { now: NOW, expect_days: 7 }).state, 'fresh', 'the rhythm is the system\'s own');
  assert.equal(measure([e('a', 1, { depth: 1 }), e('b', 2, { depth: 0 }), e('c', 3, { depth: 9 })], { now: NOW }).state, 'thin', 'more than half under min_depth');
  assert.equal(measure([e('a', 1, { depth: 1 }), e('b', 2, { depth: 9 })], { now: NOW }).state, 'fresh', 'exactly half is not more than half');
  const nar = measure([e('a', 1), e('b', 2), e('c', 3), e('d', 4), e('f', 5, { domain: 'water' }), e('g', 6, { domain: 'energy' })], { now: NOW });
  assert.equal(nar.state, 'narrow'); assert.equal(nar.diversity.top_share, 0.667);
  assert.equal(measure([e('a', 1), e('b', 2), e('c', 3, { domain: 'water' })], { now: NOW }).state, 'fresh', 'two domains are too few to call a system narrow');
  assert.equal(measure([e('a', 1), e('b', 2), e('c', 3), e('d', 4, { domain: 'water' })], { now: NOW }).state, 'fresh');
  const both = measure([e('a', 1, { depth: 0 }), e('b', 2, { depth: 0 }), e('c', 3, { depth: 0 }), e('d', 4, { domain: 'water', depth: 0 }), e('f', 5, { domain: 'energy', depth: 0 })], { now: NOW });
  assert.equal(both.state, 'thin', 'thin is judged before narrow');
  assert.equal(measure([e('a', 100, { depth: 0 })], { now: NOW }).state, 'stale', 'thin and narrow are judged only for a fresh system');
});

test('US-29-R42: breadth, depth and diversity are read from the entries of the window, and the score is the mean of the parts that exist', () => {
  const doms = ['health', 'water', 'energy', 'food'];
  const m = measure([e('a', 24, { depth: 5 }), e('b', 30, { domain: 'water', depth: 1, kind: 'guide' }), e('c', 24 * 40, { domain: 'food' }), e('d', 12, { depth: undefined })], { now: NOW, domains: doms });
  assert.deepEqual(m.breadth, { domains_30d: 2, declared: 4, coverage: 0.5, uncovered: ['energy', 'food'] }, 'an entry older than the window covers nothing');
  assert.deepEqual(m.depth, { median: 3, thin_share: 0.5, measured: 2 }, 'only entries with a numeric depth are measured');
  assert.equal(m.diversity.kinds, 2); assert.equal(m.diversity.top_share, 0.667);
  assert.equal(m.fresh.n_30d, 3); assert.equal(m.fresh.n_24h, 2); assert.equal(m.fresh.n_7d, 3); assert.equal(m.fresh.median_gap_days, 0.38, 'the median of 6 h and 12 h, in days, to two places');
  const parts = [1 - 12 / 96, 0.5, 0.5, m.diversity.even];
  assert.equal(m.score, Math.round(parts.reduce((a, b) => a + b, 0) / 4 * 1000) / 1000);
  const open = measure([e('a', 24)], { now: NOW });
  assert.equal(open.breadth.coverage, null, 'no declared domain, no coverage');
  assert.equal(open.diversity.even, 0, 'one domain is no spread');
  assert.equal(open.score, Math.round(((1 - 24 / 96) + 1 + 0) / 3 * 1000) / 1000, 'parts that do not exist are left out of the mean');
  const nodepth = measure([e('a', 24, { depth: undefined, domain: undefined, kind: undefined })], { now: NOW });
  assert.equal(nodepth.depth, null); assert.equal(nodepth.breadth, null); assert.equal(nodepth.diversity, null);
  assert.equal(nodepth.score, 0.75, 'only freshness is left to judge');
});

test('US-29-R43: the return rate is read only from a real returning count; a missing or partial count is unmeasured, never zero or good', () => {
  assert.deepEqual(measure([e('a', 1)], { now: NOW }).audience, { return_rate: null, subscribers: null, feed_hits_7d: null });
  assert.equal(measure([e('a', 1)], { now: NOW, audience: { visits_7d: 200 } }).audience.return_rate, null, 'visits without a returning count');
  assert.equal(measure([e('a', 1)], { now: NOW, audience: { visits_7d: 0, returning_7d: 0 } }).audience.return_rate, null, 'no visit is no rate');
  assert.deepEqual(measure([e('a', 1)], { now: NOW, audience: { visits_7d: 200, returning_7d: 50, subscribers: 7, feed_hits_7d: 12 } }).audience, { return_rate: 0.25, subscribers: 7, feed_hits_7d: 12 });
  assert.equal(measure([], { now: NOW, audience: { visits_7d: 10, returning_7d: 5 } }).audience.return_rate, 0.5, 'an unmeasured system still reports its audience');
});

test('US-29-R44: every action names the metric it should move and a prediction in the scorer\'s form, and a system with nothing short plans nothing', () => {
  const doms = ['health', 'water'];
  assert.deepEqual(plan(measure([], { now: NOW })), [{ kind: 'generate', why: 'no entry exists yet', metric: 'n_7d', prediction: 'n_7d >= 1 within 48 h' }]);
  const stale = plan(measure([e('a', 200)], { now: NOW, domains: doms }));
  assert.equal(stale.length, 1); assert.equal(stale[0].kind, 'generate'); assert.equal(stale[0].domain, 'water'); assert.equal(stale[0].metric, 'n_7d');
  assert.equal(stale[0].prediction, 'n_7d >= 4 within 168 h', 'seven days over the rhythm of two');
  assert.match(stale[0].why, /nothing new for 200 h against 2 d declared/);
  assert.equal(plan(measure([e('a', 60)], { now: NOW }), { expect_days: 2 })[0].kind, 'generate', 'aging also asks for entries');
  assert.equal(plan(measure([e('a', 200)], { now: NOW, expect_days: 7 }), { expect_days: 7 }).length, 1);
  assert.equal(plan(measure([e('a', 400)], { now: NOW, expect_days: 7 }), { expect_days: 7 })[0].prediction, 'n_7d >= 1 within 168 h', 'never fewer than one');
  const thin = plan(measure([e('a', 1, { depth: 1 }), e('b', 2, { depth: 0 })], { now: NOW }));
  assert.deepEqual(thin.map(a => [a.kind, a.metric, a.prediction]), [['deepen', 'thin_share', 'thin_share <= 0.5 within 168 h']]);
  const narrow = plan(measure([e('a', 1), e('b', 2), e('c', 3), e('g', 3), e('d', 4, { domain: 'water' }), e('f', 5, { domain: 'energy' })], { now: NOW, domains: [...doms, 'food'] }), {});
  assert.deepEqual(narrow.map(a => [a.kind, a.domain, a.metric, a.prediction]), [['diversify', 'food', 'top_share', 'top_share <= 0.6 within 336 h']]);
  const gap = plan(measure([e('a', 1), e('b', 2, { domain: 'water' })], { now: NOW, domains: [...doms, 'food'] }));
  assert.equal(gap[0].kind, 'diversify', 'a fresh system with an uncovered domain still diversifies');
  assert.match(gap[0].why, /no entry in food for 30 d/);
  assert.deepEqual(plan(measure([e('a', 1), e('b', 2, { domain: 'water' })], { now: NOW, domains: doms })), []);
  for (const a of [...stale, ...thin, ...narrow, ...gap]) assert.match(a.prediction, /^[a-z_0-9]+ (>=|<=) [\d.]+ within \d+ h$/);
});

test('US-29-R45: the series keeps one row a UTC day, upserts today\'s row and keeps 400 days, and a trend compares the mean of two windows', () => {
  const m = measure([e('a', 1)], { now: NOW, domains: ['health', 'water'] });
  const one = record([], m, { now: NOW });
  assert.deepEqual(Object.keys(one[0]), ['day', 'state', 'score', 'n_7d', 'n_30d', 'coverage', 'thin_share', 'even', 'return_rate']);
  assert.equal(one[0].day, '2026-11-22'); assert.equal(one[0].coverage, 0.5);
  assert.equal(record(one, { ...m, state: 'stale' }, { now: NOW + 3600e3 }).length, 1, 'the same day is replaced');
  assert.equal(record(one, { ...m, state: 'stale' }, { now: NOW + 3600e3 })[0].state, 'stale');
  let s = []; for (let d = 0; d < 410; d++) s = record(s, m, { now: NOW + d * D });
  assert.equal(s.length, 400); assert.equal(s[0].day, new Date(NOW + 10 * D).toISOString().slice(0, 10), 'the oldest days go first');
  assert.ok(s.every((r, i) => !i || s[i - 1].day < r.day), 'sorted oldest first');
  const row = (daysAgo, score) => ({ day: new Date(NOW - daysAgo * D).toISOString().slice(0, 10), score });
  const series = [row(12, 0.2), row(10, 0.2), row(5, 0.6), row(1, 0.6)];
  assert.deepEqual(trend(series, 'score', { now: NOW }), { direction: 'rising', recent: 0.6, before: 0.2 });
  assert.equal(trend([row(12, 0.6), row(2, 0.2)], 'score', { now: NOW }).direction, 'falling');
  assert.equal(trend([row(12, 0.5), row(2, 0.51)], 'score', { now: NOW }).direction, 'flat', 'inside eps');
  assert.equal(trend([row(2, 0.5)], 'score', { now: NOW }).direction, 'unmeasured', 'one window is not a trend');
  assert.equal(trend([], 'score', { now: NOW }).direction, 'unmeasured');
  assert.equal(trend([row(12, 3), row(2, 3.4)], 'score', { now: NOW, eps: 0.5 }).direction, 'flat', 'eps is the caller\'s');
});

test('US-29-R46: entries leave as RSS 2.0, JSON Feed 1.1 and a what-is-new page, and a JSON Feed reads back into entries', () => {
  const items = [e('a', 5), e('b', 3, { title: 'A <b> & "c"', domain: undefined, kind: undefined, depth: undefined })];
  const rss = toRss({ title: 'T', link: 'https://x', description: 'd', items });
  assert.match(rss, /^<\?xml version="1.0" encoding="UTF-8"\?><rss version="2.0"><channel>/);
  assert.ok(rss.includes('A &lt;b&gt; &amp; &quot;c&quot;') && rss.includes('<category>health</category>') && rss.includes('<guid isPermaLink="false">a</guid>'));
  assert.ok(rss.indexOf('Entry a') > rss.indexOf('A &lt;b&gt;'), 'newest first');
  assert.match(rss, /<pubDate>Sun, 22 Nov 2026 09:00:00 GMT<\/pubDate>/);
  const j = toJsonFeed({ title: 'T', link: 'https://x', description: 'd', feedUrl: 'https://x/feed.json', items });
  assert.equal(j.version, 'https://jsonfeed.org/version/1.1'); assert.equal(j.feed_url, 'https://x/feed.json');
  assert.deepEqual(j.items.map(i => i.id), ['b', 'a']);
  assert.deepEqual(j.items[1].tags, ['health', 'solution']); assert.equal(j.items[1]._depth, 5); assert.deepEqual(j.items[0].tags, []); assert.equal(j.items[0]._depth, null);
  assert.deepEqual(fromJsonFeed(j).map(x => [x.id, x.domain, x.kind, x.depth]), [['b', null, null, null], ['a', 'health', 'solution', 5]]);
  const foreign = fromJsonFeed({ items: [{ url: 'https://f/1', date_published: '2026-11-21T00:00:00Z', title: 't', tags: ['law', 'x'], _depth: 'deep' }, { id: 'k', _domain: 'own', tags: ['law'], _depth: 0 }] });
  assert.deepEqual(foreign.map(x => [x.id, x.domain, x.depth]), [['https://f/1', 'law', null], ['k', 'own', 0]], 'the id falls back to the url, the domain to the first tag, a depth that is not a number to null');
  assert.deepEqual(fromJsonFeed(null), []);
  const many = Array.from({ length: 60 }, (_, i) => e('m' + i, i + 1));
  const html = whatsNew({ title: 'T <x>', link: 'https://x', items: [...many, e('z', 2, { title: '<script>' })] });
  assert.equal((html.match(/<li data-at=/g) || []).length, 50, 'the page lists at most fifty');
  assert.ok(html.includes('What&apos;s new') === false && html.includes('<h1>What\'s new</h1>') && html.includes('id="since"'));
  assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script><'), 'titles are escaped');
  assert.ok(html.includes('rel="alternate" type="application/rss+xml" href="https://x/feed.xml"'));
  const js = html.slice(html.lastIndexOf('<script>'));
  assert.ok(js.includes('localStorage') && !/cookie|fetch\(|XMLHttpRequest/.test(js), 'the reader\'s last visit stays in the reader\'s browser');
});

test('US-29-R47: the social queue holds entries not yet promoted, oldest first, a fixed number a day, in whole sentences inside the limit, with the link and the reveal line', () => {
  const items = [e('a', 5), e('b', 4), e('c', 3), e('d', 2), e('old', 24 * 40), e('nolink', 1, { url: '' })];
  const q = queue(items, { now: NOW, posted: ['a'], max_per_day: 2, reveal: 'Runs on Ultrastable.' });
  assert.deepEqual(q.posts.map(p => p.entry), ['b', 'c', 'd'], 'a promoted entry, an old one and one with no link are not in it');
  assert.deepEqual(q.posts.map(p => p.date), ['2026-11-22', '2026-11-22', '2026-11-23'], 'two a day, starting today');
  assert.deepEqual(q.posts.map(p => p.id), ['sticky:b', 'sticky:c', 'sticky:d']);
  assert.match(q.posts[0].text, /^(New:|Just added:|Worth a read:|Fresh this week:) Entry b\. First point\.\nhttps:\/\/x\/b\nRuns on Ultrastable\.$/);
  assert.equal(q.posts[0].kind, 'entry'); assert.equal(q.posts[0].arm, 'sticky');
  assert.equal(queue(items, { now: NOW, posted: ['a'], max_per_day: 2, reveal: 'Runs on Ultrastable.' }).posts[0].text, q.posts[0].text, 'the wording is a function of the entry');
  assert.deepEqual(queue([e('a', 1), e('b', 2)], { now: NOW, since_days: 1, arm: 'x' }).posts.map(p => p.id), ['x:b', 'x:a']);
  assert.equal(queue([e('a', 1, { title: 'Plain', summary: '' })], { now: NOW, voice: ['Look:'] }).posts[0].text, 'Look: Plain\nhttps://x/a', 'no summary, no reveal, no extra line');
  const long = e('l', 2, { title: 'T'.repeat(60), summary: 'S'.repeat(80) + '.' });
  const fit = queue([long, e('m', 3, { title: 'T'.repeat(300) })], { now: NOW, limit: 130, reveal: 'R' });
  assert.equal(fit.posts.length, 1); assert.ok(fit.posts[0].text.length <= 130); assert.ok(!fit.posts[0].text.includes('S'), 'the sentence is left out whole when it does not fit');
  assert.deepEqual(fit.skipped, ['m'], 'an entry that cannot fit even as a title is counted, not cut');
  assert.equal(queue([e('g', 1, { grade: 'D' })], { now: NOW }).posts[0].grade, 'D');
  for (const p of q.posts) assert.ok(!/#|@|[\u{1F300}-\u{1FAFF}]/u.test(p.text), 'no hashtag, mention or emoji');
  assert.deepEqual(normalize([e('z', 1), e('z', 2)]).length, 1);
});
