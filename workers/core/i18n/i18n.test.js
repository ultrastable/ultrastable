// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { segKey, segmentsOf, localizeHtml, parsePath, negotiate, localizePath, sitemapFor, sitemapIndex, checkTranslation, translateBatch, MT_KEY, LANGS } from './index.js';

const page = '<!doctype html><html lang="en"><head><title>Clean water</title><link rel="canonical" href="https://s.org/problems/x"><meta name="description" content="Safe drinking water"><meta property="og:url" content="https://s.org/problems/x"></head><body><nav><a href="/problems">Problems</a><a href="/feed.xml">Feed</a></nav><main><h1>Clean water</h1><p>Chlorine cuts diarrhoea by 23 percent.</p><code>keep me</code><form action="/search"><input placeholder="Search, for example water"></form></main></body></html>';

test('a stray < and a doctype survive and are not segments', () => {
  const h = '<!doctype html><html lang="en"><head></head><body><p>a < b and more words</p></body></html>';
  assert.ok(!segmentsOf(h).some(s => /doctype/.test(s.text)));
  assert.ok(localizeHtml(h, { lang: 'es', dict: {}, origin: 'https://s.org', path: '/' }).html.includes('a < b'));
});

test('segments cover text and attributes, not code, numbers or paths', () => {
  const t = segmentsOf(page).map(s => s.text);
  assert.ok(t.includes('Clean water') && t.includes('Problems') && t.includes('Safe drinking water') && t.includes('Search, for example water'));
  assert.ok(!t.includes('keep me') && !t.includes('/problems'));
  assert.equal(segmentsOf(page).find(s => s.text === 'Clean water').count, 2);
});

test('localizeHtml swaps known text, rewrites links, sets lang, canonical, hreflang and the machine-translation notice', () => {
  const dict = { [segKey('Clean water')]: 'Agua limpia', [segKey('Problems')]: 'Problemas', [segKey('Chlorine cuts diarrhoea by 23 percent.')]: 'El cloro reduce la diarrea en 23 por ciento.', [segKey(MT_KEY)]: 'Traducción automática.' };
  const r = localizeHtml(page, { lang: 'es', dict, origin: 'https://s.org', path: '/problems/x', live: ['es', 'fr'], minCoverage: 0.3 });
  assert.ok(r.indexable); assert.ok(r.html.startsWith('<!doctype html><html'));
  assert.match(r.html, /<html lang="es" dir="ltr"/);
  assert.match(r.html, /<h1>Agua limpia<\/h1>/);
  assert.match(r.html, /href="\/es\/problems"/); assert.match(r.html, /href="\/feed.xml"/); assert.match(r.html, /action="\/es\/search"/);
  assert.match(r.html, /canonical" href="https:\/\/s.org\/es\/problems\/x"/);
  assert.match(r.html, /hreflang="fr" href="https:\/\/s.org\/fr\/problems\/x"/); assert.match(r.html, /hreflang="x-default" href="https:\/\/s.org\/problems\/x"/);
  assert.match(r.html, /Traducción automática\./); assert.match(r.html, /<code>keep me<\/code>/);
});

test('a mostly untranslated page is noindex and canonical to the source', () => {
  const r = localizeHtml(page, { lang: 'fr', dict: {}, origin: 'https://s.org', path: '/problems/x', live: ['fr'] });
  assert.equal(r.indexable, false); assert.match(r.html, /noindex/); assert.match(r.html, /canonical" href="https:\/\/s.org\/problems\/x"/); assert.ok(!/hreflang="fr"/.test(r.html));
});

test('the source page gets hreflang alternates for live languages', () => {
  const r = localizeHtml(page, { lang: 'en', origin: 'https://s.org', path: '/problems/x', live: ['es'] });
  assert.match(r.html, /hreflang="es" href="https:\/\/s.org\/es\/problems\/x"/);
});

test('paths, negotiation and RTL', () => {
  const sup = ['es', 'ar'];
  assert.deepEqual(parsePath('/es/problems/x', sup), { lang: 'es', rest: '/problems/x' }); assert.deepEqual(parsePath('/problems', sup), { lang: null, rest: '/problems' });
  assert.equal(parsePath('/es', sup).rest, '/'); assert.equal(localizePath('/', 'es'), '/es'); assert.equal(localizePath('/feed.xml', 'es'), '/feed.xml');
  assert.equal(negotiate('fr-CH, es;q=0.8, en;q=0.5', sup), 'es');
  assert.match(localizeHtml(page, { lang: 'ar', dict: {}, origin: 'https://s.org', path: '/', live: [] }).html, /dir="rtl"/);
  assert.ok(LANGS.length >= 25);
});

test('sitemaps list alternates', () => {
  assert.match(sitemapFor({ origin: 'https://s.org', paths: ['/', '/problems/x', '/api'], lang: 'es', live: ['es'] }), /<loc>https:\/\/s.org\/es\/problems\/x<\/loc>.*hreflang="es"/);
  assert.ok(!/\/api/.test(sitemapFor({ origin: 'https://s.org', paths: ['/api/x'], lang: 'es', live: ['es'] })));
  assert.match(sitemapIndex({ origin: 'https://s.org', langs: ['es'] }), /sitemap-es\.xml/);
});

test('translations are checked before they count', async () => {
  assert.equal(checkTranslation('Cuts 23 percent', 'Reduce 23 por ciento', 'es'), null);
  assert.equal(checkTranslation('Cuts 23 percent', 'Reduce 32 por ciento', 'es'), 'numbers changed');
  assert.equal(checkTranslation('Clean water supply for villages', 'Clean water supply for villages', 'ru'), 'wrong script');
  assert.equal(checkTranslation('Water supply', 'I cannot translate this', 'es'), 'refusal');
  const gen = async () => '1\tAgua limpia\n2\tReduce 99 por ciento';
  const r = await translateBatch({ generate: gen, lang: 'es', segments: ['Clean water', 'Cuts 23 percent'] });
  assert.deepEqual(Object.values(r.ok), ['Agua limpia']); assert.equal(r.rejected[0].why, 'numbers changed');
});
