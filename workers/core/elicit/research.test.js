// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-16 R27 and R30: cited research through a fetch port (a fake here), and the read-back of what it cited.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createElicit } from './index.js';
import { createResearch, verifyResearched, RESEARCH_PROBE } from './research.js';

const dir = p => fileURLToPath(new URL(p, import.meta.url));
const MIGS = [dir('./migrations/'), dir('./outcomes/migrations/')];
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const P = 'demo';
const need = (id, extra = {}) => ({ id, label: `Thing ${id}`, artifact: 'charter', question: `Which ${id} do you want?`, why: `This changes the ${id} we build.`, cue: 'Similar projects pick the first one.',
  options: ['public', 'private'], default: 'public', default_consequence: 'We rebuild one page; change it any time.', p_wrong: 0.5, ...extra });
const mk = () => { const db = makeDb(MIGS); const t = { v: T0 }; return { db, t, e: createElicit({ db, now: () => t.v, config: { defer_below: 0 } }) }; };
const page = (status, body = '') => ({ status, text: async () => body });
const web = (pages, seen = []) => async url => { seen.push(url); const p = pages[url]; if (p instanceof Error) throw p; return p ?? page(404); };
const row = (db, id) => db.raw.prepare('SELECT state, value, provenance, source, revisit FROM elicit_needs WHERE id=?').get(id);
const attempts = (db, id) => db.raw.prepare("SELECT surface, result, detail FROM elicit_derivations WHERE need_id=? ORDER BY id").all(id).map(r => ({ ...r }));
const SRC = { a: [{ url: 'https://example.org/policy', title: 'Policy', options: { public: 'open to everyone', private: 'members only' } }] };

test('US-16-R27: the research adapter reads a declared page that answered 200 and returns the one option it says, citing that page', async () => {
  const seen = []; const r = createResearch({ fetch: web({ 'https://example.org/policy': page(200, 'The club is Open to everyone in town.') }, seen), sources: SRC });
  const found = await r({ id: 'a', options: JSON.stringify(['public', 'private']), free_text: 0 });
  assert.deepEqual(found, { value: 'public', sources: [{ url: 'https://example.org/policy', title: 'Policy' }] });
  assert.deepEqual(seen, ['https://example.org/policy']);
});

test('US-16-R27: a page that is not 200, throws, says two things, is not https, or is not declared yields no value; two pages that disagree yield no value', async () => {
  const n = { id: 'a', options: JSON.stringify(['public', 'private']), free_text: 0 };
  const run = async (pages, sources = SRC) => createResearch({ fetch: web(pages), sources })(n);
  assert.equal(await run({ 'https://example.org/policy': page(404, 'open to everyone') }), null, 'a 404 body is not evidence');
  assert.equal(await run({ 'https://example.org/policy': page(301, 'open to everyone') }), null, 'only 200 counts');
  assert.equal(await run({ 'https://example.org/policy': new Error('network down') }), null, 'a failing fetch is a miss, not a crash');
  assert.equal(await run({ 'https://example.org/policy': page(200, 'open to everyone, or members only') }), null, 'a page that says both says nothing');
  assert.equal(await run({ 'http://example.org/policy': page(200, 'open to everyone') }, { a: [{ url: 'http://example.org/policy', options: { public: 'open' } }] }), null, 'http is never read');
  assert.equal(await run({ 'https://u:p@example.org/x': page(200, 'open') }, { a: [{ url: 'https://u:p@example.org/x', options: { public: 'open' } }] }), null, 'a URL with credentials is never read');
  assert.equal(await run({}, {}), null, 'no declared source, nothing read');
  const two = { a: [{ url: 'https://one.example/', options: { public: 'open' } }, { url: 'https://two.example/', options: { private: 'closed' } }] };
  assert.equal(await run({ 'https://one.example/': page(200, 'open'), 'https://two.example/': page(200, 'closed') }, two), null, 'sources that disagree are never guessed between');
  const agree = await run({ 'https://one.example/': page(200, 'open'), 'https://two.example/': page(200, 'open') }, { a: [two.a[0], { url: 'https://two.example/', options: { public: 'open' } }] });
  assert.deepEqual(agree.sources.map(s => s.url), ['https://one.example/', 'https://two.example/']);
  assert.throws(() => createResearch({ sources: SRC }), /fetch port/);
});

test('US-16-R27: a free-text need takes the capture of its extract pattern; an invalid pattern is a miss', async () => {
  const n = { id: 'name', options: '[]', free_text: 1 };
  const f = web({ 'https://example.org/about': page(200, '<h1>About</h1> Our name: Harbour  Chess   Club.') });
  assert.equal((await createResearch({ fetch: f, sources: { name: [{ url: 'https://example.org/about', extract: 'name:\\s*([A-Za-z ]+?)\\.' }] } })(n)).value, 'Harbour Chess Club');
  assert.equal(await createResearch({ fetch: f, sources: { name: [{ url: 'https://example.org/about', extract: '(' }] } })(n), null);
});

test('US-16-R27 and US-16-R30: derive applies the adapter\'s value with provenance researched and the cited URL, and logs the attempt', async () => {
  const { db, e } = mk(); await e.registerNeeds(P, [need('a')]);
  const research = createResearch({ fetch: web({ 'https://example.org/policy': page(200, 'members only') }), sources: SRC });
  const out = await e.derive(P, { research });
  assert.deepEqual(out.derived, [{ need_id: 'a', value: 'private', provenance: 'researched', source: 'https://example.org/policy' }]);
  assert.equal(attempts(db, 'a').at(-1).result, 'hit');
  const none = mk(); await none.e.registerNeeds(P, [need('a')]);
  await none.e.derive(P, { research: createResearch({ fetch: web({}), sources: SRC }) });
  assert.equal(row(none.db, 'a').state, 'open', 'a page that cannot be read leaves the need to be asked');
});

test('US-16-R27: the verifier reads each cited source again: 200 is a hit that satisfies the closing probe, 404 reopens the need with the evidence, 5xx and network errors change nothing', async () => {
  const { db, e } = mk(); await e.registerNeeds(P, [need('a'), need('b'), need('c'), need('d')]);
  const src = id => [{ url: `https://example.org/${id}`, options: { public: 'open' } }];
  const research = createResearch({ fetch: web(Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [`https://example.org/${id}`, page(200, 'open')]))), sources: Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, src(id)])) });
  await e.derive(P, { research });
  assert.equal(db.raw.prepare(RESEARCH_PROBE).get()['COUNT(*)'], 0, 'nothing was read back yet, so the probe is not met by the derivation alone');
  const f = web({ 'https://example.org/a': page(200, 'open'), 'https://example.org/b': page(404), 'https://example.org/c': page(503), 'https://example.org/d': new Error('timeout') });
  const out = await verifyResearched({ db, elicit: e, fetch: f, now: () => T0 }, P);
  assert.deepEqual({ checked: out.checked, ok: out.ok, reopened: out.reopened, unreadable: out.unreadable }, { checked: 4, ok: ['a'], reopened: ['b'], unreadable: ['c', 'd'] });
  assert.equal(db.raw.prepare(RESEARCH_PROBE).get()['COUNT(*)'], 1, 'one researched need whose source answered 200 when read back');
  assert.equal(row(db, 'b').state, 'open'); assert.equal(row(db, 'b').revisit, 'This changed: the cited source https://example.org/b answered 404 when read back');
  for (const id of ['a', 'c', 'd']) assert.equal(row(db, id).state, 'derived', `${id} keeps its value`);
  assert.deepEqual(attempts(db, 'c').at(-1), { surface: 'research_verify', result: 'error', detail: '503 https://example.org/c' });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM elicit_assumptions WHERE need_id='b' AND reason='contradicted'").get().n, 1, 'the old value stays in the log');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'ELICIT-RERUN%'").get().n, 1, 'the artifact it feeds is queued to be redone');
});

test('US-16-R27: a redirect says nothing: the adapter asks the fetch port not to follow it, and a page that was redirected or answered from another URL is not the declared page', async () => {
  const n = { id: 'a', options: JSON.stringify(['public', 'private']), free_text: 0 };
  const inits = [];
  const one = res => createResearch({ fetch: async (url, init) => { inits.push(init); return res; }, sources: SRC })(n);
  assert.equal(await one({ status: 301, url: 'https://example.org/policy', text: async () => 'open to everyone' }), null, 'a 3xx says nothing');
  assert.equal(inits[0].redirect, 'manual', 'redirects are never followed by the adapter');
  assert.equal(await one({ status: 200, redirected: true, text: async () => 'open to everyone' }), null, 'a page the port says it reached by a redirect is not the declared one');
  assert.equal(await one({ status: 200, url: 'https://other.example/policy', text: async () => 'open to everyone' }), null, 'a page answered from another URL is not the declared one');
  assert.equal((await one({ status: 200, url: 'https://example.org/policy', text: async () => 'open to everyone' })).value, 'public', 'the declared page itself still counts');
  const bare = await createResearch({ fetch: async () => ({ status: 200, url: 'https://example.org/', text: async () => 'open to everyone' }), sources: { a: [{ url: 'https://example.org', options: { public: 'open' } }] } })(n);
  assert.equal(bare.value, 'public', 'the same address written with or without its trailing slash is the same page');
  const { db, e } = mk(); await e.registerNeeds(P, [need('a')]);
  await e.derive(P, { research: createResearch({ fetch: web({ 'https://example.org/policy': page(200, 'open to everyone') }), sources: SRC }) });
  const out = await verifyResearched({ db, elicit: e, fetch: async () => ({ status: 200, redirected: true, url: 'https://moved.example/', text: async () => 'open to everyone' }), now: () => T0 }, P);
  assert.deepEqual(out.unreadable, ['a'], 'a cited source that now redirects is unreadable, never proof');
  assert.equal(row(db, 'a').state, 'derived', 'and it changes nothing');
  assert.equal(db.raw.prepare(RESEARCH_PROBE).get()['COUNT(*)'], 0);
});

test('US-16-R27: with every_hours the verifier reads a cited source at most once in that window, and again after it', async () => {
  const { db, e, t } = mk(); await e.registerNeeds(P, [need('a')]);
  await e.derive(P, { research: createResearch({ fetch: web({ 'https://example.org/policy': page(200, 'open to everyone') }), sources: SRC }) });
  const seen = []; const f = web({ 'https://example.org/policy': page(200, 'open to everyone') }, seen);
  const pass = () => verifyResearched({ db, elicit: e, fetch: f, now: () => t.v, every_hours: 24 }, P);
  assert.deepEqual((await pass()).ok, ['a']);
  t.v += 10 * 60e3; const second = await pass();
  assert.equal(second.skipped, 1); assert.equal(second.checked, 0);
  t.v += 24 * 3600e3; assert.deepEqual((await pass()).ok, ['a']);
  assert.equal(seen.length, 2, 'two reads in a day and ten minutes, not one per pass');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM elicit_derivations WHERE surface='research_verify'").get().n, 2);
});
