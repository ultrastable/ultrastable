// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, plan, record, trend, toRss, toJsonFeed, fromJsonFeed, whatsNew, queue } from './index.js';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const e = (id, hAgo, o = {}) => ({ id, at: new Date(NOW - hAgo * 3600e3).toISOString(), title: 'Entry ' + id, url: 'https://x/' + id, summary: 'First point. Second point.', domain: 'health', kind: 'solution', depth: 5, ...o });

test('no entries is unmeasured, never fresh', () => {
  const m = measure([], { now: NOW });
  assert.equal(m.state, 'unmeasured'); assert.equal(m.score, null);
  assert.equal(plan(m)[0].kind, 'generate');
});

test('fresh, aging and stale follow the declared rhythm', () => {
  assert.equal(measure([e('a', 10)], { now: NOW, expect_days: 2 }).state, 'fresh');
  assert.equal(measure([e('a', 60)], { now: NOW, expect_days: 2 }).state, 'aging');
  assert.equal(measure([e('a', 120)], { now: NOW, expect_days: 2 }).state, 'stale');
});

test('breadth, thin depth and one-domain dominance are named, and each gets an action with a prediction', () => {
  const doms = ['health', 'water', 'energy', 'food'];
  const narrow = measure([e('a', 1), e('b', 2), e('c', 3), e('g', 3), e('d', 4, { domain: 'water' }), e('f', 5, { domain: 'energy' })], { now: NOW, domains: doms });
  assert.equal(narrow.state, 'narrow'); assert.deepEqual(narrow.breadth.uncovered, ['food']);
  const acts = plan(narrow, { domains: doms });
  assert.equal(acts[0].kind, 'diversify'); assert.equal(acts[0].domain, 'food'); assert.match(acts[0].prediction, /within \d+ h$/);
  const thin = measure([e('a', 1, { depth: 1 }), e('b', 2, { depth: 0 })], { now: NOW });
  assert.equal(thin.state, 'thin'); assert.equal(plan(thin)[0].kind, 'deepen');
  const stale = measure([e('a', 200, { domain: 'health' })], { now: NOW, domains: doms });
  assert.equal(plan(stale, { domains: doms })[0].domain, 'water');
});

test('a missing audience count is unmeasured, not zero or good', () => {
  assert.equal(measure([e('a', 1)], { now: NOW }).audience.return_rate, null);
  assert.equal(measure([e('a', 1)], { now: NOW, audience: { visits_7d: 200, returning_7d: 50 } }).audience.return_rate, 0.25);
});

test('the daily series upserts one row a day and the trend compares windows', () => {
  let s = [];
  for (let d = 14; d >= 0; d--) { const now = NOW - d * 864e5; s = record(s, measure([e('a', 1)].map(x => ({ ...x, at: new Date(now - 36e5).toISOString() })), { now }), { now }); }
  assert.equal(s.length, 15); assert.equal(record(s, measure([e('a', 1)], { now: NOW }), { now: NOW }).length, 15);
  assert.equal(trend(s, 'score', { now: NOW }).direction, 'flat');
  assert.equal(trend([], 'score', { now: NOW }).direction, 'unmeasured');
});

test('feeds round-trip and escape; the what-is-new page marks entries by time', () => {
  const items = [e('a', 5), e('b', 3, { title: 'A <b> & "c"' })];
  const rss = toRss({ title: 'T', link: 'https://x', description: 'd', items });
  assert.ok(rss.includes('&lt;b&gt;') && rss.includes('<category>health</category>'));
  const back = fromJsonFeed(toJsonFeed({ title: 'T', link: 'https://x', description: 'd', feedUrl: 'https://x/feed.json', items }));
  assert.deepEqual(back.map(x => [x.id, x.domain, x.depth]), [['b', 'health', 5], ['a', 'health', 5]]);
  const html = whatsNew({ title: 'T', link: 'https://x', items });
  assert.ok(html.includes('data-at=') && html.includes('localStorage'));
});

test('the social queue skips promoted entries, caps per day, stays inside the limit and carries the reveal', () => {
  const items = [e('a', 5), e('b', 4), e('c', 3), e('old', 24 * 40)];
  const q = queue(items, { now: NOW, posted: ['sticky:a'].map(x => x.slice(7)), max_per_day: 1, reveal: 'Runs on Ultrastable.', limit: 120 });
  assert.deepEqual(q.posts.map(p => p.entry), ['b', 'c']);
  assert.deepEqual(q.posts.map(p => p.date), ['2026-11-22', '2026-11-23']);
  for (const p of q.posts) { assert.ok(p.text.length <= 140); assert.ok(p.text.endsWith('Runs on Ultrastable.')); assert.ok(!/#|[\u{1F300}-\u{1FAFF}]/u.test(p.text)); }
});

test('a post is never cut mid-sentence: whole sentence, else the title alone, else the entry is left out and counted', () => {
  const long = e('l', 2, { title: 'T'.repeat(60), summary: 'S'.repeat(80) + '.' });
  const q = queue([long, e('m', 3, { title: 'T'.repeat(300) })], { now: NOW, limit: 130, reveal: 'R' });
  assert.equal(q.posts.length, 1); assert.ok(!q.posts[0].text.includes('SSS')); assert.ok(!q.posts[0].text.includes('…'));
  assert.deepEqual(q.skipped, ['m']);
});

test('visits without a returning count give no return rate', () => {
  assert.equal(measure([e('a', 1)], { now: NOW, audience: { visits_7d: 200 } }).audience.return_rate, null);
});
