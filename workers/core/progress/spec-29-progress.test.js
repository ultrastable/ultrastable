// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-29 (visible progress, content stickiness and substantive change): the requirements of the progress events, digests, cadence, pulse and feed, proved through the public API of core/progress.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PERIODS, normalize, substantive, pulse, digest, cadence, sinceVisit, toAtom, sinceVisitScript } from './index.js';

const NOW = Date.parse('2026-11-20T12:00:00Z'), H = 3600e3;
const ev = (id, hoursAgo, o = {}) => ({ id, at: new Date(NOW - hoursAgo * H).toISOString(), system: 'a', title: 'Add a page', kind: 'change', url: 'https://x/' + id, ...o });

test('US-29-R14: normalize drops events with no readable time, drops a repeated id, writes every time as ISO UTC and sorts newest first', () => {
  const n = normalize([ev('1', 5), { id: '2', at: '2026-11-20T13:00:00+01:00', title: 'zoned' }, { id: '3', at: 'never', title: 'x' }, null, undefined, { id: '4', title: 'no time' }, ev('1', 1, { title: 'second sight of 1' })]);
  assert.deepEqual(n.map(e => e.id), ['2', '1'], 'newest first; the later duplicate of 1 is dropped, the first kept');
  assert.equal(n[0].at, '2026-11-20T12:00:00.000Z', 'the zone is folded into UTC');
  assert.equal(n[1].title, 'Add a page', 'the first event with an id wins');
  assert.deepEqual(normalize(undefined), []);
});

test('US-29-R15: a release and a launch always count, a classified change counts by its diff, and an unclassified change counts unless its title is bookkeeping', () => {
  assert.equal(substantive(ev('1', 1, { kind: 'release', title: 'lane: x [skip ci]' })), true);
  assert.equal(substantive(ev('1', 1, { kind: 'launch', title: 'regen' })), true);
  assert.equal(substantive(ev('1', 1, { substance: 'substantive', title: 'lane: record' })), true, 'the diff outranks the title');
  assert.equal(substantive(ev('1', 1, { substance: 'trivial', title: 'Add a page' })), false);
  assert.equal(substantive(ev('1', 1, { substance: 'record', title: 'Add a page' })), false);
  assert.equal(substantive(ev('1', 1, { substance: 'unknown', title: 'Add a page' })), true, 'unknown falls back to the title');
  assert.equal(substantive(ev('1', 1, { title: 'Add a page' })), true);
  for (const t of ['lane: server-owned loops', 'host-sync - record deployed x', 'hostsync x', 'loop-evidence', 'regen generated files', 'ledger row', 'Evidence', 'record the run', 'writeback', 'write-back', 'branchsweep', 'session close', 'sessions: reap',
    'spinoff: portfolio tick', 'deploy-workers: record x', 'Merge branch main', 'Anything [skip ci]']) assert.equal(substantive(ev('1', 1, { title: t })), false, t);
  assert.equal(substantive(ev('1', 1, { title: 'Recorder: new feature' })), true, 'the keywords are whole words');
});

// The closing probe of a known defect, PLANNED in section 7 (a todo test is recorded as planned, never as proof): the pattern lists `chore\(deps\)` and then
// requires a word boundary, which cannot fall between `)` and `:` or a space, so a dependency-bump title is not read as bookkeeping when its diff has not been
// classified. This test turns green when the pattern is fixed.
test('US-29-R73: a dependency bump title is bookkeeping when its diff has not been classified', { todo: 'core/progress/index.js BOOKKEEPING: `chore\\(deps\\)` is followed by \\b' }, () => {
  assert.equal(substantive(ev('1', 1, { title: 'chore(deps): bump y' })), false);
});

test('US-29-R16: a digest covers the period ending now, counts by system and kind, and lists substantive events before record-keeping ones', () => {
  assert.deepEqual(PERIODS, { daily: 24, weekly: 168, monthly: 720 });
  const es = [ev('1', 2), ev('2', 3, { title: 'lane: x [skip ci]' }), ev('3', 30), ev('4', 4, { kind: 'release', system: 'b', title: 'Release 1' }), ev('5', -2)];
  const d = digest(es, { now: NOW, period: 'daily' });
  assert.equal(d.count, 3, 'older than a day and later than now are out');
  assert.equal(d.substantive, 2);
  assert.deepEqual(d.by_system, { a: 2, b: 1 });
  assert.deepEqual(d.by_kind, { change: 2, release: 1 });
  assert.deepEqual(d.items.map(e => e.id), ['1', '4', '2'], 'the bookkeeping merge is last');
  assert.equal(d.to, new Date(NOW).toISOString());
  assert.equal(d.from, new Date(NOW - 24 * H).toISOString());
  assert.equal(digest(es, { now: NOW, period: 'weekly' }).count, 4);
  assert.throws(() => digest(es, { period: 'hourly' }), /unknown period hourly/);
});

test('US-29-R17: cadence is moving inside the declared interval, slow inside stall intervals, stalled beyond, and unmeasured with no substantive event, never moving', () => {
  assert.deepEqual(cadence([], { now: NOW }), { state: 'unmeasured', last_at: null, hours_since: null, expect_hours: 24, shipped_24h: 0, shipped_7d: 0 });
  assert.equal(cadence([ev('1', 1, { title: 'host-sync - record x' })], { now: NOW }).state, 'unmeasured', 'bookkeeping alone is not a reading');
  assert.equal(cadence([ev('1', 1, { substance: 'trivial' })], { now: NOW }).state, 'unmeasured', 'a trivial change alone is not a reading');
  assert.equal(cadence([ev('1', 24)], { now: NOW, expect_hours: 24 }).state, 'moving', 'exactly the interval is still moving');
  assert.equal(cadence([ev('1', 24.1)], { now: NOW, expect_hours: 24 }).state, 'slow');
  assert.equal(cadence([ev('1', 48)], { now: NOW, expect_hours: 24 }).state, 'slow', 'exactly stall times the interval is still slow');
  assert.equal(cadence([ev('1', 49)], { now: NOW, expect_hours: 24 }).state, 'stalled');
  assert.equal(cadence([ev('1', 49)], { now: NOW, expect_hours: 24, stall: 3 }).state, 'slow', 'the stall factor is the caller\'s');
  const c = cadence([ev('1', 60), ev('2', 1, { title: 'regen generated files' }), ev('3', 30), ev('4', 100, { substance: 'trivial' })], { now: NOW, expect_hours: 24 });
  assert.equal(c.state, 'slow', 'thirty hours since the newest substantive event, with a 24 h interval and a stall factor of 2'); assert.equal(c.hours_since, 30); assert.equal(c.last_at, ev('3', 30).at);
  assert.equal(c.shipped_24h, 0); assert.equal(c.shipped_7d, 2, 'only substantive events are counted');
  assert.equal(cadence([ev('1', 3)], { now: NOW }).hours_since, 3);
});

test('US-29-R18: the pulse says shipping, sessions-only, trivial-only or stalled, from what the system itself merged inside max_hours', () => {
  const e = (id, h, by, substance) => ev(id, h, { by, substance });
  assert.equal(pulse([e('1', 3, 'bot', 'substantive')], { now: NOW }).state, 'shipping');
  assert.equal(pulse([e('1', 3, 'unattended executor', 'substantive')], { now: NOW }).state, 'shipping');
  assert.equal(pulse([e('1', 2, 'unattended executor', 'trivial'), e('2', 5, 'agent session', 'substantive'), e('3', 80, 'unattended executor', 'substantive')], { now: NOW }).state, 'sessions-only');
  assert.equal(pulse([e('1', 2, 'unattended executor', 'trivial')], { now: NOW }).state, 'trivial-only');
  assert.equal(pulse([e('1', 2, 'agent session', 'trivial')], { now: NOW }).state, 'trivial-only', 'any merge inside the window keeps it from stalling');
  assert.equal(pulse([e('1', 90, 'bot', 'substantive')], { now: NOW }).state, 'stalled');
  assert.equal(pulse([], { now: NOW }).state, 'stalled');
  assert.equal(pulse([e('1', 90, 'bot', 'substantive')], { now: NOW, max_hours: 100 }).state, 'shipping', 'max_hours is the caller\'s');
  const p = pulse([e('1', 2, 'bot', 'trivial'), e('2', 5, 'agent session', 'substantive'), e('3', 6, 'bot', 'record'), e('4', 7, 'bot'), ev('5', 8, { kind: 'release' }), e('6', 24 * 9, 'bot', 'substantive')], { now: NOW });
  assert.deepEqual(p.week, { merged: 4, substantive: 2, not_substantive: 2, by_system: 3, substantive_by_system: 1, trivial: 1, record: 1, unclassified: 1 }, 'releases are not merges; a change older than the window is outside it');
  assert.equal(p.last_substantive.by, 'agent session'); assert.equal(p.last_substantive_by_system.hours_ago, 7, 'an unclassified change counts by its title');
  assert.equal(p.last_merge.hours_ago, 2);
  assert.equal(p.max_hours, 48); assert.equal(p.window_days, 7);
  assert.equal(p.classes.trivial, 1); assert.equal(p.classes.record, 1); assert.equal(p.classes['substantive?'], 1);
});

// A browser with just enough of document and localStorage to run the script.
function visit(script, { stored = null, key = 'us-last-visit', marks = [], throwing = false } = {}) {
  const store = {}; if (stored) store[key] = JSON.stringify(stored);
  const els = marks.map(at => ({ at, cls: [], getAttribute: () => at, classList: { add(c) { els.find(x => x.at === at && !x.cls.includes(c)).cls.push(c); } } }));
  const out = { textContent: '' }, writes = [];
  const document = { querySelectorAll: sel => (sel === '[data-at]' ? els : []), getElementById: id => (id === 'since' ? out : null) };
  const localStorage = throwing ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { writes.push(k); store[k] = v; } };
  new Function('document', 'localStorage', script)(document, localStorage);
  return { els, out: out.textContent, store, writes };
}

test('US-29-R19: a reader\'s last visit lives only in the reader\'s browser storage, marks what is newer, and survives a reload inside the grace period', () => {
  assert.deepEqual(sinceVisit([ev('1', 1), ev('2', 10)], new Date(NOW - 5 * H).toISOString()).map(e => e.id), ['1']);
  assert.deepEqual(sinceVisit([ev('1', 1)], null), [], 'a reader with no stored time sees nothing marked');
  assert.deepEqual(sinceVisit([ev('1', 1)], 'garbage'), []);
  const s = sinceVisitScript({ key: 'k' });
  assert.doesNotMatch(s, /cookie|fetch\(|XMLHttpRequest|sendBeacon/, 'nothing leaves the browser');
  const now = Date.now(), old = new Date(now - 3 * 864e5).toISOString(), fresh = new Date(now - 1000).toISOString();
  const first = visit(s, { key: 'k', marks: [fresh] });
  assert.deepEqual(first.els[0].cls, [], 'a first visit marks nothing');
  assert.match(first.out, /first visit on this device/);
  const stored = JSON.parse(first.store.k); assert.equal(stored.prev, 0); assert.ok(Math.abs(stored.last - now) < 5000);
  assert.deepEqual(first.writes, ['k'], 'one key is written');
  const later = visit(s, { key: 'k', stored: { prev: 0, last: now - 3 * H }, marks: [old, fresh] });
  assert.deepEqual(later.els.map(e => e.cls), [[], ['is-new']], 'only the element newer than the previous visit is marked');
  assert.match(later.out, /^1 shipped since your last visit on /);
  assert.equal(JSON.parse(later.store.k).prev, now - 3 * H, 'the last visit becomes the previous one');
  const reload = visit(s, { key: 'k', stored: { prev: now - 9 * H, last: now - 2 * 60e3 }, marks: [new Date(now - 5 * H).toISOString()] });
  assert.deepEqual(reload.els[0].cls, ['is-new'], 'a reload within 30 minutes keeps the earlier previous visit, so the marks stay');
  assert.equal(JSON.parse(reload.store.k).prev, now - 9 * H);
  const none = visit(s, { key: 'k', stored: { prev: 0, last: now - 3 * H }, marks: [old] });
  assert.match(none.out, /^Nothing new has shipped since your last visit/);
  assert.doesNotThrow(() => visit(s, { key: 'k', throwing: true }), 'a browser that blocks storage does not break the page');
  assert.ok(sinceVisitScript({ key: 'k2', into: 'x', graceMin: 5 }).includes('"k2"'));
});

test('US-29-R20: the Atom feed escapes every field, names each entry by its system, dates itself by its newest entry and links a hub only when given one', () => {
  const x = toAtom({ title: 'T <&>', link: 'https://x', feedUrl: 'https://x/progress.atom', items: [ev('1', 1, { title: 'a <b> & c', system_name: 'Alpha' }), ev('2', 5, { url: null, kind: 'release' })] });
  assert.match(x, /<title>T &lt;&amp;&gt;<\/title>/);
  assert.match(x, /<id>https:\/\/x\/progress\.atom#1<\/id>/);
  assert.match(x, /<title>Alpha: a &lt;b&gt; &amp; c<\/title>/);
  assert.match(x, /<title>a: Add a page<\/title>/, 'the system id stands in when there is no name');
  assert.match(x, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom"><id>https:\/\/x\/progress\.atom<\/id>.*<updated>2026-11-20T11:00:00\.000Z<\/updated>/, 'the feed is as new as its newest entry');
  assert.match(x, /<link href="https:\/\/x"\/><category term="release"\/>/, 'an entry with no url links to the feed\'s page');
  assert.doesNotMatch(x, /rel="hub"/);
  assert.match(toAtom({ title: 't', link: 'l', feedUrl: 'f', items: [], hub: 'https://hub.example/' }), /<updated>1970-01-01T00:00:00\.000Z<\/updated><link rel="self" href="f"\/><link rel="hub" href="https:\/\/hub\.example\/"\/>/);
});

test('US-29-T05: a reader who comes back is shown only what shipped since the last visit, a first visit marks nothing, and a bookkeeping merge is listed last and counted for nothing', () => {
  const es = [ev('new', 1), ev('book', 2, { title: 'lane: record [skip ci]' }), ev('mid', 6), ev('old', 30)];
  const d = digest(es, { now: NOW, period: 'daily' });
  assert.deepEqual(d.items.map(e => e.id), ['new', 'mid', 'book']);
  assert.equal(d.substantive, 2);
  const now = Date.now(), marks = [new Date(now - 1000).toISOString(), new Date(now - 8 * H).toISOString()];
  const first = visit(sinceVisitScript(), { marks });
  assert.deepEqual(first.els.map(e => e.cls), [[], []]);
  const back = visit(sinceVisitScript(), { stored: { prev: 0, last: now - 5 * H }, marks });
  assert.deepEqual(back.els.map(e => e.cls), [['is-new'], []], 'only the item newer than the last visit');
  assert.deepEqual(sinceVisit(es, new Date(NOW - 3 * H).toISOString()).map(e => e.id), ['new', 'book']);
});
