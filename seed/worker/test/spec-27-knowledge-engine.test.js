// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-27: the shared mapper engine for systems that map their own records (seed/worker/src/knowledge.js, marker KGRAPH-1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import * as kg from '../src/knowledge.js';

const KG_TABLES = ['kg_nodes', 'kg_edges', 'kg_insights', 'kg_runs', 'kg_sources', 'kg_state'];
const tenantDb = () => { const d = makeDb(); for (const t of KG_TABLES) d.raw.exec('DROP TABLE IF EXISTS ' + t); return d; };
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const D = 864e5, T0 = 1_700_000_000_000;
const mappers = { paper: (d, { node, edge }) => { const p = node('paper', d.title, { year: d.year }); for (const a of d.authors) edge(p, 'by', node('author', a)); edge(p, 'about', node('topic', d.topic)); } };
const recs = list => list.map(d => ({ type: 'paper', source: 'paper/' + d.id, data: d }));
const base = [
  { id: 1, title: 'Deterrence', year: 2013, authors: ['Nagin'], topic: 'crime' },
  { id: 2, title: 'Imprisonment and reoffending', year: 2009, authors: ['Nagin', 'Cullen'], topic: 'crime' },
  { id: 3, title: 'Hot spots', year: 2019, authors: ['Braga'], topic: 'policing' },
  { id: 4, title: 'Disorder policing', year: 2015, authors: ['Braga', 'Welsh'], topic: 'policing' },
];
const spec = { predict: [{ from: 'paper', to: 'paper' }], gaps: [{ id: 'no-paper', kind: 'author', need: { rel: 'by', dir: 'in' }, text: n => `${n.label} has no paper` }], window_days: 1 };

test('US-27-R31: the engine keeps every row under a tenant id, creates its own tables, and refuses a database that holds the zero-config graph\'s tables', async () => {
  const db = tenantDb();
  await kg.sync(db, kg.extract(recs(base), mappers), { tenant: 'a', now: T0 });
  await kg.sync(db, kg.extract(recs(base.slice(0, 1)), mappers), { tenant: 'b', now: T0 });
  assert.equal((await kg.load(db, 'a')).nodes.size > (await kg.load(db, 'b')).nodes.size, true); assert.equal((await kg.load(db, 'c')).nodes.size, 0, 'tenants are isolated');
  const cols = db.raw.prepare(`PRAGMA table_info(kg_nodes)`).all().map(c => c.name); assert.ok(cols.includes('tenant') && cols.includes('retired_at'));
  const zero = makeDb();   // the seed's own database already holds DATAGRAPH-1's kg_nodes, which has no tenant column
  await assert.rejects(kg.runKg(zero, { tenant: 't', records: recs(base), mappers, spec, now: 1 }), /DATAGRAPH-1/);
  await assert.rejects(kg.sync(zero, [], { tenant: 't' }), /DATAGRAPH-1/);
  assert.ok(!zero.raw.prepare(`PRAGMA table_info(kg_nodes)`).all().some(c => c.name === 'tenant'), 'nothing was written into the other engine\'s tables');
});

test('US-27-R32: an entity has one id (kind plus a normalised key), aliases merge, and a record that cannot be mapped cleanly is an error, never a half graph', () => {
  assert.equal(kg.key('The Nagin, et al.'), 'nagin'); assert.equal(kg.key('Guimerà'), kg.key('guimera')); assert.equal(kg.key(null), '');
  assert.equal(kg.nodeId('author', 'D. Nagin', { 'author:d nagin': 'author:nagin' }), 'author:nagin');
  const f = kg.extract(recs(base.slice(0, 1)), mappers, { aliases: { 'author:nagin': 'author:n-nagin' } });
  assert.deepEqual(f[0].nodes.map(n => n.id), ['author:n-nagin', 'paper:deterrence', 'topic:crime']); assert.match(f[0].hash, /^[0-9a-f]{16}$/);
  assert.equal(kg.extract(recs(base.slice(0, 1)), mappers, { aliases: { 'author:nagin': 'author:n-nagin' } })[0].hash, f[0].hash, 'the hash is stable');
  const twice = kg.extract([{ type: 'x', source: 's', data: {} }], { x: (_d, { node, edge }) => { const a = node('k', 'A'), b = node('k', 'B'); edge(a, 'r', b, { weight: 2 }); edge(a, 'r', b, { weight: 3 }); edge(a, 'self', a); } });
  assert.deepEqual(twice[0].edges.map(e => [e.rel, e.weight]), [['r', 5]], 'the same edge adds its weight; an edge to itself is dropped');
  assert.throws(() => kg.extract([{ type: 'nope', source: 's', data: {} }], mappers), /no mapper for record type nope/);
  assert.throws(() => kg.extract([{ type: 'paper', data: base[0] }], mappers), /needs a source id/);
  assert.throws(() => kg.extract([...recs(base.slice(0, 1)), ...recs(base.slice(0, 1))], mappers), /duplicate source paper\/1/);
  assert.throws(() => kg.extract([{ type: 'x', source: 's', data: {} }], { x: (_d, { node }) => node('k', '') }), /needs kind and label/);
  assert.throws(() => kg.extract([{ type: 'x', source: 's', data: {} }], { x: (_d, { edge }) => edge('a', '', 'b') }), /needs src, rel and dst/);
  assert.throws(() => kg.extract([{ type: 'x', source: 's', data: {} }], { x: (_d, { node, edge }) => edge(node('k', 'A'), 'r', 'k:ghost') }), /has an end the record did not declare/);
});

test('US-27-R33: model extraction keeps only triples inside the schema whose supporting quote of twenty or more characters is found in the text', () => {
  const text = 'Nagin (2013) found that the certainty of being caught deters far more than severity of punishment.', schema = { kinds: ['author', 'finding'], rels: ['found'] };
  const quote = 'the certainty of being caught deters far more', T = (src, rel, dst, q) => ({ src, rel, dst, quote: q });
  const A = { kind: 'author', label: 'Nagin' }, F = { kind: 'finding', label: 'certainty deters' };
  const out = JSON.stringify({ triples: [T(A, 'found', F, quote), T(A, 'found', F, 'prison always lowers crime by a large amount'), T({ kind: 'place', label: 'x' }, 'found', F, quote), T(A, 'invented', F, quote),
    T(A, 'found', F, 'certainty of being'), T(A, 'found', { kind: 'finding', label: '' }, quote), T(A, 'found', F, '  THE   certainty of being caught deters far more ')] });
  const r = kg.checkExtraction('The model says: ' + out + ' done', text, schema);
  assert.equal(r.triples.length, 2, 'a quote is compared lower-cased with spaces collapsed'); assert.equal(r.dropped, 5);
  assert.deepEqual(kg.checkExtraction('nonsense', text, schema), { triples: [], dropped: 1, reason: 'not json' });
  assert.deepEqual(kg.checkExtraction({ triples: 'x' }, text, schema), { triples: [], dropped: 0 });
  const p = kg.extractPrompt('t'.repeat(7000), schema); assert.equal(p[1].content.length, 6000); assert.match(p[0].content, /Kinds: author, finding\. Relations: found\./); assert.match(p[0].content, /Reply with JSON only/);
});

test('US-27-R34: sync writes only what changed, retires what changed or vanished instead of deleting it, keeps retired history for 180 days, and does not retire when the batch is not complete', async () => {
  const db = tenantDb();
  assert.deepEqual(await kg.sync(db, kg.extract(recs(base), mappers), { tenant: 't', now: T0 }), { added: 4, changed: 0, retired: 0, unchanged: 0 });
  assert.deepEqual(await kg.sync(db, kg.extract(recs(base), mappers), { tenant: 't', now: T0 + 1 }), { added: 0, changed: 0, retired: 0, unchanged: 4 });
  const partial = await kg.sync(db, kg.extract(recs(base.slice(0, 2)), mappers), { tenant: 't', now: T0 + 2, complete: false });
  assert.equal(partial.retired, 0, 'a partial batch retires nothing'); assert.equal((await kg.load(db, 't')).nodes.has('paper:hot spots'), true);
  const r = await kg.sync(db, kg.extract(recs(base.slice(1)), mappers), { tenant: 't', now: T0 + 3 });
  assert.equal(r.retired, 1); assert.equal((await kg.load(db, 't')).nodes.has('paper:deterrence'), false);
  assert.ok(one(db, `SELECT COUNT(*) AS n FROM kg_nodes WHERE tenant='t' AND retired_at IS NOT NULL`).n > 0, 'retired, not deleted');
  assert.equal(one(db, `SELECT retired_at FROM kg_sources WHERE source='paper/1'`).retired_at, T0 + 3);
  const recs2 = recs(base.slice(1));
  await kg.runKg(db, { tenant: 't', records: recs2, mappers, spec, now: T0 + 179 * D }); assert.ok(one(db, `SELECT COUNT(*) AS n FROM kg_nodes WHERE tenant='t' AND retired_at IS NOT NULL`).n > 0, 'still kept at 179 days');
  await kg.runKg(db, { tenant: 't', records: recs2, mappers, spec, now: T0 + 181 * D }); assert.equal(one(db, `SELECT COUNT(*) AS n FROM kg_nodes WHERE tenant='t' AND retired_at IS NOT NULL`).n, 0, 'gone after 180 days');
  assert.deepEqual(kg.KG_DEFAULTS.retain_days, 180);
  // a record whose mapped facts changed replaces its old facts
  const moved = await kg.sync(db, kg.extract(recs(base.slice(1).map(d => (d.id === 4 ? { ...d, authors: ['Braga', 'Schnell'] } : d))), mappers), { tenant: 't', now: T0 + 182 * D });
  assert.deepEqual(moved, { added: 0, changed: 1, retired: 0, unchanged: 2 });
  const g = await kg.load(db, 't'); assert.ok(g.nodes.has('author:schnell') && !g.nodes.has('author:welsh'));
});

test('US-27-R35: an insight is a link, gap or bridge lead with a due date and a check that can fail; settled outcomes re-weight each kind, and a failing run is recorded with its error', async () => {
  const db = tenantDb();
  const r = await kg.runKg(db, { tenant: 'u', records: recs(base), mappers, spec, now: T0 }); assert.ok(r.ok, r.error); assert.ok(r.insights_new >= 1 && r.insights_new <= 5, 'at most five new a run');
  const open = await kg.insights(db, 'u'); assert.ok(open.every(i => i.due_at === T0 + 1 * D), 'due after window_days'); assert.ok(open.some(i => i.kind === 'link'));
  assert.equal(kg.KG_DEFAULTS.window_days, 14); assert.equal(kg.KG_DEFAULTS.max_new_per_run, 5);
  const again = await kg.runKg(db, { tenant: 'u', records: recs(base), mappers, spec, now: T0 + 1 });
  const all = (await kg.insights(db, 'u', { status: 'any', limit: 500 })).map(i => i.id); assert.equal(new Set(all).size, all.length, 'an insight is filed once');
  assert.ok(again.ok);
  // judge: the check each kind is held to
  const g = { nodes: new Map([['a', { id: 'a' }], ['b', { id: 'b' }]]), edges: [] }, an = { gaps: [{ node: 'a', rule: 'r1' }], bridges: [{ id: 'a' }] }, now = 1000, ins = o => ({ follows: 0, due_at: now + 1, ...o });
  const j = o => kg.judge(ins(o), g, an, { now });
  assert.equal(j({ kind: 'gap', subject: 'a', object: 'r1' }), 'open'); assert.equal(j({ kind: 'gap', subject: 'a', object: 'r1', due_at: now - 1 }), 'dropped'); assert.equal(j({ kind: 'gap', subject: 'a', object: 'r2' }), 'kept', 'the gap closed');
  assert.equal(j({ kind: 'bridge', subject: 'a' }), 'open'); assert.equal(j({ kind: 'bridge', subject: 'a', due_at: now - 1 }), 'kept'); assert.equal(j({ kind: 'bridge', subject: 'b', due_at: now - 1 }), 'dropped');
  assert.equal(j({ kind: 'link', subject: 'a', object: 'b' }), 'open'); assert.equal(j({ kind: 'link', subject: 'a', object: 'b', due_at: now - 1 }), 'dropped'); assert.equal(j({ kind: 'link', subject: 'a', object: 'b', follows: 3 }), 'kept', 'three follows count as an outcome');
  assert.equal(j({ kind: 'link', subject: 'a', object: 'zz' }), 'superseded', 'a subject that left the graph is superseded, which does not count in calibration');
  assert.equal(kg.judge(ins({ kind: 'link', subject: 'a', object: 'b' }), { nodes: g.nodes, edges: [{ src: 'b', dst: 'a' }] }, an, { now }), 'kept', 'the link appeared in either direction');
  // calibrate: Beta(1,1) over the expected rate, bounded, unchanged below three settled outcomes
  const rows = (k, kept, n) => Array.from({ length: n }, (_, i) => ({ kind: k, status: i < kept ? 'kept' : 'dropped' }));
  assert.deepEqual(kg.calibrate([...rows('a', 6, 6), ...rows('b', 0, 6), ...rows('c', 2, 3), ...rows('d', 1, 2)]), { a: 1.5, b: 0.5, c: 1.5, d: 1 });
  assert.ok(Math.abs(kg.calibrate(rows('e', 1, 3)).e - (2 / 5) / 0.3) < 1e-9, '(kept + 1) / (n + 2), over the expected rate 0.3');
  // a failing run is on the run row, and health reads it
  const bad = await kg.runKg(db, { tenant: 'x', records: [{ type: 'paper', source: 's', data: { title: '', authors: [], topic: 't' } }], mappers, now: 5 });
  assert.equal(bad.ok, false); assert.match(bad.error, /needs kind and label/); assert.equal((await kg.lastRun(db, 'x')).error, bad.error);
  const h = await kg.kgHealth(db, 'x', 5); assert.equal(h.ok, false); assert.equal(h.last_error, bad.error);
  const late = await kg.kgHealth(db, 'u', T0 + 1 + 27 * 36e5); assert.equal(late.ok, false, 'a graph not rebuilt for more than 26 hours is not healthy'); assert.equal(late.last_run_hours_ago, 27);
  assert.equal((await kg.kgHealth(db, 'u', T0 + 1 + 25 * 36e5)).ok, true);
});

test('US-27-R36: the engine serves its graph, insights, a node, health, the method and a follow as JSON, and re-measures nine practices from its own tables on every request', async () => {
  const db = tenantDb(), now = T0;
  const empty = await kg.practices(db, 'z', now);
  assert.equal(empty.practices.length, 9); assert.equal(kg.KG_PRACTICES.length, 9);
  const st = id => empty.practices.find(p => p.id === id).status;
  assert.deepEqual(['fresh', 'schema-first'].map(st), ['fails', 'fails']); assert.deepEqual(['communities', 'incremental-temporal', 'calibrated-insights', 'bounded-cost'].map(st), ['unmeasured', 'unmeasured', 'unmeasured', 'unmeasured'], 'with no run the practices that need one are unmeasured, never holding by default');
  await kg.runKg(db, { tenant: 'r', records: recs(base), mappers, spec, now });
  const get = (p, tenant = 'r') => kg.handleKg(new Request('https://x.test' + p), db, { tenant, now });
  const snap = await (await get('/api/graph.json')).json(); assert.equal(snap.ok, true); assert.equal(snap.total.nodes, snap.nodes.length); assert.equal((await (await get('/api/graph')).json()).version, 'kg/1');
  assert.ok(snap.nodes[0].rank >= snap.nodes[snap.nodes.length - 1].rank, 'nodes come by PageRank');
  assert.ok((await (await get('/api/graph/insights?kind=link')).json()).insights.every(i => i.kind === 'link'));
  assert.equal((await (await get('/api/graph/node?id=author:nagin')).json()).neighbors.length, 2);
  const method = await (await get('/api/graph/method')).json(); assert.equal(method.practices.length, 9); for (const p of method.practices) assert.match(p.source.url, /^https:\/\//);
  assert.equal((await get('/api/graph/health')).status, 200); assert.equal((await get('/api/graph/health', 'nobody')).status, 503, 'no run, no health');
  const ins = (await (await get('/api/graph/insights')).json()).insights[0];
  const post = body => kg.handleKg(new Request('https://x.test/api/graph/follow', { method: 'POST', body }), db, { tenant: 'r', now });
  assert.equal((await (await post(JSON.stringify({ id: ins.id }))).json()).ok, true); assert.equal(one(db, `SELECT follows FROM kg_insights WHERE id=?`, ins.id).follows, 1);
  assert.equal((await post('{nope')).status, 400); assert.equal((await (await post(JSON.stringify({ id: 'no-such' }))).json()).ok, false);
  assert.equal(await get('/elsewhere'), null); assert.equal(await kg.handleKg(new Request('https://x.test/api/graph/health', { method: 'DELETE' }), db, { tenant: 'r' }), null);
  const html = kg.methodHtml(method); assert.match(html, /re-checked each time/); assert.doesNotMatch(html, /<script/); assert.match(html, /holds|fails|unmeasured/);
  assert.match(kg.methodHtml({ ...method, practices: [{ ...method.practices[0], practice: '<script>x</script>' }] }), /&lt;script&gt;/, 'text is escaped');
});

test('US-27-R37: zero-config extraction reads every table with a key, skips engine, log-like and personal tables and private columns, and links rows by exact keys and named integer references', async () => {
  assert.equal(kg.TABLE_DEFAULTS.per_table, 200); assert.equal(kg.TABLE_DEFAULTS.max_tables, 40);
  const db = tenantDb();
  db.raw.exec(`CREATE TABLE programmes (id TEXT PRIMARY KEY, name TEXT, owner_email TEXT); CREATE TABLE sites (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE trials (id INTEGER PRIMARY KEY, title TEXT, programme TEXT, site_id INTEGER, other INTEGER);
    CREATE TABLE twins_a (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE twins_b (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE pointers (id TEXT PRIMARY KEY, ref TEXT);
    CREATE TABLE sync_runs (id TEXT PRIMARY KEY); CREATE TABLE access_log (id TEXT PRIMARY KEY); CREATE TABLE subscribers (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE nokey (a TEXT, b TEXT);
    INSERT INTO programmes VALUES ('prog-a','Cash','a@b.c'); INSERT INTO sites VALUES (1,'Kenya'),(2,'Malawi');
    INSERT INTO trials VALUES (1,'RCT','prog-a',1,2),(2,'Second','prog-a',2,2);
    INSERT INTO twins_a VALUES ('same-key','A'); INSERT INTO twins_b VALUES ('same-key','B'); INSERT INTO pointers VALUES ('p1','same-key'),('p2','prog-a'),('p3','x');
    INSERT INTO sync_runs VALUES ('r1'); INSERT INTO access_log VALUES ('l1'); INSERT INTO subscribers VALUES (1,'A Person'); INSERT INTO nokey VALUES ('x','y');`);
  const rs = await kg.tableRecords(db);
  const tables = new Set(rs.map(r => r.data.table)); assert.deepEqual([...tables].sort(), ['pointers', 'programmes', 'sites', 'trials', 'twins_a', 'twins_b'], 'no engine table, no run or log table, no personal table, no table without a key');
  assert.ok(!JSON.stringify(rs).includes('a@b.c'), 'a private column is never read');
  const trial = rs.find(r => r.source === 'row/trials/1').data;
  assert.deepEqual(trial.refs.map(x => [x.col, x.table, x.key]).sort(), [['programme', 'programmes', 'prog-a'], ['site_id', 'sites', '1']], 'an integer follows only a column named after the table; "other" does not');
  const p = Object.fromEntries(rs.filter(r => r.data.table === 'pointers').map(r => [r.data.key, r.data.refs]));
  assert.deepEqual(p.p1, [], 'a key that two rows share names no one row'); assert.equal(p.p2.length, 1); assert.deepEqual(p.p3, []);
  const many = tenantDb(); many.raw.exec(`CREATE TABLE big (id INTEGER PRIMARY KEY, name TEXT)`); const ins = many.raw.prepare(`INSERT INTO big VALUES (?,?)`); for (let i = 1; i <= 300; i++) ins.run(i, 'n' + i);
  const cut = await kg.tableRecords(many); assert.equal(cut.length, 200); assert.ok(cut.some(r => r.data.key === '300') && !cut.some(r => r.data.key === '100'), 'the newest 200 by primary key');
  const only = await kg.tableRecords(db, { only: ['sites'], skip: ['sites'] }); assert.equal(only.length, 0);
  const g = await (async () => { await kg.sync(db, kg.extract(rs, kg.TABLE_MAPPERS), { tenant: 'z', now: 1 }); return kg.load(db, 'z'); })();
  assert.ok(g.edges.some(e => e.src === 'trials:1' && e.rel === 'programme' && e.dst === 'programmes:prog-a'));
});

test('US-27-R35: a link is kept by three follows and not by two, and the default is three', () => {
  assert.equal(kg.KG_DEFAULTS.min_follows, 3);
  const g = { nodes: new Map([['a', { id: 'a' }], ['b', { id: 'b' }]]), edges: [] }, an = { gaps: [], bridges: [] }, now = 1000;
  const j = follows => kg.judge({ kind: 'link', subject: 'a', object: 'b', follows, due_at: now + 1 }, g, an, { now });
  assert.deepEqual([0, 1, 2, 3, 4].map(j), ['open', 'open', 'open', 'kept', 'kept']);
  assert.equal(kg.judge({ kind: 'link', subject: 'a', object: 'b', follows: 2, due_at: now + 1 }, g, an, { now, minFollows: 2 }), 'kept', 'the threshold is a setting');
});

test('US-27-R37: a value of fewer than four characters names no row, one of four characters does', async () => {
  // the rule is held on both sides (the key and the value must each be four characters), so it takes breaking both to make a short value link
  const db = tenantDb();
  db.raw.exec(`CREATE TABLE codes (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE holders (id TEXT PRIMARY KEY, name TEXT, code TEXT);
    INSERT INTO codes VALUES ('abc','Short'),('abcd','Long'); INSERT INTO holders VALUES ('h-short','Holds short','abc'),('h-long','Holds long','abcd');`);
  const rs = await kg.tableRecords(db), by = Object.fromEntries(rs.filter(r => r.data.table === 'holders').map(r => [r.data.key, r.data.refs]));
  assert.deepEqual(by['h-short'], [], 'three characters: no edge');
  assert.deepEqual(by['h-long'].map(x => [x.col, x.table, x.key]), [['code', 'codes', 'abcd']], 'four characters: an edge');
});
