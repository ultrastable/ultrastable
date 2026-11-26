// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-29 (visible progress, content stickiness and substantive change): the requirement of the changelog feed renderer, proved through the public API of core/feed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toRss, toJsonFeed, itemsFrom } from './index.js';

test('US-29-R38: a tenant\'s change records become RSS 2.0 and JSON Feed 1.1 items through the tenant\'s own describe function, escaped, and a record it does not describe is skipped', () => {
  const changes = [{ at: '2026-11-16T00:00:00Z', kind: 'solution', id: 'x', status: 'ok' }, { at: '2026-11-15T00:00:00Z', kind: 'problem', problem: 'p7' }, { at: '2026-11-14T00:00:00Z', kind: 'skip' }, { at: '2026-11-13T00:00:00Z', kind: 'solution' }];
  const items = itemsFrom(changes, c => c.kind === 'skip' ? null : { title: 'a <b> & "c"', link: 'https://x/' + c.kind, summary: c.status || 'none' });
  assert.deepEqual(items.map(i => i.id), ['2026-11-16T00:00:00Z#solution:x', '2026-11-15T00:00:00Z#problem:p7', '2026-11-13T00:00:00Z#solution:3'], 'the id is the time, the kind and the record\'s own id, else its problem, else its place in the list');
  assert.equal(items[0].at, '2026-11-16T00:00:00Z'); assert.equal(items[0].link, 'https://x/solution');
  const rss = toRss({ title: 't & u', link: 'https://x', description: 'd', items });
  assert.match(rss, /^<\?xml version="1.0" encoding="UTF-8"\?><rss version="2.0"><channel><title>t &amp; u<\/title>/);
  assert.ok(rss.includes('a &lt;b&gt; &amp; &quot;c&quot;') && rss.includes('<guid isPermaLink="false">2026-11-15T00:00:00Z#problem:p7</guid>') && rss.includes('<pubDate>Mon, 16 Nov 2026 00:00:00 GMT</pubDate>'));
  assert.equal((rss.match(/<item>/g) || []).length, 3);
  const j = toJsonFeed({ title: 't', link: 'https://x', feedUrl: 'https://x/feed.json', description: 'd', items });
  assert.equal(j.version, 'https://jsonfeed.org/version/1.1'); assert.equal(j.home_page_url, 'https://x'); assert.equal(j.feed_url, 'https://x/feed.json');
  assert.deepEqual(j.items[0], { id: items[0].id, url: 'https://x/solution', title: 'a <b> & "c"', content_text: 'ok', date_published: '2026-11-16T00:00:00.000Z' }, 'JSON carries the text as it is; only the XML is escaped');
  assert.deepEqual(itemsFrom([], () => ({})), []);
});
