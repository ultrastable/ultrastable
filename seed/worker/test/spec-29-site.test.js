// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-29 (visible progress, content stickiness and substantive change): the public pages of the platform site (site/progress.js, site/feed.js, site/live.js,
// site/intentyield.js), proved through their exported functions. They are platform files, not seed files, so a standalone seed checkout skips this file by name
// and says so; in the monorepo nothing is skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const SITE = new URL('../../../site/', import.meta.url);
const mono = existsSync(new URL('progress.js', SITE)) && existsSync(new URL('feed.js', SITE)) && existsSync(new URL('live.js', SITE));
const skip = mono ? false : 'the platform site/ is not beside this checkout (a standalone seed)';
const P = mono ? await import(new URL('progress.js', SITE)) : {};
const F = mono ? await import(new URL('feed.js', SITE)) : {};
const L = mono ? await import(new URL('live.js', SITE)) : {};
const Y = mono ? await import(new URL('intentyield.js', SITE)) : {};
const FD = mono ? await import(new URL('feed-data.js', SITE)) : {};

const NOW = Date.parse('2026-11-20T12:00:00Z'), H = 3600e3;
const at = h => new Date(NOW - h * H).toISOString();
const shell = (meta, body) => `<title>${meta.title}</title><meta path="${meta.path}">${body}`;
const HTML = { 'Content-Type': 'text/html' };
const ev = (id, h, o = {}) => ({ id, at: at(h), system: 'core', system_name: 'Core', title: 'Add ' + id, url: 'https://gh/' + id, kind: 'change', ...o });
const baseOf = (events, o = {}) => ({ checked_at: at(0), pulse: null, systems: [
  { id: 'core', name: 'Core', url: 'https://core.example', feed: 'https://core.example/feed.xml', state: 'moving', last_at: at(2), shipped_24h: 1, shipped_7d: 1 },
  { id: 'tenant', name: 'Tenant', url: 'https://tenant.example', releases: 'https://tenant.example/releases.json', state: 'stalled', last_at: at(80), shipped_24h: 0, shipped_7d: 0 }], events, ...o });
const tick = base => ({ fetch: async r => (new URL(r.url).pathname === '/api/progress' ? Response.json(base) : new Response('no', { status: 404 })) });
const get = (path, env, opts = {}) => P.progressRoutes(new URL('https://ultrastable.io' + path), env, shell, HTML, 'ultrastable.io', { now: NOW, ...opts });

test('US-29-R32: the progress routes answer /progress, /progress.json, /progress.atom, /pulse.json and the three digests, nothing else, and answer 503 with a code when the live record cannot be read', { skip }, async () => {
  const env = { TICK: tick(baseOf([ev('1', 2)])) };
  for (const p of ['/progress', '/progress/', '/progress.json', '/progress.atom', '/pulse.json', '/digest/daily', '/digest/weekly', '/digest/monthly', '/digest/daily.json', '/digest/weekly.json', '/digest/monthly.json']) assert.ok(await get(p, env), p);
  for (const p of ['/', '/digest/hourly', '/digest', '/digest/daily.xml', '/progresses', '/feed.xml']) assert.equal(await get(p, env), null, p);
  const j = await get('/progress.json', env);
  assert.equal(j.status, 200); assert.equal(j.headers.get('Access-Control-Allow-Origin'), '*'); assert.equal(j.headers.get('Cache-Control'), 'public, max-age=60');
  const body = await j.json(); assert.equal(body.marker, 'PROGRESS-1'); assert.deepEqual(Object.keys(body.digests), ['daily', 'weekly', 'monthly']);
  const down = { TICK: { fetch: async () => new Response('x', { status: 500 }) } };
  for (const env2 of [down, {}, { TICK: { fetch: async () => { throw new Error('unreachable'); } } }, { TICK: tick({ systems: 'no' }) }]) {
    const a = await get('/progress.json', env2); assert.equal(a.status, 503); assert.deepEqual(await a.json(), { error: 'progress unavailable', code: 'progress_unavailable' });
    assert.equal((await get('/digest/daily.json', env2)).status, 503);
    const t = await get('/progress.atom', env2); assert.equal(t.status, 503); assert.equal(t.headers.get('retry-after'), '60'); assert.equal(await t.text(), 'progress unavailable');
    const page = await get('/progress', env2); assert.equal(page.status, 503); assert.match(await page.text(), /The live record could not be read just now/);
    assert.equal((await get('/pulse.json', env2)).status, 503);
  }
  assert.deepEqual(await (await get('/pulse.json', {})).json(), { error: 'pulse unavailable', code: 'pulse_unavailable' });
});

test('US-29-R33: the record joins merged changes with each tenant\'s own published releases and the launched apps, and an unreadable source adds nothing and is named', { skip }, async () => {
  const rel = { releases: [{ version: '2026.11.20', date: at(5).slice(0, 10), counts: { solutions: 4, problems: 2, syntheses: 1, insights: 3, zero: 0 } }, { version: '2026.11.19', date: at(30), counts: {} }, { version: 'bad', date: 'soon' }, { date: '2026-11-19' }] };
  const spin = { live: [{ slug: 'a', name: 'A', tagline: 't', url: 'https://a.example', launched: at(30) }, { slug: 'b', name: 'B' }] };
  const seen = [];
  const d = await P.progressData({ TICK: tick(baseOf([ev('1', 2)], { pulse: { state: 'shipping' } })) }, { fetchImpl: async (u, o) => { seen.push(u); return Response.json(rel); }, now: NOW, spin });
  assert.deepEqual(seen, ['https://tenant.example/releases.json'], 'only a system that declares a release feed is read');
  const releases = d.events.filter(e => e.kind === 'release');
  assert.deepEqual(releases.map(e => e.title).sort(), ['Release 2026.11.19', 'Release 2026.11.20: 2 new problems, 4 new solutions, 1 new combinations, 3 new red-team findings'].sort());
  assert.ok(releases.every(e => e.system === 'tenant' && e.url.startsWith('https://tenant.example/releases#r-')));
  assert.ok(releases.find(e => e.title.startsWith('Release 2026.11.20')).at.startsWith(at(5).slice(0, 10) + 'T00:00:00'), 'a release dated by day is placed at the start of that day');
  const launch = d.events.filter(e => e.kind === 'launch');
  assert.deepEqual(launch.map(e => [e.id, e.system, e.title, e.url]), [['apps#a', 'apps', 'Launched A: t', 'https://a.example']], 'an app with no launch time is not an event');
  assert.deepEqual(d.sources['releases:tenant'], { ok: true, why: null, count: 2 }); assert.equal(d.sources.changes.ok, true);
  assert.equal(d.pulse.state, 'shipping'); assert.equal(d.marker, 'PROGRESS-1'); assert.equal(d.at, new Date(NOW).toISOString());
  assert.deepEqual(Object.keys(d.digests.daily), ['from', 'to', 'count', 'substantive', 'substantive_changes', 'by_system', 'by_kind']);
  assert.ok(d.events.every((e, i) => !i || d.events[i - 1].at >= e.at), 'newest first');
  const bad = await P.progressData({ TICK: tick(baseOf([ev('1', 2)])) }, { fetchImpl: async () => new Response('x', { status: 500 }), now: NOW, spin: { live: [] } });
  assert.deepEqual(bad.sources['releases:tenant'], { ok: false, why: 'HTTP 500', count: 0 }); assert.equal(bad.events.filter(e => e.kind === 'release').length, 0);
  const boom = await P.progressData({ TICK: tick(baseOf([])) }, { fetchImpl: async () => { throw new Error('refused'); }, now: NOW, spin: { live: [] } });
  assert.deepEqual(boom.sources['releases:tenant'], { ok: false, why: 'refused', count: 0 });
  const a = P.appsBlock([{ launched: at(30) }, { launched: at(10) }], null, NOW, [{ kind: 'tenant', id: 't1', name: 'T1', url: 'https://t1' }, { kind: 'platform', id: 'p' }, null]);
  assert.deepEqual([a.live, a.tenants_live, a.tenants, a.newest, a.as_of], [2, 1, [{ id: 't1', name: 'T1', url: 'https://t1' }], at(10), new Date(NOW).toISOString()], 'launched apps are counted, the live tenants come from the directory module and not from a snapshot that stopped');
});

test('US-29-R34: the page lists substantive changes first, counts record-keeping merges apart, marks nothing as new on the server and keeps the reader\'s last visit in the reader\'s browser', { skip }, async () => {
  const events = [ev('real <one>', 2, { title: 'Add <progress> page' }), ev('book', 3, { title: 'lane: server-owned loops [skip ci]' }), ev('trivial', 4, { substance: 'trivial' }), ev('old', 24 * 3, { title: 'Three days ago' })];
  const d = await P.progressData({ TICK: tick(baseOf(events)) }, { fetchImpl: async () => Response.json({ releases: [] }), now: NOW, spin: { live: [] } });
  const t = await (await get('/progress', { TICK: tick(baseOf(events)) }, { fetchImpl: async () => Response.json({ releases: [] }), spin: { live: [] } })).text();
  assert.match(t, /<title>Progress - Ultrastable<\/title>/);
  assert.match(t, /Add &lt;progress&gt; page/); assert.doesNotMatch(t, /Add <progress> page/, 'titles are escaped');
  assert.match(t, /Plus 2 record-keeping merges \(ledgers, deploy records, regenerated files\), which are not counted as progress/, 'the bookkeeping title and the trivial diff are both set apart');
  assert.ok(t.indexOf('Add &lt;progress&gt; page') < t.indexOf('Three days ago'), 'newest first');
  assert.match(t, /data-at="/); assert.doesNotMatch(t, /class="[^"]*is-new/, 'only the reader\'s own browser marks an item as new');
  assert.match(t, /us-progress-visit/); assert.match(t, /localStorage/); assert.doesNotMatch(t, /document\.cookie|sendBeacon/);
  assert.match(t, /Your last visit is kept only in this browser and is never sent anywhere/);
  assert.match(t, /Stalled; a repair item is open/); assert.match(t, /Shipping/);
  assert.match(t, /Read at 2026-11-20 12:00 UTC/);
  const week = await (await get('/digest/weekly', { TICK: tick(baseOf(events)) }, { fetchImpl: async () => Response.json({ releases: [] }), spin: { live: [] } })).text();
  assert.match(week, /<title>Weekly digest - Ultrastable<\/title>/); assert.match(week, /<meta path="\/digest\/weekly">/); assert.match(week, /All systems and periods/); assert.doesNotMatch(week, /id="pulse"/, 'a digest page is one period');
  assert.doesNotMatch(week, /id="daily"/);
  assert.match(t, /id="pulse"/, 'the main page opens with the pulse');
  const many = Array.from({ length: 45 }, (_, i) => ev('m' + i, 1 + i / 100));
  const dd = P.progressPage(shell, await P.progressData({ TICK: tick(baseOf(many)) }, { fetchImpl: async () => Response.json({ releases: [] }), now: NOW, spin: { live: [] } }), { now: NOW, period: 'daily' });
  assert.match(dd, /5 more in this period are in <a href="\/progress\.json">the full list<\/a>/, 'a list cut at 40 says how many it left out');
  assert.match(P.progressPage(shell, null, { now: NOW }), /The live record could not be read just now/);
  assert.match(P.progressPage(shell, { ...d, events: [] }, { now: NOW }), /Nothing shipped in this period\./);
});

test('US-29-R35: the pulse card says in plain words whether the system itself is shipping, and /pulse.json answers 503 when it is stalled so an outside probe can alarm', { skip }, async () => {
  const week = { merged: 9, substantive: 2, substantive_by_system: 1, trivial: 4, record: 3, unclassified: 1 };
  const card = state => P.pulseCard({ state, max_hours: 48, window_days: 7, last_substantive: { at: at(3), title: 'Fix <x>', url: 'https://gh/1' }, last_substantive_by_system: null, last_merge: { at: at(1) }, week }, NOW);
  assert.match(card('shipping'), /<p class="ok"><strong>Shipping real code on its own<\/strong>/);
  assert.match(card('sessions-only'), /class="warn"><strong>Real code is coming only from agent sessions/);
  assert.match(card('trivial-only'), /Only trivial or record-keeping changes; nothing that changes how it runs/);
  assert.match(card('stalled'), /Stalled: nothing merged recently/);
  assert.match(card('anything else'), /Stalled/, 'an unknown state is read as the worst');
  const c = card('shipping');
  assert.match(c, /Last change the system made itself that altered how it runs: <strong>none in the window<\/strong>/);
  assert.match(c, /<a href="https:\/\/gh\/1" rel="noopener">Fix &lt;x&gt;<\/a> <small>3 h ago<\/small>/);
  assert.match(c, /Last 7 days: 9 merges, 2 changed behaviour \(1 by the system itself\), 4 trivial \(numbers, hashes, comments, imports\) and 3 record-keeping, which are not counted as progress; 1 not classified yet\./);
  assert.match(c, /goes 48 hours without a change that alters behaviour, its producers are restarted and a repair item is opened/);
  assert.match(P.pulseCard(null), /could not be read/);
  const status = async state => { const r = await get('/pulse.json', { TICK: tick(baseOf([], { pulse: { state, max_hours: 48 } })) }); return [r.status, await r.json()]; };
  for (const s of ['shipping', 'sessions-only', 'trivial-only']) assert.equal((await status(s))[0], 200, s);
  const [code, body] = await status('stalled');
  assert.equal(code, 503); assert.equal(body.marker, 'SUBSTANCE-1'); assert.equal(body.state, 'stalled'); assert.equal(body.at, new Date(NOW).toISOString());
});

test('US-29-R36: the Atom feed lists at most one hundred substantive events, newest first, and leaves record-keeping merges out', { skip }, async () => {
  const many = [...Array.from({ length: 120 }, (_, i) => ev('s' + i, 1 + i / 10)), ev('book', 0.5, { title: 'regen generated files' }), ev('triv', 0.4, { substance: 'trivial' })];
  const r = await get('/progress.atom', { TICK: tick(baseOf(many)) }, { fetchImpl: async () => Response.json({ releases: [] }), spin: { live: [] } });
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /^application\/atom\+xml/); assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  const x = await r.text();
  assert.equal((x.match(/<entry>/g) || []).length, 100);
  assert.ok(x.includes('<id>https://ultrastable.io/progress.atom</id>') && x.includes('rel="hub" href="https://pubsubhubbub.appspot.com/"'));
  assert.doesNotMatch(x, /regen generated files/); assert.ok(!x.includes('Add triv'));
  assert.ok(x.indexOf('Add s0<') < x.indexOf('Add s99<'));
});

test('US-29-R37: the platform feed serves the generated changelog entries as Atom and as JSON Feed 1.1, and a read of either is counted as a feed hit', { skip }, async () => {
  const es = [{ id: 'a', at: '2026-11-25T18:00:00Z', title: 'Newest <thing> & more', summary: 'Shipped.' }, { id: 'b', at: '2026-11-24T18:00:00Z', title: 'Older' }];
  const x = F.atom(es, 'ultrastable.io');
  assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?><feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.ok(x.includes('<id>tag:ultrastable.io,2026:a</id>') && x.includes('Newest &lt;thing&gt; &amp; more') && x.includes('<updated>2026-11-25T18:00:00Z</updated><link rel="self"'));
  assert.ok(x.includes('rel="hub"')); assert.equal((x.match(/<entry>/g) || []).length, 2);
  assert.match(F.atom([], 'h'), /<updated>1970-01-01T00:00:00Z<\/updated>/);
  const a = F.feedResponse('ultrastable.io', es);
  assert.match(a.headers.get('content-type'), /application\/atom\+xml/); assert.equal(a.headers.get('cache-control'), 'public, max-age=900'); assert.equal(a.headers.get('access-control-allow-origin'), '*');
  const j = F.jsonFeedResponse('ultrastable.io', es);
  assert.match(j.headers.get('content-type'), /application\/feed\+json/);
  const body = await j.json();
  assert.equal(body.version, 'https://jsonfeed.org/version/1.1'); assert.equal(body.feed_url, 'https://ultrastable.io/feed.json');
  assert.deepEqual(body.items[0], { id: 'a', url: 'https://ultrastable.io/live', title: 'Newest <thing> & more', content_text: 'Shipped.', date_published: '2026-11-25T18:00:00Z', tags: ['platform'], _domain: 'platform', _kind: 'update' });
  assert.equal(body.items[1].content_text, '', 'an entry with no summary has an empty text, never undefined');
  assert.ok(FD.FEED_ENTRIES.length > 0 && FD.FEED_ENTRIES.every(e => e.id && e.at && e.title), 'the generated entries exist and each is whole');
  const worker = readFileSync(new URL('worker.js', SITE), 'utf8');
  assert.ok(/u\.pathname === "\/feed\.xml" \|\| u\.pathname === "\/feed\.json"/.test(worker) && /name: "feed"/.test(worker), 'site/worker.js records a hit named feed for both feeds');
});

test('US-29-R39: the freshness reading gives each source its cadence, stales a missing or old one, and counts only a merge that altered behaviour against the bundle of pages', { skip }, async () => {
  assert.deepEqual(L.CADENCE_S, { snapshot: 26 * 3600, changes: 30 * 60, pages: 26 * 3600 });
  const iso = h => new Date(NOW - h * H).toISOString();
  const env = (merged, substance = null, refreshed = iso(0.1)) => ({ TICK: { fetch: async r => (new URL(r.url).pathname === '/api/live/changes' ? Response.json({ refreshed_at: refreshed, changes: [{ n: 7, title: 'live', by: 'bot', url: 'u7', merged_at: merged, substance }] }) : new Response('no', { status: 404 })) } });
  const ok = await L.overlay({}, env(iso(0.5)), iso(3), NOW, iso(1));
  assert.deepEqual([ok.freshness.ok, ok.freshness.snapshot.stale, ok.freshness.changes.stale, ok.freshness.pages.stale], [true, false, false, false]);
  assert.equal(ok.freshness.pages.behind_s, 1800, 'the newest merge is half an hour newer than the bundle, far inside 26 hours');
  assert.equal(ok.freshness.checked_at, new Date(NOW).toISOString());
  const behind = await L.overlay({}, env(iso(1)), iso(3), NOW, iso(28));
  assert.equal(behind.freshness.pages.behind_s, 27 * 3600); assert.equal(behind.freshness.pages.stale, true); assert.equal(behind.freshness.ok, false);
  const trivial = await L.overlay({}, env(iso(1), 'trivial'), iso(3), NOW, iso(28));
  assert.equal(trivial.freshness.pages.behind_s, null); assert.equal(trivial.freshness.pages.stale, false, 'a trivial merge never obliges a redeploy');
  assert.equal((await L.overlay({}, env(iso(1), 'record'), iso(3), NOW, iso(28))).freshness.pages.stale, false);
  assert.equal((await L.overlay({}, env(iso(1), 'substantive'), iso(3), NOW, iso(28))).freshness.pages.stale, true);
  assert.equal((await L.overlay({}, env(iso(1)), iso(3), NOW, iso(3))).freshness.pages.stale, false, 'two hours behind is inside the daily data refresh');
  assert.equal((await L.overlay({}, env(iso(1)), iso(3), NOW, null)).freshness.pages.stale, true, 'a bundle with no build time is stale, never assumed fresh');
  assert.equal((await L.overlay({}, env(iso(1), null, iso(0.6)), iso(3), NOW, iso(1))).freshness.changes.stale, true, 'a cache older than thirty minutes is stale');
  assert.equal((await L.overlay({}, env(iso(1)), iso(27), NOW, iso(1))).freshness.snapshot.stale, true, 'a snapshot older than 26 hours is stale');
  const none = await L.overlay({}, {}, iso(3), NOW, iso(1));
  assert.deepEqual([none.freshness.changes.at, none.freshness.changes.age_s, none.freshness.changes.stale, none.freshness.ok], [null, null, true, false], 'no tick, no reading, never fresh');
  const merged = await L.overlay({ throughput: { changelog: [{ date: '2026-11-20', changes: [{ n: 7, title: 'old title', plus: 5, minus: 2 }, { n: 6, title: 'six', plus: 1, minus: 0 }] }] } }, env(iso(1)), iso(3), NOW, iso(1));
  const day = merged.throughput.changelog[0];
  assert.deepEqual(day.changes.map(c => [c.n, c.title, c.plus]), [[7, 'live', 5], [6, 'six', 1]], 'a live change replaces the snapshot\'s by number, keeps its size and sorts newest number first');
});

test('US-29-R69: the yield page lists every directive from the generated data, escapes it, says no person is scored and shows an unsettled share as not settled yet', { skip }, async () => {
  const data = { at: '2026-11-21T00:00:00Z', settle_days: 30, target_kept_share: 0.8, error: null, summary: { intents: 2, measured: 1, kept_share: null, holding_share: 1, restated_share: 0.5 },
    intents: [{ id: 'A-1', title: 'Do <it>', date: '2026-11-20', verdict: 'holding', restatements: 1, restates: 'B-1', item: 'Q-YIELD-abc' }, { id: 'B-1', title: 'Second', date: '2026-11-01', verdict: 'kept', restatements: 0, restates: null, item: null }] };
  const h = Y.yieldPage(shell, data);
  assert.match(h, /Do &lt;it&gt;/); assert.match(h, /no person is scored/); assert.match(h, /Kept after 30 days: not settled yet \(target 80%\)/); assert.match(h, /Holding before the window ends: 100%/);
  assert.match(h, /Said more than once: 50%/); assert.match(h, /Directives with a check that can run: 1 of 2/);
  assert.match(h, /<code>A-1<\/code>/); assert.match(h, /1 \(restates <code>B-1<\/code>\)/); assert.match(h, /<code>Q-YIELD-abc<\/code>/);
  assert.doesNotMatch(h, /that run reported a problem/);
  assert.match(Y.yieldPage(shell, { ...data, error: 'parsed 3 directives' }), /that run reported a problem: parsed 3 directives/);
  const u = p => new URL('https://ultrastable.io' + p);
  assert.equal(await Y.yieldRoutes(u('/other'), {}, shell, {}), null);
  const j = await Y.yieldRoutes(u('/yield.json'), {}, shell, {});
  assert.equal(j.headers.get('Content-Type'), 'application/json'); assert.equal(j.headers.get('Access-Control-Allow-Origin'), '*'); assert.equal(j.headers.get('Cache-Control'), 'public, max-age=300');
  const live = await j.json(); assert.equal(live.marker, 'INTENT-YIELD-1'); assert.ok(Array.isArray(live.intents) && live.intents.length > 0);
  const page = await Y.yieldRoutes(u('/yield/'), {}, shell, { 'Content-Type': 'text/html' });
  assert.match(await page.text(), /Intent yield/);
});
