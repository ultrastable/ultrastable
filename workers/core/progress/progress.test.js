// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, digest, cadence, sinceVisit, toAtom, sinceVisitScript, substantive } from './index.js';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const ev = (id, hoursAgo, title = 'Add a page', kind = 'change', system = 'a') => ({ id, at: new Date(NOW - hoursAgo * 3600e3).toISOString(), system, title, kind, url: 'https://x/' + id });

test('normalize sorts newest first and drops undated and duplicate events', () => {
  const n = normalize([ev('1', 5), ev('2', 1), { id: '3', at: 'never', title: 'x' }, ev('2', 1)]);
  assert.deepEqual(n.map(e => e.id), ['2', '1']);
});

test('digest counts only events inside the period and lists substantive changes first', () => {
  const d = digest([ev('1', 2), ev('2', 3, 'lane: server-owned loops [skip ci]'), ev('3', 30), ev('4', 4, 'Release 2026.11.20', 'release', 'b')], { now: NOW, period: 'daily' });
  assert.equal(d.count, 3);
  assert.equal(d.substantive, 2);
  assert.deepEqual(d.by_system, { a: 2, b: 1 });
  assert.equal(d.items[d.items.length - 1].id, '2');
  assert.equal(digest([ev('3', 30)], { now: NOW, period: 'weekly' }).count, 1);
  assert.throws(() => digest([], { period: 'hourly' }));
});

test('cadence: bookkeeping merges never count as progress, and no event is unmeasured, never moving', () => {
  assert.equal(cadence([], { now: NOW }).state, 'unmeasured');
  assert.equal(cadence([ev('1', 1, 'host-sync - record deployed tenant-ps-web')], { now: NOW }).state, 'unmeasured');
  assert.equal(cadence([ev('1', 3)], { now: NOW, expect_hours: 24 }).state, 'moving');
  assert.equal(cadence([ev('1', 30)], { now: NOW, expect_hours: 24 }).state, 'slow');
  const c = cadence([ev('1', 60), ev('2', 1, 'regen generated files')], { now: NOW, expect_hours: 24 });
  assert.equal(c.state, 'stalled');
  assert.equal(c.hours_since, 60);
  assert.equal(substantive(ev('9', 1, 'Release', 'launch')), true);
});

test('sinceVisit returns only events after the reader\'s stored time', () => {
  const es = [ev('1', 1), ev('2', 10)];
  assert.deepEqual(sinceVisit(es, new Date(NOW - 5 * 3600e3).toISOString()).map(e => e.id), ['1']);
  assert.deepEqual(sinceVisit(es, null), []);
});

test('atom feed escapes titles and the visit script stores nothing but two times', () => {
  const x = toAtom({ title: 'T', link: 'https://x', feedUrl: 'https://x/progress.atom', items: [ev('1', 1, 'a <b> & c')] });
  assert.match(x, /a &lt;b&gt; &amp; c/);
  assert.match(x, /<updated>2026-11-20T11:00:00.000Z<\/updated>/);
  const s = sinceVisitScript({ key: 'k' });
  assert.match(s, /localStorage/);
  assert.doesNotMatch(s, /cookie|fetch\(|XMLHttpRequest/);
  new Function('document', 'localStorage', s);  // parses
});
