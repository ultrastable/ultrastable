// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshHtml, staleVerdict, EDGE_S } from '../src/freshcache.js';

test('HTML revalidates in browsers, stays at most a minute at the edge and names its build', () => {
  const r = freshHtml(new Response('<p>x</p>', { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } }), 'b2');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(r.headers.get('cdn-cache-control'), 'public, max-age=' + EDGE_S);
  assert.equal(r.headers.get('x-ultrastable-build'), 'b2');
});

test('JSON, private and redirect responses are left alone', () => {
  const j = freshHtml(new Response('{}', { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } }));
  assert.equal(j.headers.get('cache-control'), 'public, max-age=300');
  const p = freshHtml(new Response('<p>', { headers: { 'content-type': 'text/html', 'cache-control': 'private' } }));
  assert.equal(p.headers.get('cache-control'), 'private');
});

test('the probe fails when the cached page serves an older build or a long edge lifetime', () => {
  assert.equal(staleVerdict({ build: 'a', cdn: 'public, max-age=60' }, { build: 'a' }).ok, true);
  assert.equal(staleVerdict({ build: 'old', cdn: 'public, max-age=60' }, { build: 'new' }).ok, false);
  assert.equal(staleVerdict({ build: 'a', cdn: '' }, { build: 'a' }).ok, false);
});
