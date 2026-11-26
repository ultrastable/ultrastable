// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// FLEET-CONTRACT-1: one contract for every system; statements are checked front to back and back to front.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contractRoute, verify, manifest, claims, specProblems, apiLinks, routesIn, footerLinks, statementsHtml, shows, SURFACES, PLATFORM } from '../src/contract.js';

const spec = {
  name: 'Demo', url: 'https://demo.example', repo: 'ultrastable/demo', summary: 'A demo system.',
  statements: [
    { id: 'entries', text: 'Every entry lists the studies behind it.', page: '/', api: '/api/entries' },
    { id: 'fresh', text: 'The loop reports when it last ran.', page: '/changes', api: '/api/freshness' },
  ],
  internal: [{ path: '/api/guess', why: 'write route used by the page form; not a readable capability' }],
};
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const H = b => new Response(`<!doctype html><html><body>${b}</body></html>`, { headers: { 'content-type': 'text/html' } });
function site(over = {}) {
  const routes = {
    '/': () => H(`<a href="${PLATFORM}/">Ultrastable</a> <a href="/api/entries">data</a> ${statementsHtml(spec, '/')} ${footerLinks(spec)}`),
    '/changes': () => H('changes ' + statementsHtml(spec, '/changes')),
    '/health': () => J({ ok: true }),
    '/social-queue.json': () => J({ posts: [] }),
    '/api/graph': () => J({ ok: true }),
    '/api/entries': () => J({ entries: [] }),
    '/api/freshness': () => J({ ok: true }),
    ...over,
  };
  return async path => contractRoute(path, spec) || (routes[path] ? routes[path]() : new Response('nope', { status: 404 }));
}

test('FLEET-CONTRACT-1: a system that serves every surface and backs every statement passes', async () => {
  const r = await verify(site(), spec, { apis: ['/api/entries', '/api/freshness', '/api/graph', '/api/guess'] });
  assert.deepEqual(r.failures, []);
  assert.ok(r.ok && r.checks > SURFACES.length);
});

test('front to back: a sentence whose endpoint is gone fails, and so does a dead /api link on a page', async () => {
  const r = await verify(site({ '/api/freshness': undefined, '/': () => H(`<a href="${PLATFORM}/">u</a><a href="/api/gone">x</a>`) }), spec);
  const f = r.failures.filter(x => x.direction === 'front-to-back').map(x => x.id);
  assert.ok(f.includes('fresh') && f.includes('/api/gone'), JSON.stringify(r.failures));
});

test('back to front: an endpoint no statement names fails, and a statement whose page is gone fails', async () => {
  const r = await verify(site({ '/changes': undefined }), spec, { apis: ['/api/entries', '/api/secret-capability'] });
  const f = r.failures.filter(x => x.direction === 'back-to-front').map(x => x.id);
  assert.deepEqual(f.sort(), ['/api/secret-capability', 'fresh']);
});

test('contract: missing surfaces, an unwell health route and a home page without the platform link are named', async () => {
  const r = await verify(site({ '/social-queue.json': undefined, '/health': () => J({ ok: false }, 503), '/': () => H('no link') }), spec);
  assert.deepEqual(r.failures.map(x => x.id).sort(), ['entries', 'health', 'home', 'social']);  // entries: the bare home page no longer shows its sentence
});

test('the manifest carries nothing private and the claims list every statement with its page and endpoint', () => {
  const m = manifest({ ...spec, token: 'x', statements: spec.statements });
  assert.deepEqual(Object.keys(m).sort(), ['contract', 'directory', 'discoverable', 'license', 'name', 'platform', 'repo', 'summary', 'surfaces', 'ultrastable', 'url']);
  assert.equal(m.url, 'https://demo.example');
  assert.deepEqual(claims(spec).statements.map(s => [s.id, s.page, s.api]), [['entries', '/', '/api/entries'], ['fresh', '/changes', '/api/freshness']]);
  assert.equal(contractRoute('/other', spec), null);
});

test('a declaration without a page or an endpoint is refused before any request', () => {
  const bad = specProblems({ name: 'X', url: 'http://x', repo: 'x', statements: [{ id: 'a', text: 'Something the page says here.', api: '/api/a' }, { id: 'a', text: 'Again something said.', page: '/' }] });
  assert.equal(bad.length, 5, bad.join('; '));
  assert.deepEqual(specProblems({ ...spec, statements: [{ id: 'contrast', text: 'Text meets AA contrast in light and dark.', page: '/', evidence: 'test/a11y.test.js' }] }), []);
});

test('apiLinks keeps whole paths only; routesIn reads a router', () => {
  assert.deepEqual(apiLinks(`<a href="/api/a">a</a><script>fetch('/api/b?x=1');fetch("/api/c/" + id);fetch(\`/api/d/\${x}\`)</script>`).sort(), ['/api/a', '/api/b?x=1']);
  assert.deepEqual(routesIn(`if (p === "/api/x") {} if (u.pathname === '/api/y' && m) {} if (p === "/z") {} if (p.startsWith("/api/item/")) {}`), ['/api/item/*', '/api/x', '/api/y']);
});

test('the sentence in /claims.json must be the sentence on the page; a route family needs a statement or an internal prefix', async () => {
  const r = await verify(site({ '/changes': () => H('The loop tells you when it ran.') }), spec, { apis: ['/api/item/*', '/api/entries'] });
  assert.deepEqual(r.failures.map(f => [f.id, f.direction]), [['fresh', 'back-to-front'], ['/api/item/*', 'back-to-front']]);
  assert.ok(shows('<p>Tom &amp; Ann&#39;s   <b>plan</b></p><script>var hidden = 1</script>', "tom & ann's plan") && !shows('<script>secret words</script>', 'secret words'));
  const ok = await verify(site(), { ...spec, internal: [...spec.internal, { path: '/api/item/*', why: 'one record by id; the list endpoint is the stated one' }] }, { apis: ['/api/item/*'] });
  assert.deepEqual(ok.failures, []);
});

// STANDARDS-FIRST-1: schema.org JSON-LD generated from the same spec the page shows
const ldOf = html => [...String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
test('JSON-LD: a page carries one schema.org WebSite whose facts are the spec the page renders', async () => {
  const { jsonLd, linkedData } = await import('../src/contract.js');
  const spec = { name: 'Base <Rates>', summary: 'How often things happen, with sources.', url: 'https://base-rates.example/', repo: 'ultrastable/base-rates', statements: [] };
  const html = `<html><head>${jsonLd(spec)}</head><body><h1>${spec.name}</h1></body></html>`;
  assert.ok(!/<Rates>/.test(html.split('</head>')[0]), 'a "<" in a value cannot close the script element');
  const [ld] = ldOf(html);
  assert.equal(ld['@context'], 'https://schema.org'); assert.equal(ld['@type'], 'WebSite');
  assert.equal(ld.name, spec.name); assert.equal(ld.description, spec.summary); assert.equal(ld.url, 'https://base-rates.example');
  assert.equal(ld.mainEntity['@type'], 'SoftwareApplication'); assert.equal(ld.mainEntity.isBasedOn.codeRepository, 'https://github.com/ultrastable/base-rates');
  assert.equal(ld.isPartOf.url, PLATFORM);
  assert.equal(linkedData({ name: 'x' }).url, undefined, 'no address is invented for a system that has none');
  assert.equal(jsonLd({}), '');
});
test('JSON-LD: the seed public page carries the markup for its own spec', async () => {
  const { publicPage } = await import('../src/visibility.js');
  const { seedJsonLd, seedSpec } = await import('../src/discover.js');
  const env = { PUBLIC_HEALTH_ONLY: '1' }, config = { org_slug: 'second-tenant' }, url = new URL('https://second-tenant.example/');
  const html = await publicPage({ name: config.org_slug, head: seedJsonLd(env, config, url) }).text();
  const [ld] = ldOf(html), spec = seedSpec(env, config, url);
  assert.equal(ld['@type'], 'WebSite'); assert.equal(ld.name, spec.name);
  assert.ok(html.indexOf('application/ld+json') < html.indexOf('</head>'));
});
