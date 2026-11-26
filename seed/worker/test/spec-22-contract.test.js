// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// US-22-R16 (US-SPEC-22): a system declares each public statement once, with the page that shows it and the endpoint that backs it, and verifies
// in its own tests that every sentence's endpoint answers and every public endpoint is named by a statement or listed as internal with a reason.
// The engine is seed/worker/src/contract.js; the wider contract suite is seed/worker/test/contract.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contractRoute, verify, statementsHtml, footerLinks, PLATFORM } from '../src/contract.js';

const spec = {
  name: 'Demo', url: 'https://demo.example', repo: 'ultrastable/demo', summary: 'A demo system.',
  statements: [{ id: 'entries', text: 'Every entry lists the studies behind it.', page: '/', api: '/api/entries' }],
  internal: [{ path: '/api/guess', why: 'write route used by the page form; not a readable capability' }],
};
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const H = b => new Response(`<!doctype html><html><body>${b}</body></html>`, { headers: { 'content-type': 'text/html' } });
const site = (over = {}) => {
  const routes = {
    '/': () => H(`<a href="${PLATFORM}/">Ultrastable</a> <a href="/api/entries">data</a> ${statementsHtml(spec, '/')} ${footerLinks(spec)}`),
    '/health': () => J({ ok: true }), '/social-queue.json': () => J({ posts: [] }), '/api/graph': () => J({ ok: true }), '/api/entries': () => J({ entries: [] }), ...over,
  };
  return async path => contractRoute(path, spec) || (routes[path] ? routes[path]() : new Response('nope', { status: 404 }));
};

test('US-22-R16: front to back, a sentence whose endpoint stops answering fails; back to front, an endpoint no statement names fails unless it is internal with a reason', async () => {
  assert.deepEqual((await verify(site(), spec, { apis: ['/api/entries', '/api/graph', '/api/guess'] })).failures, []);
  const gone = await verify(site({ '/api/entries': undefined }), spec, { apis: ['/api/graph'] });
  assert.ok(gone.failures.some(f => f.direction === 'front-to-back' && f.id === 'entries'), JSON.stringify(gone.failures));
  const hidden = await verify(site(), spec, { apis: ['/api/entries', '/api/graph', '/api/secret'] });
  assert.deepEqual(hidden.failures.filter(f => f.direction === 'back-to-front').map(f => f.id), ['/api/secret']);
});

test('US-22-R16: the sentence a page shows is the string the claims feed serves, so deleting it from the page fails the check', async () => {
  const bare = await verify(site({ '/': () => H(`<a href="${PLATFORM}/">Ultrastable</a> <a href="/api/entries">data</a>`) }), spec, { apis: ['/api/entries'] });
  assert.ok(bare.failures.some(f => f.id === 'entries'), 'a statement missing from its page is named');
});
